/**
 * T026 [US2] — identity integration over `tests/fixtures/repos/discovery/five-frameworks/`
 * per SC-001 verbatim: "100% of task files in a fixture repository containing all five
 * supported framework layouts are discovered and associated with the correct framework
 * identity and sibling documents; 0 missed, 0 false". Detection MARKERS — not base
 * directories — drive selection (001 R7.8: directory names are generic discovery defaults);
 * `docs/extra/tasks.md` (bmad `docs/` base, no bmad marker) still resolves to generic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveredFile, DiscoveryResult } from "task-linear-sync/discovery";
import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";

const FIVE = fixtureRepoPath("five-frameworks");

async function discoverFive(): Promise<DiscoveryResult> {
  return discoverTaskFiles({ repositoryRoot: FIVE, config: builtInDefaults, gitContext: false });
}

function byPath(result: DiscoveryResult): Map<string, DiscoveredFile> {
  return new Map(result.files.map((f) => [f.filePath, f]));
}

test("discovery adapters: five-frameworks — every file carries its correct identity, feature name, and siblings (SC-001: 0 missed, 0 false)", async () => {
  const result = await discoverFive();
  const files = byPath(result);
  assert.equal(result.files.length, 9, "all nine task files found — 0 missed");

  const expectations: readonly [string, string, string | undefined, readonly string[]][] = [
    [".kiro/specs/auth/tasks.md", "kiro", "auth", [".kiro/specs/auth/requirements.md", ".kiro/specs/auth/design.md"]],
    ["specs/pay/tasks.md", "spec-kit", "pay", ["specs/pay/spec.md", "specs/pay/plan.md"]],
    ["specs/no-sibs/tasks.md", "generic", "no-sibs", []],
    ["specs/deep/nested/pay/tasks.md", "spec-kit", "pay", ["specs/deep/nested/pay/spec.md"]],
    ["openspec/cart/tasks.md", "open-spec", "cart", ["openspec/cart/proposal.md"]],
    ["bmad/epic-1/tasks.md", "bmad", "epic-1", ["bmad/epic-1/prd.md"]],
    ["docs/extra/tasks.md", "generic", undefined, []],
    ["notes/tasks.md", "generic", undefined, []],
    ["tasks.md", "generic", undefined, []],
  ];
  for (const [filePath, frameworkId, featureName, siblingDocuments] of expectations) {
    const file = files.get(filePath);
    assert.ok(file, `${filePath} discovered`);
    assert.equal(file.frameworkId, frameworkId, `${filePath} identity`);
    if (featureName === undefined) assert.ok(!("featureName" in file), `${filePath} has no derivable Feature_Name — absent, not an error`);
    else assert.equal(file.featureName, featureName, `${filePath} Feature_Name`);
    assert.deepEqual(file.siblingDocuments, siblingDocuments, `${filePath} existing configured siblings in list order`);
  }
});

test("discovery adapters: look-alike traps — .kiro/specs/ never resolves to spec-kit and a docs/ base without bmad markers is NOT bmad (001 R7.8)", async () => {
  const files = byPath(await discoverFive());
  assert.equal(files.get(".kiro/specs/auth/tasks.md")?.frameworkId, "kiro");
  assert.equal(files.get("docs/extra/tasks.md")?.frameworkId, "generic", "docs/ is a bmad BASE, not a detection marker");
  assert.equal(files.get("specs/no-sibs/tasks.md")?.frameworkId, "generic", "spec-kit is conjunctive — no spec.md/plan.md sibling, no spec-kit");
});

test("discovery adapters: every detection record is well-formed — sorted candidates, deterministic matchedPattern, valid via (Principle IV)", async () => {
  const result = await discoverFive();
  for (const file of result.files) {
    const detection = file.detection;
    assert.deepEqual([...detection.candidates].sort(), detection.candidates, `${file.filePath}: candidates sorted alphabetically`);
    assert.ok(["explicit", "path", "path+siblings", "siblings", "fallback"].includes(detection.via), `${file.filePath}: via '${detection.via}'`);
    if (detection.via !== "fallback") assert.ok(detection.matchedPattern.length > 0 || detection.via === "explicit", `${file.filePath}: rank material present`);
    assert.equal(detection.adapterId, file.adapterId);
    assert.equal(detection.frameworkId, file.frameworkId);
    assert.equal(file.adapterId, file.frameworkId, "built-in winner: adapter id IS the framework identity (R5)");
  }
});

test("discovery adapters: two-run byte-compare INCLUDING identities (SC-002 covers selection determinism)", async () => {
  const a = await discoverFive();
  const b = await discoverFive();
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-for-byte identical serialized results with identities, features, and siblings");
});
