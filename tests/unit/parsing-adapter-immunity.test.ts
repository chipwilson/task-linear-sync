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
  featureName: (filePath: string) => kittyRow.featureName(filePath), // kitty-specs/<x>/tasks.md → x
  headingGrammar: kittyRow.headingGrammar,
  phasePattern: kittyRow.phasePattern,
  summaryPattern: kittyRow.summaryPattern,
  rollupPattern: kittyRow.rollupPattern,
  checklistIdPattern: kittyRow.checklistIdPattern,
} satisfies TaskFileAdapter;

/**
 * Empirically pinned id/title table (adapter checklistIdPattern: leading integers need 2+
 * digits or a dotted tail — `1.`/`2.` stay IN the title, `4.1` captures `4.1`, `10.` captures
 * `10`). Derived from the compiled parser; the row's own grammar, unchanged by 021.
 */
const KITTY_ID_TITLE: readonly (readonly [number, string | null, string])[] = [
  [3, null, "1. Set up project structure and dependencies"],
  [9, null, "2. Implement configuration management module"],
  [15, null, "3. Implement logging module"],
  [22, null, "4. Implement EC2 service module"],
  [23, "4.1", "Create EC2 client wrapper with retry logic"],
  [30, "4.2", "Implement instance discovery functionality"],
  [37, "4.3", "Implement instance shutdown functionality"],
  [44, null, "5. Implement main Lambda handler"],
  [52, null, "6. Implement error handling and response formatting"],
  [59, null, "7. Create IAM policy and deployment configuration"],
  [65, null, "8. Write integration tests"],
  [72, null, "9. Add comprehensive error handling tests"],
  [79, "10", "Create deployment and monitoring setup"],
];

test("immunity spec-kitty — kiro-plan shape yields 13 parentless checklist tasks, zero heading tasks (C9, R3)", () => {
  // Mirror pins (corpus precedent): the view reads the shipped built-in conventions verbatim.
  assert.equal(kittyView.headingGrammar, specKittyConventions.headingGrammar);
  assert.equal(kittyView.phasePattern, specKittyConventions.phasePattern);
  assert.equal(kittyView.summaryPattern, specKittyConventions.summaryPattern);
  assert.equal(kittyView.rollupPattern, specKittyConventions.rollupPattern);
  assert.equal(kittyView.checklistIdPattern, specKittyConventions.checklistIdPattern);
  assert.equal(kittyView.headingGrammar, "(?!)", "never-matching heading grammar — the structural immunity (R3)");

  const result = parseTaskFile("kitty-specs/auth/tasks.md", CONTENT, kittyView, cfg);
  const { tasks } = result.file;

  assert.equal(tasks.length, 13, "exactly the thirteen checkboxes — the title heading is structure only");
  assert.deepEqual(tasks.map((task) => task.lineNumber), CHECKBOX_LINES);
  assert.ok(tasks.every((task) => task.kind === "checklist"), "zero heading tasks (C3.1): `# Implementation Plan` matches nothing");
  assert.deepEqual(tasks.map((task) => [task.lineNumber, task.localTaskId ?? null, task.title]), KITTY_ID_TITLE);
  assert.ok(tasks.every((task) => task.checked === true), "all thirteen `[x]` boxes checked");

  // Depth 1 at default cap 1: no heading task exists to adopt anything, so every checkbox is a
  // parentless root and nothing is depth-folded — the shape the shared fix moves kiro toward.
  assert.ok(tasks.every((task) => !("parentUuid" in task)), "every survivor is parentless (depth 1) at cap 1");
  assert.ok(tasks.every((task) => task.childUuids.length === 0), "no parent adopts a sibling at column 0");

  // No exclusion records AT ALL: zero depth-folded, no summary-section, no rollup (verify).
  // (Filter BEFORE the emptiness pin: deepEqual-with-[] narrows `exclusions` to `never[]`.)
  assert.equal(result.exclusions.filter((record) => record.reason === "depth-folded").length, 0, "zero depth-folded exclusions");
  assert.deepEqual(result.exclusions, [], "no exclusion records of any kind");
  assert.deepEqual(result.conflictBlocks, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.featureName, "auth", "kitty-specs/<x>/tasks.md → x");
  assert.equal(result.file.frameworkId, "spec-kitty");
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
