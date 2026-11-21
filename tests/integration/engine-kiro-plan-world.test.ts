/**
 * T011 [US1] — reported kiro-plan shape syncs as one issue per task (C4; US1 AC1/AC2; quickstart §2).
 *
 * Drives the `kiro-plan-basic` engine world — the reported file (`tests/fixtures/parsing/kiro-plan/tasks.md`:
 * one `# Implementation Plan` title heading + thirteen column-0 checkbox tasks with local ids `1`–`10`
 * incl. `4.1`–`4.3`, the `4.` task body-less) at `.kiro/specs/auth/tasks.md`, shipped defaults — through the
 * fake-`Linear_Port` seams: `buildSyncPlan` → `applySyncPlan`. Pre-fix the parser collapsed the file into
 * ONE giant `Plan` issue; post-fix the engine must create exactly 14 issues (the 13 checklist tasks + the
 * title-heading task), each carrying its own line text as its title (create/update titles are the 005
 * derivation's undecorated `baseTitle` — the frozen engine decision in `build.ts`; the `<feature>: `
 * decoration is a tracker-presentation view, not the create input), each description carrying ONLY its
 * own task region (contract C4), and the body-less `4.` task plus the preamble-less title heading landing
 * with EMPTY descriptions. The title-heading issue is titled `Implementation Plan` — never `Plan`.
 *
 * Exact per-region description equality (modulo the `default` normalization profile) is T013's scope; this
 * cell pins the containment-side regression: own detail bullet present, foreign task text absent, and no
 * description spanning the file (both far-apart file markers + a >8-newline bound rule out the giant issue).
 *
 * Hermetic (constitution VI): zero network, zero credentials, placeholder identities only (Principle III).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";
import { parseTaskFile } from "task-linear-sync/parsing";

import { attachEngine, buildWorld, callsOf, callsSince, type EngineWorld } from "../helpers/engine-harness.js";
import { kiroFixtureAdapter, makeTestConfig, readFixture } from "../helpers/parsing-fixtures.js";
import { createSyncEngine } from "../../src/engine/create.js";

// ───────────────────────────────────────────────────────────────────────────────── fixtures

/** The 13 checklist tasks' raw titles, file order (mirrors the committed fixture). */
const TASK_TITLES: readonly string[] = [
  "Set up project structure and dependencies",
  "Implement configuration management module",
  "Implement logging module",
  "Implement EC2 service module",
  "Create EC2 client wrapper with retry logic",
  "Implement instance discovery functionality",
  "Implement instance shutdown functionality",
  "Implement main Lambda handler",
  "Implement error handling and response formatting",
  "Create IAM policy and deployment configuration",
  "Write integration tests",
  "Add comprehensive error handling tests",
  "Create deployment and monitoring setup",
];

/** The exact created-issue title set: the title-heading task + the 13 checklist tasks' own texts.
 * Create/update titles are the UNDECORATED `baseTitle` (build.ts cross-lane decision) — the kiro
 * featureName `auth` drives routing and identity, not the create title. */
const EXPECTED_TITLES: readonly string[] = ["Implementation Plan", ...TASK_TITLES];

/** One checklist task's created-issue expectation: own-text title + one of its OWN detail bullets. */
interface TaskCell {
  readonly title: string;
  /** Absent ⇒ the body-less task `4.` (its next line is task `4.1`) — description must be empty. */
  readonly bullet?: string;
}

/** Representative own-region bullet per task (file order; `4.` carries no bullets). */
const TASK_CELLS: readonly TaskCell[] = [
  { title: TASK_TITLES[0] as string, bullet: "Set up Python project structure for Lambda development" },
  { title: TASK_TITLES[1] as string, bullet: "Create configuration module to read environment variables with defaults" },
  { title: TASK_TITLES[2] as string, bullet: "Create structured logger with JSON output for CloudWatch" },
  { title: TASK_TITLES[3] as string },
  { title: TASK_TITLES[4] as string, bullet: "Implement EC2 client initialization with boto3" },
  { title: TASK_TITLES[5] as string, bullet: "Create function to describe instances with specific tags" },
  { title: TASK_TITLES[6] as string, bullet: "Create function to stop individual EC2 instances" },
  { title: TASK_TITLES[7] as string, bullet: "Create main handler function that orchestrates the shutdown process" },
  { title: TASK_TITLES[8] as string, bullet: "Add top-level error handling in Lambda handler" },
  { title: TASK_TITLES[9] as string, bullet: "Write IAM policy JSON with minimal required permissions" },
  { title: TASK_TITLES[10] as string, bullet: "Create integration tests that work with real AWS services" },
  { title: TASK_TITLES[11] as string, bullet: "Write tests for AWS API throttling scenarios" },
  { title: TASK_TITLES[12] as string, bullet: "Write deployment scripts or CI/CD configuration" },
];

/** The frozen `GateRequest` satisfying every gate (pattern of engine-spec-kitty-world.test.ts). */
function gates(world: EngineWorld, lowConfidencePresent: boolean): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: lowConfidencePresent,
  };
}

/** Every attempted `createIssue`'s input, read live from the harness call log (never mutated). */
function createInputs(world: EngineWorld): CreateIssueInput[] {
  return callsOf(world, "createIssue").map((record) => record.args[0] as CreateIssueInput);
}

/** Count of `\n` characters in `text` (region-size bound on descriptions). */
function countNewlines(text: string): number {
  return text.split("\n").length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────────── test

test("engine kiro-plan world: reported implementation-plan shape creates one issue per task (C4)", async () => {
  const w = await buildWorld("kiro-plan-basic");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // 1. PLAN — bootstrap at shipped defaults: 13 checklist tasks + the title-heading task.
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 14, "13 checklist tasks + the Implementation Plan title-heading task");
    assert.ok(plan.entries.every((e) => e.decision === "create"), "empty tracker — every entry creates");
    assert.ok(plan.entries.every((e) => e.frameworkId === "kiro"), "the .kiro/ file is claimed by the kiro adapter");

    // 2. APPLY — same gates pattern as the spec-kitty world test; every op lands healthy.
    const applied = await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));
    assert.equal(applied.status, "applied");
    assert.ok(
      applied.operations.every((o) => o.status !== "failed"),
      `no op may fail in the healthy world: ${JSON.stringify(applied.operations)}`,
    );
    assert.equal(callsOf(w, "createIssue").length, 14, "one create per task (quickstart §2 outcome 2)");

    // 3. TITLES — set-equal the 14 own-text titles; the reported bug's giant-issue title is gone.
    const created = createInputs(w);
    assert.deepEqual(
      created.map((input) => input.title).sort(),
      [...EXPECTED_TITLES].sort(),
      "created titles set-equal the 14 expected own-text titles (undecorated baseTitle)",
    );
    for (const input of created) {
      assert.ok(
        input.title !== "Plan" && !input.title.endsWith(": Plan"),
        `no issue may carry the reported bug's giant-issue title, got '${input.title}' (quickstart §2 outcome 3)`,
      );
    }

    // 4. REGRESSION (C4) — no description carries another task's text or spans the whole file.
    for (const input of created) {
      for (const taskTitle of TASK_TITLES) {
        if (input.title === taskTitle) continue; // the issue's own title is not foreign text
        assert.ok(
          !input.description.includes(taskTitle),
          `issue '${input.title}' must not contain other task '${taskTitle}' text (C4)`,
        );
      }
      assert.ok(
        !(input.description.includes("Create requirements.txt") && input.description.includes("Write unit tests for logging")),
        `issue '${input.title}' carries markers from BOTH task 1 and task 3 — it spans the file (the reported bug)`,
      );
      assert.ok(
        countNewlines(input.description) <= 8,
        `issue '${input.title}' description spans ${countNewlines(input.description)} newlines — the file is 84 lines ` +
          "and the largest single-task region is 5 bullets (≤ 6 lines), so this cannot be one task's region",
      );
    }

    // 5. OWN REGION — each task issue carries at least one of its own detail bullets; the body-less
    //    task `4.` and the preamble-less title heading land with EMPTY descriptions. (Full per-region
    //    equality modulo the `default` normalization profile is T013.)
    for (const cell of TASK_CELLS) {
      const input = created.find((c) => c.title === cell.title);
      assert.ok(input !== undefined, `create input for '${cell.title}' exists`);
      if (cell.bullet === undefined) {
        assert.equal(input.description, "", `body-less task '${cell.title}' creates an empty description`);
      } else {
        assert.ok(
          input.description.includes(cell.bullet),
          `issue '${cell.title}' must contain its own detail bullet '${cell.bullet}'`,
        );
      }
    }
    const planIssue = created.find((c) => c.title === "Implementation Plan");
    assert.ok(planIssue !== undefined, "the title-heading task creates its own issue");
    assert.equal(planIssue.description, "", "the title heading has only its preamble — here none — so its description is empty");
  } finally {
    await w.dispose();
  }
});

// ─────────────────────────────────── T013 [US2] — descriptions equal their own regions ───────────────────────────────────

/** Task title → own task line in the fixture (mirrors the committed bytes; heading first). */
const TITLE_TO_LINE: ReadonlyMap<string, number> = new Map<string, number>([
  ["Implementation Plan", 1],
  ...TASK_TITLES.map((title, index) => [title, [3, 9, 15, 22, 23, 30, 37, 44, 52, 59, 65, 72, 79][index] as number] as [string, number]),
]);

/** Following task line per own line (85 = past EOF; the fixture file ends at line 84). */
const NEXT: ReadonlyMap<number, number> = new Map<number, number>([
  [1, 3], [3, 9], [9, 15], [15, 22], [22, 23], [23, 30], [30, 37], [37, 44], [44, 52], [52, 59], [59, 65], [65, 72], [72, 79], [79, 85],
]);

/**
 * The `default` Description_Normalization_Profile equivalence class (Requirement 15.4):
 * trailing whitespace, leading/trailing blank lines, consecutive blank-line runs and
 * line-ending style are insignificant.
 */
function normalize(text: string): string {
  const trimmed = text.split("\n").map((line) => line.replace(/\r$/, "").trimEnd());
  const collapsed: string[] = [];
  for (const line of trimmed) {
    if (line === "" && collapsed.at(-1) === "") continue; // blank-line runs collapse
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[0] === "") collapsed.shift();
  while (collapsed.length > 0 && collapsed.at(-1) === "") collapsed.pop();
  return collapsed.join("\n");
}

/** The fixture region below `ownLine` up to the next task line (exclusive) — the expected description. */
function expectedRegion(lines: readonly string[], ownLine: number): string {
  const next = NEXT.get(ownLine) as number;
  return normalize(lines.slice(ownLine, next - 1).join("\n")); // lines ownLine+1 .. next-1
}

test("engine kiro-plan world: every created description equals its own task region (T013, C4, SC-002)", async () => {
  const w = await buildWorld("kiro-plan-basic");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));

    const fixtureLines = readFixture("parsing/kiro-plan/tasks.md").split("\n");
    const created = createInputs(w);
    assert.equal(created.length, 14);

    for (const input of created) {
      const ownLine = TITLE_TO_LINE.get(input.title);
      assert.ok(ownLine !== undefined, `fixture line for created title '${input.title}'`);
      assert.equal(
        normalize(input.description),
        expectedRegion(fixtureLines, ownLine),
        `description of '${input.title}' must equal its own region modulo the default profile`,
      );
      // SC-002 side pins: at most ONE `_Requirements:` annotation per description (two would
      // mean it spans more than one task's region) and never the whole file.
      assert.ok(
        (input.description.match(/_Requirements:/gu) ?? []).length <= 1,
        `description of '${input.title}' spans more than one task region (multiple _Requirements_ notes)`,
      );
      assert.ok(
        !input.description.includes("Set up project structure") || input.title === "Set up project structure and dependencies",
        "task 1's title text appears in no other description",
      );
    }

    // The body-less `4.` task and the preamble-less title heading: EMPTY descriptions.
    for (const title of ["Implement EC2 service module", "Implementation Plan"]) {
      const input = created.find((c) => c.title === title);
      assert.ok(input);
      assert.equal(input.description, "", `'${title}' has no region below its line — empty description`);
    }
  } finally {
    await w.dispose();
  }
});

// ──────────────────────── T015 [US3] — idempotency, checkbox-toggle precision, rollback ────────────────────────

/** Raw byte walk of the temp repo (engine-properties precedent). */
function walkFiles(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) Object.assign(out, walkFiles(join(dir, dirent.name), rel));
    else out[rel] = readFileSync(join(dir, dirent.name)).toString("base64");
  }
  return out;
}

test("engine kiro-plan world: re-plan immediately after apply is a zero-action fixpoint (T015a, SC-003, FR-007)", async () => {
  const w = await buildWorld("kiro-plan-basic");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));

    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan2.entries.length, 14, "the same fourteen tasks re-plan");
    assert.deepEqual(
      plan2.entries.filter((e) => e.decision !== "no-change"),
      [],
      "zero pending actions on unchanged input (SC-003)",
    );
  } finally {
    await w.dispose();
  }
});

test("engine kiro-plan world: flipping one checkbox updates exactly that task's issue (T015b, US3 AC2)", async () => {
  const w = await buildWorld("kiro-plan-basic");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));

    // Task 9's identity (unchanged by the toggle — checkbox state is no seed input, V4) and issue.
    const parsed = parseTaskFile(".kiro/specs/auth/tasks.md", readFixture("parsing/kiro-plan/tasks.md"), kiroFixtureAdapter, makeTestConfig());
    const task9 = parsed.file.tasks.find((t) => t.lineNumber === 72);
    assert.ok(task9);
    const issue9 = [...w.fake.world.issues.values()].find((i) => i.title === "Add comprehensive error handling tests");
    assert.ok(issue9);

    // Flip ONLY the state byte on task 9's line in the temp repo (written-back issue refs kept):
    // checked → unchecked moves its issue to the backlog-type state and nothing else.
    const repoFile = join(w.repositoryRoot, ".kiro/specs/auth/tasks.md");
    const before = readFileSync(repoFile, "utf8");
    writeFileSync(repoFile, before.replace("- [x] 9.", "- [ ] 9."), "utf8");

    const mark = w.calls.length;
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const actions = plan2.entries.filter((e) => e.decision !== "no-change");
    assert.equal(actions.length, 1, "exactly one planned action");
    const action = actions[0];
    assert.ok(action);
    assert.equal(action.decision, "update");
    assert.equal(action.taskUuid, task9.stableUuid, "the action is task 9 — the toggled task");
    assert.ok(action.reasons.includes("checkbox-changed"), `reasons must include checkbox-changed, got ${JSON.stringify(action.reasons)}`);

    await engine2.applySyncPlan(plan2, gates(w, plan2.lowConfidencePresent));
    const updates = callsSince(w, mark).filter((c) => c.method === "updateIssue");
    assert.equal(updates.length, 1, "exactly one issue updated");
    assert.deepEqual(updates[0]?.args, [issue9.id, { stateTypeId: "ac000000-0000-4000-8000-000000000201" }], "the update moves task 9's issue to Backlog (unchecked)");
    assert.equal(callsSince(w, mark).filter((c) => c.method === "createIssue").length, 0, "no duplicates created");
    assert.equal(callsSince(w, mark).filter((c) => c.method === "archiveIssue").length, 0, "nothing archived");
    assert.equal(w.fake.world.issues.size, 14, "still fourteen issues — no orphans, no duplicates");
  } finally {
    await w.dispose();
  }
});

test("engine kiro-plan world: rollbackRun restores the repo file bytes (T015c, world README convention)", async () => {
  const w = await buildWorld("kiro-plan-basic");
  try {
    const preRun = walkFiles(w.repositoryRoot);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const applied = await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));

    assert.notDeepEqual(walkFiles(w.repositoryRoot), preRun, "apply wrote the [SYNC-N] issue refs back into tasks.md");

    const rollback = await engine.rollbackRun(applied.runId);
    assert.equal(rollback.status, "rolled-back");
    assert.ok(rollback.reversedOperations > 0, "journaled operations reversed");
    assert.deepEqual(walkFiles(w.repositoryRoot), preRun, "every repo file byte-equal to the pre-run walk");
    assert.equal(w.fake.world.issues.size, 14, "created issues are never deleted…");
    assert.ok([...w.fake.world.issues.values()].every((i) => i.archived === true), "…they are archived by the rollback");
  } finally {
    await w.dispose();
  }
});
