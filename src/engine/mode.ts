/**
 * Mode selection + CheckpointStore (research R2; data-model §1–§2; task T011 implements;
 * unit tests T004). FR-001: mode is selected SOLELY by checkpoint presence for the
 * repository — no checkpoint ⇒ `bootstrap`, ≥1 ⇒ `sync`. The `sync-state.json` store
 * (schema `{ schemaVersion: 1, checkpoints: Record<taskUuid, Checkpoint> }`) is read at
 * plan start and written atomically as the final step of a successful apply; rollback
 * restores/removes entries from `AuditManifest.checkpointBefore` (FR-013).
 * Read/write exclusively via `StateStore.readJson`/`writeJson` (atomic, owner-only).
 */
import type { Checkpoint } from "../domain/checkpoint.js";
import type { StateStore } from "../state/paths.js";

/** The two run modes (frozen `BuildPlanOptions.mode` vocabulary; data-model §2). */
export type SyncMode = "bootstrap" | "sync";

/** Root-relative state path of the checkpoint store (research R2; `src/state/paths.ts`). */
export const CHECKPOINT_STORE_REL_PATH = "sync-state.json";

/** `sync-state.json` file schema (data-model §1; 008-owned; entries are frozen §6 checkpoints). */
export interface CheckpointStoreFile {
  /** Fixed at 1; future versions are amendments. */
  readonly schemaVersion: 1;
  /** One entry per task with a completed sync, keyed by task UUID. */
  readonly checkpoints: Readonly<Record<string /* taskUuid */, Checkpoint>>;
}

/** Result of advisory-aware mode selection (research R2; FR-001). */
export interface ModeSelection {
  /** Reality-selected mode — checkpoint presence wins over any hint (FR-001 MUST). */
  readonly mode: SyncMode;
  /** True when the advisory `BuildPlanOptions.mode` hint disagreed with reality. */
  readonly hintDisagreed: boolean;
  /** Sanitized diagnostic reason surfaced in plan reasons when the hint disagreed. */
  readonly diagnosticReason?: string;
}

/**
 * Read the checkpoint store; an absent file yields `{ schemaVersion: 1, checkpoints: {} }`
 * (fresh repository ⇒ bootstrap). Non-object/corrupt roots surface as engine failures.
 * T011 implements (T004).
 */
export async function readCheckpointStore(store: StateStore): Promise<CheckpointStoreFile> {
  void [store]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: mode");
}

/**
 * Atomic whole-file write of the checkpoint map (the consistency unit — research R2);
 * called ONLY as the final step of a successful apply (data-model §1). T011 implements (T004).
 */
export async function writeCheckpointStore(
  store: StateStore,
  checkpoints: Readonly<Record<string /* taskUuid */, Checkpoint>>,
): Promise<void> {
  void [store, checkpoints]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: mode");
}

/**
 * `selectMode` (data-model §2): `sync` iff the store holds any checkpoint for the
 * repository, else `bootstrap`. The advisory hint never overrides reality (research R2);
 * a disagreeing hint sets `hintDisagreed` with a sanitized `diagnosticReason`.
 * T011 implements (T004).
 */
export function selectMode(
  storeFile: CheckpointStoreFile,
  hint?: SyncMode,
): ModeSelection {
  void [storeFile, hint]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: mode");
}

/**
 * Rollback restoration material (data-model §1; FR-013; research R11 step 3): rewrite
 * present entries and REMOVE entries absent from `checkpointBefore`, so the store
 * exactly matches the pre-run map. Consumed by `rollback.ts` (T044). T011 implements.
 */
export async function restoreCheckpointStoreFromSnapshot(
  store: StateStore,
  checkpointBefore: readonly Checkpoint[],
): Promise<void> {
  void [store, checkpointBefore]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: mode");
}
