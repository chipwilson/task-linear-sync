/**
 * T002 [Foundational] — 021 amendment A-021-2 local-identifier grammar matrix
 * (contract C6/C7; research R6; data-model § 4). Written test-first: the
 * dotted-numeric-without-separator capture (C7) and the digit-required word-form
 * branch (C6) FAIL until `headingIdGrammar` (`src/config/defaults.ts`) and
 * `LOCAL_ID_SPAN_RE` (`src/parsing/content.ts`) are amended; every "unchanged"
 * case is a regression guard pinning what must NOT shift.
 *
 * Pure unit tier: content strings in through `parseTaskFile` at the SHIPPED
 * default config (checkbox-only docs keep the lines depth-1 survivors, so the
 * red/green signal is the id grammar itself, never the title-heading rule).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult, TaskFileAdapter } from "task-linear-sync/parsing";

import { genericFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig(); // shipped defaults — no overrides (the reported defect's setting)
const PATH = "docs/demo/tasks.md";

function parse(content: string, adapter: TaskFileAdapter = genericFixtureAdapter): ParseResult {
  return parseTaskFile(PATH, content, adapter, cfg);
}

/** Exactly one task expected; returns it. */
function soleTask(content: string, adapter?: TaskFileAdapter) {
  const r = parse(content, adapter);
  assert.equal(r.file.tasks.length, 1, `expected exactly one task, got ${String(r.file.tasks.length)}`);
  const task = r.file.tasks[0];
  assert.ok(task);
  return task;
}

// ── C7 — checklist dotted-numeric capture without a trailing separator ───────────

test("local-id span — dotted-numeric checklist id captures separator-free (A-021-2, C7, V8)", () => {
  // Verbatim line shape from the reported file.
  const task = soleTask("- [x] 4.1 Create EC2 client wrapper with retry logic\n  - Detail bullet is content\n");
  assert.equal(task.localTaskId, "4.1", "dotted-numeric capture requires whitespace + text after the id");
  assert.equal(task.title, "Create EC2 client wrapper with retry logic");
  assert.equal(task.checked, true);
});

test("local-id span — multi-level dotted id captures separator-free (A-021-2, C7)", () => {
  const task = soleTask("- [x] 1.2.3 Three-level dotted identifier\n");
  assert.equal(task.localTaskId, "1.2.3");
  assert.equal(task.title, "Three-level dotted identifier");
});

test("local-id span — bare integer ids still require their trailing separator (A-021-2, C7)", () => {
  // Unchanged: `1.` keeps capturing via the separator span…
  const kept = soleTask("- [x] 1. Set up project structure and dependencies\n");
  assert.equal(kept.localTaskId, "1");
  assert.equal(kept.title, "Set up project structure and dependencies");

  // …while a bare integer followed by plain words captures NOTHING ("2 of 3" is prose).
  const none = soleTask("- [ ] 2 of 3 done\n");
  assert.equal(none.localTaskId, undefined, "bare integers still require a trailing separator");
  assert.equal(none.title, "2 of 3 done", "the whole line text is the title");
});

test("local-id span — separator spans are unchanged (Task 2.1: / 1.2.3: forms, data-model § 4)", () => {
  const taskForm = soleTask("- [ ] Task 2.1: Orchestrate the handler\n");
  assert.equal(taskForm.localTaskId, "Task 2.1");
  assert.equal(taskForm.title, "Orchestrate the handler");

  const dottedSep = soleTask("- [ ] 1.2.3: Separator span unchanged\n");
  assert.equal(dottedSep.localTaskId, "1.2.3");
  assert.equal(dottedSep.title, "Separator span unchanged");
});

// ── C6 — heading word-form ids must contain a digit ───────────────────────────────

test("heading grammar — an ordinary title yields NO id and keeps its full text (A-021-2, C6)", () => {
  const task = soleTask("# Implementation Plan\n\nPreamble prose.\n");
  assert.equal(task.kind, "heading", "the heading task itself is preserved (corpus model)");
  assert.equal(task.localTaskId, undefined, "word-form ids MUST contain at least one digit");
  assert.equal(task.title, "Implementation Plan", "NOT `Plan` — the spec edge case");
});

test("heading grammar — digit-bearing word-form ids keep capturing unchanged (C6)", () => {
  const cases: ReadonlyArray<[string, string, string]> = [
    ["# TASK-1: Boot", "TASK-1", "Boot"],
    ["## SYNC1: Boot", "SYNC1", "Boot"],
    ["# FOUND-1 Deploy the function", "FOUND-1", "Deploy the function"],
    ["# ACME-2: Release the kit", "ACME-2", "Release the kit"],
    ["# T001 Open the ticket", "T001", "Open the ticket"],
  ];
  for (const [line, id, title] of cases) {
    const task = soleTask(`${line}\n`);
    assert.equal(task.localTaskId, id, `id capture for ${JSON.stringify(line)}`);
    assert.equal(task.title, title, `title for ${JSON.stringify(line)}`);
  }
});

// ── V9 — adapter-supplied checklistIdPattern keeps precedence ─────────────────────

test("local-id span — adapter checklistIdPattern overrides the built-in span (V9)", () => {
  // An adapter grammar the built-in span CANNOT match: capture here proves precedence;
  // the same line under the default adapter captures nothing.
  const adapterOwned: TaskFileAdapter = {
    id: "generic",
    featureName: () => undefined,
    checklistIdPattern: "^(?<id>ABC-[0-9]+)[ \\t]+",
  };
  const viaAdapter = soleTask("- [ ] ABC-7 Adapter-owned identifier\n", adapterOwned);
  assert.equal(viaAdapter.localTaskId, "ABC-7", "adapter grammar wins over the built-in span");
  assert.equal(viaAdapter.title, "Adapter-owned identifier");

  const viaBuiltIn = soleTask("- [ ] ABC-7 Adapter-owned identifier\n");
  assert.equal(viaBuiltIn.localTaskId, undefined, "the built-in span leaves this text alone");
});
