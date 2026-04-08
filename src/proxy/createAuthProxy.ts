/**
 * createAuthProxy
 * Factory function to create Next.js middleware for external JWT authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import type { AuthProxyConfig, AuthResult } from '../shared/types';
import { resolveProxyConfig } from '../shared/config';
import { createTokenValidation } from './tokenValidation';
import { createHandlers } from './handlers';
import { createCsrfValidator } from './csrf';
import { createRateLimiter } from './rateLimit';
import { createAuditLogger } from './audit';
import { HEADERS } from '../shared/constants';

/**
 * Merge two NextResponse objects, preserving headers and cookies from both
 * Target response takes priority for conflicts
 */
function mergeResponses(source: NextResponse, target: NextResponse): NextResponse {
  // Copy critical headers from source to target (if not already set)
  const criticalHeaders = [HEADERS.LOCALE, HEADERS.AUTH_USER, HEADERS.REFRESHED_TOKEN];
  
  for (const header of criticalHeaders) {
    const value = source.headers.get(header);
    if (value && !target.headers.has(header)) {
      target.headers.set(header, value);
    }
  }
  
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
    // Check early to protect against DoS
    if (config._resolved.rateLimit.enabled) {
      const rateLimitResult = rateLimiter.check(req);
      
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
      const csrfResult = csrf.validateRequest(req);
      
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
      return applyMiddlewaresAndHooks(req, NextResponse.next(), { isAuthenticated: false, isGuest: false, tokenType: null, user: null });
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
      return applyMiddlewaresAndHooks(req, NextResponse.next(), { isAuthenticated: false, isGuest: false, tokenType: null, user: null });
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

    // Apply rate limit headers
    if (config._resolved.rateLimit.enabled) {
      const rateLimitResult = rateLimiter.check(req);
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
      // Merge library's response headers into i18n response
      finalResponse = mergeResponses(response, intlResponse);
    }
    
    // Apply afterAuth hook if configured
    if (config.afterAuth) {
      const hookResponse = await config.afterAuth(req, finalResponse, authResult);
      // Merge previous response headers into hook's response
      finalResponse = mergeResponses(finalResponse, hookResponse);
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

