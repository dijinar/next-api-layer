/**
 * Custom error classes for next-api-layer
 * These provide typed errors for better error handling
 */

/**
 * Base error class for all API layer errors
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;

  constructor(message: string, code: string = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * HTTP error with status code
 * Thrown when API returns non-2xx response
 */
export class HttpError extends ApiError {
  public readonly status: number;
  public readonly statusText: string;
  public readonly response?: unknown;

  constructor(
    message: string,
    status: number,
    options?: {
      statusText?: string;
      response?: unknown;
      code?: string;
    }
  ) {
    const code = options?.code || `HTTP_${status}`;
    super(message, code);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = options?.statusText || getStatusText(status);
    this.response = options?.response;
  }

  /** Check if error is a client error (4xx) */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** Check if error is a server error (5xx) */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      status: this.status,
      statusText: this.statusText,
      response: this.response,
    };
  }
}

/**
 * Timeout error (408)
 * Thrown when request exceeds configured timeout
 */
export class TimeoutError extends HttpError {
  public readonly timeoutMs: number;
  public readonly endpoint: string;

  constructor(
    endpoint: string,
    timeoutMs: number,
    message?: string
  ) {
    super(
      message || `Request to '${endpoint}' timed out after ${timeoutMs}ms`,
      408,
      { code: 'TIMEOUT', statusText: 'Request Timeout' }
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs,
      endpoint: this.endpoint,
    };
  }
}

/**
 * Network error
 * Thrown when request fails due to network issues (no response received)
 */
export class NetworkError extends ApiError {
  public readonly endpoint: string;
  public readonly cause?: Error;

  constructor(
    endpoint: string,
    options?: {
      message?: string;
      cause?: Error;
    }
  ) {
    super(
      options?.message || `Network error while requesting '${endpoint}'`,
      'NETWORK_ERROR'
    );
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.cause = options?.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      cause: this.cause?.message,
    };
  }
}

/**
 * Authentication error (401)
 * Thrown when no token is available or token is invalid
 */
export class AuthError extends HttpError {
  public readonly reason: 'no_token' | 'invalid_token' | 'expired_token';

  constructor(
    reason: 'no_token' | 'invalid_token' | 'expired_token',
    message?: string
  ) {
    const defaultMessages = {
      no_token: 'Authentication required',
      invalid_token: 'Invalid authentication token',
      expired_token: 'Authentication token has expired',
    };
    
    super(message || defaultMessages[reason], 401, {
      code: `AUTH_${reason.toUpperCase()}`,
      statusText: 'Unauthorized',
    });
    this.name = 'AuthError';
    this.reason = reason;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      reason: this.reason,
    };
  }
}

/**
 * Validation error
 * Thrown when response doesn't match expected schema (future: Zod integration)
 */
export class ValidationError extends ApiError {
  public readonly endpoint: string;
  public readonly errors: Record<string, string[]>;

  constructor(
    endpoint: string,
    errors: Record<string, string[]>,
    message?: string
  ) {
    super(
      message || `Validation failed for '${endpoint}'`,
      'VALIDATION_ERROR'
    );
    this.name = 'ValidationError';
    this.endpoint = endpoint;
    this.errors = errors;
  }

  /** Get all error messages as flat array */
  get allMessages(): string[] {
    return Object.values(this.errors).flat();
  }

  /** Get first error message */
  get firstMessage(): string | undefined {
    return this.allMessages[0];
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      errors: this.errors,
    };
  }
}

/**
 * Rate limit error (429)
 * Thrown when rate limit is exceeded
 */
export class RateLimitError extends HttpError {
  public readonly retryAfter?: number;
  public readonly limit?: number;
  public readonly remaining?: number;

  constructor(options?: {
    message?: string;
    retryAfter?: number;
    limit?: number;
    remaining?: number;
  }) {
    super(
      options?.message || 'Too many requests',
      429,
      { code: 'RATE_LIMITED', statusText: 'Too Many Requests' }
    );
    this.name = 'RateLimitError';
    this.retryAfter = options?.retryAfter;
    this.limit = options?.limit;
    this.remaining = options?.remaining;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfter: this.retryAfter,
      limit: this.limit,
      remaining: this.remaining,
    };
  }
}

// ==================== Helper Functions ====================

/**
 * Get standard HTTP status text
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return statusTexts[status] || 'Unknown Error';
}

/**
 * Type guard to check if error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Type guard to check if error is an HttpError
 */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

/**
 * Type guard to check if error is a TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Type guard to check if error is a NetworkError
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Type guard to check if error is an AuthError
 */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/**
 * Type guard to check if error is a RateLimitError
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * Check if status code is retryable
 */
export function isRetryableStatus(status: number): boolean {
  // Retry on: timeout, rate limit, server errors
  return [408, 429, 500, 502, 503, 504].includes(status);
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  if (isNetworkError(error)) return true;
  if (isRateLimitError(error)) return true;
  if (isHttpError(error)) return isRetryableStatus(error.status);
  return false;
}
