#!/usr/bin/env node
/**
 * T040 — QueueSurface default-binding contract (spec 010; research R12).
 * Run: `node specs/010-background-queue-sync-hooks/contracts/queue-surface-binding.mjs`
 * — exit 0 means every check passed. Zero runtime dependencies: node: builtins + git.
 *
 * Proves 010's arrival flipped 009's seam from the while-absent surface to the REAL
 * `src/queue/` module with the frozen exit-code outcomes UNCHANGED:
 *  - five queue commands over the spawned CLI: enqueued / stopped / installed ⇒ exit 0,
 *    with real queue artifacts landing in the state dir (delegation proof);
 *  - a refused install-hooks (unknown managedGitHooks name) ⇒ exit 4 via the existing
 *    presenter (stderr only); an invalid queue knob ⇒ exit 4 with ONE combined detail;
 *  - `verify-hooks` still exits 2 — 009's map extended by NOTHING (unknown command);
 *  - the 009 exit-code table files are byte-unchanged since the feature start.
 */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const FEATURE_START = "937624a";
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

/** dist copy without worker-entry.js — enqueue auto-spawn stays a silent no-op here. */
const sandbox = mkdtempSync(join(tmpdir(), "tls-010-bind-"));
const dist = join(sandbox, "dist");
cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
cpSync(join(pkgRoot, "package.json"), join(sandbox, "package.json"));
rmSync(join(dist, "queue", "worker-entry.js"), { force: true });
const CLI = join(dist, "cli", "main.js");

/** Review-report fixture world + a real repo-root config file (identity keys included). */
function makeRepo(extraConfig = {}) {
  const world = join(pkgRoot, "tests", "fixtures", "cli", "worlds", "review-report");
  const root = mkdtempSync(join(tmpdir(), "tls-010-bind-repo-"));
  const repo = join(root, "repo");
  const state = join(root, "state");
  cpSync(join(world, "repo"), repo, { recursive: true });
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true }); // the fixture is a worktree copy without .git
  const worldConfig = JSON.parse(readFileSync(join(world, "world.json"), "utf8")).config ?? {};
  writeFileSync(
    join(repo, "task-linear-sync.json"),
    JSON.stringify({ ...worldConfig, ...extraConfig, stateDirectory: state }, null, 2) + "\n",
    "utf8",
  );
  return {
    repo,
    state,
    dispose: () => {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

function run(cwd, args, credential) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    TASK_LINEAR_SYNC_TEST_NOTIFY: join(sandbox, "notify.log"),
  };
  if (credential) env.LINEAR_ACCESS_TOKEN = "scan-dummy-token-000000000000";
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
}

try {
  const h = makeRepo();
  check("install-hooks delegates to the real surface: exit 0 + hook files", () => {
    const r = run(h.repo, ["install-hooks"], true);
    assert(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(/hooks installed: pre-push, post-merge/.test(r.stdout), r.stdout);
    assert(existsSync(join(h.repo, ".git", "hooks", "pre-push")), "hook file must exist");
  });

  check("enqueue delegates to the real surface: exit 0 + durable pending-job.json", () => {
    const r = run(h.repo, ["enqueue"], true);
    assert(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(/enqueued sync job [0-9a-f]{16}/.test(r.stdout), r.stdout);
    assert(existsSync(join(h.state, "pending-job.json")), "the real module must persist the slot");
  });

  check("last-run (no run yet) exits 0 with the frozen presentation", () => {
    const r = run(h.repo, ["last-run"], true);
    assert(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(/no run recorded yet/.test(r.stdout), r.stdout);
  });

  check("worker --once exits 0 'stopped' (degraded lane re-queues, never crashes)", () => {
    const r = run(h.repo, ["worker", "--once"], false);
    assert(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(/worker stopped after a single pass/.test(r.stdout), r.stdout);
  });

  check("install-agent-hook exits 0 with the scaffold path", () => {
    const r = run(h.repo, ["install-agent-hook", "--framework", "kiro"], true);
    assert(r.status === 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(/agent hook installed at .*\.kiro\/hooks\//.test(r.stdout), r.stdout);
  });
  h.dispose();

  const refused = makeRepo({ managedGitHooks: ["bogus-hook"] });
  check("refused install-hooks ⇒ exit 4 via the frozen presenter (stderr only, zero bytes)", () => {
    const r = run(refused.repo, ["install-hooks"], true);
    assert(r.status === 4, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    assert(r.stdout === "", `stdout must stay empty, got: ${r.stdout}`);
    assert(/refused: /.test(r.stderr), r.stderr);
    const entries = (() => {
      try {
        return readFileSync(join(refused.repo, ".git", "hooks", "pre-push"), "utf8");
      } catch {
        return null;
      }
    })();
    assert(entries === null, "a refusal writes no hook bytes");
  });
  refused.dispose();

  const invalid = makeRepo({ queue: { workerDelaySeconds: 0 } });
  check("an invalid queue knob ⇒ exit 4 with ALL bad fields in ONE detail line", () => {
    const r = run(invalid.repo, ["enqueue"], true);
    assert(r.status === 4, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
    const detailLines = r.stderr.split("\n").filter((line) => /queue\./.test(line));
    assert(detailLines.length === 1, `expected one combined detail line, got ${detailLines.length}: ${r.stderr}`);
    assert(/queue\.workerDelaySeconds/.test(detailLines[0]), detailLines[0]);
  });
  invalid.dispose();

  const bare = makeRepo();
  check("verify-hooks still exits 2 — the 009 exit-code map is extended by NOTHING", () => {
    const r = run(bare.repo, ["verify-hooks"], true);
    assert(r.status === 2, `expected USAGE_ERROR (2), got exit ${r.status}: ${r.stdout} ${r.stderr}`);
  });
  bare.dispose();

  check("the 009 exit-code table files are byte-unchanged since the feature start", () => {
    for (const target of ["specs/009-operator-cli-plan-report/contracts/command-surface.md", "docs/cli.md"]) {
      const before = execFileSync("git", ["show", `${FEATURE_START}:${target}`], { cwd: pkgRoot, encoding: "utf8" });
      const now = readFileSync(join(pkgRoot, target), "utf8");
      assert(now === before, `${target} was edited during 010`);
    }
  });
} finally {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
}

if (failures.length > 0) {
  console.log(`queue-surface-binding: ${failures.length} failing check(s)`);
  process.exit(1);
}
console.log("queue-surface-binding: all checks passed");
