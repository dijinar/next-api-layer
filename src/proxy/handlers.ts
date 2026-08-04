/**
 * Proxy Handlers
 * Request handling logic for different scenarios
 */

import { NextRequest, NextResponse } from 'next/server';
import type { InternalProxyConfig, TokenInfo, RefreshFailReason } from '../shared/types';
import { HEADERS, TOKEN_TYPES } from '../shared/constants';
import type { TokenValidation, RefreshOutcome } from './tokenValidation';
import type { AuditLogger } from './audit';

/**
 * Library-internal request headers that downstream Server Components / route
 * handlers trust because the middleware sets them *after* validating the token
 * (e.g. `getServerUser` reads `x-auth-user`, `createApiClient` reads
 * `x-refreshed-token`). Any value present on the *incoming* request is
 * attacker-controlled and MUST be removed before the request is forwarded,
 * otherwise a caller could forge these headers and impersonate any user.
 */
const INTERNAL_REQUEST_HEADERS = [
  HEADERS.AUTH_USER,
  HEADERS.REFRESHED_TOKEN,
  HEADERS.LOCALE,
] as const;

/**
 * Returns a copy of the incoming request headers with every library-internal
 * header removed, so forged values can never reach downstream code.
 */
export function sanitizeRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  for (const name of INTERNAL_REQUEST_HEADERS) {
    headers.delete(name);
  }
  return headers;
}

/**
 * Drop-in replacement for a bare `NextResponse.next()` that forwards request
 * headers stripped of any client-supplied internal headers. Use this on every
 * pass-through path so untrusted `x-auth-user` / `x-refreshed-token` values are
 * never propagated.
 */
export function nextWithSanitizedHeaders(req: NextRequest): NextResponse {
  return NextResponse.next({ request: { headers: sanitizeRequestHeaders(req) } });
}

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
 * e.g., /fr/login → /login, /en/dashboard → /dashboard
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
  validation: TokenValidation,
  audit?: Pick<AuditLogger, 'authRefreshFail' | 'authReuse'>
) {
  const { cookies, guestToken, access, i18n, _resolved } = config;
  const { cookieOptions, refreshCookieOptions, dualToken, refresh: refreshCfg } = _resolved;

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
    if (dualToken && cookies.refresh) {
      safeDeleteCookie(req, response, cookies.refresh);
    }
    return response;
  }

  /**
   * Resolves the credential to send to the refresh endpoint: the dedicated
   * refresh cookie in dual-token mode, otherwise the current access token.
   */
  function getRefreshCredential(req: NextRequest, currentToken: string): string | undefined {
    if (dualToken) {
      return cookies.refresh ? req.cookies.get(cookies.refresh)?.value : undefined;
    }
    return currentToken;
  }

  /**
   * Fires the refresh-failure telemetry (audit + user `onRefreshFail` hook).
   * A `reuse` reason is logged as a distinct security event.
   */
  async function emitRefreshFail(req: NextRequest, reason: RefreshFailReason): Promise<void> {
    if (reason === 'reuse') {
      await audit?.authReuse(req, { reason });
    } else {
      await audit?.authRefreshFail(req, { reason });
    }
    if (refreshCfg.onRefreshFail) {
      try {
        await refreshCfg.onRefreshFail(reason, req);
      } catch {
        // Never let a telemetry hook break the request flow.
      }
    }
  }

  /**
   * Fail-closed terminal response after a user-token refresh failure: clears
   * every auth cookie and redirects to login (or 401 for API routes). Never
   * downgrades to a guest token.
   */
  function terminalLogout(req: NextRequest, isApiRoute: boolean): NextResponse {
    if (isApiRoute) {
      const response = jsonError('Session expired', 401);
      return deleteAllAuthCookies(req, response);
    }
    const response = NextResponse.redirect(new URL('/login', req.nextUrl.origin));
    return deleteAllAuthCookies(req, response);
  }

  /**
   * Builds the forwarded response for a successfully (re)issued token: sets the
   * verified `x-auth-user` / `x-refreshed-token` request headers, persists the
   * new access cookie (and rotated refresh cookie in dual-token mode), and
   * clears the guest cookie.
   */
  function buildRefreshedResponse(
    req: NextRequest,
    outcome: RefreshOutcome,
    pathname: string
  ): NextResponse {
    // Start from sanitized headers so any forged internal header is dropped
    // before we set the verified values below.
    const requestHeaders = sanitizeRequestHeaders(req);

    if (outcome.tokenInfo?.userData) {
      requestHeaders.set(
        HEADERS.AUTH_USER,
        Buffer.from(JSON.stringify(outcome.tokenInfo.userData)).toString('base64')
      );
    }
    requestHeaders.set(HEADERS.REFRESHED_TOKEN, outcome.newToken as string);

    const locale = extractLocale(pathname, i18n);
    if (locale) {
      requestHeaders.set(HEADERS.LOCALE, locale);
    }

    const response = isAuthPage(pathname)
      ? NextResponse.redirect(new URL('/', req.nextUrl.origin))
      : NextResponse.next({ request: { headers: requestHeaders } });

    response.cookies.set(cookies.user, outcome.newToken as string, {
      ...cookieOptions,
      maxAge: cookieOptions.maxAge,
    });

    // Persist a rotated refresh token (dual-token mode).
    if (dualToken && cookies.refresh && outcome.newRefreshToken) {
      response.cookies.set(cookies.refresh, outcome.newRefreshToken, {
        ...refreshCookieOptions,
      });
    }

    safeDeleteCookie(req, response, cookies.guest);
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
          // Forward the freshly minted token on this same request, otherwise the
          // downstream handler only sees it from the next request onwards.
          const requestHeaders = sanitizeRequestHeaders(req);
          requestHeaders.set(HEADERS.REFRESHED_TOKEN, guestAccessToken);
          response = NextResponse.next({ request: { headers: requestHeaders } });
        } else if (isProtectedRoute(req.nextUrl.pathname)) {
          // Redirect to login if protected route
          response = NextResponse.redirect(new URL('/login', origin));
        } else {
          response = nextWithSanitizedHeaders(req);
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
      return jsonError('Token not found', 401);
    }
    
    if (isProtectedRoute(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/login', origin));
    }
    
    return nextWithSanitizedHeaders(req);
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
      // Try refresh if user token (single-flight coalesced).
      const refreshCredential = getRefreshCredential(req, currentToken);
      if (isUserToken && refreshCredential) {
        const outcome = await validation.refreshSession(refreshCredential);

        if (outcome.success && outcome.newToken && outcome.tokenInfo?.isValid) {
          return buildRefreshedResponse(req, outcome, pathname);
        }

        // Refresh failed → telemetry + fail-closed decision.
        const reason = outcome.reason ?? 'unknown';
        await emitRefreshFail(req, reason);

        // Detected token reuse (RFC 9700) or an explicit no-guest policy must
        // never silently downgrade to a guest session.
        const denyGuestFallback =
          reason === 'reuse' || access?.guestFallbackOnUserRefreshFail === false;
        if (denyGuestFallback) {
          return terminalLogout(req, isApiRoute);
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
    // Start from sanitized headers so a forged x-auth-user can never survive,
    // even when the validated token carries no userData (set below).
    const requestHeaders = sanitizeRequestHeaders(req);
    
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
        const response = jsonError('You are not authorized for this action', 403);
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

    // ===== Proactive (pre-expiry) refresh =====
    // Renew before the access token expires to avoid a guaranteed 401 + race
    // on the next cycle. Best-effort: if it fails the current token is still
    // valid, so we fall through — except on detected reuse, which is terminal.
    if (refreshCfg.proactive && isUserToken && typeof tokenInfo.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (tokenInfo.exp - now <= refreshCfg.proactiveWindow) {
        const refreshCredential = getRefreshCredential(req, currentToken);
        if (refreshCredential) {
          const outcome = await validation.refreshSession(refreshCredential);
          if (outcome.success && outcome.newToken && outcome.tokenInfo?.isValid) {
            return buildRefreshedResponse(req, outcome, pathname);
          }
          if (outcome.reason === 'reuse') {
            await emitRefreshFail(req, 'reuse');
            return terminalLogout(req, isApiRoute);
          }
        }
      }
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
