/**
 * T038 [US2] — lock-matrix unit tests (research R8, FR-003, SC-004; test name contains
 * "lock matrix" per quickstart). Takeover requires BOTH conditions: recorded process not
 * alive AND age > staleLockTakeoverSeconds (default 60 s, injected clock). EPERM counts as
 * alive. Release only ever removes the caller's own runId.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { acquireRunLock, releaseRunLock, createStateStore, systemClock } from "task-linear-sync/state";
import type { RunLockRecord, StateStore } from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";
import { FakeClock } from "../helpers/test-utils.js";

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-lock-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

function makeStore(name: string, clock: FakeClock | typeof systemClock): StateStore {
  const repo = join(scratch, `${name}-repo`);
  mkdirSync(repo, { recursive: true });
  return createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, `${name}-state`) } }),
    clock,
  });
}

/** A pid that exited and was reaped ⇒ provably dead (ESRCH). */
function deadPid(): number {
  for (let i = 0; i < 8; i++) {
    const r = spawnSync("sh", ["-c", "exit 0"]);
    const pid = r.pid;
    if (pid === undefined) continue;
    try {
      process.kill(pid, 0);
      continue; // still resolvable (reuse/zombie) — try another
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
  }
  assert.fail("could not obtain a provably-dead pid");
}

test("lock matrix — fresh exclusive-create acquisition succeeds and persists the record", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("fresh", clock);
  await store.ensure();
  const res = await acquireRunLock(store, "run-1");
  assert.equal(res.acquired, true);
  if (res.acquired) {
    assert.equal(res.tookOverStale, false);
    assert.equal(res.record.runId, "run-1");
    assert.equal(res.record.pid, process.pid);
    assert.equal(res.record.acquiredAt, "2026-10-22T09:00:00.000Z", "recorded via injected clock");
  }
  const onDisk = JSON.parse(readFileSync(store.paths.lock, "utf8")) as RunLockRecord;
  assert.deepEqual(onDisk, res.acquired ? res.record : onDisk);
});

test("lock matrix — live-process contention refuses with reason live-process", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("live", clock);
  await store.ensure();
  const first = await acquireRunLock(store, "run-holder");
  assert.equal(first.acquired, true);
  clock.advanceMs(5 * 60_000); // 5 min later — still inside a hypothetical window, but pid is ALIVE
  const second = await acquireRunLock(store, "run-contender");
  assert.equal(second.acquired, false);
  if (!second.acquired) {
    assert.equal(second.reason, "live-process");
    assert.equal(second.heldBy.runId, "run-holder");
  }
});

test("lock matrix — dead pid WITHIN the 60 s stale window refuses (within-stale-window)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("window", clock);
  await store.ensure();
  const victim = deadPid();
  writeFileSync(
    store.paths.lock,
    JSON.stringify({ runId: "crashed-run", pid: victim, acquiredAt: clock.iso() }),
  );
  clock.advanceMs(59_999); // strictly within default 60 s
  const res = await acquireRunLock(store, "run-b");
  assert.equal(res.acquired, false);
  if (!res.acquired) {
    assert.equal(res.reason, "within-stale-window");
    assert.equal(res.heldBy.runId, "crashed-run");
  }
});

test("lock matrix — dead pid PAST the threshold takes over (tookOverStale) — both conditions met", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("stale", clock);
  await store.ensure();
  const victim = deadPid();
  writeFileSync(
    store.paths.lock,
    JSON.stringify({ runId: "crashed-run", pid: victim, acquiredAt: clock.iso() }),
  );
  clock.advanceMs(60_001); // strictly greater than default 60 s
  const res = await acquireRunLock(store, "run-new");
  assert.equal(res.acquired, true);
  if (res.acquired) {
    assert.equal(res.tookOverStale, true);
    assert.equal(res.record.runId, "run-new");
  }
  const onDisk = JSON.parse(readFileSync(store.paths.lock, "utf8")) as RunLockRecord;
  assert.equal(onDisk.runId, "run-new", "lock file replaced atomically");
});

test("lock matrix — dead pid exactly at the threshold does NOT take over (age must EXCEED)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("exact", clock);
  await store.ensure();
  const victim = deadPid();
  writeFileSync(
    store.paths.lock,
    JSON.stringify({ runId: "crashed-run", pid: victim, acquiredAt: clock.iso() }),
  );
  clock.advanceMs(60_000);
  const res = await acquireRunLock(store, "run-new");
  assert.equal(res.acquired, false);
});

test("lock matrix — EPERM on the liveness probe counts as ALIVE (pid 1, unkillable probe)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("eperm", clock);
  await store.ensure();
  // pid 1: non-root ⇒ kill(1,0) EPERM (cannot prove death ⇒ alive); root ⇒ succeeds ⇒ alive.
  writeFileSync(
    store.paths.lock,
    JSON.stringify({ runId: "system-run", pid: 1, acquiredAt: clock.iso() }),
  );
  clock.advanceMs(10 * 60_000); // way past the age threshold — must STILL refuse
  const res = await acquireRunLock(store, "run-new");
  assert.equal(res.acquired, false, "SC-004: live process NEVER loses the lock");
  if (!res.acquired) assert.equal(res.reason, "live-process");
});

test("lock matrix — configured staleLockTakeoverSeconds overrides the 60 s default", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const repo = join(scratch, "custom-repo");
  mkdirSync(repo, { recursive: true });
  const store = createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, "custom-state"), staleLockTakeoverSeconds: 5 } }),
    clock,
  });
  await store.ensure();
  const victim = deadPid();
  writeFileSync(store.paths.lock, JSON.stringify({ runId: "crashed", pid: victim, acquiredAt: clock.iso() }));
  clock.advanceMs(6_000); // past the custom 5 s threshold
  const res = await acquireRunLock(store, "run-new");
  assert.equal(res.acquired, true);
});

test("release removes only the caller's own lock (compare runId)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("release", clock);
  await store.ensure();
  const first = await acquireRunLock(store, "run-mine");
  assert.equal(first.acquired, true);

  // Foreign release: a record with a different runId must NOT remove the lock.
  await releaseRunLock(store, { runId: "run-other", pid: process.pid, acquiredAt: clock.iso() });
  assert.ok(readFileSync(store.paths.lock, "utf8").includes("run-mine"));

  // Own release.
  if (first.acquired) {
    await releaseRunLock(store, first.record);
    assert.throws(
      () => readFileSync(store.paths.lock, "utf8"),
      (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT",
      "lock.json removed by its owner",
    );
  }
});
