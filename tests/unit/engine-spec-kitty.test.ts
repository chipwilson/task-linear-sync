/**
 * T023 [022 US1] — engine-lane pins for the document task source (A-022-4; contract C2.4,
 * C3.3, C6.1, C6.2; research R8/R11). All five pins land RED: the collision refusal, the
 * kind-conditional mirror slice, the `no-content` entry label, the empty render-assignment
 * lane, and the defensive render rejection are not implemented yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { builtInAdapters } from "task-linear-sync/discovery";
import { LineRenderError, parseTaskFile, renderTaskLines } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { makeTestConfig } from "../helpers/parsing-fixtures.js";
import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const COLLISION = join(fixtureRepoPath("spec-kitty"), "../../plan/spec-kitty-collision");
const UPSTREAM = join(fixtureRepoPath("spec-kitty"), "../../plan/spec-kitty-upstream");

/** Minimal bootstrap world (placeholder identities, Principle III). */
const WORLD = {
  clock: "2026-01-01T00:00:00.000Z",
  teams: [
    {
      key: "TEAM-A",
      id: "ac000000-0000-4000-8000-000000000101",
      projects: [{ id: "proj-alpha", name: "Project Alpha" }],
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
        projects: ["proj-alpha"],
        workflowStates: {
          backlog: "Backlog",
          todo: "Todo",
          done: "Done",
          completedTypes: ["completed"],
          ignoredTypes: ["canceled", "duplicate"],
        },
      },
    },
    defaultTeamKey: "TEAM-A",
    defaultProject: "proj-alpha",
    confirmationKey: "SYNC",
    descriptionNormalizationProfile: "default",
  },
} as const;

async function worldOver(repoFixture: string, worldJson: unknown = WORLD): Promise<{ world: EngineWorld; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-engine-"));
  await writeFile(join(scratch, "world.json"), JSON.stringify(worldJson), "utf8");
  await cp(repoFixture, join(scratch, "repo"), { recursive: true });
  const world = await buildWorld(scratch);
  return { world, scratch };
}

/**
 * (a) C2.4 / R8 — duplicate normalized WP ids in one mission are a HARD plan-build
 * refusal. Deterministic finding: framework, mission, id, and BOTH colliding paths in
 * byte-wise ascending order (`WP01-alpha.md` before `wp01-beta.md` — capital letters sort
 * before lowercase, the same byte-wise order the repository sorts discovery paths with).
 */
test("022 engine: a duplicate WP id in one mission refuses plan build with the deterministic C2.4 finding — no plan, no winner, no tracker call", async () => {
  const { world, scratch } = await worldOver(COLLISION);
  try {
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    await assert.rejects(
      engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error, "plan build throws");
        const message = error.message;
        assert.match(message, /spec-kitty/u, "names the framework");
        assert.match(message, /001-demo/u, "names the mission");
        assert.match(message, /WP01/u, "names the colliding id");
        const alpha = message.indexOf("kitty-specs/001-demo/tasks/WP01-alpha.md");
        const beta = message.indexOf("kitty-specs/001-demo/tasks/wp01-beta.md");
        assert.ok(alpha >= 0 && beta >= 0, "names BOTH colliding paths");
        assert.ok(alpha < beta, "paths are listed in byte-wise ascending order (deterministic, R8)");
        return true;
      },
    );
    assert.deepEqual(callsOf(world, "createIssue"), [], "no tracker call — no apply is reachable without a plan");

    // Removing one file restores a clean plan (the refusal is mission-scoped).
    await rm(join(world.repositoryRoot, "kitty-specs/001-demo/tasks/wp01-beta.md"));
    const engine2 = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan = await engine2.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, 1, "WP01-alpha plans alone once the duplicate is gone");
    assert.equal(plan.entries[0]!.filePath, "kitty-specs/001-demo/tasks/WP01-alpha.md");
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

/** (b)/(d) C6.2 + C6.1 — the document mirror slice is INCLUSIVE and render assignments stay empty. */
test("022 engine: a document task mirrors startLine..endLine inclusive (heading in, front matter out) and carries EMPTY expectedMarkdownChanges", async () => {
  const { world, scratch } = await worldOver(UPSTREAM);
  try {
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, 5, "five WP documents, five entries — roll-ups contribute nothing");
    assert.ok(
      plan.entries.every((e) => e.expectedMarkdownChanges.length === 0),
      "C6.1 — document tasks are excluded from render assignments",
    );

    const applied = await engine.applySyncPlan(plan, {
      applyFlag: true,
      confirmationKey: world.config.confirmationKey,
      acceptLowConfidence: plan.lowConfidencePresent,
      planReference: plan.planId,
    });
    assert.equal(applied.status, "applied");
    const creates = callsOf(world, "createIssue");
    const target = creates
      .map((c) => c.args[0] as { title: string; description?: string })
      .find((c) => c.title === "Release Validation Tooling");
    assert.ok(target, "the target document created");
    const description = target.description ?? "";
    assert.ok(description.includes("# WP01 — Release Validation Tooling"), "C6.2 — the leading heading line IS mirrored (inclusive slice, R11)");
    assert.ok(description.includes("## Objectives & Success Criteria"), "the body mirrors verbatim");
    assert.ok(!description.includes("work_package_id:"), "front matter stays excluded (C3.2)");
    assert.ok(!description.includes("lane_history"), "front-matter lanes never reach the tracker");
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

/** Heading/checklist mirror behavior is byte-identical: the `+1` skip keeps excluding the task's own line (SC-005). */
test("022 engine: the non-document mirror slice keeps the +1 skip — the task line itself never enters the mirrored description", async () => {
  // A synthetic bmad mission (placeholder identities, Principle III): one heading task
  // with body lines. Document mode must not shift the legacy slice posture.
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-parity-"));
  try {
    await writeFile(join(scratch, "world.json"), JSON.stringify(WORLD), "utf8");
    const repo = join(scratch, "repo");
    await mkdir(join(repo, "bmad/001-parity"), { recursive: true });
    await writeFile(
      join(repo, "bmad/001-parity/tasks.md"),
      [
        "## 1. Set up the scaffold",
        "",
        "The scaffold must compile cleanly.",
        "Dependencies: none.",
        "",
      ].join("\n"),
      "utf8",
    );
    const world = await buildWorld(scratch);
    try {
      const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
      const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
      assert.equal(plan.entries.length, 1, "one heading task planned");
      const applied = await engine.applySyncPlan(plan, {
        applyFlag: true,
        confirmationKey: world.config.confirmationKey,
        acceptLowConfidence: plan.lowConfidencePresent,
        planReference: plan.planId,
      });
      assert.equal(applied.status, "applied");
      const create = callsOf(world, "createIssue")[0];
      assert.ok(create);
      const description = ((create.args[0] as { description?: string }).description ?? "");
      assert.ok(!description.includes("## 1. Set up the scaffold"), "the task's OWN heading line stays excluded (the +1 skip is unchanged)");
      assert.ok(description.includes("The scaffold must compile cleanly"), "the body below it is mirrored");
    } finally {
      await world.dispose();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

/** (c) C3.3 / R11 — a front-matter-only document plans an entry with the visible `no-content` label. */
test("022 engine: the front-matter-only document plans one entry whose report label says no-content", async () => {
  const { world, scratch } = await worldOver(fixtureRepoPath("spec-kitty"));
  try {
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    const emptyBody = plan.entries.find((e) => e.filePath.endsWith("front-matter-only.md"));
    assert.ok(emptyBody, "the entry exists — an empty body is never a silent drop (C3.3)");
    assert.ok(
      (emptyBody.reasons as readonly string[]).includes("no-content"),
      `entry labels carry the visible no-content label (entry-label channel, R11); got ${JSON.stringify(emptyBody.reasons)}`,
    );
    // The content hash channel is unchanged in shape: a hash, never a raw body.
    assert.equal(typeof emptyBody.descriptionContentHash, "string");
    assert.equal(emptyBody.descriptionContentHash.length, 64, "still a sha256 hex digest — report schema untouched");
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

/** (e) C6.1 defensive lane — a document-kind render assignment is a structural mismatch. */
test("022 engine: renderTaskLines rejects a document-kind assignment with LineRenderError structure-mismatch", () => {
  const kitty = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;
  const docPath = "kitty-specs/001-demo/tasks/WP01-scaffold.md";
  const content = [
    "---",
    "work_package_id: WP01",
    "title: Scaffold",
    "---",
    "",
    "# Work Package WP01: Scaffold",
    "",
    "Body text.",
    "",
  ].join("\n");
  const parsed = parseTaskFile(docPath, content, kitty, makeTestConfig());
  assert.equal(parsed.file.tasks.length, 1, "precondition: one document task");
  const assignment = {
    task: parsed.file.tasks[0]!,
    desiredTitle: "Scaffold",
    issueRef: { key: "SYNC", number: 1 },
  };
  assert.throws(
    () => renderTaskLines(docPath, content, [assignment], makeTestConfig()),
    (error: unknown) =>
      error instanceof LineRenderError &&
      error.reason === "structure-mismatch" &&
      error.name === "LineRenderError",
    "document tasks have no renderable line (R10) — assignment is a structure mismatch",
  );
});
