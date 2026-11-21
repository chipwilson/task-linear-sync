/**
 * T020 [022] — the re-based built-in `spec-kitty` row pinned to data-model §3 VERBATIM:
 * path-scoped claims (`taskPathPatterns`), the `segment-under-base` Feature_Name rule, the
 * emptied exclusion list (supersedes 017 C2.5), and the A-022-2 `documentTaskRule`; the
 * 017 roll-up grammar members (`checklistIdPattern`, `titleTagPattern`, `phasePattern`,
 * `summaryPattern`) are RETIRED from the row. The never-matching `headingGrammar`
 * placeholder, path-only detection, and the scaffold refusals (017 C1.3) stay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { builtInAdapters, discoverTaskFiles } from "task-linear-sync/discovery";
import type { DetectionContext } from "task-linear-sync/discovery";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";

const kittyRow = builtInAdapters["spec-kitty"];
const KITTY = fixtureRepoPath("spec-kitty");

function ctx(repoRelativePosixPath: string, siblingFileNames: readonly string[] = []): DetectionContext {
  return { repoRelativePosixPath, siblingFileNames, specsBaseDirectories: builtInDefaults.specsBaseDirectories };
}

test("022 row: exact member values per data-model §3 (taskPathPatterns + documentTaskRule verbatim)", () => {
  assert.deepEqual(kittyRow.baseDirectories, ["kitty-specs/"], "base unchanged");
  assert.deepEqual(kittyRow.taskFilePatterns, [...builtInDefaults.taskFilePatterns], "roll-up claim stays the shipped-default semantics");
  assert.deepEqual(kittyRow.taskPathPatterns, ["kitty-specs/*/tasks/**/*.md"], "A-022-1 path-scoped collection (R2)");
  assert.deepEqual(kittyRow.detection, { pathPrefixes: ["kitty-specs/"] }, "path-only detection, no siblings (017 C2.1 retained)");
  assert.deepEqual(kittyRow.featureNameRule, { kind: "segment-under-base" }, "amended rule (R3)");
  assert.deepEqual(kittyRow.frameworkSpecificExclusions, [], "017 C2.5 exclusion REMOVED — the collection descends tasks/");
  assert.deepEqual(
    kittyRow.documentTaskRule,
    {
      collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$",
      idKey: "work_package_id",
      titleKey: "title",
      fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$",
    },
    "A-022-2 document rule verbatim (data-model §3)",
  );
  assert.equal(kittyRow.headingGrammar, "(?!)", "never-matching placeholder retained; document mode never consults it");
  assert.equal(kittyRow.checklistIdPattern, undefined, "retired from the row — the members stay available to custom adapters");
  assert.equal(kittyRow.titleTagPattern, undefined, "retired from the row");
  assert.equal(kittyRow.phasePattern, undefined, "retired from the row");
  assert.equal(kittyRow.summaryPattern, undefined, "retired from the row");
  assert.equal(kittyRow.identityFileScope, undefined, "absent — the WP id is path-independent (R7)");
  assert.equal(kittyRow.agentHooksDirectory, undefined, "017 C1.3 retained — no agent-hook scaffold");
  assert.equal(kittyRow.agentHookTemplate, undefined);
});

test("022 row: segment-under-base names the mission, never a lane directory (R3, data-model §1)", () => {
  assert.equal(kittyRow.featureName("kitty-specs/002-x/tasks/WP01.md"), "002-x");
  assert.equal(kittyRow.featureName("kitty-specs/002-x/tasks.md"), "002-x");
  assert.equal(kittyRow.featureName("kitty-specs/002-x/tasks/planned/WP01-x.md"), "002-x");
  assert.equal(kittyRow.featureName("docs/notes.md"), undefined, "outside the base — no feature");
});

test("022 row: specs/ and kitty-specs/ match sets stay disjoint — path patterns root in kitty-specs/ (017 C2.2, R2)", () => {
  assert.ok(kittyRow.detect("kitty-specs/001-demo/tasks/wp01.md", ctx("kitty-specs/001-demo/tasks/wp01.md")), "collection path claims");
  assert.ok(kittyRow.detect("kitty-specs/001-demo/tasks.md", ctx("kitty-specs/001-demo/tasks.md")), "roll-up claims (unchanged)");
  assert.equal(kittyRow.detect("specs/001-x/tasks.md", ctx("specs/001-x/tasks.md")), null, "never a spec-kit path");
  assert.ok(builtInAdapters["spec-kit"].detect("specs/001-x/tasks.md", ctx("specs/001-x/tasks.md", ["spec.md"])), "spec-kit keeps specs/");
  assert.equal(builtInAdapters["spec-kit"].detect("kitty-specs/001-demo/tasks.md", ctx("kitty-specs/001-demo/tasks.md", ["spec.md"])), null);
});

test("022 row: default-enabled discovery claims the whole collection — roll-ups, lane docs, non-recognizing docs (.md only)", async () => {
  const result = await discoverTaskFiles({ repositoryRoot: KITTY, config: builtInDefaults, gitContext: false });
  assert.deepEqual(
    result.files.map((f) => [f.filePath, f.frameworkId, f.featureName]),
    [
      ["kitty-specs/001-demo/tasks.md", "spec-kitty", "001-demo"],
      ["kitty-specs/001-demo/tasks/WP01-scaffold.md", "spec-kitty", "001-demo"],
      ["kitty-specs/001-demo/tasks/WP03-no-title.md", "spec-kitty", "001-demo"],
      ["kitty-specs/001-demo/tasks/front-matter-only.md", "spec-kitty", "001-demo"],
      ["kitty-specs/001-demo/tasks/notes.md", "spec-kitty", "001-demo"],
      ["kitty-specs/001-demo/tasks/review-feedback.md", "spec-kitty", "001-demo"],
      ["kitty-specs/002-billing/tasks.md", "spec-kitty", "002-billing"],
      ["kitty-specs/002-billing/tasks/planned/WP01-billing.md", "spec-kitty", "002-billing"],
      ["kitty-specs/003-plan-only/tasks.md", "spec-kitty", "003-plan-only"],
    ],
    "sorted claim set: img.png and .kittify/ contents never enter candidates; spec.md stays a sibling",
  );
});

test("022 row: disabling spec-kitty removes patterns, claims, and document-mode as a unit — generic fall-through (FR-013)", async () => {
  const config = { ...builtInDefaults, frameworkAdapters: builtInDefaults.frameworkAdapters.filter((id) => id !== "spec-kitty") };
  const result = await discoverTaskFiles({ repositoryRoot: KITTY, config, gitContext: false });
  assert.deepEqual(
    result.files.map((f) => [f.filePath, f.frameworkId]),
    [
      ["kitty-specs/001-demo/tasks.md", "generic"],
      ["kitty-specs/002-billing/tasks.md", "generic"],
      ["kitty-specs/003-plan-only/tasks.md", "generic"],
    ],
    "basename fall-through only — the tasks/ collection re-invisibilizes exactly as pre-022",
  );
  assert.ok(result.files.every((f) => f.detection.via === "fallback"), "generic fallback claims, never spec-kitty");
});
