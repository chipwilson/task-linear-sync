/**
 * T015 [P] [US1] — marker-synthesis unit tests (research R4;
 * contracts/conflict-resolution-matrix.md §2 `overwrite-spec` row + §4 frozen rule;
 * data-model §5 `render-file`; implementation T022 in `src/engine/markers.ts`).
 *
 * Pinned contract for T022 (each bullet is asserted below):
 * - Exact block format (R4), marker lines at column 0, separator exactly seven `=`:
 *     `<<<<<<< <toolId>:local <filePath>#L<line>`
 *     <local content, verbatim lines>
 *     `=======`
 *     <tracker content, verbatim lines>
 *     `>>>>>>> <toolId>:linear <ISSUE-KEY>`
 *   The returned block carries NO trailing newline and no padding blank lines — it is a
 *   section-BODY replacement (data-model §5 `render-file` splices it where the body was;
 *   the 004 line model supplies terminators, so the block itself is body text only).
 *   Inputs are embedded verbatim with their lines directly adjacent to the marker lines;
 *   callers pass section bodies without a trailing newline.
 * - Labels derive from the configured `toolId` + the issue reference ONLY (parameterized:
 *   `task-sync` vs `task-linear-sync` vs an override) — never from any UUID
 *   (Principle II: no identity in descriptions or files).
 * - Output is structurally compatible with 004: fed through `splitLines` +
 *   `scanConflictBlocks` it yields EXACTLY ONE `ConflictBlock` spanning the block's first
 *   and last line, and `frozenLineSet` covers every block line (the whole section body)
 *   while freezing nothing outside it (R4 "one authority for what a conflict block is").
 * - Nested-block refusal (matrix §4): when either embedded side already contains a
 *   conflict block — as 004 defines one, fence-aware, so a fenced marker EXAMPLE is not a
 *   block — synthesis throws `EngineError`. No nested markers, ever.
 *
 * Red until T022 lands: every call hits `not implemented: markers`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { frozenLineSet, scanConflictBlocks, splitLines } from "task-linear-sync/parsing";
import { syntheticUuid } from "task-linear-sync/tracker/testing";

import { EngineError } from "../../src/engine/errors.js";
import type { ConflictMarkerInput } from "../../src/engine/markers.js";
import { synthesizeConflictMarkerBlock } from "../../src/engine/markers.js";

/** tabWidth is irrelevant to the 004 conflict scan (marker regexes are column-0); 4 = default. */
const TAB_WIDTH = 4;

// ──────────────────────────────────────────────────────────────── builders

/** Realistic default input: placeholder path/key only — zero org literals (Principle III). */
function baseInput(overrides: Partial<ConflictMarkerInput> = {}): ConflictMarkerInput {
  return {
    toolId: "task-sync",
    filePath: "tasks/integration.md",
    taskLine: 12,
    issueKey: "SYNC-42",
    localContent: "Local body.",
    trackerContent: "Tracker body.",
    ...overrides,
  };
}

/** A markdown task file whose `## 1.1` section body is `block` (column 0, like 004 fixtures). */
function taskFileWithBlock(block: string): string {
  return [
    "# Task Backlog",
    "",
    "## 1.0: Keep",
    "",
    "- [ ] Untouched task [SYNC-42]",
    "",
    "## 1.1: Sync auth flow",
    "",
    block,
    "",
    "## 1.2: Wire logging",
    "",
    "- [ ] Other task [OPS-7]",
    "",
  ].join("\n");
}

/** An already-frozen section body: it embeds a complete prior conflict block (matrix §4). */
const FROZEN_SECTION_BODY = [
  "Body before.",
  "",
  "<<<<<<< task-sync:local tasks/integration.md#L9",
  "Old local body.",
  "=======",
  "Old tracker body.",
  ">>>>>>> task-sync:linear SYNC-42",
  "",
  "Body after.",
].join("\n");

// ──────────────────────────────────────────────────────────────── format

test("engine-markers — synthesized block matches the R4 format exactly (golden)", () => {
  const block = synthesizeConflictMarkerBlock(baseInput());
  assert.equal(
    block,
    [
      "<<<<<<< task-sync:local tasks/integration.md#L12",
      "Local body.",
      "=======",
      "Tracker body.",
      ">>>>>>> task-sync:linear SYNC-42",
    ].join("\n"),
  );
  // Section-body replacement: the block is bare body text — no trailing newline, no CR.
  assert.ok(!block.endsWith("\n"), "block must not end with a newline (renderer supplies terminators)");
  assert.ok(!block.includes("\r"), "block must not contain carriage returns");
});

test("engine-markers — local content then tracker content embedded verbatim, no padding", () => {
  const localContent = "## Notes\n\nKeep the retry table.\nSecond body line.";
  const trackerContent = "Tracker paragraph.\n\nTracker bullet: - done";
  const block = synthesizeConflictMarkerBlock(baseInput({ localContent, trackerContent }));

  const lines = block.split("\n");
  const separators = lines.map((text, i) => [text, i] as const).filter(([text]) => text === "=======");
  assert.equal(separators.length, 1, "exactly one seven-`=` separator line (R4 format)");
  const sepIndex = separators[0]?.[1];
  assert.ok(sepIndex !== undefined);

  // Content sides sit DIRECTLY between the marker lines: no inserted blank lines, verbatim.
  assert.deepEqual(lines.slice(1, sepIndex), localContent.split("\n"));
  assert.deepEqual(lines.slice(sepIndex + 1, lines.length - 1), trackerContent.split("\n"));
  // Exactly one opening and one closing marker line — the block is not nested in itself.
  assert.equal(lines.filter((text) => /^<{7}/u.test(text)).length, 1);
  assert.equal(lines.filter((text) => /^>{7}/u.test(text)).length, 1);
});

// ──────────────────────────────────────────────────────────────── labels

test("engine-markers — labels derive from configured toolId + issue reference (parameterized)", () => {
  const cases = [
    { toolId: "task-sync", issueKey: "SYNC-42", taskLine: 1, filePath: "tasks/a.md" },
    { toolId: "task-linear-sync", issueKey: "OPS-107", taskLine: 12, filePath: "tasks/integration.md" },
    { toolId: "override-tool", issueKey: "PLAT-7", taskLine: 428, filePath: "docs/deep/nested/b.md" },
  ] as const;
  const middles = new Set<string>();
  for (const c of cases) {
    const block = synthesizeConflictMarkerBlock(baseInput(c));
    const lines = block.split("\n");
    assert.equal(lines[0], `<<<<<<< ${c.toolId}:local ${c.filePath}#L${c.taskLine}`);
    assert.equal(lines.at(-1), `>>>>>>> ${c.toolId}:linear ${c.issueKey}`);
    // Foreign toolIds must not leak into either label (labels are READ from input, not baked).
    for (const other of cases) {
      if (other.toolId === c.toolId) continue;
      assert.ok(!block.includes(`${other.toolId}:`), `label leaked foreign toolId ${other.toolId}`);
    }
    // Only labels vary with toolId — the embedded content sides are untouched.
    middles.add(lines.slice(1, -1).join("\n"));
  }
  assert.equal(middles.size, 1, "content sides must be identical across label variants");
});

test("engine-markers — output never contains a task UUID (Principle II)", () => {
  const taskUuid = syntheticUuid(42); // deterministic placeholder identity (Principle III)
  const block = synthesizeConflictMarkerBlock(baseInput());
  assert.ok(!block.includes(taskUuid), "marker text must never carry a task UUID");
  assert.doesNotMatch(
    block,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    "marker text must contain nothing UUID-shaped (labels carry toolId + filePath + issue key only)",
  );
  for (const label of [block.split("\n")[0] ?? "", block.split("\n").at(-1) ?? ""]) {
    assert.ok(!label.toLowerCase().includes("uuid"), "labels carry no identity vocabulary");
    assert.ok(label.includes("task-sync"), "labels remain toolId-derived (self-describing for a human resolver)");
  }
});

// ────────────────────────────────────────────────────── 004 compatibility

test("engine-markers — 004 scanConflictBlocks sees exactly one block around the synthesized section", () => {
  const bodies = [
    { local: "Local body.", tracker: "Tracker body." },
    { local: "## Notes\n\nKeep the retry table.", tracker: "Tracker paragraph.\n\nEnds here." },
    { local: "Single line.", tracker: "" }, // empty tracker side: still ONE block, never two
  ];
  for (const { local, tracker } of bodies) {
    const block = synthesizeConflictMarkerBlock(baseInput({ localContent: local, trackerContent: tracker }));
    const lines = splitLines(taskFileWithBlock(block), TAB_WIDTH);
    const open = lines.find((l) => l.text.startsWith("<<<<<<<"));
    const close = lines.find((l) => l.text.startsWith(">>>>>>>"));
    assert.ok(open && close, "fixture must place the synthesized block");
    assert.deepEqual(scanConflictBlocks(lines), [{ startLine: open.number, endLine: close.number }]);
  }
});

test("engine-markers — 004 frozenLineSet covers the whole section body and freezes nothing outside", () => {
  const block = synthesizeConflictMarkerBlock(
    baseInput({ localContent: "Local one.\n\nLocal two.", trackerContent: "Tracker one.\nTracker two." }),
  );
  const lines = splitLines(taskFileWithBlock(block), TAB_WIDTH);
  const open = lines.find((l) => l.text.startsWith("<<<<<<<"));
  const close = lines.find((l) => l.text.startsWith(">>>>>>>"));
  assert.ok(open && close);
  const frozen = frozenLineSet(scanConflictBlocks(lines));

  // Every block line — open marker, both content sides (blank interior lines included),
  // separator, close marker — is in the freeze set (FR-012 byte-for-byte protection).
  const expected = new Set<number>();
  for (let n = open.number; n <= close.number; n++) expected.add(n);
  assert.deepEqual([...frozen].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
  // Nothing outside freezes: a malformed closing label would smear the freeze to EOF.
  for (const line of lines) {
    if (line.number < open.number || line.number > close.number) {
      assert.ok(!frozen.has(line.number), `line ${line.number} ("${line.text}") must not be frozen`);
    }
  }
});

// ──────────────────────────────────────────────────────── nested refusal

test("engine-markers — synthesis into content already containing a conflict block is refused (no nesting)", () => {
  const loneOpen = "Stray text.\n\n<<<<<<< task-sync:local tasks/integration.md#L3\nAfter.";
  const loneClose = "Stray text.\n\n>>>>>>> task-sync:linear SYNC-42\nAfter.";
  const cases: Array<[message: string, overrides: Partial<ConflictMarkerInput>]> = [
    ["frozen section body in localContent", { localContent: FROZEN_SECTION_BODY }],
    ["prior markers quoted in trackerContent", { trackerContent: FROZEN_SECTION_BODY }],
    ["stray opening marker in localContent", { localContent: loneOpen }],
    ["stray closing marker in trackerContent", { trackerContent: loneClose }],
    ["blocks on both sides", { localContent: FROZEN_SECTION_BODY, trackerContent: FROZEN_SECTION_BODY }],
  ];
  for (const [message, overrides] of cases) {
    assert.throws(
      () => synthesizeConflictMarkerBlock(baseInput(overrides)),
      EngineError,
      `nested-marker synthesis must throw EngineError: ${message}`,
    );
  }
});

test("engine-markers — a FENCED marker example in content is not a block and must not be refused", () => {
  // R4 keeps 004 the single authority for "what is a conflict block" — and 004's scan is
  // fence-aware ("markers inside fenced regions are never blocks"). Refusing this content
  // would fabricate a frozen section out of a documentation example.
  const fencedDoc = [
    "Setup example:",
    "",
    "```text",
    "<<<<<<< not-a-block",
    "=======",
    ">>>>>>> not-a-block",
    "```",
    "",
    "End.",
  ].join("\n");
  assert.deepEqual(scanConflictBlocks(splitLines(fencedDoc, TAB_WIDTH)), []); // 004 authority, preflight
  const block = synthesizeConflictMarkerBlock(baseInput({ localContent: fencedDoc }));
  const lines = splitLines(taskFileWithBlock(block), TAB_WIDTH);
  const blocks = scanConflictBlocks(lines);
  assert.equal(blocks.length, 1, "the synthesized block only — the fenced example never scans as one");
});
