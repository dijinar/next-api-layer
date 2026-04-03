/**
 * Proxy module exports
 */

export { createAuthProxy } from './createAuthProxy';
export type { AuthProxy } from './createAuthProxy';

export { createProxyHandler } from './createProxyHandler';
export type { ProxyHandler, ProxyHandlerConfig } from './createProxyHandler';

// Security modules
export { createCsrfValidator } from './csrf';
export type { CsrfValidator } from './csrf';

export { createRateLimiter } from './rateLimit';
export type { RateLimiter } from './rateLimit';

export { createAuditLogger } from './audit';
export type { AuditLogger } from './audit';

// Internal exports for advanced usage
export { createTokenValidation } from './tokenValidation';
export { createHandlers } from './handlers';
