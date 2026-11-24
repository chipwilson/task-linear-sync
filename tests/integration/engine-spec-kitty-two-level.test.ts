/**
 * T011 [P] [US1] — two-level document-board lifecycle over world `spec-kitty-two-level`
 * (feature 023 quickstart scenario 2 / SC-001; contract C0–C5; world cap `maxTaskIssueDepth: 2`).
 *
 * RED-FIRST: the child derivation (`deriveDocumentTasks`), the taskfile wiring, the
 * promoted-span mirror slice, and the built-in `subtaskRule` land in T012–T015; until then
 * the plan holds only the two parents and every two-level assertion fails.
 *
 * Pinned shape (data-model §1–2, decision table):
 *  - plan = 2 document parents + 7 document children, all `create`, zero markdown changes;
 *  - every child `Task.parentUuid` = owning WP task uuid; parent `childUuids` in source
 *    order; child seed third slot `WPnn\0Tnnn` (frozen 3-part `taskStableSeed`, compose-slot
 *    precedent C3.1) — verified against the FROZEN seed/uuid helpers, not a re-derivation;
 *  - apply creates parent-before-child with `CreateIssueInput.parentId` set; child
 *    descriptions are their section text; parent descriptions exclude EVERY promoted span
 *    yet keep the Activity-Log restatement verbatim (C2.3/C2.4, A-023-0);
 *  - roster-only `T099` is recognized-but-excluded (`subtask-no-anchor`), never an issue
 *    (C2.5) — zero empty issues anywhere;
 *  - T016: two in-region anchors of one id refuse plan build through the EXISTING
 *    `DocumentIdentityCollisionError` — deterministic paths, no new error class (C2.6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";
import { builtInAdapters } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult, TaskFileAdapter } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";
import { taskStableSeed } from "task-linear-sync/domain";

import { attachEngine, buildWorld, callsOf, type EngineWorld, type PortCallRecord } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";
import { deriveStableUuid } from "../../src/parsing/identity.js";
import { DocumentIdentityCollisionError } from "../../src/engine/errors.js";

const MISSION = "002-auth-system";
const WP01 = `kitty-specs/${MISSION}/tasks/WP01-setup.md`;
const WP02 = `kitty-specs/${MISSION}/tasks/WP02-oauth.md`;

/** The SHIPPED built-in row is the parse oracle (same cast the engine performs). */
const kittyRow = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;

function gates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

const createInput = (record: PortCallRecord): CreateIssueInput => record.args[0] as CreateIssueInput;

function createdIssueByTitle(world: EngineWorld, title: string): { id: string } {
  const hits = [...world.fake.world.issues.values()].filter((issue) => issue.title === title);
  assert.equal(hits.length, 1, `exactly one tracker issue titled '${title}'`);
  return { id: hits[0]!.id };
}

/** Parse a world repo file exactly as the engine does (built-in row + world config). */
function parseRepoFile(world: EngineWorld, relPath: string): ParseResult {
  const content = readFileSync(join(world.repositoryRoot, relPath), "utf8");
  return parseTaskFile(relPath, content, kittyRow, world.config);
}

function rawLines(world: EngineWorld, relPath: string): string[] {
  return readFileSync(join(world.repositoryRoot, relPath), "utf8").split(/\r\n|\r|\n/);
}

/** Contiguous slice `start..end` (1-based inclusive) — the child mirror region. */
function slice(lines: readonly string[], start: number, end: number): string {
  return lines.slice(start - 1, end).join("\n");
}

/** Hole-slice: `start..end` minus every inclusive promoted span, remaining lines joined. */
function sliceWithout(
  lines: readonly string[],
  start: number,
  end: number,
  holes: readonly (readonly [number, number])[],
): string {
  const kept: string[] = [];
  for (let line = start; line <= end; line += 1) {
    if (!holes.some(([s, e]) => line >= s && line <= e)) kept.push(lines[line - 1] ?? "");
  }
  return kept.join("\n");
}

function byId(parse: ParseResult, localTaskId: string): Task {
  const hit = parse.file.tasks.find((t) => t.localTaskId === localTaskId);
  assert.ok(hit, `task ${localTaskId} derived`);
  return hit;
}

interface ChildPin {
  readonly id: string;
  readonly title: string;
  readonly extent: readonly [number, number];
}

const WP01_CHILDREN: readonly ChildPin[] = [
  { id: "T001", title: "Scaffold the package", extent: [18, 20] },
  { id: "T002", title: "Add the configuration loader", extent: [22, 23] },
  { id: "T003", title: "Wire the storage adapter", extent: [25, 26] },
  { id: "T004", title: "Add start-up checks", extent: [28, 29] },
];
const WP02_CHILDREN: readonly ChildPin[] = [
  { id: "T005", title: "Request-token exchange", extent: [13, 14] },
  { id: "T006", title: "Consent redirect handling", extent: [16, 17] },
  { id: "T007", title: "Access-token refresh", extent: [19, 20] },
];

// ─────────────────────────────────────────────────────────────── plan boundary

test("023 two-level plan: 2 document parents + 7 document children, parented with exact extents (C0/C2)", async () => {
  const w = await buildWorld("spec-kitty-two-level");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    assert.equal(plan.entries.length, 9, "2 parents + 7 promoted children");
    assert.ok(plan.entries.every((e) => e.decision === "create"), "empty tracker — everything creates");
    assert.ok(plan.entries.every((e) => e.frameworkId === "spec-kitty"));
    assert.ok(
      plan.entries.every((e) => e.expectedMarkdownChanges.length === 0),
      "neither level writes back (022 C6 extended by C5)",
    );

    // ── task-tree boundary: parse the same bytes the engine parsed ──────────────────
    for (const [rel, wpId, extent, children] of [
      [WP01, "WP01", [12, 36], WP01_CHILDREN],
      [WP02, "WP02", [8, 24], WP02_CHILDREN],
    ] as const) {
      const parsed = parseRepoFile(w, rel);
      assert.equal(parsed.file.tasks.length, children.length + 1, `${rel}: parent + ${children.length} children`);
      const parent = byId(parsed, wpId);
      assert.equal(parent.kind, "document", "children inherit kind document (C3.1)");
      assert.deepEqual([parent.taskBody.startLine, parent.taskBody.endLine], extent, `${wpId} extent is the whole body`);
      assert.deepEqual(
        parent.taskBody.promotedRanges,
        children.map((c) => c.extent satisfies readonly [number, number]),
        `${wpId} promoted ranges = the promoted child spans, source order (C2.4)`,
      );
      assert.deepEqual(
        parent.childUuids,
        children.map((c) => byId(parsed, c.id).stableUuid),
        `${wpId} childUuids in source order`,
      );
      const planUuids = new Set(plan.entries.map((e) => e.taskUuid));
      for (const child of children) {
        const task = byId(parsed, child.id);
        assert.equal(task.parentUuid, parent.stableUuid, `${child.id} parents to ${wpId}`);
        assert.equal(task.localTaskId, child.id, "localTaskId is the bare token (C3.1)");
        assert.equal(task.kind, "document");
        assert.equal(task.title, child.title, "child title = anchor text after the token");
        assert.deepEqual([task.taskBody.startLine, task.taskBody.endLine], child.extent, `${child.id} section extent`);
        assert.equal(task.featureName, MISSION, "children inherit the mission attribution");
        assert.ok(planUuids.has(task.stableUuid), `${child.id} reaches the plan`);
      }
    }

    // ── T099: roster-only id — recognized-but-excluded, never a task (C2.5) ─────────
    const wp02 = parseRepoFile(w, WP02);
    assert.equal(
      wp02.file.tasks.some((t) => t.localTaskId === "T099"),
      false,
      "no empty draft is ever conjured for a roster entry without an anchor",
    );
    const t099 = wp02.exclusions.filter((x) => x.reason === "subtask-no-anchor");
    assert.equal(t099.length, 1, "exactly one no-anchor exclusion — the flow roster's T099");
    assert.equal(t099[0]?.kind, "subtask");
    assert.equal(t099[0]?.lineNumber, 5, "the exclusion names the roster line");
    assert.equal(t099[0]?.text, "T099");
  } finally {
    await w.dispose();
  }
});

test("023 two-level plan: child identity is the frozen seed layout spec-kitty\\0mission\\0WPnn\\0Tnnn (C3.1)", async () => {
  const w = await buildWorld("spec-kitty-two-level");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const planUuids = new Set(plan.entries.map((e) => e.taskUuid));

    for (const [wpId, tId] of [
      ["WP01", "T001"],
      ["WP02", "T005"],
    ] as const) {
      // The seed INPUT is asserted byte-for-byte, then fed through the frozen uuid
      // derivation — the compose-slot precedent (NUL join in the THIRD slot), not a
      // re-implementation of identity.ts.
      const seed = taskStableSeed(
        { frameworkId: "spec-kitty", featureName: MISSION, localTaskId: `${wpId}\u0000${tId}` },
        { ordinal: 0, filePath: WP01 },
      );
      assert.equal(seed, `spec-kitty\u0000${MISSION}\u0000${wpId}\u0000${tId}`);
      assert.ok(planUuids.has(deriveStableUuid(seed, w.config.toolId)), `${wpId}/${tId} plans under the frozen seed`);
    }

    // Parent identities keep their 022 seed shape unchanged.
    const wp01Seed = taskStableSeed(
      { frameworkId: "spec-kitty", featureName: MISSION, localTaskId: "WP01" },
      { ordinal: 0, filePath: WP01 },
    );
    assert.ok(planUuids.has(deriveStableUuid(wp01Seed, w.config.toolId)), "the WP01 parent identity is unchanged");
  } finally {
    await w.dispose();
  }
});

// ─────────────────────────────────────────────────────────────── apply boundary

test("023 two-level apply: parent-before-child creates, child bodies are sections, parent bodies drop promoted spans only (C2.3/C2.4)", async () => {
  const w = await buildWorld("spec-kitty-two-level");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    assert.ok(applied.operations.every((o) => o.status !== "failed"));

    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 9, "one create per level-1 task and promoted child");
    assert.equal(w.fake.world.issues.size, 9, "zero empty issues anywhere (C2.5)");
    for (const issue of w.fake.world.issues.values()) {
      assert.notEqual(issue.description.trim(), "", "no issue mirrors to visible-empty content");
    }

    const linesWp01 = rawLines(w, WP01);
    const linesWp02 = rawLines(w, WP02);

    for (const [wpTitle, lines, extent, children] of [
      ["Setup", linesWp01, [12, 36], WP01_CHILDREN],
      ["OAuth bridge", linesWp02, [8, 24], WP02_CHILDREN],
    ] as const) {
      const parentIssue = createdIssueByTitle(w, wpTitle);
      const parentCreate = creates.find((c) => createInput(c).title === wpTitle)!;
      assert.equal(createInput(parentCreate).parentId, undefined, "level-1 tasks stay parentless (C0.1)");

      // Parent description: the body MINUS every promoted span — hole-slice, source
      // order preserved, nothing else touched (A-023-0 promotedRanges consumption).
      const expectedParent = sliceWithout(lines, extent[0], extent[1], children.map((c) => c.extent));
      assert.equal(createInput(parentCreate).description, expectedParent, `${wpTitle}: promoted sections are NOT duplicated on the parent`);

      for (const child of children) {
        const childCreate = creates.find((c) => createInput(c).title === child.title);
        assert.ok(childCreate, `child '${child.title}' created`);
        assert.equal(createInput(childCreate).parentId, parentIssue.id, `${child.id} links to its WP issue`);
        assert.ok(parentCreate.seq < childCreate.seq, `parent-before-child emission order (${child.id})`);
        assert.equal(
          createInput(childCreate).description,
          slice(lines, child.extent[0], child.extent[1]),
          `${child.id} description is exactly its section text`,
        );
      }
    }

    // The Activity-Log restatement is mirrored PARENT content at depth 2 — verbatim,
    // even though it visually matches the anchor grammar (C2.3).
    const wp01Description = createInput(creates.find((c) => createInput(c).title === "Setup")!).description;
    assert.ok(wp01Description.includes("#### Subtask T001: Scaffold the package ✅"));
    assert.ok(wp01Description.includes("restatement AFTER the Activity Log stop line"));
    assert.ok(!wp01Description.includes("### Subtask T001 – Scaffold the package"), "the promoted anchor itself is gone");
    assert.ok(!wp01Description.includes("- Keep zero runtime dependencies."), "promoted section body is gone");
  } finally {
    await w.dispose();
  }
});

// ───────────────────────────────────────────────── T016: duplicate-anchor refusal

test("023 T016: duplicate in-region anchors refuse the plan through the EXISTING document collision guard (C2.6)", async () => {
  const w = await buildWorld("spec-kitty-two-level");
  try {
    // Temp-copy mutation (harness-sanctioned): one document, TWO in-region T004 anchors.
    writeFileSync(
      join(w.repositoryRoot, `kitty-specs/${MISSION}/tasks/WP03-dup.md`),
      [
        "---",
        "work_package_id: WP03",
        "title: Duplicate probe",
        "---",
        "",
        "# WP03 — Duplicate probe",
        "",
        "### Subtask T004 – First definition",
        "- guidance one",
        "### Subtask T004 – Second definition",
        "- guidance two",
        "",
      ].join("\n"),
      "utf8",
    );
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    await assert.rejects(
      () => engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }),
      (error: unknown) => {
        assert.ok(error instanceof DocumentIdentityCollisionError, `no-new-error-class: got ${String(error)}`);
        assert.equal(error.frameworkId, "spec-kitty");
        assert.equal(error.featureName, MISSION);
        assert.equal(error.localTaskId, "T004", "the colliding id is the CHILD token");
        assert.deepEqual(error.filePaths, [`kitty-specs/${MISSION}/tasks/WP03-dup.md`], "deterministic path list");
        return true;
      },
    );
    assert.equal(
      callsOf(w, "createIssue").filter((c) => c.ok).length,
      0,
      "refusal precedes any mutation — no plan object, no apply",
    );
  } finally {
    await w.dispose();
  }
});
