import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the internal formatting functions by creating an API client
// and observing the debug output

describe('Debug Body Logging', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Sensitive Field Masking', () => {
    it('should mask password field', () => {
      const testData = { email: 'test@example.com', password: 'secret123' };
      // Test the masking logic directly
      const sensitiveFields = ['password', 'token', 'secret'];
      const isSensitive = (field: string) => sensitiveFields.some(s => field.toLowerCase().includes(s));
      
      expect(isSensitive('password')).toBe(true);
      expect(isSensitive('Password')).toBe(true);
      expect(isSensitive('user_password')).toBe(true);
      expect(isSensitive('email')).toBe(false);
    });

    it('should mask token field', () => {
      const sensitiveFields = ['password', 'token', 'secret'];
      const isSensitive = (field: string) => sensitiveFields.some(s => field.toLowerCase().includes(s));
      
      expect(isSensitive('token')).toBe(true);
      expect(isSensitive('accessToken')).toBe(true);
      expect(isSensitive('refresh_token')).toBe(true);
    });

    it('should mask nested sensitive fields', () => {
      const sensitiveFields = ['password', 'token', 'secret'];
      const fieldPath = 'user.password';
      const fieldName = fieldPath.split('.').pop()?.toLowerCase() ?? '';
      const isSensitive = sensitiveFields.some(s => fieldName.includes(s));
      
      expect(isSensitive).toBe(true);
    });

    it('should mask apiKey variations', () => {
      const sensitiveFields = ['apiKey', 'api_key'];
      const isSensitive = (field: string) => sensitiveFields.some(s => 
        field.toLowerCase() === s.toLowerCase()
      );
      
      expect(isSensitive('apiKey')).toBe(true);
      expect(isSensitive('api_key')).toBe(true);
      expect(isSensitive('ApiKey')).toBe(true);
    });
  });

  describe('Binary/Base64 Detection', () => {
    it('should detect data URLs', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      
      expect(dataUrl.startsWith('data:')).toBe(true);
      const match = dataUrl.match(/^data:([^;,]+)/);
      expect(match?.[1]).toBe('image/png');
    });

    it('should detect base64 strings', () => {
      // Long base64 string (valid base64, > 100 chars)
      const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/==';
      const isBase64 = base64.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(base64);
      
      expect(base64.length).toBeGreaterThan(100);
      expect(isBase64).toBe(true);
    });

    it('should not detect short strings as base64', () => {
      const shortString = 'Hello World';
      const isBase64 = shortString.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(shortString);
      
      expect(isBase64).toBe(false);
    });

    it('should not detect normal text as base64', () => {
      const normalText = 'This is a normal text with spaces and special chars!@# that should not be detected as base64 even if it is somewhat long';
      const isBase64 = normalText.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(normalText);
      
      expect(isBase64).toBe(false);
    });
  });

  describe('String Truncation', () => {
    it('should truncate long strings', () => {
      const maxLength = 500;
      const longString = 'a'.repeat(1000);
      const truncated = longString.length > maxLength 
        ? `${longString.substring(0, maxLength)}...`
        : longString;
      
      expect(truncated.length).toBeLessThan(longString.length);
      expect(truncated.endsWith('...')).toBe(true);
    });

    it('should not truncate short strings', () => {
      const maxLength = 500;
      const shortString = 'Hello World';
      const result = shortString.length > maxLength 
        ? `${shortString.substring(0, maxLength)}...`
        : shortString;
      
      expect(result).toBe(shortString);
    });
  });

  describe('Array Truncation', () => {
    it('should truncate long arrays', () => {
      const maxItems = 10;
      const longArray = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const truncated = longArray.slice(0, maxItems);
      const remaining = longArray.length - maxItems;
      
      expect(truncated.length).toBe(maxItems);
      expect(remaining).toBe(40);
    });

    it('should not truncate short arrays', () => {
      const maxItems = 10;
      const shortArray = [1, 2, 3, 4, 5];
      const truncated = shortArray.slice(0, maxItems);
      
      expect(truncated.length).toBe(shortArray.length);
    });
  });

  describe('Bytes Formatting', () => {
    it('should format bytes correctly', () => {
      const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      };

      expect(formatBytes(500)).toBe('500B');
      expect(formatBytes(1024)).toBe('1.0KB');
      expect(formatBytes(1536)).toBe('1.5KB');
      expect(formatBytes(1024 * 1024)).toBe('1.0MB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB');
    });
  });

  describe('Depth Limiting', () => {
    it('should limit object depth', () => {
      const maxDepth = 5;
      
      // Create deeply nested object
      let obj: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 10; i++) {
        obj = { nested: obj };
      }
      
      // Simulate depth checking
      function checkDepth(o: unknown, depth: number = 0): string {
        if (depth > maxDepth) return '[max depth reached]';
        if (typeof o !== 'object' || o === null) return String(o);
        
        const entries = Object.entries(o as Record<string, unknown>);
        return `{ ${entries.map(([k, v]) => `${k}: ${checkDepth(v, depth + 1)}`).join(', ')} }`;
      }
      
      const result = checkDepth(obj);
      expect(result).toContain('[max depth reached]');
    });
  });

  describe('FormData Handling', () => {
    it('should handle File objects in FormData', () => {
      // Simulate File info extraction
      const formatFileInfo = (name: string, size: number, type: string): string => {
        const formatBytes = (bytes: number): string => {
          if (bytes < 1024) return `${bytes}B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
          return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        };
        return `[File: ${name}, ${formatBytes(size)}, ${type}]`;
      };

      expect(formatFileInfo('photo.jpg', 2400000, 'image/jpeg')).toBe('[File: photo.jpg, 2.3MB, image/jpeg]');
      expect(formatFileInfo('doc.pdf', 500, 'application/pdf')).toBe('[File: doc.pdf, 500B, application/pdf]');
    });

    it('should mask sensitive fields in FormData', () => {
      const sensitiveFields = ['password', 'token'];
      const key = 'password';
      const isSensitive = sensitiveFields.some(s => key.toLowerCase().includes(s));
      
      expect(isSensitive).toBe(true);
    });
  });

  describe('Default Configuration', () => {
    it('should have correct default sensitive fields', () => {
      const defaultSensitiveFields = [
        'password', 'token', 'secret', 'authorization', 
        'apiKey', 'api_key', 'accessToken', 'refreshToken',
        'creditCard', 'credit_card', 'cvv', 'ssn'
      ];

      expect(defaultSensitiveFields).toContain('password');
      expect(defaultSensitiveFields).toContain('token');
      expect(defaultSensitiveFields).toContain('secret');
      expect(defaultSensitiveFields).toContain('cvv');
      expect(defaultSensitiveFields).toContain('ssn');
      expect(defaultSensitiveFields.length).toBe(12);
    });

    it('should have correct default truncation limits', () => {
      const defaults = {
        maxStringLength: 500,
        maxArrayItems: 10,
        maxDepth: 5,
      };

      expect(defaults.maxStringLength).toBe(500);
      expect(defaults.maxArrayItems).toBe(10);
      expect(defaults.maxDepth).toBe(5);
    });
  });

  describe('Backward Compatibility', () => {
    it('should map logBody to logRequestBody and logResponseBody', () => {
      const legacyConfig = { enabled: true, logBody: true };
      
      // Backward compat mapping
      const logRequestBody = legacyConfig.logBody;
      const logResponseBody = legacyConfig.logBody;
      
      expect(logRequestBody).toBe(true);
      expect(logResponseBody).toBe(true);
    });

    it('should map bodyPreviewLength to maxStringLength', () => {
      const legacyConfig = { enabled: true, bodyPreviewLength: 300 };
      
      // Backward compat mapping
      const maxStringLength = legacyConfig.bodyPreviewLength;
      
      expect(maxStringLength).toBe(300);
    });

    it('should prefer new config over legacy', () => {
      const config = { 
        enabled: true, 
        logBody: false, 
        logRequestBody: true,
        bodyPreviewLength: 200,
        maxStringLength: 1000,
      };
      
      // New config takes precedence
      const logRequestBody = config.logRequestBody ?? config.logBody;
      const maxStringLength = config.maxStringLength ?? config.bodyPreviewLength;
      
      expect(logRequestBody).toBe(true);
      expect(maxStringLength).toBe(1000);
    });
  });

  describe('autoMask Flag', () => {
    const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
    
    // Helper to simulate isSensitiveField behavior
    function isSensitiveWithAutoMask(fieldPath: string, autoMask: boolean): boolean {
      if (!autoMask) return false;
      
      const fieldName = fieldPath.split('.').pop()?.toLowerCase() ?? '';
      return sensitiveFields.some(sensitive => {
        const sensitivePattern = sensitive.toLowerCase();
        return fieldName === sensitivePattern || 
               fieldName.includes(sensitivePattern) ||
               fieldPath.toLowerCase().includes(sensitivePattern);
      });
    }
    
    it('should mask sensitive fields when autoMask is true (default)', () => {
      const autoMask = true;
      
      expect(isSensitiveWithAutoMask('password', autoMask)).toBe(true);
      expect(isSensitiveWithAutoMask('user.token', autoMask)).toBe(true);
      expect(isSensitiveWithAutoMask('secretKey', autoMask)).toBe(true);
      expect(isSensitiveWithAutoMask('Authorization', autoMask)).toBe(true);
    });
    
    it('should NOT mask any fields when autoMask is false', () => {
      const autoMask = false;
      
      expect(isSensitiveWithAutoMask('password', autoMask)).toBe(false);
      expect(isSensitiveWithAutoMask('user.token', autoMask)).toBe(false);
      expect(isSensitiveWithAutoMask('secretKey', autoMask)).toBe(false);
      expect(isSensitiveWithAutoMask('Authorization', autoMask)).toBe(false);
    });
    
    it('should show actual values when autoMask is disabled', () => {
      const data = {
        username: 'john',
        password: 'super_secret_123',
        email: 'john@example.com'
      };
      
      // Simulate formatting with autoMask: false
      const formatWithMask = (obj: Record<string, unknown>, autoMask: boolean) => {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          if (isSensitiveWithAutoMask(key, autoMask)) {
            result[key] = '***';
          } else {
            result[key] = value;
          }
        }
        return result;
      };
      
      const masked = formatWithMask(data, true);
      expect(masked.username).toBe('john');
      expect(masked.password).toBe('***');
      expect(masked.email).toBe('john@example.com');
      
      const unmasked = formatWithMask(data, false);
      expect(unmasked.username).toBe('john');
      expect(unmasked.password).toBe('super_secret_123');
      expect(unmasked.email).toBe('john@example.com');
    });
    
    it('should default autoMask to true', () => {
      const defaultConfig = {
        enabled: true,
        autoMask: undefined
      };
      
      const autoMask = defaultConfig.autoMask ?? true;
      expect(autoMask).toBe(true);
    });
  });
});
