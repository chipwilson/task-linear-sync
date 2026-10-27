/**
 * Op taxonomy, deterministic ids, and FR-011 emission order (research R10/R14;
 * data-model §5; contracts/journal-rollback.md §1; task T040 implements; unit tests T028).
 * T024 (US1, build lane) pre-delivers the two deterministic id derivations
 * ({@link deriveOpId}, {@link deriveRunId} — the R14 NUL-join convention) because
 * `buildSyncPlan` stage 7 needs `deriveRunId` for the plan-report artifacts;
 * `emissionOrder` and `historyKindForUpdatedField` remain T040 stubs.
 * `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` and `runId = sha256(planId ‖
 * clock.now().iso ‖ seq)` — deterministic under the injected clock (R14; NUL-joined
 * segments; no `crypto.randomUUID` anywhere — Principle IV). Emission order (FR-011):
 * parents created before children (dependency-sorted on `parentUuid`, stable across
 * files), siblings within one parent in REVERSE of their working order (001 R12
 * compensation). Every produced op lands in the frozen `AuditManifest.operations` AND a
 * `JournalStep` (journal.ts) carrying the kind-specific before/after guard material below.
 */
import { createHash } from "node:crypto";

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
 * NUL-join of segments fed to a `sha256` digest (research R14 determinism plumbing). A
 * `NUL` never appears inside a planId (hex), taskUuid (hex+hyphens), op kind (hyphenated
 * literal) or ISO timestamp, so the separator can never make two distinct inputs collide
 * (Principle IV: content-derived, clock-derived ids are byte-reproducible).
 */
function sha256Joined(segments: readonly string[]): string {
  return createHash("sha256").update(segments.join("\u0000"), "utf8").digest("hex");
}

/**
 * Deterministic `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` (research R14;
 * journal-rollback.md §1). Byte-reproducible under golden-file tests (Principle IV).
 * Implemented by the build lane (T024) so `deriveRunId` shares one NUL-join helper;
 * ordinal is rendered as its base-36 `String`.
 */
export function deriveOpId(
  planId: string,
  taskUuid: string,
  kind: EngineOpKind,
  ordinal: number,
): string {
  return sha256Joined([planId, taskUuid, kind, String(ordinal)]);
}

/**
 * Deterministic `runId = sha256(planId ‖ clock.now().iso ‖ seq)` (research R14):
 * `clock.now().toISOString()` from the injected clock; `seq` distinguishes multiple runs
 * in the same instant (plan report is `seq 0`, apply `seq 1`, rollback `seq 2`).
 * Implemented by the build lane (T024) — `report.ts`'s `derivePlanReportRunId` delegates
 * here with `seq 0`.
 */
export function deriveRunId(planId: string, clock: Clock, seq: number): string {
  return sha256Joined([planId, clock.now().toISOString(), String(seq)]);
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
