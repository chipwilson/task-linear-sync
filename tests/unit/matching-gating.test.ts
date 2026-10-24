/**
 * T016 [US1] — gating + selectability unit tests.
 * FR-003 verbatim: "exclude non-durable candidates whose team, project, or (when both
 * known) framework differ from the task's" (spec AC3: "that candidate is excluded
 * entirely"). Research R6: routing `undefined` or `unassigned: true` ⇒ "team/project
 * gates skipped for that task"; unknown candidate framework ⇒ framework gate not
 * evaluated (001 R5 c5 "both … carry a known Framework_Id"). FR-002 verbatim:
 * "selectable candidates are restricted to at least the plausible-match floor".
 * Constitution II: "Durable pairs are never gated out."
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { RoutingResolution } from "task-linear-sync/domain";
import { applyGate, scorePair, resolveWeights } from "task-linear-sync/matching";
import type { MatchCandidate, PairScore, TaskMatchInput } from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makePair, makeRouting, makeTask } from "../helpers/matching-factory.js";

const config = defaultConfig();
const FLOOR = config.confidenceFloors.plausible; // 18
const weights = resolveWeights(config);

const TASK_UUID = "a1000000-0000-4000-8000-000000000001";

function input(routing?: RoutingResolution, over: Partial<TaskMatchInput["task"]> = {}): TaskMatchInput {
  const task = makeTask({ stableUuid: TASK_UUID, title: "alpha bravo charlie", ...over });
  return routing ? { task, routing } : { task };
}

function gated(pair: PairScore, inp: TaskMatchInput, candidate: MatchCandidate): PairScore {
  return applyGate(pair, inp, candidate, FLOOR);
}

test("matching gating: differing team excludes the non-durable candidate entirely (FR-003)", () => {
  const inp = input(makeRouting("acme-team", "proj-alpha"));
  const candidate = makeCandidate({ teamKey: "glob-team", projectRef: "proj-alpha", title: "alpha bravo charlie" });
  const pair = gated(scorePair(inp, candidate, weights), inp, candidate);
  assert.equal(pair.exclusion, "gated-team");
  assert.equal(pair.usable, false, "excluded entirely from selection");
  assert.ok(pair.total >= FLOOR, "exclusion is not a scoring effect");
});

test("matching gating: differing project excludes the non-durable candidate", () => {
  const inp = input(makeRouting("acme-team", "proj-alpha"));
  const candidate = makeCandidate({ teamKey: "acme-team", projectRef: "proj-beta", title: "alpha bravo charlie" });
  const pair = gated(scorePair(inp, candidate, weights), inp, candidate);
  assert.equal(pair.exclusion, "gated-project");
  assert.equal(pair.usable, false);
});

test("matching gating: framework gate applies only when BOTH sides carry a known Framework_Id (R5 c5)", () => {
  const inp = input(makeRouting("acme-team", "proj-alpha"), { frameworkId: "spec-kit" });
  const differing = makeCandidate({ frameworkId: "kiro", title: "alpha bravo charlie" });
  const gatedPair = gated(scorePair(inp, differing, weights), inp, differing);
  assert.equal(gatedPair.exclusion, "gated-framework");

  const unknown = makeCandidate({ frameworkId: undefined, title: "alpha bravo charlie" });
  const freePair = gated(scorePair(inp, unknown, weights), inp, unknown);
  assert.equal(freePair.exclusion, undefined, "candidate framework unknown ⇒ gate not evaluated");
  assert.equal(freePair.usable, true);

  const same = makeCandidate({ frameworkId: "spec-kit", title: "alpha bravo charlie" });
  assert.equal(gated(scorePair(inp, same, weights), inp, same).usable, true);
});

test("matching gating: absent routing skips team/project gates for that task (research R6)", () => {
  const inp = input(undefined); // no routing at all
  const candidate = makeCandidate({ teamKey: "any-team", projectRef: "any-project", title: "alpha bravo charlie" });
  const pair = gated(scorePair(inp, candidate, weights), inp, candidate);
  assert.equal(pair.exclusion, undefined);
  assert.equal(pair.usable, true, "a task with no resolved container must still be matchable");
});

test("matching gating: unassigned routing skips team/project gates; defaulted routing still gates", () => {
  const unassigned: RoutingResolution = { teamKey: "", project: "", defaulted: true, unassigned: true };
  const candidate = makeCandidate({ teamKey: "elsewhere", projectRef: "elsewhere", title: "alpha bravo charlie" });
  const inp = input(unassigned);
  assert.equal(gated(scorePair(inp, candidate, weights), inp, candidate).usable, true);

  const defaulted: RoutingResolution = { teamKey: "acme-team", project: "proj-alpha", defaulted: true };
  const strict = input(defaulted);
  assert.equal(gated(scorePair(strict, candidate, weights), strict, candidate).exclusion, "gated-team");
});

test("matching gating: FR-002 selectability floor — plausible boundary is inclusive", () => {
  const inp = input();
  const atFloor = makePair(TASK_UUID, "i-0001", FLOOR); // 18
  assert.equal(applyGate(atFloor, inp, makeCandidate({ issueId: "i-0001" }), FLOOR).usable, true);
  const below = applyGate(makePair(TASK_UUID, "i-0002", FLOOR - 1), inp, makeCandidate({ issueId: "i-0002" }), FLOOR);
  assert.equal(below.usable, false);
  assert.equal(below.exclusion, "below-plausible");
});

test("matching gating: sub-plausible candidates stay scored (they may surface as alternatives), never selectable", () => {
  const inp = input(undefined, { title: "alpha bravo" });
  const candidate = makeCandidate({ title: "alpha charlie bravo delta echo", issueKey: "ENG-9001" });
  const pair = gated(scorePair(inp, candidate, weights), inp, candidate);
  assert.equal(pair.total, 17, "fuzzy 17 < plausible 18");
  assert.equal(pair.usable, false);
  assert.equal(pair.exclusion, "below-plausible");
});

test("matching gating: container gate wins the machine-readable exclusion over below-plausible", () => {
  const inp = input(makeRouting("acme-team", "proj-alpha"), { title: "alpha bravo" });
  // teamKey AND projectRef differ, but the team gate is checked first (FR-003 order);
  // projectRef must differ too so no same-project credit lifts the pair above the floor.
  const candidate = makeCandidate({
    teamKey: "glob-team",
    projectRef: "proj-beta",
    title: "alpha charlie bravo delta echo",
  });
  const pair = gated(scorePair(inp, candidate, weights), inp, candidate);
  assert.equal(pair.total, 17, "also below plausible");
  assert.equal(pair.exclusion, "gated-team", "documented precedence: gating reason first");
});

test("matching gating: durable pairs bypass team/project/framework gating unconditionally (constitution II)", () => {
  const inp = input(makeRouting("acme-team", "proj-alpha"), { frameworkId: "spec-kit" });
  const durableCandidate = makeCandidate({
    teamKey: "moved-team",
    projectRef: "moved-project",
    frameworkId: "kiro",
    title: "alpha bravo charlie",
    durableTaskUuid: TASK_UUID,
  });
  const scored = scorePair(inp, durableCandidate, weights);
  assert.equal(scored.durableIdentity, true);
  const pair = gated(scored, inp, durableCandidate);
  assert.equal(pair.usable, true, "moved/renamed durable issue is never orphaned by gating");
  assert.equal(pair.exclusion, undefined);
});

test("matching gating: durable bypass exempts gating only — the plausible floor still applies", () => {
  const zeroDurable = resolveWeights(loadConfig({ overrides: { scoringWeights: { durableUuid: 0 } } }));
  const inp = input(makeRouting("acme-team", "proj-alpha"));
  const durableCandidate = makeCandidate({
    teamKey: "moved-team",
    projectRef: "moved-project",
    title: "",
    durableTaskUuid: TASK_UUID,
  });
  const scored = scorePair(inp, durableCandidate, zeroDurable);
  assert.equal(scored.durableIdentity, true);
  assert.equal(scored.total, 0);
  const pair = applyGate(scored, inp, durableCandidate, FLOOR);
  assert.equal(pair.usable, false, "below-plausible remains unusable even for durable pairs");
  assert.equal(pair.exclusion, "below-plausible", "never gated-* for a durable pair, though");
});

test("matching gating: gate never mutates the input pair (pure function)", () => {
  const original = makePair(TASK_UUID, "i-0010", 100);
  const result = applyGate(original, input(makeRouting("acme-team", "x")), makeCandidate({ issueId: "i-0010", projectRef: "y" }), FLOOR);
  assert.notEqual(result, original);
  assert.equal(original.usable, true, "input pair untouched");
  assert.equal(result.usable, false);
});
