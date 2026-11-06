/**
 * T006 [P] — FAILING unit tests for the single-slot pending-job record
 * (data-model §2; contracts/queue-protocol.md §2). Module under test:
 * `src/queue/pending-job.ts` — readPendingJob / writePendingJob / mergePendingJob /
 * clearPendingJob, all through the frozen StateStore (temp+rename, 0o600).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, type ConfigOverrides } from "task-linear-sync/config";
import { createStateStore } from "task-linear-sync/state";

import {
  readPendingJob,
  writePendingJob,
  mergePendingJob,
  clearPendingJob,
  type PendingJob,
} from "../../src/queue/pending-job.js";
import { makeQueueHarness, writePendingJob as rawWrite, type QueueHarness } from "../helpers/queue-harness.js";

function jobDoc(over: Partial<PendingJob> = {}): PendingJob {
  return {
    schemaVersion: 1,
    jobId: "0123456789abcdef",
    mode: "bootstrap",
    trigger: "manual",
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    retryCount: 0,
    claim: null,
    ...over,
  };
}

async function withHarness(fn: (h: QueueHarness) => Promise<void>): Promise<void> {
  const h = await makeQueueHarness();
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}

test("write → read round-trips through the state store with owner-only mode", async () => {
  await withHarness(async (h) => {
    await writePendingJob(h.store, jobDoc());
    const r = await readPendingJob(h.store);
    assert.equal(r.corrupt, false);
    assert.deepEqual(r.job, jobDoc());
    const target = join(h.stateDir, "pending-job.json");
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(readdirSync(h.stateDir).filter((f) => f.startsWith("pending-job.json.tmp")).length, 0);
  });
});

test("concurrent writes keep exactly one valid file (atomic single-slot rename)", async () => {
  await withHarness(async (h) => {
    await Promise.all([
      writePendingJob(h.store, jobDoc({ jobId: "aaaaaaaaaaaaaaaa" })),
      writePendingJob(h.store, jobDoc({ jobId: "bbbbbbbbbbbbbbbb" })),
      writePendingJob(h.store, jobDoc({ jobId: "cccccccccccccccc" })),
    ]);
    const files = readdirSync(h.stateDir).filter((f) => f.startsWith("pending-job.json"));
    assert.equal(files.length, 1); // no temp residue, single slot
    const r = await readPendingJob(h.store);
    assert.equal(r.corrupt, false);
    assert.ok(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"].includes(r.job?.jobId ?? ""));
  });
});

test("corrupt bytes ⇒ { job: null, corrupt: true }; absent and zero-length ⇒ { job: null, corrupt: false }", async () => {
  await withHarness(async (h) => {
    // unparsable
    rawWrite(h.stateDir, "not json at all {{{");
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: true });
    // foreign schema version / missing required fields
    rawWrite(h.stateDir, JSON.stringify({ schemaVersion: 2, jobId: "x" }));
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: true });
    rawWrite(h.stateDir, JSON.stringify({ schemaVersion: 1, mode: "sync" })); // no jobId/enqueuedAt
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: true });
    // zero-length write
    rawWrite(h.stateDir, "");
    assert.equal(existsSync(join(h.stateDir, "pending-job.json")), true);
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: false });
    // absent
    rawWrite(h.stateDir, null);
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: false });
  });
});

test("merge over an existing record: keeps jobId/enqueuedAt, latest mode, retryCount 0, claim COPIED FORWARD", async () => {
  await withHarness(async (h) => {
    h.clock.advanceMs(0);
    const claimed: PendingJob = jobDoc({
      jobId: "jobjobjobjobjob1",
      mode: "bootstrap",
      enqueuedAt: "2025-12-31T23:00:00.000Z",
      updatedAt: "2025-12-31T23:00:00.000Z",
      retryCount: 3,
      claim: { workerId: "live-worker", pid: 4242, claimedAt: "2025-12-31T23:30:00.000Z" },
    });
    await writePendingJob(h.store, claimed);
    h.clock.advanceMs(60_000);

    const merged = await mergePendingJob(h.store, { mode: "sync", trigger: "pre-push" });
    assert.equal(merged.jobId, "jobjobjobjobjob1"); // preserved
    assert.equal(merged.enqueuedAt, "2025-12-31T23:00:00.000Z"); // FIRST trigger wins
    assert.equal(merged.mode, "sync"); // latest mode wins
    assert.equal(merged.trigger, "pre-push");
    assert.equal(merged.retryCount, 0); // fresh trigger restarts the budget
    assert.deepEqual(merged.claim, claimed.claim); // claim NEVER cleared (FR-003)
    assert.equal(merged.updatedAt, "2026-01-01T00:01:00.000Z"); // advanced by the injected clock (base 2026-01-01T00:00Z + 60s)
    assert.deepEqual((await readPendingJob(h.store)).job, merged);
  });
});

test("merge with no record (or a corrupt one) creates a fresh record", async () => {
  await withHarness(async (h) => {
    const fresh = await mergePendingJob(h.store, { mode: "bootstrap", trigger: "manual" });
    assert.match(fresh.jobId, /^[0-9a-f]{16}$/);
    assert.equal(fresh.mode, "bootstrap");
    assert.equal(fresh.retryCount, 0);
    assert.equal(fresh.claim, null);
    assert.equal(fresh.enqueuedAt, "2026-01-01T00:00:00.000Z"); // harness clock start

    // corrupt record is replaced (self-healing posture)
    rawWrite(h.stateDir, "{{{ broken");
    const healed = await mergePendingJob(h.store, { mode: "sync", trigger: "manual" });
    assert.notEqual(healed.jobId, fresh.jobId);
    assert.equal((await readPendingJob(h.store)).corrupt, false);
  });
});

test("clearPendingJob removes the slot; absent-clear is a no-op", async () => {
  await withHarness(async (h) => {
    await writePendingJob(h.store, jobDoc());
    await clearPendingJob(h.store);
    assert.equal(existsSync(join(h.stateDir, "pending-job.json")), false);
    await clearPendingJob(h.store); // idempotent
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: false });
  });
});

test("state path that is not a directory ⇒ write rejects (caller maps to refused)", async () => {
  const h = await makeQueueHarness();
  try {
    // A second store whose stateDirectory resolves onto a plain FILE (ENOTDIR lane).
    const blocker = join(h.root, "blocker-file");
    writeFileSync(blocker, "i am a file\n", "utf8");
    const foreignConfig = loadConfig({ overrides: { stateDirectory: blocker } as ConfigOverrides, env: {} });
    const foreignStore = createStateStore({ repositoryRoot: h.repositoryRoot, config: foreignConfig, clock: h.clock });
    await assert.rejects(() => writePendingJob(foreignStore, jobDoc()), (e: unknown) => {
      const code = (e as NodeJS.ErrnoException).code;
      return code === "ENOTDIR" || code === "EACCES";
    });
  } finally {
    h.dispose();
  }
});

test("record written by merge satisfies the data-model §2 shape invariants", async () => {
  await withHarness(async (h) => {
    const j = await mergePendingJob(h.store, { mode: "sync", trigger: "post-merge" });
    assert.equal(j.schemaVersion, 1);
    assert.equal(typeof j.jobId, "string");
    assert.equal(typeof j.enqueuedAt, "string");
    assert.ok(!Number.isNaN(Date.parse(j.enqueuedAt)));
    assert.ok(j.claim === null || (typeof j.claim.workerId === "string" && j.claim.pid > 0));
  });
});

test("readPendingJob rejects non-object JSON roots without crashing", async () => {
  await withHarness(async (h) => {
    rawWrite(h.stateDir, "[1,2,3]");
    assert.deepEqual(await readPendingJob(h.store), { job: null, corrupt: true });
  });
});
