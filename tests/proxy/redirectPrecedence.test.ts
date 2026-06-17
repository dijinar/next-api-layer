import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createAuthProxy } from '../../src/proxy/createAuthProxy';

/**
 * Guards the routing-authority invariant: when our auth middleware produces a
 * terminal response (a redirect / JSON error that ends the request), the i18n
 * middleware must NOT be able to forward or rewrite past it. Otherwise a
 * protected route could still be served despite our redirect (auth bypass).
 */
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

describe('routing authority — our auth redirect wins over the i18n middleware', () => {
  it('keeps our redirect when i18n returns a plain next() forward (protected route, no token)', async () => {
    const proxy = createAuthProxy(baseConfig(() => NextResponse.next()));

    const res = await proxy(new NextRequest('http://localhost/dashboard'));

    expect(res.headers.has('x-middleware-next')).toBe(false);
    expect(res.headers.has('x-middleware-rewrite')).toBe(false);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('keeps our redirect when i18n returns a rewrite() (protected route, no token)', async () => {
    const proxy = createAuthProxy(
      baseConfig(() => NextResponse.rewrite(new URL('http://localhost/en/dashboard')))
    );

    const res = await proxy(new NextRequest('http://localhost/dashboard'));

    expect(res.headers.has('x-middleware-rewrite')).toBe(false);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('keeps our auth redirect even when i18n itself returns a (locale) redirect', async () => {
    const proxy = createAuthProxy(
      baseConfig(() => NextResponse.redirect(new URL('http://localhost/en/dashboard')))
    );

    const res = await proxy(new NextRequest('http://localhost/dashboard'));

    // Auth decision (/login) beats locale routing (/en/dashboard).
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).not.toContain('/dashboard');
  });

  it('carries the i18n cookie (e.g. NEXT_LOCALE) over onto our redirect', async () => {
    const proxy = createAuthProxy(
      baseConfig(() => {
        const r = NextResponse.next();
        r.cookies.set('NEXT_LOCALE', 'en');
        return r;
      })
    );

    const res = await proxy(new NextRequest('http://localhost/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('still lets a legitimate i18n redirect win when WE only forward (public route, no token)', async () => {
    const proxy = createAuthProxy(
      baseConfig(() => NextResponse.redirect(new URL('http://localhost/en')))
    );

    // `/` is public → our response is a forward, so we made no routing
    // decision and the i18n locale redirect must take effect.
    const res = await proxy(new NextRequest('http://localhost/'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/en');
  });

  it('still forwards normally when both sides forward (public route, no token)', async () => {
    const proxy = createAuthProxy(baseConfig(() => NextResponse.next()));

    const res = await proxy(new NextRequest('http://localhost/'));

    // No redirect: the request is forwarded to the app as usual.
    expect(res.headers.has('x-middleware-next')).toBe(true);
    expect(res.status).not.toBe(307);
  });
});
