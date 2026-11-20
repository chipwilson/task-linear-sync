/**
 * T006 [US1] — Kiro "Implementation Plan" task-file splitting unit test (feature 021;
 * research R9.2; contracts/kiro-plan-parsing.md rules C4/C5/C8, "Reported-file
 * conformance"; data-model §1–§4).
 *
 * Parses `tests/fixtures/parsing/kiro-plan/tasks.md` (one `# Implementation Plan`
 * level-1 title heading + thirteen column-0 `- [x] N.` checklist tasks) through the two
 * default-grammar fixture adapters at the SHIPPED DEFAULT config — `makeTestConfig()`
 * with NO overrides is deliberate: the shipped `maxTaskIssueDepth: 1` default MUST be
 * exercised, so every surviving checklist task proves depth 1 under the document-title
 * heading rule (C1/C2). Encodes the POST-fix expectations: per-task bodies (C4), zero
 * `depth-folded` exclusions (C5), separator-free dotted-id capture (C7) and
 * kiro/generic classification parity (C8, FR-008).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult, TaskFileAdapter } from "task-linear-sync/parsing";

import { kiroFixtureAdapter, genericFixtureAdapter, makeTestConfig, readFixture } from "../helpers/parsing-fixtures.js";

const CONTENT = readFixture("parsing/kiro-plan/tasks.md");
const KIRO_PATH = ".kiro/specs/auth/tasks.md";
const GENERIC_PATH = "docs/auth/tasks.md";

/** Default config ON PURPOSE: the shipped maxTaskIssueDepth 1 default stays un-overridden. */
function parseKiroPlan(adapter: TaskFileAdapter, virtualPath: string): ParseResult {
  return parseTaskFile(virtualPath, CONTENT, adapter, makeTestConfig());
}

/** The 13 column-0 checklist lines, verified against the fixture via grep '^- \[x\]'. */
const CHECKLIST_LINES: readonly number[] = [3, 9, 15, 22, 23, 30, 37, 44, 52, 59, 65, 72, 79];

/** In line order: dotted ids capture separator-free (C7); the bare integers keep their dot. */
const EXPECTED: readonly { line: number; id: string; title: string }[] = [
  { line: 3, id: "1", title: "Set up project structure and dependencies" },
  { line: 9, id: "2", title: "Implement configuration management module" },
  { line: 15, id: "3", title: "Implement logging module" },
  { line: 22, id: "4", title: "Implement EC2 service module" },
  { line: 23, id: "4.1", title: "Create EC2 client wrapper with retry logic" },
  { line: 30, id: "4.2", title: "Implement instance discovery functionality" },
  { line: 37, id: "4.3", title: "Implement instance shutdown functionality" },
  { line: 44, id: "5", title: "Implement main Lambda handler" },
  { line: 52, id: "6", title: "Implement error handling and response formatting" },
  { line: 59, id: "7", title: "Create IAM policy and deployment configuration" },
  { line: 65, id: "8", title: "Write integration tests" },
  { line: 72, id: "9", title: "Add comprehensive error handling tests" },
  { line: 79, id: "10", title: "Create deployment and monitoring setup" },
];

/**
 * The shared extraction oracle (contract "Reported-file conformance" § default config):
 * 14 drafts — 13 depth-1 checklist tasks + the title heading; zero fold artifacts.
 */
function assertKiroPlanExtraction(result: ParseResult, label: string): void {
  const { tasks } = result.file;

  // 14 task drafts = 13 checklist tasks + 1 heading task at line 1.
  assert.equal(tasks.length, 14, `draft count under ${label}`);
  assert.deepEqual(tasks.map((task) => task.lineNumber), [1, ...CHECKLIST_LINES], `ascending draft lines under ${label}`);
  assert.deepEqual(
    tasks.filter((task) => task.kind === "checklist").map((task) => task.lineNumber),
    CHECKLIST_LINES,
    `checklist lines under ${label}`,
  );
  assert.deepEqual(
    tasks.filter((task) => task.kind === "heading").map((task) => task.lineNumber),
    [1],
    `heading lines under ${label}`,
  );

  const byLine = new Map(tasks.map((task) => [task.lineNumber, task]));

  // The 13 checklist tasks: own id (C7), own title with the id stripped, checked state.
  assert.deepEqual(
    tasks.filter((task) => task.kind === "checklist").map((task) => task.localTaskId),
    EXPECTED.map((task) => task.id),
    `local ids in line order under ${label}`,
  );
  for (const expected of EXPECTED) {
    const task = byLine.get(expected.line);
    assert.ok(task, `task at line ${String(expected.line)} under ${label}`);
    assert.equal(task.kind, "checklist", `kind at line ${String(expected.line)} under ${label}`);
    assert.equal(task.localTaskId, expected.id, `localTaskId at line ${String(expected.line)} under ${label}`);
    assert.equal(task.title, expected.title, `title at line ${String(expected.line)} under ${label}`);
    assert.equal(task.checked, true, `checked at line ${String(expected.line)} under ${label}`);
    // Depth 1 (C2): the title heading adopts nothing, so every checklist survives cap 1
    // parentless with no child links — exactly what "depth 1" proves at default config.
    assert.ok(!("parentUuid" in task), `parentUuid must be ABSENT at line ${String(expected.line)} under ${label}`);
    assert.deepEqual(task.childUuids, [], `childUuids empty at line ${String(expected.line)} under ${label}`);
  }

  // The document-title heading (C1/C6): full text, digit-less word form yields NO id.
  const heading = byLine.get(1);
  assert.ok(heading, `heading draft at line 1 under ${label}`);
  assert.equal(heading.kind, "heading");
  assert.ok(!("localTaskId" in heading), "title heading must NOT capture a localTaskId");
  assert.equal(heading.localTaskId, undefined, "title heading localTaskId undefined");
  assert.equal(heading.title, "Implementation Plan", "title is the FULL heading text, not 'Plan' (C6 edge case)");
}

test("kiro plan — kiro classification at default config splits the title-headed plan into 14 tasks (C4/C5/C7, T006)", () => {
  const result = parseKiroPlan(kiroFixtureAdapter, KIRO_PATH);
  assertKiroPlanExtraction(result, "kiro");
  assert.equal(result.featureName, "auth", "ParseResult featureName (FR-008)");
  assert.equal(result.file.featureName, "auth", "TaskFile featureName (FR-008)");
});

test("kiro plan — generic classification extracts identically; kiro/generic parity (C8, FR-008)", () => {
  const viaKiro = parseKiroPlan(kiroFixtureAdapter, KIRO_PATH);
  const viaGeneric = parseKiroPlan(genericFixtureAdapter, GENERIC_PATH);
  assertKiroPlanExtraction(viaGeneric, "generic");

  assert.equal(viaGeneric.featureName, "auth", "generic ParseResult featureName (FR-008)");
  assert.equal(viaGeneric.file.featureName, "auth", "generic TaskFile featureName (FR-008)");

  // C8 parity: filePath/frameworkId/stableUuid legitimately differ between the two virtual
  // paths, so deep-compare a normalized structural view of tasks + exclusions instead.
  const normalizedView = (result: ParseResult) => ({
    tasks: result.file.tasks.map((task) => [
      task.lineNumber,
      task.kind,
      task.localTaskId ?? null,
      task.title,
      task.checked ?? null,
      task.taskBody.startLine,
      task.taskBody.endLine,
      task.parentUuid !== undefined,
    ]),
    exclusions: result.exclusions.map((record) => [record.lineNumber, record.kind, record.reason]),
  });
  assert.deepEqual(normalizedView(viaKiro), normalizedView(viaGeneric), "kiro/generic extraction must be identical (C8)");
});

test("kiro plan — default cap 1 folds nothing: exclusions, conflict blocks and warnings all empty (C5)", () => {
  for (const result of [parseKiroPlan(kiroFixtureAdapter, KIRO_PATH), parseKiroPlan(genericFixtureAdapter, GENERIC_PATH)]) {
    // Ordered before the emptiness pin: `deepEqual(..., [])` narrows the array to
    // `never[]` under strict asserts, which would strand the typed `reason` access.
    assert.equal(result.exclusions.filter((record) => record.reason === "depth-folded").length, 0, "zero depth-folded exclusions (C5)");
    assert.deepEqual(result.exclusions, [], "no summary-section, no rollup and ZERO depth-folded records (C5)");
    assert.deepEqual(result.conflictBlocks, []);
    assert.deepEqual(result.warnings, []);
  }
});

test("kiro plan — repeat-parse deep-equality determinism pin (Principle IV)", () => {
  const first = parseKiroPlan(kiroFixtureAdapter, KIRO_PATH);
  const second = parseKiroPlan(kiroFixtureAdapter, KIRO_PATH);
  assert.deepEqual(second, first, "identical inputs must produce field-for-field identical ParseResults");
});
