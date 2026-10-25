/**
 * T027 [US2] — property / round-trip suite (research R13; constitution IV verbatim:
 * "rendering round-trips (parse → derive → render → parse reproduces identical titles
 * with no progressive prefixing)"; SC-003 posture: "every corrupted generated file halts
 * with file+line error and identical input bytes after").
 *
 * SEEDED PRNG ONLY (deterministic — Principle VI "no wall-clock nondeterminism"; no
 * Math.random() without a fixed seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile, renderTaskLines, cleanTitle, LineRenderError, scanConflictBlocks, splitLines } from "task-linear-sync/parsing";
import type { LineAssignment, TaskFileAdapter } from "task-linear-sync/parsing";

import { genericFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const VIRTUAL_PATH = "specs/generated/tasks.md";

/** mulberry32 — deterministic seeded PRNG (no wall-clock, no unseeded randomness). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedDoc {
  readonly content: string;
  readonly adapter: TaskFileAdapter;
}

const WORDS = ["Prepare", "Draft", "Sync", "Ship", "Polish", "Wire", "Harden", "Document"] as const;

/** Generate a deterministic pseudo-random task document (fences, conflicts, mixed EOLs). */
function generateDoc(rand: () => number): GeneratedDoc {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const eol = () => (rand() < 0.35 ? "\r\n" : "\n");
  const parts: string[] = [];
  const push = (line: string, term = eol()) => parts.push(line + term);

  const sections = 2 + Math.floor(rand() * 3);
  for (let s = 1; s <= sections; s++) {
    push(`## ${s}.0: ${pick(WORDS)} ${pick(WORDS)} module`);
    push("");
    if (rand() < 0.6) {
      push("```md");
      push("- [ ] fake task inside fence");
      push("```");
      push("");
    }
    const items = 1 + Math.floor(rand() * 3);
    for (let i = 1; i <= items; i++) {
      const indent = pick(["", "", "  ", "\t", "    "]);
      const state = pick([" ", " ", "x", "X"]);
      const id = rand() < 0.5 ? `${s}.${i}: ` : "";
      const ref = rand() < 0.3 ? ` [SYNC-${50 + Math.floor(rand() * 40)}]` : "";
      push(`${indent}- [${state}] ${id}${pick(WORDS)} ${pick(WORDS)}${ref}`);
      if (rand() < 0.4) {
        push(`${indent}  - [ ] ${s}.${i}.1: nested ${pick(WORDS)}`);
      }
    }
    push("");
    if (rand() < 0.35) {
      push("<<<<<<< HEAD");
      push("- [ ] frozen side A never a task");
      push("=======");
      push("- [ ] frozen side B never a task");
      push(">>>>>>> upstream");
      push("");
    }
  }
  let content = parts.join("");
  if (rand() < 0.3) content = content.replace(/\n$/u, ""); // random unterminated final line
  return { content, adapter: genericFixtureAdapter };
}

function assignmentsFor(
  content: string,
  rand: () => number,
  subset = true,
  checkboxMode: "random" | "retain" = "random",
): readonly LineAssignment[] {
  const parsed = parseTaskFile(VIRTUAL_PATH, content, genericFixtureAdapter, cfg);
  const blocks = scanConflictBlocks(splitLines(content, cfg.tabWidth));
  const frozen = new Set<number>();
  for (const b of blocks) for (let n = b.startLine; n <= b.endLine; n++) frozen.add(n);

  const out: LineAssignment[] = [];
  parsed.file.tasks.forEach((task, ordinal) => {
    assert.ok(!frozen.has(task.lineNumber), "a task start line must never lie inside a conflict block");
    if (subset && rand() < 0.45) return; // random subset
    out.push({
      task,
      desiredTitle: cleanTitle(task.title, {
        confirmationKey: cfg.confirmationKey,
        ...(task.localTaskId !== undefined ? { localTaskId: task.localTaskId } : {}),
        titleStripPrefixes: cfg.titleStripPrefixes,
      }),
      issueRef: task.issueRef ?? { key: cfg.confirmationKey, number: 100 + ordinal },
      // "retain" OMITS checked so existing state bytes (including capital X) survive
      // byte-for-byte — the prefix-stability property must not rest on boolean
      // normalization; "random" exercises explicit state writes.
      ...(task.kind === "checklist" && checkboxMode === "random" ? (rand() < 0.5 ? { checked: rand() < 0.5 } : {}) : {}),
    });
  });
  return out;
}

function lines(content: string) {
  return splitLines(content, cfg.tabWidth);
}

test("parsing round-trip (property) — random assignment subsets never change unassigned bytes and never emit inside conflict blocks", () => {
  const rand = mulberry32(20261023);
  let renderedLines = 0;
  for (let iter = 0; iter < 40; iter++) {
    const { content, adapter } = generateDoc(rand);
    assert.equal(parseTaskFile(VIRTUAL_PATH, content, adapter, cfg).file.tasks.length > 0, true, `iteration ${iter}: generator produced no tasks`);
    const assignments = assignmentsFor(content, rand);
    const result = renderTaskLines(VIRTUAL_PATH, content, assignments, cfg);

    const assigned = new Set(assignments.map((a) => a.task.lineNumber));
    const before = lines(content);
    const after = lines(result.content);
    assert.equal(after.length, before.length, `iteration ${iter}: line count preserved`);
    for (const line of before) {
      if (!assigned.has(line.number)) {
        const out = after[line.number - 1];
        assert.ok(out);
        assert.equal(out.text + out.terminator, line.text + line.terminator, `iteration ${iter}: unassigned line ${line.number} bytes changed`);
        renderedLines++;
      }
    }

    // Never emit inside a conflict block: frozen regions are byte-identical regardless.
    const blocks = scanConflictBlocks(before);
    for (const b of blocks) {
      for (let n = b.startLine; n <= b.endLine; n++) {
        const out = after[n - 1];
        const src = before[n - 1];
        assert.ok(out && src);
        assert.equal(out.text + out.terminator, src.text + src.terminator, `iteration ${iter}: frozen line ${n} changed`);
      }
    }
  }
  assert.ok(renderedLines > 100, `property exercised (${renderedLines} unassigned lines compared)`);
});

test("parsing round-trip (property) — double-render is a byte fixpoint (idempotent re-apply)", () => {
  const rand = mulberry32(424242);
  for (let iter = 0; iter < 25; iter++) {
    const { content } = generateDoc(rand);
    const assignments = assignmentsFor(content, rand);
    const once = renderTaskLines(VIRTUAL_PATH, content, assignments, cfg);
    const twice = renderTaskLines(VIRTUAL_PATH, once.content, assignments, cfg);
    assert.equal(twice.content, once.content, `iteration ${iter}: re-render is a byte fixpoint (constitution IV)`);
  }
});

test("parsing round-trip (property) — parse → render → parse reproduces identical titles; no progressive prefixing (constitution IV verbatim)", () => {
  const rand = mulberry32(90210);
  for (let iter = 0; iter < 25; iter++) {
    const { content } = generateDoc(rand);
    const first = parseTaskFile(VIRTUAL_PATH, content, genericFixtureAdapter, cfg);
    const assignments = assignmentsFor(content, rand, false); // assign EVERY task to prove the strongest form
    const rendered = renderTaskLines(VIRTUAL_PATH, content, assignments, cfg);
    const second = parseTaskFile(VIRTUAL_PATH, rendered.content, genericFixtureAdapter, cfg);

    assert.equal(second.file.tasks.length, first.file.tasks.length, `iteration ${iter}: task count stable across round trip`);
    for (const task of second.file.tasks) {
      const expected = first.file.tasks.find((t) => t.lineNumber === task.lineNumber);
      assert.ok(expected);
      const cleaned = cleanTitle(expected.title, {
        confirmationKey: cfg.confirmationKey,
        ...(expected.localTaskId !== undefined ? { localTaskId: expected.localTaskId } : {}),
        titleStripPrefixes: cfg.titleStripPrefixes,
      });
      assert.equal(task.title, cleaned, `iteration ${iter}: title at line ${task.lineNumber} must survive the round trip exactly`);
      assert.ok(!task.title.includes(`[${cfg.confirmationKey}-`), `iteration ${iter}: no issue reference may leak into stored titles`);
    }

    // A third cycle proves NO PROGRESSIVE PREFIXING: bytes are a fixpoint (checkbox
    // states are RETAINED by omitting `checked`, so only prefix/title bytes are under test).
    const again = assignmentsFor(rendered.content, rand, false, "retain");
    const rendered2 = renderTaskLines(VIRTUAL_PATH, rendered.content, again, cfg);
    assert.equal(rendered2.content, rendered.content, `iteration ${iter}: render→parse→render bytes stable (no prefix growth)`);
  }
});

test("parsing round-trip (property, SC-003) — every corrupted generated file halts with file+line error and identical input bytes", () => {
  const rand = mulberry32(31337);
  let checked = 0;
  for (let iter = 0; iter < 30; iter++) {
    const { content } = generateDoc(rand);
    const assignments = assignmentsFor(content, rand);
    if (assignments.length === 0) continue;
    const target = assignments[Math.floor(rand() * assignments.length)];
    assert.ok(target);
    const before = lines(content);
    const line = before[target.task.lineNumber - 1];
    assert.ok(line);
    // Corrupt the assigned line's structure (strip the heading hashes / checkbox marker).
    let corruptedText: string;
    if (target.task.kind === "heading") {
      corruptedText = line.text.replace(/^ {0,3}#{1,6}[ \t]+/u, "");
    } else {
      corruptedText = line.text.replace(/^([ \t]*)- \[.\][ \t]*/u, "$1- ");
    }
    assert.notEqual(corruptedText, line.text, "generator corruption must actually corrupt");
    const corrupted = before.map((l) => (l.number === line.number ? corruptedText + l.terminator : l.text + l.terminator)).join("");
    const originalContent = content;
    assert.throws(
      () => renderTaskLines(VIRTUAL_PATH, corrupted, [target], cfg),
      (err: unknown) => {
        assert.ok(err instanceof LineRenderError);
        assert.equal(err.filePath, VIRTUAL_PATH, `iteration ${iter}: file path named`);
        assert.equal(err.lineNumber, target.task.lineNumber, `iteration ${iter}: line number named`);
        assert.equal(err.reason, "structure-mismatch");
        return true;
      },
    );
    assert.equal(corrupted, expectContentOf(before, line.number, corruptedText), `iteration ${iter}: input bytes untouched by the aborting call`);
    assert.equal(content, originalContent);
    checked++;
  }
  assert.ok(checked > 10, `SC-003 property exercised across ${checked} corrupted fixtures`);
});

function expectContentOf(before: ReturnType<typeof lines>, lineNumber: number, replacement: string): string {
  return before.map((l) => (l.number === lineNumber ? replacement + l.terminator : l.text + l.terminator)).join("");
}
