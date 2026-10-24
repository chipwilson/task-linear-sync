/**
 * T016 [US2] — `decorateFeaturePrefix` + `stripTitleForRender` unit tests (research R4/R6;
 * 001 R6.6/R6.8–R6.12): decorate prepends `<Feature_Name>: ` exactly once and is idempotent;
 * strip removes, from the front and IN ORDER, the feature prefix, each configured strip
 * prefix, a redundant leading `[confirmationKey-N]` issue prefix, and a duplicate leading
 * `<localTaskId>: ` prefix — preserving all other title characters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decorateFeaturePrefix } from "../../src/titles/decorate.js";
import { stripTitleForRender } from "../../src/titles/strip.js";
import {
  allPrefixedTitle,
  decoratedTitle,
  issuePrefixedTitle,
  localIdPrefixedTitle,
  makeTitleSlice,
} from "../fixtures/routing-titles/title-fixtures.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";

const FEATURE = "user-authentication";

test("titles decorate — prepends '<featureName>: ' exactly once (FR-004)", () => {
  assert.equal(decorateFeaturePrefix("Add login flow", FEATURE), "user-authentication: Add login flow");
  // Exactly once — decorating an already-decorated title is a byte-identical no-op (001 R6.10).
  const once = decorateFeaturePrefix("Add login flow", FEATURE);
  assert.equal(decorateFeaturePrefix(once, FEATURE), once, "no second occurrence");
  assert.equal(
    decorateFeaturePrefix(decorateFeaturePrefix(once, FEATURE), FEATURE),
    once,
    "idempotent across repeated derivations",
  );
});

test("titles decorate — a title already carrying the exact prefix is retained unchanged", () => {
  assert.equal(decorateFeaturePrefix(decoratedTitle, FEATURE), decoratedTitle);
  // Only the EXACT leading prefix counts — fuzzy/inner matches still get decorated.
  assert.equal(decorateFeaturePrefix(`see: ${decoratedTitle}`, FEATURE), `user-authentication: see: ${decoratedTitle}`);
  assert.equal(decorateFeaturePrefix("user-authentication:extra", FEATURE), `user-authentication: user-authentication:extra`);
});

test("titles decorate — absent or empty featureName is a no-op (FR-005)", () => {
  assert.equal(decorateFeaturePrefix("Add login flow", undefined), "Add login flow");
  assert.equal(decorateFeaturePrefix("Add login flow", ""), "Add login flow");
});

test("titles strip — removes the decorated prefix set from the front, in order (FR-004 AC4)", () => {
  const task = makeTask({
    featureName: FEATURE,
    localTaskId: "Task 1.2",
    issueRef: { key: "SYNC", number: 7 },
    title: "ignored",
  });
  assert.equal(
    stripTitleForRender(allPrefixedTitle, task, makeTitleSlice()),
    "Rotate signing keys",
    "feature prefix → redundant [SYNC-7] issue prefix → duplicate 'Task 1.2: ' local-ID prefix",
  );
});

test("titles strip — configured titleStripPrefixes are removed after the feature prefix", () => {
  const task = makeTask({ featureName: FEATURE, title: "ignored" });
  const cfg = makeTitleSlice({ titleStripPrefixes: ["[CUSTOM] ", "<areaPrefixB> Phase Setup: "] });
  assert.equal(
    stripTitleForRender("user-authentication: [CUSTOM] <areaPrefixB> Phase Setup: Ship it", task, cfg),
    "Ship it",
  );
  // Each configured entry removes at most its one leading occurrence.
  assert.equal(stripTitleForRender("[CUSTOM] [CUSTOM] inner", task, cfg), "[CUSTOM] inner");
});

test("titles strip — default strip removes ONLY the local-ID prefix and redundant issue prefix (001 R6.7)", () => {
  const withLocal = makeTask({ localTaskId: "Task 1.2", title: "ignored" });
  assert.equal(stripTitleForRender(localIdPrefixedTitle, withLocal, makeTitleSlice()), "Wire session store");
  assert.equal(stripTitleForRender(issuePrefixedTitle, withLocal, makeTitleSlice()), "Fix token refresh");
  // No other prefix is touched by the built-in default strip…
  assert.equal(
    stripTitleForRender("[CUSTOM] other: Task 1.2: mid", withLocal, makeTitleSlice()),
    "[CUSTOM] other: Task 1.2: mid",
    "nothing leading matches the default set — every character preserved",
  );
  // …and with no localTaskId the duplicate local-ID removal does not apply ("only when the
  // preserved line already carries that identifier" — 001 R5.2/R6.7).
  assert.equal(
    stripTitleForRender(localIdPrefixedTitle, makeTask({ title: "ignored" }), makeTitleSlice()),
    localIdPrefixedTitle,
  );
});

test("titles strip — recognizes the issue prefix by the CONFIGURED confirmationKey only", () => {
  const task = makeTask({ title: "ignored" });
  const custom = makeTitleSlice({ confirmationKey: "TASKSYNC" });
  assert.equal(stripTitleForRender("[TASKSYNC-3] Move it", task, custom), "Move it");
  assert.equal(
    stripTitleForRender("[SYNC-3] Move it", task, custom),
    "[SYNC-3] Move it",
    "a foreign key bracket is not the tool's own issue prefix",
  );
});

test("titles strip — preserves all other characters unchanged (001 R6.6)", () => {
  const task = makeTask({ featureName: FEATURE, title: "ignored" });
  const tricky = `user-authentication: Keep [SYNC-9] Task 1.2: inner — and {chars} ✓`;
  assert.equal(
    stripTitleForRender(tricky, task, makeTitleSlice()),
    "Keep [SYNC-9] Task 1.2: inner — and {chars} ✓",
    "only the LEADING feature prefix is removed; inner occurrences are content",
  );
});

test("titles strip — empty input and non-prefixed titles round through untouched", () => {
  const task = makeTask({ featureName: FEATURE, localTaskId: "T007", title: "ignored" });
  assert.equal(stripTitleForRender("", task, makeTitleSlice()), "");
  assert.equal(stripTitleForRender("Plain title", task, makeTitleSlice()), "Plain title");
});
