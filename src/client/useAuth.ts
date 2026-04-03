'use client';

/**
 * useAuth Hook - Generic for any user type
 * 
 * @example Basic usage
 * ```tsx
 * const { user, isAuthenticated, logout } = useAuth();
 * ```
 * 
 * @example With custom type
 * ```tsx
 * interface MyUser {
 *   type: 'guest' | 'superadmin';
 *   user?: { name: string; };
 * }
 * 
 * const { user } = useAuth<MyUser>();
 * // user is MyUser | null
 * ```
 */

import { useContext } from 'react';
import { useRouter } from 'next/navigation';
import { AuthContext } from './AuthProvider';
import type { AuthContextValue, UseAuthOptions, DefaultUserData } from './types';

/**
 * Hook to access authentication state and methods
 * 
 * @typeParam TUser - User data type (defaults to DefaultUserData)
 */
export function useAuth<TUser = DefaultUserData>(
  options: UseAuthOptions = {}
): AuthContextValue<TUser> {
  const context = useContext(AuthContext) as AuthContextValue<TUser> | undefined;
  const router = useRouter();

  if (!context) {
    throw new Error(
      'useAuth must be used within an AuthProvider. ' +
      'Wrap your app with <AuthProvider> from next-api-layer/client'
    );
  }

  const { redirectTo, redirectIfFound } = options;

  // Handle redirects based on auth state
  if (!context.isLoading) {
    if (redirectTo && !context.isAuthenticated && !context.isGuest) {
      if (typeof window !== 'undefined') {
        router.replace(redirectTo);
      }
    }

    if (redirectIfFound && context.isAuthenticated) {
      if (typeof window !== 'undefined') {
        router.replace(redirectIfFound);
      }
    }
  }

  return context;
}

/**
 * Hook to get only the user object
 * 
 * @typeParam TUser - User data type
 */
export function useUser<TUser = DefaultUserData>() {
  const { user, isLoading, isAuthenticated, isGuest } = useAuth<TUser>();
  return { user, isLoading, isAuthenticated, isGuest };
}

/**
 * Hook for protected pages - redirects if not authenticated
 * 
 * @typeParam TUser - User data type
 */
export function useRequireAuth<TUser = DefaultUserData>(redirectTo = '/login') {
  const auth = useAuth<TUser>({ redirectTo });
  
  if (!auth.isLoading && !auth.isAuthenticated) {
    throw new Error('Authentication required');
  }
  
  return auth;
}

/**
 * Hook for auth pages - redirects if already authenticated
 * 
 * @typeParam TUser - User data type
 */
export function useRedirectIfAuth<TUser = DefaultUserData>(redirectTo = '/') {
  return useAuth<TUser>({ redirectIfFound: redirectTo });
}
