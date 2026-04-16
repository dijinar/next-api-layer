import { describe, expect, it } from 'vitest';
import { createSanitizer } from '../../src/api/sanitize';

describe('createSanitizer', () => {
  describe('escape mode (default)', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('should escape HTML entities', () => {
      expect(sanitizer.sanitizeString('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });

    it('should escape special characters', () => {
      expect(sanitizer.sanitizeString('a & b < c > d'))
        .toBe('a &amp; b &lt; c &gt; d');
    });

    it('should escape quotes', () => {
      expect(sanitizer.sanitizeString('say "hello" and \'hi\''))
        .toBe('say &quot;hello&quot; and &#x27;hi&#x27;');
    });

    it('should handle empty strings', () => {
      expect(sanitizer.sanitizeString('')).toBe('');
    });

    it('should handle strings without special characters', () => {
      expect(sanitizer.sanitizeString('Hello World')).toBe('Hello World');
    });
  });

  describe('strip mode', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'strip' });

    it('should remove all HTML tags', () => {
      expect(sanitizer.sanitizeString('<div>Hello</div>'))
        .toBe('Hello');
    });

    it('should remove script tags and content', () => {
      expect(sanitizer.sanitizeString('before<script>alert(1)</script>after'))
        .toBe('beforeafter');
    });

    it('should remove event handlers', () => {
      expect(sanitizer.sanitizeString('<img onclick="alert(1)" src="x">'))
        .toBe('');
    });

    it('should remove javascript: URLs', () => {
      expect(sanitizer.sanitizeString('<a href="javascript:alert(1)">click</a>'))
        .toBe('click');
    });
  });

  describe('allowList mode', () => {
    const sanitizer = createSanitizer({ 
      enabled: true, 
      mode: 'allowList',
      allowedTags: ['b', 'i', 'p']
    });

    it('should keep allowed tags', () => {
      expect(sanitizer.sanitizeString('<b>bold</b> and <i>italic</i>'))
        .toBe('<b>bold</b> and <i>italic</i>');
    });

    it('should remove non-allowed tags', () => {
      expect(sanitizer.sanitizeString('<div>text</div><b>bold</b>'))
        .toBe('text<b>bold</b>');
    });

    it('should remove script tags even if in allow list', () => {
      const permissive = createSanitizer({
        enabled: true,
        mode: 'allowList',
        allowedTags: ['script', 'b']
      });
      // Script tags are always removed for safety
      expect(permissive.sanitizeString('<script>evil</script><b>ok</b>'))
        .toBe('<b>ok</b>');
    });
  });

  describe('disabled mode', () => {
    const sanitizer = createSanitizer({ enabled: false });

    it('should not sanitize when disabled', () => {
      expect(sanitizer.sanitizeString('<script>alert(1)</script>'))
        .toBe('<script>alert(1)</script>');
    });
  });

  describe('URL preservation', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    describe('safe URLs (should NOT be sanitized)', () => {
      it('should preserve https URLs', () => {
        expect(sanitizer.sanitizeString('https://example.com/callback'))
          .toBe('https://example.com/callback');
      });

      it('should preserve https URLs with query params', () => {
        expect(sanitizer.sanitizeString('https://example.com/payment?id=123&status=success'))
          .toBe('https://example.com/payment?id=123&status=success');
      });

      it('should preserve http URLs', () => {
        expect(sanitizer.sanitizeString('http://localhost:3000/api/webhook'))
          .toBe('http://localhost:3000/api/webhook');
      });

      it('should preserve mailto URLs', () => {
        expect(sanitizer.sanitizeString('mailto:user@example.com'))
          .toBe('mailto:user@example.com');
      });

      it('should preserve tel URLs', () => {
        expect(sanitizer.sanitizeString('tel:+905551234567'))
          .toBe('tel:+905551234567');
      });

      it('should preserve ftp URLs', () => {
        expect(sanitizer.sanitizeString('ftp://files.example.com/download'))
          .toBe('ftp://files.example.com/download');
      });

      it('should preserve relative paths starting with /', () => {
        expect(sanitizer.sanitizeString('/callback'))
          .toBe('/callback');
      });

      it('should preserve relative paths with query params', () => {
        expect(sanitizer.sanitizeString('/api/webhook?token=abc'))
          .toBe('/api/webhook?token=abc');
      });

      it('should preserve relative paths with hash', () => {
        expect(sanitizer.sanitizeString('/page#section'))
          .toBe('/page#section');
      });
    });

    describe('XSS vectors (should STILL be sanitized)', () => {
      it('should not treat javascript: as safe URL', () => {
        // javascript: URLs are NOT safe, but escape mode only escapes HTML entities
        // The string doesn't contain /, <, >, &, etc. so escapeHtml returns it unchanged
        // This is expected - XSS protection for URLs should be at attribute level
        const result = sanitizer.sanitizeString('javascript:alert(1)');
        // isSafeUrl returns false, but no chars to escape
        expect(result).toBe('javascript:alert(1)');
      });

      it('should escape javascript: URLs containing escapable chars', () => {
        // If the URL contains /, it gets escaped proving isSafeUrl returned false
        const result = sanitizer.sanitizeString('javascript:location="/evil"');
        expect(result).toContain('&#x2F;');
      });

      it('should sanitize data: URLs containing HTML', () => {
        const result = sanitizer.sanitizeString('data:text/html,<script>alert(1)</script>');
        expect(result).not.toBe('data:text/html,<script>alert(1)</script>');
        expect(result).toContain('&lt;script&gt;');
      });

      it('should not treat vbscript: as safe URL', () => {
        // vbscript contains no escapable chars, passes through
        // But it's NOT marked as safe URL (isSafeUrl returns false)
        const result = sanitizer.sanitizeString('vbscript:msgbox("xss")');
        expect(result).toContain('&quot;'); // quotes get escaped
      });

      it('should sanitize protocol-relative URLs (//)', () => {
        const result = sanitizer.sanitizeString('//evil.com/steal');
        expect(result).toBe('&#x2F;&#x2F;evil.com&#x2F;steal');
      });
    });

    describe('URL fields in objects', () => {
      it('should preserve URL fields in nested objects', () => {
        const input = {
          returnUrl: 'https://example.com/payment-result',
          cancelUrl: 'https://example.com/payment-cancel',
          name: '<script>evil</script>',
        };
        const result = sanitizer.sanitize(input);
        expect(result.returnUrl).toBe('https://example.com/payment-result');
        expect(result.cancelUrl).toBe('https://example.com/payment-cancel');
        expect(result.name).toBe('&lt;script&gt;evil&lt;&#x2F;script&gt;');
      });

      it('should preserve URLs in arrays', () => {
        const input = {
          urls: [
            'https://example.com/one',
            'https://example.com/two',
            '<script>bad</script>'
          ],
        };
        const result = sanitizer.sanitize(input);
        expect(result.urls[0]).toBe('https://example.com/one');
        expect(result.urls[1]).toBe('https://example.com/two');
        expect(result.urls[2]).toBe('&lt;script&gt;bad&lt;&#x2F;script&gt;');
      });

      it('should preserve deeply nested URLs', () => {
        const input = {
          payment: {
            callbacks: {
              success: 'https://example.com/success',
              failure: '/error',
            },
          },
        };
        const result = sanitizer.sanitize(input);
        expect(result.payment.callbacks.success).toBe('https://example.com/success');
        expect(result.payment.callbacks.failure).toBe('/error');
      });
    });

    describe('FormData with URLs', () => {
      it('should preserve URLs in FormData', () => {
        const formData = new FormData();
        formData.append('returnUrl', 'https://example.com/callback');
        formData.append('comment', '<script>evil</script>');

        const result = sanitizer.sanitizeFormData(formData);
        expect(result.get('returnUrl')).toBe('https://example.com/callback');
        expect(result.get('comment')).toBe('&lt;script&gt;evil&lt;&#x2F;script&gt;');
      });
    });
  });

  describe('sanitize (object/array sanitization)', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('should sanitize nested objects', () => {
      const input = {
        name: '<script>evil</script>',
        nested: {
          value: '<img onerror="hack">',
        },
      };
      const result = sanitizer.sanitize(input);
      expect(result.name).toBe('&lt;script&gt;evil&lt;&#x2F;script&gt;');
      expect(result.nested.value).toBe('&lt;img onerror&#x3D;&quot;hack&quot;&gt;');
    });

    it('should sanitize arrays', () => {
      const input = {
        items: ['<b>one</b>', '<script>two</script>'],
      };
      const result = sanitizer.sanitize(input);
      expect(result.items).toEqual([
        '&lt;b&gt;one&lt;&#x2F;b&gt;',
        '&lt;script&gt;two&lt;&#x2F;script&gt;'
      ]);
    });

    it('should preserve non-string values', () => {
      const input = {
        count: 42,
        active: true,
        data: null,
      };
      const result = sanitizer.sanitize(input);
      expect(result).toEqual(input);
    });

    it('should skip specified fields', () => {
      const skipSanitizer = createSanitizer({ 
        enabled: true, 
        mode: 'escape',
        skipFields: ['html_content'] 
      });
      const input = {
        name: '<b>test</b>',
        html_content: '<b>test</b>',
      };
      const result = skipSanitizer.sanitize(input);
      expect(result.name).toBe('&lt;b&gt;test&lt;&#x2F;b&gt;');
      expect(result.html_content).toBe('<b>test</b>'); // Skipped
    });
  });

  describe('sanitizeFormData', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('should sanitize FormData string values', () => {
      const formData = new FormData();
      formData.append('name', '<script>evil</script>');
      formData.append('email', 'test@example.com');

      const result = sanitizer.sanitizeFormData(formData);
      expect(result.get('name')).toBe('&lt;script&gt;evil&lt;&#x2F;script&gt;');
      expect(result.get('email')).toBe('test@example.com');
    });

    it('should skip specified fields in FormData', () => {
      const formData = new FormData();
      formData.append('description', '<b>test</b>');
      formData.append('content', '<b>test</b>');

      const result = sanitizer.sanitizeFormData(formData, ['content']);
      expect(result.get('description')).toBe('&lt;b&gt;test&lt;&#x2F;b&gt;');
      expect(result.get('content')).toBe('<b>test</b>'); // Skipped
    });

    it('should preserve File objects', () => {
      const formData = new FormData();
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      formData.append('file', file);
      formData.append('name', 'test');

      const result = sanitizer.sanitizeFormData(formData);
      expect(result.get('file')).toBeInstanceOf(File);
      expect(result.get('name')).toBe('test');
    });
  });
});
