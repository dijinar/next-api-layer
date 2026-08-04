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
  ResolvedRefreshConfig,
  ResolvedValidateConfig,
  AuditEventType,
} from './types';

import {
  DEFAULT_COOKIE_OPTIONS,
  DEFAULT_ENDPOINTS,
  DEFAULT_CSRF_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_REFRESH_CONFIG,
  DEFAULT_VALIDATE_CONFIG,
  DEFAULT_AUTH_BYPASS_PATHS,
} from './constants';
import { DEFAULT_IP_HEADERS, getClientIp } from './ip';

/**
 * Generates a random secret for CSRF HMAC signing
 */
function generateCsrfSecret(): string {
  // Prefer randomUUID, fall back to getRandomValues; never derive a security
  // secret from a weak, predictable source.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID() + crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error(
    'next-api-layer: Web Crypto API is unavailable; set csrf.secret explicitly.'
  );
}

/**
 * Creates the default rate limit key function (IP-based).
 * Resolves the client IP from the configured header priority list, falling
 * back to `'unknown'` so requests without a resolvable IP share one bucket.
 */
function createDefaultRateLimitKeyFn(ipHeaders: string[]): (req: NextRequest) => string {
  return (req: NextRequest): string => {
    const clientIpAddress = getClientIp(req, ipHeaders) || 'unknown';
    return `rl:${clientIpAddress}`;
  };
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

  // Dual-token (OAuth2 access/refresh) mode is enabled by naming a refresh
  // cookie. Its options default to the access-cookie options but are typically
  // scoped to the refresh endpoint path with a longer lifetime.
  const dualToken = !!config.cookies.refresh;
  const refreshCookieOptions: ResolvedCookieOptions = {
    ...cookieOptions,
    ...config.cookies.refreshOptions,
  };

  // Resolve endpoints
  const endpoints: Required<EndpointConfig> = {
    ...DEFAULT_ENDPOINTS,
    ...config.endpoints,
  };

  // Warn loudly when CSRF is enabled without a stable secret: an auto-generated
  // per-process secret invalidates tokens on restart and across instances.
  const csrfEnabled = config.csrf?.enabled ?? false;
  if (csrfEnabled && !config.csrf?.secret) {
    console.warn(
      '[next-api-layer] csrf.enabled is true but csrf.secret is not set. ' +
      'A random per-process secret will be used, which breaks CSRF validation ' +
      'across restarts and multiple instances. Set a stable csrf.secret (e.g. from an env var).'
    );
  }

  // Resolve CSRF config
  const csrf: ResolvedCsrfConfig = {
    enabled: csrfEnabled,
    strategy: config.csrf?.strategy ?? DEFAULT_CSRF_CONFIG.strategy,
    secret: config.csrf?.secret ?? generateCsrfSecret(),
    cookieName: config.csrf?.cookieName ?? DEFAULT_CSRF_CONFIG.cookieName,
    headerName: config.csrf?.headerName ?? DEFAULT_CSRF_CONFIG.headerName,
    ignoreMethods: config.csrf?.ignoreMethods 
      ? [...config.csrf.ignoreMethods] 
      : [...DEFAULT_CSRF_CONFIG.ignoreMethods],
    trustSameSite: config.csrf?.trustSameSite ?? DEFAULT_CSRF_CONFIG.trustSameSite,
  };

  // Resolve rate limit config
  const ipHeaders = config.rateLimit?.ipHeaders ?? [...DEFAULT_IP_HEADERS];
  const rateLimit: ResolvedRateLimitConfig = {
    enabled: config.rateLimit?.enabled ?? false,
    windowMs: config.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_CONFIG.windowMs,
    maxRequests: config.rateLimit?.maxRequests ?? DEFAULT_RATE_LIMIT_CONFIG.maxRequests,
    keyFn: config.rateLimit?.keyFn ?? createDefaultRateLimitKeyFn(ipHeaders),
    skipRoutes: config.rateLimit?.skipRoutes ?? DEFAULT_RATE_LIMIT_CONFIG.skipRoutes,
    skipPrefetch: config.rateLimit?.skipPrefetch ?? DEFAULT_RATE_LIMIT_CONFIG.skipPrefetch,
    ipHeaders,
    onRateLimited: config.rateLimit?.onRateLimited,
  };

  // Resolve audit config
  const audit: ResolvedAuditConfig = {
    enabled: config.audit?.enabled ?? false,
    events: config.audit?.events ?? [...DEFAULT_AUDIT_CONFIG.events] as AuditEventType[],
    logger: config.audit?.logger,
  };

  // Resolve refresh config
  const refresh: ResolvedRefreshConfig = {
    singleFlight: config.refresh?.singleFlight ?? DEFAULT_REFRESH_CONFIG.singleFlight,
    proactive: config.refresh?.proactive ?? DEFAULT_REFRESH_CONFIG.proactive,
    proactiveWindow: config.refresh?.proactiveWindow ?? DEFAULT_REFRESH_CONFIG.proactiveWindow,
    reuseStatusCodes: config.refresh?.reuseStatusCodes ?? [...DEFAULT_REFRESH_CONFIG.reuseStatusCodes],
    reuseCodes: config.refresh?.reuseCodes ?? [...DEFAULT_REFRESH_CONFIG.reuseCodes],
    classifyFail: config.refresh?.classifyFail,
    onRefreshFail: config.refresh?.onRefreshFail,
    store: config.refresh?.store,
    storeTtlMs: config.refresh?.storeTtlMs ?? DEFAULT_REFRESH_CONFIG.storeTtlMs,
  };

  // Resolve validate config
  const validateMode = config.validate?.mode ?? DEFAULT_VALIDATE_CONFIG.mode;
  if (validateMode === 'local' && !config.validate?.secret && !config.validate?.verify) {
    throw new Error(
      'next-api-layer: validate.mode is "local" but neither validate.secret ' +
      '(HS256) nor validate.verify (custom) is set.'
    );
  }
  const validate: ResolvedValidateConfig = {
    mode: validateMode,
    secret: config.validate?.secret,
    algorithms: config.validate?.algorithms ?? [...DEFAULT_VALIDATE_CONFIG.algorithms],
    revalidateInterval: config.validate?.revalidateInterval ?? DEFAULT_VALIDATE_CONFIG.revalidateInterval,
    verify: config.validate?.verify,
  };

  return {
    ...config,
    apiBaseUrl,
    _resolved: {
      cookieOptions,
      refreshCookieOptions,
      dualToken,
      endpoints,
      csrf,
      rateLimit,
      audit,
      refresh,
      validate,
      authApiBypassPaths: config.authApi?.bypassPaths ?? [...DEFAULT_AUTH_BYPASS_PATHS],
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
      noToken: config.errorMessages?.noToken ?? 'Token not found.',
      connectionError: config.errorMessages?.connectionError ?? 'Connection error occurred.',
    },
  };
}

/**
 * Type guard to check if a value is defined
 */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
