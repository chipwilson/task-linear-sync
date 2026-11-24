/**
 * T009 [023 A-023-2 primitives] — front-matter single-level LIST capture (feature
 * contract C2.1; data-model §1 "Roster"). The scan stays a line parser (zero YAML
 * dependency): a top-level key may carry a single-level list in BLOCK form (`- T001`
 * lines, indented or flush-left — both are measured upstream shapes) or FLOW form
 * (`[T001, T002]`). Scalar capture stays byte-identical (a flow value ALSO stays a
 * scalar string, exactly as 0.6.0 recorded it); nested map-style lists and other
 * structures stay ignored, exactly as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { scanFrontMatter } from "../../src/parsing/document.js";

const lines = (content: string | string[]): string[] => (Array.isArray(content) ? content : content.split("\n"));

test("front matter: block-list roster (indented `- T001` lines) captures as values with 1-based lines", () => {
  const scan = scanFrontMatter(lines([
    "---",
    "work_package_id: WP01",
    "subtasks:",
    "  - T001",
    "  - T002",
    "title: Auth",
    "---",
  ]))!;
  assert.ok(scan, "fence recognized");
  assert.deepEqual(scan.lists.subtasks, [
    { value: "T001", line: 4 },
    { value: "T002", line: 5 },
  ]);
  assert.deepEqual(scan.scalars, { work_package_id: "WP01", title: "Auth" }, "scalar capture unchanged");
});

test("front matter: flush-left block-list items capture (measured upstream `subtasks:\\n- T001` shape)", () => {
  const scan = scanFrontMatter(lines(["---", "subtasks:", "- T001", "- T002", "lane: planned", "---"]))!;
  assert.deepEqual(scan.lists.subtasks, [
    { value: "T001", line: 3 },
    { value: "T002", line: 4 },
  ]);
  assert.equal(scan.scalars.lane, "planned", "the scalar after the list is still read");
});

test("front matter: flow-list `[T003, T004]` captures as a list AND keeps the scalar byte-identically", () => {
  const scan = scanFrontMatter(lines(["---", "subtasks: [T003, T004]", "assignee: ops", "---"]))!;
  assert.deepEqual(scan.lists.subtasks, [
    { value: "T003", line: 2 },
    { value: "T004", line: 2 },
  ]);
  assert.equal(scan.scalars.subtasks, "[T003, T004]", "scalar capture stays exactly what 0.6.0 stored");
  assert.equal(scan.scalars.assignee, "ops");
});

test("front matter: empty flow list captures empty; quoted list items unwrap", () => {
  const scan = scanFrontMatter(lines(['---', 'subtasks: []', 'labels: ["a", "b"]', "---"]))!;
  assert.deepEqual(scan.lists.subtasks, []);
  assert.deepEqual(scan.lists.labels?.map((e) => e.value), ["a", "b"]);
});

test("front matter: nested map-style lists stay IGNORED (no list captured, scalars unchanged)", () => {
  const scan = scanFrontMatter(lines([
    "---",
    "assignees:",
    "  - name: ops",
    "    role: reviewer",
    "title: Real",
    "---",
  ]))!;
  assert.equal(scan.lists.assignees, undefined, "map-style items are not a single-level list");
  assert.deepEqual(scan.scalars, { title: "Real" });
});

test("front matter: an indented non-dash structure under a key opener stays IGNORED", () => {
  const scan = scanFrontMatter(lines(["---", "meta:", "  a: 1", "  b: 2", "title: Real", "---"]))!;
  assert.equal(scan.lists.meta, undefined);
  assert.equal(scan.lists.a, undefined, "indented key/value lines are never top-level keys");
  assert.deepEqual(scan.scalars, { title: "Real" });
});

test("front matter: scalars-only documents behave EXACTLY as 0.6.0 (byte-identity pin)", () => {
  const scan = scanFrontMatter(lines([
    "---",
    "work_package_id: WP01",
    "dependencies:",
    "  - research.md",
    "key: 'Quoted Value'",
    "  key: indented-not-top-level",
    "# comment",
    "title: Scaffold",
    "...",
  ]))!;
  assert.deepEqual(scan.scalars, { work_package_id: "WP01", key: "Quoted Value", title: "Scaffold" });
  assert.equal(scan.closingLine, 9);
  // Block lists under ANY key capture their plain scalar items — but nothing about the
  // scalar picture above changed, which is what byte-identity of the consumer means.
  assert.deepEqual(scan.lists.dependencies, [{ value: "research.md", line: 4 }]);
});

test("front matter: block list interrupted by a non-item line stops there (partial capture, deterministic)", () => {
  const scan = scanFrontMatter(lines(["---", "subtasks:", "  - T001", "", "lane: planned", "  - T099", "---"]))!;
  assert.deepEqual(scan.lists.subtasks, [{ value: "T001", line: 3 }], "the list stops at `lane:`");
  assert.equal(scan.lists.T099, undefined, "the orphan dash never becomes a list");
});
