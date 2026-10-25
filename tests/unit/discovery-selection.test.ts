/**
 * T022 [US2] — selection-matrix unit tests per FR-008 verbatim (contracts/framework-adapter.md
 * rule 2; research R8): marker-based inference, longest-`matchedPattern` rank (`.kiro/specs/`
 * 12 chars beating `specs/` 6), conjunctive spec-kit rule, disjunctive open-spec/bmad rules,
 * siblings-only matches contributing rank-key 0, precedence-index then alphabetical
 * tie-break, `overrides.precedence`/`overrides.selection` (fixed + predicate) short-circuit,
 * unknown explicit id → typed error, zero-match generic fallback (US2 AC1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { SelectionOverrideError, createAdapterRegistry, selectAdapter } from "task-linear-sync/discovery";
import type { AdapterRegistry, DetectionContext, DetectionRecord } from "task-linear-sync/discovery";

const registry = createAdapterRegistry(builtInDefaults);

function ctx(repoRelativePosixPath: string, siblingFileNames: readonly string[]): DetectionContext {
  return { repoRelativePosixPath, siblingFileNames, specsBaseDirectories: builtInDefaults.specsBaseDirectories };
}

function select(filePath: string, siblingFileNames: readonly string[], reg: AdapterRegistry = registry): DetectionRecord {
  return selectAdapter(filePath, ctx(filePath, siblingFileNames), reg);
}

test("discovery selection: kiro wins beneath .kiro/specs/ — the 12-char `.kiro/specs/` pattern beats spec-kit's 6-char `specs/` substring", () => {
  const record = select(".kiro/specs/auth/tasks.md", ["design.md", "requirements.md", "tasks.md"]);
  assert.equal(record.adapterId, "kiro");
  assert.equal(record.frameworkId, "kiro");
  assert.equal(record.matchedPattern, ".kiro/specs/");
  assert.equal(record.matchedPattern.length, 12, "rank material: `.kiro/specs/` (12) beats `specs/` (6) — research R8");
  assert.equal(record.via, "path");
  assert.deepEqual(record.candidates, ["kiro"], "spec-kit is NOT a candidate: its rule is conjunctive and spec.md/plan.md are absent");
});

test("discovery selection: spec-kit is CONJUNCTIVE — beneath specs/ AND with a spec.md/plan.md sibling", () => {
  const record = select("specs/pay/tasks.md", ["spec.md", "plan.md", "tasks.md"]);
  assert.equal(record.adapterId, "spec-kit");
  assert.equal(record.via, "path+siblings");
  assert.equal(record.matchedPattern, "specs/");
  assert.deepEqual(record.candidates, ["spec-kit"]);
});

test("discovery selection: a specs/ file WITHOUT spec.md/plan.md siblings falls through to the generic fallback", () => {
  const record = select("specs/no-sibs/tasks.md", ["tasks.md"]);
  assert.equal(record.adapterId, "generic");
  assert.equal(record.frameworkId, "generic");
  assert.equal(record.via, "fallback");
  assert.equal(record.matchedPattern, "");
  assert.deepEqual(record.candidates, [], "zero matches — US2 AC1 generic fallback");
});

test("discovery selection: open-spec wins by pathContains marker on openspec/ paths", () => {
  const record = select("openspec/cart/tasks.md", ["proposal.md", "tasks.md"]);
  assert.equal(record.adapterId, "open-spec");
  assert.equal(record.via, "path+siblings");
  assert.equal(record.matchedPattern, "openspec/");
});

test("discovery selection: sibling-only markers — open-spec via openspec.json/proposal.md with via 'siblings' and rank-key 0", () => {
  const record = select("notes/tasks.md", ["openspec.json", "tasks.md"]);
  assert.equal(record.adapterId, "open-spec");
  assert.equal(record.via, "siblings");
  assert.equal(record.matchedPattern, "", "a siblings-only match contributes \"\" (rank key 0) — research R8");
});

test("discovery selection: sibling-only markers — bmad via prd.md/architecture.md", () => {
  const record = select("notes/tasks.md", ["prd.md", "tasks.md"]);
  assert.equal(record.adapterId, "bmad");
  assert.equal(record.via, "siblings");
  assert.equal(record.matchedPattern, "");
});

test("discovery selection: equal-length ties resolve by precedence index (open-spec before bmad by the fixed list)", () => {
  const record = select("notes/tasks.md", ["openspec.json", "prd.md", "tasks.md"]);
  assert.deepEqual(record.candidates, ["bmad", "open-spec"], "candidates sorted alphabetically");
  assert.equal(record.adapterId, "open-spec", "precedence [kiro, open-spec, spec-kit, bmad, generic]: open-spec index 1 < bmad index 3");
});

test("discovery selection: equal-length AND equal-unknown-precedence ties fall to the alphabetical adapter id", () => {
  const reg = createAdapterRegistry(builtInDefaults, { precedence: ["kiro", "spec-kit", "generic"] });
  const record = select("notes/tasks.md", ["openspec.json", "prd.md", "tasks.md"], reg);
  assert.equal(record.adapterId, "bmad", "both rank beyond the precedence list — alphabetical: bmad < open-spec");
});

test("discovery selection: overrides.precedence reorders the tie — bmad first now wins it", () => {
  const reg = createAdapterRegistry(builtInDefaults, { precedence: ["bmad", "open-spec", "kiro", "spec-kit", "generic"] });
  const record = select("notes/tasks.md", ["openspec.json", "prd.md", "tasks.md"], reg);
  assert.equal(record.adapterId, "bmad");
});

test("discovery selection: explicit fixed selection short-circuits detection with via 'explicit'", () => {
  const reg = createAdapterRegistry(builtInDefaults, { selection: "kiro" });
  const record = select("specs/pay/tasks.md", ["spec.md", "plan.md", "tasks.md"], reg);
  assert.equal(record.adapterId, "kiro");
  assert.equal(record.frameworkId, "kiro");
  assert.equal(record.via, "explicit");
});

test("discovery selection: explicit predicate selection — returns an id to force it, undefined to defer to marker selection", () => {
  const reg = createAdapterRegistry(builtInDefaults, {
    selection: (filePath: string) => (filePath.startsWith("openspec/") ? "open-spec" : undefined),
  });
  const forced = select("specs/pay/tasks.md".replace("specs/pay", "openspec/pay"), ["spec.md"], reg);
  assert.equal(forced.adapterId, "open-spec");
  assert.equal(forced.via, "explicit");
  const deferred = select("specs/pay/tasks.md", ["spec.md", "plan.md"], reg);
  assert.equal(deferred.adapterId, "spec-kit", "predicate returned undefined — markers decide");
});

test("discovery selection: an explicit fixed id outside the enabled pool raises the typed SelectionOverrideError", () => {
  const reg = createAdapterRegistry(builtInDefaults, { selection: "nope" });
  assert.throws(
    () => select("specs/pay/tasks.md", ["spec.md"], reg),
    (err: unknown) => {
      if (!(err instanceof SelectionOverrideError)) throw new Error(`expected SelectionOverrideError, got ${String(err)}`);
      assert.equal(err.requestedId, "nope");
      assert.match(err.message, /nope/);
      return true;
    },
  );
});

test("discovery selection: pure and deterministic — identical inputs yield byte-identical records (Principle IV)", () => {
  const a = select(".kiro/specs/auth/tasks.md", ["design.md", "requirements.md", "tasks.md"]);
  const b = select(".kiro/specs/auth/tasks.md", ["design.md", "requirements.md", "tasks.md"]);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
