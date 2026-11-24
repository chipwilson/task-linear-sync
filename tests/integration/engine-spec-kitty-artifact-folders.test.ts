/**
 * T027 [023 US4] — engine-level inertness + count parity over the T005 world
 * `spec-kitty-artifact-folders` (FR-009/FR-011/FR-015/FR-016; SC-007; contract C1.2').
 *
 *  - every non-canonical file the mission folder carries (roll-up, `tasks/README.md`,
 *    per-WP artifact sub-folders, `wps.yaml`, `status.json`, `status.events.jsonl`)
 *    contributes ZERO issues at every allowed depth;
 *  - count parity: the plan holds exactly one level-1 task per canonical WP document at
 *    BOTH depth settings (three missions ⇒ three creates at the default cap; at depth 2
 *    the six `### Subtask Tnnn` anchors add children while the level-1 count is
 *    unchanged — artifacts contribute nothing at any depth);
 *  - a status-event log WITHOUT configured lanes moves NO state anywhere (the
 *    `lane-state-unmapped` finding is the only trace; C6.2 posture).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";

import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const gates = (world: EngineWorld, plan: Plan): GateRequest => ({
  applyFlag: true,
  confirmationKey: world.config.confirmationKey,
  acceptLowConfidence: plan.lowConfidencePresent,
  planReference: plan.planId,
});

async function worldWith(depth: number | undefined): Promise<EngineWorld> {
  return buildWorld("spec-kitty-artifact-folders", depth === undefined ? {} : { config: { maxTaskIssueDepth: depth } });
}

test("T027 count parity at both depths: artifacts contribute 0 tasks, children only ever come from the canonical documents", async () => {
  for (const depth of [undefined, 1, 2]) {
    const w = await worldWith(depth);
    try {
      const depthLabel = `depth ${depth ?? "default"}`;
      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      // Canonical docs carry `### Subtask Tnnn – …` anchors: at depth 2 each mission
      // yields its WP plus two children; artifacts contribute NOTHING at any depth.
      const expected = depth === 2 ? 9 : 3;
      assert.equal(plan.entries.length, expected, `3 canonical documents${depth === 2 ? " + 6 anchor children" : ""} — zero artifact tasks (${depthLabel})`);
      const paths = [...new Set(plan.entries.map((e) => e.filePath))].sort();
      assert.deepEqual(paths, [
        "kitty-specs/042-auth-system/tasks/WP01-core.md",
        "kitty-specs/auth-system-01KQ2VNJ/tasks/WP01-gateway.md",
        "kitty-specs/bare-slug-mission/tasks/WP01-verify.md",
      ], `tasks originate only from canonical documents (${depthLabel})`);
    } finally {
      await w.dispose();
    }
  }
});

test("T027 apply: three issues land, artifacts conjure nothing, status log without lanes moves no state", async () => {
  const w = await worldWith(undefined);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    for (const entry of plan.entries) {
      assert.ok(!entry.changedFields.includes("state"), "the status log without a configured lanes map never patches state");
    }
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 3, "exactly the three canonical documents create");
    for (const c of creates) {
      assert.equal((c.args[0] as CreateIssueInput).stateType, undefined, "unmapped lane ⇒ tracker default state");
    }
    assert.equal(w.fake.world.issues.size, 3, "no artifact, roll-up, roster id or unknown wp_id conjured an issue");
  } finally {
    await w.dispose();
  }
});
