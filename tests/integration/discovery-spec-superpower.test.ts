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
import {
  attachEngine,
  buildWorld,
  callsOf,
  clearCheckpoints,
  readCheckpointStore,
} from "../helpers/engine-harness.js";
import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";

import { createSyncEngine } from "../../src/engine/create.js";
import { resolveRouting } from "../../src/routing/resolve.js";

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

// ── T021 [US3] ──────────────────────────────────────────────────────────────────

test("spec-superpower discovery: taskFilePatterns override claims scratch.md — plans-root rule kept, name is `scratch` (edge case, research R5/R8)", async () => {
  const result = await discoverTaskFiles({
    repositoryRoot: FIXTURE,
    config: builtInDefaults,
    gitContext: false,
    overrides: { adapters: { "spec-superpower": { taskFilePatterns: ["*.md"] } } },
  });
  const files = byPath(result);
  assert.equal(result.files.length, 4, "three plans plus the override-claimed scratch.md — the plans root still gates the walk");
  const scratch = files.get("docs/superpowers/plans/scratch.md");
  assert.ok(scratch, "scratch.md claimed under the overridden glob");
  assert.equal(scratch.frameworkId, "spec-superpower", "claimed by the overridden row, not the fallback");
  assert.equal(scratch.featureName, "scratch", "date-stripped basename of an undated name is the bare stem");
  assert.ok(!files.has("docs/superpowers/2026-11-05-outside.md"), "overriding the FILENAME pattern never widens the PLANS ROOT (keep-the-rule edge case)");
});

test("spec-superpower discovery: projectByPath rules route plan paths like any framework (US3-AC4)", async () => {
  const slice = {
    projectByPath: [{ prefix: "docs/superpowers/plans/", teamKey: "acme-team", project: "proj-gamma" }],
    defaultTeamKey: "acme-team",
    defaultProject: "proj-alpha",
  };
  for (const filePath of [
    "docs/superpowers/plans/2026-11-01-sync.md",
    "docs/superpowers/plans/2026-11-02-auth.md",
    "docs/superpowers/plans/2026-11-09-sync.md",
    "docs/superpowers/plans/scratch.md",
  ]) {
    assert.deepEqual(
      resolveRouting(filePath, slice),
      { teamKey: "acme-team", project: "proj-gamma", matchedPrefix: "docs/superpowers/plans/", defaulted: false },
      `${filePath} routes per the configured rule`,
    );
  }
  // Outside the rule the plans tree takes the default like every other framework's files.
  assert.deepEqual(resolveRouting("docs/superpowers/2026-11-05-outside.md", slice), {
    teamKey: "acme-team",
    project: "proj-alpha",
    defaulted: true, // no match ⇒ defaulted, `matchedPrefix` omitted (data-model §1)
  });
});

test("spec-superpower sync: issues created for 2026-11-01-sync.md NEVER match tasks parsed from 2026-11-09-sync.md — cross-match attempt on the fake Linear_Port (US3-AC2)", async () => {
  const w = await buildWorld("spec-superpower-sync");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const applied = await engine.applySyncPlan(plan1, {
      applyFlag: true,
      confirmationKey: w.config.confirmationKey,
      acceptLowConfidence: plan1.lowConfidencePresent,
      planReference: plan1.planId,
    });
    assert.equal(applied.status, "applied");

    // Which fake issue belongs to which plan — via the create titles (all nine unique).
    const fileByTitle = new Map<string, string>([
      ["SyncJournalWriter", "docs/superpowers/plans/2026-11-01-sync.md"],
      ["DriftDetector", "docs/superpowers/plans/2026-11-01-sync.md"],
      ["MirrorRenderer", "docs/superpowers/plans/2026-11-01-sync.md"],
      ["SessionStore", "docs/superpowers/plans/2026-11-02-auth.md"],
      ["AuthMiddleware", "docs/superpowers/plans/2026-11-02-auth.md"],
      ["LoginRoute", "docs/superpowers/plans/2026-11-02-auth.md"],
      ["LedgerRecordCodec", "docs/superpowers/plans/2026-11-09-sync.md"],
      ["LedgerWalk", "docs/superpowers/plans/2026-11-09-sync.md"],
      ["LedgerHistoryRoute", "docs/superpowers/plans/2026-11-09-sync.md"],
    ]);
    const fileByIssueId = new Map<string, string>();
    for (const view of w.fake.world.issues.values()) {
      const origin = fileByTitle.get(view.title);
      if (origin !== undefined) fileByIssueId.set(view.id, origin);
    }
    assert.equal(fileByIssueId.size, 9, "all nine created issues are in the fake tracker");

    // Cross-match attempt: wipe the durable pairings and re-plan/apply — pairing must
    // re-form from identity evidence ONLY, and `Task 1` of one plan must never reach
    // `Task 1`'s issue in another plan despite the shared local id and feature name.
    await clearCheckpoints(w);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const applied2 = await engine2.applySyncPlan(plan2, {
      applyFlag: true,
      confirmationKey: w.config.confirmationKey,
      acceptLowConfidence: plan2.lowConfidencePresent,
      planReference: plan2.planId,
    });
    assert.equal(applied2.status, "applied");
    assert.equal(callsOf(w, "createIssue").length, 9, "re-pairing creates no duplicates — identity evidence re-pairs");

    const store = await readCheckpointStore(w);
    assert.ok(store !== null, "checkpoint store persisted after re-apply");
    for (const checkpoint of Object.values(store.checkpoints)) {
      const origin = fileByIssueId.get(checkpoint.issueId);
      assert.ok(origin !== undefined, `checkpoint '${checkpoint.taskUuid}' pairs to a known created issue`);
      assert.equal(
        origin,
        fileByTitle.get(checkpoint.title),
        `checkpoint '${checkpoint.taskUuid}' ('${checkpoint.title}') must pair to its own plan's issue, never a same-local-id issue from another file`,
      );
    }
  } finally {
    await w.dispose();
  }
});
