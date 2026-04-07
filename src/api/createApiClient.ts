/**
 * createApiClient
 * Server-side API client for Route Handlers
 * 
 * Makes requests directly to backend with auth token from cookies/headers.
 * Returns Response objects that can be directly returned from route handlers.
 */

import { cookies, headers } from 'next/headers';
import { createSanitizer } from './sanitize';
import type { SanitizationConfig, I18nConfig } from '../shared/types';
import { HEADERS } from '../shared/constants';

// ==================== Types ====================

export interface ApiClientConfig {
  /** Backend API base URL */
  apiBaseUrl: string;
  
  /** Cookie names for token retrieval */
  cookies: {
    user: string;
    guest: string;
  };
  
  /** Sanitization options */
  sanitization?: SanitizationConfig;
  
  /** Enable Laravel method spoofing for PUT/PATCH */
  methodSpoofing?: boolean;
  
  /** Custom error messages */
  errorMessages?: {
    noToken?: string;
    connectionError?: string;
  };
  
  /** i18n configuration - auto-append locale to API requests */
  i18n?: I18nConfig & {
    /** Query parameter name (default: 'lang') */
    paramName?: string;
  };
}

export interface RequestOptions {
  /** Form data mode (use FormData, skip Content-Type header) */
  isFormData?: boolean;
  /** Use method spoofing for this request */
  methodSpoofing?: boolean;
  /** Skip authentication for this request */
  skipAuth?: boolean;
  /** Skip all sanitization for this request */
  skipSanitize?: boolean;
  /** Skip sanitization for specific fields only */
  skipSanitizeFields?: string[];
}

export interface ApiClient {
  get: (endpoint: string) => Promise<Response>;
  post: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) => Promise<Response>;
  put: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) => Promise<Response>;
  patch: (endpoint: string, body?: Record<string, unknown>, options?: RequestOptions) => Promise<Response>;
  delete: (endpoint: string) => Promise<Response>;
}

// ==================== Factory ====================

/**
 * Creates a server-side API client for Next.js Route Handlers
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
 * // Usage in route handler - direct return!
 * export async function GET() {
 *   return api.get('superadmin/home/list');
 * }
 * 
 * export async function POST(request: Request) {
 *   const body = await request.json();
 *   return api.post('donations/create', body);
 * }
 * ```
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const {
    apiBaseUrl,
    cookies: cookieNames,
    methodSpoofing: globalMethodSpoofing = false,
    errorMessages = {},
    i18n,
  } = config;
  
  // Ensure baseUrl ends with /
  const baseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  
  // Create sanitizer
  const sanitizer = createSanitizer(config.sanitization);
  
  // Error messages
  const noTokenMessage = errorMessages.noToken ?? 'Token bulunamadı. Lütfen giriş yapın.';
  const connectionErrorMessage = errorMessages.connectionError ?? 'Bağlantı hatası oluştu.';

  /**
   * Get auth token from headers (refreshed) or cookies
   */
  async function getToken(): Promise<string | null> {
    // Check for refreshed token from proxy
    const headersList = await headers();
    const refreshedToken = headersList.get(HEADERS.REFRESHED_TOKEN);
    if (refreshedToken) {
      return refreshedToken;
    }
    
    // Get from cookies
    const cookieStore = await cookies();
    return (
      cookieStore.get(cookieNames.user)?.value ||
      cookieStore.get(cookieNames.guest)?.value ||
      null
    );
  }

  /**
   * Create error response
   */
  function errorResponse(message: string, status = 500): Response {
    return Response.json(
      { success: false, message },
      { status }
    );
  }

  /**
   * Create no-token response
   */
  function noTokenResponse(): Response {
    return errorResponse(noTokenMessage, 401);
  }

  /**
   * Make a fetch request to backend
   */
  async function makeRequest(
    method: string,
    endpoint: string,
    body?: Record<string, unknown> | FormData | null,
    options: RequestOptions = {}
  ): Promise<Response> {
    // Skip auth check if requested
    const token = options.skipAuth ? null : await getToken();
    
    if (!options.skipAuth && !token) {
      return noTokenResponse();
    }

    try {
      const fetchHeaders: HeadersInit = {};
      
      // Add auth header if we have a token
      if (token) {
        fetchHeaders['Authorization'] = `Bearer ${token}`;
      }

      let fetchBody: string | FormData | undefined;
      let actualMethod = method;

      // Handle body
      if (body) {
        if (options.isFormData && body instanceof FormData) {
          // FormData - sanitize (unless skipped) and optionally add method spoofing
          if (options.skipSanitize) {
            fetchBody = body;
          } else {
            fetchBody = sanitizer.sanitizeFormData(body, options.skipSanitizeFields);
          }
          
          const useMethodSpoofing = options.methodSpoofing ?? globalMethodSpoofing;
          if (useMethodSpoofing && (method === 'PUT' || method === 'PATCH')) {
            (fetchBody as FormData).append('_method', method);
            actualMethod = 'POST';
          }
        } else if (!(body instanceof FormData)) {
          // JSON body
          fetchHeaders['Content-Type'] = 'application/json';
          if (options.skipSanitize) {
            fetchBody = JSON.stringify(body);
          } else {
            fetchBody = JSON.stringify(sanitizer.sanitize(body, options.skipSanitizeFields));
          }
        }
      }

      // Build URL with optional locale parameter
      let url = `${baseUrl}${endpoint}`;
      if (i18n?.enabled) {
        const headersList = await headers();
        const locale = headersList.get(HEADERS.LOCALE);
        if (locale && (!i18n.locales || i18n.locales.includes(locale))) {
          const urlObj = new URL(url);
          urlObj.searchParams.set(i18n.paramName || 'lang', locale);
          url = urlObj.toString();
        }
      }

      const res = await fetch(url, {
        method: actualMethod,
        headers: fetchHeaders,
        body: fetchBody,
        cache: 'no-store',
      });

      // Clone response data (stream can only be read once)
      const data = await res.json();
      return Response.json(data, { status: res.status });
    } catch (error) {
      console.error(`API ${method} Error:`, error);
      return errorResponse(connectionErrorMessage);
    }
  }

  // Return API client interface
  return {
    get: (endpoint: string) => makeRequest('GET', endpoint),
    
    post: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) =>
      makeRequest('POST', endpoint, body, options),
    
    put: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) =>
      makeRequest('PUT', endpoint, body, options),
    
    patch: (endpoint: string, body?: Record<string, unknown>, options?: RequestOptions) =>
      makeRequest('PATCH', endpoint, body, options),
    
    delete: (endpoint: string) => makeRequest('DELETE', endpoint),
  };
}
