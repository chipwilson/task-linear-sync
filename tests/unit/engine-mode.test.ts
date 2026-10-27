/**
 * T004 [P] — checkpoint store + mode selection unit tests (FR-001; data-model §1–§2;
 * research R2; implementation T011 in `src/engine/mode.ts`).
 *
 * Pinned behavior:
 * - `sync-state.json` schema `{ schemaVersion: 1, checkpoints: Record<taskUuid, Checkpoint> }`
 *   (data-model §1), read/written EXCLUSIVELY via `StateStore.readJson`/`writeJson`
 *   (atomic, owner-only) — asserted with a recording `StateStore` decorator.
 * - Reality-based mode selection: no checkpoint record for the repo ⇒ `bootstrap`;
 *   ≥ 1 checkpoint ⇒ `sync` (FR-001 MUST).
 * - `BuildPlanOptions.mode` hint is ADVISORY (research R2): reality wins; a disagreeing
 *   hint sets `hintDisagreed` and yields a sanitized diagnostic reason (no task
 *   identities — Principle II posture on propagated text).
 * - Rollback restoration (FR-013): entries present in `checkpointBefore` are rewritten,
 *   entries ABSENT in the snapshot are REMOVED — one atomic whole-file write.
 *
 * Fixture worlds are still empty (T017/T031 pending), so the store is built directly
 * the way the existing state-tier tests do: temp directory outside a temp repo,
 * injected `FakeClock`, zero network / credentials / wall-clock.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "task-linear-sync/config";
import type { Checkpoint } from "task-linear-sync/domain";
import type { StateStore } from "task-linear-sync/state";
import { createStateStore } from "task-linear-sync/state";

import {
  CHECKPOINT_STORE_REL_PATH,
  readCheckpointStore,
  restoreCheckpointStoreFromSnapshot,
  selectMode,
  writeCheckpointStore,
} from "../../src/engine/mode.js";

import { sha256Hex, uuidFromLabel } from "../helpers/engine-harness.js";
import { FakeClock } from "../helpers/test-utils.js";

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-008-mode-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

// ──────────────────────────────────────────────────────────────── builders

/** Temp-dir `StateStore` (outside the repo — frozen placement rule), fixed injected clock. */
function makeStore(name: string): StateStore {
  const repo = join(scratch, `${name}-repo`);
  mkdirSync(repo, { recursive: true });
  const store = createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, `${name}-state`) } }),
    clock: new FakeClock("2026-01-01T00:00:00.000Z"),
  });
  return store;
}

/** Deterministic frozen `Checkpoint` record (placeholder material only — Principle III). */
function makeCheckpoint(label: string, overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    taskUuid: uuidFromLabel(`mode-test:${label}`),
    issueId: `issue-${label}`,
    title: `Placeholder title ${label}`,
    checked: false,
    issueUpdatedAt: "2026-01-01T00:00:01.000Z",
    issueStateType: "started",
    descriptionContentHash: sha256Hex(`placeholder description for ${label}`),
    ...overrides,
  };
}

interface RecordingStore extends StateStore {
  readonly writes: ReadonlyArray<{ rel: string; value: unknown }>;
  readonly reads: readonly string[];
}

/** Decorator recording every `readJson`/`writeJson` call, delegating to the real store. */
function recordingStore(store: StateStore): RecordingStore {
  const writes: Array<{ rel: string; value: unknown }> = [];
  const reads: string[] = [];
  return {
    ...store,
    writes,
    reads,
    async writeJson(rel: string, value: unknown): Promise<void> {
      writes.push({ rel, value });
      return store.writeJson(rel, value);
    },
    async readJson<T>(rel: string): Promise<T | null> {
      reads.push(rel);
      return store.readJson<T>(rel);
    },
  };
}

// ────────────────────────────────────────────── readCheckpointStore (data-model §1)

test("engine-mode — readCheckpointStore: absent sync-state.json yields the empty v1 store (fresh repository ⇒ bootstrap)", async () => {
  const store = makeStore("absent");
  await store.ensure();
  const spy = recordingStore(store);

  const file = await readCheckpointStore(spy);

  assert.deepEqual(file, { schemaVersion: 1, checkpoints: {} });
  // Exclusivity: the read flowed through StateStore.readJson at the pinned root-relative path.
  assert.equal(CHECKPOINT_STORE_REL_PATH, "sync-state.json");
  assert.deepEqual(spy.reads, [CHECKPOINT_STORE_REL_PATH]);
  assert.deepEqual(spy.writes, [], "reading must never write");
});

test("engine-mode — readCheckpointStore: reads the seeded { schemaVersion: 1, checkpoints } record", async () => {
  const store = makeStore("seeded");
  await store.ensure();
  const a = makeCheckpoint("alpha");
  const b = makeCheckpoint("beta");
  // Seed through the frozen StateStore surface (harness `seedCheckpoints` equivalent).
  await store.writeJson(CHECKPOINT_STORE_REL_PATH, {
    schemaVersion: 1,
    checkpoints: { [a.taskUuid]: a, [b.taskUuid]: b },
  });

  const file = await readCheckpointStore(store);

  assert.equal(file.schemaVersion, 1);
  assert.deepEqual(file.checkpoints, { [a.taskUuid]: a, [b.taskUuid]: b });
});

test("engine-mode — readCheckpointStore: corrupt or malformed store fails loudly (never a silent bootstrap)", async () => {
  const invalidJson = makeStore("corrupt-json");
  await invalidJson.ensure();
  writeFileSync(join(invalidJson.root, CHECKPOINT_STORE_REL_PATH), "{ not json at all");
  await assert.rejects(() => readCheckpointStore(invalidJson));

  const nonObjectRoot = makeStore("corrupt-root");
  await nonObjectRoot.ensure();
  await nonObjectRoot.writeJson(CHECKPOINT_STORE_REL_PATH, [1, 2, 3] as unknown as Record<string, never>);
  await assert.rejects(() => readCheckpointStore(nonObjectRoot));

  const wrongShape = makeStore("corrupt-shape");
  await wrongShape.ensure();
  await wrongShape.writeJson(CHECKPOINT_STORE_REL_PATH, { schemaVersion: 1, checkpoints: "not-a-map" });
  await assert.rejects(() => readCheckpointStore(wrongShape));
});

// ───────────────────────────────────────────── writeCheckpointStore (data-model §1)

test("engine-mode — writeCheckpointStore: atomic whole-file v1 write at sync-state.json via StateStore.writeJson", async () => {
  const store = makeStore("write");
  await store.ensure();
  const spy = recordingStore(store);
  const a = makeCheckpoint("gamma");
  const b = makeCheckpoint("delta");

  await writeCheckpointStore(spy, { [a.taskUuid]: a, [b.taskUuid]: b });

  assert.equal(spy.writes.length, 1, "exactly ONE StateStore.writeJson call (the consistency unit)");
  assert.equal(spy.writes[0]?.rel, CHECKPOINT_STORE_REL_PATH);
  assert.deepEqual(spy.writes[0]?.value, {
    schemaVersion: 1,
    checkpoints: { [a.taskUuid]: a, [b.taskUuid]: b },
  });

  // On-disk file carries exactly the v1 schema fields with the frozen Checkpoint records.
  const raw = JSON.parse(readFileSync(join(spy.root, CHECKPOINT_STORE_REL_PATH), "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(raw).sort(), ["checkpoints", "schemaVersion"]);
  assert.equal(raw.schemaVersion, 1);
  const onDisk = raw.checkpoints as Record<string, Checkpoint>;
  assert.deepEqual(onDisk[a.taskUuid], a);
  assert.deepEqual(onDisk[b.taskUuid], b);
});

test("engine-mode — writeCheckpointStore: replaces the store wholesale (no merge with prior content)", async () => {
  const store = makeStore("replace");
  await store.ensure();
  const a = makeCheckpoint("keep-me-not");
  const b = makeCheckpoint("shared");
  const bRewritten = { ...b, title: "Rewritten title" };
  const c = makeCheckpoint("fresh");

  await writeCheckpointStore(store, { [a.taskUuid]: a, [b.taskUuid]: b });
  await writeCheckpointStore(store, { [b.taskUuid]: bRewritten, [c.taskUuid]: c });

  const file = await readCheckpointStore(store);
  assert.deepEqual(file.checkpoints, { [b.taskUuid]: bRewritten, [c.taskUuid]: c });
});

test("engine-mode — writeCheckpointStore: an empty map round-trips as { schemaVersion: 1, checkpoints: {} }", async () => {
  const store = makeStore("empty-write");
  await store.ensure();

  await writeCheckpointStore(store, {});

  assert.ok(existsSync(join(store.root, CHECKPOINT_STORE_REL_PATH)), "the store file exists even when empty");
  const file = await readCheckpointStore(store);
  assert.deepEqual(file, { schemaVersion: 1, checkpoints: {} });
});

// ─────────────────────────────────────────────────────── selectMode (data-model §2)

test("engine-mode — selectMode: an empty checkpoint map selects bootstrap with no hint noise", () => {
  const sel = selectMode({ schemaVersion: 1, checkpoints: {} });
  assert.equal(sel.mode, "bootstrap");
  assert.equal(sel.hintDisagreed, false);
  assert.equal(sel.diagnosticReason, undefined);
});

test("engine-mode — selectMode: any checkpoint (1 or more) selects sync", () => {
  const one = makeCheckpoint("solo");
  const selOne = selectMode({ schemaVersion: 1, checkpoints: { [one.taskUuid]: one } });
  assert.equal(selOne.mode, "sync");
  assert.equal(selOne.hintDisagreed, false);

  const two = makeCheckpoint("pair");
  const selTwo = selectMode({ schemaVersion: 1, checkpoints: { [one.taskUuid]: one, [two.taskUuid]: two } });
  assert.equal(selTwo.mode, "sync");
});

test("engine-mode — selectMode: an agreeing advisory hint no-ops (sync/sync and bootstrap/bootstrap)", () => {
  const a = makeCheckpoint("agree");
  const syncSel = selectMode({ schemaVersion: 1, checkpoints: { [a.taskUuid]: a } }, "sync");
  assert.equal(syncSel.mode, "sync");
  assert.equal(syncSel.hintDisagreed, false);
  assert.equal(syncSel.diagnosticReason, undefined);

  const bootSel = selectMode({ schemaVersion: 1, checkpoints: {} }, "bootstrap");
  assert.equal(bootSel.mode, "bootstrap");
  assert.equal(bootSel.hintDisagreed, false);
  assert.equal(bootSel.diagnosticReason, undefined);
});

test("engine-mode — selectMode: checkpoints + hint 'bootstrap' — reality wins (sync), disagreement surfaces sanitized", () => {
  const a = makeCheckpoint("clobber-attempt");
  const sel = selectMode({ schemaVersion: 1, checkpoints: { [a.taskUuid]: a } }, "bootstrap");

  assert.equal(sel.mode, "sync", "FR-001 MUST: checkpoint presence overrides the hint");
  assert.equal(sel.hintDisagreed, true);
  assert.equal(typeof sel.diagnosticReason, "string");
  assert.notEqual(sel.diagnosticReason?.length, 0, "a disagreeing hint yields a diagnostic reason");
  assert.ok(sel.diagnosticReason?.includes("bootstrap"), "reason names the ignored hint");
  assert.ok(sel.diagnosticReason?.includes("sync"), "reason names the reality-selected mode");
  // Sanitized: machine-readable labels only — no task identities leak into propagated text.
  assert.ok(!sel.diagnosticReason?.includes(a.taskUuid), "diagnostic reason must not carry the task UUID");
});

test("engine-mode — selectMode: empty store + hint 'sync' — reality wins (bootstrap), disagreement surfaces", () => {
  const sel = selectMode({ schemaVersion: 1, checkpoints: {} }, "sync");
  assert.equal(sel.mode, "bootstrap", "a hint cannot conjure a baseline that does not exist");
  assert.equal(sel.hintDisagreed, true);
  assert.ok(sel.diagnosticReason?.includes("sync"), "reason names the ignored hint");
  assert.ok(sel.diagnosticReason?.includes("bootstrap"), "reason names the reality-selected mode");
});

// ─────────────────────────────── restoreCheckpointStoreFromSnapshot (FR-013, data-model §1)

test("engine-mode — restoreCheckpointStoreFromSnapshot: present entries rewritten, absent entries REMOVED, one atomic write", async () => {
  const store = makeStore("restore");
  await store.ensure();
  const a = makeCheckpoint("restored-a");
  const b = makeCheckpoint("untouched-b");
  const c = makeCheckpoint("created-during-run-must-vanish");
  const aPreRun = { ...a, title: "Pre-run title", descriptionContentHash: sha256Hex("pre-run description") };

  await writeCheckpointStore(store, {
    [a.taskUuid]: a,
    [b.taskUuid]: b,
    [c.taskUuid]: c,
  });

  const spy = recordingStore(store);
  await restoreCheckpointStoreFromSnapshot(spy, [aPreRun, b]);

  assert.equal(spy.writes.length, 1, "restoration is ONE atomic whole-file write");
  assert.equal(spy.writes[0]?.rel, CHECKPOINT_STORE_REL_PATH);

  const file = await readCheckpointStore(store);
  assert.equal(file.schemaVersion, 1);
  // a rewritten from the snapshot, b kept, c ABSENT from the snapshot ⇒ removed (FR-013).
  assert.deepEqual(Object.keys(file.checkpoints).sort(), [a.taskUuid, b.taskUuid].sort());
  assert.deepEqual(file.checkpoints[a.taskUuid], aPreRun);
  assert.deepEqual(file.checkpoints[b.taskUuid], b);
});

test("engine-mode — restoreCheckpointStoreFromSnapshot: an empty snapshot removes every entry (empty v1 store remains)", async () => {
  const store = makeStore("restore-empty");
  await store.ensure();
  const a = makeCheckpoint("gone-1");
  const b = makeCheckpoint("gone-2");
  await writeCheckpointStore(store, { [a.taskUuid]: a, [b.taskUuid]: b });

  await restoreCheckpointStoreFromSnapshot(store, []);

  assert.ok(existsSync(join(store.root, CHECKPOINT_STORE_REL_PATH)), "the store file is restored, not deleted");
  const file = await readCheckpointStore(store);
  assert.deepEqual(file, { schemaVersion: 1, checkpoints: {} });
});

// ───────────────────────────────────────────────── store-level FR-001 lifecycle round trip

test("engine-mode — mode reality round trip: apply-final write ⇒ sync; rollback restore to empty ⇒ bootstrap", async () => {
  const store = makeStore("lifecycle");
  await store.ensure();
  const a = makeCheckpoint("cycle");

  // Fresh repository: plan-start read selects bootstrap.
  assert.equal(selectMode(await readCheckpointStore(store)).mode, "bootstrap");

  // Successful apply writes the checkpoint store as its FINAL step.
  await writeCheckpointStore(store, { [a.taskUuid]: a });
  const afterApply = selectMode(await readCheckpointStore(store));
  assert.equal(afterApply.mode, "sync");
  assert.equal(afterApply.hintDisagreed, false);

  // Rollback restores the pre-run (empty) snapshot — the next run bootstraps again.
  await restoreCheckpointStoreFromSnapshot(store, []);
  assert.equal(selectMode(await readCheckpointStore(store)).mode, "bootstrap");
});
