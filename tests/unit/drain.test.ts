/**
 * T012 — FAILING unit tests for the drain cycle (spec 010, FR-011..FR-014,
 * data-model.md §5 DrainClass). Module under test: `src/queue/drain.ts` —
 * runDrainOnce / startClaimHeartbeat. The classification table is asserted through
 * observable state: the pending job (consumed / re-queued / untouched / repaired),
 * the marker+report for the pass, and the returned status. `runApply` is the
 * engine-pass port; the real pass is covered by the integration tests (T027+).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveQueueConfig } from "../../src/queue/config.js";
import { runDrainOnce, startClaimHeartbeat, type DrainResult, type EnginePassResult } from "../../src/queue/drain.js";
import { acquireQueueLock, releaseQueueLock } from "../../src/queue/queue-lock.js";
import type { QueueSettings } from "../../src/queue/types.js";
import {
  makeQueueHarness,
  readPendingJob,
  writePendingJob,
  type PendingJobRecord,
  type QueueHarness,
} from "../helpers/queue-harness.js";

const RUN_ID = "c".repeat(64);

function settingsOk(h: QueueHarness): QueueSettings {
  const r = resolveQueueConfig(h.config);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.settings;
}

async function withHarness(
  fn: (h: QueueHarness, settings: QueueSettings) => Promise<void>,
  options: Parameters<typeof makeQueueHarness>[0] = {},
): Promise<void> {
  const h = await makeQueueHarness(options);
  try {
    await fn(h, settingsOk(h));
  } finally {
    h.dispose();
  }
}

function seedJob(h: QueueHarness, overrides: Partial<PendingJobRecord> = {}): PendingJobRecord {
  return {
    schemaVersion: 1,
    jobId: "a".repeat(16),
    mode: "sync",
    trigger: "hook",
    enqueuedAt: h.clock.iso(),
    updatedAt: h.clock.iso(),
    retryCount: 0,
    claim: null,
    ...overrides,
  };
}

function pass(status: EnginePassResult["status"], extra: Partial<EnginePassResult> = {}): EnginePassResult {
  return { status, runId: RUN_ID, detail: "pass detail", ...extra };
}

function drain(
  h: QueueHarness,
  settings: QueueSettings,
  apply: () => Promise<EnginePassResult>,
): Promise<DrainResult> {
  return runDrainOnce(h.store, settings, {
    workerId: h.workerId,
    pid: process.pid,
    clock: h.clock,
    sleep: h.sleep,
    rng: h.rng,
    runApply: apply,
  });
}

test("drain: applied pass consumes the job", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h, { mode: "sync" }));

    const result = await drain(h, settings, async () => pass("applied"));
    assert.equal(result.status, "applied");
    assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false }, "the consumed job is gone");
  });
});

test("drain: no job is a no-op pass", async () => {
  await withHarness(async (h, settings) => {
    let called = 0;
    const result = await drain(h, settings, async () => {
      called += 1;
      return pass("applied");
    });
    assert.equal(result.status, "empty");
    assert.equal(called, 0, "nothing to run with");
  });
});

test("drain: LOCK_HELD refusal re-queues without a retry increment (report-only, aborted marker)", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h));

    const result = await drain(h, settings, async () =>
      pass("refused", { failureCode: "LOCK_HELD", detail: "sync state lock held by another process" }),
    );
    assert.equal(result.status, "deferred");

    const { job } = readPendingJob(h.stateDir);
    assert.ok(job);
    assert.equal(job.jobId, "a".repeat(16));
    assert.equal(job.retryCount, 0, "no retry storm: the retry count is not incremented");
    assert.equal(job.claim, null, "the re-queued job is unclaimed");

    const marker = await h.store.readJson<{ outcome: string; reportPaths: { json: string } }>("last-run.json");
    assert.ok(marker);
    assert.equal(marker.outcome, "aborted");
    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as Record<string, unknown>;
    assert.equal(doc.outcome, "aborted");
    assert.equal(doc.jobId, "a".repeat(16));
  });
});

test("drain: a non-lock refusal is terminal — the job is consumed with a failed marker", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h, { jobId: "b".repeat(16), mode: "bootstrap" }));

    const result = await drain(h, settings, async () =>
      pass("refused", { failureCode: "LOW_CONFIDENCE_NOT_ACCEPTED", detail: "low-confidence changes need --yes" }),
    );
    assert.equal(result.status, "terminal-refused");
    assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false }, "an identical retry would fail identically");

    const marker = await h.store.readJson<{ outcome: string; reportPaths: { json: string } }>("last-run.json");
    assert.ok(marker);
    assert.equal(marker.outcome, "failed");
    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as {
      mode: string;
      jobId: string;
      error: { code: string };
    };
    assert.equal(doc.mode, "bootstrap");
    assert.equal(doc.jobId, "b".repeat(16));
    assert.equal(doc.error.code, "LOW_CONFIDENCE_NOT_ACCEPTED");
  });
});

test("drain: a failed pass re-queues with an incremented retry count", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h));

    const result = await drain(h, settings, async () => pass("failed", { error: "Linear API request failed" }));
    assert.equal(result.status, "retried");

    const { job } = readPendingJob(h.stateDir);
    assert.ok(job);
    assert.equal(job.retryCount, 1);
    assert.equal(job.claim, null);
  });
});

test("drain: exceeding max retries is terminal with a RETRY_LIMIT failed marker", async () => {
  await withHarness(
    async (h, settings) => {
      writePendingJob(h.stateDir, seedJob(h, { retryCount: 1 }));

      const result = await drain(h, settings, async () => pass("failed", { error: "Linear API request failed" }));
      assert.equal(result.status, "retry-limit");
      assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false });

      const marker = await h.store.readJson<{ outcome: string; reportPaths: { json: string } }>("last-run.json");
      assert.ok(marker);
      assert.equal(marker.outcome, "failed");
      const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as {
        error: { code: string; message: string };
        jobId: string;
      };
      assert.match(doc.error.message, /giving up after 2 attempts/i);
      assert.equal(doc.error.code, "RETRY_LIMIT");
      assert.equal(doc.jobId, "a".repeat(16));
    },
    { queue: { maxRetries: 1 } },
  );
});

test("drain: a fresh foreign claim is skipped without touching the job", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(
      h.stateDir,
      seedJob(h, { claim: { workerId: "other-worker", pid: process.pid, claimedAt: h.clock.iso() } }),
    );

    let called = 0;
    const result = await drain(h, settings, async () => {
      called += 1;
      return pass("applied");
    });
    assert.equal(result.status, "stopped");
    assert.match(result.detail ?? "", /claim/i);
    assert.equal(called, 0, "no second worker applies while another live worker holds the claim");

    const { job } = readPendingJob(h.stateDir);
    assert.ok(job?.claim);
    assert.equal(job.claim.workerId, "other-worker");
    assert.equal(job.retryCount, 0);
  });
});

test("drain: an abandoned claim older than the claim timeout is reclaimed", async () => {
  await withHarness(
    async (h, settings) => {
      const stale = new Date(Date.parse(h.clock.iso()) - 301_000).toISOString();
      writePendingJob(h.stateDir, seedJob(h, { claim: { workerId: "exited-worker", pid: 99, claimedAt: stale } }));

      const result = await drain(h, settings, async () => pass("applied"));
      assert.equal(result.status, "applied");
      assert.deepEqual(readPendingJob(h.stateDir), { job: null, corrupt: false }, "the reclaimed pass ran to completion");
    },
  );
});

test("drain: queue-lock timeout stops the pass and writes a lock-failure report (outcome aborted)", async () => {
  await withHarness(
    async (h, settings) => {
      writePendingJob(h.stateDir, seedJob(h));
      // Foreign holder with our own live pid ⇒ provably alive, never taken over.
      const holder = await acquireQueueLock(h.store, {
        workerId: "other-worker",
        pid: process.pid,
        clock: h.clock,
        sleep: h.sleep,
        rng: h.rng,
        timeoutSeconds: 1,
      });
      assert.equal(holder.acquired, true);

      let called = 0;
      const result = await drain(h, settings, async () => {
        called += 1;
        return pass("applied");
      });
      assert.equal(result.status, "stopped");
      assert.match(result.detail ?? "", /lock/i);
      assert.equal(called, 0, "no pass runs while the queue lock is held");

      const { job } = readPendingJob(h.stateDir);
      assert.ok(job, "the job is untouched");
      assert.equal(job.retryCount, 0);
      assert.equal(job.claim, null);

      const marker = await h.store.readJson<{ outcome: string }>("last-run.json");
      assert.ok(marker, "the giving-up cycle emits its report");
      assert.equal(marker.outcome, "aborted");

      assert.equal(await releaseQueueLock(h.store, holder.token!), true);
    },
    { queue: { lockTimeoutSeconds: 1 } },
  );
});

test("drain: claim lost during a terminal mutation abandons the mutation", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h));

    const result = await drain(h, settings, async () => {
      // Mid-pass a rival rewrites the job with its own claim.
      writePendingJob(
        h.stateDir,
        seedJob(h, { claim: { workerId: "rival", pid: process.pid, claimedAt: h.clock.iso() } }),
      );
      return pass("applied");
    });
    assert.equal(result.status, "stopped");
    assert.match(result.detail ?? "", /claim/i);

    const { job } = readPendingJob(h.stateDir);
    assert.equal(job?.claim?.workerId, "rival", "the rival's job survives our abandoned mutation");
  });
});

test("drain: the job vanishing mid-pass is handled without a crash", async () => {
  await withHarness(async (h, settings) => {
    writePendingJob(h.stateDir, seedJob(h));

    const result = await drain(h, settings, async () => {
      writePendingJob(h.stateDir, null);
      return pass("applied");
    });
    assert.equal(result.status, "stopped");
  });
});

test("heartbeat: the claim is refreshed on the configured interval until stopped", async () => {
  await withHarness(
    async (h, settings) => {
      const claimedAt = new Date(Date.parse(h.clock.iso()) - 1000).toISOString();
      writePendingJob(h.stateDir, seedJob(h, { claim: { workerId: h.workerId, pid: process.pid, claimedAt } }));

      let beats = 0;
      let stopped = false;
      const handle = startClaimHeartbeat(h.store, settings, {
        workerId: h.workerId,
        pid: process.pid,
        clock: h.clock,
        sleep: async (ms: number) => {
          h.clock.advanceMs(ms);
          beats += 1;
          if (beats >= 2) stopped = true;
        },
        isStopped: () => stopped,
      });

      // Drive the (synchronously advancing) fake sleep loop to completion. Once the
      // second beat is observed the first refresh write has necessarily landed (the
      // loop awaits read+claim between beats), so `beats >= 2` is the real exit.
      // Under parallel-suite load the fs promises between beats can lag behind a
      // pure setImmediate pump, so escalate to short timed yields after 25 spins
      // (bounded, generous; assertions stay time-independent).
      let spins = 0;
      while (beats < 2 && spins < 100) {
        spins += 1;
        await new Promise<void>((resolve) => (spins > 25 ? setTimeout(resolve, 2) : setImmediate(resolve)));
      }

      const { job } = readPendingJob(h.stateDir);
      assert.ok(job?.claim);
      assert.ok(
        Date.parse(job.claim.claimedAt) > Date.parse(claimedAt),
        "claimedAt moved forward so a long apply pass is not mistaken for an abandoned claim",
      );
      assert.equal(job.claim.workerId, h.workerId, "the heartbeat never touches another worker's claim");
      stopped = true;
      handle.stop();
    },
    { config: { worker: { claimTimeoutSeconds: 3 } } },
  );
});
