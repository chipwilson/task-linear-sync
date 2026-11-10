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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { builtInAdapters, discoverTaskFiles } from "task-linear-sync/discovery";
import type { CustomAdapterDescriptor } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import { fixtureRepoPath, listTree, openCountingProbe, withTempTree } from "../helpers/discovery-fixtures.js";

const FIVE = fixtureRepoPath("five-frameworks");
const KITTY = fixtureRepoPath("spec-kitty");

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

test("e2e US: spec-superpower corpus (018) — dated plans selected, decoys unclaimed, repeat-run byte-identity (SC-001/SC-002)", async () => {
  const root = fixtureRepoPath("spec-superpower");
  const a = await discoverTaskFiles({ repositoryRoot: root, config: builtInDefaults });
  assert.deepEqual([...new Set(a.files.map((f) => f.frameworkId))], ["spec-superpower"]);
  assert.deepEqual(
    a.files.map((f) => f.filePath).sort(),
    [
      "docs/superpowers/plans/2026-11-01-sync.md",
      "docs/superpowers/plans/2026-11-02-auth.md",
      "docs/superpowers/plans/2026-11-09-sync.md",
    ],
  );
  const b = await discoverTaskFiles({ repositoryRoot: root, config: builtInDefaults });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("e2e US1/US3 walkthrough (018): claim → opt-out silence → per-plan parse with collision-free names, all read-only", async () => {
  const root = fixtureRepoPath("spec-superpower");
  // US1-AC1/AC4: default config claims exactly the three dated plans.
  const claimed = await discoverTaskFiles({ repositoryRoot: root, config: builtInDefaults, gitContext: false });
  assert.deepEqual(
    claimed.files.map((f) => [f.filePath, f.frameworkId, f.featureName]).sort(),
    [
      ["docs/superpowers/plans/2026-11-01-sync.md", "spec-superpower", "sync"],
      ["docs/superpowers/plans/2026-11-02-auth.md", "spec-superpower", "auth"],
      ["docs/superpowers/plans/2026-11-09-sync.md", "spec-superpower", "sync"],
    ],
    "SC-003: derived names are the date-stripped plan filenames",
  );
  // US1-AC2: removing the identity from frameworkAdapters silences it ENTIRELY —
  // with A-018-1 the decoys are unclaimed too, not silently absorbed by generic.
  const optedOut = {
    ...structuredClone(builtInDefaults),
    frameworkAdapters: builtInDefaults.frameworkAdapters.filter((id) => id !== "spec-superpower"),
  };
  const silent = await discoverTaskFiles({ repositoryRoot: root, config: optedOut, gitContext: false });
  assert.deepEqual(silent.files, [], "no config, no identity: nothing enters the sync (A-018-1)");
  // US3 plan-level surface: three tasks per plan, pairwise-distinct identities across
  // the two `sync` plans, and zero writes anywhere (Principle I).
  const before = await listTree(root);
  const uuidsByFile = new Map<string, string[]>();
  for (const file of claimed.files) {
    const row = builtInAdapters["spec-superpower"];
    const result = parseTaskFile(
      file.filePath,
      readFileSync(join(root, file.filePath), "utf8"),
      {
        id: "spec-superpower" as const,
        featureName: (p: string) => row.featureName(p),
        headingGrammar: row.headingGrammar,
        phasePattern: row.phasePattern,
        summaryPattern: row.summaryPattern,
        rollupPattern: row.rollupPattern,
        identityFileScope: row.identityFileScope,
      },
      builtInDefaults,
    );
    assert.equal(result.file.tasks.length, 3, `${file.filePath}: Task 1–3 (US3 walkthrough)`);
    assert.equal(result.warnings.length, 0, `${file.filePath}: clean fixture parses carry no warnings`);
    uuidsByFile.set(file.filePath, result.file.tasks.map((t) => t.stableUuid));
  }
  const a = new Set(uuidsByFile.get("docs/superpowers/plans/2026-11-01-sync.md"));
  for (const uuid of uuidsByFile.get("docs/superpowers/plans/2026-11-09-sync.md") as string[]) {
    assert.ok(!a.has(uuid), "two `sync` plans share no task identities (US3-AC2)");
  }
  assert.deepEqual(await listTree(root), before, "read-only walkthrough — zero filesystem writes");
});

test("e2e US: repeat-run byte-identity across the whole result (SC-002)", async () => {
  const a = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  const b = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("e2e US: spec-kitty zero-config walkthrough — the id set keyed off builtInAdapters, spec-kitty included (017 US1)", async () => {
  const kitty = await discoverTaskFiles({ repositoryRoot: KITTY, config: builtInDefaults, gitContext: false });
  assert.deepEqual(
    kitty.files.map((f) => [f.filePath, f.frameworkId, f.featureName]),
    [
      ["kitty-specs/001-demo/tasks.md", "spec-kitty", "001-demo"],
      ["kitty-specs/002-billing/tasks.md", "spec-kitty", "002-billing"],
    ],
    "zero configuration keys: the mission directory is the Feature_Name (US1-AC2)",
  );
  const five = await discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults });
  const superpower = await discoverTaskFiles({ repositoryRoot: fixtureRepoPath("spec-superpower"), config: builtInDefaults, gitContext: false });
  const seen = new Set<string>([
    ...five.files.map((f) => f.frameworkId),
    ...kitty.files.map((f) => f.frameworkId),
    ...superpower.files.map((f) => f.frameworkId),
  ]);
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(builtInAdapters).sort(),
    "the fixture set together exercises EVERY built-in identity (seven since 017/018)",
  );
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
  const repos = ["five-frameworks", "spec-kitty", "empty", "no-task-files", "git-loose", "git-packed", "git-detached", "git-no-remote", "git-none"];
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
