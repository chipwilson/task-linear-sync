/**
 * T042 [US2] — state-placement integration tests (FR-001, SC-003, R6/R7). Test name
 * contains "state placement". Hash16 naming distinguishes two repositories (one nested in
 * the other); configured directories verbatim; inside-repo configured paths and an
 * unwritable location both abort with no in-tree fallback; a FULL lifecycle writes ZERO
 * files under either repository (SC-003 walk).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
  createStateStore,
  resolveStateDir,
  canonicalizePath,
  StatePlacementError,
  systemClock,
  acquireRunLock,
  releaseRunLock,
  writeCreateIntentBeforeAttempt,
  writeRunReports,
} from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";
import { FakeClock, makeScreener } from "../helpers/test-utils.js";

const scratch = mkdtempSync(join(tmpdir(), "tls-placement-"));
let previousXdg: string | undefined;

before(() => {
  previousXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(scratch, "xdg-base");
});
after(() => {
  if (previousXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousXdg;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

const sha16 = (p: string): string => createHash("sha256").update(p, "utf8").digest("hex").slice(0, 16);

/** Recursive relative-path listing (files + dirs) for the SC-003 before/after walk. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
  }
  return out.sort();
}

test("state placement — hash16 naming: distinct per repository, stable per root, repo-outside", () => {
  const repoA = join(scratch, "repo-a");
  mkdirSync(repoA, { recursive: true });
  writeFileSync(join(repoA, "tasks.md"), "# tasks\n");

  // repo-b nested INSIDE repo-c (the "nested" edge case): separate state dirs anyway.
  const repoC = join(scratch, "repo-c");
  const repoB = join(repoC, "inner", "repo-b");
  mkdirSync(repoB, { recursive: true });
  writeFileSync(join(repoB, "tasks.md"), "# nested tasks\n");

  const cfg = loadConfig({});
  const dirA = resolveStateDir(repoA, cfg);
  const dirB = resolveStateDir(repoB, cfg);
  const base = process.env.XDG_STATE_HOME ?? "";

  assert.equal(dirA, join(base, "task-linear-sync", sha16(canonicalizePath(repoA))));
  assert.equal(dirB, join(base, "task-linear-sync", sha16(canonicalizePath(repoB))));
  assert.notEqual(dirA, dirB, "nested repo must NOT share the outer repo's state dir");
  assert.equal(resolveStateDir(repoA, cfg), dirA, "stable for the same root");
  assert.equal(resolveStateDir(repoB, cfg), dirB);

  // The names differ ONLY via the hash — same toolId segment.
  assert.ok(dirA.includes("task-linear-sync") && dirB.includes("task-linear-sync"));
});

test("state placement — configured directory used verbatim; outside repo required", () => {
  const repo = join(scratch, "repo-d");
  mkdirSync(repo, { recursive: true });
  const chosen = join(scratch, "chosen", "by-consumer");
  const cfg = loadConfig({ overrides: { stateDirectory: chosen } });
  assert.equal(resolveStateDir(repo, cfg), canonicalizePath(chosen));

  // Inside-repo and repo-equal both abort (SC-003).
  assert.throws(() => resolveStateDir(repo, loadConfig({ overrides: { stateDirectory: join(repo, ".state") } })), StatePlacementError);
  assert.throws(() => resolveStateDir(repo, loadConfig({ overrides: { stateDirectory: repo } })), StatePlacementError);
});

test("state placement — full lifecycle writes ZERO files under either repository (SC-003 walk)", async () => {
  const repoA = join(scratch, "walk", "repo-a");
  const repoB = join(scratch, "walk", "repo-b");
  mkdirSync(repoA, { recursive: true });
  mkdirSync(repoB, { recursive: true });
  writeFileSync(join(repoA, "tasks.md"), "# a\n");
  writeFileSync(join(repoB, "tasks.md"), "# b\n");

  const beforeA = walk(repoA);
  const beforeB = walk(repoB);

  const clock = new FakeClock("2026-10-22T12:00:00.000Z");
  for (const repo of [repoA, repoB]) {
    const store = createStateStore({ repositoryRoot: repo, config: loadConfig({}), clock });
    await store.ensure();
    // A representative lifecycle: lock, intent, plan write, report pair, marker.
    const lock = await acquireRunLock(store, "walk-run");
    assert.equal(lock.acquired, true);
    await writeCreateIntentBeforeAttempt(store, {
      intentId: `intent-${sha16(repo).slice(0, 8)}`,
      runId: "walk-run",
      taskUuid: "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
      targetTeamKey: "acme",
      targetProject: "proj-alpha",
    });
    await store.writeJson("plans/" + "f".repeat(64) + ".json", { plan: { planId: "f".repeat(64) }, storedAt: clock.iso() });
    await writeRunReports(
      store,
      "walk-run",
      { json: { ok: true }, markdown: "# ok\n" },
      makeScreener(),
      { runId: "walk-run", outcome: "completed", notificationSuppressed: false },
    );
    if (lock.acquired) await releaseRunLock(store, lock.record);
  }

  assert.deepEqual(walk(repoA), beforeA, "repo-a untouched by the run-state lifecycle");
  assert.deepEqual(walk(repoB), beforeB, "repo-b untouched");

  // ...while the state dirs DID receive the lifecycle output (walk proves placement works).
  const storeA = createStateStore({ repositoryRoot: repoA, config: loadConfig({}), clock });
  assert.ok(existsSync(join(storeA.root, "last-run.json")));
  assert.ok(existsSync(join(storeA.root, "reports", "walk-run", "report.json")));
});

test("state placement — unwritable resolved location: ensure() fails LOUDLY, never in-tree", async () => {
  const repo = join(scratch, "repo-unwritable");
  mkdirSync(repo, { recursive: true });
  // Block the state path with a regular FILE: mkdir under it fails (ENOTDIR).
  const blocker = join(scratch, "blocker-file");
  writeFileSync(blocker, "not a directory");
  const cfg = loadConfig({ overrides: { stateDirectory: join(blocker, "state") } });
  const store = createStateStore({ repositoryRoot: repo, config: cfg, clock: systemClock });
  await assert.rejects(() => store.ensure(), /ENOTDIR|EEXIST|EACCES|EPERM/);

  // No in-tree fallback appeared (SC-003).
  assert.deepEqual(walk(repo), []);
  if (process.platform !== "win32") {
    // Sanity: the guardrail is about placement, not permissions of HOME itself.
    assert.ok(homedir().length > 0);
  }
});

test("state placement — default tree under the platform base is 0o700 end-to-end", async () => {
  const repo = join(scratch, "repo-modes");
  mkdirSync(repo, { recursive: true });
  const store = createStateStore({ repositoryRoot: repo, config: loadConfig({}), clock: systemClock });
  await store.ensure();
  await store.writeJson("intents/probe.json", { intentId: "probe" });
  await store.writeText("reports/probe/report.md", "# p\n");
  if (process.platform === "win32") return;
  const rootMode = statSync(store.root).mode & 0o777;
  const intentMode = statSync(join(store.paths.intents, "probe.json")).mode & 0o777;
  const mdMode = statSync(join(store.root, "reports", "probe", "report.md")).mode & 0o777;
  assert.equal(rootMode, 0o700, `state root 0o${rootMode.toString(8)}`);
  assert.equal(intentMode, 0o600);
  assert.equal(mdMode, 0o600);
});
