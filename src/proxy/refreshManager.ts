/**
 * Single-flight (request coalescing) helper.
 *
 * Coalesces concurrent async operations that share a key so only one runs at a
 * time; the rest await the in-flight promise and receive its result. Used to
 * de-duplicate concurrent token refreshes for the same token, preventing the
 * orphan/bounce that server-side `jti` rotation causes under concurrency.
 *
 * Scope: the in-flight map lives in module memory, so coalescing is guaranteed
 * only within a single runtime instance. Separate processes or instances --
 * PM2 cluster workers, Passenger, Docker replicas, serverless/edge isolates --
 * each keep their own map and may still refresh independently; configure
 * `refresh.store` to coalesce across them.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, producer: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = (async () => producer())().finally(() => {
        inFlight.delete(key);
      });

      inFlight.set(key, promise);
      return promise;
    },
  };
}

export type SingleFlight<T> = ReturnType<typeof createSingleFlight<T>>;

/**
 * Derives an opaque key for a token, so a shared refresh store never holds the
 * token itself in its keyspace.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
