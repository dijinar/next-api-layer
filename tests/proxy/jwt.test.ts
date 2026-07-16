import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  verifyHmacSignature,
  localVerifyToken,
} from '../../src/proxy/jwt';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

async function signHs256(
  payload: Record<string, unknown>,
  secret: string,
  hash: 'SHA-256' | 'SHA-384' | 'SHA-512' = 'SHA-256',
  alg = 'HS256'
): Promise<string> {
  const enc = new TextEncoder();
  const data = `${b64url({ alg, typ: 'JWT' })}.${b64url(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${Buffer.from(sig).toString('base64url')}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

describe('jwt — local verification', () => {
  it('decodes a JWT payload without verifying', async () => {
    const token = await signHs256({ sub: 1, exp: future() }, 'secret');
    expect(decodeJwtPayload(token)).toMatchObject({ sub: 1 });
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
  });

  it('verifies a valid HS256 signature', async () => {
    const token = await signHs256({ sub: 1, exp: future() }, 'secret');
    expect(await verifyHmacSignature(token, 'secret', ['HS256'])).toBe(true);
  });

  it('rejects a tampered signature / wrong secret', async () => {
    const token = await signHs256({ sub: 1, exp: future() }, 'secret');
    expect(await verifyHmacSignature(token, 'wrong', ['HS256'])).toBe(false);
    expect(await verifyHmacSignature(token + 'x', 'secret', ['HS256'])).toBe(false);
  });

  it('rejects an algorithm not in the allow-list (alg confusion)', async () => {
    const token = await signHs256({ sub: 1, exp: future() }, 'secret', 'SHA-512', 'HS512');
    expect(await verifyHmacSignature(token, 'secret', ['HS256'])).toBe(false);
    expect(await verifyHmacSignature(token, 'secret', ['HS512'])).toBe(true);
  });

  it('localVerifyToken returns TokenInfo for a valid token', async () => {
    const token = await signHs256({ type: 'admin', exp: future(), id: 7 }, 'secret');
    const info = await localVerifyToken(token, { secret: 'secret', algorithms: ['HS256'] });
    expect(info).toMatchObject({ isValid: true, tokenType: 'admin' });
    expect(info?.userData).toMatchObject({ id: 7 });
  });

  it('localVerifyToken rejects an expired token', async () => {
    const token = await signHs256({ type: 'user', exp: past() }, 'secret');
    expect(await localVerifyToken(token, { secret: 'secret', algorithms: ['HS256'] })).toBeNull();
  });

  it('localVerifyToken rejects a bad signature', async () => {
    const token = await signHs256({ type: 'user', exp: future() }, 'secret');
    expect(await localVerifyToken(token, { secret: 'nope', algorithms: ['HS256'] })).toBeNull();
  });
});
