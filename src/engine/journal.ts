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
 * `rollbackRun` then refuses `MANIFEST_UNJOURNALED`. Tamper ⇒ `JournalError`, no plaintext.
 */
import type { Checkpoint } from "../domain/checkpoint.js";
import type { AuditManifest, AuditStepState } from "../domain/run-records.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Clock } from "../state/clock.js";
import type { KeyProvider, ManifestEnvelope } from "../state/manifest.js";
import type { StateStore } from "../state/paths.js";
import type { EngineOpKind, OpAfterSnapshot, OpBeforeSnapshot, PlannedOp } from "./ops.js";

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
  /** Result-state guard material (FR-014 observed-state comparison). */
  readonly afterSnapshot: OpAfterSnapshot;
  /** Create ops only; FK → frozen `CreateIntent`. */
  readonly intentId?: string;
  /** `pending → applied → rolled-back | conflict-halted` (frozen `AuditStepState`). */
  readonly stepState: AuditStepState;
}

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
}

/** State-relative manifest path: `manifests/<runId>.json` (journal-rollback.md §1 table). */
export function manifestRelPath(runId: string): string {
  void [runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/** State-relative step-journal path: `runs/<runId>/journal.json` (journal-rollback.md §1 table). */
export function journalRelPath(runId: string): string {
  void [runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/**
 * Materialize BOTH artifacts COMPLETE before the first mutation (journal-rollback.md §1;
 * R9): one frozen `AuditOperation` per planned op (attachment ops with `attachmentUrl` +
 * `priorMetadata` — FR-015), `fileBackups`, `checkpointBefore`; every `JournalStep`
 * sealed in the `pending` state with pre-read before-snapshots. Returns the written
 * artifacts. Key unavailable ⇒ abort (frozen `ManifestKeyUnavailableError` posture).
 * T041 implements (T032–T036).
 */
export async function materializeJournal(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: Clock,
  input: MaterializeJournalInput,
): Promise<JournalArtifacts> {
  void [store, config, keyProvider, clock, input]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/**
 * Apply one step-state transition: update the manifest operation AND the step journal,
 * re-seal both, atomically rewrite both (crash-exact resumability; journal-rollback.md §1).
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
  void [store, config, keyProvider, clock, runId, transition]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/**
 * Read the manifest ENVELOPE only (no decryption): the unencrypted `createdAt` header
 * feeds the frozen `isManifestExpired` check BEFORE any key material is consulted
 * (journal-rollback.md §2). Null ⇒ no manifest exists (refuse `MANIFEST_UNJOURNALED`).
 * T041 implements (T044).
 */
export async function readManifestEnvelope(
  store: StateStore,
  runId: string,
): Promise<ManifestEnvelope | null> {
  void [store, runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/** True when BOTH artifacts exist for the run (rollback precondition; §2 refusals). T041 implements. */
export async function journalArtifactsExist(store: StateStore, runId: string): Promise<boolean> {
  void [store, runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}

/**
 * Open and trust BOTH artifacts (rollback entry, journal-rollback.md §2): envelope tag
 * checks via frozen `openManifest`; tamper/unreadable/malformed ⇒ `JournalError` with NO
 * plaintext (R9/R11/R14). Consistency of opId alignment between manifest and journal is
 * validated here. T041 implements (T044).
 */
export async function readJournalArtifacts(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: Clock,
  runId: string,
): Promise<JournalArtifacts> {
  void [store, config, keyProvider, clock, runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: journal");
}
