import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAuthProxy } from '../../src/proxy/createAuthProxy';
import { createTokenValidation } from '../../src/proxy/tokenValidation';
import { resolveProxyConfig } from '../../src/shared/config';
import type { AuthProxyConfig } from '../../src/shared/types';

// ==================== Backend mock ====================

type Handler = (bearer: string | undefined) => Response;

interface Calls {
  validate: number;
  refresh: number;
  guest: number;
  refreshAuth: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockBackend(handlers: { validate?: Handler; refresh?: Handler; guest?: Handler }): Calls {
  const calls: Calls = { validate: 0, refresh: 0, guest: 0, refreshAuth: [] };
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bearer = headers['Authorization'];
    if (url.includes('auth/me')) {
      calls.validate++;
      return handlers.validate ? handlers.validate(bearer) : json({}, 401);
    }
    if (url.includes('auth/refresh')) {
      calls.refresh++;
      calls.refreshAuth.push(bearer ?? '');
      return handlers.refresh ? handlers.refresh(bearer) : json({}, 401);
    }
    if (url.includes('auth/guest')) {
      calls.guest++;
      return handlers.guest ? handlers.guest(bearer) : json({}, 401);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  return calls;
}

function reqWithCookies(path: string, cookies: Record<string, string>): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(`http://localhost${path}`, { headers: { cookie } });
}

const future = (s = 3600) => Math.floor(Date.now() / 1000) + s;

const baseConfig: AuthProxyConfig = {
  apiBaseUrl: 'http://backend.test',
  cookies: { user: 'userToken', guest: 'guestToken' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ==================== P1-1 · Single-flight ====================

describe('P1-1 · concurrent refresh single-flight', () => {
  it('coalesces 5 parallel refreshes into a single backend call', async () => {
    const calls = mockBackend({
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
      validate: () => json({ success: true, data: { type: 'user', exp: future(), id: 1 } }),
    });
    const v = createTokenValidation(resolveProxyConfig(baseConfig));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => v.refreshSession('oldT'))
    );

    expect(calls.refresh).toBe(1);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.newToken).toBe('newT');
      expect(r.tokenInfo?.isValid).toBe(true);
    }
  });

  it('does NOT coalesce when singleFlight is disabled', async () => {
    const calls = mockBackend({
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
      validate: () => json({ success: true, data: { type: 'user', exp: future(), id: 1 } }),
    });
    const v = createTokenValidation(
      resolveProxyConfig({ ...baseConfig, refresh: { singleFlight: false } })
    );

    await Promise.all(Array.from({ length: 3 }, () => v.refreshSession('oldT')));
    expect(calls.refresh).toBe(3);
  });
});

// ==================== P1-2 · Reason classification ====================

describe('P1-2 · refresh-fail reason classification', () => {
  const v = () => createTokenValidation(resolveProxyConfig(baseConfig));

  it('classifies 409 as reuse', async () => {
    mockBackend({ refresh: () => json({}, 409) });
    expect((await v().refreshSession('old')).reason).toBe('reuse');
  });

  it('classifies a body { code: token_reuse } as reuse', async () => {
    mockBackend({ refresh: () => json({ code: 'token_reuse' }, 400) });
    expect((await v().refreshSession('old')).reason).toBe('reuse');
  });

  it('classifies 401 as expired and 403 as revoked', async () => {
    mockBackend({ refresh: () => json({}, 401) });
    expect((await v().refreshSession('old')).reason).toBe('expired');
    mockBackend({ refresh: () => json({}, 403) });
    expect((await v().refreshSession('old')).reason).toBe('revoked');
  });

  it('classifies a transport error as network', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect((await v().refreshSession('old')).reason).toBe('network');
  });

  it('honours a custom classifier', async () => {
    mockBackend({ refresh: () => json({}, 418) });
    const custom = createTokenValidation(
      resolveProxyConfig({ ...baseConfig, refresh: { classifyFail: () => 'reuse' } })
    );
    expect((await custom.refreshSession('old')).reason).toBe('reuse');
  });
});

// ==================== P1-2 / P2-4 · Fail-closed on reuse ====================

describe('P1-2/P2-4 · reuse never downgrades to guest', () => {
  it('redirects to login, clears cookies, calls onRefreshFail, never creates a guest', async () => {
    const onRefreshFail = vi.fn();
    const calls = mockBackend({
      validate: () => json({}, 401), // access token invalid
      refresh: () => json({ code: 'token_reuse' }, 409),
      guest: () => json({ success: true, data: { accessToken: 'guestT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      guestToken: { enabled: true, credentials: { username: 'g', password: 'g' } },
      refresh: { onRefreshFail },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(calls.guest).toBe(0);
    expect(res.cookies.get('guestToken')?.value).toBeFalsy();
    expect(res.cookies.get('userToken')?.value).toBeFalsy();
    expect(onRefreshFail).toHaveBeenCalledWith('reuse', expect.anything());
  });
});

// ==================== P2-4 · guestFallbackOnUserRefreshFail ====================

describe('P2-4 · guest fallback policy on user refresh failure', () => {
  it('DEFAULT: an expired user refresh downgrades to guest on a public route (backward compatible)', async () => {
    const calls = mockBackend({
      validate: () => json({}, 401),
      refresh: () => json({}, 401),
      guest: () => json({ success: true, data: { accessToken: 'guestT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      guestToken: { enabled: true, credentials: { username: 'g', password: 'g' } },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.guest).toBe(1);
    expect(res.cookies.get('guestToken')?.value).toBe('guestT');
    expect(res.status).not.toBe(307);
  });

  it('guestFallbackOnUserRefreshFail:false forces login and never creates a guest', async () => {
    const onRefreshFail = vi.fn();
    const calls = mockBackend({
      validate: () => json({}, 401),
      refresh: () => json({}, 401),
      guest: () => json({ success: true, data: { accessToken: 'guestT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      access: { guestFallbackOnUserRefreshFail: false },
      guestToken: { enabled: true, credentials: { username: 'g', password: 'g' } },
      refresh: { onRefreshFail },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(calls.guest).toBe(0);
    expect(onRefreshFail).toHaveBeenCalledWith('expired', expect.anything());
  });
});

// ==================== P2-1 · Proactive refresh ====================

describe('P2-1 · proactive (pre-expiry) refresh', () => {
  it('refreshes a still-valid token inside the proactive window', async () => {
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(3600), id: 1 } })
          : json({ success: true, data: { type: 'user', exp: future(60), id: 1 } }),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      refresh: { proactive: true, proactiveWindow: 120 },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('does NOT refresh when proactive is disabled (default)', async () => {
    const calls = mockBackend({
      validate: () => json({ success: true, data: { type: 'user', exp: future(60), id: 1 } }),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(0);
    expect(res.cookies.get('userToken')?.value).toBeFalsy();
  });
});

// ==================== P2-2 · Local validation ====================

describe('P2-2 · local JWT validation (custom verifier)', () => {
  it('does not call the backend validate endpoint when the token verifies locally', async () => {
    const calls = mockBackend({
      validate: () => json({}, 500), // would fail if ever called
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      validate: {
        mode: 'local',
        verify: () => ({ isValid: true, tokenType: 'user', exp: future(), userData: { id: 1 } }),
      },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'jwt' }));

    expect(calls.validate).toBe(0);
    expect(res.headers.has('x-middleware-next')).toBe(true);
  });

  it('revalidates against the backend after the interval elapses', async () => {
    const calls = mockBackend({
      validate: () => json({ success: true, data: { type: 'user', exp: future(), id: 1 } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      validate: {
        mode: 'local',
        revalidateInterval: 60,
        verify: () => ({ isValid: true, tokenType: 'user', exp: future(), userData: { id: 1 } }),
      },
    });

    // No revalidate cookie → first request revalidates against the backend.
    const res = await proxy(reqWithCookies('/account', { userToken: 'jwt' }));
    expect(calls.validate).toBe(1);
    expect(res.cookies.get('__nal_rv')?.value).toBeTruthy();
  });
});

// ==================== P2-3 · Dual-token ====================

describe('P2-3 · dual-token (access + refresh) mode', () => {
  it('refreshes using the refresh cookie and rotates both tokens', async () => {
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newAT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401), // old access token invalid
      refresh: () =>
        json({ success: true, data: { accessToken: 'newAT', refreshToken: 'newRT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      cookies: {
        user: 'at',
        guest: 'gt',
        refresh: 'rt',
        refreshOptions: { path: '/api/auth/refresh', maxAge: 1209600 },
      },
    });

    const res = await proxy(reqWithCookies('/account', { at: 'oldAT', rt: 'oldRT' }));

    // Refresh must be authenticated with the REFRESH cookie, not the access one.
    expect(calls.refreshAuth).toEqual(['Bearer oldRT']);
    expect(res.cookies.get('at')?.value).toBe('newAT');
    expect(res.cookies.get('rt')?.value).toBe('newRT');
    expect(res.cookies.get('rt')?.path).toBe('/api/auth/refresh');
  });
});
