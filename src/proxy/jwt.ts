/**
 * Minimal, dependency-free JWT helpers for local (in-proxy) verification.
 *
 * Supports HMAC signatures (HS256/384/512) via the Web Crypto API so it runs
 * on both the Edge and Node.js runtimes. For RS256/ES256/JWKS, supply a custom
 * `validate.verify` (e.g. using `jose`) instead of the built-in verifier.
 */

import type { TokenInfo } from '../shared/types';

type HmacAlg = 'HS256' | 'HS384' | 'HS512';

const ALG_TO_HASH: Record<HmacAlg, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

/** Decodes a base64url string to bytes. */
function base64UrlToBytes(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary =
      typeof atob === 'function'
        ? atob(padded + pad)
        : Buffer.from(padded + pad, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Decodes a base64url JSON segment to an object. */
function decodeSegment(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const json = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison of two byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Decodes the JWT payload without verifying the signature. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  return decodeSegment(parts[1]);
}

/**
 * Verifies an HMAC-signed JWT's signature. Returns false on any structural,
 * algorithm, or signature mismatch. Does NOT check `exp` (see `localVerifyToken`).
 */
export async function verifyHmacSignature(
  token: string,
  secret: string,
  algorithms: HmacAlg[]
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeSegment(headerB64);
  const alg = header?.alg;
  if (typeof alg !== 'string' || !algorithms.includes(alg as HmacAlg)) return false;

  const hash = ALG_TO_HASH[alg as HmacAlg];
  if (!hash) return false;

  const signature = base64UrlToBytes(signatureB64);
  if (!signature) return false;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash },
      false,
      ['sign']
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, enc.encode(`${headerB64}.${payloadB64}`))
    );
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}

/**
 * Locally verifies a JWT (HMAC signature + `exp`) and maps its claims to a
 * `TokenInfo`. `tokenType` is read from the `type` / `token_type` claim
 * (default `'user'`); `userData` is the decoded claim set.
 *
 * Note: in local mode `userData` reflects the JWT claims, which may differ from
 * the backend `auth/me` payload. Supply a custom `validate.verify` for full
 * control over the shape.
 */
export async function localVerifyToken(
  token: string,
  options: { secret?: string; algorithms: HmacAlg[] }
): Promise<TokenInfo | null> {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Signature check (required when a secret is configured).
  if (options.secret) {
    const ok = await verifyHmacSignature(token, options.secret, options.algorithms);
    if (!ok) return null;
  }

  // Expiry check.
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp !== null && exp <= Math.floor(Date.now() / 1000)) return null;

  const rawType = payload.type ?? payload.token_type;
  const tokenType = typeof rawType === 'string' ? rawType : 'user';

  return {
    isValid: true,
    tokenType,
    exp,
    userData: payload,
  };
}
