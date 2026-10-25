/**
 * T035 — scripted end-to-end walkthrough of the spec's user stories (zero network):
 * five-frameworks discovery with identities + siblings + git context in one flow;
 * repeat-run byte-identity (SC-002); a custom-adapter override run (FR-011) where the
 * custom row beats built-in markers; an escape fixture refused with 0 out-of-root opens
 * (SC-003); and the read-only posture proven by a final recursive stat of every fixture
 * repository (Principle I — 0 created files or directories).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { CustomAdapterDescriptor } from "task-linear-sync/discovery";
import { fixtureRepoPath, listTree, openCountingProbe, withTempTree } from "../helpers/discovery-fixtures.js";

const FIVE = fixtureRepoPath("five-frameworks");

const CUSTOM: CustomAdapterDescriptor = {
  id: "acme-flow", // placeholder identity only (zero org literals — constitution III)
  taskFilePatterns: ["todo-*.md"],
  baseDirectories: ["flows/"],
  headingGrammar: "^#{2,4}\\s+(?<id>F\\d+)[.:]?\\s+(?<title>.+)$",
};

test("e2e US: five-frameworks in one flow — all five identities, siblings, and the git context land together", async () => {
  const result = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  assert.deepEqual(
    [...new Set(result.files.map((f) => f.frameworkId))].sort(),
    ["bmad", "generic", "kiro", "open-spec", "spec-kit"],
    "SC-001: every framework in the corpus identified",
  );
  const byPath = new Map(result.files.map((f) => [f.filePath, f]));
  assert.equal(byPath.get(".kiro/specs/auth/tasks.md")?.featureName, "auth");
  assert.deepEqual(byPath.get("specs/pay/tasks.md")?.siblingDocuments, ["specs/pay/spec.md", "specs/pay/plan.md"]);
  assert.equal("git" in result, true, "git context present by default");
  assert.deepEqual(result.git, {}, "the fixture is not a git repository — values omitted WITHOUT failing (FR-006)");
  assert.ok(result.diagnostics.some((d) => d.path === ".git" && d.condition.includes("git")));
});

test("e2e US: repeat-run byte-identity across the whole result (SC-002)", async () => {
  const a = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  const b = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("e2e US: override run — the custom adapter wins over built-in markers on flows/** (FR-011)", async () => {
  await withTempTree(
    "e2e-custom-win",
    [
      // An open-spec sibling marker sits NEXT to the task file — but the custom path match is longer.
      { kind: "file", path: "flows/todo-deploy.md" },
      { kind: "file", path: "flows/openspec.json" },
      { kind: "file", path: ".kiro/specs/auth/tasks.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false, overrides: { customAdapters: [CUSTOM] } });
      const byPath = new Map(result.files.map((f) => [f.filePath, f]));
      const winner = byPath.get("flows/todo-deploy.md");
      assert.ok(winner, "custom pattern todo-*.md makes the file a candidate");
      assert.equal(winner.frameworkId, "acme-flow", "longest-pattern rank: `flows/` beats the siblings-only open-spec match");
      assert.deepEqual(winner.detection.candidates, ["acme-flow", "open-spec"]);
      assert.equal(byPath.get(".kiro/specs/auth/tasks.md")?.frameworkId, "kiro", "built-ins keep working beside the custom row");
    },
  );
});

test("e2e US: escape fixture — refusal recorded with 0 opens outside the canonical root, remaining files found (SC-003)", async () => {
  await withTempTree(
    "e2e-escape",
    [
      { kind: "file", path: "specs/pay/tasks.md" },
      { kind: "file", path: "specs/pay/spec.md" },
      { kind: "escaping-symlink", path: "leak/tasks.md", targetContent: "outside" },
    ],
    async (tree) => {
      const { probe, paths } = openCountingProbe();
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false, openCountingProbe: probe });
      assert.deepEqual(result.refusals, [{ path: "leak/tasks.md", reason: "escape" }]);
      assert.deepEqual(result.files.map((f) => f.filePath), ["specs/pay/tasks.md"]);
      assert.equal(result.files[0]?.frameworkId, "spec-kit");
      const root = result.root;
      assert.ok(paths.length > 0);
      for (const opened of paths) assert.ok(opened === root || opened.startsWith(`${root}/`), `read outside the canonical root: ${opened}`);
    },
  );
});

test("e2e US: read-only posture — 0 files or directories created across every fixture repo (Principle I)", async () => {
  const repos = ["five-frameworks", "empty", "no-task-files", "git-loose", "git-packed", "git-detached", "git-no-remote", "git-none"];
  const before = new Map<string, string[]>();
  for (const name of repos) before.set(name, await listTree(fixtureRepoPath(name)));
  for (const name of repos) {
    const result = await discoverTaskFiles({ repositoryRoot: fixtureRepoPath(name), config: builtInDefaults });
    assert.ok(Array.isArray(result.files));
  }
  for (const name of repos) {
    assert.deepEqual(await listTree(fixtureRepoPath(name)), before.get(name), `${name}: nothing written`);
  }
});
