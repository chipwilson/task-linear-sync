/**
 * T008 [P] [US1] — quickstart V4: default-on lane mapping over world
 * `state-mapping-lanes-default` (feature 024; FR-001/FR-002/FR-003; contract C1.1/C2.2;
 * amendment A-024-0). The config carries ONLY the team identity — no `workflowStates`
 * keys — so the C1.1 lane table must reach the engine through the load-time resolution
 * pass and move issues with zero mapping configured.
 *
 * Pinned posture:
 *  - last-lane moves per the C1.1 table: planned→Backlog, claimed→Todo,
 *    in_progress→In Progress, done→Done, canceled→Canceled (each an `update` entry
 *    with `lane:<lane>` + `changedFields ∋ state`, applied via `updateIssue(stateTypeId)`);
 *  - `blocked` has NO default counterpart: issue untouched, `lane-state-unmapped`
 *    reported, no state in changedFields (FR-003);
 *  - WP07 (no lane events): no lane label at all; its create carries no `lane:` label;
 *  - a second plan+apply over unchanged inputs is a no-op — every mapped lane already
 *    live-matches its mapped type (idempotency, C6.2 posture); WP05's canceled carrier
 *    leaves the sync scope (ignoredStateTypes) so its task re-plans as a create whose
 *    durable-anchor guard SKIPS the cell — zero mutations, zero duplicate issues (T009);
 *  - plan is read-only (Principle I): zero mutation calls during build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GateRequest } from "task-linear-sync/gates";
import type { IssueUpdatePatch } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";

import {
  attachEngine,
  buildWorld,
  callsOf,
  callsMark,
  mutationCalls,
  type EngineWorld,
} from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const STATE = {
  backlog: "ac000000-0000-4000-8000-000000000201",
  todo: "ac000000-0000-4000-8000-000000000202",
  inProgress: "ac000000-0000-4000-8000-000000000203",
  done: "ac000000-0000-4000-8000-000000000204",
  canceled: "ac000000-0000-4000-8000-000000000205",
} as const;

const WP_UUID: Record<string, string> = {
  WP01: "485a14f9-97b4-568f-b4b4-a0d1933f334f",
  WP02: "7ba72d5d-1c6b-5f38-b651-1b32c7c2fc30",
  WP03: "183e3822-b1fc-55b0-b834-521041d7b089",
  WP04: "420082d5-4098-5c9b-952b-6e2cbcd73551",
  WP05: "92a3d8ac-149b-5da0-bbce-82cc3ffb1f48",
  WP06: "433197d9-c02d-5fed-9cfb-b7c32f2d2a1e",
};

const WP_ISSUE: Record<string, string> = {
  WP01: "ac000000-0000-4000-8000-000000000501",
  WP02: "ac000000-0000-4000-8000-000000000502",
  WP03: "ac000000-0000-4000-8000-000000000503",
  WP04: "ac000000-0000-4000-8000-000000000504",
  WP05: "ac000000-0000-4000-8000-000000000505",
  WP06: "ac000000-0000-4000-8000-000000000506",
};

const gates = (world: EngineWorld, plan: Plan): GateRequest => ({
  applyFlag: true,
  confirmationKey: world.config.confirmationKey,
  acceptLowConfidence: plan.lowConfidencePresent,
  planReference: plan.planId,
});

function entryByUuid(plan: Plan, uuid: string): Plan["entries"][number] {
  const entry = plan.entries.find((e) => e.taskUuid === uuid);
  assert.ok(entry, `plan entry for ${uuid}`);
  return entry!;
}

test("024 V4: zero-config lane advances move issues per the C1.1 table; blocked untouched; re-plan idempotent", async () => {
  const w = await buildWorld("state-mapping-lanes-default");
  try {
    // The world config carries no workflowStates — the resolution pass must have
    // materialized the defaults (V1 end-to-end through the harness).
    assert.deepEqual(w.config.teams.acme!.workflowStates.lanes, {
      planned: "Backlog",
      claimed: "Todo",
      in_progress: "In Progress",
      for_review: "In Progress",
      in_review: "In Progress",
      approved: "In Progress",
      done: "Done",
      canceled: "Canceled",
    });
    assert.equal(w.config.stateMappingEnabled, true);

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Plan is read-only (Principle I).
    assert.deepEqual(mutationCalls(w), [], "plan build mutates nothing");
    assert.equal(plan.entries.length, 7, "seven canonical work packages");

    // ── The five mapped last-lanes move per the C1.1 table ──────────────────────────
    const expectedMove: Record<string, { lane: string; stateId: string }> = {
      WP01: { lane: "planned", stateId: STATE.backlog },
      WP02: { lane: "claimed", stateId: STATE.todo },
      WP03: { lane: "in_progress", stateId: STATE.inProgress },
      WP04: { lane: "done", stateId: STATE.done },
      WP05: { lane: "canceled", stateId: STATE.canceled },
    };
    for (const [wp, expect] of Object.entries(expectedMove)) {
      const entry = entryByUuid(plan, WP_UUID[wp]!);
      assert.equal(entry.decision, "update", `${wp}: the lane move plans as an update`);
      assert.ok(entry.reasons.includes(`lane:${expect.lane}`), `${wp}: label lane:${expect.lane}, got ${entry.reasons.join(",")}`);
      assert.ok(entry.changedFields.includes("state"), `${wp}: state drift from the lane advance`);
      assert.ok(!entry.reasons.includes("lane-state-unmapped"), `${wp}: a mapped lane is never reported unmapped`);
    }

    // ── blocked: untouched + reported (FR-003) ───────────────────────────────────────
    const wp06 = entryByUuid(plan, WP_UUID.WP06!);
    assert.ok(wp06.reasons.includes("lane-state-unmapped"), "blocked has NO default entry — untouched + reported");
    assert.ok(!wp06.changedFields.includes("state"), "an unmapped lane never patches state");
    assert.ok(!wp06.reasons.some((r) => r.startsWith("lane:")), "no lane label for an unmapped lane");

    // ── WP07: no lane events ⇒ no label; its create carries no lane label ────────────
    const wp07 = plan.entries.find((e) => e.filePath.includes("WP07"))!;
    assert.ok(wp07, "WP07 plans");
    assert.ok(!wp07.reasons.some((r) => r.startsWith("lane:")), "no lane events ⇒ no lane label");
    assert.ok(!wp07.reasons.includes("lane-state-unmapped"), "nothing to map ⇒ nothing reported unmapped");

    // ── Apply: each mapped lane patches the C1.1 state id; blocked never patched ─────
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const patchFor = (issueId: string): IssueUpdatePatch | undefined => {
      const call = callsOf(w, "updateIssue").find((c) => c.args[0] === issueId);
      return call === undefined ? undefined : (call.args[1] as IssueUpdatePatch);
    };
    for (const [wp, expect] of Object.entries(expectedMove)) {
      const patch = patchFor(WP_ISSUE[wp]!);
      assert.equal(patch?.stateTypeId, expect.stateId, `${wp}: applied toward the C1.1 default state`);
    }
    assert.ok(patchFor(WP_ISSUE.WP06!) === undefined || patchFor(WP_ISSUE.WP06!)!.stateTypeId === undefined, "blocked never patches state");
    assert.equal(w.fake.world.issues.get(WP_ISSUE.WP01!)!.stateType, "backlog", "WP01 landed in Backlog's type");
    assert.equal(w.fake.world.issues.get(WP_ISSUE.WP03!)!.stateType, "started", "WP03 landed in In Progress' type");
    assert.equal(w.fake.world.issues.get(WP_ISSUE.WP06!)!.stateType, "todo", "WP06 untouched");

    // ── Re-plan over unchanged inputs: mapped lanes live-match ⇒ no-ops ──────────────
    const mark = callsMark(w);
    const second = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    for (const wp of ["WP01", "WP02", "WP03", "WP04"]) {
      const entry = entryByUuid(second, WP_UUID[wp]!);
      assert.ok(!entry.changedFields.includes("state"), `${wp}: live state already matches — idempotent no-op`);
      assert.ok(!entry.reasons.some((r) => r.startsWith("lane:")), `${wp}: no lane label on the converged re-plan`);
    }
    // WP05: the canceled issue sits in an IGNORED state (ignoredStateTypes) — invisible
    // to the sync scope by design, so the task re-plans as a create whose carrier maps
    // `canceled`. The create path's durable-anchor guard must SKIP the cell instead of
    // conjuring a duplicate (024 T009 guard; Principle II).
    const wp05Again = entryByUuid(second, WP_UUID.WP05!);
    assert.equal(wp05Again.decision, "create", "the invisible canceled carrier leaves the task unmatched");
    assert.ok(wp05Again.reasons.includes("lane:canceled"), "the re-planned create carries the mapped canceled state");
    const wp06Again = entryByUuid(second, WP_UUID.WP06!);
    assert.ok(wp06Again.reasons.includes("lane-state-unmapped"), "blocked keeps reporting on every plan");
    const secondApply = await engine.applySyncPlan(second, gates(w, second));
    assert.equal(secondApply.status, "applied");
    assert.deepEqual(mutationCalls(w, mark), [], "the converged run mutates nothing");
    assert.equal(w.fake.world.issues.size, 7, "the durable-anchor guard never conjures a duplicate issue");
    const wp05Outcome = secondApply.operations.find((o) => o.taskUuid === WP_UUID.WP05);
    assert.equal(wp05Outcome?.status, "skipped", "the out-of-scope identity is skipped, not re-created");
  } finally {
    await w.dispose();
  }
});
