/**
 * T028 [P] [US2] — Two-level depth-folding integration test (feature 020; US2 AC1/AC2;
 * contracts/depth-folding.md rules C1/C3/C5/C8; the world pins `maxTaskIssueDepth: 2`).
 *
 * World `depth-folding-two-level` (single generic task file `specs/two-level-demo/tasks.md`):
 *  - task 1.1 (depth 1, line 3) carries sub-task 1.1.1 (depth 2, line 6), which itself
 *    carries detail line 1.1.1.1 (depth 3, line 9) with its own child 1.1.1.1.1 (depth 4,
 *    line 12) — a fully folded subtree, each over-cap line with an indented body line;
 *  - task 1.2 (depth 1, line 15) is a flat control with no children.
 * At cap 2 the two over-cap lines are NOT tasks: each earns exactly one `depth-folded`
 * checklist exclusion, and the WHOLE folded subtree (both lines plus body lines, source
 * indentation included) rides verbatim, in source order, inside the nearest surviving
 * ancestor's Task_Body — the depth-2 task 1.1.1 — which the engine mirrors into that
 * created issue's description (US2 AC2).
 *
 * Cells (measurements pinned from `parseTaskFile` under the world's own resolved config):
 *  1. PLAN boundary: the plan has exactly three `create` entries (1.1, 1.1.1, 1.2); the
 *     parsed tree shows the depth-2 parent link (Task.parentUuid → 1.1) with folded
 *     children absent from every child link map; the frozen `PlanTaskEntry` shape carries
 *     NO parent field, so the in-memory and persisted plan JSON expose no parentUuid/
 *     parentId key anywhere (parent links materialize ONLY as `CreateIssueInput.parentId`
 *     at apply time); ZERO plan/report entries for the folded lines (their uuids measured
 *     by parsing the same bytes at the explicit-64 escape hatch); exactly two
 *     `depth-folded` exclusions on lines 9/12 with verbatim indented text.
 *  2. PORT boundary (gated apply): exactly three `createIssue` calls reach the fake
 *     `Linear_Port` — asserted against `world.calls.args` live references (harness
 *     constraint 4). The depth-2 create carries `parentId` = the freshly created 1.1
 *     issue id, and the parent create PRECEDES the child create in the call log
 *     (parent-before-child); zero `updateIssue`/`archiveIssue` calls and zero identity
 *     attachment URLs target the folded uuids; the depth-2 create's description carries
 *     the depth-3 and depth-4 lines AND their body lines verbatim (source indentation
 *     included) in strict source order (AC2); and after apply the folded FILE lines are
 *     byte-unchanged with no issue-ref token while both surviving task lines got theirs.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` world via the shared harness, temp
 * state directory, injected `FakeClock`, placeholder identities only (Principle III).
 * Titles prefixed `depth-folding-two-level —`.
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
const TASKS_POSIX = "specs/two-level-demo/tasks.md";

/** Verbatim folded lines + body lines (source indentation included — US2 AC2). */
const DEPTH3_LINE = "    - [ ] 1.1.1.1: Iota detail line (depth 3, folded at cap 2)";
const DEPTH3_BODY = "      Iota body line — carries the unique placeholder phrase for the two-level fold.";
const DEPTH4_LINE = "      - [ ] 1.1.1.1.1: Kappa detail child (depth 4, fully folded subtree)";
const DEPTH4_BODY = "        Kappa body line — a fully folded subtree travels whole and in source order.";

/** The surviving task titles (005 derived title == raw title for untagged generic tasks). */
const DELTA_TITLE = "Delta epic task";
const THETA_TITLE = "Theta sub-task (depth 2, survives at cap 2)";
const OMEGA_TITLE = "Omega epic task (depth 1, flat control)";

/** Titles the folded lines WOULD have as issues — no create may carry them (C8). */
const FOLDED_TITLES = [
  "Iota detail line (depth 3, folded at cap 2)",
  "Kappa detail child (depth 4, fully folded subtree)",
];

/** 1-based source lines of the two `depth-folded` exclusions (measured at cap 2). */
const FOLDED_LINES: Readonly<Record<number, string>> = { 9: DEPTH3_LINE, 12: DEPTH4_LINE };

/** Local ids of the folded lines (their uuids exist at the 64 escape hatch, never in this plan). */
const FOLDED_LOCAL_IDS = ["1.1.1.1", "1.1.1.1.1"];

// ──────────────────────────────────────────────────────────────────────── helpers

/** The guarded `GateRequest` satisfying every gate (pattern of `engine-bootstrap`). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

const createInput = (record: PortCallRecord): CreateIssueInput => record.args[0] as CreateIssueInput;

/** Parse the world's task file under the world's own resolved config (cap 2). */
function parseAtWorldConfig(world: EngineWorld): ReturnType<typeof parseTaskFile> {
  return parseTaskFile(
    TASKS_POSIX,
    readFileSync(join(world.repositoryRoot, "specs", "two-level-demo", "tasks.md"), "utf8"),
    builtInAdapters.generic as TaskFileAdapter,
    world.config,
  );
}

/**
 * The folded lines' WOULD-BE task uuids: the same bytes parsed at the explicit-64 escape
 * hatch. Folded uuids must simply NEVER appear in this world's plan/report/port surface.
 */
function foldedUuidsAtCap64(world: EngineWorld): Map<string, string> {
  const config = loadConfig({ overrides: { maxTaskIssueDepth: 64 } });
  const parsed = parseTaskFile(
    TASKS_POSIX,
    readFileSync(join(world.repositoryRoot, "specs", "two-level-demo", "tasks.md"), "utf8"),
    builtInAdapters.generic as TaskFileAdapter,
    config,
  );
  const out = new Map<string, string>();
  for (const task of parsed.file.tasks) {
    if (task.localTaskId !== undefined && FOLDED_LOCAL_IDS.includes(task.localTaskId)) {
      out.set(task.localTaskId, task.stableUuid);
    }
  }
  assert.equal(out.size, FOLDED_LOCAL_IDS.length, "the 64-cap parse exposes both folded ids");
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

/** The created issue in the seeded fake whose title matches (created ids are never re-keyed). */
function createdIssueByTitle(world: EngineWorld, title: string): { id: string; key: string } {
  const hits = [...world.fake.world.issues.values()].filter((issue) => issue.title === title);
  assert.equal(hits.length, 1, `exactly one tracker issue titled '${title}'`);
  return { id: hits[0]!.id, key: hits[0]!.key };
}

// ───────────────────────────────────────────────────────────────────── cell 1: plan boundary

test("depth-folding-two-level — plan at cap 2: three creates, depth-2 parent link on the task tree, zero plan/report entries for the folded subtree (US2 AC1)", async () => {
  const w = await buildWorld("depth-folding-two-level");
  try {
    // The world pins the two-level cap explicitly (T028).
    assert.equal(w.config.maxTaskIssueDepth, 2, "world.json config block pins maxTaskIssueDepth: 2");

    // ── parse-level evidence under the WORLD config ──
    const parsed = parseAtWorldConfig(w);
    assert.deepEqual(
      parsed.file.tasks.map((t) => [t.lineNumber, t.kind, t.localTaskId ?? null]),
      [
        [3, "checklist", "1.1"],
        [6, "checklist", "1.1.1"],
        [15, "checklist", "1.2"],
      ],
      "exactly the three surviving tasks; depth-3/4 lines are NOT tasks",
    );
    const byId = new Map(parsed.file.tasks.map((t) => [t.localTaskId ?? "?", t]));
    const delta = byId.get("1.1")!;
    const theta = byId.get("1.1.1")!;
    const omega = byId.get("1.2")!;
    // Parent link surface (Task.parentUuid): the depth-2 task points at its depth-1 parent.
    assert.equal(theta.parentUuid, delta.stableUuid, "1.1.1 carries its depth-1 parent link");
    assert.equal(delta.parentUuid, undefined, "the depth-1 epic has no parent");
    assert.equal(omega.parentUuid, undefined, "the flat control has no parent");
    // Folded children leave NO trace in the child link maps (C3/C8).
    assert.deepEqual(delta.childUuids, [theta.stableUuid], "1.1's only task child is 1.1.1 — folded grandchildren are absent");
    assert.deepEqual(theta.childUuids, [], "the folded depth-3 child never becomes a task child of 1.1.1");
    assert.deepEqual(omega.childUuids, [], "the flat control stays childless");
    const foldedRecords = parsed.exclusions.filter((e: ExclusionRecord) => e.reason === "depth-folded");
    assert.deepEqual(
      foldedRecords.map((e) => [e.lineNumber, e.kind, e.text]),
      Object.entries(FOLDED_LINES).map(([line, text]) => [Number(line), "checklist", text]),
      "exactly two depth-folded checklist exclusions, verbatim with source indentation",
    );
    assert.equal(parsed.exclusions.length, foldedRecords.length, "no other exclusions in this world");

    // ── the plan (bootstrap: no checkpoints, no seeded issues ⇒ all creates) ──
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 3, "plan entry count = surviving tasks");
    for (const entry of plan.entries) assert.equal(entry.decision, "create", `entry ${entry.taskUuid} is a create`);
    const surviving = parsed.file.tasks.map((t) => t.stableUuid);
    assert.deepEqual([...plan.entries.map((e) => e.taskUuid)].sort(), [...surviving].sort(), "entries are exactly the surviving tasks");

    // ── parent links live ONLY on Task.parentUuid / CreateIssueInput.parentId: the frozen
    // PlanTaskEntry shape has no parent field, so the plan JSON (memory + persisted)
    // exposes none anywhere. ──
    assert.deepEqual(collectKeyPaths(plan, new Set(["parentUuid", "parentId"])), [], "in-memory plan exposes no parent link");
    const storedPath = join(w.stateDir, "plans", `${plan.planId}.json`);
    const stored = JSON.parse(readFileSync(storedPath, "utf8")) as StoredPlan;
    assert.deepEqual(
      collectKeyPaths(stored.plan, new Set(["parentUuid", "parentId"])),
      [],
      "plans/<planId>.json carries no parentUuid/parentId on any entry",
    );

    // ── plan + report expose ZERO entries for the folded subtree ──
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

test("depth-folding-two-level — gated apply: parent-before-child creates with the depth-2 parentId link, zero port materialization for the folded subtree, and its verbatim source-order ride in the depth-2 description (US2 AC1/AC2)", async () => {
  const w = await buildWorld("depth-folding-two-level");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "gates are satisfied ⇒ no refusals");
    assert.equal(result.status, "applied", `apply completes (got ${result.status})`);

    // ── three creates, asserted against live `world.calls.args` references (harness
    // constraint 4: assert, never mutate) ──
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 3, "exactly the three surviving tasks reach the fake port");
    assert.ok(creates.every((c) => c.ok), "no create fails in this world");
    assert.deepEqual(
      creates.map((c) => createInput(c).title).sort(),
      [DELTA_TITLE, THETA_TITLE, OMEGA_TITLE].sort(),
      "the three surviving titles reach the create inputs",
    );

    const createByTitle = (title: string): { record: PortCallRecord; input: CreateIssueInput } => {
      const hits = creates.filter((c) => createInput(c).title === title);
      assert.equal(hits.length, 1, `exactly one create titled '${title}'`);
      return { record: hits[0]!, input: createInput(hits[0]!) };
    };
    const delta = createByTitle(DELTA_TITLE);
    const theta = createByTitle(THETA_TITLE);
    const omega = createByTitle(OMEGA_TITLE);

    // ── US2 AC1: the depth-2 create carries its depth-1 parent link, materialized to the
    // freshly created 1.1 issue id, and the parent create PRECEDES the child create ──
    const parentIssue = createdIssueByTitle(w, DELTA_TITLE);
    assert.equal(delta.input.parentId, undefined, "the depth-1 create is parentless");
    assert.equal(omega.input.parentId, undefined, "the flat control create is parentless");
    assert.equal(theta.input.parentId, parentIssue.id, "the depth-2 create links to the created 1.1 issue");
    assert.ok(
      delta.record.seq < theta.record.seq,
      `parent-before-child create order (1.1 at seq ${delta.record.seq} < 1.1.1 at seq ${theta.record.seq})`,
    );

    // ── zero port materialization for the folded lines (C8): nothing ever targets their
    // would-be uuids or titles ──
    assert.equal(callsOf(w, "updateIssue").length, 0, "no updateIssue call exists at all");
    assert.equal(callsOf(w, "archiveIssue").length, 0, "no archiveIssue call exists at all");
    for (const title of FOLDED_TITLES) {
      assert.ok(!creates.some((c) => createInput(c).title === title), `no create is titled '${title}'`);
    }
    const foldedUuids = foldedUuidsAtCap64(w);
    for (const [id, uuid] of foldedUuids) {
      for (const call of w.calls) {
        if (call.method === "upsertAttachmentByUrl") {
          const url = (call.args[0] as { url: string }).url;
          assert.ok(!url.includes(uuid), `folded ${id} uuid never appears in an identity attachment URL (${url})`);
        }
      }
    }

    // ── US2 AC2: the whole folded subtree rides verbatim (source indentation included),
    // in strict source order, in the depth-2 parent's mirrored description ──
    const thetaDescription = theta.input.description;
    assert.ok(thetaDescription.includes("Theta body line"), "the depth-2 issue mirrors its own body");
    for (const line of [DEPTH3_LINE, DEPTH3_BODY, DEPTH4_LINE, DEPTH4_BODY]) {
      assert.ok(
        thetaDescription.includes(line),
        `1.1.1's description carries '${line}' verbatim, source indentation included`,
      );
    }
    const order = [DEPTH3_LINE, DEPTH3_BODY, DEPTH4_LINE, DEPTH4_BODY].map((line) => thetaDescription.indexOf(line));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      `the fully folded subtree keeps strict source order (depth-3 line, its body, depth-4 child, its body): ${order.join(", ")}`,
    );
    assert.ok(!thetaDescription.includes("Phase 1"), "the mirrored region never carries the heading");
    assert.ok(!thetaDescription.includes("Omega epic body"), "the sibling control never leaks into 1.1.1's description");

    // The depth-1 epic's mirrored body spans its whole descendant subtree, so the folded
    // subtree is verbatim there too — still in source order, still without the control.
    for (const line of [DEPTH3_LINE, DEPTH4_LINE]) {
      assert.ok(delta.input.description.includes(line), `1.1's description also spans '${line}' verbatim`);
    }
    assert.ok(
      delta.input.description.indexOf(DEPTH3_LINE) < delta.input.description.indexOf(DEPTH4_LINE),
      "source order holds inside the depth-1 description too",
    );
    assert.ok(!delta.input.description.includes("Omega epic body"), "the control stays out of 1.1's description");
    assert.ok(!omega.input.description.includes("Iota"), "the flat control's description stays clean");

    // ── AC3/C8: the folded FILE lines are never rewritten with an issue-ref token, while
    // BOTH surviving parented task lines carry their created refs (proves apply ran) ──
    const tasksPath = join(w.repositoryRoot, "specs", "two-level-demo", "tasks.md");
    const after = readFileSync(tasksPath, "utf8").split("\n");
    for (const [line, text] of Object.entries(FOLDED_LINES)) {
      const observed = after[Number(line) - 1];
      assert.equal(observed, text, `folded source line ${line} is byte-unchanged after apply`);
      assert.ok(!/\[ACME-\d+\]/.test(observed ?? ""), `folded line ${line} never receives an issue-ref token`);
    }
    assert.match(after[2] ?? "", /- \[ \] 1\.1: \[ACME-\d+\]/, "the surviving 1.1 task line DID get its issue ref (apply really ran)");
    assert.match(after[5] ?? "", /- \[ \] 1\.1\.1: \[ACME-\d+\]/, "the surviving depth-2 task line DID get its issue ref");
  } finally {
    await w.dispose();
  }
});
