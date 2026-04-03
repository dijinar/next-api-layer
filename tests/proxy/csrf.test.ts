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
  it('allows safe methods', () => {
    const validator = createCsrfValidator(getConfig());
    const req = new NextRequest('http://localhost/api/test', { method: 'GET' });

    const result = validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('rejects unsafe method without token', () => {
    const validator = createCsrfValidator(getConfig());
    const req = new NextRequest('http://localhost/api/test', { method: 'POST' });

    const result = validator.validateRequest(req);
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

    const result = validator.validateRequest(req);
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

    const result = validator.validateRequest(req);
    expect(result.valid).toBe(false);
  });
});
