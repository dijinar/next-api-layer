import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createCsrfValidator } from '../../src/proxy/csrf';
import type { ResolvedCsrfConfig } from '../../src/shared/types';

function getConfig(overrides?: Partial<ResolvedCsrfConfig>): ResolvedCsrfConfig {
  return {
    enabled: true,
    strategy: 'double-submit',
    secret: 'test-secret',
    cookieName: '__csrf',
    headerName: 'x-csrf-token',
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    trustSameSite: false,
    ...overrides,
  };
}

describe('createCsrfValidator', () => {
  it('allows safe methods', async () => {
    const validator = createCsrfValidator(getConfig());
    const req = new NextRequest('http://localhost/api/test', { method: 'GET' });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('rejects unsafe method without token', async () => {
    const validator = createCsrfValidator(getConfig());
    const req = new NextRequest('http://localhost/api/test', { method: 'POST' });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('accepts matching cookie and header token', async () => {
    const validator = createCsrfValidator(getConfig());
    const token = await validator.generateToken('session-1');

    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        cookie: `__csrf=${token}`,
      },
    });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('rejects mismatched cookie and header token', async () => {
    const validator = createCsrfValidator(getConfig());
    const tokenA = await validator.generateToken('session-1');
    const tokenB = await validator.generateToken('session-1');

    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': tokenA,
        cookie: `__csrf=${tokenB}`,
      },
    });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(false);
  });

  it('rejects a forged token with an invalid HMAC signature', async () => {
    const validator = createCsrfValidator(getConfig());
    const real = await validator.generateToken();
    const randomValue = real.split('.')[1];
    // Same random value on cookie+header (passes double-submit) but a bogus HMAC.
    const forged = `deadbeefdeadbeef.${randomValue}`;

    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': forged,
        cookie: `__csrf=${forged}`,
      },
    });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid-token-signature');
  });

  it('rejects a token whose random value was tampered with', async () => {
    const validator = createCsrfValidator(getConfig());
    const real = await validator.generateToken();
    const hmac = real.split('.')[0];
    // Keep the original HMAC but swap the random value it was signed over.
    const tampered = `${hmac}.${'f'.repeat(64)}`;

    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': tampered,
        cookie: `__csrf=${tampered}`,
      },
    });

    const result = await validator.validateRequest(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid-token-signature');
  });
});
