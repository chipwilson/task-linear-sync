/**
 * T018 [022 US1] — the Spec Kitty DOCUMENT-mode parsing pins, re-based-rewritten over the
 * shipped row plus the A-022-2 `documentTaskRule` (values verbatim from data-model §3;
 * the row itself is re-based in T020, after which this object IS the row). The superseded
 * 017 checklist-grammar pins (roll-up extraction, tags, phases, grouping) are flipped
 * test-first per R13: the roll-up and everything under `tasks/` are documentation — the
 * only extraction unit is the work-package DOCUMENT (contracts/spec-kitty-work-packages.md
 * C0–C4, FR-004/FR-005, R4/R11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInAdapters } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";

import { makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();

/** data-model §3 — the re-based row's document rule (the T020 row must match these values). */
const documentTaskRule = {
  collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$",
  idKey: "work_package_id",
  titleKey: "title",
  fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$",
};

/** The shipped row widened with the document rule — the consumer view the engine receives. */
const kitty = { ...builtInAdapters["spec-kitty"], documentTaskRule } as unknown as TaskFileAdapter;

const WP_DOC = [
  "---",
  "work_package_id: wp01",
  "title: \"Set up the ledger\"",
  "dependencies:",
  "  - research.md",
  "---",
  "",
  "# Work Package WP01: Set up the ledger",
  "",
  "## Objectives & Success Criteria",
  "- The ledger crate compiles.",
  "",
  "Implement the scaffold. Subtask guidance:",
  "- [ ] T001 Create the crate",
  "- [ ] T002 Wire the CLI",
  "",
  "## Definition of Done",
  "- [ ] All checks pass",
  "",
].join("\n");

test("022 document mode: a recognized WP document yields EXACTLY ONE document draft (C1.1, C3, R11)", () => {
  const { file } = parseTaskFile("kitty-specs/001-demo/tasks/wp01-ledger.md", WP_DOC, kitty, cfg);
  assert.equal(file.tasks.length, 1, "one document, one task — checkboxes inside are content (FR-004)");
  const task = file.tasks[0];
  assert.equal(task.kind, "document");
  assert.equal(task.localTaskId, "WP01", "normalized identifier (R7): front-matter id wins");
  assert.equal(task.title, "Set up the ledger", 'front-matter titleKey wins the cascade (C3.1)');
  assert.equal(task.frameworkId, "spec-kitty");
  assert.deepEqual(task.taskBody, { startLine: 8, endLine: 18 }, "body extent: first non-blank line after the fence .. last non-blank line, fence excluded, heading INCLUDED (R11)");
  assert.ok(!("parentUuid" in task), "fold-inert: no parent (R4)");
  assert.deepEqual(task.childUuids, [], "fold-inert: no children (R4)");
  assert.equal(task.unresolvedConflict, false);
});

test("022 document mode: the roll-up yields zero drafts — checkboxes, WP headings and prose are documentation (FR-005)", () => {
  const rollUp = [
    "---",
    "mission: 001-demo",
    "---",
    "",
    "# 001-demo — Tasks",
    "",
    "## Work Package WP01: Scaffold",
    "- [ ] T001 Create the scaffold",
    "- [ ] T002 Implement charging",
    "",
    "## Dependencies",
    "T002 depends on T001.",
    "",
  ].join("\n");
  const { file, exclusions, warnings } = parseTaskFile("kitty-specs/001-demo/tasks.md", rollUp, kitty, cfg);
  assert.deepEqual(file.tasks, [], "tasks.md never identifies (C2.2)");
  assert.deepEqual(exclusions, [], "zero line-scanning: no checklist/summary/roll-up exclusion records either");
  assert.deepEqual(warnings, []);
});

test("022 document mode: a claimed non-recognizing file (notes.md) yields zero drafts — no fall-through (C2.3)", () => {
  const notes = ["# Notes", "", "- [ ] remember the release checklist", ""].join("\n");
  const { file, exclusions } = parseTaskFile("kitty-specs/001-demo/tasks/notes.md", notes, kitty, cfg);
  assert.deepEqual(file.tasks, [], "in the collection, but no id anywhere ⇒ zero documents");
  assert.deepEqual(exclusions, [], "not line-scanned");
});

test("022 document mode: Tnnn ids and DoD checkboxes are never extraction inputs (FR-004)", () => {
  const { file } = parseTaskFile("kitty-specs/001-demo/tasks/wp02-lane/WP02-payments.md", WP_DOC, kitty, cfg);
  assert.equal(file.tasks.length, 1, "five checkboxes, still ONE task");
  assert.deepEqual(
    file.tasks.map((t) => t.localTaskId),
    ["WP02"],
    "lane directory + file-name token: WP02 identifies via fileNameIdPattern (C2.1)",
  );
});

test("022 document mode: a front-matter-only document yields one draft with an EMPTY body (C3.3)", () => {
  const { file } = parseTaskFile(
    "kitty-specs/001-demo/tasks/wp03-skeleton.md",
    ["---", "work_package_id: wp03", "---", ""].join("\n"),
    kitty,
    cfg,
  );
  assert.equal(file.tasks.length, 1);
  const task = file.tasks[0];
  assert.equal(task.localTaskId, "WP03");
  assert.equal(task.title, "Skeleton", "cascade falls to the readable file-name slug — never the identifier token (C3.1, R6)");
  assert.ok(
    task.taskBody.startLine > task.taskBody.endLine,
    `empty body is startLine > endLine (${task.taskBody.startLine} > ${task.taskBody.endLine}): the mirrored slice is visibly empty, never a silent drop`,
  );
});

test("022 document mode: conflict markers inside the document still set unresolvedConflict — the scan stays upstream (R4)", () => {
  const conflicted = [
    "---",
    "work_package_id: wp04",
    "---",
    "",
    "# Work Package WP04: Migrate",
    "<<<<<<< ours",
    "- our guidance",
    "=======",
    "- theirs",
    ">>>>>>> theirs",
    "",
  ].join("\n");
  const { file, conflictBlocks } = parseTaskFile("kitty-specs/001-demo/tasks/wp04-migrate.md", conflicted, kitty, cfg);
  assert.equal(conflictBlocks.length, 1, "the conflict scan is unchanged for document-mode files");
  assert.equal(file.tasks.length, 1);
  assert.equal(file.tasks[0].unresolvedConflict, true, "taskBody intersects the block (FR-009 equivalent)");
});

test("022 document mode: an unterminated front-matter fence is body, not front matter — the file still recognizes by name (R5)", () => {
  const { file } = parseTaskFile(
    "kitty-specs/001-demo/tasks/WP05-open.md",
    ["---", "work_package_id: wp05", "", "# Work Package WP05", ""].join("\n"),
    kitty,
    cfg,
  );
  assert.equal(file.tasks.length, 1, "no closing fence ⇒ no front matter ⇒ file-name token identifies");
  const task = file.tasks[0];
  assert.equal(task.localTaskId, "WP05");
  assert.equal(task.title, "Work Package WP05", "the leading heading wins over the slug; the --- lines are body");
  assert.equal(task.taskBody.startLine, 1, "the whole file is the body");
});
