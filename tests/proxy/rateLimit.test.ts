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
});
