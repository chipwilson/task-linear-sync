/**
 * T010 [P] — FAILING unit tests for the lock-free enqueue fast path (FR-001, FR-007,
 * FR-008; contracts/queue-protocol.md §2; research R4/R6). Module under test:
 * `src/queue/enqueue.ts` — enqueueJob(store, settings, input, deps).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob, type EnqueueResult } from "../../src/queue/enqueue.js";
import { resolveQueueConfig } from "../../src/queue/config.js";
import { makeQueueHarness, readPendingJob, type QueueHarness, type SpawnCall } from "../helpers/queue-harness.js";

async function withHarness(
  fn: (h: QueueHarness, settings: ReturnType<typeof settingsOk>) => Promise<void>,
): Promise<void> {
  const h = await makeQueueHarness();
  try {
    await fn(h, settingsOk(h));
  } finally {
    h.dispose();
  }
}

function settingsOk(h: QueueHarness): Extract<ReturnType<typeof resolveQueueConfig>, { ok: true }>["settings"] {
  const r = resolveQueueConfig(h.config);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.settings;
}

function deps(h: QueueHarness, spawnWorker?: (o: SpawnCall) => void) {
  return {
    clock: h.clock,
    env: h.env,
    workerId: h.workerId,
    spawnWorker:
      spawnWorker ??
      ((o: SpawnCall): void => {
        h.spawns.push(o);
      }),
    rng: h.rng,
  };
}

test("enqueue is durable and visible within the 500 ms write budget (virtual clock), never touching the queue lock", async () => {
  await withHarness(async (h, settings) => {
    const res = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h));
    assert.equal(res.status, "enqueued");
    assert.match(res.jobId ?? "", /^[0-9a-f]{16}$/);
    const r = readPendingJob(h.stateDir);
    assert.equal(r.corrupt, false);
    assert.equal(r.job?.jobId, res.jobId);
    assert.equal(r.job?.mode, "sync");
    assert.equal(r.job?.retryCount, 0);
    assert.equal(r.job?.claim, null);
    const budgetMs = Date.parse(r.job?.updatedAt ?? "") - Date.parse(r.job?.enqueuedAt ?? "");
    assert.ok(budgetMs <= 500, `virtual write budget blown: ${budgetMs}ms`);
    // FR-002 scope: enqueue NEVER takes the queue lock
    assert.equal(existsSync(join(h.stateDir, "queue-lock.json")), false);
  });
});

test("spawnWorker is called exactly once and only AFTER the job is durable", async () => {
  await withHarness(async (h, settings) => {
    let durableAtSpawn = false;
    const res = await enqueueJob(
      h.store,
      settings,
      { repositoryRoot: h.repositoryRoot, mode: "bootstrap", trigger: "pre-push" },
      deps(h, (o) => {
        h.spawns.push(o); // keep the recorder happy: the override replaces the default push
        durableAtSpawn = readPendingJob(h.stateDir).job !== null; // observed from inside the spawn
      }),
    );
    assert.equal(res.status, "enqueued");
    assert.equal(h.spawns.length, 1);
    assert.equal(durableAtSpawn, true);
  });
});

test("spawn failure degrades loudly but the enqueue STILL reports success (job stays)", async () => {
  await withHarness(async (h, settings) => {
    const res: EnqueueResult = await enqueueJob(
      h.store,
      settings,
      { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" },
      deps(h, () => {
        throw new Error("posix_spawn refused");
      }),
    );
    assert.equal(res.status, "enqueued");
    assert.match([res.detail ?? "", ...(res.warnings ?? [])].join(" "), /worker did not start/i);
    assert.notEqual(readPendingJob(h.stateDir).job, null); // job stays for the next trigger
  });
});

test("second enqueue merges: same jobId + enqueuedAt, latest mode, exactly one file", async () => {
  await withHarness(async (h, settings) => {
    const first = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "bootstrap", trigger: "manual" }, deps(h));
    h.clock.advanceMs(5_000);
    const second = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "post-merge" }, deps(h));
    assert.equal(second.status, "enqueued");
    assert.equal(second.jobId, first.jobId); // coalesced
    const pending = readPendingJob(h.stateDir);
    assert.equal(pending.job?.enqueuedAt, "2026-01-01T00:00:00.000Z"); // first trigger preserved
    assert.equal(pending.job?.mode, "sync"); // latest wins
    const files = readdirSync(h.stateDir).filter((f) => f.startsWith("pending-job.json"));
    assert.equal(files.length, 1);
  });
});

test("100 concurrent enqueues coalesce to ONE pending job (SC-002 merge discipline)", async () => {
  await withHarness(async (h, settings) => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_unused, i) =>
        enqueueJob(
          h.store,
          settings,
          { repositoryRoot: h.repositoryRoot, mode: i % 2 === 0 ? "bootstrap" : "sync", trigger: "manual" },
          deps(h),
        ),
      ),
    );
    assert.ok(results.every((r) => r.status === "enqueued"));
    const jobIds = new Set(results.map((r) => r.jobId));
    assert.equal(jobIds.size, 1); // ONE job id for the storm
    assert.equal(readPendingJob(h.stateDir).job?.jobId, [...jobIds][0]);
  });
});

test("credential env absent ⇒ STILL enqueues with the credentials warning naming the env var", async () => {
  await withHarness(async (h, settings) => {
    h.withoutCredentials();
    const res = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h));
    assert.equal(res.status, "enqueued");
    const text = [res.detail ?? "", ...(res.warnings ?? [])].join(" ");
    assert.match(text, /credential env 'LINEAR_ACCESS_TOKEN' is not set/);
    assert.notEqual(readPendingJob(h.stateDir).job, null);
  });
});

test("slot unwritable (frozen store self-heals dir modes) ⇒ skipped with a sanitized detail, never a throw", async () => {
  await withHarness(async (h, settings) => {
    // the frozen atomicWrite self-heals a read-only dir (ensurePrivateDir chmods 0700),
    // so force the fs failure on the target itself: a directory cannot be renamed over.
    mkdirSync(join(h.stateDir, "pending-job.json"), { recursive: true });
    const res = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h));
    assert.equal(res.status, "skipped", "protocol §2.5: unexpected fs failure ⇒ skipped (hook stays silent-green)");
    assert.match(res.detail ?? "", /pending-job|state/i);
  });
});

test("invalid queue settings ⇒ refused with ALL bad fields in ONE detail line before any write", async () => {
  const h = await makeQueueHarness({ queue: { maxRetries: 0, workerDelaySeconds: -1 } });
  try {
    const r = resolveQueueConfig(h.config);
    assert.equal(r.ok, false);
    if (r.ok) return;
    const res = await enqueueJob(h.store, r.settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h)).catch(
      (e: unknown) => e,
    );
    // settings for the invalid case are supplied via the raw config path inside enqueueJob:
    assert.equal((res as EnqueueResult).status, "refused");
    const detail = (res as EnqueueResult).detail ?? "";
    assert.match(detail, /queue\.maxRetries/);
    assert.match(detail, /queue\.workerDelaySeconds/);
    assert.ok(!detail.includes("\n"));
    assert.equal(existsSync(join(h.stateDir, "pending-job.json")), false);
  } finally {
    h.dispose();
  }
});

test("corrupt pending record is replaced by a fresh one with a sanitized warning (self-healing)", async () => {
  await withHarness(async (h, settings) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(h.stateDir, "pending-job.json"), "### not json", "utf8");
    const res = await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h));
    assert.equal(res.status, "enqueued");
    assert.match([res.detail ?? "", ...(res.warnings ?? [])].join(" "), /replaced|corrupt/i);
    assert.equal(readPendingJob(h.stateDir).corrupt, false);
    assert.ok(readFileSync(join(h.stateDir, "pending-job.json"), "utf8").includes('"schemaVersion":1'));
  });
});

test("spawn hand-off carries the queue-protocol §5 options (entry path + repository root)", async () => {
  await withHarness(async (h, settings) => {
    await enqueueJob(h.store, settings, { repositoryRoot: h.repositoryRoot, mode: "sync", trigger: "manual" }, deps(h));
    const call = h.spawns[0] as SpawnCall;
    assert.equal(call.repositoryRoot, h.repositoryRoot);
    assert.match(call.entry, /worker-entry\.js$/);
    assert.equal(call.detached, true);
  });
});
