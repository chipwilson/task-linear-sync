/**
 * T019 [017 US3] — durable identity under repository drift (spec US3-AC1/AC3, contract C4).
 *
 * Two drift classes over a fully synced spec-kitty world (fake `Linear_Port`):
 *  - mid-file insertion: reordering `tasks.md` by inserting a NEW subtask between two
 *    synced ones must create EXACTLY ONE issue — the new id — with zero updates to the
 *    existing tasks (identity is the (framework, feature, local-id) seed, not the line);
 *  - work-package section swap: moving every subtask between `## Work Package WPnn:`
 *    sections yields grouping-only changes (phase), never identity churn or new issues.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { discoverTaskFiles } from "task-linear-sync/discovery";
import type { Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const KITTY = fixtureRepoPath("spec-kitty");

/** The T011 world plus a routing row sending the 002 mission to its own project (US3-AC1). */
const KITTY_DRIFT_WORLD = {
  clock: "2026-01-01T00:00:00.000Z",
  teams: [
    {
      key: "TEAM-A",
      id: "ac000000-0000-4000-8000-000000000101",
      projects: [
        { id: "proj-alpha", name: "Project Alpha" },
        { id: "proj-billing", name: "Billing" },
      ],
      workflowStates: [
        { id: "ac000000-0000-4000-8000-000000000201", name: "Backlog", type: "backlog" },
        { id: "ac000000-0000-4000-8000-000000000202", name: "Todo", type: "todo" },
        { id: "ac000000-0000-4000-8000-000000000203", name: "Done", type: "completed" },
      ],
    },
  ],
  config: {
    teams: {
      "TEAM-A": {
        projects: ["proj-alpha", "proj-billing"],
        workflowStates: {
          backlog: "Backlog",
          todo: "Todo",
          done: "Done",
          completedTypes: ["completed"],
          ignoredTypes: ["canceled", "duplicate"],
        },
      },
    },
    projectByPath: [{ prefix: "kitty-specs/002-billing", teamKey: "TEAM-A", project: "proj-billing" }],
    defaultTeamKey: "TEAM-A",
    defaultProject: "proj-alpha",
    confirmationKey: "SYNC",
    descriptionNormalizationProfile: "default",
  },
} as const;

async function buildDriftWorld(): Promise<{ world: EngineWorld; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "tls-017-drift-"));
  await writeFile(join(scratch, "world.json"), JSON.stringify(KITTY_DRIFT_WORLD), "utf8");
  await cp(KITTY, join(scratch, "repo"), { recursive: true });
  const world = await buildWorld(scratch);
  return { world, scratch };
}

function gates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
  };
}

/** Fully sync the fixture, then return the engine plus per-mission landed create counts. */
async function syncedWorld(world: EngineWorld) {
  const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
  const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
  assert.ok(plan.entries.length > 0, "the fixture plans work");
  const applied = await engine.applySyncPlan(plan, gates(world, plan));
  assert.equal(applied.status, "applied");
  return engine;
}

test("sync spec-kitty: mid-file insertion creates exactly ONE issue and never churns the existing tasks (US3-AC1)", async () => {
  const { world, scratch } = await buildDriftWorld();
  try {
    const engine = await syncedWorld(world);
    const createsBefore = callsOf(world, "createIssue").length;
    const path = join(world.repositoryRoot, "kitty-specs", "001-demo", "tasks.md");
    const lines = (await readFile(path, "utf8")).split("\n");
    const at = lines.findIndex((l) => l.includes("T002"));
    assert.ok(at > 0, "fixture row T002 located");
    // Insert a brand-new subtask BETWEEN the synced T001 and T002 rows.
    lines.splice(at, 0, "- [ ] T009 [P] Insert between the synced rows");
    await writeFile(path, lines.join("\n"), "utf8");

    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    const created = plan.entries.filter((e) => e.decision === "create");
    assert.deepEqual(
      created.map((e) => e.filePath),
      ["kitty-specs/001-demo/tasks.md"],
      "exactly one create decision — the inserted subtask",
    );
    const applied = await engine.applySyncPlan(plan, gates(world, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(world, "createIssue");
    assert.equal(creates.length, createsBefore + 1, "exactly ONE new issue across the tracker");
    const newTitle = (creates[creates.length - 1]!.args[0] as { title: string }).title;
    assert.match(newTitle, /Insert between the synced rows/u, "the new issue is the inserted subtask (tag-free)");
    assert.equal(
      plan.entries.filter((e) => e.decision === "update").length,
      0,
      "reordering around a synced task never updates it (identity is not the line number)",
    );
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("sync spec-kitty: swapping work-package sections is grouping-only — no identity churn, no new issues (US3-AC3)", async () => {
  const { world, scratch } = await buildDriftWorld();
  try {
    const engine = await syncedWorld(world);
    const createsBefore = callsOf(world, "createIssue").length;
    const path = join(world.repositoryRoot, "kitty-specs", "001-demo", "tasks.md");
    const content = await readFile(path, "utf8");
    // Move the WP02 subtask ABOVE the WP01 section header: every WP01 row now groups
    // under WP02, and the moved row closes its old section — pure regrouping.
    const lines = content.split("\n");
    const at = lines.findIndex((l) => l.includes("T004"));
    assert.ok(at > 0, "fixture row T004 located");
    const [moved] = lines.splice(at, 1);
    // Place it directly under the WP01 header: T001/T002 regroup under WP02, the moved
    // row lands in WP01 — grouping flips with every id and title byte-identical.
    const header = lines.findIndex((l) => l.startsWith("## Work Package WP01"));
    lines.splice(header + 1, 0, moved!);
    await writeFile(path, lines.join("\n"), "utf8");

    // Discovery is untouched: still the same two mission roll-ups.
    const discovery = await discoverTaskFiles({ repositoryRoot: world.repositoryRoot, config: builtInDefaults, gitContext: false });
    assert.deepEqual(
      discovery.files.map((f) => f.filePath).sort(),
      ["kitty-specs/001-demo/tasks.md", "kitty-specs/002-billing/tasks.md"],
    );

    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(
      plan.entries.filter((e) => e.decision === "create").length,
      0,
      "a regrouped subtask keeps its identity — nothing new to create",
    );
    const applied = await engine.applySyncPlan(plan, gates(world, plan));
    assert.equal(applied.status, "applied");
    assert.equal(callsOf(world, "createIssue").length, createsBefore, "zero new issues across the swap");
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});
