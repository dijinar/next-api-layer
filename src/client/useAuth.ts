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

import { useContext, useEffect } from 'react';
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

  const isLoading = context.isLoading;
  const isAuthenticated = context.isAuthenticated;
  const isGuest = context.isGuest;

  // Handle redirects based on auth state.
  // Navigation is a side effect and must run after commit, never during render,
  // otherwise React throws "Cannot update a component while rendering a different component".
  useEffect(() => {
    if (isLoading) return;

    if (redirectTo && !isAuthenticated && !isGuest) {
      router.replace(redirectTo);
    } else if (redirectIfFound && isAuthenticated) {
      router.replace(redirectIfFound);
    }
  }, [isLoading, isAuthenticated, isGuest, redirectTo, redirectIfFound, router]);

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
 * Hook for protected pages - redirects to `redirectTo` if not authenticated.
 *
 * The redirect is performed as an effect (after commit). Consumers should still
 * guard their UI on `isLoading` / `isAuthenticated` while the redirect settles.
 *
 * @typeParam TUser - User data type
 */
export function useRequireAuth<TUser = DefaultUserData>(redirectTo = '/login') {
  return useAuth<TUser>({ redirectTo });
}

/**
 * Hook for auth pages - redirects if already authenticated
 * 
 * @typeParam TUser - User data type
 */
export function useRedirectIfAuth<TUser = DefaultUserData>(redirectTo = '/') {
  return useAuth<TUser>({ redirectIfFound: redirectTo });
}
