/**
 * T030 [US2] — durable-precedence unit tests (constitution II verbatim): "Matching MUST
 * prefer the durable identity; a durable-identity match bypasses team/project/framework
 * gating and margin downgrade so an issue moved or renamed across containers is never
 * orphaned." Spec AC1: gating and the margin downgrade "do not apply" to a candidate
 * whose attachment metadata carries the task's durable identity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyGate,
  bandAndMargin,
  matchAllTasks,
  resolveWeights,
  scorePair,
} from "task-linear-sync/matching";
import type { MatchCandidate, TaskMatchInput } from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makePair, makeTask } from "../helpers/matching-factory.js";

const config = defaultConfig();
const weights = resolveWeights(config);
const FLOOR = config.confidenceFloors.plausible;

const MOVED_UUID = "0f1e2d3c-4b5a-4978-8675-4321fedcb299";

function movedTask(): TaskMatchInput {
  return {
    task: makeTask({
      stableUuid: MOVED_UUID,
      title: "Implement login form",
      frameworkId: "spec-kit",
    }),
    routing: { teamKey: "acme-team", project: "proj-alpha", defaulted: false },
  };
}

/** Every container differs AND the title is rewritten; only the anchor says "same work". */
function movedCandidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return makeCandidate({
    issueId: "i-1001",
    issueKey: "GLO-1001",
    teamKey: "glob-team",
    projectRef: "proj-gamma",
    title: "RENAMED auth screen v2",
    durableTaskUuid: MOVED_UUID,
    frameworkId: "kiro",
    ...over,
  });
}

test("matching durable: moved+renamed durable pair scores the durable-uuid signal at the frozen weight", () => {
  const pair = scorePair(movedTask(), movedCandidate(), weights);
  assert.equal(pair.durableIdentity, true);
  const anchor = pair.contributions.find((c) => c.signal === "durable-uuid");
  assert.ok(anchor, "durable-uuid contribution present");
  assert.equal(anchor.points, config.scoringWeights.durableUuid, "default 1000 — outranks the sum of all other signals");
  assert.equal(anchor.points, 1000);
});

test("matching durable: team/project/framework gating does NOT apply — zero gating exclusions", () => {
  const input = movedTask();
  const candidate = movedCandidate();
  const pair = applyGate(scorePair(input, candidate, weights), input, candidate, FLOOR);
  assert.equal(pair.usable, true, "usable despite differing team AND project AND framework");
  assert.equal(pair.exclusion, undefined, "constitution II: no gating exclusion is recorded");
});

test("matching durable: the moved pair is SELECTED and bands high with durableIdentity: true", () => {
  const result = matchAllTasks([movedTask()], [movedCandidate()], config);
  assert.equal(result.matches.length, 1);
  const match = result.matches[0]!;
  assert.equal(match.taskUuid, MOVED_UUID);
  assert.equal(match.issueId, "i-1001");
  assert.equal(match.durableIdentity, true);
  assert.equal(match.confidence, "high");
  assert.ok(match.reasons.includes("durable-uuid"));
  assert.ok(!match.reasons.includes("ambiguous-margin"));
});

test("matching durable: high match with margin < minimumMatchMargin STAYS high (FR-005 bypass)", () => {
  const durable = makePair(MOVED_UUID, "i-1001", 80, { durableIdentity: true });
  const rival = makePair("f0000000-0000-4000-8000-000000000001", "i-1001", 79);
  const [match] = bandAndMargin([durable], [durable, rival], config);
  assert.equal(match!.margin, 1, "margin is still computed and reported");
  assert.equal(match!.confidence, "high", "the downgrade rule skips durable matches (R5 c9)");
  assert.ok(!match!.reasons.includes("ambiguous-margin"));
});

test("matching durable: identical-title non-durable rival cannot steal the anchored issue (not orphaned)", () => {
  const anchorTask = movedTask();
  const clone = {
    task: makeTask({
      stableUuid: "0f1e2d3c-4b5a-4978-8675-4321fedcb298",
      title: "RENAMED auth screen v2",
      frameworkId: "kiro" as const,
      issueRef: { key: "SYNC", number: 1001 },
    }),
    // Clone routed into the MOVED candidate's containers: ref+exact+project+framework max out at 830.
    routing: { teamKey: "glob-team", project: "proj-gamma", defaulted: false },
  };
  const result = matchAllTasks([anchorTask, clone], [movedCandidate()], config);
  assert.equal(result.matches.length, 1, "one issue, one winner");
  assert.equal(result.matches[0]!.taskUuid, MOVED_UUID, "durable identity wins the contested issue");
  assert.equal(result.matches[0]!.durableIdentity, true);
});

test("matching durable: durable matches keep alternatives with mapped annotations", () => {
  const durablePairCandidate = movedCandidate({
    title: "Implement login form", // exact against the task title too
  });
  const other = makeCandidate({ issueId: "i-1002", issueKey: "ENG-1002", title: "Implement login form" });
  const secondTask: TaskMatchInput = {
    task: makeTask({
      stableUuid: "0f1e2d3c-4b5a-4978-8675-4321fedcb297",
      title: "Implement login form",
      frameworkId: "spec-kit",
    }),
    routing: { teamKey: "acme-team", project: "proj-alpha", defaulted: false },
  };
  const result = matchAllTasks([movedTask(), secondTask], [durablePairCandidate, other], config);
  const durableMatch = result.matches.find((m) => m.durableIdentity)!;
  assert.ok(durableMatch, "durable pair emitted");
  const alts = durableMatch.alternatives;
  assert.ok(alts.length >= 1);
  for (const alt of alts) assert.equal(typeof alt.mapped, "boolean");
  assert.equal(
    alts.find((a) => a.issueId === "i-1002")?.mapped,
    true,
    "i-1002 is selected for the second task ⇒ mapped",
  );
});
