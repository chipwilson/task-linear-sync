/**
 * T021 [022 US1] — Spec Kitty discovery + planning over the corrected task source, with
 * DEFAULT configuration (`builtInDefaults`, zero configuration keys set by the consumer).
 * Re-based from the 017 suite per R13: the superseded pins (tasks-directory exclusion,
 * roll-up checkbox tasks, capability-tag rules) are replaced by the corrected contract
 * references (contracts/spec-kitty-work-packages.md C0–C6, FR-005/FR-006/FR-009).
 *
 *  - (a) count parity per mission — one plan/parse task per recognized WP document, zero
 *    tasks originate from `tasks.md` (FR-009/SC-001, C2.3);
 *  - (b) the claimed-file set over the T002 fixture — collection docs AND roll-ups, all
 *    framework `spec-kitty` with mission feature names, NEVER `tasks` (FR-006); `spec.md`
 *    and `tasks/img.png` never candidates (C1.2);
 *  - (c) SC-002 over the T003 upstream-reproduction fixture — every WP document yields a
 *    non-empty title (front matter beats the decorative heading) and non-empty content
 *    carrying its Objectives section and `Tnnn` guidance, with no raw front matter (C3.1,
 *    C3.2);
 *  - (d) a roll-up-only mission contributes zero tasks — not an error;
 *  - plus the fake-`Linear_Port` lifecycle (create titles, idempotence), path-rule routing,
 *    and the FR-011 opt-out, all re-based to the document counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { builtInAdapters, createAdapterRegistry, discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveryOverrides, DiscoveryResult } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";
import type { Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { makeTestConfig } from "../helpers/parsing-fixtures.js";
import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const KITTY = fixtureRepoPath("spec-kitty");
const UPSTREAM = join(KITTY, "../../plan/spec-kitty-upstream");

/** The shipped row, viewed through the 004 consumer interface. */
const kitty = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;

async function discoverKitty(overrides?: DiscoveryOverrides): Promise<DiscoveryResult> {
  return discoverTaskFiles({ repositoryRoot: KITTY, config: builtInDefaults, gitContext: false, ...(overrides ? { overrides } : {}) });
}

function paths(result: DiscoveryResult): string[] {
  return result.files.map((f) => f.filePath);
}

/** The mirrored-slice posture (C6.2): inclusive startLine..endLine over the file lines. */
function slice(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  return endLine < startLine ? "" : lines.slice(startLine - 1, endLine).join("\n");
}

test("discovery spec-kitty (022): the claimed-file set — collection docs + roll-ups, mission features, siblings and non-md stay out (b, C1.2, FR-006)", async () => {
  const result = await discoverKitty();
  assert.deepEqual(paths(result), [
    "kitty-specs/001-demo/tasks.md",
    "kitty-specs/001-demo/tasks/WP01-scaffold.md",
    "kitty-specs/001-demo/tasks/WP03-no-title.md",
    "kitty-specs/001-demo/tasks/front-matter-only.md",
    "kitty-specs/001-demo/tasks/notes.md",
    "kitty-specs/001-demo/tasks/review-feedback.md",
    "kitty-specs/002-billing/tasks.md",
    "kitty-specs/002-billing/tasks/planned/WP01-billing.md",
    "kitty-specs/003-plan-only/tasks.md",
  ]);
  for (const file of result.files) {
    assert.equal(file.frameworkId, "spec-kitty", "identity from the kitty-specs/ path alone (C2.1)");
    assert.equal(file.adapterId, "spec-kitty");
    assert.equal(file.detection.via, "path");
    assert.deepEqual(file.detection.candidates, ["spec-kitty"]);
    assert.notEqual(file.featureName, "tasks", "a lane or the tasks folder is NEVER the feature (FR-006, R3)");
  }
  const byPath = new Map(result.files.map((f) => [f.filePath, f.featureName]));
  assert.equal(byPath.get("kitty-specs/001-demo/tasks/WP01-scaffold.md"), "001-demo");
  assert.equal(byPath.get("kitty-specs/001-demo/tasks/notes.md"), "001-demo");
  assert.equal(byPath.get("kitty-specs/002-billing/tasks/planned/WP01-billing.md"), "002-billing", "a lane sub-folder sits deeper — the mission names it (R3)");
  assert.equal(byPath.get("kitty-specs/003-plan-only/tasks.md"), "003-plan-only");
  assert.deepEqual(result.files[0]!.siblingDocuments, ["kitty-specs/001-demo/spec.md"], "spec.md is sibling material, never a candidate (C1.2)");
  assert.ok(!paths(result).some((p) => p.endsWith("img.png")), "non-.md attachments never enter candidates (C1.2)");
  assert.ok(!paths(result).some((p) => p.startsWith(".kittify/")), "the .kittify/ tooling tree stays outside the collection");
  assert.deepEqual(result.diagnostics, [], "zero diagnostics on the reference layout");
});

test("discovery spec-kitty (022): parse parity per mission — zero tasks from every roll-up, one document task per recognized document (a, C2.3, FR-009)", async () => {
  const expectations: readonly (readonly [string, number, string | null, string | null])[] = [
    // [filePath, taskCount, localTaskId, title]
    ["kitty-specs/001-demo/tasks.md", 0, null, null],
    ["kitty-specs/001-demo/tasks/WP01-scaffold.md", 1, "WP01", "Scaffold"],
    ["kitty-specs/001-demo/tasks/WP03-no-title.md", 1, "WP03", "No Title"],
    ["kitty-specs/001-demo/tasks/front-matter-only.md", 1, "WP02", "Empty Body"],
    ["kitty-specs/001-demo/tasks/notes.md", 0, null, null],
    ["kitty-specs/001-demo/tasks/review-feedback.md", 0, null, null],
    ["kitty-specs/002-billing/tasks.md", 0, null, null],
    ["kitty-specs/002-billing/tasks/planned/WP01-billing.md", 1, "WP01", "Billing"],
    ["kitty-specs/003-plan-only/tasks.md", 0, null, null],
  ];
  const result = await discoverKitty();
  assert.equal(result.files.length, expectations.length);
  for (const [filePath, taskCount, localTaskId, title] of expectations) {
    const content = readFileSync(join(KITTY, filePath), "utf8");
    const { file, exclusions, warnings } = parseTaskFile(filePath, content, kitty, builtInDefaults);
    assert.equal(file.tasks.length, taskCount, `${filePath} — 0-or-1 document task`);
    // 023 A-023-2: line scanning stays zero; the ONLY exclusions a document parse can
    // produce are front-matter roster records with no anchor (recognized-but-never-issue).
    const expectedExclusions =
      filePath === "kitty-specs/001-demo/tasks/WP01-scaffold.md"
        ? [
            { lineNumber: 7, kind: "subtask", reason: "subtask-no-anchor", text: "T001" },
            { lineNumber: 8, kind: "subtask", reason: "subtask-no-anchor", text: "T002" },
          ]
        : [];
    assert.deepEqual(exclusions, expectedExclusions, `${filePath} — no line scanning, roster misses only`);
    assert.deepEqual(warnings, []);
    if (taskCount === 1) {
      const task = file.tasks[0]!;
      assert.equal(task.kind, "document", `${filePath} — document kind`);
      assert.equal(task.localTaskId, localTaskId);
      assert.equal(task.title, title, `${filePath} — title cascade`);
    }
  }
  // (d) a roll-up-only mission: claimed, zero tasks, no error of any kind.
  const planOnly = parseTaskFile("kitty-specs/003-plan-only/tasks.md", readFileSync(join(KITTY, "kitty-specs/003-plan-only/tasks.md"), "utf8"), kitty, builtInDefaults);
  assert.deepEqual(planOnly.file.tasks, []);
});

test("discovery spec-kitty (022): SC-002 over the upstream-reproduction fixture — titles and content carry the curated detail, never front matter (c, C3.1, C3.2, C6.2)", async () => {
  const result = await discoverTaskFiles({ repositoryRoot: UPSTREAM, config: builtInDefaults, gitContext: false });
  const byPath = new Map(result.files.map((f) => [f.filePath, f]));
  // Both missions: roll-up + every WP document claimed (5 documents across 2 missions).
  assert.equal(paths(result).length, 7, "two roll-ups + five work-package documents");
  assert.equal(result.files.filter((f) => f.filePath.includes("/tasks/")).length, 5);

  const missionCounts: Record<string, number> = {};
  for (const filePath of paths(result)) {
    const mission = filePath.split("/")[1] as string;
    missionCounts[mission] = (missionCounts[mission] ?? 0) + (filePath.includes("/tasks/") ? 1 : 0);
  }
  assert.deepEqual(missionCounts, { "001-triage": 2, "002-lightweight-pypi-release": 3 }, "count parity — one claimed document per work package");

  const targetPath = "kitty-specs/002-lightweight-pypi-release/tasks/WP01-release-validation-tooling.md";
  const content = readFileSync(join(UPSTREAM, targetPath), "utf8");
  const { file } = parseTaskFile(targetPath, content, kitty, builtInDefaults);
  assert.equal(file.featureName, "002-lightweight-pypi-release");
  assert.equal(file.tasks.length, 1);
  const task = file.tasks[0]!;
  assert.equal(task.title, "Release Validation Tooling", "front-matter title BEATS the decorative `# WP01 — …` heading (C3.1, SC-002)");
  assert.ok(task.title.length > 0 && !task.title.includes("---"), "non-empty title, no raw front matter");

  const body = slice(content, task.taskBody.startLine, task.taskBody.endLine);
  assert.ok(body.startsWith("# WP01 — Release Validation Tooling"), "the mirrored slice IS the inclusive body extent — leading heading included (C6.2, R11)");
  assert.ok(body.includes("## Objectives & Success Criteria"), "the Objectives section is mirrored (SC-002)");
  assert.match(body, /T\d{3}/u, "the Tnnn subtask guidance is mirrored (SC-002)");
  assert.ok(!body.includes("work_package_id:"), "front matter is excluded from content (C3.2)");
  assert.ok(!body.includes("lane_history"), "front-matter lanes never reach the mirror");
  assert.equal(byPath.size, 7);
});

// ──────────────────────────────── US1-AC3 / US1-AC4 — fake Linear_Port (document counts) ────────────────────────────────

/** Minimal bootstrap world (placeholder identities, Principle III); repo = the T002 fixture. */
const KITTY_WORLD = {
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

/** Scratch fixture dir (world.json + repo/ copy of the T002 fixture) → hermetic engine world. */
async function buildKittyWorld(): Promise<{ world: EngineWorld; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-kitty-"));
  await writeFile(join(scratch, "world.json"), JSON.stringify(KITTY_WORLD), "utf8");
  await cp(KITTY, join(scratch, "repo"), { recursive: true });
  const world = await buildWorld(scratch);
  return { world, scratch };
}

function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** One recognized document per WP: Scaffold, No Title, Empty Body, Billing — the roll-ups plan nothing. */
const DOCUMENT_TITLES = ["Scaffold", "No Title", "Empty Body", "Billing"];

test("discovery spec-kitty (022): US1-AC3 + US1-AC4 — one issue per work-package document, and the second plan run lands zero create/update", async () => {
  const { world, scratch } = await buildKittyWorld();
  try {
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, DOCUMENT_TITLES.length, "exactly one plan entry per recognized WP document (FR-009)");
    assert.ok(plan.entries.every((e) => e.frameworkId === "spec-kitty"));
    assert.deepEqual(
      new Set(plan.entries.map((e) => e.featureName)),
      new Set(["001-demo", "002-billing"]),
      "US1-AC2 — every planned task carries its mission Feature_Name; 003-plan-only plans nothing",
    );
    assert.ok(!plan.entries.some((e) => e.filePath.endsWith("tasks.md")), "zero entries originate from a roll-up (FR-009)");
    assert.ok(plan.entries.every((e) => e.decision === "create"), "bootstrap: every document creates");

    const applied = await engine.applySyncPlan(plan, passingGates(world, plan));
    assert.equal(applied.status, "applied");
    assert.ok(applied.operations.every((o) => o.status !== "failed"), "no failed operation");

    const creates = callsOf(world, "createIssue");
    assert.equal(creates.length, DOCUMENT_TITLES.length, "exactly one create per document");
    const titles = creates.map((c) => (c.args[0] as { title: string }).title).sort();
    assert.deepEqual(titles, [...DOCUMENT_TITLES].sort(), "cascaded titles land verbatim — no printed ids, no tags, no front matter (US1-AC3)");

    // US1-AC4 — fully synced; an identical second plan run mutates nothing.
    const engine2 = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan2.entries.length, DOCUMENT_TITLES.length);
    const pending = plan2.entries.filter((e) => e.decision === "create" || e.decision === "update");
    assert.deepEqual(
      pending.map((e) => [e.filePath, e.taskUuid]),
      [],
      `zero create/update actions on the second run (decisions: ${plan2.entries.map((e) => e.decision).join(", ")})`,
    );
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("discovery spec-kitty (022): edge case — a mission directory with spec.md/plan.md but no task file yields no candidate and no diagnostic", async () => {
  const { world, scratch } = await buildKittyWorld();
  try {
    const base = join(world.repositoryRoot, "kitty-specs", "004-docs-only");
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "spec.md"), "# Specification: 004-docs-only\n\nNothing planned yet.\n", "utf8");
    await writeFile(join(base, "plan.md"), "# Plan: 004-docs-only\n\nNo tasks file written.\n", "utf8");

    const discovery = await discoverTaskFiles({ repositoryRoot: world.repositoryRoot, config: builtInDefaults, gitContext: false });
    assert.ok(
      !discovery.files.some((f) => f.filePath.startsWith("kitty-specs/004-docs-only/")),
      "spec.md/plan.md never become task files",
    );
    assert.deepEqual(
      discovery.diagnostics.filter((d) => d.path.startsWith("kitty-specs/004-docs-only/")),
      [],
      "the bare mission directory raises no diagnostic at all",
    );

    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, DOCUMENT_TITLES.length);
    assert.ok(!plan.entries.some((e) => e.filePath.startsWith("kitty-specs/004-docs-only/")));
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

/** The T002 world plus one path rule sending the 002 mission to its own project (US3-AC1). */
const KITTY_ROUTED_WORLD = {
  ...KITTY_WORLD,
  teams: [
    {
      ...KITTY_WORLD.teams[0],
      projects: [
        { id: "proj-alpha", name: "Project Alpha" },
        { id: "proj-billing", name: "Billing" },
      ],
    },
  ],
  config: {
    ...KITTY_WORLD.config,
    teams: { "TEAM-A": { ...KITTY_WORLD.config.teams["TEAM-A"], projects: ["proj-alpha", "proj-billing"] } },
    projectByPath: [{ prefix: "kitty-specs/002-billing", teamKey: "TEAM-A", project: "proj-billing" }],
  },
} as const;

test("discovery spec-kitty (022): T018 routing case — a path rule on the 002 mission splits the plan across two projects (US3-AC1)", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-kitty-routing-"));
  try {
    await writeFile(join(scratch, "world.json"), JSON.stringify(KITTY_ROUTED_WORLD), "utf8");
    await cp(KITTY, join(scratch, "repo"), { recursive: true });
    const world = await buildWorld(scratch);
    try {
      const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
      const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
      assert.equal(plan.entries.length, DOCUMENT_TITLES.length);

      const routed = plan.entries.map((e) => ({ file: e.filePath, project: e.routing?.project ?? "?" }));
      const billing = routed.filter((r) => r.file.startsWith("kitty-specs/002-billing/"));
      const demo = routed.filter((r) => r.file.startsWith("kitty-specs/001-demo/"));
      assert.equal(billing.length, 1, "the billing lane document plans once");
      assert.equal(demo.length, 3);
      assert.ok(
        billing.every((r) => r.project === "proj-billing"),
        `002-billing routes to proj-billing per the configured rule (${billing.map((r) => r.project).join(", ")})`,
      );
      assert.ok(
        demo.every((r) => r.project === "proj-alpha"),
        "001-demo keeps the default project — missions route independently (US3-AC1)",
      );
      const billingEntry = plan.entries.find((e) => e.filePath.startsWith("kitty-specs/002-billing/"))!;
      assert.equal(billingEntry.routing?.matchedPrefix, "kitty-specs/002-billing", "the path rule matched");
      assert.equal(billingEntry.routing?.defaulted, false);
      const demoEntry = plan.entries.find((e) => e.filePath.startsWith("kitty-specs/001-demo/"))!;
      assert.equal(demoEntry.routing?.matchedPrefix, undefined, "no rule matched 001-demo — default routing");
    } finally {
      await world.dispose();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("discovery spec-kitty (022): FR-011 opt-out — removing spec-kitty from frameworkAdapters removes every trace of the row (C2.6, FR-013)", async () => {
  const disabledConfig = {
    ...structuredClone(builtInDefaults),
    frameworkAdapters: builtInDefaults.frameworkAdapters.filter((id) => id !== "spec-kitty"),
  };

  // 1. Enabled pool: the row's patterns leave the pool as a unit (022: the row carries NO
  //    exclusion — the pool never has one; its path patterns and document mode are gone).
  const enabledPool = createAdapterRegistry(builtInDefaults).enabledAdapters;
  assert.ok(
    enabledPool.some((a) => a.id === "spec-kitty" && a.documentTaskRule !== undefined && a.taskPathPatterns !== undefined),
    "with spec-kitty enabled the pool carries the document row",
  );
  const disabledPool = createAdapterRegistry(disabledConfig).enabledAdapters;
  assert.ok(
    !disabledPool.some((a) => a.id === "spec-kitty"),
    "spec-kitty is not in the enabled adapter pool",
  );
  assert.ok(
    disabledPool.every((a) => a.documentTaskRule === undefined),
    "no document-mode adapter remains — document parsing is unreachable (FR-013)",
  );
  assert.ok(
    disabledPool.every((a) => (a.frameworkSpecificExclusions ?? []).length === 0),
    "the pool carries no framework exclusions (022 emptied the row's list)",
  );

  // 2. Claims: the roll-ups fall back to `generic` exactly as before the row existed —
  //    positional parsing (printed ids stay INSIDE the title, no local ids) and no mission
  //    feature name; the collection documents are invisible again.
  const result = await discoverTaskFiles({ repositoryRoot: KITTY, config: disabledConfig, gitContext: false });
  assert.deepEqual(paths(result), [
    "kitty-specs/001-demo/tasks.md",
    "kitty-specs/002-billing/tasks.md",
    "kitty-specs/003-plan-only/tasks.md",
  ]);
  assert.ok(result.files.every((f) => f.adapterId === "generic"), `roll-ups fall back to generic (${result.files.map((f) => f.adapterId).join(", ")})`);
  assert.ok(
    result.files.every((f) => (f.featureName ?? null) === null),
    "no mission name — the spec-kitty feature extraction is gone",
  );

  const rollUp = readFileSync(join(KITTY, "kitty-specs/001-demo/tasks.md"), "utf8");
  const parsed = parseTaskFile(
    "kitty-specs/001-demo/tasks.md",
    rollUp,
    builtInAdapters.generic as unknown as TaskFileAdapter,
    makeTestConfig({ maxTaskIssueDepth: 64 }), // generic orphan-parent rule: pin the pre-feature cap
  );
  const checklist = parsed.file.tasks.filter((t) => t.kind === "checklist");
  assert.ok(checklist.length > 0, "generic still claims the checkboxes");
  assert.ok(
    checklist.every((t) => (t.localTaskId ?? null) === null),
    "no printed-id extraction — ids would be positional (identity as before the row)",
  );
  assert.ok(
    checklist.some((t) => t.title.includes("T001 Create the scaffold")),
    "the printed id stays inside the title under generic parsing",
  );
});
