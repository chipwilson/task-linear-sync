/**
 * Journal artifacts — frozen audit manifest + 008-local step journal (research R9;
 * contracts/journal-rollback.md §1; data-model §5/§9; task T041 implements; contract
 * T030; integration T036).
 * Two artifacts per journaled run, both in the state directory, materialized COMPLETE
 * before the first mutation and re-sealed + atomically rewritten after every step
 * transition (crash at any point ⇒ exact resume input):
 * - Audit manifest   `manifests/<runId>.json` — frozen `AuditManifest` via
 *   `src/state/manifest.ts` seal/open (AES-256-GCM versioned envelope; unencrypted
 *   `createdAt` header drives expiry via frozen `isManifestExpired`).
 * - Step journal     `runs/<runId>/journal.json` — `JournalStep[]` guard material under
 *   the SAME envelope/key-provider/expiry posture (deferred amendment candidate, R9).
 * `journalingEnabled: false` (effective flag, options.ts) ⇒ neither artifact exists;
 * the CALLER (apply T043) never invokes {@link materializeJournal} when journaling is
 * disabled, so this module never inspects the flag itself. `rollbackRun` then refuses
 * `MANIFEST_UNJOURNALED`. Tamper ⇒ `JournalError`, no plaintext.
 *
 * Write discipline (crash-exact resumability, journal-rollback.md §1): every write goes
 * through `StateStore.writeJson` (temp+rename atomic, 0o600, R7). Both artifacts are
 * written in the SAME order on materialize and on every re-seal — step journal FIRST,
 * manifest SECOND — so a manifest whose presence the rollback expiry check keys on
 * (`readManifestEnvelope`) never exists without its matching step journal, and any
 * torn window reads as "not journaled" (fail-closed `MANIFEST_UNJOURNALED` refusal).
 *
 * Re-seal posture: the frozen `sealManifest` stamps the unencrypted header `createdAt`
 * from the injected clock at seal TIME, so every transition re-seal refreshes the header
 * (expiry therefore measures elapsed time since the LAST seal). The inner
 * `AuditManifest.createdAt` keeps the original run-creation instant — that field is the
 * run-creation record; the header is the envelope-freshness record.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Checkpoint } from "../domain/checkpoint.js";
import type { AuditManifest, AuditOperation, AuditStepState } from "../domain/run-records.js";
import type { AttachmentMetadata } from "../ports/linear-port.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Clock } from "../state/clock.js";
import {
  ManifestTamperError,
  openManifest,
  sealManifest,
  type KeyProvider,
  type ManifestEnvelope,
} from "../state/manifest.js";
import type { StateStore } from "../state/paths.js";
import type { EngineOpKind, OpAfterSnapshot, OpBeforeSnapshot, PlannedOp } from "./ops.js";
import { JournalError } from "./errors.js";

/** One journaled mutation step — 008-local guard material (data-model §5). */
export interface JournalStep {
  /** Matches the frozen `AuditOperation.opId` (manifest ↔ journal alignment). */
  readonly opId: string;
  readonly kind: EngineOpKind;
  /** Mutated issue (issue/attachment ops). */
  readonly targetIssueId?: string;
  /** Mutated file (render ops). Exactly one of `targetIssueId`/`filePath` per kind. */
  readonly filePath?: string;
  /** Rollback restore material. */
  readonly beforeSnapshot: OpBeforeSnapshot;
  /**
   * Result-state guard material (FR-014 observed-state comparison). `create-issue` ops
   * cannot know the landed `IssueView` before the create lands — such steps carry the
   * {@link AFTER_SNAPSHOT_PENDING} placeholder until {@link recordStepTransition} applies
   * the real snapshot (journal-rollback.md §1 "placeholder-or-real").
   */
  readonly afterSnapshot: OpAfterSnapshot | AfterSnapshotPending;
  /** Create ops only; FK → frozen `CreateIntent`. */
  readonly intentId?: string;
  /** `pending → applied → rolled-back | conflict-halted` (frozen `AuditStepState`). */
  readonly stepState: AuditStepState;
}

/** Discriminator value of the unlanded-after placeholder (collides with no op kind). */
export const AFTER_SNAPSHOT_PENDING_KIND = "pending" as const;

/**
 * Placeholder `afterSnapshot` for steps whose result state is only learnable at landing
 * (create ops; upsert ops without pre-computable resulting metadata). Narrowed away once
 * {@link recordStepTransition} records the real {@link OpAfterSnapshot}.
 */
export interface AfterSnapshotPending {
  readonly kind: typeof AFTER_SNAPSHOT_PENDING_KIND;
}

/** The shared placeholder instance (structural, canonical-JSON stable). */
export const AFTER_SNAPSHOT_PENDING: AfterSnapshotPending = {
  kind: AFTER_SNAPSHOT_PENDING_KIND,
};

/** The paired run artifacts (manifest + step journal), opened and trusted. */
export interface JournalArtifacts {
  readonly manifest: AuditManifest;
  readonly steps: readonly JournalStep[];
}

/** Input for complete-before-first-mutation materialization (journal-rollback.md §1). */
export interface MaterializeJournalInput {
  readonly runId: string;
  readonly planId: string;
  readonly repoRoot: string;
  /** EVERY planned op with before-snapshots pre-read (file backups, prior attachment metadata). */
  readonly ops: readonly PlannedOp[];
  /** Full before content + hash per file the run will write (frozen shape member). */
  readonly fileBackups: AuditManifest["fileBackups"];
  /** Full checkpoint map snapshot (rollback material, FR-013). */
  readonly checkpointBefore: readonly Checkpoint[];
}

/** One step-state transition persisted by re-sealing BOTH artifacts atomically. */
export interface StepTransition {
  readonly opId: string;
  readonly stepState: AuditStepState;
  /** Landed result material recorded when the step applies (guard for rollback). */
  readonly afterSnapshot?: OpAfterSnapshot;
  /** Created-issue id, learned only when a create lands. */
  readonly targetIssueId?: string;
  /** Landing-learned BEFORE material for attachment ops whose planned prior was null. */
  readonly before?: AttachmentMetadata | null;
}

/** Empty-string `AuditOperation.targetIssueId` sentinel: target learned only at landing. */
const TARGET_UNLEARNED = "";

/** runId is a hash id in practice; guard the path segments against traversal anyway. */
function assertSafeRunId(runId: string): void {
  if (runId.length === 0 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.includes("..")) {
    throw new JournalError("run id is not a safe state-path segment", { runId });
  }
}

/** State-relative manifest path: `manifests/<runId>.json` (journal-rollback.md §1 table). */
export function manifestRelPath(runId: string): string {
  assertSafeRunId(runId);
  return `manifests/${runId}.json`;
}

/** State-relative step-journal path: `runs/<runId>/journal.json` (journal-rollback.md §1 table). */
export function journalRelPath(runId: string): string {
  assertSafeRunId(runId);
  return `runs/${runId}/journal.json`;
}

// ── Shape guards (sanitized: failures report KINDS, never content — R9/R11/R14) ──────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isEnvelopeShape(v: unknown): v is ManifestEnvelope {
  return (
    isRecord(v) &&
    v.schemaVersion === 1 &&
    typeof v.keyId === "string" &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.ciphertext === "string" &&
    typeof v.createdAt === "string"
  );
}

/** Unwrap the frozen envelope plaintext `canonicalJson({ createdAt, manifest })` shape. */
function unwrapSealed(v: unknown): unknown {
  if (isRecord(v) && typeof v.createdAt === "string" && "manifest" in v) return v.manifest;
  return v;
}

function isAuditStepState(v: unknown): v is AuditStepState {
  return v === "pending" || v === "applied" || v === "rolled-back" || v === "conflict-halted";
}

function parseManifestContent(v: unknown, runId: string): AuditManifest {
  const m = unwrapSealed(v);
  if (
    !isRecord(m) ||
    m.runId !== runId ||
    typeof m.createdAt !== "string" ||
    typeof m.repoRoot !== "string" ||
    typeof m.planId !== "string" ||
    !Array.isArray(m.fileBackups) ||
    !Array.isArray(m.checkpointBefore) ||
    !Array.isArray(m.operations)
  ) {
    throw new JournalError("audit manifest content is malformed", { runId });
  }
  return m as unknown as AuditManifest;
}

function parseJournalContent(v: unknown, runId: string): JournalStep[] {
  const content = unwrapSealed(v);
  let raw: unknown[];
  if (Array.isArray(content)) raw = content;
  else if (isRecord(content) && Array.isArray(content.steps)) raw = content.steps;
  else throw new JournalError("step journal content is malformed", { runId });
  const steps: JournalStep[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.opId !== "string" ||
      typeof item.kind !== "string" ||
      !isRecord(item.beforeSnapshot) ||
      !isRecord(item.afterSnapshot) ||
      !isAuditStepState(item.stepState)
    ) {
      throw new JournalError("step journal contains a malformed step", { runId });
    }
    steps.push(item as unknown as JournalStep);
  }
  return steps;
}

/** manifest ↔ journal alignment: same opIds, same order, same kinds (tamper posture). */
function assertAligned(manifest: AuditManifest, steps: readonly JournalStep[], runId: string): void {
  if (manifest.operations.length !== steps.length) {
    throw new JournalError("manifest operations and journal steps differ in count", { runId });
  }
  for (let i = 0; i < steps.length; i++) {
    const op = manifest.operations[i];
    const step = steps[i];
    if (
      op === undefined ||
      step === undefined ||
      op.opId !== step.opId ||
      op.kind !== step.kind ||
      step.beforeSnapshot.kind !== step.kind
    ) {
      throw new JournalError("manifest operation and journal step are misaligned", { runId });
    }
  }
}

/** Open a sealed envelope; tamper rejects as `JournalError` with NO plaintext (R9). */
async function openSealed(
  env: ManifestEnvelope,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  runId: string,
): Promise<unknown> {
  try {
    return await openManifest(env, config, keyProvider);
  } catch (e) {
    if (e instanceof ManifestTamperError) {
      // Sanitized diagnostic only — never the underlying message content beyond the
      // generic label; NO plaintext (journal-rollback.md §2, constitution).
      throw new JournalError("journal artifact authentication tag check failed — rejected", {
        runId,
        cause: "tag-check-failed",
      });
    }
    throw e; // ManifestKeyUnavailableError propagates verbatim (key posture, not tamper).
  }
}

// ── Frozen-manifest materialization (FR-015 field mapping) ───────────────────────────

/** One frozen `AuditOperation` per planned op (R9; FR-015 attachment fields verbatim). */
function auditOperationFor(op: PlannedOp): AuditOperation {
  const priorMetadata =
    op.kind === "upsert-attachment" && op.beforeSnapshot.kind === "upsert-attachment"
      ? op.beforeSnapshot.priorMetadata
      : undefined;
  // FR-015: a PRE-RUN prior is seeded at materialization (null ⇒ omitted from the
  // frozen op, which IS the "no prior" encoding). A prior learned only at landing
  // (first writer of the URL) rides the transition's before merge in
  // `recordStepTransition`.
  // A planned op always carries a target: an issue id, a learned-at-landing sentinel "",
  // or the file path for file/checkpoint ops (data-model §9 "Mutated target").
  const target = op.targetIssueId ?? op.filePath ?? TARGET_UNLEARNED;
  return {
    opId: op.opId,
    kind: op.kind,
    // "" ⇒ target learned only at landing (create ops; run-level write-checkpoint).
    targetIssueId: target,
    ...(op.attachmentUrl !== undefined ? { attachmentUrl: op.attachmentUrl } : {}),
    // FR-015: prior metadata rides the manifest only where one existed (null ⇒ omitted).
    ...(priorMetadata !== null && priorMetadata !== undefined ? { priorMetadata } : {}),
    stepState: "pending",
  };
}

/** One guard-material `JournalStep` per planned op, sealed in the `pending` state. */
function journalStepFor(op: PlannedOp): JournalStep {
  return {
    opId: op.opId,
    kind: op.kind,
    ...(op.targetIssueId !== undefined ? { targetIssueId: op.targetIssueId } : {}),
    ...(op.filePath !== undefined ? { filePath: op.filePath } : {}),
    beforeSnapshot: op.beforeSnapshot,
    afterSnapshot: op.afterSnapshot ?? AFTER_SNAPSHOT_PENDING,
    ...(op.intentId !== undefined ? { intentId: op.intentId } : {}),
    stepState: "pending",
  };
}

/**
 * Materialize BOTH artifacts COMPLETE before the first mutation (journal-rollback.md §1;
 * R9): one frozen `AuditOperation` per planned op (attachment ops with `attachmentUrl` +
 * `priorMetadata` — FR-015), `fileBackups`, `checkpointBefore`; every `JournalStep`
 * sealed in the `pending` state with pre-read before-snapshots. Returns the written
 * artifacts. Key unavailable ⇒ abort (frozen `ManifestKeyUnavailableError` posture —
 * propagates from `sealManifest` before any write). Journaling-disabled is the CALLER's
 * posture: this function is simply never invoked then, so neither artifact exists.
 * T041 implements (T032–T036).
 */
export async function materializeJournal(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: Clock,
  input: MaterializeJournalInput,
): Promise<JournalArtifacts> {
  const { runId } = input;
  const manifestRel = manifestRelPath(runId);
  const journalRel = journalRelPath(runId);

  const operationEntries = input.ops.map(auditOperationFor);
  if (new Set(operationEntries.map((o) => o.opId)).size !== operationEntries.length) {
    throw new JournalError("planned ops carry duplicate opIds", { runId });
  }

  const manifest: AuditManifest = {
    runId,
    createdAt: clock.now().toISOString(),
    repoRoot: input.repoRoot,
    planId: input.planId,
    fileBackups: [...input.fileBackups],
    checkpointBefore: [...input.checkpointBefore],
    operations: operationEntries,
  };
  const steps = input.ops.map(journalStepFor);

  // Seal FIRST: a key-unavailable abort must leave neither artifact behind.
  const [manifestEnv, journalEnv] = await Promise.all([
    sealManifest(manifest, config, keyProvider, clock),
    sealManifest(steps, config, keyProvider, clock),
  ]);

  await store.ensure();
  // Journal first, manifest second (header docblock): fail-closed torn windows.
  await store.writeJson(journalRel, journalEnv);
  await store.writeJson(manifestRel, manifestEnv);

  return { manifest, steps };
}

/**
 * Apply one step-state transition: update the manifest operation AND the step journal,
 * re-seal both, atomically rewrite both (crash-exact resumability; journal-rollback.md §1).
 * `afterSnapshot` (recorded when a create/upsert lands) and `targetIssueId` (learned at
 * landing) merge into the step AND mirror onto the frozen operation's `stepState`/
 * `targetIssueId`. Tamper ⇒ `JournalError`, no plaintext; key-unavailable propagates.
 * T041 implements (T043).
 */
export async function recordStepTransition(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: Clock,
  runId: string,
  transition: StepTransition,
): Promise<void> {
  const manifest = await readManifestSealed(store, runId, config, keyProvider);
  const journalEnv = await store.readJson<unknown>(journalRelPath(runId));
  if (journalEnv === null || !isEnvelopeShape(journalEnv)) {
    throw new JournalError("step journal is absent or malformed for this transition", { runId });
  }

  const steps = parseJournalContent(
    await openSealed(journalEnv, config, keyProvider, runId),
    runId,
  );
  assertAligned(manifest, steps, runId);

  const stepIndex = steps.findIndex((s) => s.opId === transition.opId);
  if (stepIndex < 0) {
    throw new JournalError("transition references an unknown opId", {
      runId,
      cause: "opId-not-found",
    });
  }
  const step = steps[stepIndex] as JournalStep;
  if (transition.afterSnapshot !== undefined && transition.afterSnapshot.kind !== step.kind) {
    throw new JournalError("transition afterSnapshot kind disagrees with the step kind", {
      runId,
      cause: "kind-mismatch",
    });
  }

  const nextStep: JournalStep = {
    ...step,
    ...(transition.targetIssueId !== undefined ? { targetIssueId: transition.targetIssueId } : {}),
    ...(transition.afterSnapshot !== undefined ? { afterSnapshot: transition.afterSnapshot } : {}),
    // Landing-learned before material (first writer of an attachment URL carries the
    // pre-run state it found — the planned before was unknowable `null`): merge a
    // before into a still-null planned before, keeping step and manifest aligned.
    ...(transition.before !== undefined &&
    step.beforeSnapshot.kind === "upsert-attachment" &&
    step.beforeSnapshot.priorMetadata === null
      ? { beforeSnapshot: { ...step.beforeSnapshot, priorMetadata: transition.before } }
      : {}),
    stepState: transition.stepState,
  };
  const nextSteps = steps.map((s, i) => (i === stepIndex ? nextStep : s));
  const nextOperations = manifest.operations.map((op) =>
    op.opId === transition.opId
      ? {
          ...op,
          ...(transition.targetIssueId !== undefined &&
          op.targetIssueId === TARGET_UNLEARNED
            ? { targetIssueId: transition.targetIssueId }
            : {}),
          // FR-015 merge: a learned NON-NULL prior lands on an op whose planned prior was
          // null/absent. A null learning means "no prior attachment existed" — the frozen
          // encoding stays ABSENT (`undefined`), never an explicit null.
          ...(transition.before !== undefined &&
          transition.before !== null &&
          (op.priorMetadata === null || op.priorMetadata === undefined)
            ? { priorMetadata: transition.before }
            : {}),
          stepState: transition.stepState,
        }
      : op,
  );
  const nextManifest: AuditManifest = { ...manifest, operations: nextOperations };

  // Re-seal both with the SAME envelope function/key provider/expiry posture (R9); the
  // unencrypted header `createdAt` refreshes to `clock.now()` per the frozen sealManifest
  // (see header docblock). Seal both BEFORE any write (all-or-nothing on key loss).
  const [manifestEnv, journalEnvNext] = await Promise.all([
    sealManifest(nextManifest, config, keyProvider, clock),
    sealManifest(nextSteps, config, keyProvider, clock),
  ]);
  await store.writeJson(journalRelPath(runId), journalEnvNext);
  await store.writeJson(manifestRelPath(runId), manifestEnv);
}

/** Read + open + parse the sealed manifest (shared by transition/read paths). */
async function readManifestSealed(
  store: StateStore,
  runId: string,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
): Promise<AuditManifest> {
  const envelope = await readManifestEnvelope(store, runId);
  if (envelope === null) {
    throw new JournalError("audit manifest is absent for this run", { runId });
  }
  return parseManifestContent(await openSealed(envelope, config, keyProvider, runId), runId);
}

/**
 * Read the manifest ENVELOPE only (no decryption): the unencrypted `createdAt` header
 * feeds the frozen `isManifestExpired` check BEFORE any key material is consulted
 * (journal-rollback.md §2). Null ⇒ no manifest exists (refuse `MANIFEST_UNJOURNALED`).
 * Present-but-malformed ⇒ `JournalError` (tamper posture; no plaintext is ever involved —
 * nothing beyond the envelope header is parsed). T041 implements (T044).
 */
export async function readManifestEnvelope(
  store: StateStore,
  runId: string,
): Promise<ManifestEnvelope | null> {
  const rel = manifestRelPath(runId);
  let raw: unknown;
  try {
    raw = await store.readJson<unknown>(rel);
  } catch {
    throw new JournalError("audit manifest is unreadable", { runId, cause: "unreadable" });
  }
  if (raw === null) return null;
  if (!isEnvelopeShape(raw)) {
    throw new JournalError("audit manifest envelope is malformed", { runId });
  }
  return raw;
}

/** True when BOTH artifacts exist for the run (rollback precondition; §2 refusals). T041 implements. */
export async function journalArtifactsExist(store: StateStore, runId: string): Promise<boolean> {
  const manifestRel = manifestRelPath(runId);
  const journalRel = journalRelPath(runId);
  return (
    existsSync(join(store.root, manifestRel)) && existsSync(join(store.root, journalRel))
  );
}

/**
 * Open and trust BOTH artifacts (rollback entry, journal-rollback.md §2): envelope tag
 * checks via frozen `openManifest`; tamper/unreadable/malformed ⇒ `JournalError` with NO
 * plaintext (R9/R11/R14). Consistency of opId alignment between manifest and journal is
 * validated here. Expiry refusals are the CALLER's posture (`readManifestEnvelope` +
 * frozen `isManifestExpired` before this open — §2 keeps expiry decidable key-free).
 * Key-unavailable propagates as frozen `ManifestKeyUnavailableError` (not tamper).
 * T041 implements (T044).
 */
export async function readJournalArtifacts(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: Clock,
  runId: string,
): Promise<JournalArtifacts> {
  void clock; // expiry is the caller's posture (§2); opening needs no clock
  const manifest = await readManifestSealed(store, runId, config, keyProvider);
  const journalEnv = await store.readJson<unknown>(journalRelPath(runId));
  if (journalEnv === null || !isEnvelopeShape(journalEnv)) {
    throw new JournalError("step journal is absent or malformed for this run", { runId });
  }
  const steps = parseJournalContent(
    await openSealed(journalEnv, config, keyProvider, runId),
    runId,
  );
  assertAligned(manifest, steps, runId);
  return { manifest, steps };
}
