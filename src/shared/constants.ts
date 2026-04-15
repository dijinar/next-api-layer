/**
 * Shared Constants
 * Default values and constant configurations
 */

import type { CookieOptions, EndpointConfig } from './types';

// ==================== Default Values ====================

export const DEFAULT_COOKIE_OPTIONS: Required<CookieOptions> = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days
} as const;

export const DEFAULT_ENDPOINTS: Required<EndpointConfig> = {
  validate: 'auth/me',
  refresh: 'auth/refresh',
  guest: 'auth/guest',
} as const;

// ==================== Token Types ====================

export const TOKEN_TYPES = {
  GUEST: 'guest',
} as const;

// ==================== Time Constants ====================

export const TIME = {
  SEVEN_DAYS: 7 * 24 * 60 * 60,
  ONE_HOUR: 60 * 60,
  TWO_HOURS: 2 * 60 * 60,
} as const;

// ==================== Error Messages ====================

export const ERROR_MESSAGES = {
  NO_TOKEN: 'Token not found.',
  INVALID_TOKEN: 'Token is invalid or expired.',
  CONNECTION_ERROR: 'Connection error occurred.',
  UNAUTHORIZED: 'You are not authorized for this action.',
} as const;

// ==================== Headers ====================

export const HEADERS = {
  AUTH_USER: 'x-auth-user',
  REFRESHED_TOKEN: 'x-refreshed-token',
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'Content-Type',
  SKIP_AUTH: 'x-skip-auth',
  LOCALE: 'x-locale',
} as const;

// ==================== Sanitization Defaults ====================

/**
 * Common safe HTML tags for allowList mode
 * Use with: sanitization: { mode: 'allowList', allowedTags: SAFE_HTML_TAGS }
 */
export const SAFE_HTML_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'br',
  'blockquote', 'div', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
] as const;

// ==================== Security Defaults ====================

/** CSRF safe methods that don't need validation */
export const CSRF_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

export const DEFAULT_CSRF_CONFIG = {
  strategy: 'both' as const,
  cookieName: '__csrf',
  headerName: 'x-csrf-token',
  ignoreMethods: [...CSRF_SAFE_METHODS],
  trustSameSite: false,
} as const;

export const DEFAULT_RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 100,
  skipRoutes: [] as string[],
} as const;

export const DEFAULT_AUDIT_CONFIG = {
  events: [
    'auth:success',
    'auth:fail',
    'auth:refresh',
    'access:denied',
    'csrf:fail',
    'rateLimit:exceeded',
    'error',
  ] as const,
} as const;
