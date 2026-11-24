/**
 * T010 [P] [US1] — subtask derivation unit tests over the 023 parsing corpus
 * (feature contract C2.1–C2.4; research R1; data-model §1/§3). RED-FIRST: the widened
 * derivation (`deriveDocumentTasks`) and the built-in row's `subtaskRule` land in
 * T012–T015; until then the module lookup / rule members are missing and every
 * assertion fails at runtime.
 *
 * Grammar pins (verbatim from data-model §3, exercised through the REAL row):
 *  - `### Subtask T001 – Title` ATX anchors with `:`/`–`/`—`/`-` separators;
 *  - `- [ ] T003: Title` checklist anchors;
 *  - NO match on cross-references ("depends on T001 implementation");
 *  - the anchor region stops at `## Activity Log` / `## Review Report` (case-
 *    insensitive) so Activity-Log restatements are content, never anchors;
 *  - section extent = anchor line .. next same-or-shallower heading / next anchor /
 *    region end (trailing blank lines trimmed);
 *  - duplicate anchors of one id INSIDE the region yield two drafts whose composed
 *    seed inputs are identical (the collision refusal itself is pinned at the engine).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInAdapters } from "task-linear-sync/discovery";

import { readFixture } from "../helpers/parsing-fixtures.js";

const moduleSpecifier = "../../src/parsing/document.js";
const mod = (await import(moduleSpecifier).catch(() => null)) as {
  deriveDocumentTasks?: (
    filePath: string,
    lines: readonly string[],
    rule: SubtaskRule,
  ) => DocumentDerivation | null;
} | null;

interface SubtaskRow {
  readonly kind: "document";
  readonly localTaskId: string;
  readonly title: string;
  readonly lineNumber: number;
  readonly startLine: number;
  readonly endLine: number;
}
interface DocumentDraft {
  readonly kind: "document";
  readonly localTaskId: string;
  readonly title: string;
  readonly startLine: number;
  readonly endLine: number;
}
interface DocumentDerivation {
  readonly document: DocumentDraft;
  readonly subtasks: readonly SubtaskRow[];
  readonly rosterMisses: readonly { localTaskId: string; line: number; text: string }[];
}
type SubtaskRule = {
  readonly collectionPattern: string;
  readonly idKey: string;
  readonly titleKey: string;
  readonly fileNameIdPattern: string;
  readonly subtaskRule?: {
    readonly rosterKey: string;
    readonly anchorPattern: string;
    readonly anchorRegionStopPattern: string;
  };
};

/** The built-in row is the oracle — derivation runs with the SHIPPED rule, not a copy. */
function kittyRule(): SubtaskRule {
  const row = builtInAdapters["spec-kitty"] as unknown as { documentTaskRule?: SubtaskRule };
  const rule = row.documentTaskRule;
  assert.ok(rule?.subtaskRule, "the spec-kitty row carries the A-023-2 subtaskRule (T015)");
  return rule!;
}

function derive(relPath: string, content: string): DocumentDerivation | null {
  return (
    mod?.deriveDocumentTasks?.(
      `kitty-specs/001-corpus/tasks/${relPath}`,
      content.replace(/\r\n/g, "\n").split("\n"),
      kittyRule(),
    ) ?? null
  );
}

const corpus = (name: string): string => readFixture(`parsing/frameworks/spec-kitty/tasks/${name}`);

test("023 derivation: the module exposes deriveDocumentTasks (T012 subject)", () => {
  assert.ok(mod, "src/parsing/document.ts must exist");
  assert.equal(typeof mod?.deriveDocumentTasks, "function");
});

test("023 derivation WP01-auth: ATX anchors derive in source order with titles and exact extents", () => {
  const d = derive("WP01-auth.md", corpus("WP01-auth.md"));
  assert.ok(d, "canonical document derives");
  assert.equal(d.document.localTaskId, "WP01");
  assert.deepEqual(
    d.subtasks.map((s) => [s.localTaskId, s.title]),
    [
      ["T001", "Implement validator CLI"], // en-dash separator, `Subtask` word
      ["T002", "Add pytest coverage"],
    ],
    "roster ∪ anchors — children are the ANCHORS, in source order (C2.1)",
  );
  const [t001, t002] = d.subtasks;
  assert.deepEqual([t001!.startLine, t001!.endLine], [20, 22], "T001 = anchor line .. before the next same-level anchor");
  assert.deepEqual([t002!.startLine, t002!.endLine], [24, 26], "T002 ends at the anchor-region end, trailing blanks trimmed");
  assert.deepEqual(
    d.rosterMisses.map((m) => m.localTaskId),
    ["T099"],
    "roster id with no anchor → recognized-but-excluded (C2.5)",
  );
  assert.equal(d.rosterMisses[0]?.line, 8, "the exclusion names its roster line");
});

test("023 derivation: Activity-Log / Review-Report restatements are NEVER anchors (C2.3)", () => {
  const d = derive("WP01-auth.md", corpus("WP01-auth.md"))!;
  assert.equal(d.subtasks.filter((s) => s.localTaskId === "T001").length, 1, "the restated `#### Subtask T001: Auth ✅` after ## Activity Log is content");
  assert.ok(d.subtasks.every((s) => s.endLine < 28), "no child extends past the stop heading at line 28");
});

test("023 derivation WP02-flow: checklist anchors `- [ ] T003: Title` derive single-line sections", () => {
  const d = derive("WP02-flow.md", corpus("WP02-flow.md"));
  assert.ok(d);
  assert.deepEqual(
    d.subtasks.map((s) => [s.localTaskId, s.title, s.startLine, s.endLine]),
    [
      ["T003", "Open the flow", 14, 14],
      ["T004", "Persist state", 15, 15],
    ],
    "flow-roster ids anchor via checklist lines; each ends at the next anchor",
  );
  assert.deepEqual(d.rosterMisses, []);
});

test("023 derivation WP03-noanchors: roster-only ids exclude, children empty, no empty drafts", () => {
  const d = derive("WP03-noanchors.md", corpus("WP03-noanchors.md"));
  assert.ok(d);
  assert.deepEqual(d.subtasks, [], "anchors only — a roster entry never conjures a child (C2.5)");
  assert.deepEqual(d.rosterMisses.map((m) => m.localTaskId).sort(), ["T005", "T006"]);
});

test("023 derivation: anchor grammar accepts separator variants and bare tokens; rejects cross-references", () => {
  const doc = [
    "---",
    "work_package_id: WP09",
    "title: Grammar probe",
    "---",
    "",
    "### Subtask T010: colon title",
    "### Subtask T011 – en dash title",
    "### Subtask T012 — em dash title",
    "### Subtask T013 - hyphen title",
    "### T014 bare token heading",
    "- [x] T015: checked checklist anchor",
    "Depends on T016 implementation somewhere else.",
    "### Section with no token",
    "",
  ].join("\n");
  const d = derive("WP09-grammar.md", doc)!;
  assert.deepEqual(
    d.subtasks.map((s) => [s.localTaskId, s.title]),
    [
      ["T010", "colon title"],
      ["T011", "en dash title"],
      ["T012", "em dash title"],
      ["T013", "hyphen title"],
      ["T014", "bare token heading"],
      ["T015", "checked checklist anchor"],
    ],
    "separator variants match; prose cross-references and token-less headings do NOT (R1)",
  );
});

test("023 derivation: anchor without title text falls back to the readable token form", () => {
  const doc = ["---", "work_package_id: WP09", "---", "", "### Subtask T007", "body"].join("\n");
  const d = derive("WP09-titleless.md", doc)!;
  assert.equal(d.subtasks[0]?.title, "T007", "readable form of the token; front matter never in a child title");
});

test("023 derivation: a deeper heading inside a section does NOT end it; the stop pattern is case-insensitive", () => {
  const doc = [
    "---",
    "work_package_id: WP09",
    "---",
    "",
    "### Subtask T020 – Outer",
    "- step one",
    "#### Deeper detail heading",
    "- still inside T020",
    "",
    "## activity log",
    "- 2026-11-04 — lowercase stop heading still closes the region",
    "### Subtask T021 – after stop, never an anchor",
    "",
  ].join("\n");
  const d = derive("WP09-stopcase.md", doc)!;
  assert.deepEqual(d.subtasks.map((s) => s.localTaskId), ["T020"]);
  const t020 = d.subtasks[0]!;
  assert.equal(t020.startLine, 5);
  assert.ok(t020.endLine >= 8 && t020.endLine < 10, "the deeper heading is CONTENT inside T020; the region ends before the lowercase stop line");
});

test("023 derivation: duplicate anchors of one id inside the region yield TWO drafts with identical seed inputs (C2.6)", () => {
  const doc = [
    "---",
    "work_package_id: WP04",
    "subtasks:",
    "  - T004",
    "---",
    "",
    "### Subtask T004 – First definition",
    "- guidance",
    "### Subtask T004 – Second definition",
    "- more guidance",
    "",
  ].join("\n");
  const d = derive("WP04-dup.md", doc)!;
  assert.equal(d.subtasks.length, 2, "both in-region anchors derive");
  assert.deepEqual(d.subtasks.map((s) => s.localTaskId), ["T004", "T004"]);
  // Identical composed seed inputs: frameworkId|mission|<WP id>\0<subtask id> — the two
  // drafts share WP04 and T004, so the engine's frozen seed strings are equal and the
  // EXISTING document-kind collision guard refuses (pinned at the engine tier, T016).
  assert.equal(d.document.localTaskId, "WP04");
});

test("023 derivation: documents failing the collection gate stay null (artifact shapes included)", () => {
  const artifact = corpus("WP01-auth/review-cycle-1.md");
  assert.equal(
    mod?.deriveDocumentTasks?.("kitty-specs/001-corpus/tasks/WP01-auth/review-cycle-1.md", artifact.split("\n"), kittyRule()),
    null,
    "per-WP artifact sub-folders derive ZERO drafts whatever their front matter (C1.2')",
  );
});
