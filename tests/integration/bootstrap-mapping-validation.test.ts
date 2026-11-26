/**
 * T011 [P] [US2] — bootstrap existence validation end-to-end over world
 * `bootstrap-mapping-validation` (feature 024; FR-008/FR-009/FR-010/FR-011;
 * contract C4.1–C4.5). The config carries NO `workflowStates` keys, so the built-in
 * default name table is exactly what gets validated against each team's live workflow.
 *
 * Pinned posture:
 *  - bootstrap plan build THROWS `StateMappingBootstrapError` when any configured team
 *    lacks a mapped name (here: BETA no `Canceled`, GAMMA no `In Progress`, DELTA
 *    several) while ALPHA passes (C4.2, C4.4 — ONE pass, every team named, PASS included);
 *  - zero tracker mutations and zero state-directory writes on the refusal (C4.5);
 *  - after the operator fixes Linear (states added to the fake world), an
 *    otherwise-identical re-run SUCCEEDS and applies (SC-004);
 *  - sync-mode runs never execute the validator (FR-011 / C4.1) even with broken
 *    workflows;
 *  - per-team content pins: missing entry PATHS + intended names, available states as
 *    `name (type)` with NO ids, missing `canceled` type category on DELTA, correction
 *    steps present; hints never clear a miss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GateRequest } from "task-linear-sync/gates";
import type { Plan } from "task-linear-sync/domain";

import {
  attachEngine,
  buildWorld,
  hasCheckpoints,
  mutationCalls,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";
import { StateMappingBootstrapError } from "../../src/engine/state-validation.js";

function gates(w: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: w.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

async function brokenWorld(): Promise<EngineWorld> {
  // BETA lacks Canceled, GAMMA lacks In Progress, DELTA offers only Todo/Done.
  return buildWorld("bootstrap-mapping-validation");
}

test("bootstrap refuses on incomplete workflows: one error, every team grouped, zero mutations (C4.4/C4.5)", async () => {
  const w = await brokenWorld();
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    let error: unknown;
    try {
      await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof StateMappingBootstrapError, `expected StateMappingBootstrapError, got ${String(error)}`);
    assert.equal((error as Error).name, "StateMappingBootstrapError", "stable taxonomy name (C4.6 recognition)");

    const message = (error as Error).message;
    // One pass, grouped: the passing team AND every failing team are named (FR-009, C4.4).
    assert.match(message, /Team ALPHA: PASS/u, "passing teams are named too");
    assert.match(message, /Team BETA: FAIL/u);
    assert.match(message, /Team GAMMA: FAIL/u);
    assert.match(message, /Team DELTA: FAIL/u);

    // Per-team missing entry PATHS with intended names.
    assert.match(message, /teams\[BETA\]\.workflowStates\.lanes\.canceled = 'Canceled'/u);
    assert.match(message, /teams\[GAMMA\]\.workflowStates\.inProgress = 'In Progress'/u);
    assert.match(message, /teams\[GAMMA\]\.workflowStates\.lanes\.in_progress = 'In Progress'/u);
    assert.match(message, /teams\[DELTA\]\.workflowStates\.backlog = 'Backlog'/u);

    // Available states render as `name (type)` — NEVER ids (C4.4(b)).
    assert.match(message, /Team workflow states available: Todo \(todo\), Done \(completed\)/u);
    assert.ok(!/ac000000/u.test(message), "state ids never appear in the operator-facing report");

    // Type-category lines for the teams without ANY canceled state (C4.2(b)): BETA and
    // DELTA carry the complaint; GAMMA offers a canceled state so it does not.
    assert.match(message, /Missing workflow state type categories: canceled/u);
    assert.equal(message.match(/Missing workflow state type categories/gu)?.length, 2, "category line only where truly missing");

    // Correction steps present (C4.4(e)).
    assert.match(message, /Corrections:/u);
    assert.match(message, /Linear → Team → Workflow/u);

    // Structured payload rides the error for programmatic consumers (R6).
    const reports = (error as StateMappingBootstrapError).reports;
    const beta = reports.find((r) => r.teamKey === "BETA")!;
    assert.ok(beta.missing.some((m) => m.entryPath === "teams[BETA].workflowStates.lanes.canceled"));

    // Zero mutation, zero state-directory footprint (C4.5): no calls at all past the
    // read-only discovery, no checkpoint store, no report directory.
    assert.equal(mutationCalls(w).length, 0, "the refusal mutates nothing");
    assert.equal(await hasCheckpoints(w), false, "no checkpoint store was written");
  } finally {
    await w.dispose();
  }
});

test("operator fixes Linear — an otherwise-identical re-run succeeds and applies (SC-004)", async () => {
  const w = await brokenWorld();
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    await assert.rejects(() => engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }), StateMappingBootstrapError);

    // The operator adds the missing states in Linear (fake-world mutation — the very
    // next plan build re-consults live metadata, so the fix is all it takes).
    const teamStates = (key: string) => w.fake.world.teams.get(key)!.workflowStates;
    teamStates("BETA").push({ id: "ac000000-0000-4000-8000-000000000299", name: "Canceled", type: "canceled" });
    teamStates("GAMMA").push({ id: "ac000000-0000-4000-8000-000000000298", name: "In Progress", type: "started" });
    teamStates("DELTA").push(
      { id: "ac000000-0000-4000-8000-000000000295", name: "Backlog", type: "backlog" },
      { id: "ac000000-0000-4000-8000-000000000296", name: "In Progress", type: "started" },
      { id: "ac000000-0000-4000-8000-000000000297", name: "Canceled", type: "canceled" },
    );

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.ok(plan.entries.length >= 1, "the demo task plans");
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    assert.ok(mutationCalls(w).some((c) => c.method === "createIssue"), "bootstrap created the demo issue");
  } finally {
    await w.dispose();
  }
});

test("sync-mode runs never execute the validator (FR-011, C4.1)", async () => {  const w = await brokenWorld();
  try {
    // Any checkpoint flips the reality-selected mode to sync.
    await seedCheckpoints(w, {
      "00000000-0000-4000-8000-000000000001": {
        taskUuid: "00000000-0000-4000-8000-000000000001",
        issueId: "ac000000-0000-4000-8000-000000000900",
        checked: false,
        title: "orphan pre-image",
        issueUpdatedAt: "2026-01-01T00:00:00.000Z",
        issueStateType: "todo",
        descriptionContentHash: "0".repeat(64),
      },
    });
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.ok(plan, "sync planning succeeds despite the incomplete workflows");
  } finally {
    await w.dispose();
  }
});

test("apply re-checks the workflow under the lock — a workflow that moved after planning refuses before any mutation (C4.1/C4.5, T015)", async () => {
  const w = await brokenWorld();
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    await assert.rejects(() => engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }), StateMappingBootstrapError);
    const teamStates = (key: string) => w.fake.world.teams.get(key)!.workflowStates;
    teamStates("BETA").push({ id: "ac000000-0000-4000-8000-000000000299", name: "Canceled", type: "canceled" });
    teamStates("GAMMA").push({ id: "ac000000-0000-4000-8000-000000000298", name: "In Progress", type: "started" });
    teamStates("DELTA").push(
      { id: "ac000000-0000-4000-8000-000000000295", name: "Backlog", type: "backlog" },
      { id: "ac000000-0000-4000-8000-000000000296", name: "In Progress", type: "started" },
      { id: "ac000000-0000-4000-8000-000000000297", name: "Canceled", type: "canceled" },
    );
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // The workflow moves BETWEEN plan build and apply (the plan's gates are satisfied).
    const betaStates = teamStates("BETA");
    betaStates.splice(
      betaStates.findIndex((s) => s.name === "Canceled"),
      1,
    );

    await assert.rejects(
      () => engine.applySyncPlan(plan, gates(w, plan)),
      (error: unknown) => error instanceof StateMappingBootstrapError && /Team BETA: FAIL/u.test((error as Error).message),
      "apply re-validates against the re-fetched snapshot and names the moved team",
    );
    assert.equal(mutationCalls(w).length, 0, "the apply-side refusal mutates nothing");
    assert.equal(await hasCheckpoints(w), false, "no checkpoint store written by the refused apply");
  } finally {
    await w.dispose();
  }
});
