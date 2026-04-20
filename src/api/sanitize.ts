/**
 * XSS Sanitization utilities
 * Zero-dependency, lightweight sanitizer for API responses
 * 
 * Modes:
 * - 'strip' (default): Removes HTML tags, preserves plain text characters
 *   Best for API responses rendered in React/Vue/Angular (frameworks auto-escape text)
 * - 'escape': Escapes only HTML-sensitive chars (<, >, &) - for dangerouslySetInnerHTML contexts
 * - 'allowList': Only allows specified tags (for rich-text / CMS content)
 *
 * Note: Plain text characters like apostrophes ('), slashes (/), backticks (`), equals (=)
 * are NEVER escaped. They display correctly as text in modern frameworks and over-escaping
 * them breaks text content like "Kur'an", URLs, code snippets, etc.
 */

import type { SanitizationConfig } from '../shared/types';

export interface SanitizeOptions {
  config: SanitizationConfig;
}

// HTML entities to escape (minimal OWASP-safe set for HTML context)
// Only chars that affect HTML parsing: <, >, & (and " for attribute contexts)
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

// Regex patterns
const HTML_ENTITY_REGEX = /[&<>"]/g;

// URL protocol whitelists
const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:', 'tel:', 'ftp:'];
const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:'];

/**
 * Checks if a string is a safe URL that should not be sanitized.
 * Safe URLs include:
 * - Absolute URLs with safe protocols (https, http, mailto, tel, ftp)
 * - Relative paths starting with single slash (e.g., /callback)
 * 
 * XSS vectors are NOT safe:
 * - javascript: URLs
 * - data: URLs
 * - vbscript: URLs
 * - Protocol-relative URLs (//evil.com)
 */
function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  
  // Empty strings are not URLs
  if (!trimmed) return false;
  
  // Check for dangerous protocols first (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (DANGEROUS_PROTOCOLS.some(p => lower.startsWith(p))) {
    return false;
  }
  
  // Check for safe absolute URLs
  try {
    const url = new URL(trimmed);
    if (SAFE_PROTOCOLS.includes(url.protocol)) {
      return true;
    }
  } catch {
    // Not a valid absolute URL, continue checking
  }
  
  // Check for safe relative paths (single slash, not protocol-relative)
  // /callback is safe, //evil.com is not
  if (/^\/(?!\/)/.test(trimmed)) {
    return true;
  }
  
  return false;
}
const SCRIPT_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_HANDLER_PATTERN = /\s*on\w+\s*=\s*["'][^"']*["']/gi;
const JAVASCRIPT_URL_PATTERN = /javascript\s*:/gi;
const DATA_URL_PATTERN = /data\s*:[^;]*;base64/gi;

/**
 * Escapes HTML entities in a string
 */
function escapeHtml(str: string): string {
  return str.replace(HTML_ENTITY_REGEX, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Strips all HTML tags from a string
 *
 * Only matches well-formed HTML tags: `<` followed by a letter or `/letter`
 * (optionally with attributes) and a closing `>`. This is how real HTML
 * parsers (browsers, DOMPurify) behave.
 *
 * Text like "5 < 10 and 20 > 3" or "price > 100 & qty < 5" is preserved
 * because `< 10` is not a valid tag opener.
 */
function stripHtml(str: string): string {
  return str
    .replace(SCRIPT_PATTERN, '')                       // Remove script tags (with content)
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '')               // Remove well-formed HTML tags only
    .replace(/<!--[\s\S]*?-->/g, '')                   // Remove HTML comments
    .replace(EVENT_HANDLER_PATTERN, '')                // Remove any remaining event handlers
    .replace(JAVASCRIPT_URL_PATTERN, '')               // Remove javascript: URLs
    .replace(DATA_URL_PATTERN, '');                    // Remove suspicious base64 data URLs
}

/**
 * Sanitizes HTML while allowing specific tags
 */
function sanitizeWithAllowList(str: string, allowedTags: string[]): string {
  // First, remove dangerous content
  let result = str
    .replace(SCRIPT_PATTERN, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(JAVASCRIPT_URL_PATTERN, '')
    .replace(DATA_URL_PATTERN, '');
  
  // Build regex for allowed tags
  if (allowedTags.length === 0) {
    return escapeHtml(result);
  }
  
  const allowedPattern = allowedTags.join('|');
  const allowedRegex = new RegExp(`<(?!\/?(?:${allowedPattern})\\b)[^>]*>`, 'gi');
  
  // Remove non-allowed tags
  result = result.replace(allowedRegex, '');
  
  return result;
}

/**
 * Creates a sanitization function based on config
 */
export function createSanitizer(config?: SanitizationConfig) {
  // Default: 'strip' - removes HTML tags without over-escaping plain text chars.
  // Safe for React/Vue/Angular which auto-escape text content.
  const mode = config?.mode ?? 'strip';
  const allowedTags = config?.allowedTags ?? [];
  const enabled = config?.enabled !== false; // default: true
  const skipFields = config?.skipFields ?? [];

  /**
   * Sanitizes a single string value
   * Skips safe URLs to preserve returnUrl, callbackUrl, etc.
   */
  function sanitizeString(value: string): string {
    if (!enabled) return value;
    
    // Skip sanitization for safe URLs (https, http, mailto, tel, relative paths)
    // XSS vectors like javascript: and data: are still sanitized
    if (isSafeUrl(value)) {
      return value;
    }
    
    switch (mode) {
      case 'escape':
        return escapeHtml(value);
      case 'allowList':
        return sanitizeWithAllowList(value, allowedTags);
      case 'strip':
      default:
        return stripHtml(value);
    }
  }

  /**
   * Recursively sanitizes an object, array, or primitive value
   */
  function sanitizeValue(value: unknown, path: string = ''): unknown {
    // Skip fields in skipFields list
    if (skipFields.some(field => path.endsWith(field))) {
      return value;
    }

    // Null/undefined pass through
    if (value === null || value === undefined) {
      return value;
    }

    // Strings get sanitized
    if (typeof value === 'string') {
      return sanitizeString(value);
    }

    // Numbers, booleans pass through
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    // Arrays - sanitize each element
    if (Array.isArray(value)) {
      return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`));
    }

    // Objects - sanitize each property
    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const newPath = path ? `${path}.${key}` : key;
        sanitized[key] = sanitizeValue(val, newPath);
      }
      return sanitized;
    }

    // Everything else passes through
    return value;
  }

  /**
   * Main sanitize function
   * @param data - Data to sanitize
   * @param perRequestSkipFields - Additional fields to skip for this request only
   */
  function sanitize<T>(data: T, perRequestSkipFields?: string[]): T {
    if (!enabled) {
      return data;
    }
    const allSkipFields = perRequestSkipFields 
      ? [...skipFields, ...perRequestSkipFields]
      : skipFields;
    return sanitizeValueWithSkip(data, '', allSkipFields) as T;
  }

  /**
   * Sanitize with custom skip fields
   */
  function sanitizeValueWithSkip(value: unknown, path: string, fieldsToSkip: string[]): unknown {
    // Skip fields in skip list
    if (fieldsToSkip.some(field => path.endsWith(field) || path === field)) {
      return value;
    }

    // Null/undefined pass through
    if (value === null || value === undefined) {
      return value;
    }

    // Strings get sanitized
    if (typeof value === 'string') {
      return sanitizeString(value);
    }

    // Numbers, booleans pass through
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    // Arrays - sanitize each element
    if (Array.isArray(value)) {
      return value.map((item, index) => sanitizeValueWithSkip(item, `${path}[${index}]`, fieldsToSkip));
    }

    // Objects - sanitize each property
    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const newPath = path ? `${path}.${key}` : key;
        sanitized[key] = sanitizeValueWithSkip(val, newPath, fieldsToSkip);
      }
      return sanitized;
    }

    // Everything else passes through
    return value;
  }

  /**
   * Sanitize FormData values (returns new FormData with sanitized values)
   * @param formData - FormData to sanitize
   * @param perRequestSkipFields - Additional fields to skip for this request only
   */
  function sanitizeFormData(formData: FormData, perRequestSkipFields?: string[]): FormData {
    if (!enabled) {
      return formData;
    }
    
    const allSkipFields = perRequestSkipFields 
      ? [...skipFields, ...perRequestSkipFields]
      : skipFields;
    
    const sanitized = new FormData();
    
    for (const [key, value] of formData.entries()) {
      // Check if this field should be skipped
      const shouldSkip = allSkipFields.some(field => key === field || key.endsWith(field));
      
      if (value instanceof File) {
        // Files pass through unchanged
        sanitized.append(key, value);
      } else if (typeof value === 'string') {
        // Strings get sanitized (unless skipped)
        sanitized.append(key, shouldSkip ? value : sanitizeString(value));
      } else {
        // Everything else passes through
        sanitized.append(key, value);
      }
    }
    
    return sanitized;
  }

  return {
    sanitize,
    sanitizeString,
    sanitizeValue,
    sanitizeFormData,
  };
}

export type Sanitizer = ReturnType<typeof createSanitizer>;

/**
 * Default sanitizer with strip mode (enabled by default)
 * Strips HTML tags without mangling plain text characters.
 */
export const defaultSanitizer = createSanitizer({
  enabled: true,
  mode: 'strip',
  skipFields: [],
});

/**
 * Quick sanitize function with default config
 */
export function sanitize<T>(data: T): T {
  return defaultSanitizer.sanitize(data);
}

/**
 * Quick escape function for single strings
 */
export function escapeString(str: string): string {
  return escapeHtml(str);
}

/**
 * Quick strip function for single strings
 */
export function stripString(str: string): string {
  return stripHtml(str);
}
