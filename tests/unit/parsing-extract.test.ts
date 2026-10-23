/**
 * T016 [US1] — extraction unit tests (contracts/parsing-api.md rules 1–6; FR-001,
 * FR-002, FR-003, FR-005, FR-006; quickstart US1 rows 1, 2, 3(phase), 4).
 * Test names carry "parsing extract" / "parsing nesting" / "parsing flat".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";

import {
  genericFixtureAdapter,
  minimalCustomAdapter,
  taskGrammarFixtureAdapter,
  readFixture,
  makeTestConfig,
} from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "specs/auth/tasks.md";

function parse(fixture: string, adapter = genericFixtureAdapter, filePath = PATH): ParseResult {
  return parseTaskFile(filePath, readFixture(fixture), adapter, cfg);
}

function byLine(result: ParseResult): Map<number, Task> {
  return new Map(result.file.tasks.map((t) => [t.lineNumber, t]));
}

// ── Rule 1: heading + checklist extraction; fenced interiors inert (FR-001) ─────────

test("parsing extract — nested.md yields the full six-field-per-task contract (FR-001, FR-006)", () => {
  const result = parse("parsing/nested.md");
  assert.deepEqual(
    result.file.tasks.map((t) => t.lineNumber),
    [1, 5, 8, 9, 10, 14, 17],
  );
  const t = byLine(result);

  const first = t.get(1);
  assert.ok(first);
  assert.equal(first.kind, "heading");
  assert.equal(first.title, "Tasks");
  assert.equal(first.filePath, PATH);
  assert.equal(first.frameworkId, "generic");
  assert.equal(first.featureName, "auth"); // FR-008 threaded onto every task
  assert.match(first.stableUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.unresolvedConflict, false);
  assert.deepEqual(first.childUuids, []);
  assert.ok(!("checked" in first), "heading tasks MUST NOT carry `checked` (frozen invariant)");
  assert.ok(!("issueRef" in first));
  assert.ok(!("localTaskId" in first));

  const heading = t.get(5);
  assert.ok(heading);
  assert.equal(heading.localTaskId, "1.1"); // grammar `id` named group (FR-006)
  assert.equal(heading.title, "Create project scaffold");
  assert.equal(heading.phase, "Setup"); // FR-003 most-recent phase heading

  const item = t.get(8);
  assert.ok(item);
  assert.equal(item.kind, "checklist");
  assert.equal(item.checked, false);
  assert.equal(item.title, "Add dependency manifest");

  const done = t.get(10);
  assert.ok(done);
  assert.equal(done.checked, true); // "[x]" parsed
  assert.equal(done.localTaskId, "1.1.2"); // leading local-ID pattern on a checklist line (FR-006)
  assert.equal(done.title, "Lock the lockfile");

  const refHeading = t.get(14);
  assert.ok(refHeading);
  assert.deepEqual(refHeading.issueRef, { key: "SYNC", number: 7 }); // visible `[<KEY>-<N>]` (FR-006)
  assert.equal(refHeading.title, "Build parser"); // reference stripped from the stored raw title
  assert.equal(refHeading.phase, "Core"); // later phase supersedes the earlier one

  assert.deepEqual(result.exclusions, []);
  assert.deepEqual(result.conflictBlocks, []);
  assert.deepEqual(result.warnings, []);
});

test("parsing extract — fenced pseudo-tasks yield ZERO tasks; fence lines are non-task (FR-001 edge case)", () => {
  const result = parse("parsing/fenced.md");
  assert.deepEqual(
    result.file.tasks.map((t) => t.lineNumber),
    [1, 3, 11, 19, 21],
  );
  const inside = result.file.tasks.filter((task) => [6, 7, 8, 14, 15, 16, 24, 25].includes(task.lineNumber));
  assert.deepEqual(inside, [], "checkbox syntax and headings inside fences are never tasks");
});

test("parsing extract — frozen invariant: kind === 'heading' ⇔ checked === undefined (all fixtures)", () => {
  for (const fixture of ["parsing/nested.md", "parsing/fenced.md", "parsing/summary-rollup.md", "parsing/flat-noheadings.md", "parsing/conflict.md", "parsing/dup-identities.md"]) {
    for (const task of parse(fixture).file.tasks) {
      if (task.kind === "heading") assert.ok(!("checked" in task), `${fixture}:${task.lineNumber} heading must omit checked`);
      else assert.equal(typeof task.checked, "boolean", `${fixture}:${task.lineNumber} checklist must carry checked`);
    }
  }
});

// ── Rule 2: nesting — indent stack, tab normalization, orphans (FR-002) ──────────────

test("parsing nesting — parentUuid/childUuids agree in both directions (nested.md)", () => {
  const result = parse("parsing/nested.md");
  const t = byLine(result);
  const parentOf = (line: number): number | undefined => {
    const uuid = t.get(line)?.parentUuid;
    return result.file.tasks.find((task) => task.stableUuid === uuid)?.lineNumber;
  };
  assert.equal(parentOf(8), 5); // orphan checklist attaches to the enclosing heading task (FR-002)
  assert.equal(parentOf(9), 8);
  assert.equal(parentOf(10), 8); // tab-indented == space-indented sibling at tabWidth
  assert.equal(parentOf(17), 14); // orphan under the later heading, NOT under an earlier section's checklist

  const childLines = (line: number): number[] => {
    const uuids = new Set(t.get(line)?.childUuids);
    return result.file.tasks.filter((task) => uuids.has(task.stableUuid)).map((task) => task.lineNumber);
  };
  assert.deepEqual(childLines(5), [8]);
  assert.deepEqual(childLines(8), [9, 10]); // ordered by line (R5)
  assert.deepEqual(childLines(14), [17]);

  // childUuids is the exact reverse index of parentUuid
  for (const task of result.file.tasks) {
    if (task.parentUuid) {
      const parent = result.file.tasks.find((p) => p.stableUuid === task.parentUuid);
      assert.ok(parent?.childUuids.includes(task.stableUuid), "reverse index consistency");
    }
  }
});

test("parsing nesting — tab/space file nests identically to its space-equivalent twin at tabWidth (FR-002)", () => {
  const content = readFixture("parsing/nested.md");
  assert.ok(/\n\t/.test(content), "fixture must contain leading tabs to prove normalization");
  const spaced = content.replace(/^[ \t]+/gmu, (ws) => ws.replace(/\t/g, "  "));
  const tabbed = parseTaskFile(PATH, content, genericFixtureAdapter, cfg);
  const twin = parseTaskFile(PATH, spaced, genericFixtureAdapter, cfg);
  const shape = (r: ParseResult): [number, number | undefined][] => {
    const lineOf = new Map(r.file.tasks.map((task) => [task.stableUuid, task.lineNumber]));
    return r.file.tasks.map((task) => [task.lineNumber, task.parentUuid ? lineOf.get(task.parentUuid) : undefined]);
  };
  assert.deepEqual(shape(tabbed), shape(twin));
});

// ── Rule 3: phase tracking (FR-003) ──────────────────────────────────────────────────

test("parsing phase — most recent phase-pattern heading supplies later tasks; phase headings are NOT tasks (FR-003)", () => {
  const result = parse("parsing/nested.md");
  const t = byLine(result);
  assert.ok(!t.has(3) && !t.has(12), "phase headings are section organizers, not tasks (research R6)");
  assert.ok(!("phase" in t.get(1)!), "tasks before any phase heading carry no phase");
  assert.equal(t.get(5)?.phase, "Setup");
  assert.equal(t.get(8)?.phase, "Setup"); // survives until superseded
  assert.equal(t.get(10)?.phase, "Setup");
  assert.equal(t.get(14)?.phase, "Core");
  assert.equal(t.get(17)?.phase, "Core");
});

// ── Rule 5: flat documents — both triggers (FR-005) ─────────────────────────────────

test("parsing flat — no-heading document: top-level checkboxes are valid root tasks (FR-005 trigger a)", () => {
  const result = parse("parsing/flat-noheadings.md");
  assert.deepEqual(
    result.file.tasks.map((task) => [task.lineNumber, task.parentUuid === undefined]),
    [
      [1, true],
      [2, true],
      [3, false], // nested via indent stack, not by flatness
    ],
  );
  assert.ok(!("parentUuid" in result.file.tasks[0]!));
  assert.equal(result.file.tasks[2]?.localTaskId, "2.1");
});

test("parsing flat — leading flatChecklistMarkers document with later headings (FR-005 trigger b)", () => {
  const result = parse("parsing/flat-markers.md");
  const t = byLine(result);
  assert.deepEqual([...t.keys()], [1, 2, 4, 6]);
  assert.ok(!("parentUuid" in t.get(1)!) && !("parentUuid" in t.get(2)!)); // flat roots before the first heading
  assert.ok(!("parentUuid" in t.get(4)!)); // heading task
  assert.equal(t.get(6)?.parentUuid, t.get(4)?.stableUuid); // after a heading: orphan attaches to it
});

// ── Adapter-override precedence (contracts/adapter-consumption.md rules 2–3) ─────────

test("parsing extract — precedence: adapter headingGrammar beats merged config; absent member falls back", () => {
  const content = ["## Task 1.2: Do the thing", "", "## Notes", ""].join("\n");

  // Adapter-supplied grammar: strict `Task <N.M>` grammar captures the FULL id and
  // treats the un-matched "## Notes" heading as structure, not a task.
  const strict = parseTaskFile(PATH, content, taskGrammarFixtureAdapter, cfg);
  assert.deepEqual(
    strict.file.tasks.map((task) => [task.lineNumber, task.localTaskId, task.title]),
    [[1, "1.2", "Do the thing"]],
  );

  // Same config, no adapter override: merged `headingIdGrammar` default applies.
  const fallback = parseTaskFile(PATH, content, genericFixtureAdapter, cfg);
  assert.deepEqual(fallback.file.tasks.map((task) => task.lineNumber), [1, 3]);
  assert.equal(fallback.file.tasks[0]?.title, "1.2: Do the thing"); // frozen default's narrower `id` group

  // minimalCustomAdapter (id + headingGrammar only, 001 FR-026 shape) still extracts.
  const minimal = parseTaskFile(
    PATH,
    ["## 1.1: Numeric heading", "", "- [ ] work item", ""].join("\n"),
    minimalCustomAdapter,
    cfg,
  );
  assert.deepEqual(
    minimal.file.tasks.map((task) => [task.kind, task.localTaskId ?? null]),
    [
      ["heading", "1.1"],
      ["checklist", null],
    ],
  );
});
