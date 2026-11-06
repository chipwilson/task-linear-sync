/**
 * T020 — unit tests for pure condition evaluation (data-model §3; R5/R6/R7).
 * Predicates, strict-exceeding vs binary trigger semantics, toggle matrix,
 * protection-skip classification, stable order, determinism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CONDITION_IDS, evaluateConditions, loadReportArtifact } from "task-linear-sync/ci";

import { fixtureReport } from "../helpers/ci-harness.js";

import type {
  EvaluationResult,
  ParsedReport,
  ReportEntryView,
} from "task-linear-sync/ci";

type CondSettings = Parameters<typeof evaluateConditions>[1];

function entry(over: Partial<ReportEntryView> = {}): ReportEntryView {
  return {
    issueId: "TLS-1",
    confidence: "high",
    reasons: [],
    changedFields: [],
    expectedMarkdownChanges: [],
    unresolvedConflict: false,
    ...over,
  };
}

function reportOf(...entries: ReportEntryView[]): ParsedReport {
  return { planId: "a".repeat(64), path: "/fixture/report.json", entries };
}

function condSettings(over: Partial<CondSettings> = {}): CondSettings {
  return {
    failOnUnmapped: true,
    unmappedThreshold: 0,
    failOnConflicts: true,
    failOnDrift: true,
    driftThreshold: 0,
    protectedBranches: ["main"],
    targetBranch: "main",
    ...over,
  };
}

const TRIGGERED_PROTECTED = condSettings();

test("CONDITION_IDS is the stable (a)(b)(c) order", () => {
  assert.deepEqual([...CONDITION_IDS], [
    "unmapped-high-confidence",
    "unresolved-conflict-block",
    "spec-drift",
  ]);
});

test("(a) counts ONLY confidence high AND issueId null", () => {
  const r = evaluateConditions(
    reportOf(
      entry({ confidence: "high", issueId: null }),
      entry({ confidence: "high", issueId: "TLS-2" }),
      entry({ confidence: "medium", issueId: null }),
      entry({ confidence: "unmatched", issueId: null }),
      entry({ confidence: "low", issueId: null }),
    ),
    condSettings(),
  );
  assert.equal(r.counts.unmappedHighConfidence, 1);
});

test("(b) counts ONLY unresolvedConflict === true (conflict decision WITHOUT the flag does not count)", () => {
  const r = evaluateConditions(
    reportOf(
      entry({ unresolvedConflict: true }),
      entry({ unresolvedConflict: true, issueId: "TLS-9" }),
      entry({ unresolvedConflict: false }),
    ),
    TRIGGERED_PROTECTED,
  );
  assert.equal(r.counts.unresolvedConflictBlocks, 2);
});

test("(c) counts matched entries via reasons/changedFields/markdown; skip-recorded spec-changed DOES count", () => {
  const r = evaluateConditions(
    reportOf(
      entry({ issueId: "TLS-1", reasons: ["conflict:spec-changed"] }),
      entry({ issueId: "TLS-2", reasons: ["conflict:both-changed"] }),
      entry({ issueId: "TLS-3", changedFields: ["description"] }),
      entry({ issueId: "TLS-4", expectedMarkdownChanges: ["- [ ] a -> - [x] a"] }),
      entry({ issueId: "TLS-5", reasons: ["title-exact"] }),
      entry({ issueId: null, reasons: ["conflict:spec-changed"] }), // unmatched band: never counts
      entry({ issueId: null, changedFields: ["title"] }), // create entry: never counts
      entry({ issueId: "TLS-8", reasons: ["conflict:linear-changed"] }), // alone: not a drift reason
    ),
    TRIGGERED_PROTECTED,
  );
  assert.equal(r.counts.specDrift, 4);
});

test("(a)/(c) trigger STRICTLY above threshold — at-threshold passes", () => {
  const one = reportOf(entry({ confidence: "high", issueId: null }), entry({ issueId: "TLS-2", changedFields: ["title"] }));
  const at = evaluateConditions(one, condSettings({ unmappedThreshold: 1, driftThreshold: 1 }));
  assert.deepEqual(at.triggered, []);
  const above = evaluateConditions(one, condSettings({ unmappedThreshold: 0, driftThreshold: 0 }));
  assert.deepEqual(above.triggered, [
    { condition: "unmapped-high-confidence", count: 1 },
    { condition: "spec-drift", count: 1 },
  ]);
});

test("(b) is BINARY (count >= 1) AND requires targetBranch in protectedBranches", () => {
  const conflict = reportOf(entry({ unresolvedConflict: true }));
  const targeted = evaluateConditions(conflict, condSettings({ protectedBranches: ["main", "release"], targetBranch: "release" }));
  assert.deepEqual(targeted.triggered, [{ condition: "unresolved-conflict-block", count: 1 }]);
  const untargeted = evaluateConditions(conflict, condSettings({ protectedBranches: ["main"], targetBranch: "feature" }));
  assert.deepEqual(untargeted.triggered, []);
  assert.equal(untargeted.protectionSkipped, false, "classified branch — no skip warning");
});

test("protectionSkipped: enabled (b) + empty protected set OR null target ⇒ true and (b) never triggers", () => {
  const conflict = reportOf(entry({ unresolvedConflict: true }), entry({ unresolvedConflict: true }));
  const emptySet = evaluateConditions(conflict, condSettings({ protectedBranches: [], targetBranch: null }));
  assert.equal(emptySet.protectionSkipped, true);
  assert.deepEqual(emptySet.triggered, []);
  assert.equal(emptySet.counts.unresolvedConflictBlocks, 2);
  const nullTarget = evaluateConditions(conflict, condSettings({ protectedBranches: ["main"], targetBranch: null }));
  assert.equal(nullTarget.protectionSkipped, true);
  assert.deepEqual(nullTarget.triggered, []);
});

test("disabled conditions are counted but NEVER enter triggered (per-condition)", () => {
  const all = reportOf(
    entry({ confidence: "high", issueId: null }),
    entry({ unresolvedConflict: true }),
    entry({ issueId: "TLS-3", reasons: ["conflict:spec-changed"] }),
  );
  const off = evaluateConditions(all, condSettings({ failOnUnmapped: false, failOnConflicts: false, failOnDrift: false }));
  assert.deepEqual(off.counts, { unmappedHighConfidence: 1, unresolvedConflictBlocks: 1, specDrift: 1 });
  assert.deepEqual(off.triggered, []);
  assert.equal(off.protectionSkipped, false, "disabled (b) cannot be skipped");
  const aOnly = evaluateConditions(all, condSettings({ failOnConflicts: false, failOnDrift: false }));
  assert.deepEqual(aOnly.triggered.map((t) => t.condition), ["unmapped-high-confidence"]);
});

test("full 2×2×2 toggle matrix over the violates-all-three fixture (counts 1/2/3)", () => {
  const report = loadReportArtifact(fixtureReport("violates-all-three.json"));
  const enabledNames = (r: EvaluationResult): string[] => r.triggered.map((t) => t.condition);
  for (const a of [true, false]) {
    for (const b of [true, false]) {
      for (const c of [true, false]) {
        const r = evaluateConditions(report, condSettings({ failOnUnmapped: a, failOnConflicts: b, failOnDrift: c }));
        assert.deepEqual(r.counts, { unmappedHighConfidence: 1, unresolvedConflictBlocks: 2, specDrift: 3 });
        const expected = [
          ...(a ? ["unmapped-high-confidence"] : []),
          ...(b ? ["unresolved-conflict-block"] : []),
          ...(c ? ["spec-drift"] : []),
        ];
        assert.deepEqual(enabledNames(r), expected, `a=${a} b=${b} c=${c}`);
        assert.equal(r.protectionSkipped, false, "targeted branch context — never skipped");
      }
    }
  }
  // untargeted matrix leg: (b) enabled + targeted fires; enabled + untargeted never fires.
  const targeted = evaluateConditions(report, condSettings());
  assert.deepEqual(targeted.triggered, [
    { condition: "unmapped-high-confidence", count: 1 },
    { condition: "unresolved-conflict-block", count: 2 },
    { condition: "spec-drift", count: 3 },
  ], "all-on names all three with counts in stable order");
});

test("deterministic: same bytes ⇒ identical results (pure)", () => {
  const report = loadReportArtifact(fixtureReport("drift-boundaries.json"));
  const first = evaluateConditions(report, condSettings());
  const second = evaluateConditions(report, condSettings());
  assert.deepEqual(first, second);
});
