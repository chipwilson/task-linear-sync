/**
 * T034 — Managed hook + agent-scaffold installation over the SPAWNED CLI (spec 010 US3;
 * quickstart §3.1/§3.2/§3.4). The real `dist/cli/main.js` binds the production surface, so
 * this lane proves FR-006 idempotency, SC-003 byte preservation (strip the managed range,
 * remaining bytes equal the pre-install text exactly), the FR-006 vocabulary refusal at
 * exit 4 with ZERO bytes under `.git/hooks`, and FR-009 agent scaffolds: kiro directory,
 * additive `event`/`pathPatterns` enrichment, and the never-overwrite `-2` collision rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { makeQueueHarness, stripHookBlock } from "../helpers/queue-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url)); // build/tests/integration → repo root

/** Dist copy without `worker-entry.js` — no install lane can trigger a background drain. */
function makeCliSandbox(): { bin: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tls-010-cli-"));
  const dist = join(root, "dist");
  cpSync(join(pkgRoot, "dist"), dist, { recursive: true });
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

function envBase(h: { notifySinkPath: string }): Record<string, string> {
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

const HOOK_MARK = "# >>> task-linear-sync managed hooks v1 >>>";
const CANONICAL_BLOCK = [
  HOOK_MARK,
  '"task-linear-sync" last-run 1>&2 || true',
  '"task-linear-sync" enqueue 1>&2 || true',
  "# <<< task-linear-sync managed hooks v1 <<<",
].join("\n");

function hooksDir(h: { repositoryRoot: string }): string {
  return join(h.repositoryRoot, ".git", "hooks");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("install-hooks installs the default managed set with the canonical block and re-runs byte-identically (FR-006)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const first = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h));
    assert.equal(first.status, 0, `stdout=${first.stdout} stderr=${first.stderr}`);
    assert.match(first.stdout, /^hooks installed: pre-push, post-merge/m);

    const dir = hooksDir(h);
    const body = readFileSync(join(dir, "pre-push"), "utf8");
    assert.equal(body, `#!/bin/sh\n${CANONICAL_BLOCK}\n`, "canonical block with the default prefix");
    assert.ok(statSync(join(dir, "pre-push")).mode & 0o111, "executable bit set");
    assert.ok(statSync(join(dir, "post-merge")).mode & 0o111);
    assert.ok(!body.includes(h.repositoryRoot) && !body.includes(h.root), "no machine paths in the block");

    const snapshotPre = readFileSync(join(dir, "pre-push"));
    const snapshotPost = readFileSync(join(dir, "post-merge"));
    const second = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h));
    assert.equal(second.status, 0, `stdout=${second.stdout} stderr=${second.stderr}`);
    assert.equal(occurrences(readFileSync(join(dir, "pre-push"), "utf8"), HOOK_MARK), 1, "no second block on re-run");
    assert.deepEqual(readFileSync(join(dir, "pre-push")), snapshotPre, "re-install touches zero bytes");
    assert.deepEqual(readFileSync(join(dir, "post-merge")), snapshotPost);
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("queue.hookScriptPrefix re-configures the command token inside the managed block", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness({ queue: { hookScriptPrefix: "tls-hook" } });
  try {
    const r = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h));
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    const body = readFileSync(join(hooksDir(h), "pre-push"), "utf8");
    assert.match(body, /^"tls-hook" last-run 1>&2 \|\| true$/m);
    assert.match(body, /^"tls-hook" enqueue 1>&2 \|\| true$/m);
    assert.ok(body.includes(HOOK_MARK), "markers stay keyed by toolId, not the prefix");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("SC-003 byte preservation: stripping the managed range leaves the pre-install bytes exactly", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness();
  try {
    const user = "#!/bin/sh\n# tenant-owned merge gate\necho user merge work\n";
    writeFileSync(join(hooksDir(h), "post-merge"), user, { mode: 0o700 });

    const r = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h));
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);

    const body = readFileSync(join(hooksDir(h), "post-merge"), "utf8");
    assert.ok(body.startsWith(user), "user bytes byte-identical at the top");
    assert.equal(occurrences(body, CANONICAL_BLOCK), 1, "exactly one managed region");
    assert.equal(stripHookBlock(body), user, "every remaining byte equals the pre-install text");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("an unsupported managedGitHooks name exits 4 and writes NOTHING under .git/hooks (FR-006)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness({ config: { managedGitHooks: ["post-merge", "bogus-hook"] } });
  try {
    const r = spawnCli(cli.bin, ["install-hooks"], h.repositoryRoot, envBase(h));
    assert.equal(r.status, 4, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(r.stdout, "", "refusals present on stderr only");
    assert.match(r.stderr, /refused: unknown git hook name\(s\): bogus-hook/);
    assert.ok(readdirSync(hooksDir(h)).length === 0, "vocabulary gate precedes every write");
  } finally {
    h.dispose();
    cli.dispose();
  }
});

test("install-agent-hook --framework kiro lands under .kiro/hooks and never overwrites (FR-009)", async () => {
  const cli = makeCliSandbox();
  const h = await makeHarness({ taskFilePatterns: ["specs/**/*.md"] });
  try {
    const dir = join(h.repositoryRoot, ".kiro", "hooks");
    const first = spawnCli(cli.bin, ["install-agent-hook", "--framework", "kiro"], h.repositoryRoot, envBase(h));
    assert.equal(first.status, 0, `stdout=${first.stdout} stderr=${first.stderr}`);
    assert.match(first.stdout, new RegExp(`agent hook installed at .*\\.kiro/hooks/task-linear-sync-sync\\.json`));

    const target = join(dir, "task-linear-sync-sync.json");
    const scaffold = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    // 003 template preserved verbatim, enriched ADDITIVELY (hook-installation.md §2).
    assert.equal(scaffold.name, "task-linear-sync-sync");
    assert.equal(scaffold.action, "command");
    assert.equal(scaffold.command, "task-linear-sync enqueue");
    assert.equal(scaffold.event, "post-file-save");
    assert.deepEqual(scaffold.pathPatterns, ["specs/**/*.md"]);

    const snapshot = readFileSync(target);
    const second = spawnCli(cli.bin, ["install-agent-hook", "--framework", "kiro"], h.repositoryRoot, envBase(h));
    assert.equal(second.status, 0, `stdout=${second.stdout} stderr=${second.stderr}`);
    assert.match(second.stdout, /agent hook installed at .*task-linear-sync-sync-2\.json/, "collision suffix -2");
    assert.deepEqual(readFileSync(target), snapshot, "the existing file stays byte-unchanged");
    assert.deepEqual(readdirSync(dir).sort(), ["task-linear-sync-sync-2.json", "task-linear-sync-sync.json"]);
  } finally {
    h.dispose();
    cli.dispose();
  }
});
