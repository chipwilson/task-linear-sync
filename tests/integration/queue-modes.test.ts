/**
 * T032 [P] [US2] — Mode persistence and application (spec 010 FR-004 first half;
 * quickstart §2.2 + §6). The mode captured at enqueue time is carried on the single
 * slot (`--mode bootstrap` vs plain sync, latest wins), survives to the drain, and is
 * what the terminating pass reports: the paired queue report records `mode` + `jobId`
 * (the frozen marker schema is NOT widened — deviation note: quickstart's `jq .mode`
 * on the marker resolves against the report document the marker references).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { resolveQueueConfig } from "../../src/queue/config.js";
import { mergePendingJob, runDrainOnce, type EnginePassResult, type PendingJob } from "../../src/queue/index.js";
import { makeQueueHarness, readPendingJob } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function makeCliSandbox(): { bin: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
  cpSync(join(pkgRoot, "package.json"), join(root, "package.json"));
  rmSync(join(dist, "queue", "worker-entry.js"), { force: true });
  return { bin: join(dist, "cli", "main.js"), dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }) };
}

function envDegraded(notifySink: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TASK_LINEAR_SYNC_TEST_NOTIFY: notifySink,
  };
}

function envWithCredential(notifySink: string): Record<string, string> {
  return { ...envDegraded(notifySink), LINEAR_ACCESS_TOKEN: "modes-dummy-token-000000000" };
}

function reportDoc(jsonPath: string): { kind: string; mode: string; jobId: string; error?: { code?: string } } {
  return JSON.parse(readFileSync(jsonPath, "utf8")) as { kind: string; mode: string; jobId: string; error?: { code?: string } };
}

test("spawned: `enqueue --mode bootstrap` carries bootstrap into the terminal report", async () => {
  const cli = makeCliSandbox();
  const h = await makeQueueHarness({ world: join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report"), queue: { maxRetries: 1 } });
  try {
    const enq = spawnSync(process.execPath, [cli.bin, "enqueue", "--mode", "bootstrap"], {
      cwd: h.repositoryRoot,
      env: envWithCredential(h.notifySinkPath),
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(enq.status, 0, `stdout=${enq.stdout} stderr=${enq.stderr}`);
    const pendingJob = readPendingJob(h.stateDir).job;
    assert.ok(pendingJob !== null);
    assert.equal(pendingJob.mode, "bootstrap", "the slot records the enqueued mode");

    for (let i = 0; i < 2; i += 1) {
      const run = spawnSync(process.execPath, [cli.bin, "worker", "--once"], {
        cwd: h.repositoryRoot,
        env: envDegraded(h.notifySinkPath),
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(run.status, 0, `stdout=${run.stdout} stderr=${run.stderr}`);
    }

    const lr = JSON.parse(
      spawnSync(process.execPath, [cli.bin, "last-run", "--json"], {
        cwd: h.repositoryRoot,
        env: envDegraded(h.notifySinkPath),
        encoding: "utf8",
        timeout: 60_000,
      }).stdout.trim(),
    ) as { found: true; marker: { outcome: string; reportPaths: { json: string } } };
    assert.equal(lr.found, true);
    assert.equal(lr.marker.outcome, "failed");
    const doc = reportDoc(lr.marker.reportPaths.json);
    assert.equal(doc.kind, "queue-terminal");
    assert.equal(doc.mode, "bootstrap", "the terminating pass reports the JOB's mode (FR-004)");
    assert.equal(doc.jobId, pendingJob.jobId);
    assert.equal(doc.error?.code, "RETRY_LIMIT");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("spawned: a plain (sync) enqueue reports mode sync", async () => {
  const cli = makeCliSandbox();
  const h = await makeQueueHarness({ world: join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report"), queue: { maxRetries: 1 } });
  try {
    const enq = spawnSync(process.execPath, [cli.bin, "enqueue"], {
      cwd: h.repositoryRoot,
      env: envWithCredential(h.notifySinkPath),
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(enq.status, 0, `stdout=${enq.stdout} stderr=${enq.stderr}`);
    assert.equal(readPendingJob(h.stateDir).job?.mode, "sync");
    for (let i = 0; i < 2; i += 1) {
      spawnSync(process.execPath, [cli.bin, "worker", "--once"], {
        cwd: h.repositoryRoot,
        env: envDegraded(h.notifySinkPath),
        encoding: "utf8",
        timeout: 60_000,
      });
    }
    const lr = JSON.parse(
      spawnSync(process.execPath, [cli.bin, "last-run", "--json"], {
        cwd: h.repositoryRoot,
        env: envDegraded(h.notifySinkPath),
        encoding: "utf8",
        timeout: 60_000,
      }).stdout.trim(),
    ) as { found: true; marker: { reportPaths: { json: string } } };
    assert.equal(reportDoc(lr.marker.reportPaths.json).mode, "sync");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("in-process: the drain hands the job's recorded mode to the engine lane, not a re-derived default", async () => {
  const h = await makeQueueHarness();
  try {
    await mergePendingJob(h.store, { mode: "bootstrap", trigger: "manual" });
    await mergePendingJob(h.store, { mode: "bootstrap", trigger: "agent" }); // latest wins, mode persists
    const resolved = resolveQueueConfig(h.config);
    assert.ok(resolved.ok);

    const seen: PendingJob[] = [];
    const result = await runDrainOnce(h.store, resolved.settings, {
      workerId: "modes-worker",
      pid: process.pid,
      clock: h.clock,
      sleep: h.sleep,
      runApply: async (job) => {
        seen.push(job!);
        return { status: "applied", runId: "e".repeat(64), detail: "applied 0 operations (0 skipped, 0 failed)" } satisfies EnginePassResult;
      },
    });
    assert.equal(result.status, "applied");
    assert.equal(seen[0]?.mode, "bootstrap", "runDrainOnce forwards the recorded mode (surface default path)");
  } finally {
    h.dispose();
  }
});
