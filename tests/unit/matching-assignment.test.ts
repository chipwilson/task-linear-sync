/**
 * T018 [US1] — assignment unit tests (FR-004 verbatim): "solve a maximum-weight
 * one-to-one assignment (each task at most one issue, each issue at most one task),
 * selecting deterministically among equally optimal solutions so unchanged inputs
 * reproduce matches byte-for-byte". SC-003 verbatim: "On exhaustive small-case
 * fixtures (≤8 tasks × ≤8 issues), the assignment weight equals brute-force optimum
 * in 100% of cases." Forbidden (non-usable) cells never selected; dummy weight-0
 * rows/columns mean "leave unmatched"; equally-optimal alternatives resolve to the
 * lexicographically-smallest optimal matching (research R4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { assignUsable } from "task-linear-sync/matching";
import type { PairScore } from "task-linear-sync/matching";
import {
  bruteForceOptimum,
  generatePairMatrices,
  shuffle,
} from "../helpers/matching-corpus.js";
import { makePair } from "../helpers/matching-factory.js";

function pairsFromMatrix(matrix: {
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  readonly weights: ReadonlyArray<ReadonlyArray<number | null>>;
}): PairScore[] {
  const pairs: PairScore[] = [];
  matrix.rowIds.forEach((rowId, r) => {
    matrix.colIds.forEach((colId, c) => {
      const w = matrix.weights[r]?.[c];
      if (w === null || w === undefined) return;
      pairs.push(makePair(rowId, colId, w));
    });
  });
  return pairs;
}

const selectedSet = (selected: readonly PairScore[]): string[] =>
  selected.map((p) => `${p.taskUuid}→${p.issueId}`).sort();

test("matching assignment: SC-003 — total weight equals the brute-force optimum on every ≤8×8 corpus", () => {
  const cases = generatePairMatrices(20261006, 150);
  let mismatches = 0;
  for (const matrix of cases) {
    const selected = assignUsable(pairsFromMatrix(matrix));
    // one-to-one validity
    const tasks = new Set<string>();
    const issues = new Set<string>();
    for (const p of selected) {
      assert.ok(!tasks.has(p.taskUuid), "each task at most one issue");
      assert.ok(!issues.has(p.issueId), "each issue at most one task");
      tasks.add(p.taskUuid);
      issues.add(p.issueId);
    }
    const total = selected.reduce((sum, p) => sum + p.total, 0);
    const optimum = bruteForceOptimum(matrix.weights);
    if (total !== optimum) mismatches += 1;
    assert.equal(total, optimum, `optimal weight for case with ${matrix.rowIds.length}×${matrix.colIds.length}`);
  }
  assert.equal(mismatches, 0, "100% equality (SC-003)");
});

test("matching assignment: forbidden (non-usable) cells are never selected", () => {
  const usable = makePair("c0000000-0000-4000-8000-000000000001", "i-0001", 20);
  const gated = makePair("c0000000-0000-4000-8000-000000000001", "i-0002", 999, {
    usable: false,
    exclusion: "gated-team",
  });
  const belowFloor = makePair("c1000000-0000-4000-8000-000000000002", "i-0002", 500, {
    usable: false,
    exclusion: "below-plausible",
  });
  const selected = assignUsable([gated, usable, belowFloor]);
  assert.deepEqual(selectedSet(selected), ["c0000000-0000-4000-8000-000000000001→i-0001"]);
});

test("matching assignment: globally optimal beat-greedy — a greedy first-by-score picks the wrong pairing", () => {
  // Greedy would take t2→i1 (90) first, orphaning t1 (only usable cell). OPT: t1→i1 + t2→i2 = 110.
  const t1 = "d1000000-0000-4000-8000-000000000001";
  const t2 = "d2000000-0000-4000-8000-000000000002";
  const pairs = [makePair(t2, "i-0001", 90), makePair(t1, "i-0001", 80), makePair(t2, "i-0002", 30)];
  const selected = assignUsable(pairs);
  const total = selected.reduce((s, p) => s + p.total, 0);
  assert.equal(total, 110, "maximum weight, not greedy");
  assert.deepEqual(
    selectedSet(selected),
    [`${t1}→i-0001`, `${t2}→i-0002`].sort(),
  );
});

test("matching assignment: equally-optimal solutions resolve to the lexicographically-smallest matching", () => {
  // Two optimal 36-point matchings; rows sort tA < tB, columns i1 < i2 ⇒ tA→i1, tB→i2 wins.
  const tA = "e1000000-0000-4000-8000-000000000001";
  const tB = "e2000000-0000-4000-8000-000000000002";
  const pairs = [
    makePair(tA, "i-0001", 18),
    makePair(tA, "i-0002", 18),
    makePair(tB, "i-0001", 18),
    makePair(tB, "i-0002", 18),
  ];
  assert.deepEqual(selectedSet(assignUsable(pairs)), [`${tA}→i-0001`, `${tB}→i-0002`].sort());
  // The tie-break is invariant to the ORDER the pairs arrive in.
  for (const seed of [11, 22, 33, 44]) {
    assert.deepEqual(selectedSet(assignUsable(shuffle(pairs, seed))), [`${tA}→i-0001`, `${tB}→i-0002`].sort());
  }
});

test("matching assignment: preference is task-side-first — contested single issue goes to the lexicographically-smallest task", () => {
  const tA = "e3000000-0000-4000-8000-000000000001";
  const tB = "e4000000-0000-4000-8000-000000000002";
  const pairs = [makePair(tA, "i-0001", 18), makePair(tB, "i-0001", 18)];
  assert.deepEqual(selectedSet(assignUsable(pairs)), [`${tA}→i-0001`], "tie → lowest canonical row wins");
});

test("matching assignment: tasks/issues with no usable cell stay unmatched (dummy 0-weight semantics)", () => {
  const t1 = "e5000000-0000-4000-8000-000000000001";
  const _t2 = "e6000000-0000-4000-8000-000000000002"; // has NO pairs at all (unmatched)
  const selected = assignUsable([makePair(t1, "i-0001", 25)]);
  assert.deepEqual(selectedSet(selected), [`${t1}→i-0001`], "t2 lands unresolved via dummy weight 0");
});

test("matching assignment: more tasks than issues — the right tasks win, one-to-one holds", () => {
  const t1 = "e7000000-0000-4000-8000-000000000001";
  const t2 = "e8000000-0000-4000-8000-000000000002";
  const t3 = "e9000000-0000-4000-8000-000000000003";
  const pairs = [
    makePair(t1, "i-0001", 30),
    makePair(t2, "i-0001", 40),
    makePair(t3, "i-0001", 20),
    makePair(t1, "i-0002", 25),
  ];
  const selected = assignUsable(pairs);
  const total = selected.reduce((s, p) => s + p.total, 0);
  assert.equal(total, 40 + 25, "t2→i-0001 + t1→i-0002 optimal (t3 unmatched)");
  assert.equal(selected.length, 2);
});

test("matching assignment: permutation invariance of the selected set across 50 matrices × 4 shuffles", () => {
  for (const [caseIndex, matrix] of generatePairMatrices(777, 50).entries()) {
    const pairs = pairsFromMatrix(matrix);
    const baseline = selectedSet(assignUsable(pairs));
    for (const seed of [caseIndex * 101 + 1, caseIndex * 101 + 2, caseIndex * 101 + 3, caseIndex * 101 + 4]) {
      assert.deepEqual(selectedSet(assignUsable(shuffle(pairs, seed))), baseline, `case ${caseIndex} seed ${seed}`);
    }
  }
});

test("matching assignment: selected output is in canonical task order (stableUuid ascending)", () => {
  const matrix = {
    rowIds: ["z9", "a1", "m5"].map((s) => `${s}0000000-0000-4000-8000-000000000000`.slice(0, 36)),
    colIds: ["i-0001", "i-0002", "i-0003"],
    weights: [
      [20, null, null],
      [null, 21, null],
      [null, null, 22],
    ],
  } as const;
  const pairs = pairsFromMatrix(matrix as unknown as Parameters<typeof pairsFromMatrix>[0]);
  const selected = assignUsable(pairs);
  const uuids = selected.map((p) => p.taskUuid);
  assert.deepEqual(uuids, [...uuids].sort(), "canonical ordering");
});

test("matching assignment: empty pair list ⇒ empty assignment (empty candidate pool edge)", () => {
  assert.deepEqual(assignUsable([]), []);
});
