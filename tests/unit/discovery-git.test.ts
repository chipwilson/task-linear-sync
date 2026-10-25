/**
 * T014 [US1] — git-context unit tests per FR-006 verbatim: "report available
 * version-control context (HEAD commit identifier, current branch, origin remote URL),
 * individually omitting unavailable values without failing". File-based `.git` reads only
 * (research R6) — no `git` binary, no `child_process`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { canonicalizeRepositoryRoot, discoverGitContext, discoverTaskFiles } from "task-linear-sync/discovery";
import { withGitFixture, withTempTree } from "../helpers/discovery-fixtures.js";

test("discovery git: loose-ref repo reports all three values (branch = short ref name, 40-hex commit, origin URL)", async () => {
  await withGitFixture("git-loose", async (repo) => {
    const git = await discoverGitContext(await canonicalizeRepositoryRoot(repo));
    assert.equal(git.branch, "main", "short ref name");
    assert.equal(git.headCommit, "0000000000000000000000000000000000000001");
    assert.equal(git.originRemote, "https://example.invalid/acme/repos.git", "origin url verbatim");
  });
});

test("discovery git: packed-refs repo resolves headCommit via packed-refs with no loose ref", async () => {
  await withGitFixture("git-packed", async (repo) => {
    const git = await discoverGitContext(await canonicalizeRepositoryRoot(repo));
    assert.equal(git.branch, "main");
    assert.equal(git.headCommit, "0000000000000000000000000000000000000002");
    assert.equal(git.originRemote, "https://example.invalid/acme/repos-packed.git");
  });
});

test("discovery git: detached HEAD → headCommit only, branch omitted (individually, without failing)", async () => {
  await withGitFixture("git-detached", async (repo) => {
    const git = await discoverGitContext(await canonicalizeRepositoryRoot(repo));
    assert.equal(git.headCommit, "0000000000000000000000000000000000000003");
    assert.equal("branch" in git, false, "branch omitted — not empty string");
    assert.equal(git.originRemote, "https://example.invalid/acme/repos-detached.git");
  });
});

test("discovery git: config without [remote \"origin\"] → originRemote omitted, others present", async () => {
  await withGitFixture("git-no-remote", async (repo) => {
    const git = await discoverGitContext(await canonicalizeRepositoryRoot(repo));
    assert.equal(git.branch, "main");
    assert.equal(git.headCommit, "0000000000000000000000000000000000000004");
    assert.equal("originRemote" in git, false, "originRemote omitted");
  });
});

test("discovery git: missing .git → all values omitted, a diagnostic names it, zero throws (FR-006, AC5)", async () => {
  await withGitFixture("git-none", async (repo) => {
    const canonical = await canonicalizeRepositoryRoot(repo);
    const git = await discoverGitContext(canonical);
    assert.deepEqual(git, {}, "all three values omitted");
    const result = await discoverTaskFiles({ repositoryRoot: repo, config: builtInDefaults });
    assert.deepEqual(result.git, {}, "git key present (default) but empty");
    const diag = result.diagnostics.find((d) => d.condition.includes("git"));
    assert.ok(diag, `diagnostic with a git-naming condition expected, got ${JSON.stringify(result.diagnostics)}`);
    assert.equal(diag.path, ".git");
  });
});

test("discovery git: unparsable HEAD omits branch+commit individually and records a diagnostic, never throws", async () => {
  await withTempTree(
    "git-broken-head",
    [
      { kind: "file", path: ".git/HEAD", content: "this is not a git head file !!\n" },
      { kind: "file", path: "tasks.md", content: "# Tasks\n" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults });
      assert.deepEqual(result.git, {}, "HEAD unparsable and no config → all values individually omitted");
      const diag = result.diagnostics.find((d) => d.path.includes(".git"));
      assert.ok(diag, `diagnostic for the unparsable .git source expected: ${JSON.stringify(result.diagnostics)}`);
      assert.ok(diag.condition.includes("git"), `condition names the git source problem, got '${diag.condition}'`);
      assert.deepEqual(result.files.map((f) => f.filePath), ["tasks.md"], "discovery itself unaffected");
    },
  );
});

test("discovery git: discoverGitContext on a non-repository directory never throws for availability", async () => {
  await withTempTree("git-absent", [{ kind: "file", path: "notes.md" }], async (tree) => {
    const git = await discoverGitContext(await canonicalizeRepositoryRoot(tree));
    assert.deepEqual(git, {});
  });
});

test("discovery git: one-level gitdir: indirection is followed (research R6)", async () => {
  await withTempTree(
    "git-gitfile",
    [
      { kind: "file", path: ".git", content: "gitdir: /nonexistent/gitdir-should-not-be-followed\n" },
      { kind: "file", path: "tasks.md", content: "# Tasks\n" },
    ],
    async (tree) => {
      const git = await discoverGitContext(await canonicalizeRepositoryRoot(tree));
      assert.deepEqual(git, {}, "unresolvable gitdir → all omitted, no throw");
    },
  );
  await withTempTree(
    "git-gitfile-real",
    [
      { kind: "dir", path: "worktree" },
      { kind: "dir", path: "common/refs/heads" },
      { kind: "file", path: "common/HEAD", content: "ref: refs/heads/main\n" },
      { kind: "file", path: "common/refs/heads/main", content: "0000000000000000000000000000000000000005\n" },
      { kind: "file", path: "common/config", content: '[remote "origin"]\n  url = https://example.invalid/acme/repos-gitfile.git\n' },
    ],
    async (tree) => {
      await writeFile(join(tree, "worktree/.git"), `gitdir: ${join(tree, "common")}\n`, "utf8");
      const git = await discoverGitContext(await canonicalizeRepositoryRoot(join(tree, "worktree")));
      assert.equal(git.branch, "main");
      assert.equal(git.headCommit, "0000000000000000000000000000000000000005");
      assert.equal(git.originRemote, "https://example.invalid/acme/repos-gitfile.git");
    },
  );
});
