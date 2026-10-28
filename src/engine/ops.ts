/**
 * Op taxonomy, deterministic ids, and FR-011 emission order (research R10/R14;
 * data-model §5; contracts/journal-rollback.md §1; task T040 implements; unit tests T028).
 * T024 (US1, build lane) pre-delivered the two deterministic id derivations
 * ({@link deriveOpId}, {@link deriveRunId} — the R14 NUL-join convention) because
 * `buildSyncPlan` stage 7 needs `deriveRunId` for the plan-report artifacts.
 * `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` and `runId = sha256(planId ‖
 * clock.now().iso ‖ seq)` — deterministic under the injected clock (R14; NUL-joined
 * segments; no `crypto.randomUUID` anywhere — Principle IV). Emission order (FR-011):
 * parents created before children (dependency-sorted on `parentUuid`, stable across
 * files), siblings within one parent in REVERSE of their working order (001 R12
 * compensation). Every produced op lands in the frozen `AuditManifest.operations` AND a
 * `JournalStep` (journal.ts) carrying the kind-specific before/after guard material below.
 *
 * T040 surface (consumers: apply T043, journal T041, rollback T044):
 * - Per-kind op builders ({@link planCreateIssueOp}, {@link planUpdateIssueOp},
 *   {@link planUpsertAttachmentOp}, {@link planRenderFileOp}, {@link planWriteCheckpointOp})
 *   produce identity-free {@link PlannedOpDraft}s carrying the §5 snapshot material;
 *   {@link assignOpOrdinals} assigns ordinals (unique per (planId, taskUuid, kind)) and
 *   stamps deterministic `opId`s, yielding the final {@link PlannedOp}s that
 *   `materializeJournal` writes complete-before-first-mutation (journal-rollback.md §1).
 * - {@link inverseForOp} maps an op to its §5 rollback inverse descriptor so rollback
 *   never re-derives restore material from snapshots.
 * - {@link emissionOrder} is the FR-011 create order; `historyKindForUpdatedField` maps
 *   patched fields to the frozen history-event vocabulary (history-log.md §2).
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
  | {
      readonly kind: "create-issue";
      readonly issue: IssueView;
      /** true ⇒ adopted via error-reconciliation (R10 `reconciled`), not a fresh `createIssue` return. */
      readonly reconciled?: boolean;
    }
  /** The patched field values as they landed. */
  | { readonly kind: "update-issue"; readonly fields: IssueUpdatePatch }
  /** Resulting attachment metadata. */
  | { readonly kind: "upsert-attachment"; readonly metadata: AttachmentMetadata }
  /** Rendered content hash. */
  | { readonly kind: "render-file"; readonly afterContentHash: string }
  /** Written checkpoint-store content hash. */
  | { readonly kind: "write-checkpoint"; readonly storeHash: string };

/**
 * Run-level anchor `taskUuid` for the `write-checkpoint` op (data-model §5: the checkpoint
 * store update is one final per-RUN step, not per-task). The empty string is never a valid
 * task UUID, so the R14 NUL-join stays collision-free against real task ops while keeping
 * the op's `opId` derivation uniform.
 */
export const RUN_LEVEL_TASK_UUID = "";

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
  /** Mutated file — `render-file` ops (JournalStep.filePath; keys the frozen `fileBackups` entry). */
  readonly filePath?: string;
  /** Create ops only; FK → frozen `CreateIntent` (JournalStep.intentId). */
  readonly intentId?: string;
  /**
   * Pre-read rollback restore material (§5). `kind` always equals {@link PlannedOp.kind}
   * (builders guarantee it; {@link inverseForOp} defensively re-checks).
   */
  readonly beforeSnapshot: OpBeforeSnapshot;
  /**
   * Planned result-state guard material (§5, FR-014). Present whenever computable BEFORE
   * the mutation (update/upsert/render/write-checkpoint). `create-issue` ops learn the
   * created {@link IssueView} only at landing — apply records that via
   * {@link createIssueAfterSnapshot} in the journal step transition.
   */
  readonly afterSnapshot?: OpAfterSnapshot;
}

/**
 * A {@link PlannedOp} before identity assignment — the output of the per-kind builders.
 * {@link assignOpOrdinals} adds `ordinal` + `opId` in a plan's final op sequence.
 */
export type PlannedOpDraft = Omit<PlannedOp, "opId" | "ordinal">;

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

// ── Per-kind op builders (data-model §5 snapshot material; apply T043 consumer) ──────

/** Input for {@link planCreateIssueOp} — no pre-state exists (§5 before is empty). */
export interface PlanCreateIssueInput {
  readonly taskUuid: string;
  /** FK → frozen `CreateIntent` written durably before the attempt (R10). */
  readonly intentId?: string;
  /** Known only when the create lands (or reconciliation adopts; R10). */
  readonly targetIssueId?: string;
  /** Canonical identity URL the create carries (FR-004 durable identity). */
  readonly attachmentUrl?: string;
}

/** Bootstrap create op: empty beforeSnapshot; afterSnapshot rides the landing transition. */
export function planCreateIssueOp(input: PlanCreateIssueInput): PlannedOpDraft {
  const draft: PlannedOpDraft = {
    kind: "create-issue",
    taskUuid: input.taskUuid,
    beforeSnapshot: { kind: "create-issue" },
    ...(input.intentId !== undefined ? { intentId: input.intentId } : {}),
    ...(input.targetIssueId !== undefined ? { targetIssueId: input.targetIssueId } : {}),
    ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl } : {}),
  };
  return draft;
}

/** Input for {@link planUpdateIssueOp} — prior + patched values of exactly the patched fields. */
export interface PlanUpdateIssueInput {
  readonly taskUuid: string;
  readonly targetIssueId: string;
  /** Pre-mutation re-fetch of exactly the fields {@link patchedFields} patches (§5). */
  readonly priorFields: IssueUpdatePatch;
  /** The screened patch as it will land (§5 after: "the patched field values"). */
  readonly patchedFields: IssueUpdatePatch;
}

/** Field-update op carrying prior→patched field material for both snapshots. */
export function planUpdateIssueOp(input: PlanUpdateIssueInput): PlannedOpDraft {
  return {
    kind: "update-issue",
    taskUuid: input.taskUuid,
    targetIssueId: input.targetIssueId,
    beforeSnapshot: { kind: "update-issue", fields: input.priorFields },
    afterSnapshot: { kind: "update-issue", fields: input.patchedFields },
  };
}

/** Input for {@link planUpsertAttachmentOp} — prior metadata (null ⇒ none existed). */
export interface PlanUpsertAttachmentInput {
  readonly taskUuid: string;
  readonly targetIssueId: string;
  /** Deterministic attachment URL upserted (canonical or continuation page). */
  readonly attachmentUrl: string;
  /** Pre-read via `getAttachmentByUrl`; `null` ⇒ none existed (FR-016 no-op undo). */
  readonly priorMetadata: AttachmentMetadata | null;
  /** Resulting metadata when computable pre-mutation (§5 after); else rides the landing. */
  readonly resultingMetadata?: AttachmentMetadata;
}

/** Attachment upsert op; prior metadata is BOTH rollback material and frozen-manifest FR-015 field. */
export function planUpsertAttachmentOp(input: PlanUpsertAttachmentInput): PlannedOpDraft {
  return {
    kind: "upsert-attachment",
    taskUuid: input.taskUuid,
    targetIssueId: input.targetIssueId,
    attachmentUrl: input.attachmentUrl,
    beforeSnapshot: { kind: "upsert-attachment", priorMetadata: input.priorMetadata },
    ...(input.resultingMetadata !== undefined
      ? {
          afterSnapshot: {
            kind: "upsert-attachment" as const,
            metadata: input.resultingMetadata,
          },
        }
      : {}),
  };
}

/**
 * Input for {@link planRenderFileOp}. Both content hashes are computable BEFORE the write
 * (render is deterministic); full before content rides the frozen `AuditManifest.fileBackups`
 * entry whose `path` equals {@link filePath} — that entry is the restore material (R11).
 */
export interface PlanRenderFileInput {
  readonly taskUuid: string;
  /** Repo-relative POSIX path of the rendered TaskFile. */
  readonly filePath: string;
  /** sha256 hex of the current file content (pre-write). */
  readonly beforeContentHash: string;
  /** sha256 hex of the rendered content about to be written. */
  readonly afterContentHash: string;
}

/** Local mirror write op (§5: history rides the already-recorded task-level events — none here). */
export function planRenderFileOp(input: PlanRenderFileInput): PlannedOpDraft {
  return {
    kind: "render-file",
    taskUuid: input.taskUuid,
    filePath: input.filePath,
    beforeSnapshot: { kind: "render-file", beforeContentHash: input.beforeContentHash },
    afterSnapshot: { kind: "render-file", afterContentHash: input.afterContentHash },
  };
}

/** Input for {@link planWriteCheckpointOp} — the final per-run checkpoint store write. */
export interface PlanWriteCheckpointInput {
  /** sha256 hex of the checkpoint-store content about to be written (§5 after). */
  readonly storeHash: string;
  /** Defaults to {@link RUN_LEVEL_TASK_UUID} — the store write is run-level, not per-task. */
  readonly taskUuid?: string;
}

/** Checkpoint-store write op; before material is the frozen `checkpointBefore` snapshot. */
export function planWriteCheckpointOp(input: PlanWriteCheckpointInput): PlannedOpDraft {
  return {
    kind: "write-checkpoint",
    taskUuid: input.taskUuid ?? RUN_LEVEL_TASK_UUID,
    beforeSnapshot: { kind: "write-checkpoint" },
    afterSnapshot: { kind: "write-checkpoint", storeHash: input.storeHash },
  };
}

/**
 * Assign ordinals and stamp deterministic `opId`s over a plan's final op sequence
 * (complete-before-first-mutation material, journal-rollback.md §1). Ordinals start at 0
 * per `(planId, taskUuid, kind)` group in INPUT order — the caller's emission order — so
 * the sequence is deterministic and opIds are byte-reproducible (R14). Input order is
 * authoritative; this function never re-sorts.
 */
export function assignOpOrdinals(
  drafts: readonly PlannedOpDraft[],
  planId: string,
): PlannedOp[] {
  const nextOrdinal = new Map<string, number>();
  return drafts.map((draft) => {
    const groupKey = sha256Joined([planId, draft.taskUuid, draft.kind]);
    const ordinal = nextOrdinal.get(groupKey) ?? 0;
    nextOrdinal.set(groupKey, ordinal + 1);
    return {
      ...draft,
      ordinal,
      opId: deriveOpId(planId, draft.taskUuid, draft.kind, ordinal),
    };
  });
}

/**
 * Build the `create-issue` afterSnapshot when a create lands (apply T043 records it via
 * `StepTransition.afterSnapshot`). `reconciled: true` marks an issue ADOPTED through
 * error-reconciliation (`findIssuesByAttachmentUrl` exactly-one match, R10) rather than a
 * fresh `createIssue` return — rollback archives both alike (FR-013).
 */
export function createIssueAfterSnapshot(
  issue: IssueView,
  reconciled?: boolean,
): Extract<OpAfterSnapshot, { kind: "create-issue" }> {
  return {
    kind: "create-issue",
    issue,
    ...(reconciled !== undefined ? { reconciled } : {}),
  };
}

// ── Inverse material (data-model §5 Inverse column; rollback T044 consumer) ──────────

/**
 * Rollback inverse descriptor per op (data-model §5 "Inverse (rollback)" column), so
 * rollback consumes ops without re-deriving restore material. `opId` lets the reverser
 * drive `StepTransition` state updates (R11). Descriptors carry only what the frozen
 * journal/manifest already holds — no secret or content material (full file content is
 * looked up from `AuditManifest.fileBackups` by {@link OpInverse} `filePath`).
 */
export type OpInverse =
  /** Created issues are ARCHIVED, never deleted (FR-013). */
  | { readonly opId: string; readonly action: "archive-issue"; readonly issueId: string }
  /** Restore each patched field to its before value (FR-013). */
  | {
      readonly opId: string;
      readonly action: "restore-fields";
      readonly issueId: string;
      readonly fields: IssueUpdatePatch;
    }
  /** Re-upsert the prior metadata (issue ops re-target by `issueId`/`attachmentUrl`). */
  | {
      readonly opId: string;
      readonly action: "restore-attachment";
      readonly issueId: string;
      readonly attachmentUrl: string;
      readonly metadata: AttachmentMetadata;
    }
  /** No prior attachment existed ⇒ skip; a page-0 created during the run is RETAINED (FR-016). */
  | { readonly opId: string; readonly action: "skip-created-attachment"; readonly attachmentUrl: string }
  /** Restore from `fileBackups.beforeContent`; `beforeContentHash` is the restore guard. */
  | {
      readonly opId: string;
      readonly action: "restore-file";
      readonly filePath: string;
      readonly beforeContentHash: string;
    }
  /** Restore/remove checkpoint entries to match the frozen `checkpointBefore` snapshot. */
  | { readonly opId: string; readonly action: "restore-checkpoints" };

function requireTarget(op: PlannedOp, what: string): string {
  if (op.targetIssueId === undefined) {
    throw new Error(`inverseForOp: ${what} op ${op.opId} has no targetIssueId (learned only at landing)`);
  }
  return op.targetIssueId;
}

/**
 * Map a planned (or landed — pass the journal-step-aligned op) op to its §5 inverse
 * descriptor. `create`/`update`/`upsert` inverses require {@link PlannedOp.targetIssueId}
 * (only known once the op landed) — a missing target throws (programmer error; rollback
 * consumes landed ops, never pre-landing drafts). `beforeSnapshot.kind` must equal
 * `op.kind` (builders guarantee consistency; the re-check guards against hand-built ops).
 */
export function inverseForOp(op: PlannedOp): OpInverse {
  if (op.beforeSnapshot.kind !== op.kind) {
    throw new Error(
      `inverseForOp: op ${op.opId} kind ${op.kind} disagrees with beforeSnapshot.kind ${op.beforeSnapshot.kind}`,
    );
  }
  switch (op.beforeSnapshot.kind) {
    case "create-issue":
      return { opId: op.opId, action: "archive-issue", issueId: requireTarget(op, "create-issue") };
    case "update-issue":
      return {
        opId: op.opId,
        action: "restore-fields",
        issueId: requireTarget(op, "update-issue"),
        fields: op.beforeSnapshot.fields,
      };
    case "upsert-attachment": {
      const url = op.attachmentUrl;
      if (url === undefined) {
        throw new Error(`inverseForOp: upsert-attachment op ${op.opId} has no attachmentUrl`);
      }
      if (op.beforeSnapshot.priorMetadata === null) {
        // FR-016: nothing existed before ⇒ retain the created attachment, undo is a no-op.
        return { opId: op.opId, action: "skip-created-attachment", attachmentUrl: url };
      }
      return {
        opId: op.opId,
        action: "restore-attachment",
        issueId: requireTarget(op, "upsert-attachment"),
        attachmentUrl: url,
        metadata: op.beforeSnapshot.priorMetadata,
      };
    }
    case "render-file": {
      if (op.filePath === undefined) {
        throw new Error(`inverseForOp: render-file op ${op.opId} has no filePath`);
      }
      return {
        opId: op.opId,
        action: "restore-file",
        filePath: op.filePath,
        beforeContentHash: op.beforeSnapshot.beforeContentHash,
      };
    }
    case "write-checkpoint":
      return { opId: op.opId, action: "restore-checkpoints" };
  }
}

// ── FR-011 emission order (research R10; spec FR-011/001 FR-057; unit tests T028) ────

/**
 * Working order — the deterministic plan order (build.ts stage 6): filePath asc
 * (`localeCompare` "en"), then lineNumber asc. Mirrors the frozen assembly comparator so
 * "reverse working order" is measured against the same axis everywhere.
 */
function workingOrder(a: Task, b: Task): number {
  return a.filePath.localeCompare(b.filePath, "en") || a.lineNumber - b.lineNumber;
}

/**
 * Root of the dependency pass: no `parentUuid`, or a parent OUTSIDE the set (already
 * assigned / out of scope — 004 trees nest same-file, so this is the cross-file anchor).
 * Parent-cycle members (impossible in 004 indent-stack trees) are never roots by this
 * rule and are flushed by the defensive tail of {@link emissionOrder}.
 */
function isDependencyRoot(task: Task, byUuid: ReadonlyMap<string, Task>): boolean {
  return task.parentUuid === undefined || !byUuid.has(task.parentUuid);
}

/**
 * FR-011 emission order over a plan's task set: plan/working order (filePath asc,
 * lineNumber asc) filtered so every parent precedes every child (dependency-sorted on
 * `parentUuid`, stable across files), and siblings of one parent EMITTED in reverse of
 * their working order (001 R12 compensation — the tracker's newest-first rendering then
 * lands tasks in working order). Deterministic by construction.
 *
 * Traversal (normative for apply T043 — do NOT re-sort): level-order dependency pass.
 * Roots (undefined `parentUuid`, or a parent outside the set — e.g. already-assigned
 * parents) emit in working order; each frontier level then emits the children of the
 * previous level, grouped by parent in that parent's emission order and REVERSED within
 * each sibling group. Every task precedes every one of its descendants; siblings of one
 * parent are exactly reversed working order. Inputs are never mutated. Degenerate
 * parent cycles (impossible in 004 indent-stack trees) are broken defensively: cycle
 * members emit last, in working order, so the function is total.
 */
export function emissionOrder(tasks: readonly Task[]): readonly Task[] {
  if (tasks.length === 0) return [];
  const ordered = [...tasks].sort(workingOrder);
  const byUuid = new Map(ordered.map((t) => [t.stableUuid, t] as const));
  const childrenByParent = new Map<string, Task[]>();
  for (const t of ordered) {
    if (t.parentUuid !== undefined && byUuid.has(t.parentUuid)) {
      const siblings = childrenByParent.get(t.parentUuid);
      if (siblings === undefined) childrenByParent.set(t.parentUuid, [t]);
      else siblings.push(t); // already in working order
    }
  }
  const emitted: Task[] = [];
  const seen = new Set<string>();
  let frontier = ordered.filter((t) => isDependencyRoot(t, byUuid));
  while (frontier.length > 0) {
    const next: Task[] = [];
    for (const parent of frontier) {
      if (seen.has(parent.stableUuid)) continue;
      seen.add(parent.stableUuid);
      emitted.push(parent);
    }
    for (const parent of frontier) {
      const siblings = childrenByParent.get(parent.stableUuid);
      if (siblings === undefined) continue;
      for (let i = siblings.length - 1; i >= 0; i--) {
        const child = siblings[i];
        if (child !== undefined && !seen.has(child.stableUuid)) next.push(child);
      }
    }
    frontier = next;
  }
  // Defensive tail: cycle members (never reachable as roots) emit last, working order.
  for (const t of ordered) {
    if (!seen.has(t.stableUuid)) {
      seen.add(t.stableUuid);
      emitted.push(t);
    }
  }
  return emitted;
}

/**
 * History event kind per patched issue field (data-model §5: `update-issue` rides
 * `title-updated` / `description-updated` / `checkbox-changed` per field — a
 * `stateTypeId` patch is the checkbox/completion op, FR-006; history-log.md §2).
 */
export function historyKindForUpdatedField(field: keyof IssueUpdatePatch): SyncHistoryEventKind {
  switch (field) {
    case "title":
      return "title-updated";
    case "description":
      return "description-updated";
    case "stateTypeId":
      return "checkbox-changed";
  }
}
