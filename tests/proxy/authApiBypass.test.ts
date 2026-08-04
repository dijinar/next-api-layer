import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAuthProxy } from '../../src/proxy/createAuthProxy';
import { hashToken } from '../../src/proxy/refreshManager';
import type { AuthProxyConfig, AuthResult, RefreshResultStore, StoredRefreshResult } from '../../src/shared/types';

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

function createFakeStore(): RefreshResultStore & { map: Map<string, StoredRefreshResult> } {
  const map = new Map<string, StoredRefreshResult>();
  return {
    map,
    get(key: string) {
      return map.get(key) ?? null;
    },
    set(key: string, value: StoredRefreshResult) {
      map.set(key, value);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ==================== A) Default bypass (backward compatible) ====================

describe('auth-api bypass · default behaviour', () => {
  it('bypasses /api/auth/me with no backend call, request passes through', async () => {
    const calls = mockBackend({});
    const proxy = createAuthProxy({ ...baseConfig });

    const res = await proxy(reqWithCookies('/api/auth/me', {}));

    expect(calls.validate).toBe(0);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
    expect(res.headers.has('x-middleware-next')).toBe(true);
  });

  it('bypasses /api/auth/login and /api/auth/refresh with no backend call', async () => {
    const calls = mockBackend({});
    const proxy = createAuthProxy({ ...baseConfig });

    const loginRes = await proxy(reqWithCookies('/api/auth/login', {}));
    const refreshRes = await proxy(reqWithCookies('/api/auth/refresh', {}));

    expect(calls.validate).toBe(0);
    expect(calls.refresh).toBe(0);
    expect(loginRes.status).not.toBe(401);
    expect(loginRes.headers.has('x-middleware-next')).toBe(true);
    expect(refreshRes.status).not.toBe(401);
    expect(refreshRes.headers.has('x-middleware-next')).toBe(true);
  });
});

// ==================== B) authApi.bypassPaths overrides the default list ====================

describe('auth-api bypass · authApi.bypassPaths override', () => {
  const overrideConfig: AuthProxyConfig = {
    ...baseConfig,
    authApi: {
      bypassPaths: ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/auth/register'],
    },
  };

  it('routes /api/auth/me through the normal pipeline with a valid token', async () => {
    const calls = mockBackend({
      validate: () => json({ success: true, data: { type: 'user', exp: future(), id: 1 } }),
    });
    const proxy = createAuthProxy(overrideConfig);

    const res = await proxy(reqWithCookies('/api/auth/me', { userToken: 'validUser' }));

    expect(calls.validate).toBe(1);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
  });

  it('transparently refreshes an expired token on /api/auth/me, exactly one refresh call, request passes through', async () => {
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy(overrideConfig);

    const res = await proxy(reqWithCookies('/api/auth/me', { userToken: 'expiredUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('still bypasses /api/auth/refresh even with the override (path stays in the list)', async () => {
    const calls = mockBackend({});
    const proxy = createAuthProxy(overrideConfig);

    const res = await proxy(reqWithCookies('/api/auth/refresh', { userToken: 'expiredUser' }));

    expect(calls.validate).toBe(0);
    expect(calls.refresh).toBe(0);
    expect(res.headers.has('x-middleware-next')).toBe(true);
  });
});

// ==================== C) AuthResult.bypassed (afterAuth state) ====================

describe('auth-api bypass · AuthResult.bypassed passed to afterAuth', () => {
  it("marks 'auth-api' for a default-bypassed auth route", async () => {
    mockBackend({});
    const afterAuth = vi.fn((_req, res) => res);
    const proxy = createAuthProxy({ ...baseConfig, afterAuth });

    await proxy(reqWithCookies('/api/auth/login', {}));

    expect(afterAuth).toHaveBeenCalledTimes(1);
    const authResult = afterAuth.mock.calls[0][2] as AuthResult;
    expect(authResult.bypassed).toBe('auth-api');
  });

  it("marks 'excluded' for a path matched by excludedPaths", async () => {
    mockBackend({});
    const afterAuth = vi.fn((_req, res) => res);
    const proxy = createAuthProxy({ ...baseConfig, excludedPaths: ['/public'], afterAuth });

    await proxy(reqWithCookies('/public/x', {}));

    expect(afterAuth).toHaveBeenCalledTimes(1);
    const authResult = afterAuth.mock.calls[0][2] as AuthResult;
    expect(authResult.bypassed).toBe('excluded');
  });

  it('leaves bypassed undefined for a normally validated route', async () => {
    mockBackend({
      validate: () => json({ success: true, data: { type: 'user', exp: future(), id: 1 } }),
    });
    const afterAuth = vi.fn((_req, res) => res);
    const proxy = createAuthProxy({ ...baseConfig, afterAuth });

    await proxy(reqWithCookies('/dashboard', { userToken: 'validUser' }));

    expect(afterAuth).toHaveBeenCalledTimes(1);
    const authResult = afterAuth.mock.calls[0][2] as AuthResult;
    expect(authResult.bypassed).toBeUndefined();
  });
});

// ==================== D) refresh.store (cross-instance coalescing) ====================
describe('auth-api bypass · refresh.store shared result reuse', () => {
  it('a second instance reuses the first instance refresh result via the shared store (no second backend refresh)', async () => {
    const store = createFakeStore();
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy1 = createAuthProxy({ ...baseConfig, refresh: { store } });
    const proxy2 = createAuthProxy({ ...baseConfig, refresh: { store } });

    const res1 = await proxy1(reqWithCookies('/account', { userToken: 'oldUser' }));
    expect(calls.refresh).toBe(1);
    expect(res1.cookies.get('userToken')?.value).toBe('newT');

    const res2 = await proxy2(reqWithCookies('/account', { userToken: 'oldUser' }));
    expect(calls.refresh).toBe(1);
    expect(res2.cookies.get('userToken')?.value).toBe('newT');
  });

  it('refreshes normally when the shared store throws (store failure is non-fatal)', async () => {
    const throwingStore: RefreshResultStore = {
      get() {
        throw new Error('store unavailable');
      },
      set() {},
    };
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig, refresh: { store: throwingStore } });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('falls through to a real refresh when the stored entry is stale (no longer valid)', async () => {
    const store = createFakeStore();
    store.map.set(await hashToken('oldUser'), { accessToken: 'staleToken', expiresAt: Date.now() + 60_000 });
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig, refresh: { store } });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('discards a stored entry whose absolute expiry has passed, even if the adapter still returns it', async () => {
    const store = createFakeStore();
    store.map.set(await hashToken('oldUser'), { accessToken: 'newT', expiresAt: Date.now() - 1 });
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig, refresh: { store } });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('reports store failures through onError instead of swallowing them', async () => {
    const onError = vi.fn();
    const throwingStore: RefreshResultStore = {
      get() {
        throw new Error('store unavailable');
      },
      set() {},
    };
    mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig, onError, refresh: { store: throwingStore } });

    await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(onError).toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe('store unavailable');
  });

  it('survives an onError hook that throws while reporting a store failure', async () => {
    const throwingStore: RefreshResultStore = {
      get() {
        throw new Error('store unavailable');
      },
      set() {},
    };
    const calls = mockBackend({
      validate: (bearer) =>
        bearer === 'Bearer newT'
          ? json({ success: true, data: { type: 'user', exp: future(), id: 1 } })
          : json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({
      ...baseConfig,
      onError: () => {
        throw new Error('hook exploded');
      },
      refresh: { store: throwingStore },
    });

    const res = await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(res.cookies.get('userToken')?.value).toBe('newT');
  });

  it('does not write to the shared store when the refreshed token fails validation', async () => {
    const store = createFakeStore();
    const setSpy = vi.spyOn(store, 'set');
    const calls = mockBackend({
      validate: () => json({}, 401),
      refresh: () => json({ success: true, data: { accessToken: 'newT' } }),
    });
    const proxy = createAuthProxy({ ...baseConfig, refresh: { store } });

    await proxy(reqWithCookies('/account', { userToken: 'oldUser' }));

    expect(calls.refresh).toBe(1);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

// ==================== E) Guest token forwarded on the same request ====================

describe('auth-api bypass · guest token minted for an API route', () => {
  const overrideConfig: AuthProxyConfig = {
    ...baseConfig,
    guestToken: { enabled: true, credentials: { key: 'k' } },
    authApi: {
      bypassPaths: ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/auth/register'],
    },
  };

  it('forwards the freshly minted guest token downstream on the same request', async () => {
    mockBackend({
      guest: () => json({ success: true, data: { accessToken: 'guestT' } }),
    });
    const proxy = createAuthProxy(overrideConfig);

    const res = await proxy(reqWithCookies('/api/auth/me', {}));

    expect(res.cookies.get('guestToken')?.value).toBe('guestT');
    expect(res.headers.get('x-middleware-request-x-refreshed-token')).toBe('guestT');
  });

  it('returns a 401 json response, never a redirect, when no guest token can be minted', async () => {
    mockBackend({});
    const proxy = createAuthProxy({ ...overrideConfig, guestToken: undefined });

    const res = await proxy(reqWithCookies('/api/auth/me', {}));

    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });
});
