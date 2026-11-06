/**
 * Non-authoritative TTL cache + single-flight (T029; FR-006, data-model §5,
 * contracts/component-api.md §4).
 *
 * Freshness is decided exclusively against the INJECTED clock, `ttl 0` stores
 * nothing, failures never enter the cache (and a failed re-read drops the
 * stale entry), and concurrent misses for one key coalesce into a single
 * walk. The cache is a display nicety only — it is never authoritative state
 * and nothing here persists across process restarts.
 */

import type { HistoryClock } from "./types.js";

export interface HistoryCacheDeps {
  readonly ttlSeconds: number;
  readonly clock: HistoryClock;
}

export interface CacheOutcome<T> {
  readonly value: T;
  readonly cacheState: "hit" | "miss";
  readonly ageMs: number;
}

export interface HistoryCache {
  /** Fresh entry ⇒ hit; otherwise run (or join) the loader exactly once. */
  load<T>(key: string, loader: () => Promise<T>): Promise<CacheOutcome<T>>;
  /** Entries currently retained (0 whenever the TTL disables caching). */
  size(): number;
}

interface CacheEntry {
  readonly value: unknown;
  readonly builtAtIso: string;
}

export function createHistoryCache(deps: HistoryCacheDeps): HistoryCache {
  const ttlMs = deps.ttlSeconds > 0 ? deps.ttlSeconds * 1000 : 0;
  const entries = new Map<string, CacheEntry>();
  const flights = new Map<string, Promise<CacheOutcome<unknown>>>();

  function freshOutcome(entry: CacheEntry): CacheOutcome<unknown> {
    return { value: entry.value, cacheState: "hit", ageMs: Math.max(0, deps.clock.elapsed(entry.builtAtIso)) };
  }

  function load<T>(key: string, loader: () => Promise<T>): Promise<CacheOutcome<T>> {
    if (ttlMs > 0) {
      const entry = entries.get(key);
      if (entry !== undefined && deps.clock.elapsed(entry.builtAtIso) < ttlMs) {
        return Promise.resolve(freshOutcome(entry) as CacheOutcome<T>);
      }
    }

    const inFlight = flights.get(key);
    if (inFlight !== undefined) {
      return inFlight as Promise<CacheOutcome<T>>;
    }

    const flight: Promise<CacheOutcome<T>> = loader().then(
      (value) => {
        if (ttlMs > 0) {
          entries.set(key, { value, builtAtIso: deps.clock.now().toISOString() });
        }
        return { value, cacheState: "miss", ageMs: 0 } satisfies CacheOutcome<T>;
      },
      (error: unknown) => {
        // A failed reconstruction caches nothing and keeps no stale copy.
        entries.delete(key);
        throw error;
      },
    );

    const tracked = flight.finally(() => {
      flights.delete(key);
    });
    flights.set(key, tracked as Promise<CacheOutcome<unknown>>);
    return tracked as Promise<CacheOutcome<T>>;
  }

  return {
    load,
    size: () => entries.size,
  };
}
