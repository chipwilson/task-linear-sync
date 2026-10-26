/**
 * Conflict action resolution — pure resolver + FR-004 built-in default maps (research R6;
 * data-model §4; contracts/conflict-resolution-matrix.md; task T021 implements;
 * unit tests T014; 36-cell SC-004 matrix). Maps come from `ResolvedConfig.bootstrapConflictMap` /
 * `syncConflictMap` through the frozen deep-merge chain; the built-ins below land exactly
 * on FR-004 (contract §1 table). Effects apply to the whole tool-managed issue
 * description only — never to the synced state payload (FR-003). `fail` maps to effect
 * `abort-run`: `EngineFailError` thrown before the next mutation (data-model §4).
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
 * `report-only` (`degraded: true`); `both-changed` ⇒ always degrade. T021 implements (T014).
 */
export function resolveConflictAction(
  mode: SyncMode,
  conflictType: DescriptionConflictType,
  map: ConflictResolutionMap,
  context?: ConflictResolutionContext,
): ResolvedConflictAction {
  void [mode, conflictType, map, context]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: actions");
}

/**
 * Bind a pure resolution to its task: `{ taskUuid, ...resolved }` (data-model §4
 * `AppliedAction`). Every applied action records `{ conflictType, action, reason }` in
 * plan entry reasons, `OperationOutcome.detail`, and reports (FR-005). T021 implements.
 */
export function appliedAction(
  taskUuid: string,
  conflictType: DescriptionConflictType | null,
  resolved: ResolvedConflictAction,
): AppliedAction {
  void [taskUuid, conflictType, resolved]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: actions");
}
