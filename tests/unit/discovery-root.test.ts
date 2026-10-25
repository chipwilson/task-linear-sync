/**
 * T006 [Foundational] — root canonicalization + escape-guard unit tests per
 * contracts/discovery-api.md rules 1 + 3: `canonicalizeRepositoryRoot` returns "an absolute,
 * link-resolved path" (FR-001); the pre-flight probe throws `DiscoveryRootError` with the
 * condition exactly one of "missing" | "not-a-directory" | "unreadable", the error text
 * naming the failing condition (FR-002); `verifyInsideRoot` performs a separator-bounded
 * containment compare (research R4) so the common-prefix sibling is correctly refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeRepositoryRoot, verifyInsideRoot } from "task-linear-sync/discovery";
import { fixtureRepoPath, posixOnly, withTempTree } from "../helpers/discovery-fixtures.js";

test("discovery root: canonicalize returns an absolute, link-resolved path (FR-001)", async () => {
  await withTempTree("root-canonical", [{ kind: "dir", path: "real" }, { kind: "symlink", path: "link", target: "real" }], async (tree) => {
    const canonical = await canonicalizeRepositoryRoot(tree);
    assert.equal(canonical, await realpath(tree), "already-canonical input is stable");
    assert.ok(canonical.startsWith("/"), "absolute path");
    assert.equal(
      await canonicalizeRepositoryRoot(join(tree, "link")),
      await canonicalizeRepositoryRoot(join(tree, "real")),
      "symlinked root components are resolved to the same canonical path",
    );
  });
});

test("discovery root: relative segments and relative input paths are resolved (FR-001)", async () => {
  await withTempTree("root-relative", [{ kind: "dir", path: "a/b" }, { kind: "dir", path: "c" }], async (tree) => {
    assert.equal(
      await canonicalizeRepositoryRoot(join(tree, "a", "..", "c", ".")),
      await canonicalizeRepositoryRoot(join(tree, "c")),
      "relative segments removed",
    );
  });
  // Relative input resolves against the process cwd (repo root during test runs).
  const viaRelative = await canonicalizeRepositoryRoot("tests/fixtures/repos/discovery/empty");
  assert.equal(viaRelative, await canonicalizeRepositoryRoot(fixtureRepoPath("empty")));
});

test("discovery root: missing root aborts with condition 'missing' naming the failing condition (FR-002)", async () => {
  await withTempTree("root-missing", [], async (tree) => {
    const requested = join(tree, "does-not-exist");
    const err = await canonicalizeRepositoryRoot(requested).catch((e: unknown) => e);
    assert.ok(err instanceof Error, "throws an Error");
    assert.equal((err as { name?: string }).name, "DiscoveryRootError");
    assert.equal((err as { condition?: string }).condition, "missing");
    assert.equal((err as { requestedPath?: string }).requestedPath, requested, "reports the requested path");
    assert.ok(
      (err as Error).message.includes("missing") && (err as Error).message.includes(requested),
      "error text names the failing condition",
    );
  });
});

test("discovery root: a file passed as root aborts with condition 'not-a-directory' (FR-002)", async () => {
  const fileAsRoot = join(fixtureRepoPath("no-task-files"), "README.md");
  const err = await canonicalizeRepositoryRoot(fileAsRoot).catch((e: unknown) => e);
  assert.ok(err instanceof Error, "throws an Error");
  assert.equal((err as { name?: string }).name, "DiscoveryRootError");
  assert.equal((err as { condition?: string }).condition, "not-a-directory");
  assert.ok((err as Error).message.includes("not-a-directory"), "error text names the failing condition");
});

test(
  "discovery root: unreadable directory root aborts with condition 'unreadable' (FR-002, POSIX)",
  { skip: posixOnly ? false : "POSIX permission semantics required" },
  async () => {
    await withTempTree("root-unreadable", [{ kind: "mode-000-dir", path: "locked" }], async (tree) => {
      const err = await canonicalizeRepositoryRoot(join(tree, "locked")).catch((e: unknown) => e);
      assert.ok(err instanceof Error, "throws an Error");
      assert.equal((err as { name?: string }).name, "DiscoveryRootError");
      assert.equal((err as { condition?: string }).condition, "unreadable");
      assert.ok((err as Error).message.includes("unreadable"), "error text names the failing condition");
    });
  },
);

test(
  "discovery root: the failing conditions span exactly the three FR-002 states (POSIX)",
  { skip: posixOnly ? false : "POSIX permission semantics required" },
  async () => {
    const conditions = new Set<string>();
    await withTempTree("root-conditions", [{ kind: "mode-000-dir", path: "locked" }], async (tree) => {
      for (const path of [join(tree, "nope"), fixtureRepoPath("no-task-files/README.md"), join(tree, "locked")]) {
        const err = (await canonicalizeRepositoryRoot(path).catch((e: unknown) => e)) as { condition?: string };
        conditions.add(String(err.condition));
      }
    });
    assert.deepEqual([...conditions].sort(), ["missing", "not-a-directory", "unreadable"]);
  },
);

test("discovery root: verifyInsideRoot — inside and the root itself pass; outside is refused (FR-003)", async () => {
  await withTempTree(
    "root-guard-basic",
    [{ kind: "file", path: "a/b/c.md" }, { kind: "dir", path: "empty-dir" }],
    async (tree) => {
      const root = await canonicalizeRepositoryRoot(tree);
      assert.equal(await verifyInsideRoot(root, join(root, "a/b/c.md")), true, "regular file inside");
      assert.equal(await verifyInsideRoot(root, join(root, "empty-dir")), true, "directory inside");
      assert.equal(await verifyInsideRoot(root, root), true, "the canonical root itself");
      assert.equal(await verifyInsideRoot(root, "/"), false, "filesystem root is outside");
      assert.equal(await verifyInsideRoot(root, join(root, "a", "..", "..")), false, "'..' escaping resolves outside");
    },
  );
});

test("discovery root: verifyInsideRoot refuses the common-prefix sibling path (/work/repo-evil vs /work/repo)", async () => {
  await withTempTree("root-guard-prefix", [{ kind: "file", path: "tasks.md" }], async (tree) => {
    const root = await canonicalizeRepositoryRoot(tree);
    const evil = `${root}-evil`;
    await mkdir(evil, { recursive: true });
    try {
      assert.equal(await verifyInsideRoot(root, evil), false, "separator-bounded prefix compare refuses the sibling");
      assert.equal(await verifyInsideRoot(root, join(evil, "tasks.md")), false, "and its children");
    } finally {
      await rm(evil, { recursive: true, force: true });
    }
  });
});

test("discovery root: verifyInsideRoot refuses a symlinked subdirectory resolving outside the root (research R4)", async () => {
  await withTempTree(
    "root-guard-link",
    [
      { kind: "file", path: "keep/tasks.md", content: "inside\n" },
      { kind: "escaping-symlink", path: "escape-dir", targetContent: "outside the root\n" },
    ],
    async (tree) => {
      const root = await canonicalizeRepositoryRoot(tree);
      assert.equal(await verifyInsideRoot(root, join(root, "keep/tasks.md")), true, "normal file still inside");
      assert.equal(await verifyInsideRoot(root, join(root, "escape-dir")), false, "link resolving outside is refused");
      assert.equal(await verifyInsideRoot(root, join(root, "escape-dir", "tasks.md")), false, "under the escaping link is refused");
    },
  );
});

test("discovery root: verifyInsideRoot refuses a missing candidate rather than throwing", async () => {
  await withTempTree("root-guard-missing", [{ kind: "dir", path: "d" }], async (tree) => {
    const root = await canonicalizeRepositoryRoot(tree);
    assert.equal(await verifyInsideRoot(root, join(root, "gone", "deep", "tasks.md")), false);
  });
});
