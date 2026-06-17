import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createAuthProxy } from '../../src/proxy/createAuthProxy';

/**
 * Replicates how Next.js applies a middleware response's request-header
 * overrides to the downstream request (see next/dist/server/lib/router-utils/
 * resolve-routes.js). This is the ground truth for finding #1: a forged
 * `x-auth-user` must never reach the app on ANY forwarding path.
 *
 * - A response only forwards the request to the app when it carries
 *   `x-middleware-next` (next) or `x-middleware-rewrite` (rewrite).
 * - When an `x-middleware-override-headers` list is present, that list is
 *   authoritative: every original header NOT in it is deleted, and the listed
 *   ones are (re)set from `x-middleware-request-*`.
 * - With no override list, the original request headers pass through verbatim.
 */
function appWouldReceive(
  originalHeaders: Record<string, string>,
  response: NextResponse
): { forwarded: boolean; headers: Record<string, string> } {
  const forwards =
    response.headers.has('x-middleware-next') ||
    response.headers.has('x-middleware-rewrite');

  if (!forwards) {
    return { forwarded: false, headers: {} };
  }

  const headers: Record<string, string> = { ...originalHeaders };
  const list = response.headers.get('x-middleware-override-headers');

  if (list) {
    const overridden = new Set(
      list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    );

    // Drop any original header not present in the override list.
    for (const key of Object.keys(headers)) {
      if (!overridden.has(key)) delete headers[key];
    }

    // Set/update the listed headers from their x-middleware-request-* value.
    for (const key of overridden) {
      const value = response.headers.get(`x-middleware-request-${key}`);
      if (value === null) {
        delete headers[key];
      } else {
        headers[key] = value;
      }
    }
  }

  return { forwarded: true, headers };
}

const FORGED = 'eyJpZCI6OTk5LCJpc0d1ZXN0IjpmYWxzZX0='; // base64 forged user

function baseConfig(middleware: (req: NextRequest) => NextResponse) {
  return {
    apiBaseUrl: 'http://backend.test',
    cookies: { user: 'userToken', guest: 'guestToken' },
    access: { protectedRoutes: ['/dashboard'] },
    i18n: {
      enabled: true,
      locales: ['en', 'tr'],
      defaultLocale: 'en',
      middleware,
    },
  };
}

describe('request header sanitization (finding #1) — i18n forwarding paths', () => {
  it('strips a forged x-auth-user when i18n returns a plain next() (no override list)', async () => {
    const proxy = createAuthProxy(baseConfig(() => NextResponse.next()));

    const req = new NextRequest('http://localhost/', {
      headers: { 'x-auth-user': FORGED, 'x-keep': 'yes' },
    });

    const res = await proxy(req);
    const downstream = appWouldReceive(
      { 'x-auth-user': FORGED, 'x-keep': 'yes' },
      res
    );

    expect(downstream.forwarded).toBe(true);
    expect(downstream.headers['x-auth-user']).toBeUndefined();
    // Non-internal headers must still survive the sanitization.
    expect(downstream.headers['x-keep']).toBe('yes');
  });

  it('strips a forged x-auth-user when i18n forwards the original headers via next({ request })', async () => {
    const proxy = createAuthProxy(
      baseConfig(req =>
        // next-intl style: forwards the (forged) original request headers.
        NextResponse.next({ request: { headers: new Headers(req.headers) } })
      )
    );

    const req = new NextRequest('http://localhost/', {
      headers: { 'x-auth-user': FORGED, 'x-keep': 'yes' },
    });

    const res = await proxy(req);
    const downstream = appWouldReceive(
      { 'x-auth-user': FORGED, 'x-keep': 'yes' },
      res
    );

    expect(downstream.forwarded).toBe(true);
    expect(downstream.headers['x-auth-user']).toBeUndefined();
    expect(downstream.headers['x-keep']).toBe('yes');
  });

  it('strips a forged x-auth-user when i18n returns a rewrite() forward', async () => {
    const proxy = createAuthProxy(
      baseConfig(() => NextResponse.rewrite(new URL('http://localhost/en')))
    );

    const req = new NextRequest('http://localhost/', {
      headers: { 'x-auth-user': FORGED },
    });

    const res = await proxy(req);
    const downstream = appWouldReceive({ 'x-auth-user': FORGED }, res);

    expect(downstream.forwarded).toBe(true);
    expect(downstream.headers['x-auth-user']).toBeUndefined();
  });

  it('keeps our auth redirect (so a forged header never reaches the app) when our side redirects but i18n forwards (protected route, no token)', async () => {
    const proxy = createAuthProxy(baseConfig(() => NextResponse.next()));

    const req = new NextRequest('http://localhost/dashboard', {
      headers: { 'x-auth-user': FORGED },
    });

    const res = await proxy(req);
    const downstream = appWouldReceive({ 'x-auth-user': FORGED }, res);

    // Our redirect is authoritative: the i18n forward must not replace it, so
    // the request never reaches the protected app at all (auth bypass closed),
    // and a forged identity header therefore can't reach it either.
    expect(downstream.forwarded).toBe(false);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('strips forged x-refreshed-token and x-locale too', async () => {
    const proxy = createAuthProxy(baseConfig(() => NextResponse.next()));

    const req = new NextRequest('http://localhost/', {
      headers: {
        'x-auth-user': FORGED,
        'x-refreshed-token': 'forged-token',
        'x-locale': 'evil',
        'x-keep': 'yes',
      },
    });

    const res = await proxy(req);
    const downstream = appWouldReceive(
      {
        'x-auth-user': FORGED,
        'x-refreshed-token': 'forged-token',
        'x-locale': 'evil',
        'x-keep': 'yes',
      },
      res
    );

    expect(downstream.forwarded).toBe(true);
    expect(downstream.headers['x-auth-user']).toBeUndefined();
    expect(downstream.headers['x-refreshed-token']).toBeUndefined();
    expect(downstream.headers['x-locale']).toBeUndefined();
    expect(downstream.headers['x-keep']).toBe('yes');
  });
});
