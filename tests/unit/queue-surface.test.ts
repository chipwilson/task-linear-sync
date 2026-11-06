/**
 * T024 — FAILING unit tests for the 010 QueueSurface implementation (spec 010,
 * contracts/queue-surface-implementation.md). Module under test: `src/queue/surface.ts`
 * (barrel-re-exported from `src/queue/index.ts`, the lazy-import target of the frozen
 * CLI seam). Binding posture: the CLI calls `createQueueSurface()` with ZERO arguments;
 * tests pass wiring to observe the injected lanes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createQueueSurface } from "../../src/queue/index.js";
import type { QueueSurface } from "../../src/cli/queue-surface.js";
import { makeQueueHarness, readPendingJob, type QueueHarness } from "../helpers/queue-harness.js";
import { writeRunReports } from "../../src/state/marker.js";
import { makeScreener } from "../helpers/test-utils.js";

function surfaceFor(h: QueueHarness): QueueSurface {
  return createQueueSurface(h.wiring() as never);
}

test("binding: createQueueSurface() with ZERO args yields the full five-method seam", () => {
  const surface = createQueueSurface();
  for (const member of ["installHooks", "installAgentHook", "enqueue", "runWorker", "readLastRun"] as const) {
    assert.equal(typeof (surface as unknown as Record<string, unknown>)[member], "function", `surface.${member}`);
  }
});

test("enqueue over the surface writes the pending job, reports the jobId and spawns the worker", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await surfaceFor(h).enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "sync" });
    assert.equal(res.status, "enqueued");
    assert.match(res.jobId ?? "", /^[0-9a-f]{16}$/);

    const { job } = readPendingJob(h.stateDir);
    assert.ok(job);
    assert.equal(job.jobId, res.jobId);
    assert.equal(job.mode, "sync");
    assert.equal(job.trigger, "manual");

    assert.equal(h.spawns.length, 1, "the enqueue lane spawns the detached worker");
    assert.equal(h.spawns[0]?.repositoryRoot, h.repositoryRoot);
    assert.match(h.spawns[0]?.entry ?? "", /worker/);
  } finally {
    h.dispose();
  }
});

test("enqueue with invalid queue config is refused before any write", async () => {
  const h = await makeQueueHarness({ queue: { maxRetries: -5 } });
  try {
    const res = await surfaceFor(h).enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "sync" });
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /maxRetries/);
    assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false });
    assert.deepEqual(h.spawns, []);
  } finally {
    h.dispose();
  }
});

test("enqueue without a credential env var STILL enqueues, warning about the credential (FR-007 edge)", async () => {
  const h = await makeQueueHarness();
  try {
    h.withoutCredentials();
    const res = await surfaceFor(h).enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "sync" });
    assert.equal(res.status, "enqueued");
    assert.match(res.detail ?? "", /credential env 'LINEAR_ACCESS_TOKEN' is not set/);
    assert.notEqual(readPendingJob(h.stateDir).job, null);
  } finally {
    h.dispose();
  }
});

test("installHooks over the surface installs the configured managed set", async () => {
  const h = await makeQueueHarness({ config: { managedGitHooks: ["pre-push"] } });
  try {
    const res = await surfaceFor(h).installHooks({ repositoryRoot: h.repositoryRoot, config: h.config });
    assert.equal(res.status, "installed");
    assert.deepEqual(res.installed, ["pre-push"]);
    assert.ok(existsSync(join(h.repositoryRoot, ".git", "hooks", "pre-push")));
  } finally {
    h.dispose();
  }
});

test("installAgentHook over the surface writes the scaffold and refuses unknown frameworks", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await surfaceFor(h).installAgentHook({ repositoryRoot: h.repositoryRoot, config: h.config });
    assert.equal(res.status, "installed");
    assert.ok(res.path?.endsWith(join(".kiro", "hooks", "task-linear-sync-sync.json")));

    const bad = await surfaceFor(h).installAgentHook({
      repositoryRoot: h.repositoryRoot,
      config: h.config,
      frameworkId: "not-a-framework",
    });
    assert.equal(bad.status, "refused");
  } finally {
    h.dispose();
  }
});

test("runWorker once with an empty queue stops cleanly with zero residue", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await surfaceFor(h).runWorker({ repositoryRoot: h.repositoryRoot, config: h.config, once: true });
    assert.equal(res.status, "stopped");
    assert.equal(existsSync(join(h.stateDir, "queue-lock.json")), false, "the lock is released after the pass");
    assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false });
  } finally {
    h.dispose();
  }
});

test("readLastRun serves the frozen marker (found / not-found)", async () => {
  const h = await makeQueueHarness();
  try {
    const surface = surfaceFor(h);
    assert.deepEqual(await surface.readLastRun({ state: h.store }), { found: false });

    await writeRunReports(
      h.store,
      "e".repeat(64),
      { json: { ok: true }, markdown: "# report\n" },
      makeScreener() as never,
      { runId: "e".repeat(64), outcome: "completed", notificationSuppressed: false },
    );
    const res = await surface.readLastRun({ state: h.store });
    assert.equal(res.found, true);
    assert.equal(res.marker?.outcome, "completed");
  } finally {
    h.dispose();
  }
});

test("a broken wiring member is refused, never thrown", async () => {
  const h = await makeQueueHarness();
  try {
    const surface = createQueueSurface({ ...h.wiring(), sleep: "not-a-function" } as never);
    const res = await surface.enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "sync" });
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /wiring|sleep/);
  } finally {
    h.dispose();
  }
});
