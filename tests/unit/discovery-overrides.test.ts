/**
 * T024 [US2] — override-matrix unit tests per SC-004 verbatim: "a fixture suite overrides
 * each convention at least once and observes the override take effect". Layering is exactly
 * constitution III / research R7: programmatic `DiscoveryOverrides` beat the frozen-config
 * layer beat built-in adapter defaults, with 002 R3 merge semantics ("arrays and scalars
 * replace wholesale"). Hand-constructed `ResolvedConfig` objects only (no config loading).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults, deepMerge } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import { builtInAdapters, createAdapterRegistry, discoverTaskFiles, selectAdapter } from "task-linear-sync/discovery";
import type { AdapterRegistry, DetectionContext, DiscoveryOverrides, FrameworkAdapter } from "task-linear-sync/discovery";
import { withTempTree } from "../helpers/discovery-fixtures.js";

function adapterById(registry: AdapterRegistry, id: string): FrameworkAdapter {
  const found = registry.enabledAdapters.find((adapter) => adapter.id === id);
  assert.ok(found, `adapter '${id}' enabled`);
  return found;
}

function reg(overrides: DiscoveryOverrides, config: ResolvedConfig = builtInDefaults): AdapterRegistry {
  return createAdapterRegistry(config, overrides);
}

const kitCtx: DetectionContext = {
  repoRelativePosixPath: "k2/x/tasks.md",
  siblingFileNames: ["tasks.md"],
  specsBaseDirectories: builtInDefaults.specsBaseDirectories,
};

test("discovery overrides: selection (fixed and predicate) short-circuits — observed through the registry", () => {
  const fixed = reg({ selection: "bmad" });
  const record = selectAdapter("specs/pay/tasks.md", { ...kitCtx, repoRelativePosixPath: "specs/pay/tasks.md" }, fixed);
  assert.equal(record.adapterId, "bmad");
  assert.equal(record.via, "explicit");
  const predicate = reg({ selection: (fp: string) => (fp === "specs/pay/tasks.md" ? "open-spec" : undefined) });
  assert.equal(selectAdapter("specs/pay/tasks.md", { ...kitCtx, repoRelativePosixPath: "specs/pay/tasks.md" }, predicate).adapterId, "open-spec");
});

test("discovery overrides: adapters.kiro.taskFilePatterns replaces the basename list and gates discovery", async () => {
  const registry = reg({
    adapters: {
      kiro: { taskFilePatterns: ["todo-*.md"] },
      // The other rows must stop claiming tasks.md; the pool's union drives candidacy.
      "spec-kit": { taskFilePatterns: ["todo-*.md"] },
      "open-spec": { taskFilePatterns: ["todo-*.md"] },
      bmad: { taskFilePatterns: ["todo-*.md"] },
      generic: { taskFilePatterns: ["todo-*.md"] },
    },
  });
  assert.deepEqual(adapterById(registry, "kiro").taskFilePatterns, ["todo-*.md"]);
  await withTempTree(
    "overrides-patterns",
    [
      { kind: "file", path: ".kiro/specs/auth/todo-deploy.md" },
      { kind: "file", path: "tasks.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false, overrides: { adapters: { kiro: { taskFilePatterns: ["todo-*.md"] }, "spec-kit": { taskFilePatterns: ["todo-*.md"] }, "open-spec": { taskFilePatterns: ["todo-*.md"] }, bmad: { taskFilePatterns: ["todo-*.md"] }, generic: { taskFilePatterns: ["todo-*.md"] } } } });
      assert.deepEqual(result.files.map((f) => f.filePath), [".kiro/specs/auth/todo-deploy.md"], "tasks.md no longer matches; todo-deploy.md does");
      assert.equal(result.files[0].frameworkId, "kiro");
    },
  );
});

test("discovery overrides: baseDirectories + featureNameRule take effect (parent-dir under the overridden base)", () => {
  const registry = reg({ adapters: { kiro: { baseDirectories: ["k/specs/"] } } });
  const kiro = adapterById(registry, "kiro");
  assert.deepEqual(kiro.baseDirectories, ["k/specs/"]);
  assert.equal(kiro.featureName("k/specs/f/tasks.md"), "f", "Feature_Name from the new base");
  assert.equal(kiro.featureName(".kiro/specs/auth/tasks.md"), undefined, "the old base no longer applies — arrays replace wholesale");
});

test("discovery overrides: detection markers are replaced — the overridden adapter now matches its new marker", () => {
  const registry = reg({ adapters: { "spec-kit": { detection: { pathPrefixes: ["k2/"], siblingsAnyOf: [], requirePathAndSiblings: false } } } });
  const kit = adapterById(registry, "spec-kit");
  const match = kit.detect("k2/x/tasks.md", kitCtx);
  assert.ok(match, "overridden pathPrefixes marker matches");
  assert.equal(match.matchedPattern, "k2/");
  assert.equal(kit.detection.requirePathAndSiblings, false, "the conjunctive sibling requirement is replaced wholesale");
});

test("discovery overrides: grammar fields (heading/phase/summary/rollup) each override per adapter", () => {
  const registry = reg({
    adapters: {
      kiro: { headingGrammar: "^H1$", phasePattern: "^PH$", summaryPattern: "^SM$", rollupPattern: "^RL$" },
    },
  });
  const kiro = adapterById(registry, "kiro");
  assert.equal(kiro.headingGrammar, "^H1$");
  assert.equal(kiro.phasePattern, "^PH$");
  assert.equal(kiro.summaryPattern, "^SM$");
  assert.equal(kiro.rollupPattern, "^RL$");
  assert.equal(adapterById(registry, "bmad").headingGrammar, builtInDefaults.headingIdGrammar, "other rows untouched");
});

test("discovery overrides: titleBehavior.stripPrefixes overrides (consumed by 005 downstream)", () => {
  const registry = reg({ adapters: { bmad: { titleBehavior: { stripPrefixes: ["Story", "Epic"] } } } });
  assert.deepEqual(adapterById(registry, "bmad").titleBehavior, { stripPrefixes: ["Story", "Epic"] });
});

test("discovery overrides: siblingDocuments override takes effect in discovery results", async () => {
  const overrides: DiscoveryOverrides = { adapters: { kiro: { siblingDocuments: ["todo.md"] } } };
  await withTempTree(
    "overrides-siblings",
    [
      { kind: "file", path: ".kiro/specs/auth/tasks.md" },
      { kind: "file", path: ".kiro/specs/auth/todo.md" },
      { kind: "file", path: ".kiro/specs/auth/requirements.md" },
    ],
    async (tree) => {
      const result = await discoverTaskFiles({ repositoryRoot: tree, config: builtInDefaults, gitContext: false, overrides });
      assert.deepEqual(result.files[0].siblingDocuments, [".kiro/specs/auth/todo.md"], "the overridden list is THE list");
    },
  );
});

test("discovery overrides: agentHooksDirectory + agentHookTemplate overrides land on the adapter row", () => {
  const registry = reg({ adapters: { bmad: { agentHooksDirectory: ".custom/hooks/", agentHookTemplate: "command-json" } } });
  const bmad = adapterById(registry, "bmad");
  assert.equal(bmad.agentHooksDirectory, ".custom/hooks/");
  assert.equal(bmad.agentHookTemplate, "command-json");
});

test("discovery overrides: the programmatic Feature_Name function beats the declarative rule (research R9)", () => {
  const registry = reg({ adapters: { kiro: { featureName: (rel: string) => (rel.includes("/auth/") ? "AUTH" : undefined) } } });
  const kiro = adapterById(registry, "kiro");
  assert.equal(kiro.featureName(".kiro/specs/auth/tasks.md"), "AUTH");
  assert.equal(kiro.featureName(".kiro/specs/pay/tasks.md"), undefined);
});

test("discovery overrides: the frozen-config layer applies when it deviates from defaults — all enabled rows observe it", () => {
  const config = deepMerge(builtInDefaults, {
    taskFilePatterns: ["cfg-*.md"],
    headingIdGrammar: "^Cfg$",
    siblingDocuments: ["cfg-sibling.md"],
  }) as ResolvedConfig;
  const registry = createAdapterRegistry(config);
  for (const adapter of registry.enabledAdapters) {
    assert.deepEqual(adapter.taskFilePatterns, ["cfg-*.md"], `${adapter.id}: config layer replaces the defaults layer`);
    assert.equal(adapter.headingGrammar, "^Cfg$", `${adapter.id}: config grammar`);
  }
  assert.deepEqual(adapterById(registry, "generic").siblingDocuments, ["cfg-sibling.md"], "generic's siblings are config-driven");
  assert.deepEqual(adapterById(registry, "kiro").siblingDocuments, ["requirements.md", "design.md"], "framework rows keep their 001 R7.5 sibling lists (FR-007)");
});

test("discovery overrides: layering — programmatic beats the config layer beats built-in defaults (SC-004)", () => {
  const config = deepMerge(builtInDefaults, { taskFilePatterns: ["cfg-*.md"], headingIdGrammar: "^Cfg$" }) as ResolvedConfig;
  assert.deepEqual(builtInAdapters.kiro.taskFilePatterns, ["tasks.md", "TASKS.md"], "defaults layer");
  const layered = createAdapterRegistry(config, { adapters: { kiro: { taskFilePatterns: ["prog-*.md"] } } });
  assert.deepEqual(adapterById(layered, "kiro").taskFilePatterns, ["prog-*.md"], "programmatic layer wins for kiro");
  assert.deepEqual(adapterById(layered, "bmad").taskFilePatterns, ["cfg-*.md"], "config layer still applies to the others");
  assert.equal(adapterById(layered, "kiro").headingGrammar, "^Cfg$", "config grammar where no programmatic override exists");
});

test("discovery overrides: unknown adapter ids in the overrides map are inert (known adapters only, FR-011)", () => {
  const registry = reg({ adapters: { "no-such": { headingGrammar: "X" } } });
  assert.equal(registry.enabledAdapters.length, 5);
  assert.equal(adapterById(registry, "kiro").headingGrammar, builtInDefaults.headingIdGrammar);
});
