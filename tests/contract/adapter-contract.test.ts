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
      assert.equal(byPath.get("todo-deploy.md"), undefined, "outside flows/ → UNCLAIMED (018 amendment A-018-1: generic catches only basenames matching its own patterns)");
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

// ── A-022-2 (022) — the 004 member whitelist gains the OPTIONAL `documentTaskRule`
// (contracts/adapter-consumption.md rule 2): document-unit task mode. Absent ⇒ extraction
// is byte-identical for every other adapter. ─────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";
import { genericFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const WHITELIST_MEMBERS: readonly string[] = [
  "id",
  "featureName",
  "headingGrammar",
  "phasePattern",
  "summaryPattern",
  "rollupPattern",
  "checklistIdPattern",
  "titleTagPattern",
  "identityFileScope",
  "documentTaskRule", // A-022-2 (022)
];

test("022 adapter consumption: TaskFileAdapter declares exactly the whitelist members, documentTaskRule optional (A-022-2)", () => {
  const dtsPath = fileURLToPath(new URL("../../../dist/parsing/adapter.d.ts", import.meta.url));
  assert.ok(existsSync(dtsPath), "dist/parsing/adapter.d.ts missing (run npm run build)");
  const dts = readFileSync(dtsPath, "utf8");
  const body = /export interface TaskFileAdapter \{([\s\S]*?)\n\}/.exec(dts)?.[1] ?? "";
  // Top-level members only — the emitted declaration indents members by 4, nested by 8.
  const members = [...body.matchAll(/^ {4}(?! )(?:readonly\s+)?([A-Za-z0-9_$]+)(\??)[:(]/gm)].map((m) => m[1] as string);
  assert.deepEqual(
    [...members].sort(),
    [...WHITELIST_MEMBERS].sort(),
    "the TaskFileAdapter member set must equal the documented whitelist (adapter-consumption.md rule 2) — additions are amendments",
  );
  assert.match(
    body,
    /documentTaskRule\?:\s*\{[\s\S]*?collectionPattern[^}]*?idKey[^}]*?titleKey[^}]*?fileNameIdPattern[^}]*?\}/,
    "documentTaskRule is OPTIONAL and carries the four regex-source members",
  );
});

test("022 adapter consumption: absent documentTaskRule ⇒ extraction unchanged (inert for every other adapter)", () => {
  const cfg = makeTestConfig();
  const content = [
    "## 1.1: Keep the parser happy",
    "",
    "- [ ] T001 Still a checklist task",
    "",
  ].join("\n");
  const without = parseTaskFile("docs/auth/tasks.md", content, genericFixtureAdapter, cfg);
  // The member type lands with A-022-2 (T015); the cast keeps the red-first suite compiling.
  const explicitAbsent = { ...genericFixtureAdapter, documentTaskRule: undefined } as unknown as TaskFileAdapter;
  const withExplicitUndefined = parseTaskFile("docs/auth/tasks.md", content, explicitAbsent, cfg);
  assert.deepEqual(withExplicitUndefined, without, "an adapter omitting (or explicitly undefined-ing) the member parses byte-identically");
  assert.ok(without.file.tasks.length > 0, "the heading/checklist pipeline still extracts for member-less adapters");
});
