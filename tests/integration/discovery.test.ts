/**
 * T015 [US1] — integration tests over the committed fixture corpus + runtime adversarial
 * temp trees, per quickstart US1 table (test names contain "discovery"):
 * full path sets, empty repos, root-abort × open-probe-0, escaping symlink refusal with
 * zero outside reads, symlink-loop termination, determinism byte-compare (SC-002),
 * sibling resolution, git-context on/off, and the read-only posture (zero writes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveryRootError } from "task-linear-sync/discovery";
import { listTree, openCountingProbe, posixOnly, withTempTree } from "../helpers/discovery-fixtures.js";
import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";

const FIVE = fixtureRepoPath("five-frameworks");

const filePaths = (files: readonly { filePath: string }[]): string[] => files.map((f) => f.filePath);

test("discovery: five-frameworks path set — every pattern-matching regular file once, root-relative POSIX, byte-identical order", async () => {
  const result = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults, gitContext: false });
  assert.deepEqual(filePaths(result.files), [
    ".kiro/specs/auth/tasks.md",
    "bmad/epic-1/tasks.md",
    "docs/extra/tasks.md",
    "notes/tasks.md",
    "openspec/cart/tasks.md",
    "specs/deep/nested/pay/tasks.md",
    "specs/no-sibs/tasks.md",
    "specs/pay/tasks.md",
    "tasks.md",
  ]);
  for (const f of result.files) {
    assert.ok(!f.filePath.startsWith("/"), `root-relative: ${f.filePath}`);
    assert.ok(!f.filePath.includes("\\"), `POSIX separators: ${f.filePath}`);
    assert.ok(!f.filePath.includes(".."), `no dot segments: ${f.filePath}`);
  }
  assert.equal(new Set(result.files.map((f) => f.filePath)).size, result.files.length, "unique within the result");
  const sorted = [...filePaths(result.files)].sort();
  assert.deepEqual(filePaths(result.files), sorted, "byte-wise lexicographic order");
});

test("discovery: empty repo and no-task-files repo return empty results without error (FR-004, AC2)", async () => {
  for (const name of ["empty", "no-task-files"]) {
    const result = await discoverTaskFiles({ repositoryRoot: fixtureRepoPath(name), config: builtInDefaults, gitContext: false });
    assert.deepEqual(result.files, [], `${name}: files: []`);
    assert.deepEqual(result.refusals, []);
    assert.ok(result.root.startsWith("/"));
  }
});

test("discovery: missing root aborts with the named condition and ZERO file reads (FR-002, AC3)", async () => {
  const { probe, paths } = openCountingProbe();
  const err = (await discoverTaskFiles({
    repositoryRoot: join(fixtureRepoPath("does-not-exist"), "anywhere"),
    config: builtInDefaults,
    openCountingProbe: probe,
  }).catch((e: unknown) => e)) as DiscoveryRootError;
  assert.equal(err.name, "DiscoveryRootError");
  assert.equal(err.condition, "missing");
  assert.ok(err.message.includes("missing"));
  assert.deepEqual(paths, [], "open-counting probe records 0 reads on root abort");
});

test("discovery: file-as-root aborts with condition 'not-a-directory' and zero file reads (FR-002)", async () => {
  const { probe, paths } = openCountingProbe();
  const err = (await discoverTaskFiles({
    repositoryRoot: join(fixtureRepoPath("no-task-files"), "README.md"),
    config: builtInDefaults,
    openCountingProbe: probe,
  }).catch((e: unknown) => e)) as DiscoveryRootError;
  assert.equal(err.condition, "not-a-directory");
  assert.ok(err.message.includes("not-a-directory"));
  assert.deepEqual(paths, []);
});

test(
  "discovery: mode-000 root aborts with condition 'unreadable' and zero file reads (FR-002, POSIX)",
  { skip: posixOnly ? false : "POSIX permission semantics required" },
  async () => {
    await withTempTree("integration-root-unreadable", [{ kind: "mode-000-dir", path: "locked" }], async (tree) => {
      const { probe, paths } = openCountingProbe();
      const err = (await discoverTaskFiles({
        repositoryRoot: join(tree, "locked"),
        config: builtInDefaults,
        openCountingProbe: probe,
      }).catch((e: unknown) => e)) as DiscoveryRootError;
      assert.equal(err.condition, "unreadable");
      assert.ok(err.message.includes("unreadable"));
      assert.deepEqual(paths, [], "aborts with no file reads");
    });
  },
);

test("discovery: escaping symlink → refusal recorded, 0 opens outside the canonical root, remaining files discovered (FR-003, SC-003)", async () => {
  await withTempTree(
    "integration-escape",
    [
      { kind: "file", path: "keep/tasks.md" },
      { kind: "file", path: "tasks.md" },
      { kind: "dir", path: "nested" },
      { kind: "escaping-symlink", path: "nested/leak.md", targetContent: "outside material" },
      { kind: "escaping-symlink", path: "leak/tasks.md", targetContent: "outside material" },
    ],
    async (tree) => {
      const { probe, paths } = openCountingProbe();
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false, openCountingProbe: probe });
      assert.deepEqual(result.refusals.map((r) => r.path), ["leak/tasks.md", "nested/leak.md"], "every escape attempt reported, ordered");
      for (const r of result.refusals) assert.equal(r.reason, "escape");
      assert.deepEqual(filePaths(result.files), ["keep/tasks.md", "tasks.md"], "discovery continues for remaining files");
      const root = result.root;
      assert.ok(paths.length > 0, "the walk opened directories inside the root");
      for (const opened of paths) {
        assert.ok(opened === root || opened.startsWith(`${root}/`), `read outside the canonical root: ${opened}`);
      }
    },
  );
});

test("discovery: symlink loop terminates, loop members absent (001 R1.4)", async () => {
  await withTempTree(
    "integration-loop",
    [
      { kind: "dir", path: "keepdir" },
      { kind: "symlink-loop", first: "keepdir/a", second: "keepdir/b" },
      { kind: "file", path: "keep/tasks.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false });
      assert.deepEqual(filePaths(result.files), ["keep/tasks.md"]);
    },
  );
});

test("discovery: determinism — two consecutive runs byte-for-byte identical incl. ordering (SC-002)", async () => {
  const a = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  const b = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-identical serialized DiscoveryResult");
  assert.deepEqual(
    filePaths(a.files),
    [...filePaths(a.files)].sort(),
    "lexicographically ordered path lists",
  );
});

test("discovery: sibling documents — existing configured siblings root-relative in configured-list order; absent omitted without error (FR-005, US1 #8)", async () => {
  const result = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults, gitContext: false });
  const byPath = new Map(result.files.map((f) => [f.filePath, f]));
  // Configured siblings (generic/config layer): spec.md, plan.md, research.md.
  assert.deepEqual(byPath.get("specs/pay/tasks.md")?.siblingDocuments, ["specs/pay/spec.md", "specs/pay/plan.md"]);
  assert.deepEqual(byPath.get("specs/deep/nested/pay/tasks.md")?.siblingDocuments, ["specs/deep/nested/pay/spec.md"]);
  assert.deepEqual(byPath.get("specs/no-sibs/tasks.md")?.siblingDocuments, [], "absent siblings omitted WITHOUT error");
  assert.deepEqual(byPath.get("notes/tasks.md")?.siblingDocuments, []);
});

test("discovery: gitContext:false omits the git value; default includes it — fixture without .git yields an empty context + diagnostic (FR-006)", async () => {
  const off = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults, gitContext: false });
  assert.equal("git" in off, false, "omitted entirely when gitContext: false");
  assert.deepEqual(off.diagnostics, [], "no git diagnostics requested either");
  const on = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  assert.equal("git" in on, true, "present by default");
  assert.deepEqual(on.git, {}, "five-frameworks is not a git repository — all values omitted, run NOT failed");
  assert.ok(on.diagnostics.some((d) => d.path === ".git" && d.condition.includes("git")));
});

test("discovery: read-only posture — zero files or directories created in any fixture repo (Principle I)", async () => {
  const repos = ["five-frameworks", "empty", "no-task-files", "git-loose", "git-packed", "git-detached", "git-no-remote", "git-none"];
  const before = new Map<string, string[]>();
  for (const name of repos) before.set(name, await listTree(fixtureRepoPath(name)));
  for (const name of repos) {
    await discoverTaskFiles({ repositoryRoot: fixtureRepoPath(name), config: builtInDefaults });
  }
  for (const name of repos) {
    assert.deepEqual(await listTree(fixtureRepoPath(name)), before.get(name), `${name} unchanged`);
  }
});
