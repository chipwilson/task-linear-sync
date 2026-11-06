/**
 * T030 [P] [US2] — Storm and claim-recovery integration (spec 010 US2; quickstart §2.2,
 * §8 SC-002 row; queue-protocol §2/§4). Proves: a 100-trigger storm coalesces into ONE
 * pending slot (in-process mutex AND cross-process atomic rename), a LIVE foreign claim
 * stops a concurrent worker without touching the job (FR-003), and an ABANDONED claim
 * (older than `worker.claimTimeoutSeconds`) is reclaimed rather than stalling forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createQueueSurface, type QueueWiring } from "../../src/queue/surface.js";
import { resolveQueueConfig } from "../../src/queue/config.js";
import { readPendingJob, runDrainOnce, type EnginePassResult, type PendingJob } from "../../src/queue/index.js";
import { makeQueueHarness, writePendingJob } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function makeCliSandbox(): { bin: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
  cpSync(join(pkgRoot, "package.json"), join(root, "package.json"));
  rmSync(join(dist, "queue", "worker-entry.js"), { force: true }); // storms must not drain in the background
  return { bin: join(dist, "cli", "main.js"), dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }) };
}

function seedJob(stateDir: string, over: Partial<import("../helpers/queue-harness.js").PendingJobRecord> = {}): void {
  writePendingJob(stateDir, {
    schemaVersion: 1,
    jobId: "aabbccddeeff0011",
    mode: "sync",
    trigger: "post-commit",
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    retryCount: 0,
    claim: null,
    ...over,
  });
}

const appliedPass: EnginePassResult = { status: "applied", runId: "f".repeat(64), detail: "applied 1 operations (0 skipped, 0 failed)" };

test("100 concurrent in-process enqueues produce exactly ONE pending job with ONE identity (SC-002)", async () => {
  const h = await makeQueueHarness();
  try {
    const surface = createQueueSurface(h.wiring() as unknown as QueueWiring);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        surface.enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: i % 2 === 0 ? "sync" : "bootstrap" }),
      ),
    );
    assert.ok(results.every((r) => r.status === "enqueued" && r.jobId !== undefined), "every trigger reports enqueued");
    const ids = new Set(results.map((r) => r.jobId));
    assert.equal(ids.size, 1, `the storm coalesces to one id, saw ${ids.size}: ${[...ids].join(", ")}`);

    const files = readdirSync(h.stateDir).filter((f) => f === "pending-job.json");
    assert.equal(files.length, 1);
    const raw = readFileSync(join(h.stateDir, "pending-job.json"), "utf8");
    assert.equal((raw.match(/"claim":/g) ?? []).length, 1, 'exactly ONE "claim": occurrence in the record');
    const job = (await readPendingJob(h.store)).job;
    assert.ok(job !== null);
    assert.equal(job.jobId, [...ids][0]);
    assert.ok(["sync", "bootstrap"].includes(job.mode));
  } finally {
    h.dispose();
  }
});

test("100 backgrounded spawned enqueues keep exactly one pending file on disk (SC-002 cross-process)", async () => {
  const cli = makeCliSandbox();
  const h = await makeQueueHarness({ world: join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report") });
  try {
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      TASK_LINEAR_SYNC_TEST_NOTIFY: h.notifySinkPath,
      LINEAR_ACCESS_TOKEN: "storm-dummy-token-000000000000",
    };
    // 100 backgrounded calls, concurrency-capped (sandbox memory) — still a real storm:
    // dozens of processes merge-against the same slot at any instant.
    const CONCURRENCY = 25;
    const fire = (): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [cli.bin, "enqueue"], { cwd: h.repositoryRoot, env, stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? -1));
      });
    const pending = Array.from({ length: 100 }, (_, i) => i);
    const codes: number[] = [];
    const pool = Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const next = pending.shift();
        if (next === undefined) return;
        codes.push(await fire());
      }
    });
    await Promise.all(pool);
    assert.ok(codes.every((c) => c === 0), `all 100 enqueues exit 0, saw: ${codes.filter((c) => c !== 0).join(",")}`);
    const jobs = readdirSync(h.stateDir).filter((f) => f.startsWith("pending-job"));
    assert.equal(jobs.length, 1, "exactly one pending file survives the storm");
    const raw = readFileSync(join(h.stateDir, "pending-job.json"), "utf8");
    assert.equal((raw.match(/"claim":/g) ?? []).length, 1);
    assert.match(JSON.parse(raw).jobId, /^[0-9a-f]{16}$/);
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("a LIVE foreign claim makes `worker --once` stop without touching the job (FR-003)", async () => {
  const h = await makeQueueHarness();
  try {
    seedJob(h.stateDir, {
      claim: { workerId: "keeper", pid: process.pid, claimedAt: h.clock.now().toISOString() },
    });
    const before = readFileSync(join(h.stateDir, "pending-job.json"), "utf8");
    let runApplyCalled = false;

    // The drain cycle is the worker's per-pass discipline; a tripwire runApply proves
    // the engine pass must never start against a live foreign claim (FR-003).
    const resolved = resolveQueueConfig(h.config);
    assert.ok(resolved.ok);
    const drain = await runDrainOnce(h.store, resolved.settings, {
      workerId: "contender",
      pid: process.pid + 1,
      clock: h.clock,
      sleep: h.sleep,
      runApply: async () => {
        runApplyCalled = true;
        return appliedPass;
      },
    });
    assert.equal(drain.status, "stopped");
    assert.match(drain.detail ?? "", /live claim by worker keeper/);
    assert.equal(runApplyCalled, false, "a live claim must never start an engine pass");
    assert.equal(readFileSync(join(h.stateDir, "pending-job.json"), "utf8"), before, "the record stays byte-identical");
  } finally {
    h.dispose();
  }
});

test("an abandoned claim (older than claimTimeoutSeconds) is reclaimed, not waited on", async () => {
  const h = await makeQueueHarness();
  try {
    seedJob(h.stateDir, {
      claim: { workerId: "ghost", pid: 999_999, claimedAt: "2025-12-31T23:45:00.000Z" }, // -900 s vs harness clock base
    });
    const resolved = resolveQueueConfig(h.config);
    assert.ok(resolved.ok);
    const seen: PendingJob[] = [];
    const drain = await runDrainOnce(h.store, resolved.settings, {
      workerId: "reclaimer",
      pid: process.pid,
      clock: h.clock,
      sleep: h.sleep,
      runApply: async (job) => {
        seen.push(job!);
        return appliedPass;
      },
    });
    assert.equal(drain.status, "applied", `abandoned claims must be reclaimed (detail: ${drain.detail})`);
    assert.equal(seen[0]?.jobId, "aabbccddeeff0011", "the reclaimed job carries the original identity");
    assert.equal((await readPendingJob(h.store)).job, null, "the reclaimed pass completes and clears the slot");
  } finally {
    h.dispose();
  }
});

test("two contended workers with an abandoned claim neither stalls on a live claim — one drains, the other finds the queue empty", async () => {
  const h = await makeQueueHarness({ queue: { lockTimeoutSeconds: 5 } });
  try {
    seedJob(h.stateDir, {
      claim: { workerId: "ghost", pid: 999_999, claimedAt: "2025-12-31T23:45:00.000Z" },
    });
    const resolved = resolveQueueConfig(h.config);
    assert.ok(resolved.ok);
    const lane = (workerId: string, pid: number) =>
      runDrainOnce(h.store, resolved.settings, {
        workerId,
        pid,
        clock: h.clock,
        sleep: h.sleep,
        runApply: async () => appliedPass,
      });
    const [a, b] = await Promise.all([lane("worker-a", process.pid + 11), lane("worker-b", process.pid + 12)]);
    const statuses = [a.status, b.status].sort();
    assert.ok(![a.detail, b.detail].some((d) => /live claim/.test(d ?? "")), "neither worker stalls on the abandoned claim");
    assert.ok(statuses.includes("applied"), `one worker drains (got ${statuses.join(", ")})`);
    assert.ok(statuses.includes("empty") || statuses.includes("stopped"), "the other finds nothing to drain");
    assert.equal((await readPendingJob(h.store)).job, null);
  } finally {
    h.dispose();
  }
});
