/**
 * next-api-layer
 * Production-grade auth proxy middleware for Next.js + External JWT Backend
 * 
 * @example
 * ```ts
 * import { createAuthProxy, createApiClient } from 'next-api-layer';
 * ```
 * 
 * @packageDocumentation
 */

// ==================== Main Exports ====================

export { createAuthProxy } from './proxy';
export type { AuthProxy } from './proxy';

export { createProxyHandler } from './proxy';
export type { ProxyHandler, ProxyHandlerConfig } from './proxy';

// Re-export API client for convenience (also available from 'next-api-layer/api')
export { createApiClient } from './api';
export type { ApiClient, ApiClientConfig, SanitizationConfig } from './api';

// ==================== Types ====================

export type {
  // Config types
  AuthProxyConfig,
  CookieConfig,
  CookieOptions,
  EndpointConfig,
  GuestTokenConfig,
  AccessConfig,
  I18nConfig,
  ResponseMappers,
  
  // Security config types
  CsrfConfig,
  RateLimitConfig,
  AuditConfig,
  AuditEvent,
  AuditEventType,
  
  // Data types
  TokenInfo,
  AuthData,
  UserData,
  ApiResponse,
  AuthResult,
} from './shared/types';

// ==================== Constants (for advanced usage) ====================

export {
  DEFAULT_COOKIE_OPTIONS,
  DEFAULT_ENDPOINTS,
  DEFAULT_CSRF_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_AUDIT_CONFIG,
  ERROR_MESSAGES,
  HEADERS,
  TOKEN_TYPES,
  CSRF_SAFE_METHODS,
} from './shared/constants';

// ==================== Error Classes ====================

export {
  ApiError,
  HttpError,
  TimeoutError,
  NetworkError,
  AuthError,
  ValidationError,
  RateLimitError,
  isApiError,
  isHttpError,
  isTimeoutError,
  isNetworkError,
  isAuthError,
  isRateLimitError,
  isRetryableStatus,
  isRetryableError,
} from './shared/errors';

// ==================== Security modules ====================

export { createCsrfValidator } from './proxy/csrf';
export type { CsrfValidator } from './proxy/csrf';

export { createRateLimiter } from './proxy/rateLimit';
export type { RateLimiter } from './proxy/rateLimit';

export { createAuditLogger } from './proxy/audit';
export type { AuditLogger } from './proxy/audit';

// ==================== Internal utilities (for extension) ====================

export { createTokenValidation } from './proxy/tokenValidation';
export { createHandlers } from './proxy/handlers';
