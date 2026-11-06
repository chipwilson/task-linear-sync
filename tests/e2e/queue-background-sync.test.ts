/**
 * T028 — End-to-end background sync over the 007/008 fake-port world (spec 010 US1+US4,
 * quickstart §8): the queue drives the FROZEN engine through `runEnginePass` with the
 * harness's fake port injected, so the whole happy path — enqueue → drain → apply →
 * marker → ONE notification — runs hermetically with zero real network. A second lane
 * proves the retry ladder (transient failures re-queue without notifying; the retry
 * limit consumes the job with a terminal report and exactly one failure notification),
 * and a third shows the queue self-recovers after a terminal outcome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConfigOverrides } from "task-linear-sync/config";
import { readLastRunMarker } from "../../src/state/marker.js";
import {
  mergePendingJob,
  newCorrelationRunId,
  readPendingJob,
  resolveQueueConfig,
  runDrainOnce,
  runEnginePass,
  type EnginePassResult,
  type Notifier,
  type QueueClock,
  type QueueSettings,
} from "../../src/queue/index.js";
import { buildWorld, type EngineWorld } from "../helpers/engine-harness.js";

function settingsOf(w: EngineWorld): QueueSettings {
  const resolved = resolveQueueConfig(w.config);
  if (!resolved.ok) throw new Error(resolved.errors.join("; "));
  return resolved.settings;
}

/** Fake port lane: the queue's engine pass runs the frozen pipeline over `world.deps`. */
function fakePortApply(w: EngineWorld, settings: QueueSettings) {
  return (job?: { mode?: "bootstrap" | "sync" }): Promise<EnginePassResult> =>
    runEnginePass(
      w.state,
      settings,
      { repositoryRoot: w.repositoryRoot, mode: job?.mode ?? "sync", env: w.env },
      { deps: w.deps, keyProvider: w.keyProvider },
    );
}

function recordingNotifier(): { notifier: Notifier; calls: { title: string; body: string }[] } {
  const calls: { title: string; body: string }[] = [];
  return {
    calls,
    notifier: {
      async notify(o: { title: string; body: string }) {
        calls.push(o);
        return "delivered";
      },
    },
  };
}

function drainDeps(
  w: EngineWorld,
  workerId: string,
  runApply: (job?: { mode?: "bootstrap" | "sync" }) => Promise<EnginePassResult>,
  notifier?: Notifier,
) {
  return {
    workerId,
    pid: process.pid,
    clock: w.clock as unknown as QueueClock,
    runApply,
    ...(notifier !== undefined ? { notifier } : {}),
  };
}

test("happy path: one drain applies through the frozen engine, clears the slot, marks completed and notifies exactly once", async () => {
  // The rollback-full plan carries a low-confidence entry; the queue honors ONLY the
  // explicit `queue.autoAcceptLowConfidence` widening (FR-005 — default false is asserted
  // by the refusal lane below).
  const w = await buildWorld("rollback-full", {
    config: { queue: { autoAcceptLowConfidence: true } } as unknown as ConfigOverrides,
  });
  const rec = recordingNotifier();
  try {
    const settings = settingsOf(w);
    const job = await mergePendingJob(w.state, { mode: "sync", trigger: "post-commit" });
    assert.equal(job.retryCount, 0);

    const result = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker", fakePortApply(w, settings), rec.notifier));
    assert.equal(result.status, "applied", `drain detail: ${result.detail}`);

    // The slot is consumed and the drain lock released.
    assert.equal((await readPendingJob(w.state)).job, null, "an applied pass clears the queue");
    assert.ok(!existsSync(join(w.stateDir, "queue-lock.json")));

    // The frozen marker records the engine run (outcome name is the frozen "completed").
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker !== null);
    assert.equal(marker.outcome, "completed");
    assert.equal(marker.notificationSuppressed, false);
    assert.ok(marker.reportPaths !== null);

    // Exactly one completion notification (FR-020), naming the tool and the outcome.
    assert.equal(rec.calls.length, 1);
    assert.match(rec.calls[0]!.title, /sync completed/);

    // The mutation really happened on the fake port — and a second (empty) drain adds nothing.
    const requestsAfterApply = w.requests().length;
    assert.ok(requestsAfterApply > 0, "the applied pass talked to the (fake) tracker");
    assert.ok(w.calls.some((c) => c.method === "createIssue" || c.method === "updateIssue"), "an operation reached the port");
    const again = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker", fakePortApply(w, settings), rec.notifier));
    assert.equal(again.status, "empty");
    assert.equal(w.requests().length, requestsAfterApply, "an empty drain never touches the tracker");
    assert.equal(rec.calls.length, 1, "an empty drain never notifies");
  } finally {
    await w.dispose();
  }
});

test("default posture never auto-accepts low confidence: the drain refuses terminally, consumes the job and notifies once (FR-005, SC-005)", async () => {
  const w = await buildWorld("rollback-full");
  const rec = recordingNotifier();
  try {
    const settings = settingsOf(w);
    assert.equal(settings.autoAcceptLowConfidence, false, "the queue default is never broader than the interactive lane");
    const job = await mergePendingJob(w.state, { mode: "sync", trigger: "post-commit" });

    const result = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker", fakePortApply(w, settings), rec.notifier));
    assert.equal(result.status, "terminal-refused", `detail: ${result.detail}`);

    // A retry would hit the identical gate: the slot is consumed, one failure notification.
    assert.equal((await readPendingJob(w.state)).job, null);
    assert.equal(rec.calls.length, 1);
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker !== null);
    assert.equal(marker.outcome, "failed");
    const report = JSON.parse(readFileSync(marker.reportPaths!.json, "utf8")) as { kind: string; jobId: string; error?: { code?: string } };
    assert.equal(report.kind, "queue-terminal");
    assert.equal(report.jobId, job.jobId);
    assert.equal(report.error?.code, "LOW_CONFIDENCE_NOT_ACCEPTED");
  } finally {
    await w.dispose();
  }
});

test("retry ladder: transient failures re-queue silently; the retry limit consumes the job with one failure notification", async () => {
  const w = await buildWorld("rollback-full", { config: { queue: { maxRetries: 2 } } as unknown as ConfigOverrides });
  const rec = recordingNotifier();
  try {
    const settings = settingsOf(w);
    assert.equal(settings.maxRetries, 2, "the injected queue group must win");
    const job = await mergePendingJob(w.state, { mode: "sync", trigger: "manual" });

    const failing = async (): Promise<EnginePassResult> => ({
      status: "failed",
      runId: newCorrelationRunId(),
      error: "transient tracker outage (test lane)",
    });

    // Attempts 1 and 2 re-queue without consuming the job and WITHOUT notifying.
    for (const expectedRetry of [1, 2]) {
      const r = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker", failing, rec.notifier));
      assert.equal(r.status, "retried", `attempt ${expectedRetry} must re-queue (detail: ${r.detail})`);
      const current = (await readPendingJob(w.state)).job;
      assert.ok(current !== null);
      assert.equal(current.jobId, job.jobId);
      assert.equal(current.retryCount, expectedRetry);
      assert.equal(current.claim, null, "a re-queue must not leave a claim behind");
      assert.equal(rec.calls.length, 0, "retryable failures never notify (FR-020)");
    }

    // Attempt 3 exceeds maxRetries=2: terminal consumption + one failure notification.
    const terminal = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker", failing, rec.notifier));
    assert.equal(terminal.status, "retry-limit");
    assert.match(terminal.detail ?? "", /giving up after 3 attempts \(RETRY_LIMIT\)/);
    assert.equal((await readPendingJob(w.state)).job, null, "the terminal outcome consumes the slot");

    const marker = await readLastRunMarker(w.state);
    assert.ok(marker !== null);
    assert.equal(marker.outcome, "failed");
    assert.equal(marker.notificationSuppressed, false);
    const report = JSON.parse(readFileSync(marker.reportPaths!.json, "utf8")) as {
      kind: string;
      jobId: string;
      error?: { code?: string };
    };
    assert.equal(report.kind, "queue-terminal");
    assert.equal(report.jobId, job.jobId);
    assert.equal(report.error?.code, "RETRY_LIMIT");

    assert.equal(rec.calls.length, 1, "only the terminal outcome notifies");
    assert.match(rec.calls[0]!.title, /sync failed/);
    // The injected failure lane never touched the tracker (no engine ran).
    assert.equal(w.requests().length, 0);
  } finally {
    await w.dispose();
  }
});

test("the queue self-recovers after a terminal failure — a fresh enqueue drains normally", async () => {
  const w = await buildWorld("rollback-full", {
    config: { queue: { maxRetries: 1, autoAcceptLowConfidence: true } } as unknown as ConfigOverrides,
  });
  const rec = recordingNotifier();
  try {
    const settings = settingsOf(w);
    const failing = async (): Promise<EnginePassResult> => ({ status: "failed", runId: newCorrelationRunId(), error: "storm (test lane)" });
    await mergePendingJob(w.state, { mode: "sync", trigger: "manual" });
    assert.equal((await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker-1", failing, rec.notifier))).status, "retried");
    assert.equal((await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker-1", failing, rec.notifier))).status, "retry-limit");
    assert.equal(rec.calls.length, 1);

    // A new trigger re-arms the single slot; the next drain applies through the engine.
    const fresh = await mergePendingJob(w.state, { mode: "sync", trigger: "post-commit" });
    assert.notEqual(fresh.jobId, undefined);
    const applied = await runDrainOnce(w.state, settings, drainDeps(w, "e2e-worker-2", fakePortApply(w, settings), rec.notifier));
    assert.equal(applied.status, "applied", `recovery drain detail: ${applied.detail}`);
    assert.equal((await readPendingJob(w.state)).job, null);
    assert.equal(rec.calls.length, 2, "the recovery completion adds exactly one notification");
  } finally {
    await w.dispose();
  }
});
