/**
 * CSRF Protection
 * 
 * Implements OWASP recommended CSRF protection:
 * - Fetch Metadata (Sec-Fetch-Site header) for modern browsers (98%+ coverage)
 * - Signed HMAC Double-Submit Cookie as fallback
 * 
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ResolvedCsrfConfig } from '../shared/types';

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Creates CSRF validator functions
 */
export function createCsrfValidator(config: ResolvedCsrfConfig) {
  /**
   * Generate HMAC-signed CSRF token
   * Format: hmac.randomValue
   */
  async function generateToken(_sessionId?: string): Promise<string> {
    const randomValue = generateRandomValue();
    // HMAC binds the token to the server secret so it can be verified on
    // validation. The random value is what the double-submit pair compares.
    const hmac = await computeHmac(config.secret, randomValue);
    return `${hmac}.${randomValue}`;
  }

  /**
   * Validate CSRF request using configured strategy
   */
  async function validateRequest(req: NextRequest): Promise<CsrfValidationResult> {
    const method = req.method.toUpperCase();
    
    // Skip safe methods
    if (config.ignoreMethods.includes(method)) {
      return { valid: true };
    }

    const strategy = config.strategy;
    
    // Fetch Metadata validation (primary, modern browsers)
    if (strategy === 'fetch-metadata' || strategy === 'both') {
      const fetchResult = validateFetchMetadata(req);
      
      if (strategy === 'fetch-metadata') {
        return fetchResult;
      }
      
      // 'both' strategy: if Fetch Metadata passes, we're good
      if (fetchResult.valid) {
        return fetchResult;
      }
      
      // 'both' strategy: if Fetch Metadata fails or not available, try double-submit
      if (fetchResult.reason === 'missing-headers') {
        // Fall through to double-submit
      } else {
        // Explicit cross-site rejection from Fetch Metadata
        return fetchResult;
      }
    }

    // Double-Submit Cookie validation (fallback)
    if (strategy === 'double-submit' || strategy === 'both') {
      return validateDoubleSubmit(req);
    }

    return { valid: true };
  }

  /**
   * Validate using Fetch Metadata headers (Sec-Fetch-Site)
   * @see https://web.dev/fetch-metadata/
   */
  function validateFetchMetadata(req: NextRequest): CsrfValidationResult {
    const secFetchSite = req.headers.get('sec-fetch-site');
    
    // No Fetch Metadata headers (older browser or stripped by proxy)
    if (!secFetchSite) {
      return { valid: false, reason: 'missing-headers' };
    }

    // Same-origin requests are always trusted
    if (secFetchSite === 'same-origin') {
      return { valid: true };
    }

    // None = direct navigation (bookmark, typed URL) - allow for GET
    if (secFetchSite === 'none') {
      const method = req.method.toUpperCase();
      if (config.ignoreMethods.includes(method)) {
        return { valid: true };
      }
      // Non-safe method from direct navigation is suspicious
      return { valid: false, reason: 'direct-navigation-unsafe-method' };
    }

    // Same-site: trust based on config
    if (secFetchSite === 'same-site') {
      if (config.trustSameSite) {
        return { valid: true };
      }
      // Conservative: don't trust same-site by default (subdomain takeover risk)
      return { valid: false, reason: 'same-site-not-trusted' };
    }

    // Cross-site: reject state-changing requests
    if (secFetchSite === 'cross-site') {
      return { valid: false, reason: 'cross-site-request' };
    }

    // Unknown value - be conservative
    return { valid: false, reason: 'unknown-sec-fetch-site' };
  }

  /**
   * Validate using Double-Submit Cookie pattern with HMAC
   */
  async function validateDoubleSubmit(req: NextRequest): Promise<CsrfValidationResult> {
    // Get token from cookie
    const cookieToken = req.cookies.get(config.cookieName)?.value;
    
    if (!cookieToken) {
      return { valid: false, reason: 'missing-cookie-token' };
    }

    // Get token from header (or form field)
    const headerToken = req.headers.get(config.headerName);
    
    if (!headerToken) {
      return { valid: false, reason: 'missing-header-token' };
    }

    // Tokens must match (constant-time comparison to prevent timing attacks)
    if (!constantTimeEqual(cookieToken, headerToken)) {
      return { valid: false, reason: 'token-mismatch' };
    }

    // Validate token structure: "<hmac>.<randomValue>"
    const parts = cookieToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, reason: 'invalid-token-format' };
    }

    // Verify the HMAC signature so attacker-injected/forged tokens (e.g. set via
    // a sibling-subdomain cookie) are rejected. Without this check the "signed"
    // token would degrade to a plain, forgeable double-submit value.
    const [providedHmac, randomValue] = parts;
    const expectedHmac = await computeHmac(config.secret, randomValue);
    if (!constantTimeEqual(providedHmac, expectedHmac)) {
      return { valid: false, reason: 'invalid-token-signature' };
    }

    return { valid: true };
  }

  /**
   * Create response with CSRF cookie set
   */
  async function attachCsrfCookie(
    response: NextResponse, 
    sessionId: string
  ): Promise<NextResponse> {
    const token = await generateToken(sessionId);
    
    response.cookies.set(config.cookieName, token, {
      httpOnly: false, // Must be readable by JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return response;
  }

  return {
    validateRequest,
    generateToken,
    attachCsrfCookie,
  };
}

// ==================== Helper Functions ====================

/**
 * Generate cryptographically random value
 */
function generateRandomValue(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error(
      'next-api-layer: Web Crypto API (crypto.getRandomValues) is unavailable; ' +
      'cannot generate a secure CSRF token. Use a Node.js 18+ or Edge runtime.'
    );
  }
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute HMAC-SHA256
 */
async function computeHmac(
  secret: string,
  randomValue: string
): Promise<string> {
  // Length-prefixed message keeps the encoding unambiguous.
  const message = `${randomValue.length}!${randomValue}`;
  
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'next-api-layer: Web Crypto API (crypto.subtle) is unavailable; ' +
      'cannot compute a secure CSRF HMAC. Use a Node.js 18+ or Edge runtime.'
    );
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', hmacKey, messageData);
  return Array.from(new Uint8Array(signature), b => 
    b.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Constant-time string comparison (prevents timing attacks)
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

export type CsrfValidator = ReturnType<typeof createCsrfValidator>;
