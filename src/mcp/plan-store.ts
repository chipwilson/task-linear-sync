/**
 * T020 — the session-scoped plan-reference store (data-model §5; research R5).
 * An in-memory `Map` keyed BY the reference itself: keys ARE the references, no plan
 * bodies are stored, nothing is ever persisted (zero fs, zero TTL). A restarted
 * process starts empty, so every previously handed-out reference is unknown — the
 * freshness rule is session membership plus the engine's own guards, never wall-clock.
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

export interface PlanReferenceStore {
  /** Record a successful task_sync_plan reference; invalid shapes are refused (false). */
  record(planId: string): boolean;
  has(planId: string): boolean;
  get(planId: string): PlanReferenceRecord | null;
  readonly size: number;
}

export function createPlanReferenceStore(clock: Clock): PlanReferenceStore {
  const references = new Map<string, PlanReferenceRecord>();
  return {
    record(planId: string): boolean {
      if (!isPlanIdShape(planId)) return false;
      if (!references.has(planId)) {
        references.set(planId, { planId, recordedAt: clock.now().toISOString() });
      }
      return true;
    },
    has: (planId) => references.has(planId),
    get: (planId) => references.get(planId) ?? null,
    get size(): number {
      return references.size;
    },
  };
}
