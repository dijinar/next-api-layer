import { describe, expect, it } from 'vitest';
import {
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
} from '../../src/shared/errors';

describe('Error Classes', () => {
  describe('ApiError', () => {
    it('should create base error with message and code', () => {
      const error = new ApiError('Test error', 'TEST_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('ApiError');
      expect(error instanceof Error).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should be stackable', () => {
      const error = new ApiError('Test error', 'TEST_ERROR');
      expect(error.stack).toBeDefined();
    });

    it('should have toJSON method', () => {
      const error = new ApiError('Test error', 'TEST_ERROR');
      const json = error.toJSON();
      expect(json.name).toBe('ApiError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe('TEST_ERROR');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('HttpError', () => {
    it('should create error with status and auto-generated code', () => {
      const error = new HttpError('Not found', 404);
      expect(error.message).toBe('Not found');
      expect(error.status).toBe(404);
      expect(error.code).toBe('HTTP_404');
      expect(error.name).toBe('HttpError');
      expect(error.statusText).toBe('Not Found');
    });

    it('should allow custom code in options', () => {
      const error = new HttpError('Not found', 404, { code: 'CUSTOM_CODE' });
      expect(error.code).toBe('CUSTOM_CODE');
    });

    it('should inherit from ApiError', () => {
      const error = new HttpError('Server error', 500);
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should detect client errors', () => {
      const error = new HttpError('Bad Request', 400);
      expect(error.isClientError).toBe(true);
      expect(error.isServerError).toBe(false);
    });

    it('should detect server errors', () => {
      const error = new HttpError('Server Error', 500);
      expect(error.isClientError).toBe(false);
      expect(error.isServerError).toBe(true);
    });
  });

  describe('TimeoutError', () => {
    it('should create with endpoint and timeout info', () => {
      const error = new TimeoutError('/api/test', 5000);
      expect(error.message).toBe("Request to '/api/test' timed out after 5000ms");
      expect(error.timeoutMs).toBe(5000);
      expect(error.endpoint).toBe('/api/test');
      expect(error.code).toBe('TIMEOUT');
      expect(error.name).toBe('TimeoutError');
      expect(error.status).toBe(408);
    });

    it('should inherit from HttpError', () => {
      const error = new TimeoutError('/api/test', 5000);
      expect(error instanceof HttpError).toBe(true);
      expect(error instanceof ApiError).toBe(true);
    });

    it('should allow custom message', () => {
      const error = new TimeoutError('/api/test', 5000, 'Custom timeout message');
      expect(error.message).toBe('Custom timeout message');
    });
  });

  describe('NetworkError', () => {
    it('should create with endpoint', () => {
      const error = new NetworkError('/api/test');
      expect(error.message).toBe("Network error while requesting '/api/test'");
      expect(error.endpoint).toBe('/api/test');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.name).toBe('NetworkError');
    });

    it('should accept cause error', () => {
      const original = new TypeError('fetch failed');
      const error = new NetworkError('/api/test', { cause: original });
      expect(error.cause).toBe(original);
    });

    it('should allow custom message', () => {
      const error = new NetworkError('/api/test', { message: 'Connection lost' });
      expect(error.message).toBe('Connection lost');
    });
  });

  describe('AuthError', () => {
    it('should create with no_token reason', () => {
      const error = new AuthError('no_token');
      expect(error.message).toBe('Authentication required');
      expect(error.reason).toBe('no_token');
      expect(error.status).toBe(401);
      expect(error.code).toBe('AUTH_NO_TOKEN');
      expect(error.name).toBe('AuthError');
    });

    it('should handle invalid_token reason', () => {
      const error = new AuthError('invalid_token');
      expect(error.message).toBe('Invalid authentication token');
      expect(error.reason).toBe('invalid_token');
      expect(error.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('should handle expired_token reason', () => {
      const error = new AuthError('expired_token');
      expect(error.message).toBe('Authentication token has expired');
      expect(error.reason).toBe('expired_token');
      expect(error.code).toBe('AUTH_EXPIRED_TOKEN');
    });

    it('should allow custom message', () => {
      const error = new AuthError('no_token', 'Please log in first');
      expect(error.message).toBe('Please log in first');
    });
  });

  describe('ValidationError', () => {
    it('should create with endpoint and errors', () => {
      const errors = { email: ['Invalid email'], name: ['Required'] };
      const error = new ValidationError('/api/register', errors);
      expect(error.message).toBe("Validation failed for '/api/register'");
      expect(error.endpoint).toBe('/api/register');
      expect(error.errors).toEqual(errors);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.name).toBe('ValidationError');
    });

    it('should provide allMessages helper', () => {
      const errors = { email: ['Invalid email'], name: ['Required', 'Too short'] };
      const error = new ValidationError('/api/test', errors);
      expect(error.allMessages).toEqual(['Invalid email', 'Required', 'Too short']);
    });

    it('should provide firstMessage helper', () => {
      const errors = { email: ['Invalid email'], name: ['Required'] };
      const error = new ValidationError('/api/test', errors);
      expect(error.firstMessage).toBe('Invalid email');
    });

    it('should allow custom message', () => {
      const error = new ValidationError('/api/test', {}, 'Custom validation error');
      expect(error.message).toBe('Custom validation error');
    });
  });

  describe('RateLimitError', () => {
    it('should create with default message', () => {
      const error = new RateLimitError();
      expect(error.message).toBe('Too many requests');
      expect(error.status).toBe(429);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.name).toBe('RateLimitError');
    });

    it('should accept retry info', () => {
      const error = new RateLimitError({ retryAfter: 60, limit: 100, remaining: 0 });
      expect(error.retryAfter).toBe(60);
      expect(error.limit).toBe(100);
      expect(error.remaining).toBe(0);
    });

    it('should allow custom message', () => {
      const error = new RateLimitError({ message: 'Slow down!' });
      expect(error.message).toBe('Slow down!');
    });
  });
});

describe('Type Guards', () => {
  describe('isApiError', () => {
    it('should return true for ApiError instances', () => {
      expect(isApiError(new ApiError('test', 'TEST'))).toBe(true);
      expect(isApiError(new HttpError('test', 404))).toBe(true);
      expect(isApiError(new TimeoutError('/api', 1000))).toBe(true);
      expect(isApiError(new NetworkError('/api'))).toBe(true);
      expect(isApiError(new AuthError('no_token'))).toBe(true);
      expect(isApiError(new ValidationError('/api', {}))).toBe(true);
      expect(isApiError(new RateLimitError())).toBe(true);
    });

    it('should return false for non-ApiError', () => {
      expect(isApiError(new Error('test'))).toBe(false);
      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
      expect(isApiError('string')).toBe(false);
      expect(isApiError({ message: 'test', code: 'TEST' })).toBe(false);
    });
  });

  describe('isHttpError', () => {
    it('should return true for HttpError instances', () => {
      expect(isHttpError(new HttpError('test', 404))).toBe(true);
      expect(isHttpError(new TimeoutError('/api', 1000))).toBe(true);
      expect(isHttpError(new AuthError('no_token'))).toBe(true);
      expect(isHttpError(new RateLimitError())).toBe(true);
    });

    it('should return false for non-HttpError', () => {
      expect(isHttpError(new ApiError('test', 'TEST'))).toBe(false);
      expect(isHttpError(new NetworkError('/api'))).toBe(false);
      expect(isHttpError(new ValidationError('/api', {}))).toBe(false);
      expect(isHttpError(new Error('test'))).toBe(false);
    });
  });

  describe('isTimeoutError', () => {
    it('should identify TimeoutError', () => {
      expect(isTimeoutError(new TimeoutError('/api', 1000))).toBe(true);
      expect(isTimeoutError(new HttpError('test', 408))).toBe(false);
      expect(isTimeoutError(new Error('test'))).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('should identify NetworkError', () => {
      expect(isNetworkError(new NetworkError('/api'))).toBe(true);
      expect(isNetworkError(new TimeoutError('/api', 1000))).toBe(false);
      expect(isNetworkError(new Error('test'))).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should identify AuthError', () => {
      expect(isAuthError(new AuthError('no_token'))).toBe(true);
      expect(isAuthError(new HttpError('test', 401))).toBe(false);
      expect(isAuthError(new Error('test'))).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('should identify RateLimitError', () => {
      expect(isRateLimitError(new RateLimitError())).toBe(true);
      expect(isRateLimitError(new HttpError('test', 429))).toBe(false);
      expect(isRateLimitError(new Error('test'))).toBe(false);
    });
  });
});

describe('Utility Functions', () => {
  describe('isRetryableStatus', () => {
    it('should identify retryable status codes', () => {
      expect(isRetryableStatus(408)).toBe(true);
      expect(isRetryableStatus(429)).toBe(true);
      expect(isRetryableStatus(500)).toBe(true);
      expect(isRetryableStatus(502)).toBe(true);
      expect(isRetryableStatus(503)).toBe(true);
      expect(isRetryableStatus(504)).toBe(true);
    });

    it('should return false for non-retryable status codes', () => {
      expect(isRetryableStatus(200)).toBe(false);
      expect(isRetryableStatus(400)).toBe(false);
      expect(isRetryableStatus(401)).toBe(false);
      expect(isRetryableStatus(403)).toBe(false);
      expect(isRetryableStatus(404)).toBe(false);
      expect(isRetryableStatus(422)).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable errors', () => {
      expect(isRetryableError(new TimeoutError('/api', 1000))).toBe(true);
      expect(isRetryableError(new NetworkError('/api'))).toBe(true);
      expect(isRetryableError(new HttpError('test', 503))).toBe(true);
      expect(isRetryableError(new RateLimitError())).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(isRetryableError(new HttpError('test', 400))).toBe(false);
      expect(isRetryableError(new HttpError('test', 404))).toBe(false);
      expect(isRetryableError(new AuthError('no_token'))).toBe(false);
      expect(isRetryableError(new ValidationError('/api', {}))).toBe(false);
      expect(isRetryableError(new Error('test'))).toBe(false);
    });
  });
});
