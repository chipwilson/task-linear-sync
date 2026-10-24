/**
 * T017 [US1] — banding + margin unit tests.
 * FR-002 verbatim: "assign exactly one confidence band per match from {high, medium,
 * low, unmatched} from the configured floor thresholds"; R5 c2: "a score at or above
 * the medium floor SHALL be high or medium, a score at or above the plausible-match
 * floor but below the medium floor SHALL be low…". FR-005 verbatim: "downgrade a
 * high-confidence non-durable match to medium, with a recorded ambiguity reason, when
 * its margin to the next usable candidate is below the configured minimum"
 * (default `minimumMatchMargin: 10`; reason label `ambiguous-margin`).
 * Margin (glossary, both sides): `margin = total − max(next-best usable competitor of
 * the task, best usable rival of the issue)`; no competitor ⇒ `margin = total`;
 * frozen `Match.margin` is ">= 0" (a stronger rival clamps the margin to 0 — maximal
 * ambiguity, still a downgrade).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import { bandAndMargin } from "task-linear-sync/matching";
import type { PairScore } from "task-linear-sync/matching";
import { defaultConfig, makePair } from "../helpers/matching-factory.js";

const config = defaultConfig(); // floors { medium: 50, plausible: 18 }, margin 10

const T1 = "b1000000-0000-4000-8000-000000000001";
const T2 = "b2000000-0000-4000-8000-000000000002";
const I1 = "i-0001";
const I2 = "i-0002";
const I3 = "i-0003";

function bands(pairs: readonly PairScore[], cfg = config) {
  const matches = bandAndMargin(pairs, pairs, cfg);
  return matches;
}

test("matching bands: raw band from frozen floors — ≥50 starts high, [18,50) low", () => {
  const high = bands([makePair(T1, I1, 50)])[0]!;
  assert.equal(high.confidence, "high", "margin = total (50) ≥ minimum 10 ⇒ stays high");
  assert.equal(high.margin, 50, "no competitor ⇒ margin = total");
  assert.equal(bands([makePair(T1, I1, 49)])[0]!.confidence, "low");
  assert.equal(bands([makePair(T1, I1, 18)])[0]!.confidence, "low", "plausible boundary is usable-low");
  assert.equal(bands([makePair(T1, I1, 500)])[0]!.confidence, "high");
});

test("matching bands: exactly one band per emitted match from {high, medium, low}", () => {
  const matches = bands([
    makePair(T1, I1, 80),
    makePair(T2, I2, 25),
  ]);
  for (const m of matches) {
    assert.ok(["high", "medium", "low", "unmatched"].includes(m.confidence));
    assert.ok(Number.isInteger(m.margin) && m.margin >= 0, "margin integer ≥ 0");
    assert.ok(Number.isInteger(m.score) && m.score >= 0);
  }
});

test("matching bands: margin uses the STRONGER of task-side and issue-side usable competitors", () => {
  const selected = makePair(T1, I1, 80);
  const taskRival = makePair(T1, I2, 65); // task-side competitor
  const issueRival = makePair(T2, I1, 70); // issue-side competitor (stronger)
  const all = [selected, taskRival, issueRival];
  const match = bands(all)[0]!;
  assert.equal(match.margin, 80 - 70, "glossary: distance from both task and issue sides");
  assert.equal(match.confidence, "high", "margin 10 is NOT below the configured minimum 10");
});

test("matching bands: margin boundary — margin exactly minimumMatchMargin stays high, one below downgrades", () => {
  const stays = bands([makePair(T1, I1, 80), makePair(T2, I1, 70)])[0]!;
  assert.equal(stays.margin, 10);
  assert.equal(stays.confidence, "high");

  const down = bands([makePair(T1, I1, 80), makePair(T2, I1, 71)])[0]!;
  assert.equal(down.margin, 9);
  assert.equal(down.confidence, "medium", "FR-005: high → medium");
  assert.equal(down.reasons.filter((r) => r === "ambiguous-margin").length, 1, "ambiguity reason recorded exactly once");
  assert.equal(down.reasons[0], "title-exact", "signal labels come first");
  assert.equal(down.reasons[down.reasons.length - 1], "ambiguous-margin", "appended last");
});

test("matching bands: no competitor ⇒ margin = total; uncontested high stays high", () => {
  const match = bands([makePair(T1, I1, 55)])[0]!;
  assert.equal(match.margin, 55);
  assert.equal(match.confidence, "high");
});

test("matching bands: a stronger usable rival clamps margin to 0 (frozen Match.margin ≥ 0) and triggers downgrade", () => {
  const selected = makePair(T1, I1, 50);
  const dominantRival = makePair(T2, I1, 90); // solver chose the weaker pair; maximally contested
  const match = bands([selected, dominantRival])[0]!;
  assert.equal(match.margin, 0);
  assert.equal(match.confidence, "medium");
  assert.ok(match.reasons.includes("ambiguous-margin"));
});

test("matching bands: low-band matches are never downgraded (FR-005 targets high only)", () => {
  const match = bands([makePair(T1, I1, 30), makePair(T2, I1, 29)])[0]!;
  assert.equal(match.confidence, "low");
  assert.equal(match.margin, 1);
  assert.ok(!match.reasons.includes("ambiguous-margin"), "downgrade rule applies to the high band only");
});

test("matching bands: durable high matches NEVER downgrade regardless of margin (R5 c9)", () => {
  const durable = makePair(T1, I1, 80, { durableIdentity: true });
  const rival = makePair(T2, I1, 79);
  const match = bands([durable, rival])[0]!;
  assert.equal(match.margin, 1, "margin is still computed and reported");
  assert.equal(match.confidence, "high", "durable-identity match bypasses margin downgrade");
  assert.equal(match.durableIdentity, true);
  assert.ok(!match.reasons.includes("ambiguous-margin"));
});

test("matching bands: only usable rivals count as competitors", () => {
  const selected = makePair(T1, I1, 80);
  const usableWeak = makePair(T2, I1, 40);
  const selectedUsable = [selected, usableWeak];
  const withUnusable = [
    ...selectedUsable,
    makePair(T1, I2, 79, { usable: false, exclusion: "gated-team" }), // not a competitor
    makePair(T2, I1, 79, { usable: false, exclusion: "below-plausible" }),
  ];
  const match = bandAndMargin([selected], withUnusable, config)[0]!;
  assert.equal(match.margin, 80 - 40, "best USABLE rival only (the allUsable list holds usable pairs)");
  assert.equal(match.confidence, "high");
});

test("matching bands: floors and margin are configurable (intelligent defaults, overridable — constitution III)", () => {
  const custom = loadConfig({
    overrides: { confidenceFloors: { medium: 100, plausible: 40 }, minimumMatchMargin: 30 },
  });
  const match = bands([makePair(T1, I1, 60), makePair(T2, I1, 45)], custom)[0]!;
  assert.equal(match.confidence, "low", "60 < custom medium floor 100");
  const high = bands([makePair(T1, I1, 100), makePair(T2, I1, 80)], custom)[0]!;
  assert.equal(high.margin, 20);
  assert.equal(high.confidence, "medium", "margin 20 < custom minimum 30 ⇒ downgrade");
});

test("matching bands: emitted Match carries frozen-shape fields with no invention", () => {
  const match = bands([makePair(T1, I1, 90, { durableIdentity: false })])[0]!;
  assert.deepEqual(
    Object.keys(match).sort(),
    ["alternatives", "confidence", "durableIdentity", "issueId", "margin", "reasons", "score", "taskUuid"],
  );
  assert.deepEqual(match.alternatives, [], "alternatives are attached by the orchestrator (FR-006)");
  assert.equal(match.taskUuid, T1);
  assert.equal(match.issueId, I1);
  assert.equal(match.score, 90);
});

test("matching bands: reasons mirror the pair's signal contributions in deterministic order", () => {
  const pair = makePair(T1, I1, 100, {
    contributions: [
      { signal: "durable-uuid", points: 30, weight: 30 },
      { signal: "title-exact", points: 70, weight: 70 },
    ],
  });
  const match = bands([pair])[0]!;
  assert.deepEqual(match.reasons, ["durable-uuid", "title-exact"]);
});
