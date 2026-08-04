/**
 * Shared Types
 * Core type definitions used across the library
 */

// ==================== Cookie Types ====================

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
}

export interface CookieConfig {
  user: string;
  guest: string;
  /**
   * Optional refresh-token cookie name. Setting this enables the OAuth2-style
   * dual-token mode: a short-lived access token (`user`) plus a separate,
   * long-lived refresh token that is only sent to the refresh endpoint.
   */
  refresh?: string;
  options?: CookieOptions;
  /**
   * Cookie options for the refresh token (dual-token mode). Typically scoped
   * with a narrow `path` (e.g. `/api/auth/refresh`) and a longer `maxAge`.
   */
  refreshOptions?: CookieOptions;
}

// ==================== Token Types ====================

export interface TokenInfo {
  isValid: boolean;
  tokenType: string | null;
  exp: number | null;
  userData: Record<string, unknown> | null;
  timestamp?: number;
}

/**
 * Why a refresh attempt failed. `reuse` signals a rotated (old) refresh token
 * was replayed (RFC 9700 token theft) — the session family should be dropped
 * and the user must never be silently downgraded to guest.
 */
export type RefreshFailReason = 'expired' | 'revoked' | 'reuse' | 'network' | 'unknown';

export interface RefreshResult {
  success: boolean;
  newToken: string | null;
  /** New refresh token when the backend rotates it (dual-token mode). */
  newRefreshToken?: string | null;
  /** Populated when `success` is false. */
  reason?: RefreshFailReason;
}

// ==================== API Response Types ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: Record<string, unknown>;
}

export interface GuestTokenResponse {
  success?: boolean;
  data?: {
    accessToken: string;
    expiresIn?: number;
  };
}

export interface AuthMeResponse {
  success?: boolean;
  data?: {
    type?: string;
    exp?: number;
    [key: string]: unknown;
  };
}

// ==================== Config Types ====================

export interface EndpointConfig {
  validate?: string;
  refresh?: string;
  guest?: string;
}

export interface GuestTokenConfig {
  enabled: boolean;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface AccessConfig {
  /** Token types allowed to access the app (e.g., ['superadmin', 'admin']) */
  allowedTokenTypes?: string[];
  /** Routes that require authentication */
  protectedRoutes?: string[];
  /** Auth pages (login, register) - authenticated users redirected away */
  authRoutes?: string[];
  /** Routes accessible without authentication */
  publicRoutes?: string[];
  /** 
   * If true, all routes are protected by default (except publicRoutes and authRoutes)
   * Useful for admin panels where everything requires auth
   * @default false
   */
  protectedByDefault?: boolean;
  /**
   * When a **user** token fails to refresh, whether the request may fall back
   * to a guest token. On protected routes the user is always redirected to
   * login regardless of this flag; this only controls non-protected routes.
   * A detected token **reuse** never downgrades to guest, regardless of this
   * flag.
   * @default true (backward compatible)
   */
  guestFallbackOnUserRefreshFail?: boolean;
}

export interface I18nConfig {
  enabled: boolean;
  locales?: string[];
  defaultLocale?: string;
  /** 
   * next-intl or similar i18n middleware function
   * Library will call this and merge responses to preserve headers
   */
  middleware?: (request: NextRequest) => NextResponse | Promise<NextResponse>;
}

// ==================== Proxy Config ====================

import type { NextRequest, NextResponse } from 'next/server';

/** Result of auth validation passed to afterAuth hook */
export interface AuthResult {
  isAuthenticated: boolean;
  isGuest: boolean;
  tokenType: string | null;
  user: Record<string, unknown> | null;
  /**
   * Set when the proxy skipped auth for this request, so `afterAuth` can tell a
   * bypassed request apart from a genuinely anonymous one. Undefined means the
   * request went through the normal validation pipeline.
   */
  bypassed?: 'excluded' | 'auth-api';
}

/**
 * Response mappers for different backend formats
 * Allows adapting any backend response format to library's internal format
 */
export interface ResponseMappers {
  /**
   * Parse auth/me response to extract token info
   * @param response - Raw response from backend
   * @returns TokenInfo or null if invalid
   * 
   * @example Laravel format
   * ```ts
   * parseAuthMe: (res) => ({
   *   isValid: res.success,
   *   tokenType: res.data?.token_type || 'user',
   *   exp: res.data?.expires_at,
   *   userData: res.data?.user,
   * })
   * ```
   * 
   * @example Django format
   * ```ts
   * parseAuthMe: (res) => ({
   *   isValid: !!res.user,
   *   tokenType: res.is_guest ? 'guest' : 'user',
   *   exp: res.exp,
   *   userData: res.user,
   * })
   * ```
   */
  parseAuthMe?: (response: unknown) => TokenInfo | null;
  
  /**
   * Parse refresh token response
   * @returns The new access token or null
   */
  parseRefreshToken?: (response: unknown) => string | null;
  
  /**
   * Parse guest token response
   * @returns The guest access token or null
   */
  parseGuestToken?: (response: unknown) => string | null;

  /**
   * Parse the rotated refresh token from a refresh response (dual-token mode).
   * @returns The new refresh token or null if none was rotated.
   */
  parseNewRefreshToken?: (response: unknown) => string | null;
}

/** Raw refresh-endpoint failure passed to a custom classifier. */
export interface RefreshFailContext {
  /** HTTP status of the refresh response (0 for a network/transport error). */
  status: number;
  /** Parsed JSON body of the refresh response, if any. */
  body: unknown;
}

/**
 * Which auth API routes the proxy skips entirely.
 *
 * Bypassed paths get **no** token validation, refresh, single-flight,
 * proactive renewal or reuse detection. `/api/auth/login` and
 * `/api/auth/register` must stay bypassed (no token yet) and
 * `/api/auth/refresh` should stay bypassed (it performs the refresh itself),
 * but `/api/auth/me` is usually better served by the normal pipeline so an
 * expired token is refreshed transparently instead of returning 401.
 */
export interface AuthApiConfig {
  /**
   * Exact paths the proxy skips entirely. Replaces the default list, so include
   * every path that must stay bypassed: dropping the login/register routes
   * blocks sign-in (no token exists yet), and dropping the refresh route makes
   * the proxy refresh the token before the refresh route runs, rotating it
   * twice.
   *
   * @default ['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/refresh', '/api/auth/register']
   */
  bypassPaths?: string[];
}

/**
 * Shared store used to reuse a refresh result **across** runtime instances
 * (PM2 cluster, Passenger, Docker replicas, serverless/edge isolates), where
 * the in-memory single-flight map cannot help.
 *
 * Best-effort, not a distributed mutex: `get` and `set` are not atomic, so two
 * instances that miss the store at the exact same moment still refresh
 * independently. It removes the far more common near-miss case (one instance
 * refreshes, another retries moments later with the same old token) and should
 * be paired with idempotent refresh handling on the backend.
 *
 * Keys are SHA-256 hashes of the old token, never the token itself. Values hold
 * freshly issued tokens for a short TTL, so back the store with a secured
 * service (e.g. an authenticated Redis) and keep the TTL small. Persist the
 * value verbatim -- it carries an absolute expiry that the library re-checks on
 * read, and entries missing it are discarded.
 */
export interface RefreshResultStore {
  get(key: string): Promise<StoredRefreshResult | null> | StoredRefreshResult | null;
  set(key: string, value: StoredRefreshResult, ttlMs: number): Promise<void> | void;
}

export interface StoredRefreshResult {
  accessToken: string;
  refreshToken?: string | null;
  /** Absolute epoch-ms expiry, enforced on read regardless of adapter TTL support. */
  expiresAt: number;
}

/**
 * Token refresh behaviour: concurrent single-flight, proactive (pre-expiry)
 * refresh, and reuse/theft classification (RFC 9700).
 */
export interface RefreshConfig {
  /**
   * De-duplicate concurrent refreshes for the same token so only one request
   * hits the backend and the rest await its result. Prevents orphan/bounce
   * with server-side `jti` rotation. Effective within a single runtime
   * instance.
   * @default true
   */
  singleFlight?: boolean;
  /**
   * Refresh proactively when the access token is within `proactiveWindow`
   * seconds of expiry, instead of waiting for a 401.
   * @default false
   */
  proactive?: boolean;
  /**
   * Seconds before expiry at which a proactive refresh triggers.
   * @default 120
   */
  proactiveWindow?: number;
  /**
   * HTTP status codes from the refresh endpoint that indicate a replayed
   * (rotated) refresh token \u2014 token theft. Classified as `reuse`.
   * @default [409]
   */
  reuseStatusCodes?: number[];
  /**
   * Body `code` values that indicate token reuse (e.g. `token_reuse`).
   * @default ['token_reuse']
   */
  reuseCodes?: string[];
  /**
   * Custom classifier for a failed refresh. Overrides the built-in status/code
   * mapping when it returns a reason.
   */
  classifyFail?: (ctx: RefreshFailContext) => RefreshFailReason | undefined;
  /**
   * Invoked when a refresh fails. Use for security telemetry / notifying the
   * client ("logged out on all devices"). A `reuse` reason never falls back to
   * a guest token.
   */
  onRefreshFail?: (reason: RefreshFailReason, req: NextRequest) => void | Promise<void>;
  /**
   * Shared store that lets another instance's recent refresh result be reused
   * instead of issuing a second refresh (which a backend with reuse detection
   * would flag as theft). Best-effort across instances -- see
   * {@link RefreshResultStore}.
   */
  store?: RefreshResultStore;
  /**
   * How long a refresh result stays reusable in `store`. Keep it above the
   * expected request skew and below the new token's lifetime.
   * @default 60000
   */
  storeTtlMs?: number;
}

/**
 * Token validation strategy. `local` verifies the JWT signature + `exp` in the
 * proxy and only calls the backend on a schedule, restoring stateless auth.
 */
export interface ValidateConfig {
  /**
   * `'backend'` (default) calls the validate endpoint on every request.
   * `'local'` verifies the JWT locally and only revalidates against the
   * backend every `revalidateInterval` seconds (and on refresh).
   * @default 'backend'
   */
  mode?: 'backend' | 'local';
  /** HMAC secret for built-in HS256 local verification. */
  secret?: string;
  /** Algorithms accepted by the built-in verifier. @default ['HS256'] */
  algorithms?: Array<'HS256' | 'HS384' | 'HS512'>;
  /**
   * In `local` mode, re-check the token against the backend at most once every
   * N seconds. `0` disables periodic revalidation (pure local until expiry).
   * @default 0
   */
  revalidateInterval?: number;
  /**
   * Custom verifier (e.g. `jose` with RS256/JWKS). Overrides the built-in
   * HS256 verifier; return a `TokenInfo` or `null`/throw when invalid.
   */
  verify?: (token: string) => Promise<TokenInfo | null> | TokenInfo | null;
}

export interface AuthProxyConfig {
  apiBaseUrl: string;
  cookies: CookieConfig;
  endpoints?: EndpointConfig;
  guestToken?: GuestTokenConfig;
  access?: AccessConfig;
  i18n?: I18nConfig;
  excludedPaths?: string[];
  onError?: (error: Error) => void;
  
  /**
   * Block browser direct access to API routes (when Accept: text/html)
   * Redirects to home page. Default: false
   */
  blockBrowserApiAccess?: boolean;
  
  /**
   * CSRF Protection configuration
   * Protects against Cross-Site Request Forgery attacks
   */
  csrf?: CsrfConfig;
  
  /**
   * Rate Limiting configuration
   * Prevents abuse and DoS attacks
   */
  rateLimit?: RateLimitConfig;
  
  /**
   * Audit Logging configuration
   * For security monitoring and compliance
   */
  audit?: AuditConfig;

  /**
   * Token refresh behaviour: concurrent single-flight, proactive (pre-expiry)
   * refresh, and reuse/theft classification (RFC 9700).
   */
  refresh?: RefreshConfig;

  /**
   * Token validation strategy (backend-per-request vs. local JWT verification).
   */
  validate?: ValidateConfig;

  /**
   * Which auth API routes the proxy skips entirely.
   */
  authApi?: AuthApiConfig;
  
  /**
   * Custom response parsers for different backend formats.
   * If not provided, expects standard format:
   * - auth/me: { success: true, data: { type, exp, ...user } }
   * - refresh: { success: true, data: { accessToken } }
   * - guest:   { success: true, data: { accessToken } }
   */
  responseMappers?: ResponseMappers;
  
  /**
   * Hook that runs BEFORE auth validation.
   * Return a NextResponse to bypass auth, or null/undefined to continue.
   * Use this for custom route handling, logging, rate limiting, etc.
   */
  beforeAuth?: (req: NextRequest) => NextResponse | null | undefined | Promise<NextResponse | null | undefined>;
  
  /**
   * Hook that runs AFTER auth validation.
   * Allows modifying the response or adding custom headers.
   * Receives the auth result for conditional logic.
   */
  afterAuth?: (req: NextRequest, response: NextResponse, authResult: AuthResult) => NextResponse | Promise<NextResponse>;
}

// ==================== API Client Config ====================

export interface SanitizationConfig {
  /** Enable/disable sanitization. Default: true */
  enabled?: boolean;
  /** 
   * Sanitization mode:
   * - 'strip' (default): Removes HTML tags, preserves plain text characters.
   *   Safe for React/Vue/Angular which auto-escape text content.
   * - 'escape': Escapes HTML-sensitive chars (<, >, &, ") for raw HTML contexts.
   * - 'allowList': Only allows specified tags in allowedTags (for rich-text content).
   * 
   * @default 'strip'
   */
  mode?: 'escape' | 'strip' | 'allowList';
  /** Tags to allow when mode is 'allowList' */
  allowedTags?: string[];
  /** Fields to skip sanitization (e.g., ['html_content', 'markdown']) */
  skipFields?: string[];
  /** 
   * Endpoints to skip sanitization entirely (glob-like matching)
   * e.g., ['cms/*', 'pages/raw', 'content/**']
   */
  skipEndpoints?: string[];
}

export interface ApiI18nConfig {
  enabled?: boolean;
  paramName?: string;
  locales?: string[];
  defaultLocale?: string;
}

export interface ApiClientConfig {
  sanitization?: SanitizationConfig;
  i18n?: ApiI18nConfig;
  methodSpoofing?: boolean;
  /** 
   * Auth configuration for API requests
   * Controls which endpoints require authentication
   */
  auth?: {
    /** 
     * Skip auth for all requests by default (useful for public APIs)
     * Default: false
     */
    skipByDefault?: boolean;
    /**
     * Endpoints that should skip authentication (glob patterns)
     * e.g., ['news/*', 'public/**', 'categories']
     */
    publicEndpoints?: string[];
  };
  errorMessages?: {
    /** Message when no auth token is available */
    noToken?: string;
    /** Message for network/connection errors */
    connectionError?: string;
    /** Message for 5xx server errors */
    serverError?: string;
    /** Message when request times out */
    timeout?: string;
  };
}

// ==================== API Request Options ====================

export interface ApiRequestOptions {
  isFormData?: boolean;
  methodSpoofing?: boolean;
  skipSanitize?: string[];
}

// ==================== Auth Types (Client) ====================

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  [key: string]: unknown;
}

/** User data returned from auth endpoints */
export interface UserData extends UserProfile {
  token_type?: string;
}

export interface AuthData {
  type: string;
  user?: UserProfile;
  exp?: number;
  [key: string]: unknown;
}

export interface AuthState {
  authData: AuthData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isGuest: boolean;
  error: Error | null;
}

export interface AuthContextValue extends AuthState {
  user: UserProfile | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

// ==================== Security Types ====================

/**
 * CSRF Protection Configuration
 * Uses Fetch Metadata (primary) + Signed Double-Submit Cookie (fallback)
 */
export interface CsrfConfig {
  /** Enable CSRF protection. Default: false */
  enabled: boolean;
  /**
   * CSRF strategy:
   * - 'fetch-metadata': Modern browsers (Sec-Fetch-Site header check)
   * - 'double-submit': Signed HMAC cookie pattern
   * - 'both': Use both (recommended for max compatibility)
   * @default 'both'
   */
  strategy?: 'fetch-metadata' | 'double-submit' | 'both';
  /** Secret for HMAC signing. Auto-generated if not provided. */
  secret?: string;
  /** Cookie name for CSRF token. @default '__csrf' */
  cookieName?: string;
  /** Header name for CSRF token. @default 'x-csrf-token' */
  headerName?: string;
  /** HTTP methods that don't need CSRF check. @default ['GET', 'HEAD', 'OPTIONS'] */
  ignoreMethods?: string[];
  /** Trust same-site requests (less strict). @default false */
  trustSameSite?: boolean;
}

/**
 * Rate Limiting Configuration
 * Token bucket algorithm with configurable windows
 */
export interface RateLimitConfig {
  /** Enable rate limiting. Default: false */
  enabled: boolean;
  /** Time window in milliseconds. @default 60000 (1 minute) */
  windowMs?: number;
  /** Max requests per window. @default 100 */
  maxRequests?: number;
  /** 
   * Function to generate rate limit key (IP, token, user ID, etc.)
   * @default IP-based (see `ipHeaders`)
   */
  keyFn?: (req: NextRequest) => string;
  /** Routes to skip rate limiting (glob patterns) */
  skipRoutes?: string[];
  /**
   * Skip rate limiting for Next.js / browser prefetch requests.
   * Prefetches are triggered automatically by `<Link>` on hover/viewport and
   * by the App Router; counting them inflates the limiter and causes false
   * 429s after only a few visible clicks.
   * @default true
   */
  skipPrefetch?: boolean;
  /**
   * Ordered list of headers used by the default IP-based key function to
   * resolve the client IP. Ignored when a custom `keyFn` is provided.
   * @default ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for']
   */
  ipHeaders?: string[];
  /** Custom response when rate limited */
  onRateLimited?: (req: NextRequest) => NextResponse;
}

/**
 * Audit Logging Configuration
 * Event-based logging for security monitoring
 */
export interface AuditConfig {
  /** Enable audit logging. Default: false */
  enabled: boolean;
  /** Event types to log */
  events?: AuditEventType[];
  /** Logger function */
  logger?: (event: AuditEvent) => void | Promise<void>;
}

export type AuditEventType = 
  | 'auth:success' 
  | 'auth:fail' 
  | 'auth:refresh' 
  | 'auth:refresh:fail'
  | 'auth:reuse'
  | 'auth:guest'
  | 'access:denied' 
  | 'csrf:fail' 
  | 'rateLimit:exceeded'
  | 'error';

export interface AuditEvent {
  type: AuditEventType;
  timestamp: Date;
  ip: string | null;
  userId?: string;
  path: string;
  method: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// ==================== Internal Types ====================

export type ResolvedCookieOptions = Required<CookieOptions>;

export interface ResolvedCsrfConfig {
  enabled: boolean;
  strategy: 'fetch-metadata' | 'double-submit' | 'both';
  secret: string;
  cookieName: string;
  headerName: string;
  ignoreMethods: string[];
  trustSameSite: boolean;
}

export interface ResolvedRateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  keyFn: (req: NextRequest) => string;
  skipRoutes: string[];
  skipPrefetch: boolean;
  ipHeaders: string[];
  onRateLimited?: (req: NextRequest) => NextResponse;
}

export interface ResolvedAuditConfig {
  enabled: boolean;
  events: AuditEventType[];
  logger?: (event: AuditEvent) => void | Promise<void>;
}

export interface ResolvedRefreshConfig {
  singleFlight: boolean;
  proactive: boolean;
  proactiveWindow: number;
  reuseStatusCodes: number[];
  reuseCodes: string[];
  classifyFail?: (ctx: RefreshFailContext) => RefreshFailReason | undefined;
  onRefreshFail?: (reason: RefreshFailReason, req: NextRequest) => void | Promise<void>;
  store?: RefreshResultStore;
  storeTtlMs: number;
}

export interface ResolvedValidateConfig {
  mode: 'backend' | 'local';
  secret?: string;
  algorithms: Array<'HS256' | 'HS384' | 'HS512'>;
  revalidateInterval: number;
  verify?: (token: string) => Promise<TokenInfo | null> | TokenInfo | null;
}

export interface InternalProxyConfig extends AuthProxyConfig {
  _resolved: {
    cookieOptions: ResolvedCookieOptions;
    refreshCookieOptions: ResolvedCookieOptions;
    dualToken: boolean;
    endpoints: Required<EndpointConfig>;
    csrf: ResolvedCsrfConfig;
    rateLimit: ResolvedRateLimitConfig;
    audit: ResolvedAuditConfig;
    refresh: ResolvedRefreshConfig;
    validate: ResolvedValidateConfig;
    authApiBypassPaths: string[];
  };
}
