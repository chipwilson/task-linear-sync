/**
 * T012 [017 US1] — the Spec Kitty roll-up grammar pinned on the REAL built-in row
 * (`builtInAdapters["spec-kitty"]`), not a stand-in: the checklist local-id variants of
 * C3.4, the capability-tag rule of C3.5, template-section containment (C3.3), YAML front
 * matter (C3.2), work-package grouping (C3.6), and the R3 `flatDocument` pin.
 *
 * The parse-level `Task.title` is the RAW title (frozen 004 semantics: tags are file
 * content), so every derived-title assertion here runs the same `cleanTitle` the engine
 * threads `titleTagPattern` through (contracts/spec-kitty-adapter.md C3.5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInAdapters } from "task-linear-sync/discovery";
import { cleanTitle, parseTaskFile, splitLines } from "task-linear-sync/parsing";
import type { CleanTitleOptions, TaskFileAdapter } from "task-linear-sync/parsing";

import { extractTasks } from "../../src/parsing/extract.js";

import { makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "kitty-specs/001-demo/tasks.md";

/** The shipped row (full `FrameworkAdapter` surface: `titleBehavior`, `titleTagPattern`). */
const kittyRow = builtInAdapters["spec-kitty"];

/** The shipped row satisfies the consumer view structurally (amendment 2 members included). */
const kitty = kittyRow as unknown as TaskFileAdapter;

/** Same derivation the engine performs on `derivedTitle` / mirrored issue titles. */
function derived(rawTitle: string): string {
  return cleanTitle(rawTitle, {
    confirmationKey: cfg.confirmationKey,
    titleStripPrefixes: [...(kittyRow.titleBehavior?.stripPrefixes ?? [])],
    titleTagPattern: kittyRow.titleTagPattern,
  } satisfies CleanTitleOptions);
}

function parseLine(line: string) {
  return parseTaskFile(PATH, `${line}\n`, kitty, cfg);
}

test("parsing spec-kitty: every printed id form yields the printed local id and an id-free title (C3.4, FR-005)", () => {
  const cases: readonly [string, string, string][] = [
    ["- [ ] T001 Create the scaffold", "T001", "Create the scaffold"],
    ["- [ ] T001: Create the scaffold", "T001", "Create the scaffold"],
    ["- [ ] T001. Create the scaffold", "T001", "Create the scaffold"],
    ["- [ ] T001 — Create the scaffold", "T001", "Create the scaffold"],
    ["- [ ] 042 Create the ledger", "042", "Create the ledger"],
    ["- [ ] 2.1 Draft the outline", "2.1", "Draft the outline"],
    ["- [ ] T002.3 [P] Wire the flag parser", "T002.3", "[P] Wire the flag parser"],
  ];
  for (const [line, localTaskId, title] of cases) {
    const task = parseLine(line).file.tasks[0];
    assert.ok(task, `${line} yields one task`);
    assert.equal(task.kind, "checklist", "checklist subtask (C3.3)");
    assert.equal(task.localTaskId, localTaskId, `${line} — id equals the printed id`);
    assert.equal(task.title, title, `${line} — id span excluded, raw content kept (C3.4)`);
    assert.equal(task.frameworkId, "spec-kitty");
  }
});

test("parsing spec-kitty: an id-less checkbox is still a task — the ordinal seed path stays available (C4.1)", () => {
  const { file } = parseLine("- [ ] Just rewrite the scaffold");
  const task = file.tasks[0];
  assert.ok(task, "zero tasks lost to a missing id");
  assert.ok(!("localTaskId" in task), "no id ⇒ no localTaskId field, so the seed falls back to the ordinal");
  assert.equal(task.title, "Just rewrite the scaffold");
});

test("parsing spec-kitty: [P]/[Pn]/[USn] tags stay in the file and vanish from derived titles (C3.5, FR-006)", () => {
  const cases: readonly [string, string, string][] = [
    ["- [ ] T003 [P] Add payouts", "T003", "Add payouts"],
    ["- [ ] T004 [P2] Rotate the API keys", "T004", "Rotate the API keys"],
    ["- [ ] T005 [US1] List transactions", "T005", "List transactions"],
    ["- [ ] T006 [P] Ship [US2] the ledger", "T006", "Ship the ledger"],
  ];
  for (const [line, localTaskId, expected] of cases) {
    const task = parseLine(line).file.tasks[0];
    assert.ok(task);
    assert.match(task.title, /^\[(?:P\d*|US\d+)\]/u, "the RAW title keeps the tag — it is file content");
    assert.equal(derived(task.title), expected, `${line} — derived/mirrored title carries no tag`);
    assert.equal(derived(derived(task.title)), expected, "re-deriving is a no-op (Principle IV)");
    assert.equal(task.localTaskId, localTaskId, "the id span and the tag are independent spans");
  }
});

test("parsing spec-kitty: a bracketed issue reference is never a capability tag (C3.5)", () => {
  const { file } = parseLine("- [ ] T007 [SYNC-9] [US1] Sync the ledger");
  const task = file.tasks[0];
  assert.ok(task);
  assert.deepEqual(task.issueRef, { key: "SYNC", number: 9 });
  assert.equal(task.title, "[US1] Sync the ledger", "`[SYNC-9]` is consumed by the ref rule, the tag by the raw title");
  assert.equal(derived(task.title), "Sync the ledger", "the tag strips; nothing else is eaten");
  assert.equal(
    cleanTitle("[SYNC-9] [US1] Sync the ledger", { confirmationKey: cfg.confirmationKey, titleStripPrefixes: [] }),
    "[US1] Sync the ledger",
    "without the adapter member the reference alone strips — unchanged global behavior (C5.3)",
  );
});

const ROLL_UP = [
  "---",
  "mission: 001-demo",
  "created: 2026-11-02",
  "---",
  "",
  "# 001-demo — Tasks",
  "",
  "## Inputs",
  "- [ ] this illustrative checkbox must NOT become a task",
  "",
  "## Work Package WP01: Scaffold",
  "- [ ] T001 Create the scaffold",
  "- [ ] T002 Implement charging",
  "",
  "## Work Package WP02: Payments",
  "- [ ] T003 [P] Add payouts",
  "- [ ] T004 [US1] List transactions",
  "",
  "## Dependencies",
  "T003 depends on T001.",
  "",
  "## Risks & Mitigations",
  "- Keep tag rendering stable.",
].join("\n");

test("parsing spec-kitty: the canonical roll-up yields exactly the four subtasks — no headings, no front matter, no template checkboxes (C3.1–C3.3)", () => {
  const { file, exclusions } = parseTaskFile(PATH, ROLL_UP, kitty, cfg);
  assert.deepEqual(
    file.tasks.map((t) => [t.kind, t.localTaskId, t.lineNumber]),
    [
      ["checklist", "T001", 12],
      ["checklist", "T002", 13],
      ["checklist", "T003", 16],
      ["checklist", "T004", 17],
    ],
    "front-matter lines and EVERY heading are document structure only (C3.1, C3.2)",
  );
  assert.equal(file.featureName, "001-demo", "the mission directory is the feature (C2.3)");
  assert.deepEqual(
    exclusions.map((e) => [e.lineNumber, e.reason]),
    [[9, "summary-section"]],
    "the unfenced `## Inputs` checkbox is an exclusion record, not a task (C3.3)",
  );
});

test("parsing spec-kitty: work packages group subtasks and an empty work package yields nothing (C3.6, FR-007)", () => {
  const { file } = parseTaskFile(PATH, ROLL_UP, kitty, cfg);
  assert.deepEqual(
    file.tasks.map((t) => [t.localTaskId, t.phase]),
    [
      ["T001", "WP01: Scaffold"],
      ["T002", "WP01: Scaffold"],
      ["T003", "WP02: Payments"],
      ["T004", "WP02: Payments"],
    ],
    "the heading sets the grouping until the next heading — the heading itself never becomes a task",
  );
  const empty = parseTaskFile(
    PATH,
    ["## Work Package WP01: Scaffold", "- [ ] T001 Do it", "## Work Package WP02: Nothing here", "## Dependencies", "None."].join("\n"),
    kitty,
    cfg,
  ).file;
  assert.deepEqual(
    empty.tasks.map((t) => [t.localTaskId, t.phase]),
    [["T001", "WP01: Scaffold"]],
    "a work package with no subtasks yields zero tasks (C3.6)",
  );
});

test("parsing spec-kitty: a roll-up is a flat document — metadata only, no behavioral consumer (research R3)", () => {
  const { flatDocument } = extractTasks(splitLines(ROLL_UP, cfg.tabWidth), new Set(), kitty, cfg);
  assert.equal(flatDocument, true, "the never-matching heading grammar makes every roll-up flat");
});
