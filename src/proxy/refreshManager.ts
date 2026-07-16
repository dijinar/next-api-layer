/**
 * Single-flight (request coalescing) helper.
 *
 * Coalesces concurrent async operations that share a key so only one runs at a
 * time; the rest await the in-flight promise and receive its result. Used to
 * de-duplicate concurrent token refreshes for the same token, preventing the
 * orphan/bounce that server-side `jti` rotation causes under concurrency.
 *
 * Scope: the in-flight map lives in module memory, so coalescing is guaranteed
 * only within a single runtime instance. Across separate serverless/edge
 * isolates, concurrent requests may still trigger independent refreshes.
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
