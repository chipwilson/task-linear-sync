/**
 * T017 [US2] — `deriveTitle` unit tests (FR-003/FR-004/FR-005; contracts/title-derivation.md
 * § Normative behavior 1–7): first-match-wins with `matchedRuleIndex`, pass-through default,
 * `<Feature_Name>: ` decoration on EVERY path (consumer rule / no match / pass-through),
 * idempotent re-derivation, and no prefix without a `Feature_Name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTitle } from "../../src/titles/derive.js";
import {
  absentAttrRules,
  areaRuleSet,
  areaStripPrefixes,
  bareCatchAllRules,
  decoratedTitle,
  makeTitleSlice,
  unmatchedRules,
} from "../fixtures/routing-titles/title-fixtures.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";

const FEATURE = "user-authentication";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("titles derive — first matching rule wins with its matchedRuleIndex (FR-003 AC1)", () => {
  const cfg = makeTitleSlice({ titleRules: areaRuleSet });
  // Rule 0: infrastructure area + local ID.
  const infra = deriveTitle(
    makeTask({ filePath: "specs/infra/auth/spec.md", localTaskId: "Task 1.2", title: "Add login flow" }),
    cfg,
  );
  assert.equal(infra.matchedRuleIndex, 0);
  assert.equal(infra.baseTitle, "<areaPrefixA> Task 1.2: Add login flow");
  assert.equal(infra.defaulted, false);
  // Rule 1: delivery area with phase (a rule with an earlier index and non-matching guard loses).
  const delivery = deriveTitle(
    makeTask({ filePath: "specs/delivery/pipeline/spec.md", phase: "Setup", title: "Ship it" }),
    cfg,
  );
  assert.equal(delivery.matchedRuleIndex, 1);
  assert.equal(delivery.baseTitle, "<areaPrefixB> Phase Setup: Ship it");
  // Rule 2: same area, no phase.
  const noPhase = deriveTitle(makeTask({ filePath: "specs/delivery/release.md", title: "Tag it" }), cfg);
  assert.equal(noPhase.matchedRuleIndex, 2);
  assert.equal(noPhase.baseTitle, "<areaPrefixB>: Tag it");
  // Rule 3: checklist child (raw {title}).
  const child = deriveTitle(makeTask({ filePath: "specs/other/misc.md", parentUuid: "uuid-parent-1", title: "Sub step" }), cfg);
  assert.equal(child.matchedRuleIndex, 3);
  assert.equal(child.baseTitle, "Sub step");
  // Rule 4: the bare-template catch-all takes everything else.
  const rest = deriveTitle(makeTask({ filePath: "specs/other/misc.md", title: "Anything" }), cfg);
  assert.equal(rest.matchedRuleIndex, 4);
  assert.equal(rest.baseTitle, "<areaPrefixC>: Anything");
  // Deterministic: same inputs → byte-identical derivation.
  assert.deepEqual(deriveTitle(makeTask({ filePath: "specs/other/misc.md", title: "Anything" }), cfg), rest);
});

test("titles derive — a matched rule with an absent attribute yields '' plus the indicator (FR-003 AC1)", () => {
  const cfg = makeTitleSlice({ titleRules: absentAttrRules });
  const derived = deriveTitle(makeTask({ featureName: FEATURE, title: "No phase here" }), cfg);
  assert.equal(derived.matchedRuleIndex, 0, "featureName guard matched");
  assert.equal(derived.baseTitle, "[] No phase here");
  assert.deepEqual(derived.unresolvedPlaceholders, ["phase"]);
  // 001 R6.5: substituted empty string + indicator — never left literal, never an abort.
  assert.ok(!derived.finalTitle.includes("{phase"));
});

test("titles pass-through — no rule matches, or none configured (FR-003 AC2)", () => {
  const derived = deriveTitle(makeTask({ title: "Carry through", localTaskId: "T009" }), makeTitleSlice({ titleRules: unmatchedRules }));
  assert.equal(derived.baseTitle, "Carry through");
  assert.equal(derived.matchedRuleIndex, -1);
  assert.equal(derived.defaulted, true);
  assert.deepEqual(derived.unresolvedPlaceholders, []);

  const empty = deriveTitle(makeTask({ title: "Default rule set" }), makeTitleSlice());
  assert.equal(empty.baseTitle, "Default rule set");
  assert.equal(empty.matchedRuleIndex, -1);
  assert.equal(empty.defaulted, true);
});

test("titles derive — a bare-template catch-all is a consumer rule (index 0), NOT pass-through", () => {
  const derived = deriveTitle(makeTask({ title: "Bare" }), makeTitleSlice({ titleRules: bareCatchAllRules }));
  assert.equal(derived.matchedRuleIndex, 0);
  assert.equal(derived.defaulted, false);
  assert.equal(derived.baseTitle, "Bare");
});

test("titles derive — the feature prefix is applied on every path exactly once (FR-004 AC3)", () => {
  const task = (filePath: string, extra = {}) =>
    makeTask({ filePath, featureName: FEATURE, title: "Decorate me", localTaskId: "Task 1.2", ...extra });
  const paths = [
    deriveTitle(task("specs/infra/auth/spec.md"), makeTitleSlice({ titleRules: areaRuleSet })), // consumer rule
    deriveTitle(task("specs/nowhere/x.md"), makeTitleSlice({ titleRules: areaRuleSet, titleStripPrefixes: areaStripPrefixes })), // catch-all rule
    deriveTitle(task("specs/x/y.md"), makeTitleSlice({ titleRules: unmatchedRules })), // no match → pass-through
    deriveTitle(task("specs/x/y.md"), makeTitleSlice()), // built-in pass-through
  ];
  for (const derived of paths) {
    assert.ok(derived.finalTitle.startsWith("user-authentication: "), `missing prefix: ${derived.finalTitle}`);
    assert.equal(
      countOccurrences(derived.finalTitle, "user-authentication: "),
      1,
      `prefix must appear exactly once: ${derived.finalTitle}`,
    );
    assert.equal(derived.decorated, true);
  }
});

test("titles derive idempotent — repeated derivation of the same task is byte-identical (FR-004)", () => {
  const cfg = makeTitleSlice({ titleRules: areaRuleSet, titleStripPrefixes: areaStripPrefixes });
  const task = makeTask({
    filePath: "specs/infra/auth/spec.md",
    featureName: FEATURE,
    localTaskId: "Task 1.2",
    title: "Add login flow",
  });
  const first = deriveTitle(task, cfg);
  const second = deriveTitle(task, cfg);
  assert.equal(second.finalTitle, first.finalTitle);
  assert.deepEqual(second, first);
  // Re-deriving over a tracker title that already carries the prefix is a no-op (001 R6.10).
  const again = deriveTitle(makeTask({ ...task, title: decoratedTitle }), makeTitleSlice());
  assert.equal(again.finalTitle, decoratedTitle, "already-prefixed title is retained unchanged");
});

test("titles no-feature — a task without a Feature_Name is never prefixed (FR-005 AC5)", () => {
  const without = makeTask({ filePath: "specs/infra/auth/spec.md", localTaskId: "Task 1.2", title: "No feature here" });
  const viaRule = deriveTitle(without, makeTitleSlice({ titleRules: areaRuleSet }));
  assert.equal(viaRule.finalTitle, viaRule.baseTitle);
  assert.equal(viaRule.decorated, false);
  const viaPass = deriveTitle(without, makeTitleSlice());
  assert.equal(viaPass.finalTitle, "No feature here");
  assert.equal(viaPass.decorated, false);
  assert.ok(!viaPass.finalTitle.includes(": user"), "no feature prefix added");
});
