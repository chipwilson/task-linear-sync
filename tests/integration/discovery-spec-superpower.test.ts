/**
 * T015 [US1] — zero-configuration discovery matrix over the `spec-superpower` fixture
 * (pattern of discovery-adapters.test.ts; SC-001/US1-AC1/AC4, contract Rule 2):
 * all three dated plans claimed with the right identity and detection record, 0 unrelated
 * Markdown files, and both decoys absent — the date-named file outside the plans root is
 * UNCLAIMED (amendment A-018-1), the non-date filename is never a candidate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveredFile, DiscoveryResult } from "task-linear-sync/discovery";
import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";

const FIXTURE = fixtureRepoPath("spec-superpower");

export async function discoverFixture(): Promise<DiscoveryResult> {
  return discoverTaskFiles({ repositoryRoot: FIXTURE, config: builtInDefaults, gitContext: false });
}

export function byPath(result: DiscoveryResult): Map<string, DiscoveredFile> {
  return new Map(result.files.map((f) => [f.filePath, f]));
}

test("spec-superpower discovery: 3/3 plans claimed by default config, 0 unrelated Markdown (SC-001)", async () => {
  const result = await discoverFixture();
  assert.equal(result.files.length, 3, "exactly the three plan files — nothing else enters the sync");
  for (const file of result.files) {
    assert.match(file.filePath, /^docs\/superpowers\/plans\/\d{4}-\d{2}-\d{2}-.*\.md$/);
    assert.equal(file.frameworkId, "spec-superpower");
    assert.equal(file.adapterId, "spec-superpower");
    assert.equal(file.detection.via, "path");
    assert.equal(file.detection.matchedPattern, "docs/superpowers/plans/");
  }
});

test("spec-superpower discovery: decoys absent — date-named file outside the plans root is UNCLAIMED (US1-AC4, A-018-1); scratch.md is no candidate", async () => {
  const files = byPath(await discoverFixture());
  assert.ok(!files.has("docs/superpowers/2026-11-05-outside.md"), "above the plans root — never claimed, not even by the generic fallback");
  assert.ok(!files.has("docs/superpowers/plans/scratch.md"), "non-date filename matches no enabled taskFilePatterns — not a candidate");
});

test("spec-superpower discovery: feature names derive per file — auth, sync, sync (SC-003)", async () => {
  const files = byPath(await discoverFixture());
  assert.equal(files.get("docs/superpowers/plans/2026-11-01-sync.md")?.featureName, "sync");
  assert.equal(files.get("docs/superpowers/plans/2026-11-02-auth.md")?.featureName, "auth");
  assert.equal(files.get("docs/superpowers/plans/2026-11-09-sync.md")?.featureName, "sync", "same derived name on two dates is legal — identity scoping is FR-010's job (T020)");
});
