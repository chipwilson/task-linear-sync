/**
 * T024/T026/T030/T034 [US1/US2/US3] — task-depth folding unit matrices
 * (feature 020; contracts/depth-folding.md rules C1–C6; data-model invariants
 * I1–I6; Maintainer Ruling 2026-11-18: built-in default 1 — flat board;
 * explicit 64 = effectively unlimited escape hatch).
 *
 * Pure unit tier: content strings in, ParseResult out — zero I/O except the
 * config-file layering block (loadConfig needs a real file, 002 precedent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTaskFile, TaskDepthConfigError } from "task-linear-sync/parsing";
import type { ParseResult } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";
import { loadConfig } from "task-linear-sync/config";

import { genericFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const PATH = "specs/demo/tasks.md";

/** Parse `content` at the given cap; `undefined` = ABSENT key (built-in default 1). */
function parseDoc(content: string, cap?: number): ParseResult {
  const config = cap === undefined ? makeTestConfig() : makeTestConfig({ maxTaskIssueDepth: cap });
  return parseTaskFile(PATH, content, genericFixtureAdapter, config);
}

/** One structural summary row so matrices read as tables. */
function shape(r: ParseResult): { tasks: number; parented: number; folded: number } {
  return {
    tasks: r.file.tasks.length,
    parented: r.file.tasks.filter((t) => t.parentUuid !== undefined).length,
    folded: r.exclusions.filter((e) => e.reason === "depth-folded").length,
  };
}

const foldedRecords = (r: ParseResult) => r.exclusions.filter((e) => e.reason === "depth-folded");

function byLine(r: ParseResult): Map<number, Task> {
  return new Map(r.file.tasks.map((t) => [t.lineNumber, t]));
}

/** Quickstart Scenario-1 fixture (specs/020-task-depth-folding/quickstart.md). */
const QUICKSTART = [
  "- [ ] T001 Top task", // 1 — depth 1
  "", // 2
  "  - [ ] T001a nested detail", // 3 — depth 2
  "    - [ ] T001a-i deeper detail", // 4 — depth 3
  "", // 5
  "## T100 Epic heading", // 6 — heading, depth 1
  "", // 7
  "- [ ] T100a checklist orphaned under the heading", // 8 — depth 2 (orphan rule)
  "",
].join("\n");

/** Five-level indent chain, depths 1..5 on lines 1..5. */
const DEEP_CHAIN = [
  "- [ ] 1.0: L1 root",
  "  - [ ] 1.1: L2 child",
  "    - [ ] 1.2: L3 grandchild",
  "      - [ ] 1.3: L4 great",
  "        - [ ] 1.4: L5 deepest",
  "",
].join("\n");

/** Subtree test: C (d3) folds together with its whole subtree (D, d4); E stays. */
const SUBTREE = [
  "- [ ] 1.0: A top", // 1 — d1
  "  - [ ] 1.1: B keep", // 2 — d2
  "    - [ ] 1.2: C fold", // 3 — d3
  "      - [ ] 1.3: D fold deep", // 4 — d4 (child of C)
  "  - [ ] 1.4: E sibling keep", // 5 — d2
  "",
].join("\n");

// ── Depth matrix (C2) ───────────────────────────────────────────────────────────────

test("parsing depth — headings are 1, indent nesting walks up, orphan-under-heading is 2 (C2)", () => {
  const doc = [
    "## 1.0: Epic heading task", // 1 — heading = depth 1
    "- [ ] 1.1: orphaned under the heading", // 2 — depth 2 (heading IS the parent)
    "  - [ ] 1.1.1: nested under the orphan", // 3 — depth 3
    "",
  ].join("\n");
  // Cap 2 reveals the depth ladder: only depth ≤ 2 survives.
  const at2 = parseDoc(doc, 2);
  assert.deepEqual(at2.file.tasks.map((t) => t.lineNumber), [1, 2], "depth-3 line folds at cap 2");
  assert.deepEqual(foldedRecords(at2).map((e) => e.lineNumber), [3]);
  // Cap 1 flattens everything below the heading — the orphan rule makes line 2 depth 2.
  const at1 = parseDoc(doc, 1);
  assert.deepEqual(at1.file.tasks.map((t) => t.lineNumber), [1], "heading can NEVER fold (always depth 1)");
  assert.deepEqual(foldedRecords(at1).map((e) => e.lineNumber), [2, 3]);
});

test("parsing depth — tab-indented nesting matches its space twin at every cap (C2, tabWidth 2)", () => {
  const spaces = [
    "- [ ] 1.0: root",
    "  - [ ] 1.1: child",
    "    - [ ] 1.2: grandchild",
    "",
  ].join("\n");
  const tabs = ["- [ ] 1.0: root", "\t- [ ] 1.1: child", "\t\t- [ ] 1.2: grandchild", ""].join("\n");
  for (const cap of [1, 2, 3, 64] as const) {
    assert.deepEqual(shape(parseDoc(spaces, cap)), shape(parseDoc(tabs, cap)), `tab/space twins diverge at cap ${String(cap)}`);
  }
  assert.deepEqual(shape(parseDoc(tabs)), { tasks: 1, parented: 0, folded: 2 }, "tab doc at default cap 1 folds two levels");
});

test("parsing depth — deep chains (5 levels) resolve the full ladder cap by cap (C2/C3)", () => {
  const expected: Array<[number, number]> = [
    [1, 4], // folds 2..5
    [2, 3], // folds 3..5
    [3, 2], // folds 4..5 — user-requested depth-3 configuration
    [4, 1], // folds 5 only
    [5, 0],
    [64, 0],
  ];
  for (const [cap, folded] of expected) {
    const r = parseDoc(DEEP_CHAIN, cap);
    assert.equal(foldedRecords(r).length, folded, `cap ${String(cap)}`);
    assert.equal(r.file.tasks.length, 5 - folded);
    const survivors = r.file.tasks.map((t) => t.lineNumber);
    assert.deepEqual(survivors, Array.from({ length: 5 - folded }, (_, i) => i + 1), `cap ${String(cap)} survivors are the shallow prefix`);
  }
});

// ── Fold matrix (C3) ────────────────────────────────────────────────────────────────

test("parsing fold — quickstart fixture yields the ruled posture at every cap (C1/C3, quickstart Scenario 1)", () => {
  assert.deepEqual(shape(parseDoc(QUICKSTART)), { tasks: 2, parented: 0, folded: 3 }, "absent ⇒ built-in default 1 ⇒ flat board");
  assert.deepEqual(shape(parseDoc(QUICKSTART, 1)), { tasks: 2, parented: 0, folded: 3 });
  assert.deepEqual(shape(parseDoc(QUICKSTART, 2)), { tasks: 4, parented: 2, folded: 1 });
  assert.deepEqual(shape(parseDoc(QUICKSTART, 3)), { tasks: 5, parented: 3, folded: 0 }, "three-level fixture: cap 3 keeps everything");
  assert.deepEqual(shape(parseDoc(QUICKSTART, 64)), { tasks: 5, parented: 3, folded: 0 }, "explicit 64 = pre-feature behavior");
});

test("parsing fold — cap 1 invariant: zero surviving tasks carry parentUuid (C3 flat-board corollary)", () => {
  for (const doc of [QUICKSTART, DEEP_CHAIN, SUBTREE]) {
    for (const cap of [undefined, 1] as const) {
      const r = parseDoc(doc, cap);
      assert.equal(r.file.tasks.filter((t) => t.parentUuid !== undefined).length, 0, `parentUuid leaked at cap ${String(cap)}`);
      for (const t of r.file.tasks) assert.deepEqual(t.childUuids, [], "no child links at a flat board");
    }
  }
});

test("parsing fold — whole subtrees fold by monotone inheritance; siblings stay (C3, US2 AC2 shape)", () => {
  const r = parseDoc(SUBTREE, 2);
  assert.deepEqual(r.file.tasks.map((t) => t.lineNumber), [1, 2, 5]);
  assert.deepEqual(foldedRecords(r).map((e) => e.lineNumber), [3, 4], "C and its child D fold as a unit");
  const t = byLine(r);
  assert.ok(t.get(2)?.parentUuid !== undefined, "B keeps its parent link to A at cap 2");
  assert.ok(t.get(5)?.parentUuid !== undefined, "E keeps its parent link to A at cap 2");
});

test("parsing fold — cap 1 on an only-depth-1 file changes nothing versus 64 (edge case)", () => {
  const flat = ["- [ ] 1.0: alpha", "- [ ] 1.1: beta", "- [ ] 1.2: gamma", ""].join("\n");
  const at1 = parseDoc(flat, 1);
  assert.deepEqual(at1.exclusions, [], "no fold exclusions");
  assert.equal(at1.file.tasks.length, parseDoc(flat, 64).file.tasks.length);
});

// ── Exclusion fidelity + precedence (C5) ────────────────────────────────────────────

test("parsing fold exclusions — exactly the over-cap drafts, ascending, one record each, verbatim text (C5/I5)", () => {
  const r = parseDoc(QUICKSTART, 1);
  const records = foldedRecords(r);
  assert.deepEqual(records.map((e) => e.lineNumber), [3, 4, 8], "ascending, one per folded draft");
  for (const e of records) {
    assert.equal(e.kind, "checklist");
    assert.equal(e.reason, "depth-folded");
  }
  const sourceLines = QUICKSTART.split("\n");
  assert.deepEqual(records.map((e) => e.text), [sourceLines[2], sourceLines[3], sourceLines[7]], "text = the draft's line, byte-for-byte");
});

test("parsing fold exclusions — fenced-interior checkboxes never draft and never fold (C5 precedence)", () => {
  const doc = [
    "- [ ] 1.0: real task", // 1
    "  - [ ] 1.1: nested folds at cap 1", // 2
    "", // 3
    "```md", // 4
    "  - [ ] 1.2: fake task inside a fence", // 5
    "```", // 6
    "",
  ].join("\n");
  const r = parseDoc(doc, 1);
  assert.deepEqual(foldedRecords(r).map((e) => e.lineNumber), [2], "only the real nested draft folds");
  assert.equal(r.exclusions.filter((e) => e.lineNumber === 5).length, 0, "fence interior is body text, never an exclusion");
});

test("parsing fold exclusions — conflict-frozen lines are never folded (C5 precedence)", () => {
  const doc = [
    "- [ ] 1.0: outer task", // 1 — d1
    "  - [ ] 1.1: folds", // 2 — d2, over cap
    "<<<<<<< HEAD", // 3
    "  - [ ] 1.2: frozen over-cap line", // 4 — frozen, over cap if it drafted
    "=======", // 5
    "  - [ ] 1.3: frozen twin", // 6
    ">>>>>>> main", // 7
    "",
  ].join("\n");
  const r = parseDoc(doc, 1);
  assert.ok(r.conflictBlocks.length === 1, "fixture builds a conflict block");
  assert.deepEqual(foldedRecords(r).map((e) => e.lineNumber), [2], "frozen interior lines never reach the fold");
});

test("parsing fold exclusions — summary-section and rollup win over depth-folded at any depth (C5 precedence)", () => {
  const doc = [
    "- [ ] 1.0: root", // 1
    "  - [ ] 1.1: level two", // 2
    "    - [ ] 1.2: mentions the word parent at depth 3", // 3 — rollup pattern, over cap
    "",
    "## Summary", // 5
    "- [ ] 1.3: checkbox inside the summary section", // 6 — summary wins even at depth 2
    "",
  ].join("\n");
  const r = parseDoc(doc, 2);
  const byReason = new Map(r.exclusions.map((e) => [e.lineNumber, e.reason]));
  assert.equal(byReason.get(3), "rollup", "grammar exclusion decided BEFORE depth (line 3)");
  assert.equal(byReason.get(6), "summary-section", "summary section decided BEFORE depth (line 6)");
  assert.equal(foldedRecords(r).length, 0, "no double records: grammar exclusions never also fold");
});

// ── Verbatim body + span invariance (C4/I3) ─────────────────────────────────────────

test("parsing fold — Task_Body spans are cap-invariant and folded lines ride verbatim (C4/I3)", () => {
  const spans = [undefined, 1, 2, 3, 64].map((cap) => byLine(parseDoc(QUICKSTART, cap)).get(1)?.taskBody);
  for (const span of spans) assert.deepEqual(span, { startLine: 1, endLine: 4 }, "T001 span identical at every cap");
  const lines = QUICKSTART.split("\n");
  for (const cap of [undefined, 1] as const) {
    const r = parseDoc(QUICKSTART, cap);
    for (const rec of foldedRecords(r)) {
      // The folded line sits inside some surviving task's body span, verbatim, in source order.
      const carrier = r.file.tasks.find((t) => t.taskBody.startLine <= rec.lineNumber && rec.lineNumber <= t.taskBody.endLine);
      assert.ok(carrier, `folded line ${String(rec.lineNumber)} has no surviving ancestor body`);
      const carrierBody = lines.slice(carrier.taskBody.startLine - 1, carrier.taskBody.endLine).join("\n");
      assert.ok(carrierBody.includes(rec.text), `folded line ${String(rec.lineNumber)} missing verbatim from ancestor body`);
    }
    const ordered = foldedRecords(r).map((e) => e.lineNumber);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), "folded lines sit in the bodies in source order");
  }
  // I4: folded lines are unassigned — no task exists at their line, so no token can be written.
  const flat = parseDoc(QUICKSTART, 1);
  for (const rec of foldedRecords(flat)) assert.ok(!byLine(flat).has(rec.lineNumber), "folded line is not a task");
});

test("parsing fold — a fully folded subtree rides whole and verbatim inside its surviving ancestor (US2 AC2)", () => {
  const r = parseDoc(SUBTREE, 2);
  const b = byLine(r).get(2);
  assert.ok(b);
  assert.deepEqual(b.taskBody, { startLine: 2, endLine: 4 }, "B's body spans C and D — the whole folded subtree");
  const lines = SUBTREE.split("\n");
  const body = lines.slice(1, 4).join("\n");
  assert.ok(body.includes(lines[2] as string) && body.includes(lines[3] as string), "C and D verbatim, in source order");
});

// ── Default posture (C1) — T026 ─────────────────────────────────────────────────────

test("parsing config — maxTaskIssueDepth ships default 1 and layers file → programmatic (C1)", () => {
  assert.equal(loadConfig({}).maxTaskIssueDepth, 1, "built-in default is the flat board");
  const dir = mkdtempSync(join(tmpdir(), "tls-depth-cfg-"));
  try {
    const file = join(dir, "task-linear-sync.json");
    writeFileSync(file, JSON.stringify({ maxTaskIssueDepth: 2 }), "utf8");
    assert.equal(loadConfig({ configFile: file }).maxTaskIssueDepth, 2, "file layer overrides");
    assert.equal(
      loadConfig({ configFile: file, overrides: { maxTaskIssueDepth: 3 } }).maxTaskIssueDepth,
      3,
      "programmatic wins over file (scalar replace)",
    );
    assert.equal(loadConfig({ overrides: { maxTaskIssueDepth: 64 } }).maxTaskIssueDepth, 64, "explicit escape hatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Cap 2 — two-level board (US2) — T030 ───────────────────────────────────────────

test("cap 2 — two-level board keeps epic+sub-task issues with parent links and folds depth-3 detail", () => {
  const doc = [
    "- [ ] 1.0: Epic level", // 1 — d1
    "  - [ ] 1.1: Sub-task level", // 2 — d2
    "    - [ ] 1.1.1: Implementation detail", // 3 — d3 folds
    "      - [ ] 1.1.2: Even deeper detail", // 4 — d4 folds with subtree
    "",
  ].join("\n");
  const r = parseDoc(doc, 2);
  assert.deepEqual(r.file.tasks.map((t) => t.lineNumber), [1, 2]);
  const t = byLine(r);
  assert.ok(t.get(1)?.parentUuid === undefined, "depth-1 task is unparented");
  assert.equal(t.get(2)?.parentUuid, t.get(1)?.stableUuid, "depth-2 task carries its depth-1 parent link");
  assert.deepEqual(t.get(1)?.childUuids, [t.get(2)?.stableUuid], "child links cover survivors only (folded C excluded)");
  assert.deepEqual(foldedRecords(r).map((e) => e.lineNumber), [3, 4], "depth-3 subtree folds whole, ascending");
});

// ── Cap 3 — three-level board (user-requested depth configuration) ─────────────────

test("cap 3 — three levels survive parented and only depth-4+ folds (depth-3 configuration)", () => {
  const r = parseDoc(DEEP_CHAIN, 3);
  assert.deepEqual(r.file.tasks.map((t) => t.lineNumber), [1, 2, 3]);
  const t = byLine(r);
  assert.equal(t.get(2)?.parentUuid, t.get(1)?.stableUuid);
  assert.equal(t.get(3)?.parentUuid, t.get(2)?.stableUuid);
  assert.deepEqual(foldedRecords(r).map((e) => e.lineNumber), [4, 5]);
  // Spans cap-invariant versus the escape hatch.
  const wide = parseDoc(DEEP_CHAIN, 64);
  for (const line of [1, 2, 3]) {
    assert.deepEqual(t.get(line)?.taskBody, byLine(wide).get(line)?.taskBody, `line ${String(line)} span drifted`);
  }
});

// ── Validation + refusal (C6) — T034 ───────────────────────────────────────────────

test("parsing validation — absent resolves to cap 1 and parses; integers 1/2/3/64 pass (C6)", () => {
  const absent = parseDoc(QUICKSTART); // must not throw
  assert.equal(absent.file.tasks.length, 2);
  for (const cap of [1, 2, 3, 64] as const) assert.doesNotThrow(() => parseDoc(QUICKSTART, cap));
});

test("parsing validation — every invalid cap refuses before any parsing work (C6, data-model § 9)", () => {
  const cases: Array<[unknown, "below-minimum" | "above-maximum" | "not-an-integer"]> = [
    [0, "below-minimum"],
    [-1, "below-minimum"],
    [1.5, "not-an-integer"],
    [NaN, "not-an-integer"],
    [Infinity, "not-an-integer"],
    ["1", "not-an-integer"],
    [null, "not-an-integer"],
    [{}, "not-an-integer"],
    [true, "not-an-integer"],
    [65, "above-maximum"],
  ];
  for (const [value, reason] of cases) {
    let caught: unknown;
    try {
      parseTaskFile(PATH, QUICKSTART, genericFixtureAdapter, makeTestConfig({ maxTaskIssueDepth: value as never }));
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof TaskDepthConfigError, `cap ${String(JSON.stringify(value))} must refuse`);
    assert.equal(caught.name, "TaskDepthConfigError");
    assert.equal(caught.key, "maxTaskIssueDepth");
    assert.equal(caught.reason, reason);
    assert.ok(caught.message.includes("maxTaskIssueDepth"), "message names the key");
    assert.ok(!caught.message.includes(PATH), "message carries no file paths (screening-safe)");
  }
});
