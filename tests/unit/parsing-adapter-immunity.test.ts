/**
 * T018 [US4] — C9 immunity pins for the two structurally immune adapters (research R3;
 * spec FR-009/SC-005).
 *
 * Feature 021 amends the SHARED built-in default grammars/rules; the two adapters carrying
 * their own grammar overrides never enter the amended code path: `spec-kitty`'s heading
 * grammar never matches (no heading tasks exist, so no document-title heading can adopt
 * the checkboxes) and `spec-superpower`'s narrow `Task N:` grammar claims neither the
 * `# Implementation Plan` title nor any checkbox line (every checkbox is a rollup-excluded
 * body line by design). These pins parse the reported kiro-plan shape through consumer-side
 * views of the REAL built-in rows and hard-pin today's outcomes: they MUST pass
 * byte-identically both before and after the extraction fix — regression guards, not
 * post-fix expectations. A heading-less flat checklist file is pinned unchanged as well,
 * with a kiro↔generic classification parity mini-pin (C8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInAdapters } from "task-linear-sync/discovery";
import { type ParseResult, type TaskFileAdapter, parseTaskFile } from "task-linear-sync/parsing";

import { specKittyConventions } from "../../src/discovery/adapters/spec-kitty.js";

import { genericFixtureAdapter, kiroFixtureAdapter, makeTestConfig, readFixture } from "../helpers/parsing-fixtures.js";

/** Default config ON PURPOSE (cap 1): the immunity claim is that the shipped default already parses correctly. */
const cfg = makeTestConfig();
const CONTENT = readFixture("parsing/kiro-plan/tasks.md");
const RAW_LINES = CONTENT.split("\n");

/** The thirteen column-0 `- [x]` task lines of the reported fixture (line-order). */
const CHECKBOX_LINES: readonly number[] = [3, 9, 15, 22, 23, 30, 37, 44, 52, 59, 65, 72, 79];

// ── spec-kitty view (builtInAdapters row → TaskFileAdapter consumer view) ─────────────

/** 004 consumer view (adapter-consumption boundary rule 2): every convention read from the real built-in row. */
const kittyRow = builtInAdapters["spec-kitty"];
const kittyView = {
  id: "spec-kitty" as const,
  featureName: (filePath: string) => kittyRow.featureName(filePath), // kitty-specs/<x>/… → x
  headingGrammar: kittyRow.headingGrammar,
  documentTaskRule: kittyRow.documentTaskRule, // 022 re-base: the row is document-mode
} satisfies TaskFileAdapter;

test("immunity spec-kitty (022 re-base) — the kiro-plan shape is document-mode inert: zero roll-up tasks, one document task (C9, R3, R4)", () => {
  // Mirror pins (corpus precedent): the view reads the shipped built-in conventions verbatim.
  assert.equal(kittyView.headingGrammar, specKittyConventions.headingGrammar);
  assert.deepEqual(kittyView.documentTaskRule, specKittyConventions.documentTaskRule);
  assert.equal(kittyView.headingGrammar, "(?!)", "never-matching heading grammar — retained placeholder, never consulted in document mode (R3)");

  const rollUp = parseTaskFile("kitty-specs/auth/tasks.md", CONTENT, kittyView, cfg);
  assert.deepEqual(rollUp.file.tasks, [], "the roll-up never extracts — thirteen checkboxes, title heading and prose are documentation (FR-005)");
  assert.deepEqual(rollUp.exclusions, [], "zero line-scanning: no exclusion records of any kind");
  assert.deepEqual(rollUp.warnings, []);
  assert.equal(rollUp.featureName, "auth", "kitty-specs/<x>/tasks.md → x (segment-under-base)");
  assert.equal(rollUp.file.frameworkId, "spec-kitty");

  // The same content as a collection document: exactly ONE task carrying the whole plan as
  // body — whatever plan shape is pasted inside, document mode can never produce the
  // reported one-giant-issue shape NOR thirteen issues (R4).
  const doc = parseTaskFile("kitty-specs/auth/tasks/wp01-plan.md", CONTENT, kittyView, cfg);
  assert.equal(doc.file.tasks.length, 1);
  const task = doc.file.tasks[0];
  assert.equal(task.kind, "document");
  assert.equal(task.localTaskId, "WP01");
  assert.equal(task.title, "Implementation Plan", "leading heading wins the cascade (C3.1)");
  assert.deepEqual(task.taskBody, { startLine: 1, endLine: RAW_LINES.length }, "the entire pasted plan is body content");
  assert.ok(!("parentUuid" in task) && task.childUuids.length === 0, "fold-inert at depth 1 (R4)");
  assert.equal(rollUp.conflictBlocks.length, 0);
  assert.deepEqual(doc.exclusions, []);
});


// ── spec-superpower view (mirrors parsing-spec-superpower.test.ts's adapter view) ──────

const superRow = builtInAdapters["spec-superpower"];
const superView = {
  id: "spec-superpower" as const,
  featureName: (filePath: string) => superRow.featureName(filePath), // date-stripped basename
  headingGrammar: superRow.headingGrammar,
  phasePattern: superRow.phasePattern,
  summaryPattern: superRow.summaryPattern,
  rollupPattern: superRow.rollupPattern,
  identityFileScope: superRow.identityFileScope,
} satisfies TaskFileAdapter;

test("immunity spec-superpower — kiro-plan shape yields ZERO tasks: thirteen rollup exclusions, never a giant task (C9, R3)", () => {
  const result = parseTaskFile("docs/superpowers/plans/2026-01-01-demo-plan.md", CONTENT, superView, cfg);

  // The narrow `#{2,4} Task N:` grammar claims neither the level-1 title nor any checklist line:
  // zero heading tasks, zero checklist tasks — never the reported one-giant-issue shape.
  assert.deepEqual(result.file.tasks, [], "`# Implementation Plan` is NOT a heading task and checkboxes are never tasks");

  assert.equal(result.exclusions.length, 13, "every checkbox line is a rollup exclusion record");
  assert.deepEqual(
    result.exclusions.map((record) => [record.lineNumber, record.kind, record.reason]),
    CHECKBOX_LINES.map((line) => [line, "checklist" as const, "rollup" as const]),
    "the thirteen checkbox lines, all kind checklist / reason rollup",
  );
  assert.deepEqual(
    result.exclusions.map((record) => record.text),
    CHECKBOX_LINES.map((line) => RAW_LINES[line - 1]),
    "exclusion texts are the raw checkbox lines verbatim",
  );

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.conflictBlocks, []);
  assert.equal(result.featureName, "demo-plan", "date-stripped-basename featureName (018 FR-003)");
  assert.equal(result.file.frameworkId, "spec-superpower");
});

// ── heading-less flat checklist file — unchanged at both caps, kiro↔generic parity ──────

/** Same shape as `tests/fixtures/parsing/flat-noheadings.md`: two column-0 boxes, one 2-space child. */
const FLAT = ["- [ ] 1: Write the parser tests", "- [x] 2: Implement the parser", "  - [ ] 2.1: Cover nested rules", ""].join("\n");

test("immunity flat — heading-less checklist file: one task per checkbox at cap 2, fold at cap 1, all unchanged (C9)", () => {
  const atCap2 = parseTaskFile("specs/auth/tasks.md", FLAT, genericFixtureAdapter, makeTestConfig({ maxTaskIssueDepth: 2 }));
  const lineOf = new Map(atCap2.file.tasks.map((task) => [task.stableUuid, task.lineNumber]));
  assert.deepEqual(
    atCap2.file.tasks.map((task) => [
      task.lineNumber,
      task.localTaskId ?? null,
      task.title,
      task.checked,
      task.parentUuid ? lineOf.get(task.parentUuid) : null,
    ]),
    [
      [1, "1", "Write the parser tests", false, null],
      [2, "2", "Implement the parser", true, null],
      [3, "2.1", "Cover nested rules", false, 2], // nested by the indent stack, not by flatness
    ],
    "one task per checkbox; only the 2-space-indented child is parented",
  );
  assert.deepEqual(atCap2.exclusions, []);

  // Default cap 1: the two depth-1 roots survive, the nested child folds — pre/post-fix identical
  // (no heading exists, so the document-title rule cannot fire).
  const atDefault = parseTaskFile("specs/auth/tasks.md", FLAT, genericFixtureAdapter, cfg);
  assert.deepEqual(atDefault.file.tasks.map((task) => task.lineNumber), [1, 2], "the two depth-1 roots survive cap 1");
  assert.deepEqual(
    atDefault.exclusions,
    [{ lineNumber: 3, kind: "checklist", reason: "depth-folded", text: "  - [ ] 2.1: Cover nested rules" }],
    "exactly one depth-folded record for the nested child (020 fold rule unchanged)",
  );
  assert.equal(
    atDefault.exclusions.filter((record) => record.reason === "depth-folded").length,
    1,
    "the fold is attributable to indentation depth only — no heading is involved",
  );
});

test("immunity flat — kiro vs generic classification parse the heading-less shape identically (C8 parity mini-pin)", () => {
  const virtualPath = ".kiro/specs/auth/tasks.md";
  const viaKiro = parseTaskFile(virtualPath, FLAT, kiroFixtureAdapter, cfg);
  const viaGeneric = parseTaskFile(virtualPath, FLAT, genericFixtureAdapter, cfg);

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
  assert.equal(viaKiro.featureName, "auth");
  assert.equal(viaGeneric.featureName, "auth");
});
