/**
 * Client IP Resolution
 *
 * Resolves the real client IP from a request using a prioritized list of
 * headers. Edge/CDN headers (Cloudflare's `cf-connecting-ip`, Akamai/CF
 * Enterprise's `true-client-ip`) are preferred over `x-forwarded-for`, which
 * is trivially spoofable and may be mangled by intermediate proxies.
 *
 * Security note: none of these headers are trustworthy unless your edge/proxy
 * is configured to overwrite them. Only rely on IP-based keys when you control
 * the proxy chain (e.g. Cloudflare → nginx → Next.js with trusted proxies).
 */

import type { NextRequest } from 'next/server';

/**
 * Default header priority used to resolve the client IP.
 * Ordered from most-trustworthy (set by the edge) to least.
 */
export const DEFAULT_IP_HEADERS = [
  'cf-connecting-ip', // Cloudflare
  'true-client-ip', // Cloudflare Enterprise / Akamai
  'x-real-ip', // nginx
  'x-forwarded-for', // generic proxy chain (first hop)
] as const;

/**
 * Resolve the client IP from a request.
 *
 * For `x-forwarded-for` (a comma-separated list), only the first (left-most)
 * hop is used, which is the original client when the proxy chain is trusted.
 *
 * @param req - Incoming request
 * @param headerPriority - Ordered list of header names to try
 * @returns The resolved client IP, or `null` if none could be found
 */
export function getClientIp(
  req: NextRequest,
  headerPriority: readonly string[] = DEFAULT_IP_HEADERS,
): string | null {
  for (const header of headerPriority) {
    const value = req.headers.get(header);
    if (!value) continue;

    // Forwarded headers may carry a comma-separated chain; take the first hop.
    const ip = value.split(',')[0]?.trim();
    if (ip) return ip;
  }

  return null;
}
