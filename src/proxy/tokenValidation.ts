/**
 * Token Validation
 * Handles token validation and refresh with backend API
 */

import type {
  TokenInfo, 
  RefreshResult, 
  RefreshFailReason,
  AuthMeResponse, 
  GuestTokenResponse,
  InternalProxyConfig,
  ResponseMappers,
} from '../shared/types';
import { localVerifyToken } from './jwt';
import { createSingleFlight } from './refreshManager';

/**
 * Default response parsers (standard format)
 */
const defaultMappers: Required<ResponseMappers> = {
  // Default: { success: true, data: { type, exp, ...user } }
  parseAuthMe: (response: unknown): TokenInfo | null => {
    const authMeResponse = response as AuthMeResponse | null;
    if (!authMeResponse?.success || !authMeResponse?.data) {
      return null;
    }
    return {
      isValid: true,
      tokenType: authMeResponse.data.type || 'user',
      exp: authMeResponse.data.exp || null,
      userData: authMeResponse.data,
    };
  },
  
  // Default: { success: true, data: { accessToken } }
  parseRefreshToken: (response: unknown): string | null => {
    const refreshResponse = response as GuestTokenResponse | null;
    return refreshResponse?.success && refreshResponse?.data?.accessToken ? refreshResponse.data.accessToken : null;
  },
  
  // Default: { success: true, data: { accessToken } }
  parseGuestToken: (response: unknown): string | null => {
    const guestResponse = response as GuestTokenResponse | null;
    return guestResponse?.data?.accessToken || null;
  },

  // Default: { success: true, data: { refreshToken } }
  parseNewRefreshToken: (response: unknown): string | null => {
    const r = response as { data?: { refreshToken?: string } } | null;
    return r?.data?.refreshToken || null;
  },
};

/**
 * Outcome of a coalesced refresh: the refresh result plus the validated
 * `TokenInfo` for the new token (so concurrent callers share a single validate).
 */
export interface RefreshOutcome extends RefreshResult {
  tokenInfo: TokenInfo | null;
}

/** Result of resolving the current token (backend vs. local validation). */
export interface ResolvedTokenInfo {
  info: TokenInfo;
  /** Whether the backend was consulted (used to update the revalidate cookie). */
  revalidated: boolean;
}

const INVALID_TOKEN_INFO: TokenInfo = { isValid: false, tokenType: null, exp: null, userData: null };

/**
 * Creates token validation functions
 */
export function createTokenValidation(
  config: InternalProxyConfig
) {
  const { apiBaseUrl, _resolved, responseMappers } = config;
  const { endpoints, refresh: refreshCfg, validate: validateCfg } = _resolved;
  
  // Merge custom mappers with defaults
  const mappers: Required<ResponseMappers> = {
    parseAuthMe: responseMappers?.parseAuthMe || defaultMappers.parseAuthMe,
    parseRefreshToken: responseMappers?.parseRefreshToken || defaultMappers.parseRefreshToken,
    parseGuestToken: responseMappers?.parseGuestToken || defaultMappers.parseGuestToken,
    parseNewRefreshToken: responseMappers?.parseNewRefreshToken || defaultMappers.parseNewRefreshToken,
  };

  // Per-instance single-flight map for concurrent refresh coalescing.
  const refreshFlight = createSingleFlight<RefreshOutcome>();

  /**
   * Validates a token against the backend
   */
  async function validateToken(token: string): Promise<TokenInfo> {
    try {
      const validateResponse = await fetch(`${apiBaseUrl}${endpoints.validate}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!validateResponse.ok) {
        return INVALID_TOKEN_INFO;
      }

      const rawResponse: unknown = await validateResponse.json().catch(() => null);
      
      // Use custom or default mapper
      const parsed = mappers.parseAuthMe(rawResponse);
      
      if (!parsed || !parsed.isValid) {
        return INVALID_TOKEN_INFO;
      }

      return parsed;
    } catch {
      return INVALID_TOKEN_INFO;
    }
  }

  /**
   * Verifies a token locally (custom verifier or built-in HS256), without
   * contacting the backend.
   */
  async function validateLocal(token: string): Promise<TokenInfo> {
    try {
      if (validateCfg.verify) {
        const result = await validateCfg.verify(token);
        return result && result.isValid ? result : INVALID_TOKEN_INFO;
      }
      const result = await localVerifyToken(token, {
        secret: validateCfg.secret,
        algorithms: validateCfg.algorithms,
      });
      return result && result.isValid ? result : INVALID_TOKEN_INFO;
    } catch {
      return INVALID_TOKEN_INFO;
    }
  }

  /**
   * Gets token info (validates with backend). Kept for backward compatibility
   * and used to validate a freshly refreshed token.
   */
  async function getTokenInfo(token: string): Promise<TokenInfo> {
    return validateToken(token);
  }

  /**
   * Resolves the current token according to the configured validation strategy.
   * In `local` mode the JWT is verified in-process and the backend is consulted
   * only when `revalidateInterval` has elapsed since `lastRevalidateAt`.
   */
  async function resolveToken(
    token: string,
    ctx: { lastRevalidateAt?: number; now?: number } = {}
  ): Promise<ResolvedTokenInfo> {
    if (validateCfg.mode === 'backend') {
      return { info: await validateToken(token), revalidated: true };
    }

    // local mode
    const localInfo = await validateLocal(token);
    if (!localInfo.isValid) {
      return { info: INVALID_TOKEN_INFO, revalidated: false };
    }

    const interval = validateCfg.revalidateInterval;
    if (interval > 0) {
      const now = ctx.now ?? Math.floor(Date.now() / 1000);
      const last = ctx.lastRevalidateAt ?? 0;
      if (now - last >= interval) {
        // Backend is authoritative for revocation / server-side allowlist.
        return { info: await validateToken(token), revalidated: true };
      }
    }

    return { info: localInfo, revalidated: false };
  }

  /**
   * Extracts a machine-readable code from a refresh error body.
   */
  function extractCode(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const candidate = b.code ?? b.error ?? b.reason;
    return typeof candidate === 'string' ? candidate : null;
  }

  /**
   * Classifies a failed refresh into a reason (RFC 9700 aware).
   */
  function classifyFailure(status: number, body: unknown): RefreshFailReason {
    const custom = refreshCfg.classifyFail?.({ status, body });
    if (custom) return custom;

    const code = extractCode(body);
    if (refreshCfg.reuseStatusCodes.includes(status)) return 'reuse';
    if (code && refreshCfg.reuseCodes.includes(code)) return 'reuse';
    if (status === 401) return 'expired';
    if (status === 403) return 'revoked';
    return 'unknown';
  }

  /**
   * Performs a single refresh call and classifies the outcome.
   */
  async function doRefresh(oldToken: string): Promise<RefreshResult> {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${endpoints.refresh}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${oldToken}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });
    } catch {
      return { success: false, newToken: null, reason: 'network' };
    }

    const rawResponse: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return { success: false, newToken: null, reason: classifyFailure(response.status, rawResponse) };
    }

    const newToken = mappers.parseRefreshToken(rawResponse);
    if (!newToken) {
      return { success: false, newToken: null, reason: 'unknown' };
    }

    const newRefreshToken = _resolved.dualToken ? mappers.parseNewRefreshToken(rawResponse) : null;
    return { success: true, newToken, newRefreshToken };
  }

  /**
   * Refreshes a token. Backward-compatible signature (`{ success, newToken }`
   * plus optional `reason` / `newRefreshToken`).
   */
  async function refreshToken(oldToken: string): Promise<RefreshResult> {
    return doRefresh(oldToken);
  }

  /**
   * Refreshes a session with concurrent single-flight coalescing and validates
   * the resulting token once, so parallel requests share a single backend
   * roundtrip and all continue with the same new token (no orphan/bounce).
   */
  async function refreshSession(oldToken: string): Promise<RefreshOutcome> {
    const producer = async (): Promise<RefreshOutcome> => {
      const result = await doRefresh(oldToken);
      if (!result.success || !result.newToken) {
        return { ...result, tokenInfo: null };
      }
      const nowSec = Math.floor(Date.now() / 1000);
      // Freshly issued token: validate once (local verify or a single backend
      // call), treating it as just-revalidated so no extra backend hit occurs.
      const { info } = await resolveToken(result.newToken, { lastRevalidateAt: nowSec, now: nowSec });
      return { ...result, tokenInfo: info.isValid ? info : null };
    };

    if (refreshCfg.singleFlight) {
      return refreshFlight.run(oldToken, producer);
    }
    return producer();
  }

  /**
   * Creates a guest token
   */
  async function createGuestToken(): Promise<string | null> {
    const guestConfig = config.guestToken;
    
    if (!guestConfig?.enabled || !guestConfig.credentials) {
      return null;
    }

    try {
      const guestResponse = await fetch(`${apiBaseUrl}${endpoints.guest}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: guestConfig.credentials.username,
          password: guestConfig.credentials.password,
        }),
        cache: 'no-store',
      });

      if (!guestResponse.ok) {
        return null;
      }

      const rawResponse: unknown = await guestResponse.json().catch(() => null);
      
      // Use custom or default mapper
      return mappers.parseGuestToken(rawResponse);
    } catch {
      return null;
    }
  }

  return {
    validateToken,
    validateLocal,
    getTokenInfo,
    resolveToken,
    refreshToken,
    refreshSession,
    createGuestToken,
  };
}

export type TokenValidation = ReturnType<typeof createTokenValidation>;
