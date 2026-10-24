/**
 * T019 [US1] — alternatives unit tests (FR-006 verbatim): "retain up to three
 * alternative candidates per match, ordered by descending score with deterministic
 * tie-breaks, each annotated mapped or unmapped" (spec AC6). Ranked by
 * `(score desc, issueId asc)` over the task's OTHER candidates — gated and
 * below-plausible candidates included — truncated to 3; `mapped: true` iff that
 * alternative is itself selected for some task in the same assignment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchAllTasks } from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makeTask } from "../helpers/matching-factory.js";
import { shuffle } from "../helpers/matching-corpus.js";

const config = defaultConfig();

const TASK_A = "a1000000-0000-4000-8000-00000000000a";
const TASK_B = "b1000000-0000-4000-8000-00000000000b";
const TASK_C = "c1000000-0000-4000-8000-00000000000c";

const TITLE_A = "alpha bravo charlie";

function taskA() {
  return makeTask({ stableUuid: TASK_A, title: TITLE_A, issueRef: { key: "SYNC", number: 1000 } });
}
function taskB() {
  return makeTask({ stableUuid: TASK_B, title: "zulu echo" });
}
function taskC() {
  return makeTask({ stableUuid: TASK_C, title: TITLE_A });
}

function corpus() {
  const tasks = [{ task: taskA() }, { task: taskB() }, { task: taskC() }];
  const candidates = [
    makeCandidate({ issueId: "i-0001", issueKey: "ENG-1000", title: TITLE_A }), // ref 500 + exact 60
    makeCandidate({ issueId: "i-0002", issueKey: "ENG-2002", title: TITLE_A }), // exact 60
    makeCandidate({ issueId: "i-0003", issueKey: "ENG-2003", title: "alpha bravo charlie delta" }), // contained 39
    makeCandidate({ issueId: "i-0004", issueKey: "ENG-2004", title: "alpha bravo delta echo" }), // fuzzy 20
    makeCandidate({ issueId: "i-0005", issueKey: "ENG-2005", title: "x ray Quebec" }), // zero signals
    makeCandidate({ issueId: "i-0006", issueKey: "ENG-2006", title: "zulu echo" }), // B's match
  ];
  return { tasks, candidates };
}

test("matching alternatives: ≤3, descending score, tie-break issueId, excludes the selected issue, mapped flags", () => {
  const { tasks, candidates } = corpus();
  const result = matchAllTasks(tasks, candidates, config);
  const matchA = result.matches.find((m) => m.taskUuid === TASK_A)!;
  assert.ok(matchA, "task A matched");
  assert.equal(matchA.issueId, "i-0001", "ref+exact (560) is A's optimum");
  assert.deepEqual(matchA.alternatives, [
    { issueId: "i-0002", score: 60, mapped: true }, // C is assigned i-0002 ⇒ mapped
    { issueId: "i-0003", score: 39, mapped: false },
    { issueId: "i-0004", score: 20, mapped: false },
    // i-0005 (score 0) is fourth ⇒ truncated at three
  ]);
  assert.ok(matchA.alternatives.length <= 3);
  assert.ok(!matchA.alternatives.some((a) => a.issueId === matchA.issueId), "selected issue excluded");
});

test("matching alternatives: deterministic tie-break orders equal scores by issueId ascending", () => {
  const tasks = [{ task: makeTask({ stableUuid: "f1000000-0000-4000-8000-000000000001", title: TITLE_A }) }];
  const candidates = [
    makeCandidate({ issueId: "i-0001", issueKey: "ENG-1001", title: TITLE_A }), // exact 60 — matched
    makeCandidate({ issueId: "i-0009", issueKey: "ENG-1009", title: TITLE_A }), // exact 60 — tied
    makeCandidate({ issueId: "i-0002", issueKey: "ENG-1002", title: TITLE_A }), // exact 60 — tied
    makeCandidate({ issueId: "i-0004", issueKey: "ENG-1004", title: "alpha bravo charlie delta" }), // 39
    makeCandidate({ issueId: "i-0003", issueKey: "ENG-1003", title: "alpha bravo charlie delta" }), // 39 — tied
  ];
  const match = matchAllTasks(tasks, candidates, config).matches[0]!;
  assert.equal(match.issueId, "i-0001", "lexicographically-smallest optimum wins");
  assert.deepEqual(match.alternatives.map((a) => a.issueId), ["i-0002", "i-0009", "i-0003"]);
  assert.deepEqual(match.alternatives.map((a) => a.score), [60, 60, 39]);
  assert.deepEqual(match.alternatives.map((a) => a.mapped), [false, false, false]);
});

test("matching alternatives: gated and below-plausible candidates may appear as alternatives (never as selections)", () => {
  const tasks = [
    {
      task: makeTask({ stableUuid: "a2000000-0000-4000-8000-000000000001", title: TITLE_A }),
      routing: { teamKey: "acme-team", project: "proj-alpha", defaulted: false as const },
    },
  ];
  const candidates = [
    makeCandidate({ issueId: "i-0001", issueKey: "ENG-1001", title: TITLE_A, teamKey: "acme-team", projectRef: "proj-alpha" }),
    // High-scoring but gated-out (differing project) — excluded from selection, kept as alternative.
    makeCandidate({ issueId: "i-0002", issueKey: "ENG-1002", title: "alpha bravo charlie delta echo foxtrot", teamKey: "acme-team", projectRef: "proj-beta" }),
    // Below-plausible (zero signals) — still an alternative candidate.
    makeCandidate({ issueId: "i-0003", issueKey: "ENG-1003", title: "oscar pigeon romeo" }),
  ];
  const result = matchAllTasks(tasks, candidates, config);
  const match = result.matches[0]!;
  assert.equal(match.issueId, "i-0001");
  const alt1 = match.alternatives.find((a) => a.issueId === "i-0002");
  assert.ok(alt1, "gated high-scorer retained as alternative");
  assert.ok(alt1.score >= 30, "carries its raw score");
  const alt2 = match.alternatives.find((a) => a.issueId === "i-0003");
  assert.ok(alt2, "below-plausible retained as alternative");
  assert.equal(alt2.score, 0);
});

test("matching alternatives: ordering and mapped annotations are stable across input permutations (AC6)", () => {
  const { tasks, candidates } = corpus();
  const baseline = JSON.stringify(matchAllTasks(tasks, candidates, config).matches);
  for (const seed of [3, 5, 7, 11, 13]) {
    const result = matchAllTasks(shuffle(tasks, seed), shuffle(candidates, seed * 1000), config);
    assert.equal(JSON.stringify(result.matches), baseline, `seed ${seed}`);
  }
});

test("matching alternatives: matches with no other candidates carry an empty alternatives list", () => {
  const tasks = [{ task: taskB() }];
  const candidates = [makeCandidate({ issueId: "i-0006", issueKey: "ENG-2006", title: "zulu echo" })];
  const match = matchAllTasks(tasks, candidates, config).matches[0]!;
  assert.equal(match.issueId, "i-0006");
  assert.deepEqual(match.alternatives, []);
});
