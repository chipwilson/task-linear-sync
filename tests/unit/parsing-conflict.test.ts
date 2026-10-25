/**
 * T009 [Foundational] — conflict-scan unit tests (research R7).
 * Markers: opening `^<{7,}`, separator `^={7,}(=.*)?$` "inside an open block", closing
 * `^>{7,}`; a complete span → `ConflictBlock { startLine, endLine }`; "an unterminated
 * opening marker extends the block to EOF (defensive freeze)"; the scan is fence-aware
 * (markers inside fences are not blocks); blocks never overlap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { splitLines, scanConflictBlocks, blocksIntersecting, frozenLineSet } from "task-linear-sync/parsing";

import { readFixture, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();

function conflictLines(content = readFixture("parsing/conflict.md")) {
  return splitLines(content, cfg.tabWidth);
}

test("parsing conflict — complete and unterminated blocks in conflict.md (exact spans)", () => {
  const lines = conflictLines();
  const blocks = scanConflictBlocks(lines);
  assert.deepEqual(blocks, [
    { startLine: 11, endLine: 15 }, // complete block inside the 1.1 section
    { startLine: 21, endLine: 23 }, // complete empty-sides block between tasks
    { startLine: 27, endLine: 30 }, // unterminated open → "extends the block to EOF (defensive freeze)"
  ]);
});

test("parsing conflict — blocks never overlap (ascending, disjoint spans)", () => {
  const blocks = scanConflictBlocks(conflictLines());
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const curr = blocks[i];
    assert.ok(prev && curr && prev.endLine < curr.startLine, "conflict blocks must not overlap");
  }
});

test("parsing conflict — markers inside a fenced region are not blocks (fence-aware)", () => {
  const lines = conflictLines(
    [
      "## 1.1: Keep",
      "",
      "```text",
      "<<<<<<< nope",
      "=======",
      ">>>>>>> nope",
      "```",
      "",
      "## 1.2: After",
      "",
    ].join("\n"),
  );
  assert.deepEqual(scanConflictBlocks(lines), []);
});

test("parsing conflict — bare marker forms with 7+ repetitions are recognized", () => {
  const lines = conflictLines(
    ["<<<<<<<", "mine", "=======", "theirs", ">>>>>>>", "", "- [ ] after", ""].join("\n"),
  );
  assert.deepEqual(scanConflictBlocks(lines), [{ startLine: 1, endLine: 5 }]);
});

test("parsing conflict — unterminated open at final line freezes just that line to EOF", () => {
  const lines = conflictLines("- [ ] fine\n<<<<<<< no closer");
  const blocks = scanConflictBlocks(lines);
  assert.deepEqual(blocks, [{ startLine: 2, endLine: 2 }]);
  assert.equal(blocks[0]?.endLine, lines.length);
});

test("parsing conflict — blocksIntersecting helper drives the extent→flag step", () => {
  const blocks = scanConflictBlocks(conflictLines());
  assert.equal(blocksIntersecting(1, 3, blocks), false); // the clean 1.0 section
  assert.equal(blocksIntersecting(5, 5, blocks), false);
  assert.equal(blocksIntersecting(10, 11, blocks), true); // extent touching a block start counts
  assert.equal(blocksIntersecting(12, 14, blocks), true); // fully interior
  assert.equal(blocksIntersecting(27, 30, blocks), true); // the unterminated region
});

test("parsing conflict — frozenLineSet freezes every line of every block span (inclusive)", () => {
  const lines = conflictLines();
  const frozen = frozenLineSet(scanConflictBlocks(lines));
  assert.equal(frozen.has(11), true); // opening marker itself is frozen
  assert.equal(frozen.has(13), true); // separator line
  assert.equal(frozen.has(15), true); // closing marker
  assert.equal(frozen.has(10), false); // blank line above the block is NOT frozen
  assert.equal(frozen.has(27), true);
  assert.equal(frozen.has(30), true);
  assert.equal(frozen.size, 5 + 3 + 4);
});
