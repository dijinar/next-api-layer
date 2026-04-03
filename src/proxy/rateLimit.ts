/**
 * Rate Limiting
 * 
 * Implements token bucket algorithm for rate limiting.
 * In-memory store by default, designed for single-instance deployments.
 * 
 * For horizontal scaling (multiple instances), use a custom store
 * with Redis or similar distributed cache.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ResolvedRateLimitConfig } from '../shared/types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Creates a rate limiter with in-memory store
 */
export function createRateLimiter(config: ResolvedRateLimitConfig) {
  // In-memory store
  const store = new Map<string, RateLimitEntry>();
  
  // Cleanup expired entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, config.windowMs);

  // Prevent memory leak in long-running processes
  if (typeof process !== 'undefined' && process.on) {
    process.on('beforeExit', () => clearInterval(cleanupInterval));
  }

  /**
   * Check if route should skip rate limiting
   */
  function shouldSkip(pathname: string): boolean {
    return config.skipRoutes.some(pattern => {
      // Simple glob matching
      if (pattern.endsWith('*')) {
        return pathname.startsWith(pattern.slice(0, -1));
      }
      if (pattern.endsWith('**')) {
        return pathname.startsWith(pattern.slice(0, -2));
      }
      return pathname === pattern;
    });
  }

  /**
   * Check rate limit for request
   */
  function check(req: NextRequest): RateLimitResult {
    const pathname = req.nextUrl.pathname;
    
    // Skip if route matches skip patterns
    if (shouldSkip(pathname)) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: 0,
        limit: config.maxRequests,
      };
    }

    const key = config.keyFn(req);
    const now = Date.now();
    
    let entry = store.get(key);
    
    // New window or expired
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      store.set(key, entry);
      
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: entry.resetAt,
        limit: config.maxRequests,
      };
    }

    // Existing window
    entry.count++;
    
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const allowed = entry.count <= config.maxRequests;
    
    return {
      allowed,
      remaining,
      resetAt: entry.resetAt,
      limit: config.maxRequests,
    };
  }

  /**
   * Apply rate limit headers to response
   */
  function applyHeaders(response: NextResponse, result: RateLimitResult): NextResponse {
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());
    return response;
  }

  /**
   * Create rate limited response (429 Too Many Requests)
   */
  function createLimitedResponse(req: NextRequest, result: RateLimitResult): NextResponse {
    // User-provided handler
    if (config.onRateLimited) {
      const response = config.onRateLimited(req);
      return applyHeaders(response, result);
    }

    // Default response
    const response = NextResponse.json(
      {
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );

    response.headers.set('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
    return applyHeaders(response, result);
  }

  /**
   * Reset rate limit for a key (useful for testing)
   */
  function reset(key: string): void {
    store.delete(key);
  }

  /**
   * Clear all rate limit entries
   */
  function clear(): void {
    store.clear();
  }

  /**
   * Get current store size (for monitoring)
   */
  function size(): number {
    return store.size;
  }

  return {
    check,
    applyHeaders,
    createLimitedResponse,
    shouldSkip,
    reset,
    clear,
    size,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
