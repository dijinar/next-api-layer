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
  options?: CookieOptions;
}

// ==================== Token Types ====================

export interface TokenInfo {
  isValid: boolean;
  tokenType: string | null;
  exp: number | null;
  userData: Record<string, unknown> | null;
  timestamp?: number;
}

export interface RefreshResult {
  success: boolean;
  newToken: string | null;
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
   * - 'escape': Escapes HTML entities (default, safest)
   * - 'strip': Removes all HTML tags
   * - 'allowList': Only allows specified tags in allowedTags
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
    noToken?: string;
    connectionError?: string;
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
   * @default IP-based
   */
  keyFn?: (req: NextRequest) => string;
  /** Routes to skip rate limiting (glob patterns) */
  skipRoutes?: string[];
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
  onRateLimited?: (req: NextRequest) => NextResponse;
}

export interface ResolvedAuditConfig {
  enabled: boolean;
  events: AuditEventType[];
  logger?: (event: AuditEvent) => void | Promise<void>;
}

export interface InternalProxyConfig extends AuthProxyConfig {
  _resolved: {
    cookieOptions: ResolvedCookieOptions;
    endpoints: Required<EndpointConfig>;
    csrf: ResolvedCsrfConfig;
    rateLimit: ResolvedRateLimitConfig;
    audit: ResolvedAuditConfig;
  };
}
