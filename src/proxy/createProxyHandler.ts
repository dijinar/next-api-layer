/**
 * createProxyHandler
 * Factory function to create Next.js API route handlers that proxy requests to backend
 */

import { NextRequest, NextResponse } from 'next/server';
import { HEADERS } from '../shared/constants';

export interface ProxyHandlerConfig {
  /** Base URL of the backend API */
  apiBaseUrl: string;
  /** Cookie name for user auth token */
  userCookieName?: string;
  /** Cookie name for guest auth token */
  guestCookieName?: string;
  /** 
   * Default behavior for auth - if true, all requests skip auth by default
   * Individual requests can override with X-Skip-Auth header
   */
  skipAuthByDefault?: boolean;
  /**
   * Public endpoints that should never include auth token (glob patterns)
   * e.g., ['news/*', 'public/**', 'categories']
   */
  publicEndpoints?: string[];
  /** Headers to forward from client request */
  forwardHeaders?: string[];
  /** Headers to exclude from forwarding */
  excludeHeaders?: string[];
  /** Custom request transformer */
  transformRequest?: (req: NextRequest, headers: Headers) => Headers | Promise<Headers>;
  /** Custom response transformer */
  transformResponse?: (response: Response) => Response | Promise<Response>;
}

/**
 * Check if endpoint matches any patterns (glob support)
 */
function matchesPattern(endpoint: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  
  // Normalize endpoint
  const normalizedEndpoint = endpoint
    .replace(/^\/api\//, '')
    .replace(/^\//, '');
  
  return patterns.some(pattern => {
    if (pattern === normalizedEndpoint) return true;
    
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\*\*/g, '<<<DOUBLE>>>')
        .replace(/\*/g, '[^/]+')
        .replace(/<<<DOUBLE>>>/g, '.+');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedEndpoint);
    }
    
    return false;
  });
}

/**
 * Creates a proxy handler for Next.js API routes
 * 
 * @example
 * ```ts
 * // app/api/[...path]/route.ts
 * import { createProxyHandler } from 'next-api-layer';
 * 
 * const handler = createProxyHandler({
 *   apiBaseUrl: process.env.API_BASE_URL!,
 *   userCookieName: 'auth_token',
 *   guestCookieName: 'guest_token',
 *   publicEndpoints: ['news/*', 'categories', 'public/**'],
 * });
 * 
 * export const GET = handler;
 * export const POST = handler;
 * export const PUT = handler;
 * export const PATCH = handler;
 * export const DELETE = handler;
 * ```
 */
export function createProxyHandler(config: ProxyHandlerConfig) {
  const {
    apiBaseUrl,
    userCookieName = 'auth_token',
    guestCookieName = 'guest_token',
    skipAuthByDefault = false,
    publicEndpoints = [],
    forwardHeaders = ['content-type', 'accept', 'accept-language', 'x-requested-with'],
    excludeHeaders = ['host', 'connection', 'cookie'],
    transformRequest,
    transformResponse,
  } = config;

  // Normalize base URL (remove trailing slash)
  const baseUrl = apiBaseUrl.replace(/\/$/, '');

  /**
   * Determine if auth should be skipped for this request
   */
  function shouldSkipAuth(req: NextRequest, endpoint: string): boolean {
    // Check X-Skip-Auth header from client
    const skipAuthHeader = req.headers.get(HEADERS.SKIP_AUTH);
    if (skipAuthHeader === 'true') {
      return true;
    }
    
    // Check if endpoint matches public patterns
    if (matchesPattern(endpoint, publicEndpoints)) {
      return true;
    }
    
    // Default behavior
    return skipAuthByDefault;
  }

  /**
   * The proxy handler function
   */
  async function handler(req: NextRequest): Promise<NextResponse> {
    try {
      // Extract endpoint from URL path (remove /api/ prefix)
      const url = new URL(req.url);
      const endpoint = url.pathname.replace(/^\/api\/?/, '');
      
      // Build backend URL
      const backendUrl = new URL(`${baseUrl}/${endpoint}`);
      backendUrl.search = url.search; // Forward query params

      // Build headers for backend request
      const headers = new Headers();
      
      // Forward allowed headers from original request
      forwardHeaders.forEach(headerName => {
        const value = req.headers.get(headerName);
        if (value) {
          headers.set(headerName, value);
        }
      });

      // Forward all headers except excluded ones
      req.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (!excludeHeaders.includes(lowerKey) && !headers.has(key)) {
          headers.set(key, value);
        }
      });

      // Add Authorization header if auth is not skipped
      if (!shouldSkipAuth(req, endpoint)) {
        const userToken = req.cookies.get(userCookieName)?.value;
        const guestToken = req.cookies.get(guestCookieName)?.value;
        const token = userToken || guestToken;
        
        if (token) {
          headers.set(HEADERS.AUTHORIZATION, `Bearer ${token}`);
        }
      }

      // Remove skip-auth header (internal use only)
      headers.delete(HEADERS.SKIP_AUTH);

      // Allow custom request transformation
      const finalHeaders = transformRequest 
        ? await transformRequest(req, headers) 
        : headers;

      // Get request body if present
      let body: BodyInit | null = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const contentType = req.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          body = await req.text();
        } else if (contentType.includes('multipart/form-data')) {
          body = await req.formData();
        } else {
          body = await req.text();
        }
      }

      // Make request to backend
      const backendResponse = await fetch(backendUrl.toString(), {
        method: req.method,
        headers: finalHeaders,
        body,
      });

      // Get response body
      const contentType = backendResponse.headers.get('content-type') || '';
      let responseBody: ArrayBuffer | string;
      
      if (contentType.includes('application/json')) {
        responseBody = await backendResponse.text();
      } else {
        responseBody = await backendResponse.arrayBuffer();
      }

      // Build response headers (forward relevant ones)
      const responseHeaders = new Headers();
      backendResponse.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        // Skip hop-by-hop headers
        if (!['transfer-encoding', 'connection', 'keep-alive'].includes(lowerKey)) {
          responseHeaders.set(key, value);
        }
      });

      // Create response
      let response = new NextResponse(responseBody, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: responseHeaders,
      });

      // Allow custom response transformation
      if (transformResponse) {
        response = await transformResponse(response) as NextResponse;
      }

      return response;
    } catch (error) {
      console.error('[Proxy Error]', error);
      
      return NextResponse.json(
        { 
          success: false, 
          message: 'Proxy error: Unable to connect to backend',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 502 }
      );
    }
  }

  // Attach config for debugging
  handler.config = config;

  return handler;
}

export type ProxyHandler = ReturnType<typeof createProxyHandler>;
