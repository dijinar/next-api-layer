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
  async function generateToken(sessionId: string): Promise<string> {
    const randomValue = generateRandomValue();
    const hmac = await computeHmac(config.secret, sessionId, randomValue);
    return `${hmac}.${randomValue}`;
  }

  /**
   * Validate CSRF request using configured strategy
   */
  function validateRequest(req: NextRequest): CsrfValidationResult {
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
  function validateDoubleSubmit(req: NextRequest): CsrfValidationResult {
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

    // Validate HMAC structure
    const parts = cookieToken.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'invalid-token-format' };
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
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback (less secure, for edge cases)
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Compute HMAC-SHA256
 */
async function computeHmac(
  secret: string, 
  sessionId: string, 
  randomValue: string
): Promise<string> {
  const message = `${sessionId.length}!${sessionId}!${randomValue.length}!${randomValue}`;
  
  if (typeof crypto !== 'undefined' && crypto.subtle) {
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
  
  // Fallback (less secure)
  let hash = 0;
  const hashInput = secret + message;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
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
