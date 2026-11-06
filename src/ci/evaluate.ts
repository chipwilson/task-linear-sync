/**
 * 013-ci-enforcement-layer pure condition evaluation (T024; data-model §3).
 * Pure function of the parsed report bytes + settings slice: no I/O, no
 * clock, no env. Counts are ALWAYS computed for all three conditions;
 * `triggered` contains enabled-only predicates in stable order (a)(b)(c).
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

export type ConditionSettings = Pick<
  EnforcementSettings,
  | "failOnUnmapped"
  | "unmappedThreshold"
  | "failOnConflicts"
  | "failOnDrift"
  | "driftThreshold"
  | "protectedBranches"
  | "targetBranch"
>;

const SPEC_DRIFT_REASONS: readonly string[] = ["conflict:spec-changed", "conflict:both-changed"];

/** Evaluate the three gating conditions over a parsed report (data-model §3). */
export function evaluateConditions(
  report: ParsedReport,
  settings: ConditionSettings,
): EvaluationResult {
  let unmappedHighConfidence = 0;
  let unresolvedConflictBlocks = 0;
  let specDrift = 0;

  for (const entry of report.entries) {
    // (a) high band with no mapped issue.
    if (entry.confidence === "high" && entry.issueId === null) {
      unmappedHighConfidence += 1;
    }
    // (b) unresolved marker blocks ONLY (decision "conflict" without the flag: no).
    if (entry.unresolvedConflict === true) {
      unresolvedConflictBlocks += 1;
    }
    // (c) drift on MATCHED entries only (issueId !== null).
    if (
      entry.issueId !== null &&
      (entry.reasons.some((reason) => SPEC_DRIFT_REASONS.includes(reason)) ||
        entry.changedFields.length > 0 ||
        entry.expectedMarkdownChanges.length > 0)
    ) {
      specDrift += 1;
    }
  }

  const counts: ConditionCounts = { unmappedHighConfidence, unresolvedConflictBlocks, specDrift };

  // R6 classification: possible only with a known target AND a non-empty protected set.
  const classified = settings.targetBranch !== null && settings.protectedBranches.length > 0;
  const targeted =
    classified && settings.protectedBranches.includes(settings.targetBranch ?? "");
  const protectionSkipped = settings.failOnConflicts && !classified;

  const triggered: TriggeredCondition[] = [];
  if (settings.failOnUnmapped && counts.unmappedHighConfidence > settings.unmappedThreshold) {
    triggered.push({ condition: "unmapped-high-confidence", count: counts.unmappedHighConfidence });
  }
  if (settings.failOnConflicts && targeted && counts.unresolvedConflictBlocks >= 1) {
    triggered.push({ condition: "unresolved-conflict-block", count: counts.unresolvedConflictBlocks });
  }
  if (settings.failOnDrift && counts.specDrift > settings.driftThreshold) {
    triggered.push({ condition: "spec-drift", count: counts.specDrift });
  }

  return { counts, triggered, protectionSkipped };
}
