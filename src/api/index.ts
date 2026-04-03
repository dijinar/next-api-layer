/**
 * API module exports
 * 
 * Server-side API client for Route Handlers
 * 
 * @example
 * ```ts
 * // lib/api.ts
 * import { createApiClient } from 'next-api-layer';
 * 
 * export const api = createApiClient({
 *   apiBaseUrl: process.env.API_BASE_URL!,
 *   cookies: {
 *     user: process.env.COOKIE_USER_AUTH_TOKEN_NAME!,
 *     guest: process.env.COOKIE_PUBLIC_AUTH_TOKEN_NAME!,
 *   },
 * });
 * 
 * // Usage in route handler
 * export async function GET() {
 *   return api.get('superadmin/list');
 * }
 * ```
 */

export { createApiClient } from './createApiClient';
export type { ApiClient, ApiClientConfig, RequestOptions } from './createApiClient';

export { createSanitizer, sanitize, defaultSanitizer } from './sanitize';
export type { Sanitizer, SanitizeOptions } from './sanitize';

// Re-export types needed for API config
export type {
  SanitizationConfig,
} from '../shared/types';
