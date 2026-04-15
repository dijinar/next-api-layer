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

/**
 * Method spoofing configuration for backends that don't support PUT/PATCH/DELETE
 */
export interface MethodSpoofingConfig {
  /** Enable method spoofing */
  enabled: boolean;
  /** 
   * How to send the actual method:
   * - 'body': Add _method field to request body (Laravel default)
   * - 'header': Use X-HTTP-Method-Override header
   * @default 'body'
   */
  strategy?: 'body' | 'header';
  /**
   * Custom field name for body strategy
   * @default '_method'
   */
  fieldName?: string;
}

/**
 * Retry configuration for failed requests
 */
export interface RetryConfig {
  /** Enable retry logic (default: false) */
  enabled: boolean;
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** 
   * Backoff strategy:
   * - 'exponential': Wait increases exponentially (1s, 2s, 4s, ...)
   * - 'linear': Wait increases linearly (1s, 2s, 3s, ...)
   * - 'fixed': Always wait same amount
   * @default 'exponential'
   */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /** Base delay between retries in milliseconds (default: 1000) */
  backoffMs?: number;
  /** 
   * HTTP status codes to retry on
   * @default [408, 429, 500, 502, 503, 504]
   */
  retryOn?: number[];
  /** Also retry on network errors (default: true) */
  retryOnNetworkError?: boolean;
}

/**
 * Debug configuration for development logging
 */
export interface DebugConfig {
  /** Enable debug logging (default: false) */
  enabled: boolean;
  /** Log outgoing request details (default: true) */
  logRequests?: boolean;
  /** Log response details (default: true) */
  logResponses?: boolean;
  /** Log request/response timing (default: true) */
  logTiming?: boolean;
  /** Log headers (default: false - may contain sensitive data) */
  logHeaders?: boolean;
  /** Log request body preview (default: false - may contain sensitive data) */
  logBody?: boolean;
  /** Maximum body preview length in characters (default: 200) */
  bodyPreviewLength?: number;
  /** Custom logger function (default: console.log with formatting) */
  logger?: (message: string, data?: Record<string, unknown>) => void;
}

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
  
  /** 
   * Enable method spoofing for PUT/PATCH/DELETE.
   * Pass `true` for default behavior (body strategy with _method field),
   * or pass a config object for advanced options.
   * 
   * @example
   * ```ts
   * // Simple - Laravel default
   * methodSpoofing: true
   * 
   * // Advanced - header strategy
   * methodSpoofing: {
   *   enabled: true,
   *   strategy: 'header',
   * }
   * ```
   */
  methodSpoofing?: boolean | MethodSpoofingConfig;
  
  /**
   * Request timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number;
  
  /**
   * Default headers to include in every request.
   * Authorization header is added automatically from token.
   * 
   * @example
   * ```ts
   * defaultHeaders: {
   *   'X-API-Key': process.env.API_KEY!,
   *   'Accept-Language': 'en',
   * }
   * ```
   */
  defaultHeaders?: Record<string, string>;
  
  /** Custom error messages */
  errorMessages?: {
    noToken?: string;
    connectionError?: string;
    /** Server returned 5xx error */
    serverError?: string;
    /** Request timed out */
    timeout?: string;
  };
  
  /**
   * Retry configuration for failed requests.
   * Disabled by default for backwards compatibility.
   * 
   * @example
   * ```ts
   * // Enable with defaults
   * retry: { enabled: true }
   * 
   * // Custom configuration
   * retry: {
   *   enabled: true,
   *   maxAttempts: 3,
   *   backoff: 'exponential',
   *   backoffMs: 1000,
   *   retryOn: [500, 502, 503, 504],
   * }
   * ```
   */
  retry?: RetryConfig;
  
  /**
   * Debug configuration for development logging.
   * Disabled by default. Only enable in development.
   * 
   * @example
   * ```ts
   * // Simple - enable all logging
   * debug: { enabled: process.env.NODE_ENV === 'development' }
   * 
   * // Custom - only log timing
   * debug: {
   *   enabled: true,
   *   logRequests: false,
   *   logResponses: false,
   *   logTiming: true,
   * }
   * ```
   */
  debug?: DebugConfig;
  
  /** i18n configuration - auto-append locale to API requests */
  i18n?: I18nConfig & {
    /** Query parameter name (default: 'lang') */
    paramName?: string;
  };
  
  /**
   * Request deduplication configuration.
   * Prevents multiple identical in-flight requests.
   * 
   * @example
   * ```ts
   * dedupe: {
   *   enabled: true,      // Enable deduplication
   *   methods: ['GET'],   // Only dedupe GET requests (default)
   * }
   * ```
   */
  dedupe?: {
    /** Enable request deduplication (default: false) */
    enabled: boolean;
    /** 
     * HTTP methods to deduplicate (default: ['GET'])
     * Note: Mutations (POST, PUT, etc.) should generally not be deduplicated
     */
    methods?: string[];
  };
  
  /**
   * Request ID configuration for request tracing.
   * Adds X-Request-ID header to all requests.
   * 
   * @example
   * ```ts
   * // Enable auto-generated request IDs
   * requestId: { enabled: true }
   * 
   * // Custom header name
   * requestId: {
   *   enabled: true,
   *   headerName: 'X-Correlation-ID',
   * }
   * ```
   */
  requestId?: {
    /** Enable request ID generation (default: false) */
    enabled: boolean;
    /** Header name for the request ID (default: 'X-Request-ID') */
    headerName?: string;
    /** Custom generator function (default: crypto.randomUUID) */
    generator?: () => string;
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
  /** Override timeout for this request (milliseconds) */
  timeout?: number;
  /** Override retry settings for this request */
  retry?: boolean | RetryConfig;
  /** 
   * Override deduplication for this request.
   * Set to false to force a fresh request even if one is in-flight.
   */
  dedupe?: boolean;
  /** Custom request ID for tracing. If true, auto-generates one. */
  requestId?: string | boolean;
}

export interface ApiClient {
  get: (endpoint: string, options?: RequestOptions) => Promise<Response>;
  post: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) => Promise<Response>;
  put: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) => Promise<Response>;
  patch: (endpoint: string, body?: Record<string, unknown>, options?: RequestOptions) => Promise<Response>;
  delete: (endpoint: string, options?: RequestOptions) => Promise<Response>;
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
    methodSpoofing: methodSpoofingConfig,
    timeout: globalTimeout = 30000,
    defaultHeaders: globalDefaultHeaders = {},
    errorMessages = {},
    retry: retryConfig,
    debug: debugConfig,
    dedupe: dedupeConfig,
    requestId: requestIdConfig,
    i18n,
  } = config;
  
  // Parse methodSpoofing config
  const methodSpoofing = typeof methodSpoofingConfig === 'boolean'
    ? { enabled: methodSpoofingConfig, strategy: 'body' as const, fieldName: '_method' }
    : methodSpoofingConfig
      ? { strategy: 'body' as const, fieldName: '_method', ...methodSpoofingConfig }
      : { enabled: false, strategy: 'body' as const, fieldName: '_method' };
  
  // Parse retry config with defaults
  const globalRetry: Required<RetryConfig> = {
    enabled: retryConfig?.enabled ?? false,
    maxAttempts: retryConfig?.maxAttempts ?? 3,
    backoff: retryConfig?.backoff ?? 'exponential',
    backoffMs: retryConfig?.backoffMs ?? 1000,
    retryOn: retryConfig?.retryOn ?? [408, 429, 500, 502, 503, 504],
    retryOnNetworkError: retryConfig?.retryOnNetworkError ?? true,
  };
  
  // Parse debug config with defaults
  const debug: Required<Omit<DebugConfig, 'logger'>> & { logger?: DebugConfig['logger'] } = {
    enabled: debugConfig?.enabled ?? false,
    logRequests: debugConfig?.logRequests ?? true,
    logResponses: debugConfig?.logResponses ?? true,
    logTiming: debugConfig?.logTiming ?? true,
    logHeaders: debugConfig?.logHeaders ?? false,
    logBody: debugConfig?.logBody ?? false,
    bodyPreviewLength: debugConfig?.bodyPreviewLength ?? 200,
    logger: debugConfig?.logger,
  };
  
  // Parse dedupe config with defaults
  const dedupe = {
    enabled: dedupeConfig?.enabled ?? false,
    methods: dedupeConfig?.methods ?? ['GET'],
  };
  
  // Parse requestId config with defaults
  const requestIdSettings = {
    enabled: requestIdConfig?.enabled ?? false,
    headerName: requestIdConfig?.headerName ?? 'X-Request-ID',
    generator: requestIdConfig?.generator ?? (() => crypto.randomUUID()),
  };
  
  // In-flight request cache for deduplication
  const inFlightRequests = new Map<string, Promise<Response>>();
  
  // Ensure baseUrl ends with /
  const baseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  
  // Create sanitizer
  const sanitizer = createSanitizer(config.sanitization);
  
  // Error messages
  const noTokenMessage = errorMessages.noToken ?? 'Token not found. Please log in.';
  const connectionErrorMessage = errorMessages.connectionError ?? 'Connection error occurred.';
  const serverErrorMessage = errorMessages.serverError ?? 'Server error occurred.';
  const timeoutMessage = errorMessages.timeout ?? 'Request timed out.';

  /**
   * Generate cache key for deduplication
   */
  function generateDedupeKey(method: string, endpoint: string): string {
    return `${method}:${endpoint}`;
  }

  /**
   * Debug logger
   */
  function debugLog(message: string, data?: Record<string, unknown>): void {
    if (!debug.enabled) return;
    
    if (debug.logger) {
      debug.logger(message, data);
      return;
    }
    
    // Default console logging with formatting
    const timestamp = new Date().toISOString();
    const prefix = `[next-api-layer] ${timestamp}`;
    
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Format body preview for logging
   */
  function formatBodyPreview(body: unknown): string {
    if (!body) return '(empty)';
    
    if (body instanceof FormData) {
      const entries: string[] = [];
      body.forEach((value, key) => {
        if (value instanceof File) {
          entries.push(`${key}: [File: ${value.name}]`);
        } else {
          const strValue = String(value);
          entries.push(`${key}: ${strValue.substring(0, 50)}${strValue.length > 50 ? '...' : ''}`);
        }
      });
      return `FormData { ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', ...' : ''} }`;
    }
    
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (str.length <= debug.bodyPreviewLength) return str;
    return `${str.substring(0, debug.bodyPreviewLength)}...`;
  }

  /**
   * Calculate delay for retry attempt
   */
  function calculateRetryDelay(attempt: number, retrySettings: Required<RetryConfig>): number {
    const { backoff, backoffMs } = retrySettings;
    switch (backoff) {
      case 'exponential':
        return backoffMs * Math.pow(2, attempt - 1);
      case 'linear':
        return backoffMs * attempt;
      case 'fixed':
      default:
        return backoffMs;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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
   * Resolve retry settings for a request
   */
  function resolveRetrySettings(options: RequestOptions): Required<RetryConfig> {
    if (options.retry === false) {
      return { ...globalRetry, enabled: false };
    }
    if (options.retry === true) {
      return { ...globalRetry, enabled: true };
    }
    if (typeof options.retry === 'object') {
      return {
        enabled: options.retry.enabled ?? globalRetry.enabled,
        maxAttempts: options.retry.maxAttempts ?? globalRetry.maxAttempts,
        backoff: options.retry.backoff ?? globalRetry.backoff,
        backoffMs: options.retry.backoffMs ?? globalRetry.backoffMs,
        retryOn: options.retry.retryOn ?? globalRetry.retryOn,
        retryOnNetworkError: options.retry.retryOnNetworkError ?? globalRetry.retryOnNetworkError,
      };
    }
    return globalRetry;
  }

  /**
   * Execute a single fetch request
   */
  async function executeFetch(
    url: string,
    actualMethod: string,
    fetchHeaders: HeadersInit,
    fetchBody: string | FormData | undefined,
    timeoutMs: number
  ): Promise<{ response?: Response; error?: Error; isTimeout?: boolean }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchResponse = await fetch(url, {
        method: actualMethod,
        headers: fetchHeaders,
        body: fetchBody,
        cache: 'no-store',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return { response: fetchResponse };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return { isTimeout: true };
      }
      
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Make a fetch request to backend with retry and deduplication support
   */
  async function makeRequest(
    method: string,
    endpoint: string,
    body?: Record<string, unknown> | FormData | null,
    options: RequestOptions = {}
  ): Promise<Response> {
    // Check for deduplication
    const shouldDedupe = options.dedupe !== false && 
                         dedupe.enabled && 
                         dedupe.methods.includes(method) &&
                         !body; // Don't dedupe requests with body
    
    const dedupeKey = shouldDedupe ? generateDedupeKey(method, endpoint) : null;
    
    // If there's an in-flight request, return it
    if (dedupeKey) {
      const inFlight = inFlightRequests.get(dedupeKey);
      if (inFlight) {
        if (debug.enabled) {
          debugLog(`⟳ ${method} ${endpoint} - Returning in-flight request`);
        }
        return inFlight;
      }
    }
    
    // Create the actual request promise
    const requestPromise = executeRequest(method, endpoint, body, options);
    
    // Store in cache if deduplication is enabled
    if (dedupeKey) {
      inFlightRequests.set(dedupeKey, requestPromise);
      
      // Clean up after completion
      requestPromise.finally(() => {
        inFlightRequests.delete(dedupeKey);
      });
    }
    
    return requestPromise;
  }

  /**
   * Execute the actual request (separated for deduplication)
   */
  async function executeRequest(
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

    // Get retry settings
    const retrySettings = resolveRetrySettings(options);
    const timeoutMs = options.timeout ?? globalTimeout;

    // Prepare request
    const fetchHeaders: HeadersInit = { ...globalDefaultHeaders };
    
    // Add auth header if we have a token
    if (token) {
      fetchHeaders['Authorization'] = `Bearer ${token}`;
    }
    
    // Add request ID header for tracing
    const requestId = typeof options.requestId === 'string' 
      ? options.requestId 
      : (options.requestId === true || requestIdSettings.enabled) 
        ? requestIdSettings.generator() 
        : null;
    
    if (requestId) {
      fetchHeaders[requestIdSettings.headerName] = requestId;
    }

    let fetchBody: string | FormData | undefined;
    let actualMethod = method;
    
    // Determine if method spoofing should be used
    const useMethodSpoofing = options.methodSpoofing ?? methodSpoofing.enabled;
    const spoofableMethods = ['PUT', 'PATCH', 'DELETE'];

    // Handle body
    if (body) {
      if (options.isFormData && body instanceof FormData) {
        // FormData - sanitize (unless skipped) and optionally add method spoofing
        if (options.skipSanitize) {
          fetchBody = body;
        } else {
          fetchBody = sanitizer.sanitizeFormData(body, options.skipSanitizeFields);
        }
        
        // Method spoofing for FormData (body strategy only)
        if (useMethodSpoofing && spoofableMethods.includes(method) && methodSpoofing.strategy === 'body') {
          (fetchBody as FormData).append(methodSpoofing.fieldName, method);
          actualMethod = 'POST';
        }
      } else if (!(body instanceof FormData)) {
        // JSON body
        fetchHeaders['Content-Type'] = 'application/json';
        
        let jsonBody = options.skipSanitize ? body : sanitizer.sanitize(body, options.skipSanitizeFields);
        
        // Method spoofing for JSON body (body strategy)
        if (useMethodSpoofing && spoofableMethods.includes(method) && methodSpoofing.strategy === 'body') {
          jsonBody = { ...jsonBody, [methodSpoofing.fieldName]: method };
          actualMethod = 'POST';
        }
        
        fetchBody = JSON.stringify(jsonBody);
      }
    } else if (useMethodSpoofing && spoofableMethods.includes(method)) {
      // No body but method spoofing needed
      if (methodSpoofing.strategy === 'body') {
        fetchHeaders['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify({ [methodSpoofing.fieldName]: method });
        actualMethod = 'POST';
      }
    }
    
    // Header strategy for method spoofing (works with or without body)
    if (useMethodSpoofing && spoofableMethods.includes(method) && methodSpoofing.strategy === 'header') {
      fetchHeaders['X-HTTP-Method-Override'] = method;
      actualMethod = 'POST';
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

    // Debug: Log request
    const requestStartTime = debug.enabled && debug.logTiming ? performance.now() : 0;
    if (debug.enabled && debug.logRequests) {
      const logData: Record<string, unknown> = {
        method: actualMethod,
        url,
        timeout: timeoutMs,
      };
      if (requestId) {
        logData.requestId = requestId;
      }
      if (debug.logHeaders) {
        logData.headers = fetchHeaders;
      }
      if (debug.logBody && fetchBody) {
        logData.body = formatBodyPreview(fetchBody);
      }
      debugLog(`→ ${method} ${endpoint}`, logData);
    }

    // Execute with retry
    let lastError: Error | null = null;
    let lastStatus: number | null = null;
    const maxAttempts = retrySettings.enabled ? retrySettings.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await executeFetch(url, actualMethod, fetchHeaders, fetchBody, timeoutMs);

      // Handle timeout
      if (result.isTimeout) {
        lastStatus = 408;
        if (debug.enabled) {
          debugLog(`✗ ${method} ${endpoint} - Timeout (attempt ${attempt}/${maxAttempts})`);
        }
        if (retrySettings.enabled && retrySettings.retryOn.includes(408) && attempt < maxAttempts) {
          const delay = calculateRetryDelay(attempt, retrySettings);
          if (debug.enabled) {
            debugLog(`↻ Retrying in ${delay}ms...`);
          }
          await sleep(delay);
          continue;
        }
        console.error(`API ${method} Timeout:`, endpoint);
        return errorResponse(timeoutMessage, 408);
      }

      // Handle network error
      if (result.error) {
        lastError = result.error;
        if (debug.enabled) {
          debugLog(`✗ ${method} ${endpoint} - Network error: ${result.error.message}`);
        }
        if (retrySettings.enabled && retrySettings.retryOnNetworkError && attempt < maxAttempts) {
          const delay = calculateRetryDelay(attempt, retrySettings);
          if (debug.enabled) {
            debugLog(`↻ Retrying in ${delay}ms...`);
          }
          await sleep(delay);
          continue;
        }
        console.error(`API ${method} Error:`, result.error);
        return errorResponse(connectionErrorMessage);
      }

      // We have a response
      const fetchResponse = result.response!;
      lastStatus = fetchResponse.status;

      // Handle server errors with potential retry
      if (fetchResponse.status >= 500) {
        if (debug.enabled) {
          debugLog(`✗ ${method} ${endpoint} - Server error ${fetchResponse.status}`);
        }
        if (retrySettings.enabled && retrySettings.retryOn.includes(fetchResponse.status) && attempt < maxAttempts) {
          const delay = calculateRetryDelay(attempt, retrySettings);
          if (debug.enabled) {
            debugLog(`↻ Retrying in ${delay}ms...`);
          }
          await sleep(delay);
          continue;
        }
        console.error(`API ${method} Server Error:`, fetchResponse.status);
        return errorResponse(serverErrorMessage, fetchResponse.status);
      }

      // Handle rate limit with potential retry
      if (fetchResponse.status === 429) {
        if (debug.enabled) {
          debugLog(`✗ ${method} ${endpoint} - Rate limited (429)`);
        }
        if (retrySettings.enabled && retrySettings.retryOn.includes(429) && attempt < maxAttempts) {
          // Try to use Retry-After header
          const retryAfter = fetchResponse.headers.get('Retry-After');
          const delay = retryAfter 
            ? parseInt(retryAfter, 10) * 1000 
            : calculateRetryDelay(attempt, retrySettings);
          if (debug.enabled) {
            debugLog(`↻ Retrying in ${delay}ms...`);
          }
          await sleep(delay);
          continue;
        }
      }

      // Success or non-retryable error - return response
      const responseData = await fetchResponse.json();
      
      // Debug: Log response
      if (debug.enabled && debug.logResponses) {
        const duration = debug.logTiming ? Math.round(performance.now() - requestStartTime) : undefined;
        const logData: Record<string, unknown> = {
          status: fetchResponse.status,
        };
        if (duration !== undefined) {
          logData.duration = `${duration}ms`;
        }
        if (debug.logBody) {
          logData.body = formatBodyPreview(responseData);
        }
        const statusSymbol = fetchResponse.status >= 200 && fetchResponse.status < 300 ? '✓' : '✗';
        debugLog(`${statusSymbol} ${method} ${endpoint} - ${fetchResponse.status}`, logData);
      }
      
      return Response.json(responseData, { status: fetchResponse.status });
    }

    // All retries exhausted
    if (debug.enabled) {
      debugLog(`✗ ${method} ${endpoint} - All ${maxAttempts} retry attempts exhausted`);
    }
    
    if (lastError) {
      console.error(`API ${method} Error (all retries exhausted):`, lastError);
      return errorResponse(connectionErrorMessage);
    }
    
    if (lastStatus === 408) {
      return errorResponse(timeoutMessage, 408);
    }
    
    return errorResponse(serverErrorMessage, lastStatus || 500);
  }

  // Return API client interface
  return {
    get: (endpoint: string, options?: RequestOptions) => 
      makeRequest('GET', endpoint, null, options),
    
    post: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) =>
      makeRequest('POST', endpoint, body, options),
    
    put: (endpoint: string, body?: Record<string, unknown> | FormData, options?: RequestOptions) =>
      makeRequest('PUT', endpoint, body, options),
    
    patch: (endpoint: string, body?: Record<string, unknown>, options?: RequestOptions) =>
      makeRequest('PATCH', endpoint, body, options),
    
    delete: (endpoint: string, options?: RequestOptions) => 
      makeRequest('DELETE', endpoint, null, options),
  };
}
