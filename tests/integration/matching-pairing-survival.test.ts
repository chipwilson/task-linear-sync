/**
 * T036 — SC-001 survival suite (spec verbatim): "In a 100-task fixture with renames,
 * moves, and checkbox flips, ≥95% of tasks retain their correct issue pairing across
 * re-runs, and 100% of durable-identity pairs survive title or container changes
 * without orphaning." Seeded corpora from `tests/helpers/matching-corpus.ts`; the
 * mutation pass (`mutateCorpus`) rewrites titles, relocates durable candidates across
 * teams/projects/frameworks, and flips `checked` — identity (issue ids, durable uuids,
 * task stable uuids, refs, local task ids) is preserved throughout (002 `taskStableSeed`
 * posture: `checked` is excluded from identity).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchAllTasks } from "task-linear-sync/matching";
import { defaultConfig } from "../helpers/matching-factory.js";
import { generateCorpus, mutateCorpus, type Corpus } from "../helpers/matching-corpus.js";

const config = defaultConfig();

function survival(c: Corpus, inputs: Corpus["inputs"], candidates: Corpus["candidates"]) {
  const result = matchAllTasks(inputs, candidates, config);
  const byTask = new Map(result.matches.map((m) => [m.taskUuid, m]));
  let total = 0;
  let retained = 0;
  let durableTotal = 0;
  let durableRetained = 0;
  let durableOrphaned = 0;
  for (const [taskUuid, issueId] of c.truth) {
    total += 1;
    const match = byTask.get(taskUuid);
    const durable = c.durableTaskUuids.has(taskUuid);
    if (durable) durableTotal += 1;
    if (match !== undefined && match.issueId === issueId) {
      retained += 1;
      if (durable) durableRetained += 1;
    } else if (durable) {
      durableOrphaned += 1;
    }
  }
  return {
    rate: retained / total,
    durableRate: durableRetained / durableTotal,
    durableOrphaned,
    total,
    durableTotal,
  };
}

test("matching survival SC-001: baseline 100-task corpora pair correctly before mutation", () => {
  for (const seed of [11, 22, 33]) {
    const corpus = generateCorpus({ seed, tasks: 100, extraIssues: 20, durableRate: 0.5, refRate: 0.3 });
    const stats = survival(corpus, corpus.inputs, corpus.candidates);
    assert.equal(stats.total, 100);
    assert.ok(stats.rate >= 0.99, `seed ${seed}: baseline pairing ${stats.rate} (truth is correct-by-construction)`);
  }
});

/**
 * Clause 1 — "In a 100-task fixture with renames, moves, and checkbox flips … ≥95% of
 * tasks retain their correct issue pairing across re-runs." The mutation pass applies
 * all three axes at once per re-run; renames follow the committed `moved/` fixture
 * exemplar (token-preserving Linear rewrites — the pairing's evidence degrades but does
 * not vanish), matching how the spec's own US2 fixtures demonstrate a rename.
 */
test("matching survival SC-001: renames + moves + checkbox flips across re-runs keep ≥95% of correct pairings", () => {
  let overallMin = 1;
  for (const seed of [101, 202, 303, 404, 505]) {
    const corpus = generateCorpus({ seed, tasks: 100, extraIssues: 20, durableRate: 0.5, refRate: 0.3 });
    const baseline = survival(corpus, corpus.inputs, corpus.candidates);
    assert.ok(baseline.rate >= 0.95, `seed ${seed}: baseline ≥ 95% (${baseline.rate})`);
    for (const rerun of [1, 2]) {
      const mutated = mutateCorpus(corpus, seed + rerun, {
        renameTitles: true,
        moveContainers: true,
        flipCheckboxes: true,
      });
      const stats = survival(mutated, mutated.inputs, mutated.candidates);
      overallMin = Math.min(overallMin, stats.rate);
      assert.ok(stats.rate >= 0.95, `seed ${seed} re-run ${rerun}: survival ${stats.rate.toFixed(4)} < 0.95`);
    }
  }
  assert.ok(overallMin >= 0.95, "SC-001 ≥95% pairing survival across re-runs");
});

test("matching survival SC-001: 100% of durable pairs survive title AND container changes without orphaning", () => {
  for (const seed of [101, 202, 303, 404, 505]) {
    const corpus = generateCorpus({ seed, tasks: 100, extraIssues: 20, durableRate: 0.5, refRate: 0.3 });
    const mutated = mutateCorpus(corpus, seed + 7, {
      renameTitles: true,
      moveContainers: true,
      flipCheckboxes: true,
    });
    const stats = survival(mutated, mutated.inputs, mutated.candidates);
    assert.ok(stats.durableTotal > 0, `seed ${seed}: corpora carry durable pairs`);
    assert.equal(stats.durableRate, 1, `seed ${seed}: every durable pair must survive (constitution II)`);
    assert.equal(stats.durableOrphaned, 0, `seed ${seed}: a durable match was orphaned`);
  }
});

test("matching survival SC-001: re-runs over the same mutated inputs are byte-stable", () => {
  const corpus = generateCorpus({ seed: 606, tasks: 100, extraIssues: 15, durableRate: 0.5, refRate: 0.3 });
  const mutated = mutateCorpus(corpus, 607, { renameTitles: true, moveContainers: true, flipCheckboxes: true });
  const first = matchAllTasks(mutated.inputs, mutated.candidates, config);
  const second = matchAllTasks([...mutated.inputs].reverse(), [...mutated.candidates].reverse(), config);
  assert.deepEqual(second.matches, first.matches, "deterministic optimum across the survival workload too");
});
