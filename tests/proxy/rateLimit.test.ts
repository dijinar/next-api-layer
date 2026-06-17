import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createRateLimiter } from '../../src/proxy/rateLimit';
import type { ResolvedRateLimitConfig } from '../../src/shared/types';

function getConfig(overrides?: Partial<ResolvedRateLimitConfig>): ResolvedRateLimitConfig {
  return {
    enabled: true,
    windowMs: 1000,
    maxRequests: 3,
    keyFn: req => req.headers.get('x-forwarded-for') || 'unknown',
    skipRoutes: [],
    skipPrefetch: true,
    ipHeaders: ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for'],
    onRateLimited: undefined,
    ...overrides,
  };
}

describe('createRateLimiter', () => {
  it('allows requests under limit', () => {
    const limiter = createRateLimiter(getConfig());
    const req = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });

    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).allowed).toBe(true);
  });

  it('blocks requests over limit', () => {
    const limiter = createRateLimiter(getConfig({ maxRequests: 2 }));
    const req = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });

    limiter.check(req);
    limiter.check(req);
    const blocked = limiter.check(req);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different keys separately', () => {
    const limiter = createRateLimiter(getConfig({ maxRequests: 1 }));

    const reqA = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '3.3.3.3' },
    });
    const reqB = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '4.4.4.4' },
    });

    expect(limiter.check(reqA).allowed).toBe(true);
    expect(limiter.check(reqA).allowed).toBe(false);

    expect(limiter.check(reqB).allowed).toBe(true);
  });

  describe('prefetch handling', () => {
    const prefetchHeaders = [
      { 'next-router-prefetch': '1' },
      { 'sec-purpose': 'prefetch' },
      { 'sec-purpose': 'prefetch;prerender' },
      { purpose: 'prefetch' },
      { 'x-purpose': 'prefetch' },
      { 'x-moz': 'prefetch' },
    ];

    it.each(prefetchHeaders)('does not count prefetch requests (%o)', headers => {
      const limiter = createRateLimiter(getConfig({ maxRequests: 1 }));
      const req = new NextRequest('http://localhost/dashboard', {
        headers: { 'x-forwarded-for': '5.5.5.5', ...headers },
      });

      // Many prefetches must never consume the budget
      limiter.check(req);
      limiter.check(req);
      expect(limiter.check(req).allowed).toBe(true);

      // A real navigation from the same IP is still counted
      const realReq = new NextRequest('http://localhost/dashboard', {
        headers: { 'x-forwarded-for': '5.5.5.5' },
      });
      expect(limiter.check(realReq).allowed).toBe(true);
      expect(limiter.check(realReq).allowed).toBe(false);
    });

    it('counts prefetch requests when skipPrefetch is false', () => {
      const limiter = createRateLimiter(getConfig({ maxRequests: 1, skipPrefetch: false }));
      const req = new NextRequest('http://localhost/dashboard', {
        headers: { 'x-forwarded-for': '6.6.6.6', 'next-router-prefetch': '1' },
      });

      expect(limiter.check(req).allowed).toBe(true);
      expect(limiter.check(req).allowed).toBe(false);
    });

    it('counts state-changing (POST) requests even with a prefetch header', () => {
      // Prefetches are always GET/HEAD; a POST carrying a forged prefetch
      // header must never bypass the limiter.
      const limiter = createRateLimiter(getConfig({ maxRequests: 1 }));
      const make = () =>
        new NextRequest('http://localhost/api/transfer', {
          method: 'POST',
          headers: { 'x-forwarded-for': '7.7.7.7', 'next-router-prefetch': '1' },
        });

      expect(limiter.check(make()).allowed).toBe(true);
      expect(limiter.check(make()).allowed).toBe(false);
    });
  });
});
