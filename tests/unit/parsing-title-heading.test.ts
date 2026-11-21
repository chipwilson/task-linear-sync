/**
 * T007 [US1] — document-title-heading rule matrix (C1/C2/C3; A-021-1/A-021-3;
 * data-model §1–§2, V1–V3; research R5). Written test-first: every case encoding the
 * NEW orphan rule (a column-0 checklist under the document-title heading attaches to
 * NO heading → depth 1 → survives the shipped flat-board default) and the AMENDED
 * flat-document determination FAILS until the `src/parsing/extract.ts` fix lands;
 * the pinned "unchanged" consequences (V1–V3, mid-file and level-2 headings, fences,
 * organizer folding) are regression guards that pass now and must stay green.
 *
 * V1 — a first line whose title yields a `Local_Task_ID` under the EFFECTIVE grammar
 * (`# Task 1: …` via kiro's override) is an ordinary heading task: orphans adopt it.
 * V2 — fenced `# …` lines never qualify (fence content is non-task text).
 * V3 — a file whose first non-blank line is a checkbox has no title heading (flat).
 *
 * Flat_Document determination (data-model §2, verbatim — case (j) enforces it):
 *
 * | Input state | Flat? |
 * |-------------|-------|
 * | No grammar-matching heading at all | true (unchanged) |
 * | Only grammar-matching heading is the Document_Title_Heading | **true** (amended; previously false) |
 * | Any other grammar-matching heading present | false (unchanged) |
 * | Configured flat-checklist path markers match | true (unchanged, overridable) |
 *
 * Pure unit tier: inline content strings through `parseTaskFile`, zero fixture I/O.
 * Internals (`detectFlatDocument`, `resolveConventions`, `splitLines`) are imported
 * directly per the `parsing-spec-kitty.test.ts` precedent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";

import { detectFlatDocument, resolveConventions } from "../../src/parsing/extract.js";
import { splitLines } from "../../src/parsing/content.js";

import { genericFixtureAdapter, kiroFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const PATH = "specs/demo/tasks.md"; // generic `<base>/<feature>/tasks.md` shape
const KIRO_PATH = ".kiro/specs/demo/tasks.md";
const cfg = makeTestConfig(); // shipped defaults — no overrides (the reported defect's setting)

/** Parse with the generic fixture adapter; `undefined` cap = built-in default 1 (flat board). */
function parseDoc(content: string, cap?: number): ParseResult {
  const config = cap === undefined ? cfg : makeTestConfig({ maxTaskIssueDepth: cap });
  return parseTaskFile(PATH, content, genericFixtureAdapter, config);
}

/** Parse with the kiro fixture adapter (its grammar override additionally captures `Task <N>` ids). */
function parseKiroDoc(content: string, cap?: number): ParseResult {
  const config = cap === undefined ? cfg : makeTestConfig({ maxTaskIssueDepth: cap });
  return parseTaskFile(KIRO_PATH, content, kiroFixtureAdapter, config);
}

const foldedRecords = (r: ParseResult) => r.exclusions.filter((e) => e.reason === "depth-folded");

function byLine(r: ParseResult): Map<number, Task> {
  return new Map(r.file.tasks.map((t) => [t.lineNumber, t]));
}

/** C2 orphan-rule assertion: `parentUuid` is conditionally present, so ABSENCE is the contract. */
function assertParentless(task: Task, why: string): void {
  assert.ok(!("parentUuid" in task), why);
}

/** Flat-document determination over the internal helper (same wiring `extractTasks` performs). */
function flatOf(content: string): boolean {
  return detectFlatDocument(splitLines(content, cfg.tabWidth), resolveConventions(genericFixtureAdapter, cfg), cfg);
}

// ── (a)–(b) — the title heading itself, and the V1 id-bearing flip ───────────────────

test("(a) title heading + column-0 orphans — parent null, depth 1, all survive the default flat board (C1/C2)", () => {
  const doc = [
    "# Implementation Plan", // 1 — level 1, first line, no Local_Task_ID → document-title heading
    "", // 2
    "- [x] 1. First task", // 3 — column-0 orphan → attaches to NO heading → depth 1
    "", // 4
    "  detail bullet", // 5 — plain content: never a task, never a boundary (V5)
    "", // 6
    "- [ ] 2. Second task", // 7 — second column-0 orphan → parentless depth 1 too (V4)
    "",
  ].join("\n");
  const r = parseDoc(doc); // SHIPPED default cap 1 — survival here IS the fix's signal
  assert.deepEqual(r.file.tasks.map((t) => t.lineNumber), [1, 3, 7], "title heading + both checkboxes survive");

  const heading = byLine(r).get(1);
  assert.ok(heading);
  assert.equal(heading.kind, "heading");
  assert.equal(heading.title, "Implementation Plan", "title is the FULL heading text (A-021-2, C6)");
  assert.ok(!("localTaskId" in heading), "the title heading yields no Local_Task_ID (C1)");
  assert.deepEqual(heading.childUuids, [], "it adopts no children (C2)");

  for (const line of [3, 7]) {
    const task = byLine(r).get(line);
    assert.ok(task, `checkbox task exists at line ${String(line)}`);
    assert.equal(task.kind, "checklist");
    assertParentless(task, `line ${String(line)}: column-0 orphan under the title heading has no parent (C2)`);
  }
  assert.deepEqual(foldedRecords(r), [], "zero depth-folded exclusions (C5)");
});

test("(b) V1 — an id-bearing first heading (kiro `Task 1`) is NOT a title heading: orphans still adopt it", () => {
  const doc = [
    "# Task 1: Do thing", // 1 — kiro grammar captures the full `Task 1` id → ordinary heading task
    "", // 2
    "- [ ] 1.1: orphan", // 3 — adopts it → depth 2 (V1: orphan rule unchanged beneath it)
    "",
  ].join("\n");
  const at2 = parseKiroDoc(doc, 2); // cap 2 reveals the parent link
  assert.deepEqual(at2.file.tasks.map((t) => t.lineNumber), [1, 3]);
  const heading = byLine(at2).get(1);
  assert.ok(heading);
  assert.equal(heading.localTaskId, "Task 1", "kiro's override grammar captures the digit-bearing `Task 1` id");
  assert.equal(heading.title, "Do thing");
  assert.equal(byLine(at2).get(3)?.parentUuid, heading.stableUuid, "V1: id-bearing first heading IS an adoptable parent");

  // Amended A-021-2 flip side: under the DEFAULT grammar `Task` is a digit-less word form, so the
  // same line yields NO id → it IS a document-title heading → the orphan is parentless and survives
  // the default cap (RED until the extract.ts orphan rule lands).
  const at1 = parseDoc(doc);
  assert.deepEqual(at1.file.tasks.map((t) => t.lineNumber), [1, 3], "orphan survives the default flat board (C2)");
  const gHeading = byLine(at1).get(1);
  assert.ok(gHeading);
  assert.ok(!("localTaskId" in gHeading), "`Task` is a digit-less word form under the amended default grammar");
  assert.equal(gHeading.title, "Task 1: Do thing", "no id ⇒ the full heading text is the title");
  const orphan = byLine(at1).get(3);
  assert.ok(orphan);
  assertParentless(orphan, "under the generic grammar the heading is a title heading ⇒ no adoption (C2)");
  assert.deepEqual(foldedRecords(at1), [], "zero depth-folded exclusions (C5)");
});

// ── (c)–(e) — V1/V2 non-qualifiers: level-2 first heading, mid-file H1, fenced `#` ────

test("(c) V1/level-2 — a `## Scope` first heading is NOT a title heading: unchanged depth-2 adoption", () => {
  const doc = [
    "## Scope", // 1 — level 2 ≠ 1 → ordinary heading task even on the first line
    "", // 2
    "- [x] 1. task", // 3 — adopts it → depth 2 → folds at the default cap (regression guard)
    "",
  ].join("\n");
  const at1 = parseDoc(doc);
  assert.deepEqual(at1.file.tasks.map((t) => t.lineNumber), [1], "the depth-2 orphan folds at cap 1 (A-020-2)");
  assert.deepEqual(foldedRecords(at1).map((e) => e.lineNumber), [3]);
  const at2 = parseDoc(doc, 2);
  assert.deepEqual(at2.file.tasks.map((t) => t.lineNumber), [1, 3]);
  assert.equal(
    byLine(at2).get(3)?.parentUuid,
    byLine(at2).get(1)?.stableUuid,
    "adoption beneath a non-title heading is unchanged (C2 second sentence)",
  );
});

test("(d) mid-file level-1 heading is NOT a title heading: only the first line is exempt (C1, R5)", () => {
  const doc = [
    "# Implementation Plan", // 1 — document-title heading (first line, level 1, no id)
    "", // 2
    "- [x] 1. top", // 3 — orphan under the TITLE heading → parentless depth 1 (RED pre-fix)
    "", // 4
    "# Section Two", // 5 — level 1 but NOT the first line → ordinary heading task
    "", // 6
    "- [ ] 2. under section two", // 7 — adopts Section Two → depth 2 → folds at cap 1 (guard)
    "",
  ].join("\n");
  const at1 = parseDoc(doc);
  assert.deepEqual(at1.file.tasks.map((t) => t.lineNumber), [1, 3, 5], "line 3 survives parentless; line 7 folds");
  assert.deepEqual(foldedRecords(at1).map((e) => e.lineNumber), [7]);
  const section = byLine(at1).get(5);
  assert.ok(section);
  assert.equal(section.kind, "heading", "the mid-file H1 is an ordinary heading task");
  assert.equal(section.title, "Section Two");
  const top = byLine(at1).get(3);
  assert.ok(top);
  assertParentless(top, "a column-0 orphan under the title heading stays parentless (C2)");

  const at2 = parseDoc(doc, 2);
  assert.deepEqual(at2.file.tasks.map((t) => t.lineNumber), [1, 3, 5, 7]);
  assert.equal(
    byLine(at2).get(7)?.parentUuid,
    byLine(at2).get(5)?.stableUuid,
    "`2. under section two` parents to the mid-file H1 at cap 2",
  );
  const topAt2 = byLine(at2).get(3);
  assert.ok(topAt2);
  assertParentless(topAt2, "the title-heading exemption is cap-independent");
});

test("(e) V2 — a fenced `#` never qualifies: no heading task, checkbox survives parentless (guard)", () => {
  const doc = [
    "```md", // 1 — the fence delimiter line itself is non-task text (R4)
    "# Implementation Plan", // 2 — inside the fence: never a heading, never a title heading
    "```", // 3
    "", // 4
    "- [x] real task", // 5 — no current heading exists → parentless depth-1 survivor
    "",
  ].join("\n");
  const r = parseDoc(doc);
  assert.equal(r.file.tasks.length, 1, "fenced content drafts no heading task (V2)");
  const task = r.file.tasks[0];
  assert.ok(task);
  assert.equal(task.kind, "checklist");
  assert.equal(task.lineNumber, 5);
  assertParentless(task, "the fenced title names nothing — the checkbox has no parent (V2)");
  assert.deepEqual(r.exclusions, [], "fence interior is body text, never an exclusion");
});

// ── (f)–(h) — V3 flat files, heading-only extents, and the mixed organizer shape ──────

test("(f) V3 — a checkbox-only file has no title heading: flat behavior unchanged (guard)", () => {
  const r = parseDoc(["- [x] a", "- [x] b", ""].join("\n"));
  assert.deepEqual(r.file.tasks.map((t) => t.lineNumber), [1, 2], "both checkboxes are tasks");
  for (const task of r.file.tasks) assertParentless(task, "flat-document checkboxes stay parentless (V3)");
  assert.deepEqual(r.exclusions, [], "nothing folds: the file was always flat");
});

test("(g) heading-only file — the title heading survives as a task with its body bounded by EOF (C1)", () => {
  const doc = ["# Implementation Plan", "", "Preamble prose.", ""].join("\n"); // last real line = 3
  const r = parseDoc(doc);
  assert.equal(r.file.tasks.length, 1, "zero checkboxes: the title heading is still a heading task (C1)");
  const task = r.file.tasks[0];
  assert.ok(task);
  assert.equal(task.kind, "heading");
  assert.equal(task.title, "Implementation Plan", "full heading text, no id stripping (C1/C6)");
  assert.ok(!("localTaskId" in task), "no Local_Task_ID — it names the document");
  assert.deepEqual(task.taskBody, { startLine: 1, endLine: 3 }, "with no following task the extent runs to EOF as today");
});

test("(h) mixed shape — title-heading orphans survive at cap 1 while `## 9.0:` orphans still fold", () => {
  const doc = [
    "# Title Doc", // 1 — document-title heading (no id; `Title` is a digit-less word)
    "", // 2
    "- [x] 1. before headings", // 3 — parentless survivor post-fix (RED pre-fix)
    "", // 4
    "- [ ] 2. still before", // 5 — parentless survivor post-fix (RED pre-fix)
    "", // 6
    "## 9.0: Organizer heading", // 7 — ordinary heading task, id `9.0`
    "", // 8
    "- [ ] 3. orphan under organizer", // 9 — adopts the organizer → depth 2 → folds at cap 1 (guard)
    "", // 10
    "## 9.1: Second organizer", // 11 — ordinary heading task, id `9.1`
    "",
  ].join("\n");
  const at1 = parseDoc(doc);
  assert.deepEqual(at1.file.tasks.map((t) => t.lineNumber), [1, 3, 5, 7, 11], "title heading + 1, 2 + both organizers");
  assert.deepEqual(foldedRecords(at1).map((e) => e.lineNumber), [9], "the organizer orphan still folds (world pin)");
  for (const line of [3, 5]) {
    const task = byLine(at1).get(line);
    assert.ok(task, `checkbox task exists at line ${String(line)}`);
    assertParentless(task, `line ${String(line)}: column-0 orphan under the title heading has no parent (C2)`);
  }

  const at2 = parseDoc(doc, 2);
  assert.deepEqual(at2.file.tasks.map((t) => t.lineNumber), [1, 3, 5, 7, 9, 11]);
  assert.equal(
    byLine(at2).get(9)?.parentUuid,
    byLine(at2).get(7)?.stableUuid,
    "unchanged folding: the orphan beneath `## 9.0:` parents to that organizer at cap 2",
  );
  const first = byLine(at2).get(3);
  assert.ok(first);
  assertParentless(first, "the title-heading exemption is cap-independent");
});

// ── (i)–(j) — spec edge case at scale, and the C3 flat-determination table ────────────

test("(i) spec edge case — 150 column-0 tasks under a title heading ALL surface at the default cap", () => {
  const items = Array.from({ length: 150 }, (_, n) => `- [x] ${String(n + 1)}. task ${String(n + 1)}`);
  const doc = ["# Implementation Plan", "", ...items, ""].join("\n");
  const r = parseDoc(doc);
  assert.equal(r.file.tasks.length, 151, "title heading + every generated checkbox survives the flat board");
  assert.equal(foldedRecords(r).length, 0, "zero depth-folded exclusions (C5)");
  const headings = r.file.tasks.filter((t) => t.kind === "heading");
  assert.equal(headings.length, 1, "exactly one heading task: the document-title heading");
  const checklists = r.file.tasks.filter((t) => t.kind === "checklist");
  assert.equal(checklists.length, 150);
  for (const task of checklists) {
    assert.ok("localTaskId" in task, `line ${String(task.lineNumber)} carries its integer id`);
    assertParentless(task, `line ${String(task.lineNumber)}: every top-level checkbox is parentless (C2)`);
  }
});

test("(j) flat-document determination — the amended C3 table, verbatim against detectFlatDocument", () => {
  // Row 1 — no grammar-matching heading at all → true (unchanged; guard).
  assert.equal(flatOf("- [x] a\n- [x] b\n"), true, "checkbox-only doc is flat");
  // Row 2 — the ONLY grammar-matching heading is the document-title heading → true
  // (A-021-3 amended; previously false — RED until the extract.ts determination lands).
  assert.equal(flatOf("# Implementation Plan\n\n- [x] 1. task\n"), true, "title-only heading doc IS flat (C3)");
  // Row 3 — any other grammar-matching heading present → false (unchanged; guards).
  assert.equal(
    flatOf("# Implementation Plan\n\n- [x] 1. task\n\n## 9.0: Organizer heading\n"),
    false,
    "an organizer heading alongside the title makes the doc non-flat",
  );
  assert.equal(flatOf("## Organizer\n\n- [x] 1. task\n"), false, "a lone level-2 heading is not a title heading");
  // Row 4 — configured flat-checklist markers on the first line → true (unchanged, overridable;
  // the `flat-markers.md` shape: checkbox-first doc with a mid-file grammar heading).
  assert.equal(flatOf("- [x] first\n\n## 9.0: Heading\n\n- [ ] orphan\n"), true, "the marker trigger still wins");
});
