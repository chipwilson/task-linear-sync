/**
 * T027 — End-to-end enqueue → drain over the SPAWNED CLI (spec 010 US1; quickstart §2).
 * The frozen 009 CLI binds `createQueueSurface()` with zero arguments through the real
 * `dist/cli/main.js` binary, so this lane proves the production wiring end to end:
 * durable enqueue within its latency budget (FR-001), storm coalescing into one slot
 * (FR-008), credential-absent degradation (FR-007), and the offline retry-limited drain
 * (FR-011..FR-015, FR-020) terminating with a failed marker + paired queue report and
 * exactly one notification. The degraded lane runs with NO credential env — credential
 * resolution fails before any HTTP request, so the lane is provably zero-network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createQueueSurface } from "../../src/queue/surface.js";
import type { QueueWiring } from "../../src/queue/surface.js";
import { makeQueueHarness, readPendingJob } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url)); // build/tests/integration → repo root

/**
 * The spawned CLI binds the REAL `createQueueSurface()`, whose enqueue auto-spawns the
 * detached worker (queue-protocol §5). To keep this lane deterministic (and hermetic),
 * the binary runs from a `dist` copy WITHOUT `queue/worker-entry.js`: the hand-off then
 * fails silently and the job stays queued for the explicit `worker --once` invocations.
 */
function makeCliSandbox(): { bin: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
  // Self-referencing `task-linear-sync/*` imports resolve through the package manifest.
  cpSync(join(pkgRoot, "package.json"), join(root, "package.json"));
  rmSync(join(dist, "queue", "worker-entry.js"), { force: true });
  return {
    bin: join(dist, "cli", "main.js"),
    dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/** Spawn the real CLI in the harness repo; env is explicit — never the ambient one. */
function spawnCli(bin: string, args: readonly string[], cwd: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
}

/** CLI env with the credential NAME present (dummy value) + the hermetic notify sink. */
function envWithCredential(h: { notifySinkPath: string }): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TASK_LINEAR_SYNC_TEST_NOTIFY: h.notifySinkPath,
    LINEAR_ACCESS_TOKEN: "integration-dummy-token-0000000000",
  };
}

/** CLI env WITHOUT any credential env — degraded offline lane (fails before HTTP). */
function envDegraded(h: { notifySinkPath: string }): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TASK_LINEAR_SYNC_TEST_NOTIFY: h.notifySinkPath,
  };
}

/** The CLI validates workspace identities before any queue command — seed the real fixture world. */
function makeHarness(options: Parameters<typeof makeQueueHarness>[0] = {}) {
  return makeQueueHarness({ world: join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report"), ...options });
}

function sinkLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

test("enqueue over the spawned CLI is durable, names the job id and stays inside the latency budget", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const started = performance.now();
    const r = spawnCli(cli.bin, ["enqueue"], h.repositoryRoot, envWithCredential(h));
    const elapsed = performance.now() - started;

    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /enqueued sync job [0-9a-f]{16}/);
    assert.ok(elapsed < 500, `enqueue wall time must stay under 500 ms (FR-001), was ${elapsed.toFixed(0)} ms`);

    const jobId = /enqueued sync job ([0-9a-f]{16})/.exec(r.stdout)![1]!;
    const disk = readPendingJob(h.stateDir);
    assert.equal(disk.corrupt, false);
    assert.ok(disk.job !== null, "pending job must be durable when enqueue exits 0");
    assert.equal(disk.job.jobId, jobId);
    assert.equal(disk.job.mode, "sync");
    assert.equal(disk.job.trigger, "manual");
    assert.equal(disk.job.claim, null);

    // `--mode bootstrap` carries the mode into the single slot (FR-004 first half).
    const boot = spawnCli(cli.bin, ["enqueue", "--mode", "bootstrap"], h.repositoryRoot, envWithCredential(h));
    assert.equal(boot.status, 0, `stdout=${boot.stdout} stderr=${boot.stderr}`);
    assert.match(boot.stdout, /enqueued bootstrap job/);
    const afterBoot = readPendingJob(h.stateDir).job;
    assert.ok(afterBoot !== null);
    assert.equal(afterBoot.jobId, jobId, "the slot keeps one identity across modes");
    assert.equal(afterBoot.mode, "bootstrap", "the latest mode wins");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("enqueue without credential env still enqueues and warns about the credential (FR-007)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const r = spawnCli(cli.bin, ["enqueue"], h.repositoryRoot, envDegraded(h));
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /enqueued sync job [0-9a-f]{16}/);
    // The frozen CLI presents the enqueue detail on stdout — the warning lands there.
    assert.match(r.stdout, /credential env 'LINEAR_ACCESS_TOKEN' is not set/);
    assert.match(r.stdout, /background runs will report an error until it is/);
    assert.ok(readPendingJob(h.stateDir).job !== null, "the job stays queued despite the warning");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("a second enqueue coalesces into the same slot — same jobId and enqueuedAt, latest mode wins (FR-008)", async () => {
  const h = await makeHarness();
  try {
    const surface = createQueueSurface(h.wiring() as unknown as QueueWiring);
    const first = await surface.enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "sync" });
    assert.equal(first.status, "enqueued");
    h.clock.advanceMs(60_000);
    const second = await surface.enqueue({ repositoryRoot: h.repositoryRoot, config: h.config, mode: "bootstrap" });
    assert.equal(second.status, "enqueued");
    assert.equal(second.jobId, first.jobId, "the single slot keeps one job id across the storm");

    const job = readPendingJob(h.stateDir).job;
    assert.ok(job !== null);
    assert.equal(job.jobId, first.jobId);
    assert.equal(job.mode, "bootstrap", "the latest mode wins (data-model §2)");
    assert.ok(Date.parse(job.updatedAt) > Date.parse(job.enqueuedAt));
    assert.equal(h.spawns.length, 2, "every enqueue hands off a detached worker");
    assert.ok(h.spawns[0]!.entry.endsWith("worker-entry.js"));
    assert.equal(h.spawns[0]!.repositoryRoot, h.repositoryRoot);
  } finally {
    h.dispose();
  }
});

test("two degraded `worker --once` runs terminate the job: RETRY_LIMIT marker, paired report, one notification", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness({ queue: { maxRetries: 1 } });
  try {
    const enq = spawnCli(cli.bin, ["enqueue"], h.repositoryRoot, envWithCredential(h));
    assert.equal(enq.status, 0, `stdout=${enq.stdout} stderr=${enq.stderr}`);
    const jobId = /enqueued sync job ([0-9a-f]{16})/.exec(enq.stdout)![1]!;

    // Pass 1 — no credential env: the engine pass fails before HTTP and re-queues.
    const run1 = spawnCli(cli.bin, ["worker", "--once"], h.repositoryRoot, envDegraded(h));
    assert.equal(run1.status, 0, `stdout=${run1.stdout} stderr=${run1.stderr}`);
    assert.match(run1.stdout, /worker stopped after a single pass/);
    assert.match(run1.stdout, /once pass complete \(retried\)/);
    const after1 = readPendingJob(h.stateDir).job;
    assert.ok(after1 !== null, "a retryable failure keeps the job queued");
    assert.equal(after1.jobId, jobId);
    assert.equal(after1.retryCount, 1);
    assert.equal(after1.claim, null, "the abandoned claim must not survive the re-queue");
    assert.deepEqual(sinkLines(h.notifySinkPath), [], "retryable failures notify nothing (FR-020)");

    // Pass 2 — attempts exceed maxRetries=1: terminal consumption.
    const run2 = spawnCli(cli.bin, ["worker", "--once"], h.repositoryRoot, envDegraded(h));
    assert.equal(run2.status, 0, `stdout=${run2.stdout} stderr=${run2.stderr}`);
    assert.match(run2.stdout, /once pass complete \(retry-limit\)/);
    assert.equal(readPendingJob(h.stateDir).job, null, "the terminal outcome consumes the slot");
    assert.ok(!existsSync(join(h.stateDir, "queue-lock.json")), "the drain must release its lock");

    // The frozen marker (via `last-run --json`) pairs with the queue's own report doc.
    const lr = spawnCli(cli.bin, ["last-run", "--json"], h.repositoryRoot, envDegraded(h));
    assert.equal(lr.status, 0);
    const parsed = JSON.parse(lr.stdout.trim()) as {
      found: boolean;
      marker?: {
        outcome: string;
        notificationSuppressed: boolean;
        reportPaths: { json: string; markdown: string } | null;
      };
    };
    assert.equal(parsed.found, true);
    assert.equal(parsed.marker?.outcome, "failed");
    assert.equal(parsed.marker?.notificationSuppressed, false, "the notification was delivered");
    assert.ok(parsed.marker?.reportPaths !== null);
    const jsonPath = parsed.marker!.reportPaths!.json;
    const report = JSON.parse(readFileSync(isAbsolute(jsonPath) ? jsonPath : join(h.stateDir, jsonPath), "utf8")) as {
      kind: string;
      outcome: string;
      mode: string;
      jobId: string;
      error?: { code?: string; message?: string };
    };
    assert.equal(report.kind, "queue-terminal");
    assert.equal(report.outcome, "failed");
    assert.equal(report.mode, "sync");
    assert.equal(report.jobId, jobId);
    assert.equal(report.error?.code, "RETRY_LIMIT");
    assert.match(report.error?.message ?? "", /giving up after 2 attempts/);
    // Zero-network proof: credential resolution failed — no HTTP failure channel appears.
    assert.doesNotMatch(report.error?.message ?? "", /ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i);

    // Exactly one notification, naming the terminal failure (FR-020/FR-021).
    const notes = sinkLines(h.notifySinkPath);
    assert.equal(notes.length, 1, `expected exactly one notification, got: ${notes.join(" | ")}`);
    assert.match(notes[0]!, /sync failed/);
    assert.match(notes[0]!, /giving up after 2 attempts/);
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("worker --once with an empty queue stops cleanly, silently and without residue", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const started = performance.now();
    const r = spawnCli(cli.bin, ["worker", "--once"], h.repositoryRoot, envWithCredential(h));
    const elapsed = performance.now() - started;
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /worker stopped after a single pass/);
    assert.match(r.stdout, /once pass complete \(empty\)/);
    assert.ok(elapsed < 5_000, `no-op worker pass must return promptly, took ${elapsed.toFixed(0)} ms`);
    assert.equal(readPendingJob(h.stateDir).job, null);
    assert.ok(!existsSync(join(h.stateDir, "queue-lock.json")));
    assert.equal(sinkLines(h.notifySinkPath).length, 0, "an empty queue notifies nothing");
  } finally {
    h.dispose();
    cli.dispose();
  }
});
