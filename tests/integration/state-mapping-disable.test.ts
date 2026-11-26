/**
 * T022 [P] [US4] — quickstart V5: the explicit disables restore the pre-024
 * untouched-state posture (feature 024; FR-007; contract C3.2/C3.3; US4-AC2).
 * Reuses world `state-mapping-lanes-default` (lane events exercising every default
 * mapping) with each disable layered through `options.config`:
 *
 *  - global `stateMappingEnabled: false`: ZERO state operations across the whole run;
 *    every lane-carrying unit reports `state-mapping-disabled`;
 *  - per-team `workflowStates.mappingEnabled: false`: identical posture for that team;
 *  - `lanes: null` (mapping otherwise active): lanes stay untouched with
 *    `lane-state-unmapped` (NOT `state-mapping-disabled`), creates carry no state,
 *    and the bootstrap validator skips lane entries for the team (C3.3) while still
 *    checking its identities;
 *  - disabled worlds are otherwise byte-identical to the default-off legacy posture:
 *    plans still match/update/mirror everything EXCEPT state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GateRequest } from "task-linear-sync/gates";
import type { Plan } from "task-linear-sync/domain";
import { loadConfig } from "task-linear-sync/config";

import { attachEngine, buildWorld, mutationCalls, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

/** The same workflow the world seeds, authored explicitly (a disabled team adopts no defaults). */
const acmeTeam = (extra: Record<string, unknown>) => ({
  "acme": {
    projects: ["proj-alpha"],
    workflowStates: {
      backlog: "Backlog",
      todo: "Todo",
      inProgress: "In Progress",
      done: "Done",
      canceled: "Canceled",
      completedTypes: ["completed"],
      ignoredTypes: ["canceled", "duplicate"],
      ...extra,
    },
  },
});

async function disabledWorld(extra: Record<string, unknown>, root: Record<string, unknown> = {}): Promise<EngineWorld> {
  return buildWorld("state-mapping-lanes-default", {
    config: { stateMappingEnabled: false, teams: acmeTeam(extra), ...root } as never,
  });
}

function gates(w: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: w.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

async function runOnce(w: EngineWorld) {
  const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
  const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
  const applied = await engine.applySyncPlan(plan, gates(w, plan));
  return { plan, applied };
}

test("global disable: zero state operations, every lane unit reports state-mapping-disabled (V5, C3.2)", async () => {
  const w = await disabledWorld({});
  try {
    const { plan, applied } = await runOnce(w);
    assert.equal(applied.status, "applied");
    const laneUnits = plan.entries.filter((e) => e.reasons.includes("state-mapping-disabled"));
    assert.ok(laneUnits.length >= 5, `lane-event units all report the disable, got ${laneUnits.length}`);
    for (const e of laneUnits) {
      assert.ok(!e.changedFields.includes("state"), "no unit carries a state change");
      assert.ok(!e.reasons.some((r) => r.startsWith("lane:")), "no lane label rides a disabled unit");
    }
    for (const op of applied.operations) {
      assert.notEqual(op.status, "failed", "the disabled posture never fails a cell");
    }
    // No state mutations: any updateIssue patch carries no stateTypeId.
    for (const m of mutationCalls(w)) {
      if (m.method === "updateIssue") {
        assert.equal((m.args[1] as { stateTypeId?: string }).stateTypeId, undefined, "state left untouched");
      }
    }
  } finally {
    await w.dispose();
  }
});

test("per-team disable: the same posture via workflowStates.mappingEnabled=false (FR-007)", async () => {
  const w = await buildWorld("state-mapping-lanes-default", {
    config: { teams: acmeTeam({ mappingEnabled: false }) } as never,
  });
  try {
    const { plan, applied } = await runOnce(w);
    assert.equal(applied.status, "applied");
    assert.ok(plan.entries.some((e) => e.reasons.includes("state-mapping-disabled")), "the team's lane units report the disable");
    for (const e of plan.entries) assert.ok(!e.changedFields.includes("state"));
  } finally {
    await w.dispose();
  }
});

test("lanes null: untouched + lane-state-unmapped (NOT state-mapping-disabled); bootstrap validator skips lane entries (C3.3)", async () => {
  const w = await buildWorld("state-mapping-lanes-default", {
    config: { teams: acmeTeam({ lanes: null }) } as never,
  });
  try {
    const { plan, applied } = await runOnce(w);
    assert.equal(applied.status, "applied", "bootstrap validation PASSED with lanes null — lane entries skipped (identities still checked)");
    const laneUnits = plan.entries.filter((e) => e.reasons.includes("lane-state-unmapped"));
    assert.ok(laneUnits.length >= 5, "every lane event is the untouched + reported posture");
    for (const e of laneUnits) {
      assert.ok(!e.reasons.includes("state-mapping-disabled"), "lanes null is an ACTIVE team — not the disable label");
      assert.ok(!e.reasons.some((r) => r.startsWith("lane:")));
    }
    for (const m of mutationCalls(w)) {
      if (m.method === "updateIssue") assert.equal((m.args[1] as { stateTypeId?: string }).stateTypeId, undefined);
    }
  } finally {
    await w.dispose();
  }
});

test("lanes null with a broken identity: the validator still checks identities (C3.3 second clause)", async () => {
  const w = await buildWorld("state-mapping-lanes-default", {
    config: { teams: { "acme": { projects: ["proj-alpha"], workflowStates: { backlog: "NoSuchState", lanes: null } } } } as never,
  });
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    await assert.rejects(
      () => engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }),
      (error: unknown) =>
        (error as Error).name === "StateMappingBootstrapError" &&
        /teams\[acme\]\.workflowStates\.backlog = 'NoSuchState'/u.test((error as Error).message) &&
        !/\.lanes\./u.test((error as Error).message),
      "identity miss named; no lane-entry noise",
    );
  } finally {
    await w.dispose();
  }
});

test("disable is byte-identical to the pre-024 posture where legacy config named states: a configured team with mapping OFF moves nothing", () => {
  // Unit echo of C3.2: with mapping OFF the resolution pass fills NOTHING — the
  // pre-024 explicit config is what it always was (SC-005's disabled twin).
  const legacy = loadConfig({
    overrides: {
      stateMappingEnabled: false,
      teams: { acme: { projects: ["p"], workflowStates: { backlog: "Triage", done: "Shipped" } } },
      defaultTeamKey: "acme",
      defaultProject: "p",
    },
  });
  const ws = legacy.teams.acme.workflowStates as Record<string, unknown>;
  assert.equal(ws.inProgress, undefined, "no default adoption under the global disable");
  assert.equal(ws.lanes, undefined, "no lane table under the global disable");
  assert.equal(ws.backlog, "Triage", "configured entries survive verbatim");
});
