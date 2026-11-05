/**
 * T006 [P] — default `QueueSurface` wiring unit tests (research R5; contracts/queue-surface.md §2).
 * With `src/queue/` absent (the state of the repo when 009 ships): the four 010-owned
 * members reject with `QueueSurfaceUnavailableError` naming the command and
 * `task-linear-sync/queue` with zero side effects; `readLastRun` is served by the frozen
 * `readLastRunMarker` — empty store ⇒ `{ found: false }`, marker written via the frozen
 * `writeRunReports` ⇒ the frozen `LastRunMarker` fields come back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "task-linear-sync/config";
import { createDefaultSecurityScreener } from "task-linear-sync/engine";
import { createStateStore, fixedClock } from "task-linear-sync/state";

import { createDefaultQueueSurface } from "../../src/cli/queue-surface.js";
import { QueueSurfaceUnavailableError } from "../../src/cli/errors.js";

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

test("the four 010-owned members reject with QueueSurfaceUnavailableError naming command + module", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const surface = createDefaultQueueSurface();
    const cases: readonly [Promise<unknown>, string][] = [
      [surface.installHooks({ repositoryRoot, config }), "install-hooks"],
      [surface.installAgentHook({ repositoryRoot, config, frameworkId: "kiro" }), "install-agent-hook"],
      [surface.enqueue({ repositoryRoot, config, mode: "sync" }), "enqueue"],
      [surface.runWorker({ repositoryRoot, config, once: true }), "worker"],
    ];
    for (const [pending, command] of cases) {
      await assert.rejects(
        () => pending,
        (e: unknown) => {
          assert.ok(e instanceof QueueSurfaceUnavailableError, `${command} must reject with QueueSurfaceUnavailableError`);
          assert.match(e.message, new RegExp(command));
          assert.match(e.message, /task-linear-sync\/queue/);
          assert.equal(e.command, command);
          assert.equal(e.module, "task-linear-sync/queue");
          return true;
        },
        `${command} must refuse while the queue module is absent`,
      );
    }
    // Zero side effects: the state directory was never touched, nothing created.
    assert.equal(existsSync(stateDir), false, "refusals must not create the state directory");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refusals have zero filesystem side effects in an existing empty state dir", async () => {
  const { repositoryRoot, stateDir, root } = await buildTempStore();
  try {
    const config = surfaceConfig(stateDir);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(stateDir, { recursive: true });
    const surface = createDefaultQueueSurface();
    await surface.enqueue({ repositoryRoot, config, mode: "bootstrap" }).then(
      () => assert.fail("enqueue must reject"),
      () => undefined,
    );
    assert.deepEqual(readdirSync(stateDir), [], "queue refusals must write nothing");
  } finally {
    await rm(root, { recursive: true, force: true });
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
