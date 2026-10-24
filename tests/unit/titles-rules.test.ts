/**
 * T014 [US2] — `parseTitleRules` + `evaluateGuard` unit tests (research R2 grammar;
 * data-model.md §3–4). The parser is TOTAL (a bare template is a catch-all); malformed
 * rules throw the typed, index-carrying `TitleRuleParseError`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTitleRules, TitleRuleParseError } from "../../src/titles/rules.js";
import { evaluateGuard } from "../../src/titles/match.js";
import type { TitlePredicate } from "../../src/titles/types.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";
import { areaRuleSet } from "../fixtures/routing-titles/title-fixtures.js";

test("titles rules — each rule splits on the first ' => ' into guard and template", () => {
  const [rule] = parseTitleRules(["featureName, phase => [{phase}] {title}"]);
  assert.ok(rule);
  assert.equal(rule.order, 0);
  assert.equal(rule.template, "[{phase}] {title}");
  assert.deepEqual(rule.when, [
    { attr: "featureName", negated: false, op: "present" },
    { attr: "phase", negated: false, op: "present" },
  ]);
  // Only the FIRST ' => ' splits — later arrows stay part of the template.
  const [second] = parseTitleRules(["kind=heading => a => b"]);
  assert.equal(second?.template, "a => b");
});

test("titles rules — a bare template (no ' => ') is a catch-all with no guard", () => {
  const [rule] = parseTitleRules(["<areaPrefixC>: {title}"]);
  assert.ok(rule);
  assert.equal(rule.when, undefined, "absent guard ⇒ matches every task");
  assert.equal(rule.template, "<areaPrefixC>: {title}");
});

test("titles rules — a literal arrow escaped as '\\=>' is stored unescaped in the template", () => {
  const [rule] = parseTitleRules(["localId => map \\=> title"]);
  assert.equal(rule?.template, "map => title");
  const [bare] = parseTitleRules(["plain \\=> arrow, still catch-all"]);
  assert.equal(bare?.when, undefined);
  assert.equal(bare?.template, "plain => arrow, still catch-all");
});

test("titles rules — config order is preserved in `order` (first-match-wins scan order)", () => {
  const rules = parseTitleRules(areaRuleSet);
  assert.equal(rules.length, areaRuleSet.length);
  rules.forEach((rule, i) => assert.equal(rule.order, i));
});

test("titles rules — malformed rules throw TitleRuleParseError carrying index + rule", () => {
  const malformed: Array<[string, string]> = [
    ["bogus=1 => tpl", "unknown attribute"],
    ["framework~x => tpl", "'~' only for path"],
    [" => tpl", "empty guard"],
    ["localId,,phase => tpl", "empty condition"],
    ["localId= => tpl", "missing literal"],
    ["local id => tpl", "not a condition"],
    ["=x => tpl", "condition missing attribute"],
  ];
  malformed.forEach(([source, why], i) => {
    const raw = ["{title}", source];
    assert.throws(
      () => parseTitleRules(raw),
      (err: unknown) => {
        assert.ok(err instanceof TitleRuleParseError, `${source} (${why}): wrong error type`);
        assert.equal(err.index, 1, `error must carry the offending array index (${source})`);
        assert.equal(err.rule, source, "error must carry the rule source text");
        return true;
      },
      `expected TitleRuleParseError for '${source}' (${why})`,
    );
    assert.ok(i >= 0);
  });
});

test("titles rules — every predicate form parses to data (attr/negated/op/value)", () => {
  const [rule] = parseTitleRules([
    "!featureName, localId=T007, path~specs/api/, kind=checklist, !child, issueRef, framework=spec-kit => {title}",
  ]);
  assert.deepEqual(rule?.when, [
    { attr: "featureName", negated: true, op: "present" },
    { attr: "localId", negated: false, op: "eq", value: "T007" },
    { attr: "path", negated: false, op: "startsWith", value: "specs/api/" },
    { attr: "kind", negated: false, op: "eq", value: "checklist" },
    { attr: "child", negated: true, op: "present" },
    { attr: "issueRef", negated: false, op: "present" },
    { attr: "framework", negated: false, op: "eq", value: "spec-kit" },
  ] satisfies readonly TitlePredicate[]);
});

test("titles guard — evaluateGuard honors present / negated / eq / startsWith / child / issueRef", () => {
  const task = makeTask({
    featureName: "user-authentication",
    localTaskId: "Task 1.2",
    phase: "Setup",
    frameworkId: "kiro",
    kind: "checklist",
    filePath: "specs/api/auth/spec.md",
    parentUuid: "uuid-parent-1",
    issueRef: { key: "SYNC", number: 7 },
  });

  const p = (attr: TitlePredicate["attr"], op: TitlePredicate["op"], value?: string, negated = false): TitlePredicate => ({
    attr,
    negated,
    op,
    ...(value === undefined ? {} : { value }),
  });

  // present: defined and non-empty.
  assert.equal(evaluateGuard([p("featureName", "present")], task), true);
  assert.equal(evaluateGuard([p("phase", "present")], task), true);
  assert.equal(evaluateGuard([p("featureName", "present")], makeTask({ featureName: "" })), false, '"" counts as absent');
  assert.equal(evaluateGuard([p("featureName", "present")], makeTask()), false);
  // Negation inverts.
  assert.equal(evaluateGuard([p("localId", "present", undefined, true)], makeTask()), true);
  // eq maps framework ⇔ frameworkId and kind ⇔ kind.
  assert.equal(evaluateGuard([p("framework", "eq", "kiro")], task), true);
  assert.equal(evaluateGuard([p("framework", "eq", "spec-kit")], task), false);
  assert.equal(evaluateGuard([p("kind", "eq", "checklist")], task), true);
  assert.equal(evaluateGuard([p("localId", "eq", "Task 1.2")], task), true);
  assert.equal(evaluateGuard([p("phase", "eq", "Setup")], task), true);
  // startsWith ⇔ filePath.startsWith(value).
  assert.equal(evaluateGuard([p("path", "startsWith", "specs/api/")], task), true);
  assert.equal(evaluateGuard([p("path", "startsWith", "specs/other/")], task), false);
  // child ⇔ parentUuid defined; issueRef ⇔ issueRef defined. Presence-only attrs never eq.
  assert.equal(evaluateGuard([p("child", "present")], task), true);
  assert.equal(evaluateGuard([p("child", "present")], makeTask()), false);
  assert.equal(evaluateGuard([p("child", "eq", "x")], task), false, "no string-equality semantics for child");
  assert.equal(evaluateGuard([p("issueRef", "eq", "x")], task), false, "no string-equality semantics for issueRef");
  assert.equal(evaluateGuard([p("issueRef", "present")], task), true);
  assert.equal(evaluateGuard([p("issueRef", "present")], makeTask()), false);
  // AND over all predicates; empty list (catch-all) ⇒ true.
  assert.equal(
    evaluateGuard([p("featureName", "present"), p("path", "startsWith", "specs/api/"), p("kind", "eq", "heading")], task),
    false,
  );
  assert.equal(evaluateGuard([], task), true, "empty predicate list matches every task");
});
