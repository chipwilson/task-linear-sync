/**
 * T025 [US2] — adapter contract test per FR-011 verbatim (contracts/framework-adapter.md
 * rule 5): a minimal `{ id, taskFilePatterns, baseDirectories, headingGrammar }` custom
 * adapter is accepted and selectable; incomplete descriptors abort with `CustomAdapterError`
 * naming EVERY missing required part at once (002 fail-fast-and-complete precedent);
 * duplicate/shadowing built-in ids are rejected by default (data-model §5); and
 * `frameworkMetadataFragment` yields exactly the frozen 002 `FrameworkMetadata` field set
 * (FR-009 input posture, research R5 — `localTaskId` lands post-parse in 004, absent here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import {
  CustomAdapterError,
  createAdapterRegistry,
  discoverTaskFiles,
  frameworkMetadataFragment,
} from "task-linear-sync/discovery";
import type { CustomAdapterDescriptor } from "task-linear-sync/discovery";
import { withTempTree } from "../helpers/discovery-fixtures.js";

const MINIMAL: CustomAdapterDescriptor = {
  id: "my-flow",
  taskFilePatterns: ["todo-*.md"],
  baseDirectories: ["flows/"],
  headingGrammar: "T\\d{3}",
};

test("discovery adapter contract: a minimal custom descriptor is registry-visible with the declared conventions", () => {
  const registry = createAdapterRegistry(builtInDefaults, { customAdapters: [MINIMAL] });
  const custom = registry.enabledAdapters.find((adapter) => adapter.id === "my-flow");
  assert.ok(custom, "custom adapter in the enabled pool");
  assert.equal(custom.headingGrammar, "T\\d{3}");
  assert.deepEqual(custom.baseDirectories, ["flows/"]);
  assert.deepEqual(custom.taskFilePatterns, ["todo-*.md"]);
  assert.ok(Object.isFrozen(custom), "custom adapters are materialized immutably like built-ins");
});

test("discovery adapter contract: the custom adapter is selectable — it wins on flows/** and its id is the framework identity", async () => {
  await withTempTree(
    "custom-selectable",
    [
      { kind: "file", path: "flows/todo-deploy.md" },
      { kind: "file", path: "todo-deploy.md" },
      { kind: "file", path: "tasks.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({
        repositoryRoot: tree,
        config: builtInDefaults,
        gitContext: false,
        overrides: { customAdapters: [MINIMAL] },
      });
      const byPath = new Map(result.files.map((f) => [f.filePath, f]));
      assert.equal(byPath.get("flows/todo-deploy.md")?.frameworkId, "my-flow", "detection wins on flows/** paths");
      assert.equal(byPath.get("flows/todo-deploy.md")?.detection.via, "path");
      assert.equal(byPath.get("todo-deploy.md")?.frameworkId, "generic", "outside flows/ → generic fallback");
      assert.equal(byPath.get("tasks.md")?.frameworkId, "generic");
    },
  );
});

test("discovery adapter contract: incomplete descriptors abort naming EVERY missing required part at once (002 precedent)", () => {
  assert.throws(
    () => createAdapterRegistry(builtInDefaults, { customAdapters: [{ id: "bad" } as unknown as CustomAdapterDescriptor] }),
    (err: unknown) => {
      if (!(err instanceof CustomAdapterError)) throw new Error(`expected CustomAdapterError, got ${String(err)}`);
      assert.equal(err.adapterId, "bad");
      assert.deepEqual([...err.missing].sort(), ["baseDirectories", "headingGrammar", "taskFilePatterns"], "every miss listed in one error");
      assert.match(err.message, /taskFilePatterns/);
      assert.match(err.message, /baseDirectories/);
      assert.match(err.message, /headingGrammar/);
      return true;
    },
  );
});

test("discovery adapter contract: an absent id is one of the listed misses", () => {
  assert.throws(
    () =>
      createAdapterRegistry(builtInDefaults, {
        customAdapters: [{ taskFilePatterns: ["t.md"], baseDirectories: ["x/"], headingGrammar: "H" } as unknown as CustomAdapterDescriptor],
      }),
    (err: unknown) => {
      if (!(err instanceof CustomAdapterError)) throw new Error(`expected CustomAdapterError, got ${String(err)}`);
      assert.ok(err.missing.includes("id"), `id named among the misses: ${JSON.stringify(err.missing)}`);
      return true;
    },
  );
});

test("discovery adapter contract: an invalid heading-grammar regex source is reported as the failing required part", () => {
  assert.throws(
    () => createAdapterRegistry(builtInDefaults, { customAdapters: [{ ...MINIMAL, headingGrammar: "T(unclosed" }] }),
    (err: unknown) => {
      if (!(err instanceof CustomAdapterError)) throw new Error(`expected CustomAdapterError, got ${String(err)}`);
      assert.deepEqual(err.missing, ["headingGrammar"]);
      return true;
    },
  );
});

test("discovery adapter contract: an id shadowing a built-in is rejected by default; explicit shadowBuiltInId opts in and REPLACES the built-in row", () => {
  const shadowing: CustomAdapterDescriptor = { ...MINIMAL, id: "kiro", taskFilePatterns: ["tasks.md"], baseDirectories: [".kiro/specs/"] };
  assert.throws(
    () => createAdapterRegistry(builtInDefaults, { customAdapters: [shadowing] }),
    (err: unknown) => {
      if (!(err instanceof CustomAdapterError)) throw new Error(`expected CustomAdapterError, got ${String(err)}`);
      assert.equal(err.adapterId, "kiro");
      assert.match(err.message, /conflict/i, "a conflict — not a missing-part — diagnostic");
      return true;
    },
  );
  const registry = createAdapterRegistry(builtInDefaults, {
    customAdapters: [{ ...shadowing, headingGrammar: "SHADOW", shadowBuiltInId: true } as CustomAdapterDescriptor & { shadowBuiltInId: boolean }],
  });
  const kiros = registry.enabledAdapters.filter((adapter) => adapter.id === "kiro");
  assert.equal(kiros.length, 1, "exactly one kiro row — the custom shadow replaced the built-in");
  assert.equal(kiros[0]?.headingGrammar, "SHADOW");
});

test("discovery adapter contract: frameworkMetadataFragment yields exactly the frozen 002 FrameworkMetadata field set", async () => {
  await withTempTree(
    "metadata-fragment",
    [
      { kind: "file", path: ".kiro/specs/auth/tasks.md" },
      { kind: "file", path: ".kiro/specs/auth/requirements.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false });
      const discovered = result.files[0];
      assert.equal(discovered?.frameworkId, "kiro");
      const fragment = frameworkMetadataFragment(discovered!);
      assert.deepEqual(Object.keys(fragment).sort(), ["featureName", "filePath", "frameworkId"]);
      assert.equal(fragment.frameworkId, "kiro");
      assert.equal(fragment.filePath, ".kiro/specs/auth/tasks.md");
      assert.equal(fragment.featureName, "auth");
      assert.equal("localTaskId" in fragment, false, "localTaskId appears POST-PARSE in 004 — absent pre-parse by design (R5)");
    },
  );
});

test("discovery adapter contract: custom-adapter identities pass through fragment frameworkId as strings at runtime (research R5)", async () => {
  await withTempTree(
    "metadata-fragment-custom",
    [{ kind: "file", path: "flows/todo-deploy.md" }],
    async (tree) => {
      const result = await discoverTaskFiles({
        repositoryRoot: tree,
        config: builtInDefaults,
        gitContext: false,
        overrides: { customAdapters: [MINIMAL] },
      });
      const discovered = result.files.find((f) => f.filePath === "flows/todo-deploy.md");
      assert.ok(discovered);
      const fragment = frameworkMetadataFragment(discovered);
      assert.equal(fragment.frameworkId, "my-flow");
      assert.equal(fragment.filePath, "flows/todo-deploy.md");
    },
  );
});

test("discovery adapter contract: the FrameworkAdapter interface consumed here is snapshot-frozen for 004 (cross-check T007)", async () => {
  const mod = (await import("task-linear-sync/discovery")) as Record<string, unknown>;
  for (const name of ["FrameworkAdapter", "builtInAdapters", "createAdapterRegistry", "selectAdapter", "frameworkMetadataFragment", "CustomAdapterError"]) {
    if (name === "FrameworkAdapter") continue; // type-level — surface snapshot covers it via index.d.ts
    assert.ok(name in mod, `frozen 004 seam '${name}' must stay exported`);
  }
});
