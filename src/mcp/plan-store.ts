/**
 * T020 — the session-scoped plan-reference store (data-model §5; research R5).
 * An in-memory `Map` keyed BY the reference itself: keys ARE the references, no plan
 * bodies are stored, nothing is ever persisted (zero fs). A restarted process starts
 * empty, so every previously handed-out reference is unknown.
 *
 * T030 (feature 014, resource-bounds.md §5): the session lifetime gained bounds —
 * lazy TTL expiry (age > ttl is absent, removed opportunistically on read; an eager
 * sweep runs inside `record`) and capacity trim (oldest `recordedAt` first,
 * insertion-order tie-break). NO timers; expiry/eviction ≡ unknown at the API, so
 * the engine's step-3 gate refuses identically. Defaults (bounds omitted) preserve
 * the pre-014 behavior: no expiry, unbounded.
 */

import type { Clock } from "../state/index.js";

/** The frozen planId shape (`src/engine/report.ts` artifact ids; apply schema pattern). */
export const PLAN_ID_PATTERN = /^[0-9a-f]{64}$/;

export function isPlanIdShape(value: string): boolean {
  return PLAN_ID_PATTERN.test(value);
}

export interface PlanReferenceRecord {
  readonly planId: string;
  readonly recordedAt: string;
}

/** 014 bounds (ranges 60..86400 / 1..100000 are guarded at the config layer). */
export interface PlanReferenceStoreBounds {
  /** Entries older than this are expired (age > ttl). Omitted ⇒ entries never expire. */
  readonly ttlSeconds?: number;
  /** Retention capacity. Omitted ⇒ unbounded. */
  readonly maxEntries?: number;
}

export interface PlanReferenceStore {
  /** Record a successful task_sync_plan reference; invalid shapes are refused (false). */
  record(planId: string): boolean;
  has(planId: string): boolean;
  get(planId: string): PlanReferenceRecord | null;
  readonly size: number;
}

export function createPlanReferenceStore(
  clock: Clock,
  bounds: PlanReferenceStoreBounds = {},
): PlanReferenceStore {
  const ttlMs = bounds.ttlSeconds === undefined ? Infinity : bounds.ttlSeconds * 1000;
  const maxEntries = bounds.maxEntries ?? Number.MAX_SAFE_INTEGER;
  const references = new Map<string, PlanReferenceRecord>();

  /** Expired ⇒ absent, removed opportunistically (lazy; the only sweeper is `record`). */
  function liveEntry(planId: string): PlanReferenceRecord | undefined {
    const entry = references.get(planId);
    if (entry === undefined) return undefined;
    if (clock.elapsed(entry.recordedAt) > ttlMs) {
      references.delete(planId);
      return undefined;
    }
    return entry;
  }

  function sweepExpired(): void {
    if (ttlMs === Infinity) return;
    for (const [key, entry] of references) {
      if (clock.elapsed(entry.recordedAt) > ttlMs) references.delete(key);
    }
  }

  /** Trim to capacity: oldest `recordedAt` first; ties break by insertion order. */
  function trimToCapacity(): void {
    while (references.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, entry] of references) {
        const at = Date.parse(entry.recordedAt);
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) return;
      references.delete(oldestKey);
    }
  }

  return {
    record(planId: string): boolean {
      if (!isPlanIdShape(planId)) return false; // shape check
      sweepExpired(); // expiry sweep precedes insert
      if (!references.has(planId)) {
        // No restamp of an existing key: the original expiry stands.
        references.set(planId, { planId, recordedAt: clock.now().toISOString() });
      }
      trimToCapacity();
      return true;
    },
    has: (planId) => liveEntry(planId) !== undefined,
    get: (planId) => liveEntry(planId) ?? null,
    get size(): number {
      return references.size;
    },
  };
}
