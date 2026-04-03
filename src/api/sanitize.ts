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
   */
  function sanitizeString(value: string): string {
    if (!enabled) return value;
    
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
   */
  function sanitize<T>(data: T): T {
    if (!enabled) {
      return data;
    }
    return sanitizeValue(data) as T;
  }

  /**
   * Sanitize FormData values (returns new FormData with sanitized values)
   */
  function sanitizeFormData(formData: FormData): FormData {
    if (!enabled) {
      return formData;
    }
    
    const sanitized = new FormData();
    
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        // Files pass through unchanged
        sanitized.append(key, value);
      } else if (typeof value === 'string') {
        // Strings get sanitized
        sanitized.append(key, sanitizeString(value));
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
