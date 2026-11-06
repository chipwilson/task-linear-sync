/**
 * T031 [P] [US2] — Queue-lock timeout integration (spec 010 US2 scenario 4; quickstart §5;
 * queue-protocol §3). An externally held lock (live pid) must make `worker --once` STOP —
 * never a refusal, never a job mutation: exit 0 with `stopped`, the lock record byte
 * unchanged, the pending record byte unchanged, one sanitized lock-failure report (§3
 * mandates the report; the job itself is never touched), and the give-up lands after
 * `queue.lockTimeoutSeconds` of (virtual) waiting. FR-002 scope: enqueue never waits on
 * this lock and stays fast even while it is held.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createQueueSurface, type QueueWiring } from "../../src/queue/surface.js";
import { readPendingJob } from "../../src/queue/index.js";
import { makeQueueHarness, writePendingJob } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function makeCliSandbox(): { bin: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
  cpSync(join(pkgRoot, "package.json"), join(root, "package.json"));
  rmSync(join(dist, "queue", "worker-entry.js"), { force: true });
  return { bin: join(dist, "cli", "main.js"), dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }) };
}

function seedForeignLock(stateDir: string): string {
  const record = { schemaVersion: 1, workerId: "keeper", pid: process.pid, acquiredAt: "2026-01-01T00:00:00.000Z" };
  const bytes = JSON.stringify(record);
  writeFileSync(join(stateDir, "queue-lock.json"), bytes, "utf8");
  return bytes;
}

test("a foreign LIVE lock holder stops the drain: exit-0 semantics, zero job mutation, one lock-failure report", async () => {
  const h = await makeQueueHarness({ queue: { lockTimeoutSeconds: 1 } });
  try {
    writePendingJob(h.stateDir, {
      schemaVersion: 1,
      jobId: "1122334455667788",
      mode: "sync",
      trigger: "post-commit",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      retryCount: 0,
      claim: null,
    });
    const lockBytes = seedForeignLock(h.stateDir);
    const jobBytes = readFileSync(join(h.stateDir, "pending-job.json"), "utf8");

    const surface = createQueueSurface(h.wiring() as unknown as QueueWiring);
    const outcome = await surface.runWorker({ repositoryRoot: h.repositoryRoot, config: h.config, once: true });

    // stopped — the frozen status vocabulary has no refusal here (quickstart §5).
    assert.equal(outcome.status, "stopped", `detail: ${outcome.detail}`);
    assert.match(outcome.detail ?? "", /once pass complete \(stopped\)/);
    // The give-up lands after ~1 s of waiting paced by the injected seams: the lock-wait
    // sleeps run through the harness recorder (virtual clock, research R13).
    const waitedMs = h.sleeps.reduce((sum, ms) => sum + ms, 0);
    assert.ok(waitedMs >= 950, `expected ~1 s of paced lock waiting, saw ${waitedMs} ms`);

    // Zero lifecycle mutation: lock record AND pending job stay byte-identical (protocol §3).
    assert.equal(readFileSync(join(h.stateDir, "queue-lock.json"), "utf8"), lockBytes, "the foreign lock is untouched");
    assert.equal(readFileSync(join(h.stateDir, "pending-job.json"), "utf8"), jobBytes, "no job mutation while the lock was held");
    assert.equal((await readPendingJob(h.store)).job?.jobId, "1122334455667788");

    // Protocol §3 mandates ONE sanitized lock-failure report (outcome aborted) — the
    // ONLY lifecycle write of the stopped cycle; no engine run happened.
    const markerRaw = JSON.parse(readFileSync(join(h.stateDir, "last-run.json"), "utf8")) as {
      outcome: string;
      reportPaths: { json: string } | null;
    };
    assert.equal(markerRaw.outcome, "aborted");
    const report = JSON.parse(readFileSync(markerRaw.reportPaths!.json, "utf8")) as {
      kind: string;
      reason: string;
      jobId: string;
      message: string;
    };
    assert.equal(report.kind, "queue-lock-failure");
    assert.equal(report.reason, "lock-held");
    assert.equal(report.jobId, "1122334455667788");
    assert.match(report.message, /queue lock held by keeper past the 1s timeout/);
    // Notifications stay silent for a lock-stop (no markered engine outcome).
    assert.equal(h.notifications.length, 0);
  } finally {
    h.dispose();
  }
});

test("spawned `worker --once` against the held lock exits 0 (NEVER 4) and changes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "tls-010-lt-"));
  const cli = makeCliSandbox();
  try {
    const repo = join(root, "repo");
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    cpSync(join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report", "repo"), repo, { recursive: true });
    writeFileSync(
      join(repo, "task-linear-sync.json"),
      JSON.stringify({
        ...(JSON.parse(
          readFileSync(join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report", "world.json"), "utf8"),
        ).config ?? {}),
        stateDirectory: state,
        queue: { lockTimeoutSeconds: 1 },
      }),
    );
    seedForeignLock(state);

    const started = performance.now();
    const r = spawnSync(process.execPath, [cli.bin, "worker", "--once"], {
      cwd: repo,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        LINEAR_ACCESS_TOKEN: "locktime-dummy-token-00000000",
        TASK_LINEAR_SYNC_TEST_NOTIFY: join(root, "notify.log"),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    const elapsed = performance.now() - started;

    assert.equal(r.status, 0, `must be exit 0, never 4 — stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /worker stopped/);
    assert.match(r.stdout, /once pass complete \(stopped\)/);
    // The per-pass truth (protocol §3) lives in the sanitized report, not the frozen status.
    const markerRaw = JSON.parse(readFileSync(join(state, "last-run.json"), "utf8")) as {
      outcome: string;
      reportPaths: { json: string } | null;
    };
    assert.equal(markerRaw.outcome, "aborted");
    const report = JSON.parse(readFileSync(markerRaw.reportPaths!.json, "utf8")) as { kind: string; message: string };
    assert.equal(report.kind, "queue-lock-failure");
    assert.match(report.message, /queue lock held by keeper/);
    assert.ok(elapsed < 5_000, `give-up must land near the 1 s timeout, took ${elapsed.toFixed(0)} ms of wall time`);
    assert.ok(!/refused/.test(r.stdout), "a held lock is never a refusal");
  } finally {
    cli.dispose();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
