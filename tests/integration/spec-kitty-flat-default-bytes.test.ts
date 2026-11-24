/**
 * T017 [P] [US2] — the flat-board default is BYTE-STABLE (feature 023 US2; quickstart
 * scenario 1; FR-003/FR-010/FR-011, SC-002/SC-005). At the shipped default cap (1) NOTHING
 * nests: the 0.6.0 posture holds — one task per canonical WP document, the whole body
 * mirrored contiguously (subtask anchors and `#### Subtask …` restatements verbatim inside
 * the parent), zero parented entries, zero `promotedRanges`, zero markdown changes.
 *
 * The pins re-measure the 0.6.0 baseline directly against raw file bytes (no golden
 * snapshot indirection): the created descriptions ARE the contiguous body slice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";
import { builtInAdapters } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";

import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";
import { makeTestConfig, readFixture } from "../helpers/parsing-fixtures.js";

const kittyRow = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;

const MISSION = "002-auth-system";
const WP01 = `kitty-specs/${MISSION}/tasks/WP01-setup.md`;
const WP02 = `kitty-specs/${MISSION}/tasks/WP02-oauth.md`;

function gates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

const createInput = (record: { args: readonly unknown[] }): CreateIssueInput => record.args[0] as CreateIssueInput;

/** The 0.6.0 contiguous body slice: first line after the front-matter fence .. last line. */
function contiguousBody(content: string): string {
  const lines = content.split(/\r\n|\r|\n/);
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim() === "---") {
      close = i;
      break;
    }
  }
  assert.ok(close > 0, "front-matter fence closes");
  let start = close + 1;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start += 1;
  let last = lines.length - 1;
  while (last > start && (lines[last] ?? "").trim() === "") last -= 1;
  return lines.slice(start, last + 1).join("\n");
}

test("023 flat default (world at cap 1): two parents only, zero parented entries, contiguous verbatim bodies", async () => {
  const w = await buildWorld("spec-kitty-two-level", { config: { maxTaskIssueDepth: 1 } }); // default cap
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    assert.equal(plan.entries.length, 2, "task count = canonical WP-document count (C0.2)");
    assert.ok(plan.entries.every((e) => e.decision === "create"));
    assert.ok(plan.entries.every((e) => e.expectedMarkdownChanges.length === 0), "zero write-back either way (C5)");

    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 2, "zero sub-issues ever at the default (FR-003)");

    const bodies: Record<string, string> = {
      Setup: contiguousBody(readFileSync(join(w.repositoryRoot, WP01), "utf8")),
      "OAuth bridge": contiguousBody(readFileSync(join(w.repositoryRoot, WP02), "utf8")),
    };
    for (const [title, body] of Object.entries(bodies)) {
      const create = creates.find((c) => createInput(c).title === title);
      assert.ok(create, `${title} created`);
      assert.equal(createInput(create).parentId, undefined, "no parented entries at depth 1");
      assert.equal(createInput(create).description, body, `${title}: the WHOLE body rides verbatim (0.6.0 bytes)`);
    }
    // Subtask anchors, checklist anchors and the `#### Subtask …` restatement are plain
    // parent CONTENT at the default — never issues, never holes.
    const wp01 = createInput(creates.find((c) => createInput(c).title === "Setup")!).description;
    assert.ok(wp01.includes("### Subtask T001 – Scaffold the package"));
    assert.ok(wp01.includes("### Subtask T004 – Add start-up checks"));
    assert.ok(wp01.includes("#### Subtask T001: Scaffold the package ✅"), "restatement is plain content");
    const wp02 = createInput(creates.find((c) => createInput(c).title === "OAuth bridge")!).description;
    assert.ok(wp02.includes("### Subtask T007 – Access-token refresh"));
    assert.ok(wp02.includes("T099"), "the anchor-less roster id rides inside the whole-body extent");
  } finally {
    await w.dispose();
  }
});

test("023 flat default (parse posture): no promotedRanges key, empty childUuids, verbatim extents", () => {
  const cfg = makeTestConfig(); // built-in defaults — maxTaskIssueDepth 1
  for (const [name, wpId, misses] of [
    ["WP01-auth.md", "WP01", ["T099"]],
    ["WP02-flow.md", "WP02", []],
    ["WP03-noanchors.md", "WP03", ["T005", "T006"]],
  ] as const) {
    const content = readFixture(`parsing/frameworks/spec-kitty/tasks/${name}`);
    const { file, exclusions } = parseTaskFile(`kitty-specs/001-corpus/tasks/${name}`, content, kittyRow, cfg);
    assert.equal(file.tasks.length, 1, `${name}: exactly one task at the default (C0.2)`);
    const task = file.tasks[0]!;
    assert.equal(task.localTaskId, wpId);
    assert.deepEqual(task.childUuids, [], "no child links at depth 1");
    assert.ok(!("promotedRanges" in task.taskBody), `${name}: the flat extent is the 0.6.0 contiguous pair, key absent`);
    assert.equal(
      content.split("\n").slice(task.taskBody.startLine - 1, task.taskBody.endLine).join("\n"),
      contiguousBody(content),
      `${name}: extent IS the contiguous body (folded verbatim by omission — the 020 mechanism)`,
    );
    assert.deepEqual(
      exclusions.filter((e) => e.reason === "subtask-no-anchor").map((e) => e.text),
      [...misses],
      `${name}: anchor-less roster ids stay recognized-but-excluded at every depth (C2.5)`,
    );
  }

  // Depth-1 anchors fold and earn kind-subtask `depth-folded` exclusions (T019).
  const content = readFixture("parsing/frameworks/spec-kitty/tasks/WP01-auth.md");
  const { exclusions } = parseTaskFile("kitty-specs/001-corpus/tasks/WP01-auth.md", content, kittyRow, cfg);
  assert.deepEqual(
    exclusions,
    [
      { lineNumber: 8, kind: "subtask", reason: "subtask-no-anchor", text: "T099" },
      { lineNumber: 20, kind: "subtask", reason: "depth-folded", text: "### Subtask T001 – Implement validator CLI" },
      { lineNumber: 24, kind: "subtask", reason: "depth-folded", text: "### Subtask T002 – Add pytest coverage" },
    ],
    "ascending, kind-subtask, verbatim anchor text",
  );
});
