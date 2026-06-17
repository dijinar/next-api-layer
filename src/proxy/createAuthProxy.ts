/**
 * createAuthProxy
 * Factory function to create Next.js middleware for external JWT authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import type { AuthProxyConfig, AuthResult } from '../shared/types';
import { resolveProxyConfig } from '../shared/config';
import { createTokenValidation } from './tokenValidation';
import { createHandlers, extractLocale, nextWithSanitizedHeaders } from './handlers';
import { createCsrfValidator } from './csrf';
import { createRateLimiter } from './rateLimit';
import type { RateLimitResult } from './rateLimit';
import { createAuditLogger } from './audit';
import { HEADERS } from '../shared/constants';

// Next.js encodes request-header overrides (set via
// `NextResponse.next({ request: { headers } })`) as these response headers.
const MIDDLEWARE_OVERRIDE_KEY = 'x-middleware-override-headers';
const MIDDLEWARE_REQUEST_PREFIX = 'x-middleware-request-';

// Library-internal request headers (lower-cased) that downstream code trusts.
const INTERNAL_OVERRIDE_HEADERS = [
  HEADERS.AUTH_USER,
  HEADERS.REFRESHED_TOKEN,
  HEADERS.LOCALE,
].map(h => h.toLowerCase());

/**
 * Whether a response forwards the incoming request to the app
 * (`NextResponse.next()` / `NextResponse.rewrite()`), as opposed to a terminal
 * response (redirect / JSON / error) that ends the request-response cycle.
 */
function isForwardingResponse(res: NextResponse): boolean {
  return (
    res.headers.has('x-middleware-next') ||
    res.headers.has('x-middleware-rewrite')
  );
}

/**
 * Keeps the auth middleware authoritative over the library-internal request
 * headers (`x-auth-user` / `x-refreshed-token` / `x-locale`) when our response
 * is swapped out by a third-party one (i18n middleware / afterAuth hook).
 *
 * Next only rewrites the downstream request headers when a response carries an
 * `x-middleware-override-headers` list — and then that list is authoritative
 * (any original header NOT in it is dropped). Two cases must be handled so a
 * forged internal header can never reach `getServerUser` / `createApiClient`:
 *
 *  - target forwards WITH an override list (e.g. next-intl `next({ request })`):
 *    reconcile the list so our sanitized/verified internal headers win.
 *  - target forwards WITHOUT an override list (plain `next()` / `rewrite()`):
 *    Next would pass the ORIGINAL request headers through verbatim, so we seed
 *    a list from the incoming request and then strip the internal headers.
 *
 * Non-forwarding responses (redirect / JSON / terminal) never propagate request
 * headers to the app, so they are a safe no-op.
 */
function preserveRequestOverrides(
  req: NextRequest,
  source: NextResponse,
  target: NextResponse
): void {
  // Only `next()` / `rewrite()` responses forward the request to the app.
  if (!isForwardingResponse(target)) return;

  const sourceList = source.headers.get(MIDDLEWARE_OVERRIDE_KEY);
  const sourceNames = new Set(
    (sourceList ? sourceList.split(',') : [])
      .map(n => n.trim().toLowerCase())
      .filter(Boolean)
  );

  let targetList = target.headers.get(MIDDLEWARE_OVERRIDE_KEY);

  // Target forwards but carries no override list → Next would forward the
  // ORIGINAL request headers (including a forged internal header) untouched.
  // Seed the full original header set so the non-internal headers stay
  // byte-for-byte identical to the pass-through behaviour while the internal
  // ones become ours to strip below.
  if (!targetList) {
    const seeded: string[] = [];
    for (const [name, value] of req.headers) {
      const lower = name.toLowerCase();
      target.headers.set(`${MIDDLEWARE_REQUEST_PREFIX}${lower}`, value);
      seeded.push(lower);
    }
    targetList = seeded.join(',');
  }

  const targetNames = new Set(
    targetList.split(',').map(n => n.trim().toLowerCase()).filter(Boolean)
  );

  // 1. Bring over request headers the source overrode but the target did not.
  for (const name of sourceNames) {
    if (targetNames.has(name)) continue;
    const value = source.headers.get(`${MIDDLEWARE_REQUEST_PREFIX}${name}`);
    if (value === null) continue;
    target.headers.set(`${MIDDLEWARE_REQUEST_PREFIX}${name}`, value);
    targetNames.add(name);
  }

  // 2. For internal headers the source is authoritative: its sanitized value
  //    (or deliberate removal) MUST win over whatever the third-party response
  //    copied from the original — otherwise a forged value could resurface.
  for (const header of INTERNAL_OVERRIDE_HEADERS) {
    const requestKey = `${MIDDLEWARE_REQUEST_PREFIX}${header}`;
    if (sourceNames.has(header)) {
      const value = source.headers.get(requestKey);
      if (value !== null) {
        target.headers.set(requestKey, value);
        targetNames.add(header);
      }
    } else {
      // Strip it: KEEP the name in the override list but drop its
      // `x-middleware-request-*` value. Next then forces the downstream header
      // to `undefined` (removes it). Dropping it from the list instead would,
      // once the list is empty, make Next fall back to forwarding the ORIGINAL
      // request headers verbatim — resurrecting the forged value. Keeping it
      // listed-but-valueless guarantees the strip in every case.
      target.headers.delete(requestKey);
      targetNames.add(header);
    }
  }

  if (targetNames.size > 0) {
    target.headers.set(MIDDLEWARE_OVERRIDE_KEY, Array.from(targetNames).join(','));
  } else {
    target.headers.delete(MIDDLEWARE_OVERRIDE_KEY);
  }
}

/**
 * Merge two NextResponse objects, preserving headers and cookies from both.
 * Target response takes priority for conflicts.
 *
 * When `options.sourceWinsIfTerminal` is set, a terminal `source` (a redirect
 * or JSON/error response that does NOT forward the request) is treated as an
 * authoritative routing decision and is returned as-is — a third-party forward
 * / rewrite (the i18n middleware) must never replace it, otherwise a protected
 * page could still be served despite our auth redirect (auth bypass).
 */
function mergeResponses(
  req: NextRequest,
  source: NextResponse,
  target: NextResponse,
  options: { sourceWinsIfTerminal?: boolean } = {}
): NextResponse {
  // Our terminal auth/routing decision wins: keep it, but carry over the other
  // side's cookies (e.g. `NEXT_LOCALE`) so locale state survives the redirect.
  if (options.sourceWinsIfTerminal && !isForwardingResponse(source)) {
    target.cookies.getAll().forEach(cookie => {
      if (!source.cookies.get(cookie.name)) {
        source.cookies.set(cookie.name, cookie.value);
      }
    });
    return source;
  }

  // Copy critical headers from source to target (if not already set)
  const criticalHeaders = [HEADERS.LOCALE, HEADERS.AUTH_USER, HEADERS.REFRESHED_TOKEN];
  
  for (const header of criticalHeaders) {
    const value = source.headers.get(header);
    if (value && !target.headers.has(header)) {
      target.headers.set(header, value);
    }
  }

  // Keep the sanitized/verified request-header override authoritative so a
  // forged x-auth-user can't survive when the response is swapped out.
  preserveRequestOverrides(req, source, target);
  
  // Copy cookies from source to target (if not already set)
  source.cookies.getAll().forEach(cookie => {
    if (!target.cookies.get(cookie.name)) {
      target.cookies.set(cookie.name, cookie.value);
    }
  });
  
  return target;
}

/**
 * Creates an authentication proxy middleware for Next.js
 * 
 * @example
 * ```ts
 * // middleware.ts
 * import { createAuthProxy } from 'next-api-layer';
 * 
 * const authProxy = createAuthProxy({
 *   apiBaseUrl: process.env.API_BASE_URL!,
 *   cookies: {
 *     user: 'userAuthToken',
 *     guest: 'guestAuthToken',
 *   },
 *   guestToken: {
 *     enabled: true,
 *     credentials: {
 *       username: process.env.GUEST_USERNAME!,
 *       password: process.env.GUEST_PASSWORD!,
 *     },
 *   },
 *   access: {
 *     protectedRoutes: ['/dashboard', '/profile'],
 *     authRoutes: ['/login', '/register'],
 *   },
 *   // Security features
 *   csrf: { enabled: true },
 *   rateLimit: { enabled: true, maxRequests: 100 },
 *   audit: { 
 *     enabled: true, 
 *     logger: (event) => console.log('[AUDIT]', event) 
 *   },
 * });
 * 
 * export default authProxy;
 * 
 * export const config = {
 *   matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
 * };
 * ```
 */
export function createAuthProxy(userConfig: AuthProxyConfig) {
  // Resolve config with defaults
  const config = resolveProxyConfig(userConfig);
  
  // Create validation functions
  const validation = createTokenValidation(config);
  
  // Create handlers
  const handlers = createHandlers(config, validation);

  // Create security modules
  const csrf = createCsrfValidator(config._resolved.csrf);
  const rateLimiter = createRateLimiter(config._resolved.rateLimit);
  const audit = createAuditLogger(config._resolved.audit);

  /**
   * The middleware function
   */
  async function authProxy(req: NextRequest): Promise<NextResponse> {
    const { pathname, origin } = req.nextUrl;
    const isApiRoute = pathname.startsWith('/api');

    // ============ Rate Limiting ============
    // Check early to protect against DoS.
    // The result is captured once and reused when applying response headers
    // below, so a single request is only counted a single time.
    let rateLimitResult: RateLimitResult | undefined;
    if (config._resolved.rateLimit.enabled) {
      rateLimitResult = rateLimiter.check(req);
      
      if (!rateLimitResult.allowed) {
        await audit.rateLimitExceeded(req, { 
          limit: rateLimitResult.limit,
          resetAt: rateLimitResult.resetAt,
        });
        return rateLimiter.createLimitedResponse(req, rateLimitResult);
      }
    }

    // ============ CSRF Protection ============
    // Check before any state-changing operations
    if (config._resolved.csrf.enabled) {
      const csrfResult = await csrf.validateRequest(req);
      
      if (!csrfResult.valid) {
        await audit.csrfFail(req, { reason: csrfResult.reason });
        return NextResponse.json(
          { success: false, message: 'CSRF validation failed' },
          { status: 403 }
        );
      }
    }

    // ============ Block Browser API Access ============
    // Prevents direct browser access to API routes (when Accept: text/html)
    if (config.blockBrowserApiAccess && isApiRoute) {
      const acceptHeader = req.headers.get('accept') || '';
      if (acceptHeader.includes('text/html')) {
        return NextResponse.redirect(new URL('/', origin));
      }
    }

    // ============ beforeAuth Hook ============
    // Allows user to handle request before auth validation
    if (config.beforeAuth) {
      const beforeResult = await config.beforeAuth(req);
      if (beforeResult) {
        return beforeResult; // User handled the request
      }
    }

    // Skip excluded paths
    const excludedPaths = config.excludedPaths ?? [];
    if (excludedPaths.some(path => pathname.startsWith(path))) {
      return applyMiddlewaresAndHooks(req, nextWithSanitizedHeaders(req), { isAuthenticated: false, isGuest: false, tokenType: null, user: null });
    }

    // Skip auth API endpoints (they handle their own auth)
    const authApiPaths = [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/register',
    ];
    
    if (authApiPaths.includes(pathname)) {
      return applyMiddlewaresAndHooks(req, nextWithSanitizedHeaders(req), { isAuthenticated: false, isGuest: false, tokenType: null, user: null });
    }

    // Get tokens from cookies
    const userToken = req.cookies?.get(config.cookies.user)?.value;
    const guestToken = req.cookies?.get(config.cookies.guest)?.value;
    const currentToken = userToken || guestToken;
    const isUserToken = !!userToken;

    // No token - handle appropriately
    if (!currentToken) {
      await audit.authFail(req, { reason: 'no-token' });
      const response = await handlers.handleNoToken(req, isApiRoute);
      return applyMiddlewaresAndHooks(req, response, { isAuthenticated: false, isGuest: false, tokenType: null, user: null });
    }

    // Validate token
    const tokenInfo = await validation.getTokenInfo(currentToken);
    
    // Build auth result for afterAuth hook
    const authResult: AuthResult = {
      isAuthenticated: tokenInfo.isValid && tokenInfo.tokenType !== 'guest',
      isGuest: tokenInfo.isValid && tokenInfo.tokenType === 'guest',
      tokenType: tokenInfo.tokenType,
      user: tokenInfo.userData,
    };

    // Audit logging based on validation result  
    if (tokenInfo.isValid) {
      if (tokenInfo.tokenType === 'guest') {
        await audit.authGuest(req);
      } else {
        const userId = tokenInfo.userData?.id?.toString();
        await audit.authSuccess(req, userId, { tokenType: tokenInfo.tokenType });
      }
    } else {
      await audit.authFail(req, { reason: 'invalid-token' });
    }

    // Handle validation result
    const response = await handlers.handleValidationResult(
      req,
      tokenInfo,
      isUserToken,
      currentToken,
      isApiRoute
    );
    
    // Apply CSRF cookie if enabled (for authenticated requests)
    let finalResponse = await applyMiddlewaresAndHooks(req, response, authResult);
    
    if (config._resolved.csrf.enabled && authResult.isAuthenticated) {
      const sessionId = tokenInfo.userData?.id?.toString() || currentToken.slice(0, 32);
      finalResponse = await csrf.attachCsrfCookie(finalResponse, sessionId);
    }

    // Apply rate limit headers (reuse the count from the gate check above)
    if (config._resolved.rateLimit.enabled && rateLimitResult) {
      finalResponse = rateLimiter.applyHeaders(finalResponse, rateLimitResult);
    }
    
    return finalResponse;
  }
  
  /**
   * Helper to apply i18n middleware and afterAuth hook
   * Merges responses to preserve critical headers (x-locale, x-auth-user, etc.)
   */
  async function applyMiddlewaresAndHooks(req: NextRequest, response: NextResponse, authResult: AuthResult): Promise<NextResponse> {
    let finalResponse = response;
    
    // Apply i18n middleware if configured
    if (config.i18n?.middleware) {
      const intlResponse = await Promise.resolve(config.i18n.middleware(req));
      // Merge library's response headers into i18n response. Our own redirect /
      // terminal response stays authoritative so i18n can't forward past an
      // auth gate.
      finalResponse = mergeResponses(req, response, intlResponse, {
        sourceWinsIfTerminal: true,
      });
    }
    
    // Ensure x-locale is set as response header (not just request header)
    // This is needed because intl middleware creates a new response that loses request headers
    if (config.i18n?.enabled) {
      const locale = extractLocale(req.nextUrl.pathname, config.i18n);
      if (locale) {
        finalResponse.headers.set(HEADERS.LOCALE, locale);
      }
    }
    
    // Apply afterAuth hook if configured
    if (config.afterAuth) {
      const hookResponse = await config.afterAuth(req, finalResponse, authResult);
      // Merge previous response headers into hook's response
      finalResponse = mergeResponses(req, finalResponse, hookResponse);
    }
    
    return finalResponse;
  }

  // Attach instances for debugging/testing
  authProxy.config = config;
  authProxy.csrf = csrf;
  authProxy.rateLimiter = rateLimiter;
  authProxy.audit = audit;

  return authProxy;
}

export type AuthProxy = ReturnType<typeof createAuthProxy>;

