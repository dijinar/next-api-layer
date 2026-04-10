'use client';

/**
 * AuthProvider - Generic React context for any backend format
 * 
 * @example Basic usage
 * ```tsx
 * <AuthProvider>
 *   {children}
 * </AuthProvider>
 * ```
 * 
 * @example With custom user type
 * ```tsx
 * interface MyUser {
 *   type: 'guest' | 'superadmin';
 *   user?: { name: string; email: string; };
 * }
 * 
 * <AuthProvider<MyUser>
 *   initialUser={serverUser}
 *   isGuestFn={(u) => u?.type === 'guest'}
 *   parseResponse={(res) => res.data}
 * >
 *   {children}
 * </AuthProvider>
 * ```
 */

import React, { createContext, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import type { 
  AuthContextValue, 
  AuthProviderProps, 
  LoginCredentials,
  RegisterData,
  AuthResult,
  DefaultUserData,
  ApiResponse,
} from './types';

// ==================== Context ====================

// We use 'any' here because the context needs to work with any user type
// The actual type safety comes from useAuth<TUser>() hook
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AuthContext = createContext<AuthContextValue<any> | undefined>(undefined);

// ==================== Default Functions ====================

/** Default response parser - handles common API formats */
function defaultParseResponse<TUser>(response: unknown): TUser | null {
  if (!response || typeof response !== 'object') return null;
  
  const res = response as Record<string, unknown>;
  
  // Format: { success: true, data: user }
  if (res.success && res.data) {
    return res.data as TUser;
  }
  
  // Format: { user: {...} }
  if (res.user) {
    return res.user as TUser;
  }
  
  // Format: user object directly
  if ('id' in res || 'email' in res || 'name' in res || 'type' in res) {
    return res as TUser;
  }
  
  return null;
}

/** Default guest check - handles common patterns */
function defaultIsGuest<TUser>(user: TUser | null): boolean {
  if (!user || typeof user !== 'object') return false;
  
  const u = user as Record<string, unknown>;
  
  // Check token_type (flat structure)
  if (u.token_type === 'guest') return true;
  
  // Check type (nested structure)
  if (u.type === 'guest') return true;
  
  return false;
}

// ==================== Provider Component ====================

export function AuthProvider<TUser = DefaultUserData>({
  children,
  initialUser,
  userEndpoint = '/api/auth/me',
  loginEndpoint = '/api/auth/login',
  registerEndpoint = '/api/auth/register',
  logoutEndpoint = '/api/auth/logout',
  logoutRedirect,
  isGuestFn = defaultIsGuest,
  parseResponse = defaultParseResponse,
  parseAuthResponse,
  swrConfig = {},
  onLogin,
  onLogout,
  onError,
}: AuthProviderProps<TUser>): React.ReactElement {
  
  // Create fetcher with custom parser
  const fetcher = useCallback(async (url: string): Promise<TUser | null> => {
    const res = await fetch(url);
    
    if (!res.ok) {
      if (res.status === 401) {
        return null;
      }
      throw new Error('Failed to fetch user');
    }
    
    const json = await res.json();
    return parseResponse(json);
  }, [parseResponse]);

  // Fetch user data with SWR
  const {
    data: user,
    error,
    isLoading,
    mutate,
  } = useSWR<TUser | null>(
    userEndpoint,
    fetcher,
    {
      fallbackData: initialUser ?? undefined,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateOnMount: !initialUser,
      refreshInterval: 0,
      shouldRetryOnError: false,
      ...swrConfig,
      onError: (err: Error) => {
        onError?.(err);
      },
    }
  );

  // Login function
  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthResult<TUser>> => {
    try {
      const res = await fetch(loginEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      const json = await res.json();

      // Use custom parser if provided
      if (parseAuthResponse) {
        const parsed = parseAuthResponse(json);
        if (parsed.success) {
          if (parsed.user) {
            await mutate(parsed.user, false);
            onLogin?.(parsed.user);
          } else {
            // No user data, revalidate from /me endpoint
            await mutate();
          }
          return { success: true, user: parsed.user ?? undefined, message: parsed.message };
        }
        return {
          success: false,
          message: parsed.message || 'Login failed',
          errors: parsed.errors,
        };
      }

      // Default behavior: check res.ok and json.success
      const apiResponse = json as ApiResponse;
      if (res.ok && apiResponse.success !== false) {
        // Try to extract user data using parseResponse
        const userData = parseResponse(json);
        if (userData) {
          await mutate(userData, false);
          onLogin?.(userData);
        } else {
          // No user data in response, revalidate from /me endpoint
          await mutate();
        }
        return { success: true, user: userData ?? undefined, message: apiResponse.message };
      }

      return {
        success: false,
        message: apiResponse.message || 'Login failed',
        errors: apiResponse.errors,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Login failed');
      onError?.(error);
      return { success: false, message: error.message };
    }
  }, [loginEndpoint, mutate, onLogin, onError, parseResponse, parseAuthResponse]);

  // Register function
  const register = useCallback(async (data: RegisterData): Promise<AuthResult<TUser>> => {
    try {
      const res = await fetch(registerEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      // Use custom parser if provided
      if (parseAuthResponse) {
        const parsed = parseAuthResponse(json);
        if (parsed.success) {
          if (parsed.user) {
            await mutate(parsed.user, false);
            onLogin?.(parsed.user);
          } else {
            // No user data, revalidate from /me endpoint
            await mutate();
          }
          return { success: true, user: parsed.user ?? undefined, message: parsed.message };
        }
        return {
          success: false,
          message: parsed.message || 'Registration failed',
          errors: parsed.errors,
        };
      }

      // Default behavior: check res.ok and json.success
      const apiResponse = json as ApiResponse;
      if (res.ok && apiResponse.success !== false) {
        // Try to extract user data using parseResponse
        const userData = parseResponse(json);
        if (userData) {
          await mutate(userData, false);
          onLogin?.(userData);
        } else {
          // No user data in response, revalidate from /me endpoint
          await mutate();
        }
        return { success: true, user: userData ?? undefined, message: apiResponse.message };
      }

      return {
        success: false,
        message: apiResponse.message || 'Registration failed',
        errors: apiResponse.errors,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Registration failed');
      onError?.(error);
      return { success: false, message: error.message };
    }
  }, [registerEndpoint, mutate, onLogin, onError, parseResponse, parseAuthResponse]);

  // Logout function
  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch(logoutEndpoint, { method: 'POST' });
      await mutate(null, false);
      onLogout?.();
      
      // Redirect after logout if configured
      if (logoutRedirect && typeof window !== 'undefined') {
        window.location.href = logoutRedirect;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Logout failed');
      onError?.(error);
      throw error;
    }
  }, [logoutEndpoint, logoutRedirect, mutate, onLogout, onError]);

  // Refresh user data
  const refresh = useCallback(async (): Promise<void> => {
    await mutate();
  }, [mutate]);

  // Compute derived state using custom isGuestFn
  const isGuest = isGuestFn(user ?? null);
  const isAuthenticated = !!user && !isGuest;

  // Memoize context value
  const contextValue = useMemo<AuthContextValue<TUser>>(() => ({
    user: user ?? null,
    isLoading,
    isAuthenticated,
    isGuest,
    error: error ?? null,
    login,
    register,
    logout,
    refresh,
    mutate: refresh,
  }), [user, isLoading, isAuthenticated, isGuest, error, login, register, logout, refresh]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
