# next-api-layer

> Production-grade API layer for Next.js + External JWT Backend (Laravel, Django, .NET, Go, Express)

[![npm](https://img.shields.io/npm/v/next-api-layer)](https://www.npmjs.com/package/next-api-layer)
[![GitHub](https://img.shields.io/github/license/dijinar/next-api-layer)](https://github.com/dijinar/next-api-layer)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14+-black)](https://nextjs.org)

## The Problem

Building Next.js apps with external JWT backends (not NextAuth/Clerk) requires:
- Token validation middleware
- Guest token handling
- XSS sanitization
- i18n support
- Cookie management with httpOnly
- Token refresh with caching
- ...and 15+ other concerns

**This library solves all of them in one package.**

## Installation

```bash
npm install next-api-layer
# or
pnpm add next-api-layer
# or
yarn add next-api-layer
```

## Quick Start

### 1. Create the Auth Proxy (Middleware)

```ts
// middleware.ts
import { createAuthProxy } from 'next-api-layer';

const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: {
    user: 'userAuthToken',
    guest: 'guestAuthToken',
  },
  guestToken: {
    enabled: true,
    credentials: {
      username: process.env.GUEST_USERNAME!,
      password: process.env.GUEST_PASSWORD!,
    },
  },
  access: {
    protectedRoutes: ['/dashboard', '/profile', '/settings'],
    authRoutes: ['/login', '/register'],
  },
});

export default authProxy;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

#### Custom Middleware (Composable)

Kendi middleware lojiğinizi eklemek istiyorsanız `beforeAuth` ve `afterAuth` hook'larını kullanabilirsiniz:

```ts
// middleware.ts
import { createAuthProxy } from 'next-api-layer';
import { NextRequest, NextResponse } from 'next/server';

const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: {
    user: 'userAuthToken',
    guest: 'guestAuthToken',
  },
  
  // Auth kontrolünden ÖNCE çalışır
  beforeAuth: async (req: NextRequest) => {
    const { pathname } = req.nextUrl;
    
    // Rate limiting
    if (pathname.startsWith('/api/') && isRateLimited(req)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    
    // Maintenance mode
    if (process.env.MAINTENANCE_MODE === 'true' && !pathname.startsWith('/maintenance')) {
      return NextResponse.redirect(new URL('/maintenance', req.url));
    }
    
    // Logging
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);
    
    // null döndür = auth kontrolüne devam et
    return null;
  },
  
  // Auth kontrolünden SONRA çalışır
  afterAuth: async (req, response, authResult) => {
    // Custom header ekle
    response.headers.set('x-auth-status', authResult.isAuthenticated ? 'authenticated' : 'guest');
    
    // Admin kontrolü
    if (req.nextUrl.pathname.startsWith('/admin') && authResult.user?.role !== 'admin') {
      return NextResponse.redirect(new URL('/403', req.url));
    }
    
    return response;
  },
});

export default authProxy;
```

### 2. Create the API Client

```ts
// lib/api.ts - Configure ONCE, use everywhere
import { createApiClient } from 'next-api-layer';

export const api = createApiClient({
  sanitization: {
    enabled: true,
    // Skip specific fields (e.g., fields containing intentional HTML)
    skipFields: ['html_content', 'raw_markdown'],
    // Skip entire endpoints (glob patterns supported)
    skipEndpoints: ['cms/*', 'pages/raw/**', 'content/html'],
  },
  i18n: {
    enabled: true,
    paramName: 'lang',
  },
  methodSpoofing: true, // For Laravel PUT/PATCH support
});
```

```ts
// Usage - ONE LINE anywhere in your app!
import { api } from '@/lib/api';

// Simple GET
const { data, success } = await api.get('users/profile');

// POST with body
const result = await api.post('projects', { body: { name: 'New Project' } });

// Per-request sanitization control
const rawHtml = await api.get('editor/content', { skipSanitize: true });

// Skip specific fields only (sanitize others)
const post = await api.post('blog/create', formData, {
  isFormData: true,
  skipSanitizeFields: ['content', 'raw_html'],
});

// With query params
const users = await api.get('users', { params: { page: 1, limit: 20 } });
```

### 3. Setup Auth Provider (Client-Side)

```tsx
// app/providers.tsx
'use client';

import { AuthProvider } from 'next-api-layer/client';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider
      userEndpoint="/api/auth/me"
      loginEndpoint="/api/auth/login"
      logoutEndpoint="/api/auth/logout"
      swrConfig={{ revalidateOnFocus: true }}
    >
      {children}
    </AuthProvider>
  );
}
```

### 4. Use the Auth Hook

```tsx
// components/UserProfile.tsx
'use client';

import { useAuth } from 'next-api-layer/client';

export function UserProfile() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!isAuthenticated) return <div>Please login</div>;

  return (
    <div>
      <h1>Welcome, {user.name}</h1>
      <p>{user.email}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### 5. Server Components

```tsx
// app/dashboard/page.tsx
import { getServerUser } from 'next-api-layer/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const { user, isAuthenticated } = await getServerUser({
    userCookie: 'userAuthToken',
    apiBaseUrl: process.env.API_BASE_URL,
  });

  if (!isAuthenticated) {
    redirect('/login');
  }

  return <div>Welcome, {user.name}!</div>;
}
```

## Architecture

```
Developer writes:     return api.get('client/projects/list');
Behind the scenes:    8-stage secure pipeline
```

### The Pipeline

1. **Token Cascade** - Check user token → guest token → create guest
2. **Token Validation** - Validate with backend, handle expiry
3. **Token Refresh** - Auto-refresh expired tokens
4. **Request Deduplication** - Prevent concurrent validation calls
5. **XSS Sanitization** - Clean all response data
6. **i18n Injection** - Add language parameter
7. **Method Spoofing** - Laravel PUT/PATCH support
8. **Error Handling** - Consistent error format

## Security

`createAuthProxy` includes built-in security controls for production deployments.

### CSRF Protection

Protects against Cross-Site Request Forgery using Fetch Metadata (modern browsers) and/or Signed Double-Submit Cookie pattern.

```ts
const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'userAuthToken', guest: 'guestAuthToken' },
  
  csrf: {
    enabled: true,
    strategy: 'both',           // 'fetch-metadata' | 'double-submit' | 'both'
    cookieName: '__csrf',       // Cookie name for token
    headerName: 'x-csrf-token', // Header name for token
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    trustSameSite: false,       // Trust same-site requests
  },
});
```

**Behavior:**
- Safe methods (`GET`, `HEAD`, `OPTIONS`) are automatically skipped
- Unsafe methods are validated using Fetch Metadata headers and/or double-submit cookie
- Failed validation returns `403 Forbidden` and emits `csrf:fail` audit event

### Rate Limiting

Token bucket algorithm for preventing abuse. In-memory store for single-instance deployments.

```ts
const authProxy = createAuthProxy({
  // ...base config
  
  rateLimit: {
    enabled: true,
    windowMs: 60_000,           // 1 minute window
    maxRequests: 100,           // Max requests per window
    skipRoutes: ['/health', '/public/*'],
    keyFn: (req) => req.headers.get('x-forwarded-for') || 'unknown',
    onRateLimited: (req) => NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 }
    ),
  },
});
```

**Response Headers:**
- `X-RateLimit-Limit`: Max requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when window resets
- `Retry-After`: Seconds until retry (on 429)

### Audit Logging

Event-based security logging for monitoring and compliance.

```ts
const authProxy = createAuthProxy({
  // ...base config
  
  audit: {
    enabled: true,
    events: [
      'auth:success',
      'auth:fail',
      'auth:refresh',
      'auth:guest',
      'access:denied',
      'csrf:fail',
      'rateLimit:exceeded',
      'error',
    ],
    logger: async (event) => {
      // Send to your SIEM, logging service, or database
      console.log('[AUDIT]', event.type, event.path, event.ip, event.success);
      
      // Example: Send to external service
      // await fetch('https://logs.example.com/audit', {
      //   method: 'POST',
      //   body: JSON.stringify(event),
      // });
    },
  },
});
```

**Event Structure:**
```ts
interface AuditEvent {
  type: AuditEventType;           // Event type
  timestamp: Date;                 // When it occurred
  ip: string | null;               // Client IP
  userId?: string;                 // User ID if authenticated
  path: string;                    // Request path
  method: string;                  // HTTP method
  success: boolean;                // Whether action succeeded
  metadata?: Record<string, unknown>; // Additional context
}
```

### Full Security Example

```ts
import { createAuthProxy } from 'next-api-layer';

export default createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'userAuthToken', guest: 'guestAuthToken' },

  csrf: {
    enabled: true,
    strategy: 'both',
  },

  rateLimit: {
    enabled: true,
    windowMs: 60_000,
    maxRequests: 100,
  },

  audit: {
    enabled: true,
    events: ['auth:success', 'auth:fail', 'csrf:fail', 'rateLimit:exceeded'],
    logger: async (event) => {
      console.log('[AUDIT]', JSON.stringify(event));
    },
  },
});
```

---

## API Reference

### createAuthProxy(config)

Creates a Next.js middleware for authentication.

```ts
interface AuthProxyConfig {
  apiBaseUrl: string;           // Backend API URL
  
  cookies: {
    user: string;               // User token cookie name
    guest: string;              // Guest token cookie name
    options?: CookieOptions;    // httpOnly, secure, sameSite, etc.
  };
  
  endpoints?: {
    validate?: string;          // Default: 'auth/me'
    refresh?: string;           // Default: 'auth/refresh'
    guest?: string;             // Default: 'auth/guest'
  };
  
  guestToken?: {
    enabled: boolean;
    credentials?: {
      username: string;
      password: string;
    };
  };
  
  access?: {
    protectedRoutes?: string[]; // Routes requiring auth
    authRoutes?: string[];      // Routes for non-auth users (login, register)
    publicRoutes?: string[];    // Completely public routes
    // Note: Locale prefix is automatically stripped before matching
    // e.g., '/tr/login' matches config '/login' when i18n is enabled
  };
  
  cache?: {
    ttl?: number;               // Default: 2000ms
    maxSize?: number;           // Default: 100 tokens
  };
  
  i18n?: {
    enabled?: boolean;          // Enable locale detection from URL
    locales?: string[];         // Valid locale codes ['en', 'tr', 'ar']
    defaultLocale?: string;     // Fallback locale
    middleware?: (req: NextRequest) => NextResponse;  // i18n middleware (e.g., next-intl)
  };
  
  // ======== Composability Hooks ========
  
  // Runs BEFORE auth validation. Return NextResponse to bypass auth.
  beforeAuth?: (req: NextRequest) => NextResponse | null | Promise<NextResponse | null>;
  
  // Runs AFTER auth validation. Modify response or add custom logic.
  afterAuth?: (req: NextRequest, response: NextResponse, authResult: AuthResult) => NextResponse | Promise<NextResponse>;
}

// AuthResult passed to afterAuth hook
interface AuthResult {
  isAuthenticated: boolean;     // true if valid user token
  isGuest: boolean;             // true if guest token
  tokenType: string | null;     // 'user', 'guest', etc.
  user: Record<string, unknown> | null;  // User data from token validation
}
```

### Different Backend Formats

Backend'iniz farklı response formatı dönüyorsa `responseMappers` ile uyumlu hale getirebilirsiniz:

```ts
// Laravel (default format - no mapping needed)
// { success: true, data: { type: 'user', exp: 123, user: {...} } }

// Django REST Framework
const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'token', guest: 'guest_token' },
  
  responseMappers: {
    // Django: { user: {...}, token_type: 'Bearer', exp: 123 }
    parseAuthMe: (res: any) => {
      if (!res?.user) return null;
      return {
        isValid: true,
        tokenType: res.is_guest ? 'guest' : 'user',
        exp: res.exp || null,
        userData: res.user,
      };
    },
    
    // Django: { access: 'new_token' }
    parseRefreshToken: (res: any) => res?.access || null,
    
    // Django: { token: 'guest_token' }
    parseGuestToken: (res: any) => res?.token || null,
  },
});

// .NET / ASP.NET Core
const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'AuthToken', guest: 'GuestToken' },
  
  responseMappers: {
    // .NET: { isSuccess: true, result: { userId, email, role } }
    parseAuthMe: (res: any) => {
      if (!res?.isSuccess) return null;
      return {
        isValid: true,
        tokenType: res.result?.role === 'Guest' ? 'guest' : 'user',
        exp: res.result?.expiresAt,
        userData: res.result,
      };
    },
    
    // .NET: { token: 'xxx', expiresIn: 3600 }
    parseRefreshToken: (res: any) => res?.token || null,
    parseGuestToken: (res: any) => res?.token || null,
  },
});

// Express.js / Custom Format
const authProxy = createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'jwt', guest: 'guest_jwt' },
  
  responseMappers: {
    // Custom: { ok: true, payload: { sub, name, email } }
    parseAuthMe: (res: any) => {
      if (!res?.ok) return null;
      return {
        isValid: true,
        tokenType: res.payload?.isGuest ? 'guest' : 'user',
        exp: res.payload?.exp,
        userData: res.payload,
      };
    },
    
    parseRefreshToken: (res: any) => res?.newToken || res?.accessToken || null,
    parseGuestToken: (res: any) => res?.guestToken || res?.token || null,
  },
});
```

### createApiClient(config)

Creates an API client for making requests.

```ts
interface ApiClientConfig {
  sanitization?: {
    enabled?: boolean;          // Default: true
    allowedTags?: string[];     // HTML tags to allow
    skipFields?: string[];      // Fields to skip sanitization
  };
  
  i18n?: {
    enabled?: boolean;          // Default: false
    paramName?: string;         // Default: 'lang'
    locales?: string[];         // Valid locale codes
    defaultLocale?: string;     // Fallback locale
  };
  
  methodSpoofing?: boolean;     // Default: false (for Laravel)
}

// Per-request options
interface RequestOptions {
  isFormData?: boolean;         // Send as FormData
  skipSanitize?: boolean;       // Skip all sanitization for this request
  skipSanitizeFields?: string[]; // Skip sanitization for specific fields
}
```

## i18n Integration

Automatic locale detection and injection for multilingual applications.

### How It Works

1. **Middleware** extracts locale from URL path (e.g., `/tr/blog` → `tr`)
2. **Sets `x-locale` header** on the request for downstream handlers
3. **API Client** reads the header and appends `?lang={locale}` to backend requests

### Configuration

```ts
// middleware.ts - Proxy config
createAuthProxy({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'userToken', guest: 'guestToken' },
  
  i18n: {
    enabled: true,
    locales: ['en', 'tr', 'ar'],  // Valid locales
    defaultLocale: 'en',           // Fallback when no locale in path
  },
});

// lib/api.ts - API client config
export const api = createApiClient({
  apiBaseUrl: process.env.API_BASE_URL!,
  cookies: { user: 'userToken', guest: 'guestToken' },
  
  i18n: {
    enabled: true,
    paramName: 'lang',             // Query param name (default: 'lang')
    locales: ['en', 'tr', 'ar'],
    defaultLocale: 'en',
  },
});
```

### Request Flow

```
User visits:  /tr/blog
   ↓
Middleware:   Extracts 'tr' → Sets x-locale: tr header
   ↓
Route Handler: await api.get('posts')
   ↓
API Client:   Reads x-locale header → Appends ?lang=tr
   ↓
Backend:      GET /api/posts?lang=tr
```

### Route Matching with Locale Prefix

When using `localePrefix: 'always'` (e.g., with next-intl), the library automatically strips the locale prefix before matching routes:

```ts
createAuthProxy({
  // ...
  access: {
    protectedRoutes: ['/dashboard', '/profile'],
    authRoutes: ['/login', '/register'],
  },
  i18n: {
    enabled: true,
    locales: ['en', 'tr'],
    defaultLocale: 'en',
  },
});

// These all match correctly:
// /login        → matches authRoutes '/login'
// /tr/login     → matches authRoutes '/login' (locale stripped)
// /en/dashboard → matches protectedRoutes '/dashboard' (locale stripped)
```

### With next-intl

The easiest way to integrate with next-intl is using the `middleware` option:

```ts
import { createAuthProxy } from 'next-api-layer';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export default createAuthProxy({
  apiBaseUrl: process.env.API_URL!,
  cookies: { user: 'userToken', guest: 'guestToken' },
  
  i18n: {
    enabled: true,
    locales: ['en', 'tr', 'ar'],
    defaultLocale: 'en',
    middleware: intlMiddleware,  // Library handles response merging automatically
  },
});
```

The library automatically:
- Calls your i18n middleware internally
- Preserves `x-locale`, `x-auth-user`, and `x-refreshed-token` headers
- Copies all auth cookies to the merged response

#### Advanced: Manual Middleware Control

If you need more control, use the `afterAuth` hook instead:

```ts
import { createAuthProxy } from 'next-api-layer';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export default createAuthProxy({
  apiBaseUrl: process.env.API_URL!,
  cookies: { user: 'userToken', guest: 'guestToken' },
  
  i18n: {
    enabled: true,
    locales: ['en', 'tr', 'ar'],
    defaultLocale: 'en',
  },
  
  afterAuth: async (req, response, _authResult) => {
    if (req.nextUrl.pathname.startsWith('/api')) {
      return response; // API routes keep auth response
    }
    
    // Page routes: run next-intl but preserve auth cookies
    const intlResponse = intlMiddleware(req);
    response.cookies.getAll().forEach(cookie => {
      intlResponse.cookies.set(cookie.name, cookie.value, {
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        path: cookie.path,
        maxAge: cookie.maxAge,
      });
    });
    
    return intlResponse;
  },
});
```

### AuthProvider

React context provider for client-side auth state.

```tsx
<AuthProvider
  userEndpoint="/api/auth/me"
  loginEndpoint="/api/auth/login"
  logoutEndpoint="/api/auth/logout"
  swrConfig={{ refreshInterval: 0 }}
  onLogin={(user) => console.log('Logged in:', user)}
  onLogout={() => console.log('Logged out')}
  onError={(error) => console.error(error)}
>
  {children}
</AuthProvider>
```

### useAuth()

Hook to access authentication state.

```ts
const {
  user,              // UserData | null
  isLoading,         // boolean
  isAuthenticated,   // boolean (true for real users)
  isGuest,           // boolean (true for guest tokens)
  error,             // Error | null
  login,             // (credentials) => Promise<LoginResult>
  logout,            // () => Promise<void>
  refresh,           // () => Promise<void>
} = useAuth();
```

### getServerUser(options)

Get user data in Server Components.

```ts
const { user, isAuthenticated, isGuest, token } = await getServerUser({
  userCookie: 'userAuthToken',
  guestCookie: 'guestAuthToken',
  apiBaseUrl: process.env.API_BASE_URL,
});
```

## Public API / Skip Auth

Bazı endpoint'ler (haber siteleri, public içerikler) authentication gerektirmez. Bu durumlar için `skipAuth` özelliğini kullanabilirsiniz:

### Global Config

```ts
const api = createApiClient({
  auth: {
    // Bu pattern'lere uyan endpoint'ler token göndermez
    publicEndpoints: ['news/*', 'categories', 'public/**'],
    
    // Opsiyonel: Tüm endpoint'ler default olarak public olsun
    // skipByDefault: true,
  },
});
```

### Per-Request Override

```ts
// Pattern'e uysa bile token gönder
await api.get('news/premium-article', { skipAuth: false });

// Pattern'e uymasa bile token gönderme
await api.get('some-endpoint', { skipAuth: true });
```

### Route Handler (createProxyHandler)

API route handler'ınızda `createProxyHandler` kullanarak backend'e proxy yapabilirsiniz:

```ts
// app/api/[...path]/route.ts
import { createProxyHandler } from 'next-api-layer';

const handler = createProxyHandler({
  apiBaseUrl: process.env.API_BASE_URL!,
  publicEndpoints: ['news/*', 'categories', 'public/**'],
  debug: process.env.NODE_ENV === 'development',
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
```

## Peer Dependencies

- `next` >= 14.0.0
- `react` >= 18.0.0
- `swr` >= 2.0.0 (optional, for client module)
- `next-intl` >= 3.0.0 (optional, for i18n)

## License

MIT
