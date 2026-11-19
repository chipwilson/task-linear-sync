/**
 * T027 [P] [US1] — Flat-board depth-folding integration test (feature 020; US1 AC1/AC3;
 * SC-002 at the plan/port boundary; contracts/depth-folding.md rules C1/C3/C5; Maintainer
 * Ruling 2026-11-18 default 1 — the world pins `maxTaskIssueDepth: 1` explicitly even
 * though it equals the built-in default, per tasks.md T027).
 *
 * World `depth-folding-flat` (single generic task file `specs/flat-demo/tasks.md`):
 *  - task 1.1 (depth 1) carries a two-level nested checklist subtree — 1.1.1 at depth 2,
 *    1.1.1.1 at depth 3 (lines 6/9), each with an indented body line;
 *  - task 1.2 (depth 1) is a flat control with no children;
 *  - heading task 9.0 (grammar-matching, depth 1, never folds) has checklist line 9.1
 *    ORPHANED directly under it — depth 2 (line 17).
 * At cap 1 the three nested lines are NOT tasks: each earns exactly one
 * `depth-folded` checklist exclusion and its verbatim (indented) text survives only
 * inside the nearest surviving ancestor's Task_Body, which the engine mirrors into the
 * created issue description (folded subtree stays in source order).
 *
 * Cells (measurements pinned from `parseTaskFile` under the world's own resolved config):
 *  1. PLAN boundary: the plan has exactly three `create` entries (1.1, 1.2, 9.0); NO plan
 *     entry carries a parent link (the frozen `PlanTaskEntry` shape has no parent field —
 *     parent links exist on `Task.parentUuid` and materialize as `CreateIssueInput.parentId`
 *     at apply time, so "zero parented" is asserted at both surfaces: the parsed task tree
 *     like `parsing-corpus`, and a deep key-scan of the persisted `plans/<planId>.json`);
 *     the report exposes exactly those three entries and ZERO entries for the folded lines
 *     (their would-be uuids measured by parsing the same bytes at the explicit-64 escape
 *     hatch); the parse-level AC3 evidence: exactly three `depth-folded` exclusions on
 *     lines 6/9/17 with verbatim indented text.
 *  2. PORT boundary (gated apply): exactly three `createIssue` calls reach the fake
 *     `Linear_Port`, ALL carrying NO `parentId` (asserted against `world.calls.args` live
 *     references — harness constraint 4); the create descriptions carry every folded line
 *     verbatim INCLUDING its source indentation (1.1's description holds both nested lines
 *     + body lines in source order; 9.0's holds the orphan line; 1.2's stays clean); the
 *     mirrored region never carries the heading; and after apply the folded FILE lines are
 *     byte-unchanged and carry no issue-ref token (AC3 — only surviving task lines get refs).
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` world via the shared harness, temp
 * state directory, injected `FakeClock`, placeholder identities only (Principle III).
 * Titles prefixed `depth-folding-flat —`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plan, StoredPlan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import { builtInAdapters } from "task-linear-sync/discovery";
import type { ExclusionRecord, TaskFileAdapter } from "task-linear-sync/parsing";
import { parseTaskFile } from "task-linear-sync/parsing";
import { loadConfig } from "task-linear-sync/config";
import type { CreateIssueInput } from "task-linear-sync/ports";

import {
  attachEngine,
  buildWorld,
  callsOf,
  type EngineWorld,
  type PortCallRecord,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────────────────── constants

/** The guarded task file, repo-relative POSIX (the plan/parse identity form). */
const TASKS_POSIX = "specs/flat-demo/tasks.md";

/** Verbatim folded checklist lines (source indentation included — SC-002). */
const BETA_LINE = "  - [ ] 1.1.1: Beta detail task (depth 2, folded at cap 1)";
const BETA_BODY = "    Beta body line — a folded subtree travels with its nearest surviving ancestor.";
const GAMMA_LINE = "    - [ ] 1.1.1.1: Gamma detail task (depth 3, folded at cap 1)";
const GAMMA_BODY = "      Gamma body line — folded lines keep their source order inside the mirrored description.";
const ORPHAN_LINE = "- [ ] 9.1: Orphaned checklist line (depth 2 under the heading, folded at cap 1)";

/** The surviving task titles (005 derived title == raw title for untagged generic tasks). */
const ALPHA_TITLE = "Alpha flat root task";
const ZETA_TITLE = "Zeta flat root task";
const HEADING_TITLE = "Heading task with an orphaned checklist";

/** 1-based source lines of the three `depth-folded` exclusions (measured at cap 1). */
const FOLDED_LINES: Readonly<Record<number, string>> = { 6: BETA_LINE, 9: GAMMA_LINE, 17: ORPHAN_LINE };

/** Local ids of the folded lines (their uuids exist at the 64 escape hatch, never in this plan). */
const FOLDED_LOCAL_IDS = ["1.1.1", "1.1.1.1", "9.1"];

// ──────────────────────────────────────────────────────────────────────── helpers

/** The frozen `GateRequest` satisfying every gate (pattern of `engine-bootstrap`). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

const createInput = (record: PortCallRecord): CreateIssueInput => record.args[0] as CreateIssueInput;

/** Parse the world's task file under the world's own resolved config (cap 1). */
function parseAtWorldConfig(world: EngineWorld): ReturnType<typeof parseTaskFile> {
  return parseTaskFile(
    TASKS_POSIX,
    readFileSync(join(world.repositoryRoot, "specs", "flat-demo", "tasks.md"), "utf8"),
    builtInAdapters.generic as TaskFileAdapter,
    world.config,
  );
}

/**
 * The folded lines' WOULD-BE task uuids: the same bytes parsed at the explicit-64 escape
 * hatch. Only the three over-cap ids are taken — surviving uuids may legitimately differ
 * across caps (ordinal is part of the stable seed), folded uuids must simply NEVER appear.
 */
function foldedUuidsAtCap64(world: EngineWorld): Map<string, string> {
  const config = loadConfig({ overrides: { maxTaskIssueDepth: 64 } });
  const parsed = parseTaskFile(
    TASKS_POSIX,
    readFileSync(join(world.repositoryRoot, "specs", "flat-demo", "tasks.md"), "utf8"),
    builtInAdapters.generic as TaskFileAdapter,
    config,
  );
  const out = new Map<string, string>();
  for (const task of parsed.file.tasks) {
    if (task.localTaskId !== undefined && FOLDED_LOCAL_IDS.includes(task.localTaskId)) {
      out.set(task.localTaskId, task.stableUuid);
    }
  }
  assert.equal(out.size, FOLDED_LOCAL_IDS.length, "the 64-cap parse exposes all three folded ids");
  return out;
}

/** Every path in `value` whose object key is in `names` (deep scan of plan-shaped JSON). */
function collectKeyPaths(value: unknown, names: ReadonlySet<string>, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectKeyPaths(v, names, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (names.has(k)) out.push(`${path}.${k}`);
      collectKeyPaths(v, names, `${path}.${k}`, out);
    }
  }
  return out;
}

/** Flattened per-task report entries across the report's project/milestone groups. */
function reportTaskEntries(report: unknown): readonly { taskUuid: string; decision: string }[] {
  const groups = (report as { groups?: { entries?: { taskUuid: string; decision: string }[] }[] }).groups;
  assert.ok(Array.isArray(groups), "report carries a groups array");
  return groups.flatMap((g) => g.entries ?? []);
}

// ───────────────────────────────────────────────────────────── cell 1: plan boundary

test("depth-folding-flat — plan at cap 1: three create entries, zero parented links, zero plan/report entries for folded lines (US1 AC1, SC-002)", async () => {
  const w = await buildWorld("depth-folding-flat");
  try {
    // The world pins the cap explicitly (T027) even though 1 is the built-in default.
    assert.equal(w.config.maxTaskIssueDepth, 1, "world.json config block pins maxTaskIssueDepth: 1");

    // ── parse-level evidence under the WORLD config (AC3 + parent-link surface 1) ──
    const parsed = parseAtWorldConfig(w);
    assert.deepEqual(
      parsed.file.tasks.map((t) => [t.lineNumber, t.kind, t.localTaskId ?? null]),
      [
        [3, "checklist", "1.1"],
        [12, "checklist", "1.2"],
        [15, "heading", "9.0"], // headings are depth 1 — never fold, grammar-matching task
      ],
      "exactly the three surviving tasks; nested lines are NOT tasks",
    );
    for (const task of parsed.file.tasks) {
      assert.equal(task.parentUuid, undefined, `surviving task ${task.localTaskId} carries no parent link`);
      assert.deepEqual(task.childUuids, [], `folded children leave ${task.localTaskId} childless`);
    }
    const foldedRecords = parsed.exclusions.filter((e: ExclusionRecord) => e.reason === "depth-folded");
    assert.deepEqual(
      foldedRecords.map((e) => [e.lineNumber, e.kind, e.text]),
      Object.entries(FOLDED_LINES).map(([line, text]) => [Number(line), "checklist", text]),
      "exactly three depth-folded checklist exclusions, verbatim with source indentation",
    );
    assert.equal(parsed.exclusions.length, foldedRecords.length, "no other exclusions in this world");

    // ── the plan (bootstrap: no checkpoints, no seeded issues ⇒ all creates) ──
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 3, "plan entry count = surviving tasks");
    for (const entry of plan.entries) assert.equal(entry.decision, "create", `entry ${entry.taskUuid} is a create`);
    const surviving = parsed.file.tasks.map((t) => t.stableUuid);
    assert.deepEqual([...plan.entries.map((e) => e.taskUuid)].sort(), [...surviving].sort(), "entries are exactly the surviving tasks");

    // ── parent-link surface 2: NO plan entry carries a parent link. The frozen
    // PlanTaskEntry has no parent field; assert the persisted plan exposes none either
    // (parent links live ONLY on Task.parentUuid / CreateIssueInput.parentId). ──
    assert.deepEqual(collectKeyPaths(plan, new Set(["parentUuid", "parentId"])), [], "in-memory plan exposes no parent link");
    const storedPath = join(w.stateDir, "plans", `${plan.planId}.json`);
    const stored = JSON.parse(readFileSync(storedPath, "utf8")) as StoredPlan;
    assert.deepEqual(
      collectKeyPaths(stored.plan, new Set(["parentUuid", "parentId"])),
      [],
      "plans/<planId>.json carries no parentUuid/parentId on any entry",
    );

    // ── (d) plan + report expose ZERO entries for the folded lines ──
    const foldedUuids = foldedUuidsAtCap64(w);
    for (const [id, uuid] of foldedUuids) {
      assert.ok(!plan.entries.some((e) => e.taskUuid === uuid), `plan exposes no entry for folded ${id} (${uuid})`);
      assert.ok(!surviving.includes(uuid), `folded ${id} uuid is not a surviving task uuid`);
    }

    // ── the stage-7 report: same three entries, folded uuids absent ──
    const reportsDir = join(w.stateDir, "reports");
    const runDirs = readdirSync(reportsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(runDirs.length, 1, `exactly one report run dir, found: ${runDirs.join(", ")}`);
    const report = JSON.parse(readFileSync(join(reportsDir, runDirs[0]!, "report.json"), "utf8")) as unknown;
    assert.equal((report as { planId: string }).planId, plan.planId, "report names the plan it reports");
    const entries = reportTaskEntries(report);
    assert.equal(entries.length, 3, "report exposes exactly the three surviving tasks");
    assert.deepEqual([...entries.map((e) => e.taskUuid)].sort(), [...surviving].sort(), "report entries are exactly the surviving tasks");
    for (const [id, uuid] of foldedUuids) {
      assert.ok(!entries.some((e) => e.taskUuid === uuid), `report exposes no entry for folded ${id} (${uuid})`);
    }
    assert.deepEqual(collectKeyPaths(report, new Set(["parentUuid", "parentId"])), [], "report exposes no parent link");
  } finally {
    await w.dispose();
  }
});

// ─────────────────────────────────────────────────────────── cell 2: port boundary

test("depth-folding-flat — gated apply: every createIssue carries no parentId and the folded lines reach the fake Linear_Port verbatim inside the surviving ancestors' descriptions (US1 AC1/AC3, SC-002)", async () => {
  const w = await buildWorld("depth-folding-flat");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "gates are satisfied ⇒ no refusals");
    assert.equal(result.status, "applied", `apply completes (got ${result.status})`);

    // ── (b) three creates, ALL parentless — asserted against live `world.calls.args`
    // references (harness constraint 4: assert, never mutate) ──
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 3, "exactly the three surviving tasks reach the fake port");
    assert.ok(creates.every((c) => c.ok), "no create fails in this world");
    for (const c of creates) {
      assert.equal(createInput(c).parentId, undefined, `create '${createInput(c).title}' carries NO parentId (flat board)`);
    }
    assert.deepEqual(
      creates.map((c) => createInput(c).title).sort(),
      [ALPHA_TITLE, HEADING_TITLE, ZETA_TITLE].sort(),
      "the three surviving titles reach the create inputs",
    );

    const createWith = (marker: string): CreateIssueInput => {
      const hits = creates.filter((c) => createInput(c).description.includes(marker));
      assert.equal(hits.length, 1, `exactly one create description carries "${marker}"`);
      return createInput(hits[0]!);
    };

    // ── (c) SC-002: every folded line verbatim (indentation included) inside the
    // nearest surviving ancestor's mirrored description ──
    const alpha = createWith("Alpha root body");
    assert.equal(alpha.parentId, undefined, "the 1.1 create is parentless");
    for (const line of [BETA_LINE, BETA_BODY, GAMMA_LINE, GAMMA_BODY]) {
      assert.ok(alpha.description.includes(line), `1.1's description carries '${line}' verbatim, source indentation included`);
    }
    assert.ok(
      alpha.description.indexOf(BETA_LINE) < alpha.description.indexOf(GAMMA_LINE),
      "the folded subtree keeps source order (depth-2 line before its depth-3 child)",
    );
    assert.ok(!alpha.description.includes(ORPHAN_LINE), "the heading's orphan never leaks into 1.1's description");
    assert.ok(!alpha.description.includes("Phase 1"), "the mirrored region never carries the heading");

    const heading = createWith(ORPHAN_LINE);
    assert.equal(heading.title, HEADING_TITLE, "the orphan rides in its nearest surviving ancestor — heading task 9.0");
    assert.equal(heading.parentId, undefined, "the 9.0 create is parentless despite the orphaned depth-2 checklist");
    assert.ok(heading.description.includes(ORPHAN_LINE), "9.0's description carries the orphan line verbatim");

    const zeta = createWith("Zeta root body");
    assert.equal(zeta.parentId, undefined, "the 1.2 create is parentless");
    assert.ok(!zeta.description.includes("1.1.1"), "the flat control's description stays clean");

    // ── AC3: the folded FILE lines are never rewritten with an issue-ref token, while
    // the surviving task lines do carry their created refs (proves apply ran) ──
    const tasksPath = join(w.repositoryRoot, "specs", "flat-demo", "tasks.md");
    const after = readFileSync(tasksPath, "utf8").split("\n");
    for (const [line, text] of Object.entries(FOLDED_LINES)) {
      const observed = after[Number(line) - 1];
      assert.equal(observed, text, `folded source line ${line} is byte-unchanged after apply`);
      assert.ok(!/\[ACME-\d+\]/.test(observed ?? ""), `folded line ${line} never receives an issue-ref token`);
    }
    assert.match(after[2] ?? "", /1\.1: \[ACME-\d+\]/, "the surviving 1.1 task line DID get its issue ref (apply really ran)");
  } finally {
    await w.dispose();
  }
});
