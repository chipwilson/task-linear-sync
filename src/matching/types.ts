/**
 * T009 — 006-local records composing the frozen 002 shapes (data-model.md §1–§5).
 * Frozen types (`Task`, `RoutingResolution`, `Match`, `MatchAlternative`, `Confidence`,
 * `IssueView`, `AttachmentView`, `ResolvedConfig`) are imported and NEVER restated
 * (002 FR-008 freeze rule). 005's routing output enters as the frozen
 * `RoutingResolution` *value* — never as a module import of the sibling 005 tree
 * (research R6).
 */
import type { ResolvedConfig } from "task-linear-sync/config";
import type {
  Confidence,
  FrameworkId,
  Match,
  MatchAlternative,
  RoutingResolution,
  Task,
} from "task-linear-sync/domain";
import type { AttachmentView, IssueView } from "task-linear-sync/ports";

/** Frozen match types re-exported for consumer convenience — WITHOUT redefining them. */
export type { Confidence, Match, MatchAlternative };

/** data-model §1 — one task plus the gating data 005 produces, passed as data. */
export interface TaskMatchInput {
  readonly task: Task;
  /** Routed team/project for FR-003 gating; `undefined` or `unassigned: true` ⇒ the
   * team/project gates are skipped for this task (research R6). */
  readonly routing?: RoutingResolution;
}

/**
 * data-model §2 — deterministic projection of an already-fetched candidate issue.
 * `filePath` is "Context/reasons only; not an independent signal".
 * `localTaskId` carries the page-0 payload's `frameworkMetadata.localTaskId` so the
 * FR-001 signal "local task ID match — both carry a `localTaskId` and they are
 * byte-equal" can be evaluated on the candidate side (the frozen `FrameworkMetadata`
 * shape owns that field; data-model §2's field list names the page-0-payload sources).
 */
export interface MatchCandidate {
  /** Canonical ordering key (ascending). */
  readonly issueId: string;
  /** Numeric suffix `-(\d+)$` feeds signal 2; absent suffix ⇒ that signal scores 0. */
  readonly issueKey: string;
  readonly teamKey: string;
  /** `IssueView.projectId`, compared as-is to the routed project. */
  readonly projectRef: string;
  readonly title: string;
  /** Present ⇒ durable identity (constitution II): bypasses gating + margin downgrade. */
  readonly durableTaskUuid?: string;
  readonly frameworkId?: FrameworkId;
  readonly featureName?: string;
  readonly filePath?: string;
  readonly localTaskId?: string;
}

/** data-model §3 — one awarded signal of a scored pair. */
export interface SignalContribution {
  /** One of the eight reason labels in contracts/confidence-scoring.md §1. */
  readonly signal: string;
  /** Points awarded (integer ≥ 0; fuzzy = `round(titleTokenOverlap × overlapRatio)`). */
  readonly points: number;
  /** The resolved weight (frozen, derived, or overridden) for the signal. */
  readonly weight: number;
}

/** data-model §3 — machine-readable non-usability reason (diagnostics, never selection input). */
export type PairExclusion = "below-plausible" | "gated-team" | "gated-project" | "gated-framework";

/** data-model §3 — scoring intermediate for one task↔candidate pair. */
export interface PairScore {
  readonly taskUuid: string;
  readonly issueId: string;
  /** "Unbounded weighted integer sum" (FR-001), integer ≥ 0. */
  readonly total: number;
  /** Ordered by the signal-table order (deterministic). */
  readonly contributions: readonly SignalContribution[];
  /** `task.stableUuid === candidate.durableTaskUuid`. */
  readonly durableIdentity: boolean;
  /** `total ≥ confidenceFloors.plausible` ∧ passes FR-003 gating (durable bypasses gating). */
  readonly usable: boolean;
  readonly exclusion?: PairExclusion;
}

/** data-model §4 — task with no assigned real pair; band fixed `"unmatched"`. */
export interface UnresolvedTask {
  readonly taskUuid: string;
  readonly band: "unmatched";
  /** Best *usable* pair total (absent when none usable); diagnostic only. */
  readonly bestScore?: number;
}

/** data-model §4 — full output record of `matchAllTasks`. */
export interface MatchingResult {
  readonly matches: readonly Match[];
  readonly unresolved: readonly UnresolvedTask[];
  /** Candidate issueIds not selected for any task (013 drift/unmapped input), sorted. */
  readonly unmappedIssues: readonly string[];
}

/**
 * data-model §5 — programmatic layer for weights the frozen `ScoringWeights` does not
 * cover (plan.md Complexity Tracking). Frozen keys are NOT overridable here — they flow
 * through the frozen config layering (defaults → file → programmatic, 002).
 */
export interface MatchingWeightOverrides {
  readonly localTaskId?: number;
  readonly titleContainedRatio?: number;
  readonly sameProject?: number;
  readonly sameFramework?: number;
}

/** contracts/matching-api.md — input of `projectCandidates` (already-fetched views). */
export interface ProjectCandidatesInput {
  readonly issues: readonly IssueView[];
  readonly attachmentsByIssue: Readonly<Record<string /* issueId */, readonly AttachmentView[]>>;
  /** Uses attachmentUrlTemplate/continuationUrlTemplate + metadataNamespaceKey. */
  readonly config: ResolvedConfig;
}
