# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
