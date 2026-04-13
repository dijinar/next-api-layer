/**
 * Server-side utilities
 * For use in Server Components and API routes
 */

import { cookies, headers } from 'next/headers';
import { HEADERS } from '../shared/constants';

// ==================== Types ====================

export interface GetServerUserOptions<TUser = unknown> {
  /** Name of the user token cookie */
  userCookie?: string;
  /** Name of the guest token cookie */
  guestCookie?: string;
  /** Base URL for API requests (only used if header not found) */
  apiBaseUrl?: string;
  /** Endpoint to validate token (only used if header not found) */
  validateEndpoint?: string;
  /** Skip header check and always fetch from backend */
  skipHeader?: boolean;
  /**
   * Function to check if user is a guest
   * @default checks token_type === 'guest' or type === 'guest'
   */
  isGuestFn?: (user: TUser) => boolean;
  /**
   * Function to parse API response and extract user data
   * @default extracts from response.data or response.user
   */
  parseResponse?: (response: unknown) => TUser | null;
}

export interface ServerUserResult<TUser = unknown> {
  user: TUser | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  token: string | null;
}

// ==================== Default Functions ====================

/** Default guest check */
function defaultIsGuest<TUser>(user: TUser): boolean {
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;
  return u.token_type === 'guest' || u.type === 'guest';
}

/** Default response parser */
function defaultParseResponse<TUser>(response: unknown): TUser | null {
  if (!response || typeof response !== 'object') return null;
  const res = response as Record<string, unknown>;
  
  // { success: true, data: user }
  if (res.success && res.data) return res.data as TUser;
  // { user: {...} }
  if (res.user) return res.user as TUser;
  // Direct user object
  if ('id' in res || 'email' in res || 'type' in res) return res as TUser;
  
  return null;
}

// ==================== Main Function ====================

/**
 * Get user data in Server Components
 * 
 * First checks x-auth-user header (set by proxy) - NO backend call needed!
 * Falls back to backend validation only if header not found.
 * 
 * @typeParam TUser - User data type
 * 
 * @example
 * ```tsx
 * // app/layout.tsx - with SSR
 * import { getServerUser } from 'next-api-layer/server';
 * import { AuthProvider } from 'next-api-layer/client';
 * 
 * interface MyUser {
 *   type: 'guest' | 'admin';
 *   user?: { name: string; };
 * }
 * 
 * export default async function RootLayout({ children }) {
 *   const { user } = await getServerUser<MyUser>({
 *     userCookie: 'myUserToken',
 *     isGuestFn: (u) => u.type === 'guest',
 *   });
 *   
 *   return (
 *     <AuthProvider<MyUser> initialUser={user}>
 *       {children}
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
export async function getServerUser<TUser = unknown>(
  options: GetServerUserOptions<TUser> = {}
): Promise<ServerUserResult<TUser>> {
  const {
    userCookie = 'userAuthToken',
    guestCookie = 'guestAuthToken',
    apiBaseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL,
    validateEndpoint = 'auth/me',
    skipHeader = false,
    isGuestFn = defaultIsGuest,
    parseResponse = defaultParseResponse,
  } = options;

  // FAST PATH: Check x-auth-user header first (set by proxy)
  // This avoids extra backend calls - proxy already validated the token!
  if (!skipHeader) {
    try {
      const headersList = await headers();
      const userHeader = headersList.get(HEADERS.AUTH_USER);
      
      if (userHeader) {
        // Decode Base64 (proxy encodes to handle non-ASCII chars like Turkish ğ, ş, ı)
        const decodedJson = Buffer.from(userHeader, 'base64').toString('utf-8');
        const userData = JSON.parse(decodedJson) as TUser;
        const isGuest = isGuestFn(userData);
        
        // Get token from cookies for completeness
        const cookieStore = await cookies();
        const token = cookieStore.get(userCookie)?.value || cookieStore.get(guestCookie)?.value || null;
        
        return {
          user: userData,
          isAuthenticated: !isGuest,
          isGuest,
          token,
        };
      }
    } catch {
      // Header parse failed, continue to fallback
    }
  }

  // FALLBACK: Validate with backend (only if header not available)
  const cookieStore = await cookies();
  const userToken = cookieStore.get(userCookie)?.value;
  const guestToken = cookieStore.get(guestCookie)?.value;
  const token = userToken || guestToken;

  // No token - not authenticated
  if (!token) {
    return {
      user: null,
      isAuthenticated: false,
      isGuest: false,
      token: null,
    };
  }

  // Validate token with backend
  try {
    const response = await fetch(`${apiBaseUrl}/${validateEndpoint}`, {
      method: 'GET',
      headers: {
        [HEADERS.AUTHORIZATION]: `Bearer ${token}`,
        [HEADERS.CONTENT_TYPE]: 'application/json',
      },
      cache: 'no-store', // Don't cache auth requests
    });

    if (!response.ok) {
      return {
        user: null,
        isAuthenticated: false,
        isGuest: false,
        token,
      };
    }

    const data = await response.json();
    const user = parseResponse(data);

    if (user) {
      const isGuest = isGuestFn(user);

      return {
        user,
        isAuthenticated: !isGuest,
        isGuest,
        token,
      };
    }

    return {
      user: null,
      isAuthenticated: false,
      isGuest: false,
      token,
    };
  } catch {
    // Network error - return unauthenticated
    return {
      user: null,
      isAuthenticated: false,
      isGuest: false,
      token,
    };
  }
}

/**
 * Check if user is authenticated in Server Components
 * Lighter weight than getServerUser - doesn't validate with backend
 */
export async function isAuthenticatedServer(
  userCookie = 'userAuthToken'
): Promise<boolean> {
  const cookieStore = await cookies();
  return !!cookieStore.get(userCookie)?.value;
}

/**
 * Get the auth token in Server Components
 */
export async function getServerToken(
  userCookie = 'userAuthToken',
  guestCookie = 'guestAuthToken'
): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(userCookie)?.value || cookieStore.get(guestCookie)?.value || null;
}
