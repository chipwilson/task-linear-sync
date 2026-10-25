/**
 * T023 [US2] — built-in adapter table tests (001 R7.5 rows verbatim, FR-007/FR-010;
 * contracts/framework-adapter.md built-in table). Generic purity (US2 AC2):
 * `frameworkSpecificExclusions` is `[]`. Kiro compatibility (US2 AC3): feature dir →
 * `Feature_Name`, `.kiro/hooks/` scaffold advertised via `agentHookScaffold` — which
 * writes NOTHING to disk (Principle I, research R11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { agentHookScaffold, builtInAdapters } from "task-linear-sync/discovery";
import { listTree, withTempTree } from "../helpers/discovery-fixtures.js";

test("discovery built-ins: the table exposes exactly the five frozen FrameworkIds, adapters frozen", () => {
  assert.deepEqual(Object.keys(builtInAdapters).sort(), ["bmad", "generic", "kiro", "open-spec", "spec-kit"]);
  for (const adapter of Object.values(builtInAdapters)) {
    assert.ok(Object.isFrozen(adapter), `adapter '${adapter.id}' is immutable (built-in rows are constants)`);
  }
});

test("discovery built-ins: kiro row — `.kiro/specs/` base, tasks.md, parent-dir Feature_Name, requirements/design siblings, `.kiro/hooks/` kiro-json scaffold", () => {
  const kiro = builtInAdapters.kiro;
  assert.equal(kiro.id, "kiro");
  assert.deepEqual(kiro.baseDirectories, [".kiro/specs/"]);
  assert.ok(kiro.taskFilePatterns.includes("tasks.md"));
  assert.deepEqual(kiro.detection.pathPrefixes, [".kiro/"], "kiro WHERE the path is beneath `.kiro/` (001 R7.2)");
  assert.deepEqual(kiro.featureNameRule, { kind: "parent-dir" });
  assert.deepEqual(kiro.siblingDocuments, ["requirements.md", "design.md"]);
  assert.equal(kiro.agentHooksDirectory, ".kiro/hooks/");
  assert.equal(kiro.agentHookTemplate, "kiro-json");
  assert.equal(kiro.featureName(".kiro/specs/auth/tasks.md"), "auth", "FR-010: feature directory as Feature_Name");
  assert.equal(kiro.featureName(".kiro/steering/tasks.md"), undefined, "not beneath `.kiro/specs/` — absent, never an error");
});

test("discovery built-ins: spec-kit row — specs/ + spec/ bases, conjunctive detection, spec/plan/requirements siblings, parent-dir Feature_Name", () => {
  const kit = builtInAdapters["spec-kit"];
  assert.deepEqual(kit.baseDirectories, ["specs/", "spec/"]);
  assert.deepEqual(kit.detection.pathPrefixes, ["specs/", "spec/"]);
  assert.deepEqual(kit.detection.siblingsAnyOf, ["spec.md", "plan.md"]);
  assert.equal(kit.detection.requirePathAndSiblings, true, "001 R7.2 conjunctive rule");
  assert.deepEqual(kit.featureNameRule, { kind: "parent-dir" });
  assert.deepEqual(kit.siblingDocuments, ["spec.md", "plan.md", "requirements.md"]);
  assert.equal(kit.featureName("specs/pay/tasks.md"), "pay");
  assert.equal(kit.featureName("spec/foo/tasks.md"), "foo");
});

test("discovery built-ins: open-spec row — openspec/ + open-spec/ bases, disjunctive detection, segment-after Feature_Name", () => {
  const open = builtInAdapters["open-spec"];
  assert.deepEqual(open.baseDirectories, ["openspec/", "open-spec/"]);
  assert.deepEqual(open.detection.pathContains, ["openspec/", "open-spec/"]);
  assert.deepEqual(open.detection.siblingsAnyOf, ["openspec.json", "proposal.md"]);
  assert.equal(open.detection.requirePathAndSiblings, undefined, "disjunctive rule");
  assert.deepEqual(open.featureNameRule, { kind: "segment-after", markers: ["openspec/", "changes/", "specs/"] });
  assert.deepEqual(open.siblingDocuments, ["spec.md", "proposal.md", "tasks.md"]);
  assert.equal(open.featureName("openspec/cart/tasks.md"), "cart");
  assert.equal(open.featureName("docs/changes/migrate/tasks.md"), "migrate", "meaningful segment after `changes/`");
});

test("discovery built-ins: bmad row — bmad/, bmad-method/, docs/ bases, disjunctive detection (docs/ is NOT a marker), parent-or-basename Feature_Name", () => {
  const bmad = builtInAdapters.bmad;
  assert.deepEqual(bmad.baseDirectories, ["bmad/", "bmad-method/", "docs/"]);
  assert.deepEqual(bmad.detection.pathContains, ["bmad/", "bmad-method/"]);
  assert.deepEqual(bmad.detection.siblingsAnyOf, ["prd.md", "architecture.md"]);
  assert.deepEqual(bmad.featureNameRule, { kind: "parent-or-basename" });
  assert.deepEqual(bmad.siblingDocuments, ["requirements.md", "design.md", "architecture.md", "prd.md", "spec.md"]);
  assert.equal(bmad.featureName("bmad/epic-1/tasks.md"), "epic-1");
  assert.equal(bmad.featureName("docs/tasks.md"), "tasks", "no parent feature directory → task-file basename (001 R7.5)");
});

test("discovery built-ins: generic row — FR-010 purity, config-driven bases, `.task-linear-sync/hooks/` command-json scaffold", () => {
  const generic = builtInAdapters.generic;
  assert.equal(generic.id, "generic");
  assert.deepEqual(generic.frameworkSpecificExclusions, [], "US2 AC2: NO framework-specific exclusions beyond the global defaults");
  assert.deepEqual(generic.baseDirectories, [...builtInDefaults.specsBaseDirectories]);
  assert.deepEqual(generic.taskFilePatterns, [...builtInDefaults.taskFilePatterns]);
  assert.deepEqual(generic.detection, {}, "generic matches NOTHING by marker — fallback only");
  assert.deepEqual(generic.featureNameRule, { kind: "parent-dir" });
  assert.equal(generic.agentHooksDirectory, ".task-linear-sync/hooks/");
  assert.equal(generic.agentHookTemplate, "command-json");
});

test("discovery built-ins: agentHookScaffold(kiro) — `.kiro/hooks/` JSON Agent_Hook running `<binName> enqueue` (001 Glossary, FR-010)", () => {
  const scaffold = agentHookScaffold("kiro", "task-sync");
  assert.ok(scaffold, "kiro advertises the kiro-json scaffold");
  assert.equal(scaffold.directory, ".kiro/hooks/");
  assert.equal(scaffold.fileName, "task-sync-sync.json", "`<toolId>-sync.json` — binName derives from toolId, zero org literals");
  const hook = JSON.parse(scaffold.contents) as { action?: string; command?: string };
  assert.equal(hook.action, "command", "Agent_Hook `command` action (001 Glossary Agent_Hook)");
  assert.equal(hook.command, "task-sync enqueue");
});

test("discovery built-ins: agentHookScaffold(generic) — `.task-linear-sync/hooks/` command-json record", () => {
  const scaffold = agentHookScaffold("generic", "task-sync");
  assert.ok(scaffold);
  assert.equal(scaffold.directory, ".task-linear-sync/hooks/");
  const hook = JSON.parse(scaffold.contents) as { action?: string; command?: string };
  assert.equal(hook.action, "command");
  assert.equal(hook.command, "task-sync enqueue");
});

test("discovery built-ins: agentHookScaffold → undefined for frameworks without a template (bmad, spec-kit, open-spec, unknown ids)", () => {
  assert.equal(agentHookScaffold("bmad", "task-sync"), undefined);
  assert.equal(agentHookScaffold("spec-kit", "task-sync"), undefined);
  assert.equal(agentHookScaffold("open-spec", "task-sync"), undefined);
  assert.equal(agentHookScaffold("no-such-framework", "task-sync"), undefined);
});

test("discovery built-ins: agentHookScaffold writes nothing to disk (research R11 — pure records for 010)", async () => {
  await withTempTree("scaffold-pure", [{ kind: "dir", path: "somewhere" }], async (tree) => {
    const before = await listTree(tree);
    agentHookScaffold("kiro", "task-sync");
    agentHookScaffold("generic", "task-sync");
    assert.deepEqual(await listTree(tree), before, "zero writes — 010 owns persistence");
  });
});
