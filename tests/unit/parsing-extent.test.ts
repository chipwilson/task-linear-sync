/**
 * T017 [US1] — Task_Body extent unit tests (FR-010 verbatim: the task line "plus all
 * content beneath it up to the next task or next equal-or-shallower heading, including
 * nested checklist children"; research R5 operationalization; parsing-api rule 10;
 * quickstart US1 row 7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult } from "task-linear-sync/parsing";

import { genericFixtureAdapter, readFixture, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "specs/auth/tasks.md";

function extents(fixture: string): Map<number, { startLine: number; endLine: number }> {
  const result = parseTaskFile(PATH, readFixture(fixture), genericFixtureAdapter, cfg);
  return new Map(result.file.tasks.map((task) => [task.lineNumber, task.taskBody]));
}

function extentsOf(result: ParseResult): Map<number, { startLine: number; endLine: number }> {
  return new Map(result.file.tasks.map((task) => [task.lineNumber, task.taskBody]));
}

test("parsing extent — nested.md: end before next non-descendant task or ≤-level heading", () => {
  const e = extents("parsing/nested.md");
  assert.deepEqual(e.get(1), { startLine: 1, endLine: 3 }); // level-1 heading; deeper phase heading at 3 stays inside; next task at 5
  assert.deepEqual(e.get(5), { startLine: 5, endLine: 10 }); // ends before the level-2 phase heading at 12; trailing blank trimmed
  assert.deepEqual(e.get(8), { startLine: 8, endLine: 10 }); // checklist bounded by the next heading (12)
  assert.deepEqual(e.get(9), { startLine: 9, endLine: 9 }); // leaf: endLine === startLine
  assert.deepEqual(e.get(10), { startLine: 10, endLine: 10 }); // leaf at file end region
  assert.deepEqual(e.get(14), { startLine: 14, endLine: 17 }); // orphaned child at 17 is a nested checklist child → stays inside (FR-010)
  assert.deepEqual(e.get(17), { startLine: 17, endLine: 17 }); // final line leaf
});

test("parsing extent — nested checklist children stay INSIDE the parent extent (FR-010)", () => {
  const e = extents("parsing/nested.md");
  const parent = e.get(5)!;
  for (const childLine of [8, 9, 10]) {
    const child = e.get(childLine)!;
    assert.ok(parent.startLine <= child.startLine && child.endLine <= parent.endLine, `child line ${childLine} must stay inside the parent extent`);
  }
  const itemParent = e.get(8)!;
  assert.ok(itemParent.endLine >= e.get(10)!.endLine);
});

test("parsing extent — fenced content counts as body text; unclosed fence runs to EOF", () => {
  const e = extents("parsing/fenced.md");
  assert.deepEqual(e.get(3), { startLine: 3, endLine: 9 }); // fenced block is this checklist's body (not tasks)
  assert.deepEqual(e.get(11), { startLine: 11, endLine: 17 });
  assert.deepEqual(e.get(21), { startLine: 21, endLine: 25 }); // unclosed ~~~open swallows trailing lines as body
});

test("parsing extent — summary/rollup exclusions do not change surrounding extents", () => {
  const e = extents("parsing/summary-rollup.md");
  assert.deepEqual(e.get(1), { startLine: 1, endLine: 3 }); // Summary heading (5) bounds it as a heading
  assert.deepEqual(e.get(10), { startLine: 10, endLine: 10 });
  assert.deepEqual(e.get(12), { startLine: 12, endLine: 16 }); // rollup line 14 is body content; genuine child at 16 (orphaned to 1.2) stays inside
  assert.deepEqual(e.get(16), { startLine: 16, endLine: 16 }); // leaf at EOF
});

test("parsing extent — leaf tasks with no content beneath have endLine === startLine (both kinds)", () => {
  const e = extents("parsing/flat-noheadings.md");
  assert.deepEqual(e.get(1), { startLine: 1, endLine: 1 });
  assert.deepEqual(e.get(2), { startLine: 2, endLine: 3 }); // parent keeps descendant line 3 inside
  assert.deepEqual(e.get(3), { startLine: 3, endLine: 3 });

  const f = extents("parsing/flat-markers.md");
  assert.deepEqual(f.get(1), { startLine: 1, endLine: 1 });
  assert.deepEqual(f.get(4), { startLine: 4, endLine: 6 }); // orphaned child at 6 stays inside its heading task
  assert.deepEqual(f.get(6), { startLine: 6, endLine: 6 }); // leaf
});

test("parsing extent — conflict blocks are body content, not task boundaries (flag source)", () => {
  const content = readFixture("parsing/conflict.md");
  const result = parseTaskFile(PATH, content, genericFixtureAdapter, cfg);
  const e = extentsOf(result);
  assert.deepEqual(e.get(1), { startLine: 1, endLine: 5 }); // clean section: child at 5 inside, next task (7) bounds
  assert.deepEqual(e.get(7), { startLine: 7, endLine: 15 }); // extent reaches INTO block 11..15 → the FR-009 flag source
  assert.deepEqual(e.get(25), { startLine: 25, endLine: 30 }); // unterminated block region is body content
});
