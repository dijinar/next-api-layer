/**
 * Config Resolver
 * Resolves and validates configuration with defaults
 */

import type { NextRequest } from 'next/server';
import type {
  AuthProxyConfig,
  InternalProxyConfig,
  ApiClientConfig,
  ResolvedCookieOptions,
  EndpointConfig,
  ResolvedCsrfConfig,
  ResolvedRateLimitConfig,
  ResolvedAuditConfig,
  AuditEventType,
} from './types';

import {
  DEFAULT_COOKIE_OPTIONS,
  DEFAULT_ENDPOINTS,
  DEFAULT_CSRF_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_AUDIT_CONFIG,
} from './constants';

/**
 * Generates a random secret for CSRF HMAC signing
 */
function generateCsrfSecret(): string {
  // Use crypto if available (Node.js)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID() + crypto.randomUUID();
  }
  // Fallback: timestamp + random
  return `${Date.now()}-${Math.random().toString(36).substring(2)}`;
}

/**
 * Default rate limit key function (IP-based)
 */
function defaultRateLimitKeyFn(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 
             req.headers.get('x-real-ip') || 
             'unknown';
  return `rl:${ip}`;
}

/**
 * Resolves proxy configuration with defaults
 */
export function resolveProxyConfig(config: AuthProxyConfig): InternalProxyConfig {
  // Validate required fields
  if (!config.apiBaseUrl) {
    throw new Error('next-api-layer: apiBaseUrl is required');
  }
  
  if (!config.cookies?.user || !config.cookies?.guest) {
    throw new Error('next-api-layer: cookies.user and cookies.guest are required');
  }

  // Ensure apiBaseUrl ends with /
  const apiBaseUrl = config.apiBaseUrl.endsWith('/')
    ? config.apiBaseUrl
    : `${config.apiBaseUrl}/`;

  // Resolve cookie options
  const cookieOptions: ResolvedCookieOptions = {
    ...DEFAULT_COOKIE_OPTIONS,
    ...config.cookies.options,
  };

  // Resolve endpoints
  const endpoints: Required<EndpointConfig> = {
    ...DEFAULT_ENDPOINTS,
    ...config.endpoints,
  };

  // Resolve CSRF config
  const csrf: ResolvedCsrfConfig = {
    enabled: config.csrf?.enabled ?? false,
    strategy: config.csrf?.strategy ?? DEFAULT_CSRF_CONFIG.strategy,
    secret: config.csrf?.secret ?? generateCsrfSecret(),
    cookieName: config.csrf?.cookieName ?? DEFAULT_CSRF_CONFIG.cookieName,
    headerName: config.csrf?.headerName ?? DEFAULT_CSRF_CONFIG.headerName,
    ignoreMethods: config.csrf?.ignoreMethods ?? DEFAULT_CSRF_CONFIG.ignoreMethods,
    trustSameSite: config.csrf?.trustSameSite ?? DEFAULT_CSRF_CONFIG.trustSameSite,
  };

  // Resolve rate limit config
  const rateLimit: ResolvedRateLimitConfig = {
    enabled: config.rateLimit?.enabled ?? false,
    windowMs: config.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_CONFIG.windowMs,
    maxRequests: config.rateLimit?.maxRequests ?? DEFAULT_RATE_LIMIT_CONFIG.maxRequests,
    keyFn: config.rateLimit?.keyFn ?? defaultRateLimitKeyFn,
    skipRoutes: config.rateLimit?.skipRoutes ?? DEFAULT_RATE_LIMIT_CONFIG.skipRoutes,
    onRateLimited: config.rateLimit?.onRateLimited,
  };

  // Resolve audit config
  const audit: ResolvedAuditConfig = {
    enabled: config.audit?.enabled ?? false,
    events: config.audit?.events ?? [...DEFAULT_AUDIT_CONFIG.events] as AuditEventType[],
    logger: config.audit?.logger,
  };

  return {
    ...config,
    apiBaseUrl,
    _resolved: {
      cookieOptions,
      endpoints,
      csrf,
      rateLimit,
      audit,
    },
  };
}

/**
 * Resolves API client configuration with defaults
 */
export function resolveApiClientConfig(config: ApiClientConfig = {}) {
  return {
    sanitization: {
      enabled: config.sanitization?.enabled ?? true,
      allowedTags: config.sanitization?.allowedTags,
      skipFields: config.sanitization?.skipFields ?? [],
      skipEndpoints: config.sanitization?.skipEndpoints ?? [],
    },
    i18n: {
      enabled: config.i18n?.enabled ?? false,
      paramName: config.i18n?.paramName ?? 'lang',
      locales: config.i18n?.locales ?? [],
      defaultLocale: config.i18n?.defaultLocale ?? 'en',
    },
    auth: {
      skipByDefault: config.auth?.skipByDefault ?? false,
      publicEndpoints: config.auth?.publicEndpoints ?? [],
    },
    methodSpoofing: config.methodSpoofing ?? false,
    errorMessages: {
      noToken: config.errorMessages?.noToken ?? 'Token bulunamadı.',
      connectionError: config.errorMessages?.connectionError ?? 'Bağlantı hatası oluştu.',
    },
  };
}

/**
 * Type guard to check if a value is defined
 */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
