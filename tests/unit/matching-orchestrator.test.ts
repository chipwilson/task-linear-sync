/**
 * Quickstart US1 scenario 8 + orchestrator behaviors: `matchAllTasks` composition —
 * "Empty candidate pool: every task bands `unmatched`; output remains deterministic";
 * `unresolved` carries the `bestScore` diagnostic; `unmappedIssues` sorted ascending;
 * plan.md performance goal (100 tasks × 100 candidates score + assign well inside the
 * budget, generous wall-clock guard to stay non-flaky).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchAllTasks, serializeMatchingResult } from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makeTask } from "../helpers/matching-factory.js";

const config = defaultConfig();

test("matching empty pool: every task bands unmatched; output deterministic", () => {
  const tasks = [
    { task: makeTask({ stableUuid: "a0000000-0000-4000-8000-0000000000a1", title: "alpha" }) },
    { task: makeTask({ stableUuid: "b0000000-0000-4000-8000-0000000000b2", title: "bravo" }) },
  ];
  const result = matchAllTasks(tasks, [], config);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmappedIssues, []);
  assert.equal(result.unresolved.length, 2);
  for (const u of result.unresolved) assert.equal(u.band, "unmatched");
  assert.deepEqual(
    result.unresolved.map((u) => u.taskUuid),
    ["a0000000-0000-4000-8000-0000000000a1", "b0000000-0000-4000-8000-0000000000b2"],
    "canonical task order",
  );
  assert.equal(
    serializeMatchingResult(result),
    serializeMatchingResult(matchAllTasks(tasks, [], config)),
    "empty-pool output remains deterministic",
  );
});

test("matching empty pool: unresolved bestScore is the best USABLE total (absent when none usable)", () => {
  const t = makeTask({ stableUuid: "c0000000-0000-4000-8000-0000000000c3", title: "alpha bravo charlie" });
  const rival = makeTask({ stableUuid: "d0000000-0000-4000-8000-0000000000d4", title: "alpha bravo charlie" });
  const candidates = [
    makeCandidate({ issueId: "i-0001", issueKey: "ENG-1001", title: "alpha bravo charlie" }),
  ];
  const result = matchAllTasks([{ task: t }, { task: rival }], candidates, config);
  assert.equal(result.matches.length, 1, "one winner takes the single contested issue");
  assert.equal(result.unresolved.length, 1);
  const loser = result.unresolved[0]!;
  assert.equal(loser.band, "unmatched");
  assert.equal(loser.bestScore, 60, "best usable total (exact title) — diagnostic only");
  assert.deepEqual(result.unmappedIssues, [], "the contested issue was consumed");
});

test("matching orchestrator: unmatched issue ids surface sorted in unmappedIssues (013 input)", () => {
  const t = makeTask({ stableUuid: "e0000000-0000-4000-8000-0000000000e5", title: "solo task title" });
  const result = matchAllTasks(
    [{ task: t }],
    [
      makeCandidate({ issueId: "i-0009", issueKey: "ENG-1009", title: "solo task title" }),
      makeCandidate({ issueId: "i-0003", issueKey: "ENG-1003", title: "nothing matches here" }),
      makeCandidate({ issueId: "i-0007", issueKey: "ENG-1007", title: "unrelated issue body" }),
    ],
    config,
  );
  assert.deepEqual(result.unmappedIssues, ["i-0003", "i-0007"], "sorted ascending, excludes the matched issue");
});

test("matching orchestrator: canonical ordering independent of input array order", () => {
  const mk = (u: string, title: string) => ({ task: makeTask({ stableUuid: u, title }) });
  const a = mk("a5000000-0000-4000-8000-0000000000a5", "alpha one");
  const b = mk("b5000000-0000-4000-8000-0000000000b6", "bravo two");
  const c1 = makeCandidate({ issueId: "i-0001", issueKey: "ENG-1001", title: "alpha one" });
  const c2 = makeCandidate({ issueId: "i-0002", issueKey: "ENG-1002", title: "bravo two" });
  const run1 = matchAllTasks([a, b], [c1, c2], config);
  const run2 = matchAllTasks([b, a], [c2, c1], config);
  assert.equal(serializeMatchingResult(run1), serializeMatchingResult(run2));
  assert.deepEqual(
    run1.matches.map((m) => m.taskUuid),
    [...run1.matches.map((m) => m.taskUuid)].sort(),
    "matches ordered by stableUuid ascending",
  );
});

test("matching orchestrator: 100×100 corpora score + assign far inside the performance goal", () => {
  const tasks = Array.from({ length: 100 }, (_, i) => ({
    task: makeTask({
      stableUuid: `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      title: `pipeline stage ${i} sync report`,
      issueRef: i % 2 === 0 ? { key: "SYNC", number: 1000 + i } : undefined,
    }),
  }));
  const candidates = Array.from({ length: 100 }, (_, i) =>
    makeCandidate({
      issueId: `i-${String(i).padStart(4, "0")}`,
      issueKey: `ENG-${1000 + i}`,
      title: `pipeline stage ${i} sync report`,
      durableTaskUuid: i % 5 === 0 ? tasks[i]!.task.stableUuid : undefined,
    }),
  );
  const started = performance.now();
  const result = matchAllTasks(tasks, candidates, config);
  const elapsedMs = performance.now() - started;
  assert.equal(result.matches.length, 100, "full pairing");
  assert.ok(elapsedMs < 2000, `100×100 pipeline should stay fast (took ${elapsedMs.toFixed(1)}ms)`);
});
