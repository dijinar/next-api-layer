import { describe, expect, it } from 'vitest';
import { createSanitizer } from '../../src/api/sanitize';

describe('createSanitizer', () => {
  describe('escape mode', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('escapes HTML tag chars only', () => {
      expect(sanitizer.sanitizeString('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('escapes special characters', () => {
      expect(sanitizer.sanitizeString('a & b < c > d'))
        .toBe('a &amp; b &lt; c &gt; d');
    });

    it('escapes double quotes but preserves apostrophes', () => {
      expect(sanitizer.sanitizeString('say "hi" and \'ok\''))
        .toBe('say &quot;hi&quot; and \'ok\'');
    });

    it('preserves plain text chars (/, `, =, \')', () => {
      expect(sanitizer.sanitizeString("Kur'an")).toBe("Kur'an");
      expect(sanitizer.sanitizeString('path/to/file')).toBe('path/to/file');
      expect(sanitizer.sanitizeString('x = y')).toBe('x = y');
      expect(sanitizer.sanitizeString('code `here`')).toBe('code `here`');
    });

    it('handles empty and plain strings', () => {
      expect(sanitizer.sanitizeString('')).toBe('');
      expect(sanitizer.sanitizeString('Hello World')).toBe('Hello World');
    });
  });

  describe('strip mode (default)', () => {
    const sanitizer = createSanitizer({ enabled: true });

    it('defaults to strip mode and preserves plain text', () => {
      expect(sanitizer.sanitizeString("Afrika Kur'an Hediyesi"))
        .toBe("Afrika Kur'an Hediyesi");
      expect(sanitizer.sanitizeString('path/to/resource'))
        .toBe('path/to/resource');
    });

    it('preserves bare <, >, & that are not tags', () => {
      expect(sanitizer.sanitizeString('5 < 10 and 20 > 3'))
        .toBe('5 < 10 and 20 > 3');
      expect(sanitizer.sanitizeString('price > 100 & qty < 5'))
        .toBe('price > 100 & qty < 5');
    });

    it('strips real HTML tags', () => {
      expect(sanitizer.sanitizeString('<script>alert(1)</script>hello'))
        .toBe('hello');
      expect(sanitizer.sanitizeString('<b>bold</b> text'))
        .toBe('bold text');
    });
  });

  describe('strip mode (explicit)', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'strip' });

    it('removes all HTML tags', () => {
      expect(sanitizer.sanitizeString('<div>Hello</div>')).toBe('Hello');
    });

    it('removes script tags and content', () => {
      expect(sanitizer.sanitizeString('before<script>alert(1)</script>after'))
        .toBe('beforeafter');
    });

    it('removes event handlers', () => {
      expect(sanitizer.sanitizeString('<img src="x" onerror="alert(1)">'))
        .toBe('');
    });

    it('removes HTML comments', () => {
      expect(sanitizer.sanitizeString('before<!-- comment -->after'))
        .toBe('beforeafter');
    });
  });

  describe('allowList mode', () => {
    const sanitizer = createSanitizer({
      enabled: true,
      mode: 'allowList',
      allowedTags: ['b', 'i', 'em', 'strong'],
    });

    it('allows whitelisted tags', () => {
      expect(sanitizer.sanitizeString('<b>bold</b> text'))
        .toBe('<b>bold</b> text');
    });

    it('strips non-whitelisted tags', () => {
      expect(sanitizer.sanitizeString('<div><b>bold</b></div>'))
        .toBe('<b>bold</b>');
    });

    it('always strips script tags', () => {
      expect(sanitizer.sanitizeString('<b>ok</b><script>bad</script>'))
        .toBe('<b>ok</b>');
    });
  });

  describe('disabled sanitizer', () => {
    const sanitizer = createSanitizer({ enabled: false });

    it('does not modify input', () => {
      expect(sanitizer.sanitizeString('<script>alert(1)</script>'))
        .toBe('<script>alert(1)</script>');
    });
  });

  describe('URL preservation', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('preserves https, http, mailto, tel, ftp and relative URLs', () => {
      expect(sanitizer.sanitizeString('https://example.com/path?q=1'))
        .toBe('https://example.com/path?q=1');
      expect(sanitizer.sanitizeString('http://example.com'))
        .toBe('http://example.com');
      expect(sanitizer.sanitizeString('/api/users')).toBe('/api/users');
      expect(sanitizer.sanitizeString('mailto:user@example.com'))
        .toBe('mailto:user@example.com');
      expect(sanitizer.sanitizeString('tel:+905551234567'))
        .toBe('tel:+905551234567');
      expect(sanitizer.sanitizeString('ftp://files.example.com/x.zip'))
        .toBe('ftp://files.example.com/x.zip');
    });

    it('sanitizes data: URLs containing HTML', () => {
      const result = sanitizer.sanitizeString(
        'data:text/html,<script>alert(1)</script>'
      );
      expect(result).toContain('&lt;script&gt;');
    });

    it('escapes quotes in dangerous URLs', () => {
      expect(sanitizer.sanitizeString('javascript:location="evil"'))
        .toContain('&quot;');
      expect(sanitizer.sanitizeString('vbscript:msgbox("xss")'))
        .toContain('&quot;');
    });

    it('passes javascript: and protocol-relative through escape mode', () => {
      expect(sanitizer.sanitizeString('javascript:alert(1)'))
        .toBe('javascript:alert(1)');
      expect(sanitizer.sanitizeString('//evil.com/steal'))
        .toBe('//evil.com/steal');
    });

    it('preserves URL fields in nested objects', () => {
      const input = {
        returnUrl: 'https://example.com/payment-result',
        cancelUrl: 'https://example.com/payment-cancel',
        name: '<script>evil</script>',
      };
      const result = sanitizer.sanitize(input);
      expect(result.returnUrl).toBe('https://example.com/payment-result');
      expect(result.cancelUrl).toBe('https://example.com/payment-cancel');
      expect(result.name).toBe('&lt;script&gt;evil&lt;/script&gt;');
    });

    it('preserves URLs in arrays', () => {
      const input = {
        urls: [
          'https://example.com/one',
          'https://example.com/two',
          '<script>bad</script>',
        ],
      };
      const result = sanitizer.sanitize(input);
      expect(result.urls[0]).toBe('https://example.com/one');
      expect(result.urls[1]).toBe('https://example.com/two');
      expect(result.urls[2]).toBe('&lt;script&gt;bad&lt;/script&gt;');
    });

    it('preserves URLs in FormData', () => {
      const formData = new FormData();
      formData.append('returnUrl', 'https://example.com/callback');
      formData.append('comment', '<script>evil</script>');

      const result = sanitizer.sanitizeFormData(formData);
      expect(result.get('returnUrl')).toBe('https://example.com/callback');
      expect(result.get('comment')).toBe('&lt;script&gt;evil&lt;/script&gt;');
    });
  });

  describe('sanitize object/array', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('sanitizes nested objects', () => {
      const input = {
        name: '<script>evil</script>',
        nested: { value: '<img onerror="hack">' },
      };
      const result = sanitizer.sanitize(input);
      expect(result.name).toBe('&lt;script&gt;evil&lt;/script&gt;');
      expect(result.nested.value).toBe('&lt;img onerror=&quot;hack&quot;&gt;');
    });

    it('sanitizes arrays', () => {
      const input = { items: ['<b>one</b>', '<script>two</script>'] };
      const result = sanitizer.sanitize(input);
      expect(result.items).toEqual([
        '&lt;b&gt;one&lt;/b&gt;',
        '&lt;script&gt;two&lt;/script&gt;',
      ]);
    });

    it('skips specified fields', () => {
      const skipSanitizer = createSanitizer({
        enabled: true,
        mode: 'escape',
        skipFields: ['html_content'],
      });
      const input = { name: '<b>t</b>', html_content: '<b>t</b>' };
      const result = skipSanitizer.sanitize(input);
      expect(result.name).toBe('&lt;b&gt;t&lt;/b&gt;');
      expect(result.html_content).toBe('<b>t</b>');
    });

    it('passes through primitives', () => {
      const input = {
        age: 30,
        active: true,
        a: null,
        b: undefined,
        name: '<b>x</b>',
      };
      const result = sanitizer.sanitize(input);
      expect(result.age).toBe(30);
      expect(result.active).toBe(true);
      expect(result.a).toBeNull();
      expect(result.b).toBeUndefined();
      expect(result.name).toBe('&lt;b&gt;x&lt;/b&gt;');
    });
  });

  describe('sanitizeFormData', () => {
    const sanitizer = createSanitizer({ enabled: true, mode: 'escape' });

    it('sanitizes FormData string values', () => {
      const formData = new FormData();
      formData.append('name', '<script>evil</script>');
      formData.append('email', 'test@example.com');

      const result = sanitizer.sanitizeFormData(formData);
      expect(result.get('name')).toBe('&lt;script&gt;evil&lt;/script&gt;');
      expect(result.get('email')).toBe('test@example.com');
    });

    it('skips specified fields', () => {
      const formData = new FormData();
      formData.append('description', '<b>t</b>');
      formData.append('content', '<b>t</b>');

      const result = sanitizer.sanitizeFormData(formData, ['content']);
      expect(result.get('description')).toBe('&lt;b&gt;t&lt;/b&gt;');
      expect(result.get('content')).toBe('<b>t</b>');
    });

    it('preserves File objects', () => {
      const formData = new FormData();
      const file = new File(['c'], 'test.txt', { type: 'text/plain' });
      formData.append('file', file);
      formData.append('name', 'test');

      const result = sanitizer.sanitizeFormData(formData);
      expect(result.get('file')).toBeInstanceOf(File);
      expect(result.get('name')).toBe('test');
    });
  });
});
