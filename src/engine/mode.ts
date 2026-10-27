/**
 * Mode selection + CheckpointStore (research R2; data-model §1–§2; T011 implemented;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed `sync-state.json` root against the v1 schema (data-model §1). A root
 * that is not an object never reaches here — `StateStore.readJson` rejects non-object
 * roots itself (loudly) — this guards the schema members: fixed `schemaVersion: 1` and an
 * object-valued `checkpoints` map. Corrupt material surfaces as a failure; it is NEVER
 * silently reinterpreted as "no checkpoints" (a silent bootstrap against an existing
 * checkpoint set would be a clobber vector — research R2).
 */
function parseCheckpointStoreFile(raw: unknown): CheckpointStoreFile {
  if (!isPlainObject(raw) || raw.schemaVersion !== 1 || !isPlainObject(raw.checkpoints)) {
    throw new Error(
      `checkpoint store '${CHECKPOINT_STORE_REL_PATH}' does not match the v1 schema ` +
        `{ schemaVersion: 1, checkpoints: Record<taskUuid, Checkpoint> } — run aborted (data-model §1)`,
    );
  }
  return { schemaVersion: 1, checkpoints: raw.checkpoints as Readonly<Record<string, Checkpoint>> };
}

/**
 * Read the checkpoint store; an absent file yields `{ schemaVersion: 1, checkpoints: {} }`
 * (fresh repository ⇒ bootstrap). Non-object/corrupt roots surface as engine failures.
 * T011 implements (T004).
 */
export async function readCheckpointStore(store: StateStore): Promise<CheckpointStoreFile> {
  // Unreadable/corrupt JSON or a non-object root throws inside readJson (StateFileError)
  // and propagates verbatim — presence-based mode selection must never guess.
  const raw = await store.readJson<unknown>(CHECKPOINT_STORE_REL_PATH);
  if (raw === null) {
    return { schemaVersion: 1, checkpoints: {} };
  }
  return parseCheckpointStoreFile(raw);
}

/**
 * Atomic whole-file write of the checkpoint map (the consistency unit — research R2);
 * called ONLY as the final step of a successful apply (data-model §1). T011 implements (T004).
 */
export async function writeCheckpointStore(
  store: StateStore,
  checkpoints: Readonly<Record<string /* taskUuid */, Checkpoint>>,
): Promise<void> {
  // Fresh copy under the fixed v1 root: a whole-file replacement, never a merge —
  // StateStore.writeJson serializes atomically (temp + rename, owner-only).
  const file: CheckpointStoreFile = { schemaVersion: 1, checkpoints: { ...checkpoints } };
  await store.writeJson(CHECKPOINT_STORE_REL_PATH, file);
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
  const mode: SyncMode = Object.keys(storeFile.checkpoints).length > 0 ? "sync" : "bootstrap";
  if (hint !== undefined && hint !== mode) {
    // Sanitized, machine-readable label (FR-005 posture): names the ignored hint and the
    // reality-selected mode only — never task identities or content (Principle II).
    return {
      mode,
      hintDisagreed: true,
      diagnosticReason:
        `mode-hint-disagreed: advisory BuildPlanOptions.mode hint '${hint}' ignored — ` +
        `checkpoint presence selects '${mode}' (FR-001 reality rule)`,
    };
  }
  return { mode, hintDisagreed: false };
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
  // Re-key the frozen snapshot by its own taskUuid (the record carries its key) and write
  // the result as ONE atomic whole-file replacement — entries absent from the snapshot
  // are thereby removed, and a rolled-back interrupted apply leaves no partial entries.
  const checkpoints: Record<string, Checkpoint> = {};
  for (const checkpoint of checkpointBefore) {
    checkpoints[checkpoint.taskUuid] = checkpoint;
  }
  await writeCheckpointStore(store, checkpoints);
}
