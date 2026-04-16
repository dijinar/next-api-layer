# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-04-17

### Added
- **Enhanced Debug Body Logging**: Smart request/response body logging with DX-focused features
  - `logRequestBody` - Log request payloads separately (default: false)
  - `logResponseBody` - Log response data separately (default: false)
  - `maxStringLength` - Per-field string truncation (default: 500)
  - `maxArrayItems` - Array item limit with "... and N more" (default: 10)
  - `maxDepth` - Object nesting depth limit (default: 5)
  - `autoMask` - Enable/disable sensitive field masking (default: true)
  - `sensitiveFields` - Customize which fields to mask (password, token, secret, cvv, etc.)

- **Smart Binary Detection**: Automatically detects and summarizes binary-like data
  - Base64 strings shown as `[base64, 45KB]`
  - Data URLs shown as `[data URL (image/png), 2.3MB]`
  - Prevents terminal spam from large payloads

- **Enhanced FormData Logging**: Better visibility for file uploads
  - File info: `[File: photo.jpg, 2.4MB, image/jpeg]`
  - Sensitive fields masked in FormData
  - Field count with "... and N more fields"

### Changed
- `logBody` deprecated in favor of `logRequestBody`/`logResponseBody` (still works for backward compat)
- `bodyPreviewLength` deprecated in favor of `maxStringLength` (still works for backward compat)

### Example
```typescript
// Minimal config - smart defaults
debug: { enabled: true, logRequestBody: true, logResponseBody: true }

// Console output:
// → POST /auth/login
//   body: { email: "user@example.com", password: "***" }
// ✓ POST /auth/login - 200
//   body: { success: true, user: { id: 1, name: "John" }, token: "***" }
```

## [0.2.1] - 2026-04-16

### Fixed
- **URL field sanitization**: URL values in API payloads are now preserved correctly
  - Previously, URLs like `https://example.com/callback` were being encoded to `https&#x2F;&#x2F;example.com&#x2F;callback`
  - Safe URLs (https, http, mailto, tel, ftp, relative paths) now pass through unchanged
  - XSS vectors (javascript:, data:, vbscript:, protocol-relative //) are still sanitized
  - No configuration needed - automatic detection based on URL patterns

### Added
- `isSafeUrl()` internal function for smart URL detection
- 18 new unit tests for URL preservation scenarios

## [0.2.0] - 2026-04-15

### Added
- **Typed Error Classes**: New error hierarchy for better error handling
  - `ApiError` - Base error class with code and timestamp
  - `HttpError` - HTTP errors with status code and statusText
  - `TimeoutError` - Request timeout errors with endpoint and timeout info
  - `NetworkError` - Network failures with cause tracking
  - `AuthError` - Authentication errors with reason (no_token, invalid_token, expired_token)
  - `ValidationError` - Validation errors with field-level error messages
  - `RateLimitError` - Rate limit errors with retryAfter, limit, remaining info
  - Type guards: `isApiError()`, `isHttpError()`, `isTimeoutError()`, `isNetworkError()`, `isAuthError()`, `isRateLimitError()`
  - Utilities: `isRetryableStatus()`, `isRetryableError()`

- **Retry Logic**: Automatic retry for failed requests
  - `createApiClient({ retry: { enabled: true, maxAttempts: 3 } })`
  - Backoff strategies: `'exponential'`, `'linear'`, `'fixed'`
  - Configurable retry conditions: status codes, network errors
  - Per-request override: `api.get('/endpoint', { retry: false })`

- **Debug Mode**: Development logging for requests/responses
  - `createApiClient({ debug: { enabled: true } })`
  - Log requests, responses, timing, headers, body preview
  - Custom logger support: `debug: { logger: (msg, data) => ... }`

- **Request Deduplication**: Prevent duplicate in-flight requests
  - `createApiClient({ dedupe: { enabled: true, methods: ['GET'] } })`
  - Automatically returns same promise for identical concurrent requests
  - Per-request override: `api.get('/endpoint', { dedupe: false })`

- **Request ID / Correlation**: Request tracing headers
  - `createApiClient({ requestId: { enabled: true } })`
  - Custom header name: `requestId: { headerName: 'X-Correlation-ID' }`
  - Custom generator: `requestId: { generator: () => myUuid() }`
  - Per-request: `api.get('/endpoint', { requestId: true })` or `{ requestId: 'my-id' }`

- **`timeout` option**: Global and per-request timeout support
  - `createApiClient({ timeout: 30000 })` - global timeout (default: 30000ms)
  - `api.get('/endpoint', { timeout: 5000 })` - per-request override
  - Returns proper 408 status with timeout error message

- **`defaultHeaders` option**: Default headers for all API requests
  - `createApiClient({ defaultHeaders: { 'X-Custom-Header': 'value' } })`
  - Merged with request-specific headers

- **`errorMessages.serverError`**: Custom message for 5xx server errors
- **`errorMessages.timeout`**: Custom message for timeout errors
- **New tests**: Error classes tests (37), sanitizer tests (20)

- **Next.js 16+ Support**: Documentation and examples now support both:
  - `proxy.ts` with `export const proxy = authProxy` (Next.js 16+)
  - `middleware.ts` with `export default authProxy` (Next.js 14-15)

### Changed
- **BREAKING: `methodSpoofing` config**: Now accepts `boolean | MethodSpoofingConfig` instead of just `boolean`
  - Object config: `{ enabled: boolean, strategy: 'body' | 'header', fieldName?: string }`
  - Default strategy is `'body'` (appends `_method` field)
  - Header strategy uses `X-HTTP-Method-Override` header
  - Now supports DELETE method in addition to PUT/PATCH
- **`swrConfig` type**: Now uses full `SWRConfiguration` from SWR instead of limited subset
- **Improved variable naming**: Internal variables renamed for clarity (e.g., `res` → `fetchResponse`, `u` → `userData`)
- **CLI**: Uses native Node.js `readline/promises` instead of `prompts` library
  - Zero runtime dependencies
  - New questions: protected routes, auth routes
  - Generated config now includes `apiBaseUrl` and `cookies` for API client
  - Advanced options (retry, debug, csrf, rateLimit) added as comments

### Removed
- **`prompts` dependency**: CLI now uses native Node.js APIs (zero dependencies)

### Fixed
- **Server error handling**: 5xx errors now return proper error response with custom message
- **Type definitions**: All documented features now have accurate TypeScript types
- **TypeScript readonly array error**: Fixed `ignoreMethods` type compatibility

## [0.1.11] - 2026-04-13

### Fixed
- **Non-ASCII characters in x-auth-user header**: User data with Turkish (ğ, ş, ı, ö, ü, ç), German (ä, ö, ü, ß), or other non-ASCII characters now works correctly
  - HTTP headers only support ISO-8859-1 (0-255), characters like `ğ` (287) caused `TypeError: Cannot convert argument to a ByteString`
  - User data is now Base64 encoded in proxy and decoded in `getServerUser()`
  - This is an internal change - no API changes required

## [0.1.10] - 2026-04-10

### Fixed
- **login/register success detection**: `login()` and `register()` functions now correctly return `success: true` when API responds with success
  - Previously returned `success: false` when response didn't include user data (e.g., `{ success: true, message: "..." }`)
  - Now checks `res.ok && json.success !== false` instead of relying on user data presence
  - User data is now optional - if not in response, library fetches from `/me` endpoint

### Added
- **parseAuthResponse prop**: New optional prop for custom login/register response parsing
  - Allows handling non-standard backend auth response formats
  - Example: `parseAuthResponse={(json) => ({ success: json.ok, user: json.result?.user })}`
- **AuthResponseParsed type**: Exported from `next-api-layer/client` for TypeScript users

## [0.1.9] - 2026-04-10

### Fixed
- **i18n route matching**: `protectedRoutes`, `authRoutes`, and `publicRoutes` now correctly work with `localePrefix: 'always'`
  - Routes like `/tr/login` are now properly matched against config `/login`
  - Locale prefix is automatically stripped before route matching
  - Works with any locale configured in `i18n.locales`

### Added
- New `stripLocale()` utility function exported from `next-api-layer/proxy`
  - Strips locale prefix from pathname for custom route comparisons

## [0.1.8] - 2026-04-09

### Fixed
- **x-locale header loss**: Fixed issue where `x-locale` header was lost when using `i18n.middleware` option
  - Header is now set as response header instead of request header
  - Ensures locale is available in server components via `headers().get('x-locale')`

## [0.1.7] - 2026-04-09

### Added
- **i18n Middleware Integration**: New `middleware` option in `I18nConfig` for seamless next-intl integration
  - Library now handles i18n middleware internally and merges responses
  - Critical headers (`x-locale`, `x-auth-user`, `x-refreshed-token`) are preserved across middleware chain
  - No more header loss when using `afterAuth` hook with i18n middleware

### Changed
- Internal `applyAfterAuth` refactored to `applyMiddlewaresAndHooks` for better middleware composition
- Added `mergeResponses` helper to preserve headers and cookies when chaining responses

### Example Usage
```ts
import { createAuthProxy } from 'next-api-layer';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export default createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: {
    user: 'userAuthToken',
    guest: 'guestAuthToken',
  },
  i18n: {
    enabled: true,
    locales: ['tr', 'en'],
    defaultLocale: 'tr',
    middleware: intlMiddleware, // Library handles merging
  },
});
```

## [0.1.6] - 2026-04-07

### Added
- **Per-request sanitization control**: New options in `RequestOptions` for fine-grained sanitization control
  - `skipSanitize: boolean` - Skip all sanitization for a specific request
  - `skipSanitizeFields: string[]` - Skip sanitization for specific fields only
- `patch()` method now accepts `RequestOptions` parameter (was missing)

### Example Usage
```ts
// Skip all sanitization for this request
await api.post('admin/raw-html', body, { skipSanitize: true });

// Skip specific fields only (content will not be sanitized)
await api.post('blog/create', formData, {
  isFormData: true,
  skipSanitizeFields: ['content', 'raw_html']
});

// Works with patch too
await api.patch('blog/update', body, { skipSanitizeFields: ['content'] });
```

## [0.1.5] - 2026-04-04

### Added
- **i18n Support**: Automatic locale detection and injection for API requests
  - Added `i18n` config option to `createAuthProxy` for locale detection from URL path
  - Added `i18n` config option to `createApiClient` for auto-appending `?lang={locale}` to requests
  - New `x-locale` header for passing locale from middleware to route handlers
  - Configurable `paramName` (default: `lang`), `locales`, and `defaultLocale`

### Changed
- `HEADERS` constant now includes `LOCALE: 'x-locale'`
- `handlers.ts` now extracts locale from URL pathname and sets `x-locale` header
- `createApiClient` reads `x-locale` header and appends locale query parameter to backend requests

### Example Usage
```ts
// middleware.ts
createAuthProxy({
  // ...other config
  i18n: {
    enabled: true,
    locales: ['en', 'tr', 'ar'],
    defaultLocale: 'en',
  },
});

// lib/api.ts
createApiClient({
  // ...other config
  i18n: {
    enabled: true,
    paramName: 'lang',
    locales: ['en', 'tr', 'ar'],
    defaultLocale: 'en',
  },
});
```

## [0.1.4] - 2026-04-01

### Fixed
- **Empty cookie creation bug**: Fixed an issue where `cookies.delete()` was called on non-existent cookies, causing empty-value cookies to be set in the browser. Now all delete operations check for cookie existence before attempting deletion.
- Added `safeDeleteCookie` helper function that only deletes cookies that actually exist in the request.
- Updated `deleteAllAuthCookies` to accept `req` parameter for cookie existence checking.

### Changed
- All cookie delete operations now verify cookie existence before deletion to prevent phantom cookies.

## [0.1.3] - 2026-03-20

### Added
- Initial stable release with proxy and API client functionality
- Guest token support with automatic creation
- Token validation and refresh mechanisms
- Rate limiting support
- CSRF protection
- Audit logging capabilities
- next-intl integration support

### Features
- `createAuthProxy` - Main proxy function for Next.js
- `createApiClient` - Server-side API client
- `createProxyHandler` - Flexible proxy handler for route handlers
- `useAuth` - Client-side auth hook
- `AuthProvider` - React context provider
- `getServerUser` - Server-side user helper
