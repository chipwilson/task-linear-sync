/**
 * T014 [US1] — parse-model tables for `spec-superpower` (data-model §3 rules 1–6,
 * contract Rules 4–5; FR-004/FR-005/FR-006, SC-002): each `Task N:` heading yields exactly
 * one task (id `Task N`, title minus the id span), every checkbox is a rollup exclusion and
 * never a task, preamble sections and the document title never task, plus the edge cases
 * (empty task section, headingless plan, stray pre-task checklist, level-5 refusal) and
 * verbatim body spans including fenced code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { builtInAdapters } from "task-linear-sync/discovery";
import { type TaskFileAdapter, parseTaskFile } from "task-linear-sync/parsing";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
/** 004 consumer view (adapter-consumption boundary rule 2): only the members `parseTaskFile`
 * reads — literal id pinned, every convention read from the real built-in row. */
const row = builtInAdapters["spec-superpower"];
const adapter = {
  id: "spec-superpower" as const,
  featureName: (filePath: string) => row.featureName(filePath),
  headingGrammar: row.headingGrammar,
  phasePattern: row.phasePattern,
  summaryPattern: row.summaryPattern,
  rollupPattern: row.rollupPattern,
  identityFileScope: row.identityFileScope,
} satisfies TaskFileAdapter;
const PLANS = join(fixtureRepoPath("spec-superpower"), "docs", "superpowers", "plans");

function parseFixture(name: string) {
  const filePath = `docs/superpowers/plans/${name}`;
  return { filePath, result: parseTaskFile(filePath, readFileSync(join(PLANS, name), "utf8"), adapter, cfg) };
}

const PLANS_EXPECTED: readonly (readonly [string, readonly string[]])[] = [
  ["2026-11-01-sync.md", ["SyncJournalWriter", "DriftDetector", "MirrorRenderer"]],
  ["2026-11-02-auth.md", ["SessionStore", "AuthMiddleware", "LoginRoute"]], // level-4 `####` headings throughout — level variance pinned
  ["2026-11-09-sync.md", ["LedgerRecordCodec", "LedgerWalk", "LedgerHistoryRoute"]],
];

for (const [name, titles] of PLANS_EXPECTED) {
  test(`spec-superpower parse — ${name}: exactly 3 tasks (Task 1–3), 7 checkbox exclusions, zero task noise (SC-002)`, () => {
    const { result } = parseFixture(name);
    assert.deepEqual(
      result.file.tasks.map((t) => [t.localTaskId, t.title]),
      [
        ["Task 1", titles[0]],
        ["Task 2", titles[1]],
        ["Task 3", titles[2]],
      ],
      "ids are the `Task N` span; titles exclude the id span (FR-004)",
    );
    for (const task of result.file.tasks) {
      assert.equal(task.kind, "heading");
      assert.ok(!task.title.includes("Task"), "title carries no `Task N` remnant");
      assert.ok(!("checked" in task), "heading tasks carry no checkbox state");
    }
    // FR-005 / Rule 5: every checkbox is excluded (kind checklist, reason rollup) — never a task.
    assert.equal(result.exclusions.length, 7, "seven steps, seven exclusion records");
    for (const ex of result.exclusions) {
      assert.equal(ex.kind, "checklist");
      assert.equal(ex.reason, "rollup");
      assert.match(ex.text, /^\s*[-*+]\s*\[[ xX]\]/);
      assert.ok(!result.file.tasks.some((t) => t.lineNumber === ex.lineNumber), "excluded lines never appear in file.tasks");
    }
    // FR-006 / Rule 4: nothing from preamble headings or the document title became a task.
    const taskLines = new Set(result.file.tasks.map((t) => t.lineNumber));
    assert.ok(!taskLines.has(1), "the `# …` document title is not a task");
    for (const preamble of ["Goal", "Architecture", "Tech Stack", "Spec reference", "Global Constraints", "Review Focus"]) {
      assert.ok(!result.file.tasks.some((t) => t.title === preamble), `preamble section ${preamble} never yields a task`);
    }
  });
}

test("spec-superpower parse — step bodies mirror their plan span verbatim, fenced code included (FR-004/FR-007, data-model §3 rule 7)", () => {
  const { result } = parseFixture("2026-11-01-sync.md");
  const raw = readFileSync(join(PLANS, "2026-11-01-sync.md"), "utf8").split("\n");
  const task1 = result.file.tasks.find((t) => t.localTaskId === "Task 1");
  assert.ok(task1);
  const span = raw.slice(task1.taskBody.startLine - 1, task1.taskBody.endLine).join("\n");
  assert.ok(span.startsWith("### Task 1: SyncJournalWriter"), "the extent starts at the task heading itself");
  assert.ok(span.includes("- [ ] **Step 1: Write the failing journal round-trip test**"), "steps mirror verbatim inside the body");
  assert.ok(span.includes("```sh"), "fenced command blocks mirror verbatim");
  assert.ok(span.includes("src/sync/journal.ts"), "exact-file lists mirror verbatim");
  for (const task of result.file.tasks) {
    const body = raw.slice(task.taskBody.startLine - 1, task.taskBody.endLine).join("\n");
    assert.ok(!body.includes("## Review Focus") && !body.includes("## Goal"), "preamble prose is in no task body (research R4)");
  }
});

test("spec-superpower parse — level-5 `##### Task 9:` matches no grammar (levels 2–4 only; research R2)", () => {
  const content = "# Doc\n\n## Goal\n\nIntro.\n\n##### Task 9: Too Deep\n\n- [ ] **Step 1: nope**\n";
  const result = parseTaskFile("docs/superpowers/plans/2026-11-09-deep.md", content, adapter, cfg);
  assert.deepEqual(result.file.tasks, [], "heading level 5 is structure, not a task");
  assert.equal(result.exclusions.length, 1, "the checkbox is still excluded (Rule 5)");
});

test("spec-superpower parse — empty task section is a valid task with an empty extent (edge case)", () => {
  const content = "# Plan\n\n### Task 1: Empty Section\n\n### Task 2: Filled\n\nbody text\n";
  const result = parseTaskFile("docs/superpowers/plans/2026-11-09-empty.md", content, adapter, cfg);
  assert.equal(result.file.tasks.length, 2);
  const empty = result.file.tasks.find((t) => t.localTaskId === "Task 1")!;
  assert.equal(empty.taskBody.startLine, empty.taskBody.endLine, "empty section → startLine === endLine");
});

test("spec-superpower parse — headingless preamble-only content: zero tasks, zero warnings, checkboxes still excluded (data-model §3 rule 5)", () => {
  const content = "# Plan Title\n\n## Goal\n\nNothing here is a task.\n\n- [ ] **Step 1: stray before any task**\n";
  const result = parseTaskFile("docs/superpowers/plans/2026-11-09-preamble.md", content, adapter, cfg);
  assert.deepEqual(result.file.tasks, []);
  assert.deepEqual(result.warnings, [], "zero errors — an informational diagnostic at most");
  assert.equal(result.exclusions.length, 1, "stray checklist is excluded, never its own task");
  assert.equal(result.exclusions[0].reason, "rollup");
});

test("spec-superpower parse — stray `- [ ]` before the first task heading is excluded, never a task (edge case)", () => {
  const content = "# Plan\n\n- [ ] **Step 0: stray**\n\n### Task 1: Real\n\n- [ ] **Step 1: step**\n";
  const result = parseTaskFile("docs/superpowers/plans/2026-11-09-stray.md", content, adapter, cfg);
  assert.equal(result.file.tasks.length, 1, "only the `Task 1:` heading is a task");
  assert.equal(result.file.tasks[0].lineNumber, 5);
  assert.deepEqual(result.exclusions.map((e) => e.lineNumber), [3, 7], "both checkboxes are exclusions");
});
