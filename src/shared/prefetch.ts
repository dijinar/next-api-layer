/**
 * Prefetch Detection
 *
 * Next.js `<Link>` components automatically prefetch routes on hover/viewport,
 * and the App Router issues speculative navigation requests. These pass through
 * the middleware matcher just like real navigations, so without filtering they
 * inflate rate-limit counters and can trigger false 429s after only a handful
 * of visible clicks.
 *
 * This module detects such speculative requests via the standard signalling
 * headers so they can be excluded from rate limiting.
 */

import type { NextRequest } from 'next/server';

/**
 * Detects whether a request is a speculative prefetch rather than a real,
 * user-initiated navigation.
 *
 * Recognises:
 * - `Next-Router-Prefetch: 1` (Next.js App Router prefetch)
 * - `Sec-Purpose: prefetch` / `prefetch;prerender` (modern browsers)
 * - `Purpose: prefetch` / `X-Purpose: prefetch` (legacy/Safari)
 * - `X-Moz: prefetch` (Firefox)
 *
 * @param req - Incoming request
 * @returns `true` if the request looks like a prefetch
 */
export function isPrefetchRequest(req: NextRequest): boolean {
  const headers = req.headers;

  if (headers.get('next-router-prefetch') === '1') return true;

  const secPurpose = headers.get('sec-purpose');
  if (secPurpose && secPurpose.includes('prefetch')) return true;

  if (headers.get('purpose') === 'prefetch') return true;
  if (headers.get('x-purpose') === 'prefetch') return true;
  if (headers.get('x-moz') === 'prefetch') return true;

  return false;
}
