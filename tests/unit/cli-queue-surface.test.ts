/**
 * T006 [P] / adapted by T026 (research R12) — default `QueueSurface` wiring unit tests.
 * With `src/queue/` PRESENT (the 010 state): the four 010-owned members bind to the real
 * module — no `QueueSurfaceUnavailableError`, frozen refusal semantics instead — while a
 * child-process sub-suite re-points the seam at a dist copy WITHOUT the queue module to
 * preserve the exit-7 branch coverage. `readLastRun` is served by the frozen
 * `readLastRunMarker` — empty store ⇒ `{ found: false }`, marker written via the frozen
 * `writeRunReports` ⇒ the frozen `LastRunMarker` fields come back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "task-linear-sync/config";
import { createDefaultSecurityScreener } from "task-linear-sync/engine";
import { createStateStore, fixedClock } from "task-linear-sync/state";

import { createDefaultQueueSurface } from "../../src/cli/queue-surface.js";

const CLOCK = fixedClock(new Date("2026-01-01T00:00:00.000Z"));
const RUN_ID = "f".repeat(64);

async function buildTempStore(): Promise<{ repositoryRoot: string; stateDir: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "tls-009-qs-"));
  const repositoryRoot = join(root, "repo");
  const stateDir = join(root, "state");
  return { repositoryRoot, stateDir, root };
}

function surfaceConfig(stateDir: string) {
  return loadConfig({ overrides: { stateDirectory: stateDir } });
}

test("T026: with the queue module present the four 010-owned members bind to the real surface", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const surface = createDefaultQueueSurface();
    // installHooks: real 010 refusal semantics (no .git here), NOT an unavailability throw.
    const hooks = await surface.installHooks({ repositoryRoot, config });
    assert.equal(hooks.status, "refused");
    assert.match(hooks.detail ?? "", /\.git/);
    // installAgentHook: real scaffold write through the default surface.
    const agent = await surface.installAgentHook({ repositoryRoot, config, frameworkId: "kiro" });
    assert.equal(agent.status, "installed", agent.detail ?? "");
    assert.ok(agent.path && existsSync(agent.path));
    // enqueue: fs failure lane returns skipped (protocol §2.5) instead of rejecting;
    // a regular file blocks the state slot so the write fails and no worker is spawned.
    const blocked = join(root, "blocked-slot");
    await writeFile(blocked, "", "utf8");
    const blockedRes = await surface.enqueue({
      repositoryRoot,
      config: loadConfig({ overrides: { stateDirectory: blocked } }),
      mode: "sync",
    });
    assert.equal(blockedRes.status, "skipped");
    assert.match(blockedRes.detail ?? "", /pending-job|state/i);
    // runWorker --once on an empty slot: stopped, clean return through the real module.
    const worker = await surface.runWorker({ repositoryRoot, config, once: true });
    assert.equal(worker.status, "stopped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T026: refusals on the real module keep zero filesystem side effects in an existing empty state dir", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(stateDir, { recursive: true });
    const surface = createDefaultQueueSurface();
    const hooks = await surface.installHooks({ repositoryRoot, config }); // refused: no .git
    assert.equal(hooks.status, "refused");
    const worker = await surface.runWorker({ repositoryRoot, config, once: true }); // empty slot ⇒ stopped
    assert.equal(worker.status, "stopped");
    assert.deepEqual(readdirSync(stateDir), [], "refused/stopped lanes must write nothing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T026 exit-7 branch: seam over a dist copy WITHOUT the queue module still rejects naming the module", async (t) => {
  const distCli = fileURLToPath(new URL("../../../dist/cli/queue-surface.js", import.meta.url));
  if (!existsSync(distCli)) {
    t.skip("dist build absent — run `npm run build` first (pretest does)");
    return;
  }
  const staging = await mkdtemp(join(tmpdir(), "tls-009-absent-"));
  try {
    const copy = join(staging, "dist");
    cpSync(fileURLToPath(new URL("../../../dist/", import.meta.url)), copy, { recursive: true });
    rmSync(join(copy, "queue"), { recursive: true, force: true }); // the 009-era absence world
    const script = `
      import { pathToFileURL } from "node:url";
      const mod = await import(pathToFileURL(${JSON.stringify(join(copy, "cli", "queue-surface.js"))}).href);
      const surface = mod.createDefaultQueueSurface();
      for (const command of ["installHooks", "installAgentHook", "enqueue", "runWorker"]) {
        try {
          await surface[command]({ repositoryRoot: "/nonexistent-repo", config: {}, mode: "sync", once: true, frameworkId: "kiro" });
          console.error(command + " resolved but must reject");
          process.exit(1);
        } catch (e) {
          if (e?.name !== "QueueSurfaceUnavailableError" || e?.module !== "task-linear-sync/queue") {
            console.error(command + " wrong error: " + (e && (e.name + ": " + e.message)));
            process.exit(2);
          }
        }
      }
      process.exit(0);
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(r.status, 0, `child said: ${r.stderr}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});

test("readLastRun reports { found: false } for an empty state store", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const state = createStateStore({ repositoryRoot, config, clock: CLOCK });
    await state.ensure();
    const surface = createDefaultQueueSurface();
    assert.deepEqual(await surface.readLastRun({ state }), { found: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readLastRun returns the frozen LastRunMarker after writeRunReports wrote one", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const state = createStateStore({ repositoryRoot, config, clock: CLOCK });
    await state.ensure();
    const { writeRunReports } = await import("task-linear-sync/state");
    const marker = await writeRunReports(
      state,
      RUN_ID,
      { json: { schemaVersion: 1 }, markdown: "run report" },
      createDefaultSecurityScreener(config),
      { runId: RUN_ID, outcome: "completed", notificationSuppressed: false },
    );
    const surface = createDefaultQueueSurface();
    const outcome = await surface.readLastRun({ state });
    assert.equal(outcome.found, true);
    assert.ok(outcome.marker);
    assert.equal(outcome.marker.runId, marker.runId);
    assert.equal(outcome.marker.outcome, "completed");
    assert.equal(outcome.marker.completedAt, marker.completedAt);
    assert.deepEqual(outcome.marker.reportPaths, marker.reportPaths);
    assert.equal(outcome.marker.notificationSuppressed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
