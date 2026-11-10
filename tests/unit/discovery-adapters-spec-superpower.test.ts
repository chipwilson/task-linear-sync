/**
 * T013 [US1] — table-pin of the `spec-superpower` built-in row against
 * data-model.md §2.2 (verbatim field values; FR-011 forbids improvisation), plus the
 * detection claims (contract Rule 2: plans root beneath-any-depth, path-only) and the
 * `date-stripped-basename` Feature_Name table (research R5, contract Rule 3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { builtInAdapters, createAdapterRegistry } from "task-linear-sync/discovery";
import type { DetectionContext } from "task-linear-sync/discovery";

const row = builtInAdapters["spec-superpower"];

function ctx(repoRelativePosixPath: string): DetectionContext {
  return { repoRelativePosixPath, siblingFileNames: [], specsBaseDirectories: builtInDefaults.specsBaseDirectories };
}

test("spec-superpower row: every field equals data-model.md §2.2 verbatim, adapter frozen", () => {
  assert.ok(Object.isFrozen(row), "built-in rows are constants");
  assert.equal(row.id, "spec-superpower");
  assert.deepEqual(row.taskFilePatterns, ["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"], "FR-002: date-prefixed plan filenames (FR-011 defaults)");
  assert.deepEqual(row.baseDirectories, ["docs/superpowers/plans/"]);
  assert.deepEqual(row.detection, { pathPrefixes: ["docs/superpowers/plans/"] }, "path-only detection — no sibling markers (FR-002)");
  assert.deepEqual(row.featureNameRule, { kind: "date-stripped-basename" });
  assert.equal(row.headingGrammar, "^\\s{0,3}#{2,4}\\s+(?<id>Task\\s+[0-9]+)\\s*:\\s*(?<title>.+)$", "FR-004 grammar source verbatim");
  assert.equal(row.rollupPattern, "^\\s*[-*+]\\s*\\[[ xX]\\]", "FR-005 step capture: whole-line checkbox (research R3)");
  assert.equal(row.phasePattern, builtInDefaults.phasePattern, "built-in default phase pattern (data-model §2.2)");
  assert.equal(row.summaryPattern, builtInDefaults.summaryPattern, "built-in default summary pattern (data-model §2.2)");
  assert.deepEqual(row.titleBehavior, { stripPrefixes: [...builtInDefaults.titleStripPrefixes] });
  assert.deepEqual(row.siblingDocuments, [], "plans carry no spec-sibling markers (FR-002)");
  assert.equal(row.identityFileScope, true, "FR-010 file-scoped seed composition (amendment A-018-2)");
  assert.equal(row.agentHooksDirectory, undefined, "FR-012: no agent-hook scaffold for this identity");
  assert.equal(row.agentHookTemplate, undefined, "FR-012: absent, never \"none\"-advertised as a template");
  assert.deepEqual(row.frameworkSpecificExclusions, [], "step containment is grammar-driven, not an exclusion list");
});

test("spec-superpower detection: claims plans-root paths at any depth, refuses everything else (Rule 2, US1-AC4)", () => {
  const claimed = row.detect("docs/superpowers/plans/2026-11-09-auth.md", ctx("docs/superpowers/plans/2026-11-09-auth.md"));
  assert.ok(claimed, "canonical plans path is claimed");
  assert.equal(claimed.adapterId, "spec-superpower");
  assert.equal(claimed.matchedPattern, "docs/superpowers/plans/");
  assert.equal(claimed.via, "path");

  const nested = row.detect("a/docs/superpowers/plans/2026-11-09-x.md", ctx("a/docs/superpowers/plans/2026-11-09-x.md"));
  assert.ok(nested, "beneath-any-depth (isBeneathDirectory) — a nested copy of the root still claims");

  assert.equal(row.detect("docs/superpowers/2026-11-05-outside.md", ctx("docs/superpowers/2026-11-05-outside.md")), null, "above the plans root — never claimed by this rule");
  assert.equal(row.detect("docs/notes.md", ctx("docs/notes.md")), null);
});

test("spec-superpower featureName: date-stripped basename table (research R5, contract Rule 3, SC-003)", () => {
  assert.equal(row.featureName("docs/superpowers/plans/2026-11-09-auth.md"), "auth");
  assert.equal(row.featureName("docs/superpowers/plans/2026-11-01-sync.md"), "sync");
  assert.equal(row.featureName("docs/superpowers/plans/notes.md"), "notes", "no date prefix (pattern-overridden team) — extension-stripped basename");
});

test("spec-superpower featureName: wrong-shape date prefixes are NOT stripped (T022, research R5/R8)", () => {
  // The stripped prefix is exactly `\d{4}-\d{2}-\d{2}-` — partial or glued shapes stay.
  assert.equal(row.featureName("docs/superpowers/plans/2026-11-auth.md"), "2026-11-auth", "two-segment date is not a date prefix");
  assert.equal(row.featureName("docs/superpowers/plans/x2026-11-09-a.md"), "x2026-11-09-a", "date must start the basename, not hide inside it");
  assert.equal(row.featureName("docs/superpowers/plans/2026-11-09-.md"), "", "pure date + extension stems to the empty string — derivation is total, downstream absence handling is 004's");
});

test("spec-superpower featureName: programmatic override beats the date-stripped rule via resolveConventions (T022, FR-003)", () => {
  const forced = (filePath: string): string => `plan:${filePath.split("/").pop()}`;
  const registry = createAdapterRegistry(builtInDefaults, {
    adapters: { "spec-superpower": { featureName: forced } },
  });
  const overridden = registry.enabledAdapters.find((a) => a.id === "spec-superpower");
  assert.ok(overridden, "the row stays enabled under the programmatic layer");
  assert.equal(
    overridden.featureName("docs/superpowers/plans/2026-11-09-sync.md"),
    "plan:2026-11-09-sync.md",
    "programmatic featureName wins over the built-in rule (highest layer, research R1)",
  );
  // Without the programmatic layer the row resolves back to the built-in rule.
  const plain = createAdapterRegistry(builtInDefaults).enabledAdapters.find((a) => a.id === "spec-superpower");
  assert.ok(plain);
  assert.equal(plain.featureName("docs/superpowers/plans/2026-11-09-sync.md"), "sync", "the rule itself is untouched");
});
