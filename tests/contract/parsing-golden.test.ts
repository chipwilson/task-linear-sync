/**
 * T026 [US2] — golden-corpus contract test (research R13; FR-012 verbatim: "System MUST
 * rewrite assigned lines bottom-to-top, reproduce the original trailing-newline style
 * exactly, leave unassigned lines byte-identical, and leave unresolved conflict blocks
 * byte-for-byte untouched"; SC-002 verbatim: "Across the golden-file rewrite corpus,
 * 0 bytes differ outside explicitly assigned lines, and trailing-newline style is
 * preserved in 100% of fixtures"). Goldens are hand-authored byte-exact — NEVER generated
 * by the implementation under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderTaskLines, LineRenderError, splitLines } from "task-linear-sync/parsing";
import type { LineAssignment } from "task-linear-sync/parsing";

import { readGolden, readGoldenJson, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const VIRTUAL_PATH = "specs/auth/tasks.md"; // the path passed to renderTaskLines (recorded verbatim in the error fixture)

const CORPUS = ["multi-lf", "mixed-crlf", "no-trailing-newline", "conflict-untouched"] as const;

function terminatorStyle(content: string): string {
  const m = /\r?\n?$/u.exec(content.slice(-2));
  return content.endsWith("\r\n") ? "crlf" : content.endsWith("\n") ? "lf" : "none";
}

test("render golden corpus — whole-file bytes equal the hand-authored goldens (SC-002: 0 bytes differ outside assigned lines)", () => {
  for (const name of CORPUS) {
    const content = readGolden(`${name}.in.md`);
    const golden = readGolden(`${name}.out.md`);
    const assignments = readGoldenJson<readonly LineAssignment[]>(`${name}.assignments.json`);
    const result = renderTaskLines(VIRTUAL_PATH, content, assignments, cfg);

    assert.equal(result.content, golden, `${name}: whole-file byte identity against the golden`);

    // SC-002 mechanical split: every UNASSIGNED line (text AND terminator) is byte-identical.
    const assigned = new Set(assignments.map((a) => a.task.lineNumber));
    const input = splitLines(content, cfg.tabWidth);
    const output = splitLines(result.content, cfg.tabWidth);
    assert.equal(output.length, input.length, `${name}: line count never changes`);
    for (const line of input) {
      if (assigned.has(line.number)) continue;
      const out = output[line.number - 1];
      assert.ok(out);
      assert.equal(out.text + out.terminator, line.text + line.terminator, `${name}: unassigned line ${line.number} must be byte-identical`);
    }

    // Trailing-newline style reproduced EXACTLY in 100% of fixtures.
    assert.equal(terminatorStyle(result.content), terminatorStyle(content), `${name}: trailing-newline style`);

    // Conflict blocks byte-for-byte untouched (conflict-untouched fixture).
    if (name === "conflict-untouched") {
      for (const line of input) {
        if (/^(<{7,}|={7,}|>{7,})/u.test(line.text) || /^- \[.\] Fake/u.test(line.text)) {
          const out = output[line.number - 1];
          assert.ok(out);
          assert.equal(out.text + out.terminator, line.text + line.terminator, `conflict-block line ${line.number} must be byte-for-byte untouched`);
        }
      }
    }
  }
});

test("render golden corpus — changes material is the 009 expectedMarkdownChanges source (ascending, with terminators)", () => {
  for (const name of CORPUS) {
    const content = readGolden(`${name}.in.md`);
    const assignments = readGoldenJson<readonly LineAssignment[]>(`${name}.assignments.json`);
    const result = renderTaskLines(VIRTUAL_PATH, content, assignments, cfg);
    const expectedLines = [...assignments.map((a) => a.task.lineNumber)].sort((a, b) => a - b);
    assert.deepEqual(result.changes.map((c) => c.lineNumber), expectedLines, `${name}: changes ascending by lineNumber`);
    const input = splitLines(content, cfg.tabWidth);
    for (const change of result.changes) {
      const line = input[change.lineNumber - 1];
      assert.ok(line);
      assert.equal(change.before, line.text + line.terminator, `${name}: before carries original terminator bytes`);
      assert.ok(change.after.endsWith(line.terminator), `${name}: after reproduces the same terminator`);
    }
  }
});

test("render golden corpus — broken fixture aborts with the recorded { filePath, lineNumber, reason } and leaves input byte-identical (SC-003)", () => {
  const content = readGolden("broken-line.in.md");
  const assignments = readGoldenJson<readonly LineAssignment[]>("broken-line.assignments.json");
  const expected = readGoldenJson<{ filePath: string; lineNumber: number; reason: string }>("broken-line.expect-error.json");
  const before = content;
  assert.throws(
    () => renderTaskLines(expected.filePath, content, assignments, cfg),
    (err: unknown) => {
      assert.ok(err instanceof LineRenderError);
      assert.equal(err.filePath, expected.filePath, "error names the file path (FR-013)");
      assert.equal(err.lineNumber, expected.lineNumber, "error names the line number (FR-013)");
      assert.equal(err.reason, expected.reason);
      return true;
    },
  );
  assert.equal(content, before, "input content is byte-identical after the throw (pure function — file trivially unmodified)");
  // Assignments were listed with line 3 first; validate-all-ascending still aborts at line 1.
  assert.equal(assignments[0]?.task.lineNumber, 3);
  assert.equal(expected.lineNumber, 1);
});
