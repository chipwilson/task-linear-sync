/**
 * T020 [US1] — determinism + serialization unit tests.
 * `serializeMatchingResult` is stable-key-sorted JSON (002 `canonicalizePlanJson`
 * discipline); SC-002 verbatim: "Two consecutive matching runs over identical inputs
 * produce byte-for-byte identical assignment output (determinism), across 100
 * randomized fixtures." Permutation invariance: results byte-identical after
 * shuffling task and candidate arrays with independent seeds (research R7).
 * Arrays keep their canonical order — never re-sorted at serialize time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchAllTasks, serializeMatchingResult } from "task-linear-sync/matching";
import type { MatchingResult } from "task-linear-sync/matching";
import { defaultConfig } from "../helpers/matching-factory.js";
import { generateCorpus, shuffle } from "../helpers/matching-corpus.js";

const config = defaultConfig();

test("matching serialize: stable key-sorted JSON (canonical 002 discipline)", () => {
  const result: MatchingResult = {
    matches: [
      {
        taskUuid: "t",
        issueId: "i",
        score: 1,
        margin: 2,
        confidence: "high",
        durableIdentity: false,
        reasons: ["title-exact"],
        alternatives: [], // kept empty: a nested alternatives entry would nest its own
        // "issueId" key and collide with the Match-level key-order probes below.
      },
    ],
    unresolved: [{ taskUuid: "u", band: "unmatched", bestScore: 3 }],
    unmappedIssues: ["i3"],
  };
  const json = serializeMatchingResult(result);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(result)));
  // Match-object keys appear in ascending (sorted) order.
  const indexOf = (key: string): number => json.indexOf(`"${key}"`);
  assert.ok(indexOf("alternatives") < indexOf("confidence"));
  assert.ok(indexOf("confidence") < indexOf("durableIdentity"));
  assert.ok(indexOf("durableIdentity") < indexOf("issueId"));
  assert.ok(indexOf("issueId") < indexOf("margin"));
  assert.ok(indexOf("margin") < indexOf("reasons"));
  assert.ok(indexOf("reasons") < indexOf("score"));
  assert.ok(indexOf("score") < indexOf("taskUuid"));
  // Insertion order of the source object is irrelevant — same bytes.
  const rebuilt = serializeMatchingResult(JSON.parse(json) as MatchingResult);
  assert.equal(rebuilt, json);
});

test("matching serialize: arrays keep their canonical order, never re-sorted at serialize time", () => {
  const result: MatchingResult = {
    matches: [],
    unresolved: [
      { taskUuid: "z-task", band: "unmatched" },
      { taskUuid: "a-task", band: "unmatched" },
    ],
    unmappedIssues: ["i-0002", "i-0001"],
  };
  const json = serializeMatchingResult(result);
  assert.ok(json.indexOf("z-task") < json.indexOf("a-task"), "array order preserved verbatim");
  assert.ok(json.indexOf("i-0002") < json.indexOf("i-0001"));
});

test("matching serialize: undefined diagnostics (absent bestScore) are omitted, not null", () => {
  const json = serializeMatchingResult({
    matches: [],
    unresolved: [{ taskUuid: "t", band: "unmatched" }],
    unmappedIssues: [],
  });
  assert.ok(!json.includes("bestScore"), "canonical JSON drops undefined values (002 discipline)");
});

test("matching determinism: SC-002 — 100 randomized seeded fixtures run byte-identically twice, and under permutation", () => {
  let checked = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const corpus = generateCorpus({
      seed,
      tasks: 12,
      extraIssues: 4,
      durableRate: (seed % 4) / 4, // 0.0, 0.25, 0.5, 0.75
      refRate: ((seed + 1) % 4) / 4,
    });
    const run1 = serializeMatchingResult(matchAllTasks([...corpus.inputs], [...corpus.candidates], config));
    const run2 = serializeMatchingResult(matchAllTasks([...corpus.inputs], [...corpus.candidates], config));
    assert.equal(run1, run2, `seed ${seed}: consecutive runs byte-identical`);

    // Independent shuffle seeds for the two input arrays (research R7).
    const shuffledTasks = shuffle(corpus.inputs, seed * 7919 + 17);
    const shuffledCandidates = shuffle(corpus.candidates, seed * 104729 + 23);
    const permuted = serializeMatchingResult(matchAllTasks(shuffledTasks, shuffledCandidates, config));
    assert.equal(permuted, run1, `seed ${seed}: permutation-invariant bytes (SC-002)`);
    checked += 1;
  }
  assert.equal(checked, 100, "100/100 byte-identical (SC-002)");
});

test("matching determinism: two identical corpora from the same seed serialize identically", () => {
  const a = generateCorpus({ seed: 4242, tasks: 8, extraIssues: 3, durableRate: 0.5, refRate: 0.4 });
  const b = generateCorpus({ seed: 4242, tasks: 8, extraIssues: 3, durableRate: 0.5, refRate: 0.4 });
  assert.equal(
    serializeMatchingResult(matchAllTasks(a.inputs, a.candidates, config)),
    serializeMatchingResult(matchAllTasks(b.inputs, b.candidates, config)),
  );
});

test("matching determinism: empty inputs serialize to a stable canonical form", () => {
  const json = serializeMatchingResult(matchAllTasks([], [], config));
  assert.equal(json, '{"matches":[],"unmappedIssues":[],"unresolved":[]}');
});
