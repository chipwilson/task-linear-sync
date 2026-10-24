/**
 * T023 [US1] — FR-001 weighted integer signal scoring (contracts/confidence-scoring.md
 * §1 registry; research R1). Weight resolution: frozen `ResolvedConfig.scoringWeights`
 * keys + derived values from the 001 R5 default ratios + the `MatchingWeightOverrides`
 * programmatic layer (Principle III overridability; plan.md Complexity Tracking).
 * Title credit: "exact, else contained, else fuzzy — the strictest satisfied form
 * only"; all other signals sum independently and the total is unbounded and ≥ 0.
 */
import { checkMatchingConfig } from "./config-check.js";
import { MatchingConfigError } from "./errors.js";
import { normalizeTitle, overlapRatio, tokenize } from "./normalize.js";
import type {
  MatchingWeightOverrides,
  PairScore,
  SignalContribution,
  TaskMatchInput,
} from "./types.js";
import type { MatchCandidate } from "./types.js";
import type { ResolvedConfig } from "task-linear-sync/config";

/** `round(0.5 × issueRefExact)` — 001 R5 ratio 110:220 (research R1 signal 3). */
const LOCAL_TASK_ID_RATIO = 0.5;
/** `round(titleContainedRatio × titleExact)` with default ratio 0.65 — R5 ratio 65:100. */
export const DEFAULT_TITLE_CONTAINED_RATIO = 0.65;
/** 001 R5 same-project / same-framework alignment defaults (research R1 signals 7–8). */
export const DEFAULT_CONTAINER_ALIGNMENT_WEIGHT = 10;

export interface ResolvedWeights {
  readonly durableUuid: number;
  readonly issueRefExact: number;
  readonly localTaskId: number;
  readonly titleExact: number;
  readonly titleContained: number;
  readonly titleTokenOverlap: number;
  readonly sameProject: number;
  readonly sameFramework: number;
}

/** Round half-up on non-negative values (integer points contract). */
function roundHalfUp(value: number): number {
  return Math.round(value);
}

function assertOverrideWeight(value: number | undefined, key: string, rule: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MatchingConfigError(`weightOverrides.${key}`, value, rule);
  }
}

/** Resolve the eight signal weights from frozen config + overrides (validated, R9). */
export function resolveWeights(
  config: ResolvedConfig,
  overrides: MatchingWeightOverrides = {},
): ResolvedWeights {
  checkMatchingConfig(config); // frozen slice validated first (entry guard)

  const weightRule = "weight overrides must be integers greater than or equal to 0";
  assertOverrideWeight(overrides.localTaskId, "localTaskId", weightRule);
  assertOverrideWeight(overrides.sameProject, "sameProject", weightRule);
  assertOverrideWeight(overrides.sameFramework, "sameFramework", weightRule);
  if (overrides.titleContainedRatio !== undefined) {
    const ratio = overrides.titleContainedRatio;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new MatchingConfigError(
        "weightOverrides.titleContainedRatio",
        ratio,
        "titleContainedRatio must be a finite number in [0, 1]",
      );
    }
  }

  const w = config.scoringWeights;
  return {
    durableUuid: w.durableUuid,
    issueRefExact: w.issueRefExact,
    // "max(1, round(0.5 × issueRefExact)) or override" — contracts/confidence-scoring.md §1.
    localTaskId:
      overrides.localTaskId ?? Math.max(1, roundHalfUp(LOCAL_TASK_ID_RATIO * w.issueRefExact)),
    titleExact: w.titleExact,
    titleContained: roundHalfUp(
      (overrides.titleContainedRatio ?? DEFAULT_TITLE_CONTAINED_RATIO) * w.titleExact,
    ),
    titleTokenOverlap: w.titleTokenOverlap,
    sameProject: overrides.sameProject ?? DEFAULT_CONTAINER_ALIGNMENT_WEIGHT,
    sameFramework: overrides.sameFramework ?? DEFAULT_CONTAINER_ALIGNMENT_WEIGHT,
  };
}

/** Numeric suffix of an issue key (`ENG-42` ⇒ 42); non-matching keys ⇒ null (signal 2). */
function issueKeyNumber(issueKey: string): number | null {
  const match = /-(\d+)$/.exec(issueKey);
  return match === null ? null : Number(match[1]);
}

/** Is `small` a contiguous token subsequence of `large`? */
function isContiguousSubsequence(small: readonly string[], large: readonly string[]): boolean {
  if (small.length === 0 || small.length > large.length) return false;
  outer: for (let start = 0; start + small.length <= large.length; start += 1) {
    for (let k = 0; k < small.length; k += 1) {
      if (small[k] !== large[start + k]) continue outer;
    }
    return true;
  }
  return false;
}

function award(
  contributions: SignalContribution[],
  signal: string,
  points: number,
  weight: number,
): void {
  if (points > 0) contributions.push({ signal, points, weight });
}

/**
 * Score one task↔candidate pair — the eight-signal unbounded weighted integer sum.
 * Pure: the returned pair is pre-gate (`usable: false`, no exclusion); `applyGate`
 * finalizes selectability. Durable identity = `task.stableUuid ===
 * candidate.durableTaskUuid` (constitution II anchor).
 */
export function scorePair(
  input: TaskMatchInput,
  candidate: MatchCandidate,
  weights: ResolvedWeights,
): PairScore {
  const task = input.task;
  const contributions: SignalContribution[] = [];

  const durableIdentity =
    candidate.durableTaskUuid !== undefined && candidate.durableTaskUuid === task.stableUuid;
  if (durableIdentity) award(contributions, "durable-uuid", weights.durableUuid, weights.durableUuid);

  const keyNumber = issueKeyNumber(candidate.issueKey);
  if (task.issueRef !== undefined && keyNumber !== null && task.issueRef.number === keyNumber) {
    award(contributions, "issue-ref-exact", weights.issueRefExact, weights.issueRefExact);
  }

  if (
    task.localTaskId !== undefined &&
    candidate.localTaskId !== undefined &&
    task.localTaskId === candidate.localTaskId // byte-equal (R1 signal 3)
  ) {
    award(contributions, "local-task-id", weights.localTaskId, weights.localTaskId);
  }

  // Title credit — strictest satisfied form only (R1): exact ⊕ contained ⊕ fuzzy.
  const featureOpts = task.featureName !== undefined ? { featureName: task.featureName } : {};
  const taskNorm = normalizeTitle(task.title, featureOpts);
  const candNorm = normalizeTitle(candidate.title, featureOpts);
  if (taskNorm.length > 0 && taskNorm === candNorm) {
    award(contributions, "title-exact", weights.titleExact, weights.titleExact);
  } else {
    const taskTokens = tokenize(taskNorm);
    const candTokens = tokenize(candNorm);
    if (taskTokens.length > 0 && candTokens.length > 0) {
      const contained =
        isContiguousSubsequence(taskTokens, candTokens) ||
        isContiguousSubsequence(candTokens, taskTokens);
      if (contained) {
        award(contributions, "title-contained", weights.titleContained, weights.titleContained);
      } else {
        const ratio = overlapRatio(taskNorm, candNorm);
        award(
          contributions,
          "title-fuzzy",
          roundHalfUp(weights.titleTokenOverlap * ratio),
          weights.titleTokenOverlap,
        );
      }
    }
  }

  // Same-project alignment — known task side only (research R1 signal 7; R6 skip-when-unknown).
  const routed = input.routing;
  const routedProject = routed !== undefined && routed.unassigned !== true ? routed.project : undefined;
  if (routedProject !== undefined && routedProject === candidate.projectRef) {
    award(contributions, "same-project", weights.sameProject, weights.sameProject);
  }

  // Same-framework alignment — "when both sides carry a known Framework_Id" (R5 c5).
  if (candidate.frameworkId !== undefined && candidate.frameworkId === task.frameworkId) {
    award(contributions, "same-framework", weights.sameFramework, weights.sameFramework);
  }

  const total = contributions.reduce((sum, c) => sum + c.points, 0);
  return {
    taskUuid: task.stableUuid,
    issueId: candidate.issueId,
    total,
    contributions,
    durableIdentity,
    usable: false, // finalized by applyGate (FR-002/FR-003)
  };
}
