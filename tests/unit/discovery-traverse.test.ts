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
import { posixOnly, withTempTree } from "../helpers/discovery-fixtures.js";

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
