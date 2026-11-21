/**
 * T013 [US1] — traversal unit tests per contracts/discovery-api.md rules 2–4 (verified
 * through the public `discoverTaskFiles` entry point, which is the only import site):
 * unlimited depth, regular-files-only, skip-directories by NAME at any depth, symlink
 * exclusion "without aborting the walk", escape refusal + continuation, unreadable SUBdir
 * as diagnostic (only the root aborts), root-relative POSIX + byte-wise lexicographic order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults, deepMerge } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveryResult } from "task-linear-sync/discovery";
import { traverseRepository } from "../../src/discovery/traverse.js";
import { posixOnly, withTempTree, fixtureRepoPath } from "../helpers/discovery-fixtures.js";

/** Discover with git off (isolate traversal); every observed open is recorded into `probePaths`. */
async function walk(
  treeRoot: string,
  config: ResolvedConfig = builtInDefaults,
  probePaths: string[] = [],
): Promise<DiscoveryResult> {
  return discoverTaskFiles({
    repositoryRoot: treeRoot,
    config,
    gitContext: false,
    openCountingProbe: (absolutePath: string) => void probePaths.push(absolutePath),
  });
}

const filePaths = (r: DiscoveryResult): string[] => r.files.map((f) => f.filePath);

test("discovery traverse: every matching regular file found to unlimited depth, root-relative POSIX, byte-wise order", async () => {
  await withTempTree(
    "traverse-depth",
    [
      { kind: "file", path: "tasks.md" },
      { kind: "file", path: "a/b/c/d/e/f/tasks.md" },
      { kind: "file", path: "a/b/TASKS.md" },
      { kind: "file", path: "b/notes.txt" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), [
        "a/b/TASKS.md",
        "a/b/c/d/e/f/tasks.md",
        "tasks.md",
      ], "'TASKS.md' sorts before lowercase 'tasks.md' (byte-wise); 'a' before 'b' region");
      assert.ok(result.root.startsWith("/"), "canonical absolute root");
    },
  );
});

test("discovery traverse: tasks.md-named DIRECTORIES are not results — only regular files match", async () => {
  await withTempTree(
    "traverse-dirdoctored",
    [
      { kind: "dir", path: "weird/tasks.md" },
      { kind: "file", path: "weird/tasks.md/inner/deeper.md" },
      { kind: "file", path: "keep/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), ["keep/tasks.md"], "directory named tasks.md excluded; its subtree still walked");
    },
  );
});

test("discovery traverse: configured skip-directories are skipped by NAME at any depth (001 R1.3)", async () => {
  await withTempTree(
    "traverse-skip",
    [
      { kind: "file", path: "libs/node_modules/x/tasks.md" },
      { kind: "file", path: "node_modules/y/tasks.md" },
      { kind: "file", path: "dist/tasks.md" },
      { kind: "file", path: ".next/tasks.md" },
      { kind: "file", path: "coverage/tasks.md" },
      { kind: "file", path: "repo/.git/objects/tasks.md" },
      { kind: "file", path: "src/tasks.md" },
      { kind: "file", path: "modules-that-stay/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), ["modules-that-stay/tasks.md", "src/tasks.md"]);
    },
  );
});

test("discovery traverse: skip set is configured — arrays replace wholesale (frozen config layer)", async () => {
  await withTempTree(
    "traverse-skip-config",
    [
      { kind: "file", path: "vendor/tasks.md" },
      { kind: "file", path: "pkg/vendor/tasks.md" },
      { kind: "file", path: "node_modules/kept/tasks.md" },
    ],
    async (tree) => {
      const config = deepMerge(builtInDefaults, { skipDirectories: ["vendor"] }) as ResolvedConfig;
      assert.deepEqual(filePaths(await walk(tree, config)), ["node_modules/kept/tasks.md"], "'vendor' skipped at any depth; the default list was REPLACED, not extended");
    },
  );
});

test("discovery traverse: task-file patterns are configured (glob) and match the BASENAME", async () => {
  await withTempTree(
    "traverse-patterns",
    [
      { kind: "file", path: "flows/todo-deploy.md" },
      { kind: "file", path: "flows/tasks.md" },
      { kind: "file", path: "todo-deploy.md" },
    ],
    async (tree) => {
      const config = deepMerge(builtInDefaults, { taskFilePatterns: ["todo-*.md"] }) as ResolvedConfig;
      assert.deepEqual(filePaths(await walk(tree, config)), ["flows/todo-deploy.md", "todo-deploy.md"]);
    },
  );
});

test("discovery traverse: symlinked task files and symlinked directories are silently excluded, walk continues (001 R1.4)", async () => {
  await withTempTree(
    "traverse-symlinks",
    [
      { kind: "file", path: "real/tasks.md" },
      { kind: "dir", path: "realdir" },
      { kind: "file", path: "realdir/hidden/tasks.md" },
      { kind: "symlink", path: "alias", target: "realdir/hidden" },
      { kind: "symlink", path: "link-to-tasks.md", target: "real/tasks.md" },
      { kind: "symlink", path: "dangling.md", target: "nope" },
      { kind: "file", path: "keep/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), ["keep/tasks.md", "real/tasks.md", "realdir/hidden/tasks.md"]);
      assert.deepEqual(result.refusals, [], "in-root symlinks are routine exclusions, not escape violations");
    },
  );
});

test("discovery traverse: symlink loop terminates, loop members absent (quickstart US1 #5)", async () => {
  await withTempTree(
    "traverse-loop",
    [
      { kind: "dir", path: "keepdir" },
      { kind: "symlink-loop", first: "keepdir/a", second: "keepdir/b" },
      { kind: "file", path: "keep/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), ["keep/tasks.md"]);
    },
  );
});

test("discovery traverse: escaping symlink → refusal { path, reason: 'escape' }, zero outside reads, discovery continues (FR-003, SC-003)", async () => {
  await withTempTree(
    "traverse-escape",
    [
      { kind: "file", path: "keep/tasks.md" },
      { kind: "file", path: "tasks.md" },
      { kind: "escaping-symlink", path: "leak/tasks.md", targetContent: "material outside the root" },
    ],
    async (tree) => {
      const opened: string[] = [];
      const result = await walk(tree, builtInDefaults, opened);
      assert.deepEqual(result.refusals, [{ path: "leak/tasks.md", reason: "escape" }]);
      assert.deepEqual(filePaths(result), ["keep/tasks.md", "tasks.md"], "remaining files still discovered");
      const root = result.root;
      for (const path of opened) {
        assert.ok(path === root || path.startsWith(`${root}/`), `probe recorded an open outside the canonical root: ${path}`);
      }
    },
  );
});

test(
  "discovery traverse: unreadable SUBdirectory is a diagnostic and the walk continues — only the root aborts (research R10, POSIX)",
  { skip: posixOnly ? false : "POSIX permission semantics required" },
  async () => {
    await withTempTree(
      "traverse-unreadable-sub",
      [
        { kind: "mode-000-dir", path: "locked", children: [{ kind: "file", path: "tasks.md" }] },
        { kind: "file", path: "sibling/tasks.md" },
      ],
      async (tree) => {
        const result = await walk(tree);
        assert.deepEqual(filePaths(result), ["sibling/tasks.md"]);
        assert.deepEqual(result.refusals, []);
        const diag = result.diagnostics.find((d) => d.path === "locked");
        assert.ok(diag, `diagnostic recorded for the unreadable subdir, got ${JSON.stringify(result.diagnostics)}`);
        assert.ok(diag.condition.includes("unreadable"), `condition names the failure, got '${diag.condition}'`);
      },
    );
  },
);

test("discovery traverse: empty tree → empty result, no error (FR-004)", async () => {
  await withTempTree("traverse-empty", [{ kind: "dir", path: "just-dirs/inner" }], async (tree) => {
    const result = await walk(tree);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.refusals, []);
    assert.deepEqual(result.diagnostics, []);
  });
});

test("discovery traverse: diagnostics and refusals are deterministically ordered by path (SC-002 covers failures)", async () => {
  await withTempTree(
    "traverse-order",
    [
      { kind: "escaping-symlink", path: "zeta/tasks.md" },
      { kind: "escaping-symlink", path: "alpha/tasks.md" },
      { kind: "escaping-symlink", path: "mid/tasks.md" },
      { kind: "file", path: "keep/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(
        result.refusals.map((r) => r.path),
        ["alpha/tasks.md", "mid/tasks.md", "zeta/tasks.md"],
        "refusals lexicographically ordered regardless of readdir order",
      );
      assert.deepEqual(filePaths(result), ["keep/tasks.md"]);
    },
  );
});

test("discovery traverse: the `kitty-specs/*/tasks/` exclusion skips per-work-package prompt dirs for EVERY adapter — `*` is exactly one segment (017 C2.5, amendment 3)", async () => {
  await withTempTree(
    "traverse-kitty-exclusion",
    [
      { kind: "file", path: "kitty-specs/launch/tasks.md" },
      { kind: "file", path: "kitty-specs/launch/tasks/WP01-setup.md" },
      { kind: "file", path: "kitty-specs/launch/tasks/tasks.md" },
      { kind: "file", path: "kitty-specs/launch/tasks/deep/tasks.md" },
      { kind: "file", path: "kitty-specs/launch/tasks2/tasks.md" },
      { kind: "file", path: "kitty-specs/tasks/tasks.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(
        filePaths(result),
        ["kitty-specs/launch/tasks.md", "kitty-specs/launch/tasks2/tasks.md", "kitty-specs/tasks/tasks.md"],
        "the mission roll-up survives; `tasks/` (and its subtree) is skipped at exactly one segment; `tasks2/` is a different name; `kitty-specs/tasks/` is a mission NAMED tasks — its roll-up syncs",
      );
    },
  );
});

test("discovery traverse: disabling spec-kitty removes its exclusion — affected files behave exactly as before 017 (C2.6, FR-011)", async () => {
  await withTempTree(
    "traverse-kitty-disabled",
    [
      { kind: "file", path: "kitty-specs/launch/tasks/tasks.md" },
      { kind: "file", path: "notes/tasks.md" },
    ],
    async (tree) => {
      const config = {
        ...structuredClone(builtInDefaults),
        frameworkAdapters: ["bmad", "spec-kit", "open-spec", "kiro", "generic"],
      } as ResolvedConfig;
      const result = await walk(tree, config);
      assert.ok(filePaths(result).includes("kitty-specs/launch/tasks/tasks.md"), "exclusion is gone with the disabled adapter");
    },
  );
});

// ── A-022-1 (022) — path-scoped candidates through traversal and the discovery union
// (contracts/spec-kitty-work-packages.md C1.1–C1.4). Pins land test-first; the row-driven
// descent goes green when T012 wires the union and T020 re-bases the row (removes the
// 017 exclusion). ───────────────────────────────────────────────────────────────────────

test("022 traverse: the task-file matcher predicate receives (name, relPath); path matchers claim non-basename files", async () => {
  await withTempTree(
    "traverse-relpath-predicate",
    [
      { kind: "file", path: "collect/a.xyz" }, // basename matches NO enabled pattern
      { kind: "file", path: "tasks.md" }, // basename matcher keeps working
    ],
    async (tree) => {
      const seenArgs: Array<[string, string]> = [];
      const output = await traverseRepository({
        root: tree,
        taskFileMatchers: [
          (name: string, relPath: string) => {
            seenArgs.push([name, relPath]);
            return name === "tasks.md";
          },
          (_name: string, relPath: string) => relPath === "collect/a.xyz",
        ],
        skipDirectoryMatchers: [],
      });
      assert.deepEqual(
        output.candidates.map((c) => c.filePath),
        ["collect/a.xyz", "tasks.md"],
        "path-aware matcher joins the candidate set",
      );
      for (const [name, relPath] of seenArgs) {
        assert.ok(!name.includes("/"), `matcher name argument is a basename (${name})`);
        assert.ok(!relPath.startsWith("/"), `relPath is root-relative POSIX (${relPath})`);
      }
    },
  );
});

test("022 traverse: basename-only matchers ignore the second argument — existing candidate sets unchanged", async () => {
  await withTempTree(
    "traverse-basename-unchanged",
    [
      { kind: "file", path: "docs/auth/tasks.md" },
      { kind: "file", path: "docs/auth/notes.md" },
      { kind: "file", path: "docs/auth/spec.md" },
    ],
    async (tree) => {
      // Default config, spec-kitty ENABLED: no path-pattern widening outside kitty-specs/,
      // so a plain docs tree discovers exactly the basename-union files, as ever.
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), ["docs/auth/tasks.md"]);
    },
  );
});

test("022 traverse: taskPathPatterns descends kitty-specs/<mission>/tasks/ and claims lane sub-folders (C1.1/C1.2)", async () => {
  await withTempTree(
    "traverse-kitty-descent",
    [
      { kind: "file", path: "kitty-specs/001-demo/tasks.md" },
      { kind: "file", path: "kitty-specs/001-demo/tasks/WP01-scaffold.md" },
      { kind: "file", path: "kitty-specs/001-demo/tasks/notes.md" },
      { kind: "file", path: "kitty-specs/001-demo/tasks/img.png" },
      { kind: "file", path: "kitty-specs/002-billing/tasks/planned/WP01-billing.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      assert.deepEqual(filePaths(result), [
        "kitty-specs/001-demo/tasks.md",
        "kitty-specs/001-demo/tasks/WP01-scaffold.md",
        "kitty-specs/001-demo/tasks/notes.md",
        "kitty-specs/002-billing/tasks/planned/WP01-billing.md",
      ], "the collection descends (flat + lane sub-folders); the roll-up stays claimed; non-.md never enters");
      assert.ok(
        result.files.every((f) => f.frameworkId === "spec-kitty" && f.adapterId === "spec-kitty"),
        "every collection file is claimed by spec-kitty — no fall-through (FR-001)",
      );
      const byPath = new Map(result.files.map((f) => [f.filePath, f.featureName ?? null]));
      assert.equal(byPath.get("kitty-specs/001-demo/tasks/WP01-scaffold.md"), "001-demo", "mission is the feature, not the folder");
      assert.equal(byPath.get("kitty-specs/001-demo/tasks/notes.md"), "001-demo");
      assert.equal(byPath.get("kitty-specs/002-billing/tasks/planned/WP01-billing.md"), "002-billing", "a lane directory is never a feature name");
      assert.ok(
        ![...result.files].some((f) => f.featureName === "tasks"),
        "feature name is NEVER the tasks folder",
      );
    },
  );
});

test("022 traverse: path matchers join the union WITHOUT widening other identities' candidates (C1.3)", async () => {
  await withTempTree(
    "traverse-union-disjoint",
    [
      { kind: "file", path: "specs/001-x/spec.md" }, // NOT a basename-union member — must stay a non-candidate
      { kind: "file", path: "specs/001-x/tasks.md" },
      { kind: "file", path: "specs/001-x/plan.md" }, // spec-kit sibling marker
      { kind: "file", path: "kitty-specs/001-demo/tasks/WP01-scaffold.md" },
    ],
    async (tree) => {
      const result = await walk(tree);
      const paths = filePaths(result);
      assert.ok(!paths.includes("specs/001-x/spec.md"), "spec.md is no one's candidate — the path union never widens basename semantics");
      const specKit = result.files.find((f) => f.filePath === "specs/001-x/tasks.md");
      assert.equal(specKit?.frameworkId, "spec-kit", "the spec-kit claim is unaffected by the kitty path patterns");
      const kitty = result.files.find((f) => f.filePath === "kitty-specs/001-demo/tasks/WP01-scaffold.md");
      assert.equal(kitty?.frameworkId, "spec-kitty");
    },
  );
});

test("022 traverse: DISABLE parity — spec-kitty off restores pre-017 fall-through byte-identically (C1.4, FR-013)", async () => {
  // Reference captured BEFORE any 022 mechanism landed (git-tracked behavior of the
  // 017 code over the reworked fixture): roll-ups fall through to `generic` with no
  // feature name; collection files are not candidates; zero diagnostics.
  const config = {
    ...structuredClone(builtInDefaults),
    frameworkAdapters: builtInDefaults.frameworkAdapters.filter((id) => id !== "spec-kitty"),
  } as ResolvedConfig;
  const result = await walk(fixtureRepoPath("spec-kitty"), config);
  assert.deepEqual(
    result.files.map((f) => ({
      filePath: f.filePath,
      frameworkId: f.frameworkId,
      adapterId: f.adapterId,
      featureName: f.featureName ?? null,
    })),
    [
      { filePath: "kitty-specs/001-demo/tasks.md", frameworkId: "generic", adapterId: "generic", featureName: null },
      { filePath: "kitty-specs/002-billing/tasks.md", frameworkId: "generic", adapterId: "generic", featureName: null },
      { filePath: "kitty-specs/003-plan-only/tasks.md", frameworkId: "generic", adapterId: "generic", featureName: null },
    ],
    "removing the row removes patterns, claims and document-mode as a unit",
  );
  assert.deepEqual(result.diagnostics, [], "fall-through produces no new diagnostics");
});
