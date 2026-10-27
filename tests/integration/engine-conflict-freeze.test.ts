/**
 * T019 [P] [US1] — Conflict-freeze integration test (`unresolved-block` world; US1 AC4,
 * FR-007, SC-004 property; conflict-resolution-matrix.md §4 normative; research R4;
 * quickstart 1.4).
 *
 * A task section already carrying a git-style conflict block (004 `scanConflictBlocks` ⇒
 * `Task.unresolvedConflict`) is FROZEN on every later run that touches it:
 * - plan decision `skip-unresolved` (frozen `PlanDecision` vocabulary, src/domain/plan.ts),
 *   exactly ONE unresolved-conflict report entry for that task per run;
 * - checkpoint UNTOUCHED (baseline preserved byte-wise — post-resolution classification
 *   must compare against the pre-block state);
 * - NO planned file mutation and NO planned issue mutation (plan-side: no update/change
 *   targets it; port-side: `buildSyncPlan` is read-only, so zero mutating port calls);
 * - SC-004 property: the block survives N arbitrary intervening runs byte-for-byte
 *   (N = 3 fresh engine instances over the same world; file AND marker-region bytes hashed
 *   before/after each run; unresolved entry exactly once per run);
 * - a human removing the markers returns the task to NORMAL classification against the
 *   stored checkpoint — asserted against the world's stated post-removal golden
 *   (`expected/plan.json` `postResolutionExpectation`).
 *
 * Nested-marker REFUSAL on write (a second `overwrite-spec` attempt refused outright) is
 * T032's apply-side job — this file only adds the cheap plan-boundary companion: no
 * marker-writing content and no change summaries are planned for the frozen task.
 *
 * RED BY DESIGN until T024/T026 land (`buildSyncPlan` throws "not wired until phase 3").
 * Fixture note for the implementation lanes: the seeded checkpoint baseline hash for the
 * frozen task matches NEITHER marker side (the pre-block ancestor is not in the world);
 * the post-removal expectation asserted here is exactly what `expected/plan.json` encodes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import type { Checkpoint, Plan, PlanTaskEntry } from "task-linear-sync/domain";

import { createSyncEngine } from "../../src/engine/create.js";
import type { PlanReportJson, ReportTaskEntry } from "../../src/engine/report.js";
import {
  attachEngine,
  buildWorld,
  callsMark,
  mutationCalls,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

/** Intervening runs for the SC-004 byte-stability property (task text: N = 3). */
const PROPERTY_RUNS = 3;

/** Temp-repo path of the marker-bearing fixture file. */
const TASKS_MD_REL = join("specs", "sync-demo", "tasks.md");

/** Git-style conflict-marker line shapes (research R4 label spellings). */
const MARKER_START = "<<<<<<< ";
const MARKER_SEP = "=======";
const MARKER_END = ">>>>>>> ";

// ─────────────────────────────────────────────────────────── golden (expected/plan.json)

/** Local view of `unresolved-block/expected/plan.json` (the world's normative expectations). */
interface ExpectedPlanGolden {
  readonly world: string;
  readonly entries: readonly {
    readonly taskUuid: string;
    readonly localTaskId: string;
    readonly decision: string;
    readonly descriptionConflict: string | null;
  }[];
  readonly postResolutionExpectation: {
    readonly localTaskId: string;
    readonly action: string;
    readonly then: { readonly descriptionConflict: string | null; readonly decision: string };
  };
  readonly reportNotes: { readonly planEntries: number };
}

/** Golden entry of the frozen task (the one whose decision is `skip-unresolved`). */
function goldenFrozenEntry(golden: ExpectedPlanGolden): ExpectedPlanGolden["entries"][number] {
  const entry = golden.entries.find((e) => e.decision === "skip-unresolved");
  assert.ok(entry, "expected/plan.json must encode exactly one skip-unresolved golden entry");
  return entry;
}

// ─────────────────────────────────────────────────────────────────────── byte utilities

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readTasksMd(world: EngineWorld): Buffer {
  return readFileSync(join(world.repositoryRoot, TASKS_MD_REL));
}

function checkpointBytes(world: EngineWorld): Buffer {
  return readFileSync(join(world.state.root, "sync-state.json"));
}

/** Inclusive conflict-marker region (marker lines + interior) of the tasks.md bytes. */
function markerRegion(bytes: Buffer): Buffer {
  const lines = bytes.toString("utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(MARKER_START));
  const end = lines.findIndex((l) => l.startsWith(MARKER_END));
  assert.ok(start >= 0 && end > start, `no git-style conflict block found in ${TASKS_MD_REL}`);
  return Buffer.from(lines.slice(start, end + 1).join("\n"), "utf8");
}

/**
 * Human marker removal (matrix §4 / world README): the section keeps ONLY the local side —
 * the three marker lines and the tracker side are deleted; every other byte is preserved.
 * Tests mutate their OWN temp-repo copy (harness contract) — the fixture source tree is
 * never written.
 */
function removeMarkersKeepLocalSide(world: EngineWorld): void {
  const lines = readTasksMd(world).toString("utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(MARKER_START));
  const end = lines.findIndex((l) => l.startsWith(MARKER_END));
  const sep = lines.findIndex((l, i) => i > start && i < end && l === MARKER_SEP);
  assert.ok(start >= 0 && sep > start && end > sep, "unresolvable marker-block layout");
  const localSide = lines.slice(start + 1, sep);
  const next = [...lines.slice(0, start), ...localSide, ...lines.slice(end + 1)];
  writeFileSync(join(world.repositoryRoot, TASKS_MD_REL), next.join("\n"), "utf8");
}

// ────────────────────────────────────────────────────────────────────── report artifacts

/**
 * Every persisted `reports/<runId>/report.json` under the state directory whose `planId`
 * matches this run's plan. runId derivation is ops.ts's (T040 stub — never called from a
 * T019 assertion), so the artifacts are DISCOVERED, not address-derived.
 */
async function planReports(world: EngineWorld, planId: string): Promise<PlanReportJson[]> {
  const reportsRoot = join(world.state.root, "reports");
  if (!existsSync(reportsRoot)) return [];
  const found: PlanReportJson[] = [];
  for (const entry of await readdir(reportsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = join(reportsRoot, entry.name, "report.json");
    if (!existsSync(rel)) continue;
    const doc = JSON.parse(readFileSync(rel, "utf8")) as PlanReportJson;
    if (doc.planId === planId) found.push(doc);
  }
  return found;
}

/** Unresolved-conflict report entries — the surfaced set (report.ts, T025 posture). */
function unresolvedReportEntries(report: PlanReportJson): readonly ReportTaskEntry[] {
  return report.groups.flatMap((group) => group.entries).filter((e) => e.unresolvedConflict === true);
}

// ───────────────────────────────────────────────────────────────────────── per-run asserts

function expectEntry(reason: string, plan: Plan, taskUuid: string): PlanTaskEntry {
  const matches = plan.entries.filter((e) => e.taskUuid === taskUuid);
  assert.strictEqual(matches.length, 1, `${reason}: exactly one plan entry for ${taskUuid}`);
  const entry = matches[0];
  assert.ok(entry, `${reason}: plan entry for ${taskUuid} present`);
  return entry;
}

/**
 * One frozen-state plan run: decision `skip-unresolved`, one unresolved plan entry, no
 * plan-side mutation targets, zero mutating port calls, marker bytes + checkpoint store
 * untouched byte-wise (baseline preserved).
 */
function assertFrozenRun(
  world: EngineWorld,
  plan: Plan,
  golden: ExpectedPlanGolden,
  frozenUuid: string,
  callsBefore: number,
  tasksBefore: Buffer,
  markerBefore: Buffer,
  checkpointBefore: Buffer,
): void {
  // (1) Frozen plan decision + exactly one unresolved plan entry for the task.
  const frozen = expectEntry("frozen plan", plan, frozenUuid);
  assert.strictEqual(frozen.decision, "skip-unresolved", "frozen task decision must be skip-unresolved (FR-007)");
  assert.strictEqual(frozen.unresolvedConflict, true, "frozen task entry must carry unresolvedConflict: true");
  const unresolved = plan.entries.filter((e) => e.unresolvedConflict === true);
  assert.strictEqual(unresolved.length, 1, "exactly ONE unresolved-conflict plan entry per run");
  assert.strictEqual(unresolved[0]?.taskUuid, frozenUuid, "the unresolved entry is the frozen task");
  assert.strictEqual(
    plan.entries.length,
    golden.reportNotes.planEntries,
    "the block-interior checklist line must never extract as a task",
  );

  // (3)+(6) Plan-side: NO planned file mutation, NO planned issue mutation for the frozen
  // task; and (plan boundary of T032's write-refusal) no marker-writing content planned.
  assert.deepStrictEqual(frozen.expectedMarkdownChanges, [], "no planned file changes for the frozen task");
  for (const field of ["description", "title", "state"]) {
    assert.ok(!frozen.changedFields.includes(field), `no planned ${field} change targets the frozen task`);
  }
  const plannedText = [...frozen.reasons, ...frozen.expectedMarkdownChanges].join("\n");
  for (const token of [MARKER_START.trim(), MARKER_SEP, MARKER_END.trim()]) {
    assert.ok(!plannedText.includes(token), `no conflict-marker content (${token}) may be planned for the frozen task`);
  }

  // Per golden: the description-conflict machinery NEVER RUNS on any entry of this world
  // (frozen task skipped; controls classify clean) — no conflict-type reason anywhere.
  assert.ok(
    frozen.reasons.some((r) => r.includes("unresolved")),
    `frozen entry must name the unresolved freeze in reasons, got: ${JSON.stringify(frozen.reasons)}`,
  );
  for (const goldenEntry of golden.entries) {
    const entry = expectEntry("golden entry", plan, goldenEntry.taskUuid);
    assert.strictEqual(entry.decision, goldenEntry.decision, `plan decision for ${goldenEntry.localTaskId} per world golden`);
    assert.ok(
      !entry.reasons.some((r) => r.startsWith("description-conflict:")),
      `no description-conflict machinery for ${goldenEntry.localTaskId} (golden descriptionConflict: ${String(goldenEntry.descriptionConflict)})`,
    );
  }

  // Port-side: buildSyncPlan is read-only — zero mutating port calls in this run.
  assert.strictEqual(mutationCalls(world, callsBefore).length, 0, "zero mutating port calls during buildSyncPlan");

  // (2) Checkpoint UNTOUCHED — byte-wise, plus parsed store equality with the seed.
  const checkpointAfter = checkpointBytes(world);
  assert.strictEqual(
    Buffer.compare(checkpointBefore, checkpointAfter),
    0,
    `checkpoint store bytes changed (${sha256(checkpointBefore)} → ${sha256(checkpointAfter)})`,
  );

  // (4) Repo bytes: whole file AND marker region byte-for-byte identical across the run.
  const tasksAfter = readTasksMd(world);
  assert.strictEqual(
    Buffer.compare(tasksBefore, tasksAfter),
    0,
    `repo file bytes changed (${sha256(tasksBefore)} → ${sha256(tasksAfter)})`,
  );
  const markerAfter = markerRegion(tasksAfter);
  assert.strictEqual(
    Buffer.compare(markerBefore, markerAfter),
    0,
    `conflict-marker region bytes changed (${sha256(markerBefore)} → ${sha256(markerAfter)})`,
  );
}

/** (4') Exactly ONE unresolved-conflict entry in every persisted report for this plan. */
async function assertReportOncePerRun(world: EngineWorld, plan: Plan, frozenUuid: string): Promise<void> {
  const reports = await planReports(world, plan.planId);
  assert.ok(reports.length >= 1, `buildSyncPlan must persist reports/<runId>/report.json for plan ${plan.planId} (R13)`);
  for (const report of reports) {
    const entries = unresolvedReportEntries(report);
    assert.strictEqual(entries.length, 1, "exactly ONE unresolved-conflict report entry per run");
    assert.strictEqual(entries[0]?.taskUuid, frozenUuid, "the unresolved report entry names the frozen task");
  }
}

/** Parsed checkpoint store still equals the seeded baseline map (pre-block state authoritative). */
async function assertCheckpointStoreIntact(world: EngineWorld, checkpointSeed: Record<string, Checkpoint>): Promise<void> {
  const store = await readCheckpointStore(world);
  assert.ok(store, "checkpoint store exists");
  assert.deepStrictEqual(store.checkpoints, checkpointSeed, "checkpoint store parses identical to the seeded baseline");
}

// ───────────────────────────────────────────────────────────────────────────────── tests

test("engine-conflict-freeze — unresolved-block world plans skip-unresolved: once-reported, checkpoint untouched, zero mutations (AC4/FR-007)", async () => {
  const w = await buildWorld("unresolved-block");
  try {
    const golden = readExpectedJson<ExpectedPlanGolden>(w, "plan.json");
    const frozenUuid = goldenFrozenEntry(golden).taskUuid;
    const checkpointSeed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, checkpointSeed);

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const tasksBefore = readTasksMd(w);
    const markerBefore = markerRegion(tasksBefore);
    const checkpointBefore = checkpointBytes(w);

    const mark = callsMark(w);
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    assertFrozenRun(w, plan, golden, frozenUuid, mark, tasksBefore, markerBefore, checkpointBefore);
    await assertReportOncePerRun(w, plan, frozenUuid);
    await assertCheckpointStoreIntact(w, checkpointSeed);
  } finally {
    await w.dispose();
  }
});

test("engine-conflict-freeze — SC-004 property: block survives 3 fresh-engine runs byte-for-byte, unresolved entry exactly once per run", async () => {
  const w = await buildWorld("unresolved-block");
  try {
    const golden = readExpectedJson<ExpectedPlanGolden>(w, "plan.json");
    const frozenUuid = goldenFrozenEntry(golden).taskUuid;
    const checkpointSeed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, checkpointSeed);

    const tasksBefore = readTasksMd(w);
    const markerBefore = markerRegion(tasksBefore);
    const checkpointBefore = checkpointBytes(w);
    const fileHashes: string[] = [];
    const regionHashes: string[] = [];
    const planIds: string[] = [];

    for (let run = 1; run <= PROPERTY_RUNS; run += 1) {
      // Fresh engine instance per intervening run over the SAME world — attachEngine is
      // safe to call repeatedly (harness contract).
      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
      const mark = callsMark(w);
      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

      assertFrozenRun(w, plan, golden, frozenUuid, mark, tasksBefore, markerBefore, checkpointBefore);
      await assertReportOncePerRun(w, plan, frozenUuid);
      await assertCheckpointStoreIntact(w, checkpointSeed);

      fileHashes.push(sha256(readTasksMd(w)));
      regionHashes.push(sha256(markerRegion(readTasksMd(w))));
      planIds.push(plan.planId);
    }

    // Byte-for-byte identity across ALL runs: whole file and marker region — plus (under
    // the fixed injected clock, constitution VI determinism) the plan identity itself.
    assert.ok(fileHashes[0] !== undefined && regionHashes[0] !== undefined && planIds[0] !== undefined);
    assert.deepStrictEqual(fileHashes, Array(PROPERTY_RUNS).fill(fileHashes[0]), "tasks.md bytes identical across all runs");
    assert.deepStrictEqual(regionHashes, Array(PROPERTY_RUNS).fill(regionHashes[0]), "marker-region bytes identical across all runs");
    assert.deepStrictEqual(planIds, Array(PROPERTY_RUNS).fill(planIds[0]), "plan identity deterministic across intervening runs");
  } finally {
    await w.dispose();
  }
});

test("engine-conflict-freeze — human removes the markers ⇒ task returns to normal classification against the stored checkpoint (matrix §4)", async () => {
  const w = await buildWorld("unresolved-block");
  try {
    const golden = readExpectedJson<ExpectedPlanGolden>(w, "plan.json");
    const frozen = goldenFrozenEntry(golden);
    const checkpointSeed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, checkpointSeed);
    const checkpointBefore = checkpointBytes(w);

    // Sanity: the run BEFORE removal is the frozen one — that is the freeze being released.
    const pre = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const prePlan = await pre.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.strictEqual(expectEntry("pre-removal", prePlan, frozen.taskUuid).decision, "skip-unresolved");

    // Human resolution: rewrite the section keeping the resolved content = LOCAL side
    // (task text; world README), then the next run classifies normally. NOTE (fixture
    // ambiguity, reported): the seeded baseline hash matches neither side's bytes; the
    // expected decision/conflict-free state asserted below is the world's golden verbatim.
    removeMarkersKeepLocalSide(w);

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const mark = callsMark(w);
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Returned to NORMAL classification: no freeze flag, no skip-unresolved decision,
    // no unresolved entry anywhere — asserted against the world's stated golden.
    const entry = expectEntry("post-removal", plan, frozen.taskUuid);
    const post = golden.postResolutionExpectation;
    assert.notStrictEqual(entry.decision, "skip-unresolved", "post-removal task must no longer be frozen");
    assert.notStrictEqual(entry.unresolvedConflict, true, "post-removal task must not carry unresolvedConflict");
    assert.strictEqual(entry.decision, post.then.decision, `post-removal decision per world golden (${post.action})`);
    assert.ok(
      !entry.reasons.some((r) => r.startsWith("description-conflict:")),
      `post-removal descriptionConflict must be ${String(post.then.descriptionConflict)} per world golden`,
    );
    assert.strictEqual(
      plan.entries.filter((e) => e.unresolvedConflict === true).length,
      0,
      "zero unresolved-conflict plan entries after removal",
    );
    for (const report of await planReports(w, plan.planId)) {
      assert.strictEqual(unresolvedReportEntries(report).length, 0, "zero unresolved-conflict report entries after removal");
    }

    // Still read-only, and classification ran AGAINST the preserved baseline: the
    // checkpoint for that task is byte-identical to the seed through ALL runs.
    assert.strictEqual(mutationCalls(w, mark).length, 0, "post-removal build stays read-only");
    assert.strictEqual(Buffer.compare(checkpointBefore, checkpointBytes(w)), 0, "checkpoint baseline preserved through removal + reclassification");
    const store = await readCheckpointStore(w);
    assert.deepStrictEqual(
      store?.checkpoints[frozen.taskUuid],
      checkpointSeed[frozen.taskUuid],
      "frozen task's baseline checkpoint unchanged (pre-block state authoritative)",
    );
  } finally {
    await w.dispose();
  }
});
