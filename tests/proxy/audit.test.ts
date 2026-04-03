import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAuditLogger } from '../../src/proxy/audit';
import type { ResolvedAuditConfig, AuditEvent } from '../../src/shared/types';

function getConfig(overrides?: Partial<ResolvedAuditConfig>): ResolvedAuditConfig {
  return {
    enabled: true,
    events: ['auth:success', 'auth:fail', 'csrf:fail', 'rateLimit:exceeded'],
    logger: async () => {},
    ...overrides,
  };
}

describe('createAuditLogger', () => {
  it('emits enabled events', async () => {
    const logger = vi.fn(async (_event: AuditEvent) => {});
    const audit = createAuditLogger(getConfig({ logger }));

    const req = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });

    await audit.emit('auth:success', req, { success: true });

    expect(logger).toHaveBeenCalledTimes(1);
    const [event] = logger.mock.calls[0];
    expect(event.type).toBe('auth:success');
    expect(event.success).toBe(true);
  });

  it('does not emit disabled events', async () => {
    const logger = vi.fn(async (_event: AuditEvent) => {});
    const audit = createAuditLogger(getConfig({ events: ['auth:success'], logger }));

    const req = new NextRequest('http://localhost/api/test');
    await audit.emit('csrf:fail', req, { success: false });

    expect(logger).not.toHaveBeenCalled();
  });

  it('swallows logger errors', async () => {
    const logger = vi.fn(async () => {
      throw new Error('boom');
    });
    const audit = createAuditLogger(getConfig({ logger }));

    const req = new NextRequest('http://localhost/api/test');

    await expect(
      audit.emit('auth:fail', req, { success: false }),
    ).resolves.toBeUndefined();
  });
});
