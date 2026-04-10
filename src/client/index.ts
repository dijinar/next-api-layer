/**
 * Client module exports
 * These require SWR as a peer dependency
 * 
 * @example
 * ```tsx
 * import { AuthProvider, useAuth } from 'next-api-layer/client';
 * 
 * // With custom user type
 * interface MyUser {
 *   type: 'guest' | 'admin';
 *   user?: { name: string; };
 * }
 * 
 * <AuthProvider<MyUser> initialUser={serverUser}>
 *   {children}
 * </AuthProvider>
 * 
 * const { user } = useAuth<MyUser>();
 * ```
 */

export { AuthProvider, AuthContext } from './AuthProvider';
export { useAuth, useUser, useRequireAuth, useRedirectIfAuth } from './useAuth';

export type {
  // Generic types
  AuthContextValue,
  AuthProviderProps,
  AuthResult,
  AuthResponseParsed,
  // Non-generic types
  LoginCredentials,
  RegisterData,
  UseAuthOptions,
  ApiResponse,
  // Base types
  DefaultUserData,
  UserData, // deprecated alias
} from './types';
