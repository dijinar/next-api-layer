/**
 * Proxy Handlers
 * Request handling logic for different scenarios
 */

import { NextRequest, NextResponse } from 'next/server';
import type { InternalProxyConfig, TokenInfo } from '../shared/types';
import { HEADERS, TOKEN_TYPES } from '../shared/constants';
import type { TokenValidation } from './tokenValidation';

/**
 * Extracts locale from pathname based on i18n config
 * e.g., /en/dashboard → 'en', /dashboard → defaultLocale or null
 */
export function extractLocale(pathname: string, i18n?: InternalProxyConfig['i18n']): string | null {
  if (!i18n?.enabled) return null;
  
  const locales = i18n.locales ?? [];
  const defaultLocale = i18n.defaultLocale;
  
  // Extract first path segment
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];
  
  // Check if it's a valid locale
  if (firstSegment && locales.includes(firstSegment)) {
    return firstSegment;
  }
  
  // Return default locale if provided
  return defaultLocale ?? null;
}

/**
 * Strips locale prefix from pathname for route matching
 * e.g., /tr/giris → /giris, /en/dashboard → /dashboard
 */
export function stripLocale(pathname: string, i18n?: InternalProxyConfig['i18n']): string {
  if (!i18n?.enabled) return pathname;
  
  const locales = i18n.locales ?? [];
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];
  
  // If first segment is a valid locale, strip it
  if (firstSegment && locales.includes(firstSegment)) {
    const strippedPath = '/' + segments.slice(1).join('/');
    return strippedPath || '/';
  }
  
  return pathname;
}

/**
 * Creates proxy handlers
 */
export function createHandlers(
  config: InternalProxyConfig,
  validation: TokenValidation
) {
  const { cookies, guestToken, access, i18n, _resolved } = config;
  const { cookieOptions } = _resolved;

  /**
   * Safely deletes a cookie only if it exists in the request.
   * Prevents empty-value cookies from being created when deleting non-existent cookies.
   */
  function safeDeleteCookie(req: NextRequest, response: NextResponse, cookieName: string): void {
    if (req.cookies.get(cookieName)?.value) {
      response.cookies.delete(cookieName);
    }
  }

  /**
   * Deletes all auth cookies from response (only if they exist)
   */
  function deleteAllAuthCookies(req: NextRequest, response: NextResponse): NextResponse {
    safeDeleteCookie(req, response, cookies.guest);
    safeDeleteCookie(req, response, cookies.user);
    return response;
  }

  /**
   * Creates a JSON error response
   */
  function jsonError(message: string, status = 500): NextResponse {
    return new NextResponse(
      JSON.stringify({ success: false, message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Checks if pathname is an auth page
   */
  function isAuthPage(pathname: string): boolean {
    const cleanPath = stripLocale(pathname, i18n);
    const authRoutes = access?.authRoutes ?? [];
    return authRoutes.some(route => 
      cleanPath === route || cleanPath.startsWith(`${route}/`)
    );
  }

  /**
   * Checks if pathname is a protected route
   */
  function isProtectedRoute(pathname: string): boolean {
    const cleanPath = stripLocale(pathname, i18n);
    
    // If protectedByDefault is true, everything is protected except public/auth routes
    if (access?.protectedByDefault) {
      return !isPublicRoute(pathname) && !isAuthPage(pathname);
    }
    
    const protectedRoutes = access?.protectedRoutes ?? [];
    return protectedRoutes.some(route => 
      cleanPath === route || cleanPath.startsWith(`${route}/`)
    );
  }

  /**
   * Checks if pathname is explicitly public
   */
  function isPublicRoute(pathname: string): boolean {
    const cleanPath = stripLocale(pathname, i18n);
    const publicRoutes = access?.publicRoutes ?? [];
    return publicRoutes.some(route => 
      cleanPath === route || cleanPath.startsWith(`${route}/`)
    );
  }

  /**
   * Checks if token type is allowed
   */
  function isTokenTypeAllowed(tokenType: string | null): boolean {
    const allowedTypes = access?.allowedTokenTypes;
    
    // If no restriction, all types allowed
    if (!allowedTypes || allowedTypes.length === 0) {
      return true;
    }
    
    return tokenType ? allowedTypes.includes(tokenType) : false;
  }

  /**
   * Handles request when no token is present
   */
  async function handleNoToken(
    req: NextRequest,
    isApiRoute: boolean
  ): Promise<NextResponse> {
    const { origin } = req.nextUrl;
    
    // Try to create guest token
    if (guestToken?.enabled) {
      const guestAccessToken = await validation.createGuestToken();
      
      if (guestAccessToken) {
        let response: NextResponse;
        
        if (isApiRoute) {
          response = NextResponse.next();
        } else if (isProtectedRoute(req.nextUrl.pathname)) {
          // Redirect to login if protected route
          response = NextResponse.redirect(new URL('/login', origin));
        } else {
          response = NextResponse.next();
        }
        
        response.cookies.set(cookies.guest, guestAccessToken, {
          ...cookieOptions,
          maxAge: 3600, // 1 hour default for guest tokens
        });
        
        return response;
      }
    }
    
    // No guest token - just continue or redirect
    if (isApiRoute) {
      return jsonError('Token bulunamadı', 401);
    }
    
    if (isProtectedRoute(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/login', origin));
    }
    
    return NextResponse.next();
  }

  /**
   * Handles token validation result
   */
  async function handleValidationResult(
    req: NextRequest,
    tokenInfo: TokenInfo,
    isUserToken: boolean,
    currentToken: string,
    isApiRoute: boolean
  ): Promise<NextResponse> {
    const { pathname, origin } = req.nextUrl;
    const { isValid, tokenType, userData } = tokenInfo;
    const isGuest = tokenType === TOKEN_TYPES.GUEST;

    // ===== TOKEN INVALID =====
    if (!isValid) {
      // Try refresh if user token
      if (isUserToken && currentToken) {
        const refreshResult = await validation.refreshToken(currentToken);
        
        if (refreshResult.success && refreshResult.newToken) {
          const newTokenInfo = await validation.getTokenInfo(refreshResult.newToken);
          
          if (newTokenInfo.isValid) {
            // Successful refresh
            const requestHeaders = new Headers(req.headers);
            
            if (newTokenInfo.userData) {
              // Base64 encode to handle non-ASCII characters (Turkish, etc.) in HTTP headers
              requestHeaders.set(HEADERS.AUTH_USER, Buffer.from(JSON.stringify(newTokenInfo.userData)).toString('base64'));
            }
            requestHeaders.set(HEADERS.REFRESHED_TOKEN, refreshResult.newToken);
            
            // Set locale header if i18n is enabled
            const locale = extractLocale(pathname, i18n);
            if (locale) {
              requestHeaders.set(HEADERS.LOCALE, locale);
            }

            let response: NextResponse;
            
            if (isAuthPage(pathname)) {
              response = NextResponse.redirect(new URL('/', origin));
            } else {
              response = NextResponse.next({ request: { headers: requestHeaders } });
            }

            response.cookies.set(cookies.user, refreshResult.newToken, {
              ...cookieOptions,
              maxAge: cookieOptions.maxAge,
            });
            safeDeleteCookie(req, response, cookies.guest);

            return response;
          }
        }
      }

      // Refresh failed or no user token - handle as no token
      const response = await handleNoToken(req, isApiRoute);
      
      // Check if handleNoToken created a new guest token
      const hasNewGuestToken = response.cookies.get(cookies.guest)?.value;
      
      if (!hasNewGuestToken) {
        // No new guest token created - delete all auth cookies
        deleteAllAuthCookies(req, response);
      } else {
        // New guest token created - only delete the invalid user cookie
        safeDeleteCookie(req, response, cookies.user);
      }
      
      return response;
    }

    // ===== TOKEN VALID =====
    const requestHeaders = new Headers(req.headers);
    
    if (userData) {
      // Base64 encode to handle non-ASCII characters (Turkish, etc.) in HTTP headers
      requestHeaders.set(HEADERS.AUTH_USER, Buffer.from(JSON.stringify(userData)).toString('base64'));
    }
    
    // Set locale header if i18n is enabled
    const locale = extractLocale(pathname, i18n);
    if (locale) {
      requestHeaders.set(HEADERS.LOCALE, locale);
    }

    // Check if token type is allowed
    if (!isGuest && !isTokenTypeAllowed(tokenType)) {
      if (isApiRoute) {
        const response = jsonError('Bu işlem için yetkiniz yok', 403);
        return deleteAllAuthCookies(req, response);
      }
      
      const response = NextResponse.redirect(new URL('/login', origin));
      return deleteAllAuthCookies(req, response);
    }

    // Guest token handling
    if (isGuest) {
      if (isApiRoute) {
        return NextResponse.next({ request: { headers: requestHeaders } });
      }

      // Protected routes require login
      if (isProtectedRoute(pathname)) {
        return NextResponse.redirect(new URL('/login', origin));
      }

      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // User token - block auth pages
    if (isAuthPage(pathname)) {
      return NextResponse.redirect(new URL('/', origin));
    }

    // Normal access
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    safeDeleteCookie(req, response, cookies.guest);
    
    return response;
  }

  return {
    deleteAllAuthCookies,
    jsonError,
    isAuthPage,
    isProtectedRoute,
    isPublicRoute,
    isTokenTypeAllowed,
    handleNoToken,
    handleValidationResult,
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
