/**
 * T007 [Foundational] — content-model unit tests (research R4).
 * Terminator-preserving split (`\r\n`, `\n`, final unterminated line; 1-based `number`),
 * leading-tab expansion for `indentWidth` at `config.tabWidth` "used for nesting/extent
 * comparisons" while `originalIndent` holds "the raw leading-whitespace bytes (used
 * verbatim by the renderer)", and the fence map — opening `^ {0,3}(`{3,}|~{3,})`, close
 * "at a line of the same char with length ≥ the opening length", "interiors (and the
 * fence delimiter lines themselves) are `inFence: true` and non-task".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { splitLines, lineIsFenced } from "task-linear-sync/parsing";

import { readFixture, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();

test("parsing content — empty content yields zero lines", () => {
  assert.deepEqual(splitLines("", cfg.tabWidth), []);
});

test("parsing content — terminator-preserving split (LF, CRLF, mixed, unterminated)", () => {
  const lines = splitLines("a\r\nb\nc", cfg.tabWidth);
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => [l.number, l.text, l.terminator]),
    [
      [1, "a", "\r\n"],
      [2, "b", "\n"],
      [3, "c", ""],
    ],
  );
});

test("parsing content — trailing newline keeps every line terminated (no phantom line)", () => {
  const lines = splitLines("a\nb\n", cfg.tabWidth);
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.terminator, "\n");
});

test("parsing content — indentWidth expands leading tabs to tabWidth; originalIndent is raw bytes", () => {
  const [tab, mixed, double, spaces] = splitLines("\t- [ ] tab\n \tmixed\n\t\tdouble\n    four\n", 2);
  assert.equal(tab?.indentWidth, 2);
  assert.equal(tab?.originalIndent, "\t");
  assert.equal(tab?.text, "\t- [ ] tab");
  assert.equal(mixed?.indentWidth, 2); // space (col 1) → tab advances to next tabWidth multiple (2)
  assert.equal(mixed?.originalIndent, " \t");
  assert.equal(double?.indentWidth, 4);
  assert.equal(double?.originalIndent, "\t\t");
  assert.equal(spaces?.indentWidth, 4);
  assert.equal(spaces?.originalIndent, "    ");
});

test("parsing content — indentWidth honors a non-default tabWidth", () => {
  const [tabOnly] = splitLines("\tindented\n", 4);
  assert.equal(tabOnly?.indentWidth, 4);
  const [tabThenSpace] = splitLines("\t indented\n", 4);
  assert.equal(tabThenSpace?.indentWidth, 5); // tab lands on column 4, then a space advances to 5
});

test("parsing content — fence map over fenced.md (``` and ~~~ fences, shorter close inert, unclosed to EOF)", () => {
  const content = readFixture("parsing/fenced.md");
  const lines = splitLines(content, cfg.tabWidth);
  assert.equal(lines.length, 25);
  const fencedLines = new Set(lines.filter((l) => l.inFence).map((l) => l.number));
  const expectedFenced = new Set<number>([
    ...[5, 6, 7, 8, 9], // ```bash fence: interior AND delimiter lines are inFence
    ...[13, 14, 15, 16, 17], // ~~~~ fence; the `~~~` at line 15 is shorter than the opening → still inside
    ...[23, 24, 25], // unclosed ~~~open extends to EOF
  ]);
  assert.deepEqual(fencedLines, expectedFenced);
});

test("parsing content — lineIsFenced query agrees with the fence map", () => {
  const lines = splitLines(readFixture("parsing/fenced.md"), cfg.tabWidth);
  assert.equal(lineIsFenced(lines, 6), true); // ``` interior
  assert.equal(lineIsFenced(lines, 5), true); // opening delimiter itself
  assert.equal(lineIsFenced(lines, 9), true); // closing delimiter itself
  assert.equal(lineIsFenced(lines, 10), false); // after the fence
  assert.equal(lineIsFenced(lines, 15), true); // shorter ~~~ inside a ~~~~ fence
  assert.equal(lineIsFenced(lines, 19), false);
  assert.equal(lineIsFenced(lines, 25), true); // swallowed by the unclosed fence
});

test("parsing content — fence reopen/close bookkeeping across documents (determinism)", () => {
  const content = readFixture("parsing/fenced.md");
  const first = splitLines(content, cfg.tabWidth);
  const second = splitLines(content, cfg.tabWidth);
  assert.deepEqual(first, second); // Principle IV: identical inputs → identical line models
});
