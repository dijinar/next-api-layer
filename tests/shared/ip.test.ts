import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIp, DEFAULT_IP_HEADERS } from '../../src/shared/ip';

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/dashboard', { headers });
}

describe('getClientIp', () => {
  it('prefers cf-connecting-ip over other headers', () => {
    const req = reqWith({
      'cf-connecting-ip': '9.9.9.9',
      'x-real-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2, 3.3.3.3',
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('falls back to true-client-ip', () => {
    const req = reqWith({
      'true-client-ip': '8.8.8.8',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(getClientIp(req)).toBe('8.8.8.8');
  });

  it('falls back to x-real-ip', () => {
    const req = reqWith({ 'x-real-ip': '7.7.7.7', 'x-forwarded-for': '2.2.2.2' });
    expect(getClientIp(req)).toBe('7.7.7.7');
  });

  it('uses the first hop of x-forwarded-for', () => {
    const req = reqWith({ 'x-forwarded-for': '4.4.4.4, 5.5.5.5, 6.6.6.6' });
    expect(getClientIp(req)).toBe('4.4.4.4');
  });

  it('trims whitespace from forwarded values', () => {
    const req = reqWith({ 'x-forwarded-for': '  4.4.4.4  , 5.5.5.5' });
    expect(getClientIp(req)).toBe('4.4.4.4');
  });

  it('returns null when no IP header is present', () => {
    const req = reqWith({});
    expect(getClientIp(req)).toBeNull();
  });

  it('respects a custom header priority list', () => {
    const req = reqWith({
      'cf-connecting-ip': '9.9.9.9',
      'x-real-ip': '1.1.1.1',
    });
    // Only consider x-real-ip
    expect(getClientIp(req, ['x-real-ip'])).toBe('1.1.1.1');
  });

  it('exposes a sensible default header order', () => {
    expect(DEFAULT_IP_HEADERS[0]).toBe('cf-connecting-ip');
    expect(DEFAULT_IP_HEADERS).toContain('x-forwarded-for');
  });
});
