/**
 * T015 [US2] — `renderTemplate` unit tests (research R5; data-model.md §5 placeholder set;
 * 001 R6.4/R6.5): every token of the normative set substitutes from task attributes; an
 * absent/empty attribute — or an unknown token — becomes `""` plus an indicator, never
 * literal text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderTemplate } from "../../src/titles/template.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";

test("titles template — substitutes the normative placeholder set", () => {
  const task = makeTask({
    title: "Add login flow",
    featureName: "user-authentication",
    localTaskId: "Task 1.2",
    frameworkId: "kiro",
    phase: "Setup",
    issueRef: { key: "SYNC", number: 42 },
  });
  const { text, unresolved } = renderTemplate(
    "{title} | {featureName} | {localId} | {framework} | {phase} | {prefix}",
    task,
  );
  assert.equal(text, "Add login flow | user-authentication | Task 1.2 | kiro | Setup | [SYNC-42]");
  assert.deepEqual(unresolved, []);
});

test("titles template — {feature} is an alias of {featureName} (indicator names featureName)", () => {
  const { text } = renderTemplate("{feature}", makeTask({ featureName: "payments-refund" }));
  assert.equal(text, "payments-refund");
  const { text: bare, unresolved } = renderTemplate("{feature}", makeTask());
  assert.equal(bare, "");
  assert.deepEqual(unresolved, ["featureName"], "the indicator is the canonical name");
});

test("titles pass-through — {prefix} renders the visible [KEY-N] issue reference", () => {
  const { text, unresolved } = renderTemplate("{prefix} {title}", makeTask({ title: "Fix", issueRef: { key: "SYNC", number: 7 } }));
  assert.equal(text, "[SYNC-7] Fix");
  assert.deepEqual(unresolved, []);
});

test("titles template — absent attributes become empty strings plus indicators, never literal", () => {
  const task = makeTask({ title: "Bare task" });
  const { text, unresolved } = renderTemplate("[{featureName}][{localId}][{phase}][{prefix}]{title}", task);
  assert.equal(text, "[][][][]Bare task");
  assert.deepEqual(unresolved, ["featureName", "localId", "phase", "prefix"]);
  assert.ok(!text.includes("{"), "no token is ever left literal");
});

test("titles template — an EMPTY (not just absent) attribute also yields the indicator", () => {
  const { text, unresolved } = renderTemplate("{phase}", makeTask({ phase: "" }));
  assert.equal(text, "");
  assert.deepEqual(unresolved, ["phase"]);
});

test("titles template — an unknown token is an indicator too, never left literal", () => {
  const { text, unresolved } = renderTemplate("A {bogusToken} B", makeTask({ title: "T" }));
  assert.equal(text, "A  B");
  assert.deepEqual(unresolved, ["bogusToken"]);
});

test("titles template — {title} and {framework} never resolve absent (required frozen fields)", () => {
  const { text, unresolved } = renderTemplate("{title}/{framework}", makeTask({ title: "", frameworkId: "generic" }));
  assert.equal(text, "/generic");
  assert.deepEqual(unresolved, [], "title may legitimately be empty text; framework is required");
});
