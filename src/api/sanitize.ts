/**
 * XSS Sanitization utilities
 * Zero-dependency, lightweight sanitizer for API responses
 * 
 * Modes:
 * - 'escape' (default): Escapes HTML entities (&lt;script&gt;)
 * - 'strip': Removes all HTML tags completely
 * - 'allowList': Only allows specified tags (advanced)
 */

import type { SanitizationConfig } from '../shared/types';

export interface SanitizeOptions {
  config: SanitizationConfig;
}

// HTML entities to escape
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

// Regex patterns
const HTML_ENTITY_REGEX = /[&<>"'`=/]/g;

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
 */
function stripHtml(str: string): string {
  return str
    .replace(SCRIPT_PATTERN, '')           // Remove script tags first
    .replace(/<[^>]*>/g, '')               // Remove all HTML tags
    .replace(EVENT_HANDLER_PATTERN, '')    // Remove any remaining event handlers
    .replace(JAVASCRIPT_URL_PATTERN, '')   // Remove javascript: URLs
    .replace(DATA_URL_PATTERN, '');        // Remove suspicious data URLs
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
  const mode = config?.mode ?? 'escape';
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
      case 'strip':
        return stripHtml(value);
      case 'allowList':
        return sanitizeWithAllowList(value, allowedTags);
      case 'escape':
      default:
        return escapeHtml(value);
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
 * Default sanitizer with escape mode (enabled by default)
 */
export const defaultSanitizer = createSanitizer({
  enabled: true,
  mode: 'escape',
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
