/**
 * T018 [US1] — exclusion-record and duplicate-warning unit tests.
 * FR-004 (verbatim): summary-section and rollup items excluded "per configured patterns,
 * recording each excluded item with its line number and an exclusion reason"; fenced
 * pseudo-tasks are silently non-tasks, NOT exclusions (research R6 + R4).
 * FR-007 (verbatim): warnings "identifying the shared value and all 1-based line numbers,
 * when tasks within one file share a local task ID or share an issue reference"; parsing
 * still succeeds (research R11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";

import { genericFixtureAdapter, readFixture, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "specs/auth/tasks.md";

function parse(fixture: string) {
  return parseTaskFile(PATH, readFixture(fixture), genericFixtureAdapter, cfg);
}

// ── FR-004 exclusions ───────────────────────────────────────────────────────────────

test("parsing exclusions — summary-section and rollup records carry line, kind, reason, text (FR-004)", () => {
  const result = parse("parsing/summary-rollup.md");
  assert.deepEqual(result.exclusions, [
    {
      lineNumber: 7,
      kind: "checklist",
      reason: "summary-section",
      text: "- [ ] Recap shipped endpoints",
    },
    {
      lineNumber: 8,
      kind: "checklist",
      reason: "summary-section",
      text: "  - [ ] Recap authentication work",
    },
    {
      lineNumber: 14,
      kind: "checklist",
      reason: "rollup",
      text: "- [ ] This line is the parent rollup for section 1",
    },
  ]);
  // Excluded lines NEVER appear in file.tasks (FR-004)
  for (const excluded of result.exclusions) {
    assert.ok(!result.file.tasks.some((task) => task.lineNumber === excluded.lineNumber));
  }
  assert.deepEqual(
    result.file.tasks.map((task) => task.lineNumber),
    [1, 3, 10, 12, 16],
  );
});

test("parsing exclusions — fenced pseudo-tasks are silently non-tasks, NOT exclusion records (R4/R6)", () => {
  const result = parse("parsing/fenced.md");
  assert.deepEqual(result.exclusions, []);
  assert.ok(result.file.tasks.length > 0);
});

test("parsing exclusions — summary section closes at the next heading of ≤ level", () => {
  const content = [
    "## 1.1: Ship", // 1
    "", // 2
    "## Summary", // 3
    "- [ ] recap", // 4 excluded
    "", // 5
    "### Deeper under summary", // 6 (level 3 > 2 → section stays open; heading matched as task? — grammar matches)
    "- [ ] still recap", // 7 excluded (section still open)
    "", // 8
    "## Wrap", // 9 closes the summary (level 2 ≤ 2)
    "- [ ] genuine task", // 10 extracted
    "",
  ].join("\n");
  const result = parseTaskFile(PATH, content, genericFixtureAdapter, cfg);
  assert.deepEqual(
    result.exclusions.map((ex) => [ex.lineNumber, ex.reason]),
    [
      [4, "summary-section"],
      [7, "summary-section"],
    ],
  );
  assert.ok(result.file.tasks.some((task) => task.lineNumber === 10));
});

// ── FR-007 duplicate warnings ───────────────────────────────────────────────────────

test("parsing warnings — duplicate local IDs and issue refs name the value and EVERY line, ascending (FR-007)", () => {
  const result = parse("parsing/dup-identities.md");
  assert.deepEqual(result.warnings, [
    { kind: "duplicate-local-id", value: "Task 2.1", lineNumbers: [1, 2] },
    { kind: "duplicate-issue-ref", value: "SYNC-42", lineNumbers: [1, 3, 4] },
  ]);
  // Warnings are additive: extraction still succeeds with every task present.
  assert.deepEqual(
    result.file.tasks.map((task) => task.lineNumber),
    [1, 2, 3, 4, 5],
  );
});

test("parsing warnings — no warnings when identities are unique or absent; kind order is deterministic", () => {
  for (const fixture of ["parsing/nested.md", "parsing/fenced.md", "parsing/summary-rollup.md"]) {
    assert.deepEqual(parse(fixture).warnings, [], fixture);
  }
  const both = parseTaskFile(
    PATH,
    [
      "- [ ] 2.2: second dup [SYNC-2]", // 1
      "- [ ] 2.2: first dup", // 2
      "- [ ] 1.1: only bearer [SYNC-1]", // 3
      "- [ ] 1.1: dup too [SYNC-1]", // 4
      "- [ ] [SYNC-2] also shared ref", // 5
      "",
    ].join("\n"),
    genericFixtureAdapter,
    cfg,
  );
  // Deterministic: kind vocabulary order first, then shared value ascending; lines ascending.
  assert.deepEqual(both.warnings, [
    { kind: "duplicate-local-id", value: "1.1", lineNumbers: [3, 4] },
    { kind: "duplicate-local-id", value: "2.2", lineNumbers: [1, 2] },
    { kind: "duplicate-issue-ref", value: "SYNC-1", lineNumbers: [3, 4] },
    { kind: "duplicate-issue-ref", value: "SYNC-2", lineNumbers: [1, 5] },
  ]);
});

test("parsing warnings — heading and checklist tasks pool together for duplicate detection (R11)", () => {
  const result = parseTaskFile(
    PATH,
    ["## 2.1: Heading owner [SYNC-8]", "", "- [ ] 2.1: Checklist sharer [SYNC-8]", ""].join("\n"),
    genericFixtureAdapter,
    cfg,
  );
  assert.deepEqual(result.warnings, [
    { kind: "duplicate-local-id", value: "2.1", lineNumbers: [1, 3] },
    { kind: "duplicate-issue-ref", value: "SYNC-8", lineNumbers: [1, 3] },
  ]);
});
