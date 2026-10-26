/**
 * Op taxonomy, deterministic ids, and FR-011 emission order (research R10/R14;
 * data-model §5; contracts/journal-rollback.md §1; task T040 implements; unit tests T028).
 * `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` and `runId = sha256(planId ‖
 * clock.now().iso ‖ seq)` — deterministic under the injected clock (R14; NUL-joined
 * segments; no `crypto.randomUUID` anywhere — Principle IV). Emission order (FR-011):
 * parents created before children (dependency-sorted on `parentUuid`, stable across
 * files), siblings within one parent in REVERSE of their working order (001 R12
 * compensation). Every produced op lands in the frozen `AuditManifest.operations` AND a
 * `JournalStep` (journal.ts) carrying the kind-specific before/after guard material below.
 */
import type { SyncHistoryEventKind } from "../domain/state-payload.js";
import type { Task } from "../domain/task.js";
import type { Clock } from "../state/clock.js";
import type {
  AttachmentMetadata,
  IssueUpdatePatch,
  IssueView,
} from "../ports/linear-port.js";

/** Mutation vocabulary (data-model §5 kind table). */
export type EngineOpKind =
  | "create-issue"
  | "update-issue"
  | "upsert-attachment"
  | "render-file"
  | "write-checkpoint";

/** Kind-specific rollback-restore material (data-model §5 `beforeSnapshot`). */
export type OpBeforeSnapshot =
  /** No pre-state — the issue does not exist yet. */
  | { readonly kind: "create-issue" }
  /** Prior values of exactly the patched fields (title/description/stateTypeId patch). */
  | { readonly kind: "update-issue"; readonly fields: IssueUpdatePatch }
  /** Prior attachment metadata; `null` ⇒ no prior attachment existed (FR-016 no-op undo). */
  | { readonly kind: "upsert-attachment"; readonly priorMetadata: AttachmentMetadata | null }
  /** Content hash of the file before the render write (full content rides `fileBackups`). */
  | { readonly kind: "render-file"; readonly beforeContentHash: string }
  /** Frozen `checkpointBefore` snapshot is the material — no per-op pre-state. */
  | { readonly kind: "write-checkpoint" };

/** Kind-specific result-state guard material (data-model §5 `afterSnapshot`, FR-014). */
export type OpAfterSnapshot =
  /** Created `IssueView` snapshot; else the reconcile outcome via `findIssuesByAttachmentUrl`. */
  | { readonly kind: "create-issue"; readonly issue: IssueView }
  /** The patched field values as they landed. */
  | { readonly kind: "update-issue"; readonly fields: IssueUpdatePatch }
  /** Resulting attachment metadata. */
  | { readonly kind: "upsert-attachment"; readonly metadata: AttachmentMetadata }
  /** Rendered content hash. */
  | { readonly kind: "render-file"; readonly afterContentHash: string }
  /** Written checkpoint-store content hash. */
  | { readonly kind: "write-checkpoint"; readonly storeHash: string };

/** One planned mutation, pre-materialized into the journal (complete-before-first-mutation). */
export interface PlannedOp {
  /** `deriveOpId` output — matches the frozen `AuditOperation.opId`. */
  readonly opId: string;
  /** Ordinal fed into `deriveOpId`; unique per (planId, taskUuid, kind). */
  readonly ordinal: number;
  readonly kind: EngineOpKind;
  readonly taskUuid: string;
  /** Target issue; unknown until a create lands — carried on the JournalStep instead. */
  readonly targetIssueId?: string;
  /** Deterministic attachment URL touched (canonical or continuation) — attachment ops. */
  readonly attachmentUrl?: string;
}

/**
 * Deterministic `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` (research R14;
 * journal-rollback.md §1). Byte-reproducible under golden-file tests (Principle IV).
 * T040 implements (T028).
 */
export function deriveOpId(
  planId: string,
  taskUuid: string,
  kind: EngineOpKind,
  ordinal: number,
): string {
  void [planId, taskUuid, kind, ordinal]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: ops");
}

/**
 * Deterministic `runId = sha256(planId ‖ clock.now().iso ‖ seq)` (research R14):
 * `clock.now().toISOString()` from the injected clock; `seq` distinguishes multiple runs
 * in the same instant. T040 implements (T028).
 */
export function deriveRunId(planId: string, clock: Clock, seq: number): string {
  void [planId, clock, seq]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: ops");
}

/**
 * FR-011 emission order over a plan's task set: plan/working order (filePath asc,
 * lineNumber asc) filtered so every parent precedes every child (dependency-sorted on
 * `parentUuid`, stable across files), and siblings of one parent EMITTED in reverse of
 * their working order (001 R12 compensation — the tracker's newest-first rendering then
 * lands tasks in working order). Deterministic by construction. T040 implements (T028).
 */
export function emissionOrder(tasks: readonly Task[]): readonly Task[] {
  void [tasks]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: ops");
}

/**
 * History event kind per patched issue field (data-model §5: `update-issue` rides
 * `title-updated` / `description-updated` / `checkbox-changed` per field — a
 * `stateTypeId` patch is the checkbox/completion op, FR-006). T040 implements.
 */
export function historyKindForUpdatedField(field: keyof IssueUpdatePatch): SyncHistoryEventKind {
  void [field]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: ops");
}
