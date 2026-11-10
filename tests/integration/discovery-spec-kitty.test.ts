/**
 * T013 [017 US1] — zero-configuration Spec Kitty discovery + planning over the T011
 * reference fixture `tests/fixtures/repos/discovery/spec-kitty/` with DEFAULT
 * configuration (`builtInDefaults`, zero configuration keys set by the consumer).
 *
 * Pins per contracts/spec-kitty-adapter.md:
 *  - SC-001 — 100% of the two mission roll-ups claimed as `spec-kitty`; 0 non-mission
 *    Markdown files claimed (`spec.md` siblings stay siblings, the per-work-package
 *    prompt files under `tasks/` and the `.kittify/` contents never become task files).
 *  - US1-AC1 — each roll-up yields exactly the checkbox subtasks with `localTaskId`
 *    equal to the printed `Txxx` and titles without the id span.
 *  - US1-AC2 — every task carries the mission directory as `Feature_Name`.
 *  - US1-AC3 — created issue titles contain neither the printed id prefix nor the
 *    `[P]`/`[USn]` capability tag (C3.5) — asserted on the fake port's create inputs.
 *  - US1-AC4 — after a full sync, a second identical plan run yields zero
 *    create/update decisions (C4 idempotence, fake `Linear_Port` via the 008 harness).
 *  - C2.5 robustness — the prompt files stay undiscovered even when
 *    `DiscoveryOverrides.adapters` broadens `taskFilePatterns` to `*.md`: the
 *    `kitty-specs` tasks-directory exclusion, not pattern luck, keeps them out.
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

/** The shipped row, viewed through the 004 consumer interface. */
const kitty = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;

async function discoverKitty(overrides?: DiscoveryOverrides): Promise<DiscoveryResult> {
  return discoverTaskFiles({ repositoryRoot: KITTY, config: builtInDefaults, gitContext: false, ...(overrides ? { overrides } : {}) });
}

function paths(result: DiscoveryResult): string[] {
  return result.files.map((f) => f.filePath);
}

test("discovery spec-kitty: SC-001 — both mission roll-ups claimed, nothing else (0 missed, 0 false)", async () => {
  const result = await discoverKitty();
  assert.deepEqual(
    paths(result),
    ["kitty-specs/001-demo/tasks.md", "kitty-specs/002-billing/tasks.md"],
    "exactly the two roll-ups — spec.md siblings, tasks/ prompt files, and .kittify/ contents never claimed",
  );
  assert.deepEqual(result.refusals, [], "0 refusals");
  assert.deepEqual(result.diagnostics, [], "0 diagnostics");
  for (const file of result.files) {
    assert.equal(file.frameworkId, "spec-kitty", "identity from the kitty-specs/ path alone (C2.1)");
    assert.equal(file.adapterId, "spec-kitty");
    assert.equal(file.detection.via, "path");
    assert.deepEqual(file.detection.candidates, ["spec-kitty"]);
    assert.ok(!file.filePath.includes("/tasks/"), "prompt-file directory content is never a task file (C2.5)");
  }
  // Siblings are the existing spec.md docs — sibling material, never task-file candidates.
  assert.deepEqual(result.files[0]!.siblingDocuments, ["kitty-specs/001-demo/spec.md"]);
  assert.deepEqual(result.files[1]!.siblingDocuments, ["kitty-specs/002-billing/spec.md"]);
});

test("discovery spec-kitty: US1-AC1/AC2 — printed ids, id-free titles, mission feature names (default config)", async () => {
  const expectations: readonly [string, string, readonly (readonly [string, string])[]][] = [
    [
      "kitty-specs/001-demo/tasks.md",
      "001-demo",
      [
        ["T001", "Create the scaffold"],
        ["T002", "Implement charging"],
        ["T003", "[P] Add payouts"],
        ["T004", "[US1] List transactions"],
      ],
    ],
    [
      "kitty-specs/002-billing/tasks.md",
      "002-billing",
      [
        ["T001", "[P] Generate invoice PDFs"],
        ["T002", "Email the invoice on issuance"],
        ["T003", "[US1] Verify webhook signatures"],
        ["T004", "Record the processed-event watermark"],
      ],
    ],
  ];
  for (const [filePath, featureName, tasks] of expectations) {
    const content = readFileSync(join(KITTY, filePath), "utf8");
    const { file, exclusions } = parseTaskFile(filePath, content, kitty, builtInDefaults);
    assert.equal(file.frameworkId, "spec-kitty");
    assert.equal(file.featureName, featureName, "US1-AC2 — the mission directory is the Feature_Name with zero configuration");
    assert.equal(file.tasks.length, tasks.length, `${filePath} — exactly the checkbox subtasks (US1-AC1)`);
    assert.deepEqual(
      file.tasks.map((t) => [t.localTaskId, t.title] as const),
      tasks,
      `${filePath} — local ids equal the printed ids; titles exclude the id span, keep tags (file content)`,
    );
    for (const task of file.tasks) assert.equal(task.kind, "checklist", "zero heading tasks (C3.1)");
    const illustrative = content.split("\n").findIndex((l) => l.includes("illustrative checkbox")) + 1;
    assert.ok(illustrative > 0, "the fixture keeps its unfenced `## Inputs` illustrative checkbox");
    const excluded = exclusions.filter((e) => e.reason === "summary-section");
    assert.ok(
      excluded.some((e) => e.lineNumber === illustrative),
      "the template checkbox is an exclusion record, not a task (C3.3)",
    );
  }
});

test("discovery spec-kitty: C2.5 — prompt files stay undiscovered even when taskFilePatterns broadens to *.md", async () => {
  const result = await discoverKitty({ adapters: { "spec-kitty": { taskFilePatterns: ["tasks.md", "TASKS.md", "*.md"] } } });
  for (const filePath of paths(result)) {
    assert.ok(!/\/tasks\/.+\.md$/u.test(filePath), `prompt file '${filePath}' must never be claimed — exclusion, not pattern luck`);
  }
  assert.ok(paths(result).includes("kitty-specs/001-demo/tasks.md"), "the roll-ups stay discovered");
  assert.ok(paths(result).includes("kitty-specs/002-billing/tasks.md"), "the roll-ups stay discovered");
});

// ──────────────────────────────────────────── US1-AC3 / US1-AC4 — fake Linear_Port ────────────────────────────────────────────

/** Minimal bootstrap world (placeholder identities, Principle III); repo = the T011 fixture. */
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

/** Scratch fixture dir (world.json + repo/ copy of the T011 fixture) → hermetic engine world. */
async function buildKittyWorld(): Promise<{ world: EngineWorld; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "tls-017-kitty-"));
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

test("discovery spec-kitty: US1-AC3 + US1-AC4 — created titles carry no id/tag, and the second plan run lands zero create/update", async () => {
  const { world, scratch } = await buildKittyWorld();
  try {
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, 8, "both missions — all eight printed subtasks planned");
    assert.ok(plan.entries.every((e) => e.frameworkId === "spec-kitty"));
    assert.deepEqual(
      new Set(plan.entries.map((e) => e.featureName)),
      new Set(["001-demo", "002-billing"]),
      "US1-AC2 — every planned task carries its mission Feature_Name",
    );
    assert.ok(plan.entries.every((e) => e.decision === "create"), "bootstrap: every task creates");

    const applied = await engine.applySyncPlan(plan, passingGates(world, plan));
    assert.equal(applied.status, "applied");
    assert.ok(
      applied.operations.every((o) => o.status !== "failed"),
      "no failed operation",
    );

    // US1-AC3 — the tracker never sees the printed id prefix or a capability tag.
    const creates = callsOf(world, "createIssue");
    assert.equal(creates.length, 8, "exactly one create per task");
    const titles = creates.map((c) => (c.args[0] as { title: string }).title);
    for (const title of titles) {
      assert.ok(!/\bT\d{2,}\b/u.test(title), `created title '${title}' carries no printed id prefix`);
      assert.ok(!/\[(?:P\d*|US\d+)\]/u.test(title), `created title '${title}' carries no capability tag (C3.5)`);
    }
    assert.ok(
      titles.some((t) => t.includes("Add payouts") && !t.includes("[P]")),
      "the `- [ ] T003 [P] Add payouts` subtask lands as a tag-free issue title (US1-AC3)",
    );

    // US1-AC4 — fully synced; an identical second plan run mutates nothing.
    const engine2 = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan2.entries.length, 8);
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

test("discovery spec-kitty: edge case — a mission directory with spec.md/plan.md but no task file yields no candidate and no diagnostic worse than informational", async () => {
  const { world, scratch } = await buildKittyWorld();
  try {
    // The third mission carries spec.md + plan.md but NO tasks.md (spec Edge Cases).
    const base = join(world.repositoryRoot, "kitty-specs", "003-docs-only");
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "spec.md"), "# Specification: 003-docs-only\n\nNothing planned yet.\n", "utf8");
    await writeFile(join(base, "plan.md"), "# Plan: 003-docs-only\n\nNo tasks file written.\n", "utf8");

    const discovery = await discoverTaskFiles({ repositoryRoot: world.repositoryRoot, config: builtInDefaults, gitContext: false });
    assert.ok(
      !discovery.files.some((f) => f.filePath.startsWith("kitty-specs/003-docs-only/")),
      "spec.md/plan.md never become task files",
    );
    assert.deepEqual(
      discovery.diagnostics.filter((d) => d.path.startsWith("kitty-specs/003-docs-only/")),
      [],
      "the bare mission directory raises no diagnostic at all (nothing worse than informational)",
    );

    // And planning simply ignores the directory: still exactly the eight planned subtasks.
    const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
    assert.equal(plan.entries.length, 8);
    assert.ok(!plan.entries.some((e) => e.filePath.startsWith("kitty-specs/003-docs-only/")));
  } finally {
    await world.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

/** The T011 world plus one path rule sending the 002 mission to its own project (US3-AC1). */
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

test("discovery spec-kitty: T018 routing case — a path rule on the 002 mission splits the plan across two projects (US3-AC1)", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "tls-017-kitty-routing-"));
  try {
    await writeFile(join(scratch, "world.json"), JSON.stringify(KITTY_ROUTED_WORLD), "utf8");
    await cp(KITTY, join(scratch, "repo"), { recursive: true });
    const world = await buildWorld(scratch);
    try {
      const engine = attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
      const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
      assert.equal(plan.entries.length, 8, "one discovery run discovers both missions");

      const routed = plan.entries.map((e) => ({ file: e.filePath, project: e.routing?.project ?? "?" }));
      const billing = routed.filter((r) => r.file.startsWith("kitty-specs/002-billing/"));
      const demo = routed.filter((r) => r.file.startsWith("kitty-specs/001-demo/"));
      assert.equal(billing.length, 4);
      assert.equal(demo.length, 4);
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

test("discovery spec-kitty: FR-011 opt-out — removing spec-kitty from frameworkAdapters removes every trace of the row (C2.6)", async () => {
  const disabledConfig = {
    ...structuredClone(builtInDefaults),
    frameworkAdapters: builtInDefaults.frameworkAdapters.filter((id) => id !== "spec-kitty"),
  };

  // 1. Enabled pool: the tasks-directory exclusion disappears exactly when the row is
  //    removed (discover.ts skip set is built from the enabled adapters' exclusions).
  const poolExclusions = (reg: ReturnType<typeof createAdapterRegistry>) =>
    reg.enabledAdapters.flatMap((a) => [...(a.frameworkSpecificExclusions ?? [])]);
  assert.ok(
    poolExclusions(createAdapterRegistry(builtInDefaults)).includes("kitty-specs/*/tasks/"),
    "with spec-kitty enabled the pool carries the exclusion",
  );
  assert.ok(
    !poolExclusions(createAdapterRegistry(disabledConfig)).includes("kitty-specs/*/tasks/"),
    "with spec-kitty disabled no enabled adapter carries the exclusion (C2.6)",
  );
  assert.ok(
    !createAdapterRegistry(disabledConfig).enabledAdapters.some((a) => a.id === "spec-kitty"),
    "spec-kitty is not in the enabled adapter pool",
  );

  // 2. Claims: the roll-ups fall back to `generic` exactly as before this feature —
  //    positional parsing (printed ids stay INSIDE the title, no local ids) and no
  //    mission feature name.
  const result = await discoverTaskFiles({ repositoryRoot: KITTY, config: disabledConfig, gitContext: false });
  assert.deepEqual(paths(result), ["kitty-specs/001-demo/tasks.md", "kitty-specs/002-billing/tasks.md"]);
  assert.ok(
    result.files.every((f) => f.adapterId === "generic"),
    `roll-ups fall back to generic (${result.files.map((f) => f.adapterId).join(", ")})`,
  );
  assert.ok(
    result.files.every((f) => (f.featureName ?? null) === null),
    "no mission name — the spec-kitty feature extraction is gone",
  );

  const rollUp = readFileSync(join(KITTY, "kitty-specs/001-demo/tasks.md"), "utf8");
  const parsed = parseTaskFile(
    "kitty-specs/001-demo/tasks.md",
    rollUp,
    builtInAdapters.generic as unknown as TaskFileAdapter,
    makeTestConfig(),
  );
  const checklist = parsed.file.tasks.filter((t) => t.kind === "checklist");
  assert.ok(checklist.length > 0, "generic still claims the checkboxes");
  assert.ok(
    checklist.every((t) => (t.localTaskId ?? null) === null),
    "no printed-id extraction — ids would be positional (identity as before 017)",
  );
  assert.ok(
    checklist.some((t) => t.title.includes("T001 Create the scaffold")),
    "the printed id stays inside the title under generic parsing",
  );
});
