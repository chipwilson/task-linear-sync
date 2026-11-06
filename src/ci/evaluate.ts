/**
 * 013-ci-enforcement-layer pure condition evaluation (T024; data-model §3).
 * Stub surface — logic lands with T024. Pure: no I/O, clock, or env.
 */

import type { EnforcementSettings } from "./settings.js";
import type { ParsedReport } from "./report-input.js";

export type ConditionId =
  | "unmapped-high-confidence"
  | "unresolved-conflict-block"
  | "spec-drift";

/** Stable display/output order (a)(b)(c) — the summary joins in this order. */
export const CONDITION_IDS: readonly ConditionId[] = [
  "unmapped-high-confidence",
  "unresolved-conflict-block",
  "spec-drift",
];

export interface ConditionCounts {
  readonly unmappedHighConfidence: number;
  readonly unresolvedConflictBlocks: number;
  readonly specDrift: number;
}

export interface TriggeredCondition {
  readonly condition: ConditionId;
  readonly count: number;
}

export interface EvaluationResult {
  /** ALWAYS all three counts, enabled or not. */
  readonly counts: ConditionCounts;
  /** Enabled-only triggers, stable order (a)(b)(c). */
  readonly triggered: readonly TriggeredCondition[];
  /** R6: (b) enabled but branch classification impossible. */
  readonly protectionSkipped: boolean;
}

/** Evaluate the three gating conditions over a parsed report (data-model §3). */
export function evaluateConditions(
  _report: ParsedReport,
  _settings: Pick<
    EnforcementSettings,
    | "failOnUnmapped"
    | "unmappedThreshold"
    | "failOnConflicts"
    | "failOnDrift"
    | "driftThreshold"
    | "protectedBranches"
    | "targetBranch"
  >,
): EvaluationResult {
  throw new Error("T024: not implemented");
}
