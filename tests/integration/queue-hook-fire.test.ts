/**
 * T035 — Direct git-hook invocation (spec 010 US3; quickstart §3.3/§3.5). Fresh repos merge
 * `--ff-only` without ever running `post-merge`, so this lane invokes the installed hook
 * itself with the cwd/env git provides. A PATH shim named after the default hookScriptPrefix
 * resolves the managed block's quoted token to the real CLI. The hook must ALWAYS exit 0 —
 * even mid-degradation — print the prior run outcome (last-run summary lines) on stderr,
 * and repeated fires must coalesce into exactly ONE pending job (SC-001, FR-007).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { makeQueueHarness, readPendingJob } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url)); // build/tests/integration → repo root

/** Dist copy without `worker-entry.js` — hook enqueues stay pending (no background drain). */
function makeCliSandbox(): { bin: string; dir: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
  cpSync(join(pkgRoot, "package.json"), join(root, "package.json"));
  rmSync(join(dist, "queue", "worker-entry.js"), { force: true });
  return {
    bin: join(dist, "cli", "main.js"),
    dir: root,
    dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/**
 * The managed block runs `"<hookScriptPrefix>" …` as one token; a PATH shim whose file name
 * is that prefix routes the call to the sandboxed CLI binary.
 */
function makePathShim(sandboxDir: string, cliBin: string): string {
  const shimDir = join(sandboxDir, "shim");
  mkdirSync(shimDir, { recursive: true });
  const shim = join(shimDir, "task-linear-sync");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${cliBin}" "$@"\n`, { mode: 0o755 });
  return shimDir;
}

function spawnCli(bin: string, args: readonly string[], cwd: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
}

function envBase(h: { notifySinkPath: string }, shimDir: string, credential: boolean): Record<string, string> {
  const env: Record<string, string> = {
    PATH: `${shimDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: process.env.HOME ?? "/tmp",
    TASK_LINEAR_SYNC_TEST_NOTIFY: h.notifySinkPath,
  };
  if (credential) env.LINEAR_ACCESS_TOKEN = "integration-dummy-token-0000000000";
  return env;
}

/** The CLI validates workspace identities before any queue command — seed the real fixture world. */
function makeHarness(options: Parameters<typeof makeQueueHarness>[0] = {}) {
  return makeQueueHarness({ world: join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report"), ...options });
}

/** Fire an installed hook exactly like git does: cwd = repository root, hook gets no args. */
function fireHook(h: { repositoryRoot: string }, hook: string, env: Record<string, string>) {
  return spawnSync(join(h.repositoryRoot, ".git", "hooks", hook), [], {
    cwd: h.repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("the installed post-merge prints the prior run outcome on stderr, enqueues and always exits 0 (§3.3, §3.5)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness({ queue: { maxRetries: 1 } });
  try {
    const shim = makePathShim(cli.dir, cli.bin);
    const install = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h, shim, true));
    assert.equal(install.status, 0, `stdout=${install.stdout} stderr=${install.stderr}`);

    // Fire #1 — no run recorded yet: the block's `|| true` posture holds.
    const before = fireHook(h, "post-merge", envBase(h, shim, true));
    assert.equal(before.status, 0, `stdout=${before.stdout} stderr=${before.stderr}`);
    assert.match(before.stderr, /no run recorded yet/);
    assert.match(before.stderr, /enqueued sync job [0-9a-f]{16}/);
    assert.ok(readPendingJob(h.stateDir).job !== null, "the fire enqueues");

    // Drain twice (degraded, maxRetries 1) so the marker exists and says "failed".
    const w1 = spawnCli(cli.bin, ["worker", "--once"], h.repositoryRoot, envBase(h, shim, false));
    assert.equal(w1.status, 0, `stdout=${w1.stdout} stderr=${w1.stderr}`);
    const w2 = spawnCli(cli.bin, ["worker", "--once"], h.repositoryRoot, envBase(h, shim, false));
    assert.equal(w2.status, 0, `stdout=${w2.stdout} stderr=${w2.stderr}`);
    assert.match(w2.stdout, /once pass complete \(retry-limit\)/);

    // Fire #2 with credentials CLEARED: still exit 0, still enqueues (§3.5), prior
    // outcome (marker runId + outcome summary lines) lands on the hook's stderr.
    const after = fireHook(h, "post-merge", envBase(h, shim, false));
    assert.equal(after.status, 0, `stdout=${after.stdout} stderr=${after.stderr}`);
    assert.match(after.stderr, /^last run \S+/m);
    assert.match(after.stderr, /^outcome failed\b/m);
    assert.match(after.stderr, /enqueued sync job [0-9a-f]{16}/);
    assert.match(after.stderr, /credential env 'LINEAR_ACCESS_TOKEN' is not set/);
    assert.ok(readPendingJob(h.stateDir).job !== null, "the degraded fire still enqueues");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("repeated hook fires with no worker keep exactly ONE pending job (SC-001, FR-007)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const shim = makePathShim(cli.dir, cli.bin);
    const install = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h, shim, true));
    assert.equal(install.status, 0, `stdout=${install.stdout} stderr=${install.stderr}`);

    const jobIds: string[] = [];
    for (let fire = 1; fire <= 3; fire += 1) {
      const r = fireHook(h, "post-merge", envBase(h, shim, true));
      assert.equal(r.status, 0, `fire ${fire}: stdout=${r.stdout} stderr=${r.stderr}`);
      jobIds.push(/enqueued sync job ([0-9a-f]{16})/.exec(r.stderr)![1]!);
    }
    assert.ok(new Set(jobIds).size === 1, `all fires share one jobId, got ${jobIds.join(", ")}`);

    const disk = readPendingJob(h.stateDir);
    assert.equal(disk.corrupt, false);
    assert.ok(disk.job !== null);
    assert.equal(disk.job.jobId, jobIds[0]);
    assert.equal(disk.job.claim, null, "no worker ran, so nothing claimed the slot");
    assert.ok(!existsSync(join(h.stateDir, "queue-lock.json")), "hook fires never take the drain lock");
  } finally {
    h.dispose();
    cli.dispose();
  }
});
