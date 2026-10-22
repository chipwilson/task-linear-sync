/**
 * T036 [US2] — state-placement unit tests (research R6, FR-001, edge case).
 * Configured verbatim; platform default <base>/<toolId>/<sha16>; inside-repo refusal;
 * resolution performs zero filesystem writes.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveStateDir,
  createStateStore,
  StatePlacementError,
  platformStateBase,
  stateDirHash16,
  canonicalizePath,
  systemClock,
} from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-paths-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

const sha16 = (p: string): string => createHash("sha256").update(p, "utf8").digest("hex").slice(0, 16);

test("default placement: <platform-base>/<toolId>/<sha16(canonical root)>", () => {
  const repo = join(scratch, "repo-a");
  mkdirSync(repo);
  const base = join(scratch, "xdg-state");
  const env = { XDG_STATE_HOME: base };
  const canonical = canonicalizePath(repo);
  assert.equal(stateDirHash16(canonical), sha16(canonical));
  assert.equal(stateDirHash16(canonical).length, 16, "first 16 hex chars");

  const cfg = loadConfig({});
  const resolved = resolveStateDir(repo, cfg, env);
  assert.equal(resolved, join(base, "task-linear-sync", sha16(canonical)));

  // Distinct per repository; stable for the same root (determinism, Principle IV).
  const repo2 = join(scratch, "repo-b");
  mkdirSync(repo2);
  assert.notEqual(resolveStateDir(repo2, cfg, env), resolved);
  assert.equal(resolveStateDir(repo, cfg, env), resolved);
});

test("platform bases: XDG/local-state (linux), Application Support (macOS), APPDATA (Windows)", () => {
  assert.equal(platformStateBase({ XDG_STATE_HOME: "/x" }, "linux", "/home/u"), "/x");
  assert.equal(platformStateBase({}, "linux", "/home/u"), join("/home/u", ".local", "state"));
  assert.equal(platformStateBase({}, "darwin", "/home/u"), join("/home/u", "Library", "Application Support"));
  assert.equal(
    platformStateBase({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32", "C:\\Users\\u"),
    "C:\\Users\\u\\AppData\\Roaming",
  );
  assert.equal(platformStateBase({}, "win32", "C:\\Users\\u"), join("C:\\Users\\u", "AppData", "Roaming"));
});

test("configured stateDirectory is used verbatim (after canonicalization)", () => {
  const repo = join(scratch, "repo-c");
  mkdirSync(repo);
  const configured = join(scratch, "consumer-chosen", "state");
  const cfg = loadConfig({ overrides: { stateDirectory: configured } });
  const resolved = resolveStateDir(repo, cfg);
  assert.equal(resolved, canonicalizePath(configured));
  assert.ok(!resolved.includes(sha16(configured)), "no hash naming for configured dirs");
});

test("inside-repo configured directory ABORTS with StatePlacementError — never in-tree fallback", () => {
  const repo = join(scratch, "repo-d");
  mkdirSync(repo);
  for (const bad of [join(repo, ".task-linear-sync"), join(repo, "state", "nested"), repo]) {
    const cfg = loadConfig({ overrides: { stateDirectory: bad } });
    assert.throws(
      () => resolveStateDir(repo, cfg),
      StatePlacementError,
      `must refuse in-tree state directory: ${bad}`,
    );
  }
});

test("resolution performs zero filesystem writes (even on failure)", () => {
  const repo = join(scratch, "repo-e");
  mkdirSync(repo);
  writeFileSync(join(repo, "tasks.md"), "# tasks\n");
  const cfg = loadConfig({ overrides: { stateDirectory: join(repo, "state") } });
  assert.throws(() => resolveStateDir(repo, cfg), StatePlacementError);
  assert.deepEqual(readdirSync(repo), ["tasks.md"], "resolution/abort creates nothing");
});

test("createStateStore: paths are children of root; ensure() creates root 0o700", async () => {
  const repo = join(scratch, "repo-f");
  mkdirSync(repo);
  const store = createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, "state-f") } }),
    clock: systemClock,
  });
  for (const p of Object.values(store.paths)) {
    assert.ok(p.startsWith(store.root), `path ${p} must be under root ${store.root}`);
  }
  assert.equal(store.paths.lock, join(store.root, "lock.json"));
  assert.equal(store.paths.syncState, join(store.root, "sync-state.json"));
  assert.equal(store.paths.lastRun, join(store.root, "last-run.json"));
  assert.equal(store.paths.queue, join(store.root, "pending-job.json"));
  assert.equal(store.paths.plans, join(store.root, "plans"));
  assert.equal(store.paths.manifests, join(store.root, "manifests"));
  assert.equal(store.paths.intents, join(store.root, "intents"));
  assert.equal(store.paths.reports, join(store.root, "reports"));

  await store.ensure();
  if (process.platform !== "win32") {
    const mode = statSync(store.root).mode & 0o777;
    assert.equal(mode, 0o700, `root must be 0o700, got 0o${mode.toString(8)}`);
  }
  assert.equal(realpathSync(store.root), store.root, "root exists");
});
