/**
 * Conflict action resolution — pure resolver + FR-004 built-in default maps (research R6;
 * data-model §4; contracts/conflict-resolution-matrix.md; task T021 implements;
 * unit tests T014; 36-cell SC-004 matrix). Maps come from `ResolvedConfig.bootstrapConflictMap` /
 * `syncConflictMap` through the frozen deep-merge chain; the built-ins below land exactly
 * on FR-004 (contract §1 table). Effects apply to the whole tool-managed issue
 * description only — never to the synced state payload (FR-003). `fail` maps to effect
 * `abort-run`: `EngineFailError` thrown before the next mutation (data-model §4).
 *
 * T021 modeling constraints (T014 test header, binding):
 *  1. `ResolvedConflictAction.action` is always the action READ FROM THE MAP — a degraded
 *     `prefer-newer` still reports `action: "prefer-newer"`; the degradation surfaces only
 *     as `effect: "none"` + `degraded: true` + a reason naming the `report-only` fallback.
 *  2. Every reason is sanitized machine-readable text containing the conflict-type and
 *     action names verbatim (FR-005: conflict type + action taken + reason).
 *  3. `skip` reasons mark the record as internal-only (matrix §2: journal/plan reasons,
 *     NOT a report conflict entry) — they carry the word "internal*".
 *  4. Mode is map-selection context only: identical map entries + type + context ⇒
 *     identical results under `bootstrap` and `sync` (never echoed into the result).
 *  5. `prefer-newer` with missing/partial recency context degrades — indeterminable is
 *     never guessed (R6); recency context is INERT for every non-`prefer-newer` action.
 *  6. Recency compares ISO-8601 timestamps as strings with a STRICT advancement gate:
 *     `issueUpdatedAt > checkpointIssueUpdatedAt` advances; equal (`==`) never does.
 */
import type {
  ConflictAction,
  ConflictResolutionMap,
  DescriptionConflictType,
} from "../domain/checkpoint.js";
import type { SyncMode } from "./mode.js";

/**
 * Concrete consequence of a resolved action (data-model §4: the §5 op-kind mutation, or
 * `none` for `report-only`/`skip`, or `abort-run` for `fail`).
 */
export type ActionEffect =
  /** Push the screened, rendered task section to the issue (`update-issue`). */
  | "update-issue"
  /** Replace the task's section with the marker block (`render-file`; R4). */
  | "render-file"
  /** No mutation on either side (`report-only` / `skip`). */
  | "none"
  /** `fail` — abort before the next mutation (status `aborted`; steps stay rollback-able). */
  | "abort-run";

/** Recency context for `prefer-newer` (conflict-resolution-matrix.md §3; research R6). */
export interface ConflictResolutionContext {
  /** ISO-8601 `IssueView.updatedAt` of the matched issue (when one exists). */
  readonly issueUpdatedAt?: string;
  /** ISO-8601 `Checkpoint.issueUpdatedAt` baseline (when a checkpoint exists). */
  readonly checkpointIssueUpdatedAt?: string;
}

/** Pure resolution result — mapped into {@link AppliedAction} per task. */
export interface ResolvedConflictAction {
  /** Action read from the mode's (merged) `ConflictResolutionMap`. */
  readonly action: ConflictAction;
  /** Concrete effect the action lands as (FR-003 six effects; data-model §4). */
  readonly effect: ActionEffect;
  /** true for `prefer-newer → report-only` degradations (recency indeterminable; FR-003, US1 AC6). */
  readonly degraded: boolean;
  /** Sanitized machine-readable reason: conflict type + action taken (FR-005). */
  readonly reason: string;
}

/** One applied/resolved action per task (data-model §4 record). */
export interface AppliedAction {
  readonly taskUuid: string;
  /** The classified conflict (`null` ⇒ non-conflict action path, e.g. completion). */
  readonly conflictType: DescriptionConflictType | null;
  readonly action: ConflictAction;
  readonly effect: ActionEffect;
  readonly degraded: boolean;
  readonly reason: string;
}

/**
 * FR-004 built-in bootstrap defaults (contracts/conflict-resolution-matrix.md §1):
 * ALL THREE conflict types ⇒ `overwrite-linear`. Bootstrap only ever observes
 * `both-changed` or no conflict (FR-002); the full row exists for override completeness.
 * Values are contract-pinned; each entry is independently overridable via the frozen
 * merge chain (built-in ⇒ config file ⇒ programmatic).
 */
export const bootstrapConflictDefaults: ConflictResolutionMap = Object.freeze({
  "linear-changed": "overwrite-linear",
  "spec-changed": "overwrite-linear",
  "both-changed": "overwrite-linear",
} satisfies ConflictResolutionMap);

/**
 * FR-004 built-in sync defaults (contracts/conflict-resolution-matrix.md §1):
 * `spec-changed` ⇒ `overwrite-linear`, `linear-changed` ⇒ `overwrite-spec`,
 * `both-changed` ⇒ `report-only`. Each entry independently overridable via the frozen
 * merge chain.
 */
export const syncConflictDefaults: ConflictResolutionMap = Object.freeze({
  "linear-changed": "overwrite-spec",
  "spec-changed": "overwrite-linear",
  "both-changed": "report-only",
} satisfies ConflictResolutionMap);

/**
 * The pure resolver `(mode, conflictType, map, context) → { action, effect, degraded,
 * reason }` (research R6; matrix §2–§3). Effect mapping (matrix §2): `overwrite-linear`
 * ⇒ `update-issue`; `overwrite-spec` ⇒ `render-file`; `report-only`/`skip` ⇒ `none`
 * (skip is internal-record only); `fail` ⇒ `abort-run`. Recency (§3): `spec-changed` ⇒
 * overwrite-linear effect; `linear-changed` with `issueUpdatedAt > checkpointIssueUpdatedAt`
 * ⇒ overwrite-spec effect; `linear-changed` with non-advancing `updatedAt` ⇒ degrade
 * `report-only` (`degraded: true`); `both-changed` ⇒ always degrade. Implemented (T021).
 */
export function resolveConflictAction(
  mode: SyncMode,
  conflictType: DescriptionConflictType,
  map: ConflictResolutionMap,
  context?: ConflictResolutionContext,
): ResolvedConflictAction {
  // Matrix §6: the action is selected from the classification + the mode's (merged) map,
  // never from anything else. The map is complete by contract (frozen deep-merge chain);
  // the mode's built-in row is only an absent-key safety net, never an override.
  const action: ConflictAction =
    map[conflictType] ??
    (mode === "bootstrap" ? bootstrapConflictDefaults : syncConflictDefaults)[conflictType];

  // Matrix §2: fixed consequences for the five non-`prefer-newer` actions. Recency
  // context is inert here (modeling choice 5): stale never degrades an overwrite;
  // advancing never upgrades `report-only`/`skip`/`fail`.
  switch (action) {
    case "overwrite-linear":
      return {
        action,
        effect: "update-issue",
        degraded: false,
        reason:
          `${conflictType}: action overwrite-linear - push screened rendered task ` +
          `section to the issue (update-issue); spec file untouched`,
      };
    case "overwrite-spec":
      return {
        action,
        effect: "render-file",
        degraded: false,
        reason:
          `${conflictType}: action overwrite-spec - replace task section with the ` +
          `git-style conflict-marker block embedding local then tracker content ` +
          `(render-file); issue untouched, nothing pushed`,
      };
    case "report-only":
      return {
        action,
        effect: "none",
        degraded: false,
        reason:
          `${conflictType}: action report-only - conflict surfaced in plan/report, ` +
          `no changes on either side (effect none)`,
      };
    case "skip":
      return {
        action,
        effect: "none",
        degraded: false,
        reason:
          `${conflictType}: action skip - recorded internally only as a journal/plan ` +
          `reason, NOT a report conflict entry (effect none)`,
      };
    case "fail":
      return {
        action,
        effect: "abort-run",
        degraded: false,
        reason:
          `${conflictType}: action fail - abort the run before the next mutation ` +
          `(abort-run); already-applied steps remain rollback-able`,
      };
    case "prefer-newer":
      return resolvePreferNewer(conflictType, context);
  }
}

/**
 * Matrix §3 recency rule for `prefer-newer` (research R6 "never guessed"; US1 AC6).
 * The configured action stays map-read even on degradation (modeling choice 1); the
 * `report-only` fallback surfaces only via `effect: "none"` + `degraded: true` + a
 * reason naming it. Timestamps are ISO-8601 strings compared lexicographically with a
 * strict advancement gate — equal instants are non-advancing (matrix §3 `≤` row).
 */
function resolvePreferNewer(
  conflictType: DescriptionConflictType,
  context: ConflictResolutionContext | undefined,
): ResolvedConflictAction {
  if (conflictType === "spec-changed") {
    // §3 row 1: single-sided by construction — only the spec moved since the
    // checkpoint baseline. Self-attesting: recency context is neither needed nor able
    // to change the verdict (a stale tracker clock never flips it).
    return {
      action: "prefer-newer",
      effect: "update-issue", // winner = spec ⇒ §2 overwrite-linear effect
      degraded: false,
      reason:
        `spec-changed: action prefer-newer resolved to overwrite-linear - spec side is ` +
        `single-sided newer than the checkpoint baseline (update-issue)`,
    };
  }
  if (conflictType === "both-changed") {
    // §3 row 4: no trustworthy spec-side timestamp source exists — always degrade,
    // regardless of any recency context supplied.
    return {
      action: "prefer-newer",
      effect: "none", // fallback actually taken: report-only
      degraded: true,
      reason:
        `both-changed: action prefer-newer configured - no trustworthy spec-side ` +
        `recency source; degraded to report-only (effect none)`,
    };
  }
  // linear-changed — §3 rows 2–3: tracker-newer requires BOTH timestamps present and
  // strictly advancing past the checkpoint baseline; missing/partial or non-advancing
  // context is indeterminable and must degrade (R6).
  const issueUpdatedAt = context?.issueUpdatedAt;
  const checkpointIssueUpdatedAt = context?.checkpointIssueUpdatedAt;
  const trackerNewer =
    issueUpdatedAt !== undefined &&
    checkpointIssueUpdatedAt !== undefined &&
    issueUpdatedAt > checkpointIssueUpdatedAt;
  if (trackerNewer) {
    return {
      action: "prefer-newer",
      effect: "render-file", // winner = tracker ⇒ §2 overwrite-spec effect
      degraded: false,
      reason:
        `linear-changed: action prefer-newer resolved to overwrite-spec - issue ` +
        `updatedAt is strictly after the checkpoint baseline (render-file)`,
    };
  }
  return {
    action: "prefer-newer",
    effect: "none", // fallback actually taken: report-only
    degraded: true,
    reason:
      `linear-changed: action prefer-newer configured - recency indeterminable ` +
      `(issue.updatedAt missing or not strictly after the checkpoint baseline); ` +
      `degraded to report-only (effect none)`,
  };
}

/**
 * Bind a pure resolution to its task: `{ taskUuid, ...resolved }` (data-model §4
 * `AppliedAction`). Every applied action records `{ conflictType, action, reason }` in
 * plan entry reasons, `OperationOutcome.detail`, and reports (FR-005). The conflict type
 * is `null` on the non-conflict path (e.g. checkbox-driven completion, matrix §5
 * independence) and the resolution fields pass through verbatim. Implemented (T021).
 */
export function appliedAction(
  taskUuid: string,
  conflictType: DescriptionConflictType | null,
  resolved: ResolvedConflictAction,
): AppliedAction {
  return {
    taskUuid,
    conflictType,
    action: resolved.action,
    effect: resolved.effect,
    degraded: resolved.degraded,
    reason: resolved.reason,
  };
}
