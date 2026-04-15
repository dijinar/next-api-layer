/**
 * Token Validation
 * Handles token validation and refresh with backend API
 */

import type { 
  TokenInfo, 
  RefreshResult, 
  AuthMeResponse, 
  GuestTokenResponse,
  InternalProxyConfig,
  ResponseMappers,
} from '../shared/types';

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
};

/**
 * Creates token validation functions
 */
export function createTokenValidation(
  config: InternalProxyConfig
) {
  const { apiBaseUrl, _resolved, responseMappers } = config;
  const { endpoints } = _resolved;
  
  // Merge custom mappers with defaults
  const mappers: Required<ResponseMappers> = {
    parseAuthMe: responseMappers?.parseAuthMe || defaultMappers.parseAuthMe,
    parseRefreshToken: responseMappers?.parseRefreshToken || defaultMappers.parseRefreshToken,
    parseGuestToken: responseMappers?.parseGuestToken || defaultMappers.parseGuestToken,
  };

  /**
   * Validates a token against the backend
   */
  async function validateToken(token: string): Promise<TokenInfo> {
    const invalidResult: TokenInfo = { isValid: false, tokenType: null, exp: null, userData: null };
    
    try {
      const validateResponse = await fetch(`${apiBaseUrl}${endpoints.validate}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!validateResponse.ok) {
        return invalidResult;
      }

      const rawResponse: unknown = await validateResponse.json().catch(() => null);
      
      // Use custom or default mapper
      const parsed = mappers.parseAuthMe(rawResponse);
      
      if (!parsed || !parsed.isValid) {
        return invalidResult;
      }

      return parsed;
    } catch {
      return invalidResult;
    }
  }

  /**
   * Gets token info (validates with backend)
   */
  async function getTokenInfo(token: string): Promise<TokenInfo> {
    return validateToken(token);
  }

  /**
   * Refreshes a token
   */
  async function refreshToken(oldToken: string): Promise<RefreshResult> {
    try {
      const refreshResponse = await fetch(`${apiBaseUrl}${endpoints.refresh}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${oldToken}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!refreshResponse.ok) {
        return { success: false, newToken: null };
      }

      const rawResponse: unknown = await refreshResponse.json().catch(() => null);
      
      // Use custom or default mapper
      const newToken = mappers.parseRefreshToken(rawResponse);

      if (!newToken) {
        return { success: false, newToken: null };
      }

      return { success: true, newToken };
    } catch {
      return { success: false, newToken: null };
    }
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
    getTokenInfo,
    refreshToken,
    createGuestToken,
  };
}

export type TokenValidation = ReturnType<typeof createTokenValidation>;
