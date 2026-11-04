/**
 * T033 [P] [US2] — Checkbox-completion → workflow-state integration through the frozen
 * `SyncEngine` seam (tasks.md T033; research R7; data-model §6; contracts/
 * conflict-resolution-matrix.md §5; FR-006; US1 AC5; quickstart 1.5).
 *
 * World: `completion-toggle` (seed `expected/checkpoint-seed.json` first ⇒ sync mode):
 * task 1.1 newly CHECKED with an otherwise-identical description, task 1.2 newly
 * UNCHECKED, task 1.3 the untouched control.
 *
 * RED BY DESIGN at the apply seam (same posture as `engine-bootstrap` test 4 /
 * `engine-gate-order`): `buildSyncPlan` is wired (T026) so the two PLAN-side tests pass
 * TODAY; the two apply-driving tests call `engine.applySyncPlan(plan, gates)` and fail
 * at exactly that seam with `EngineError("… not wired until phase 4 (T045 …)")` until
 * T043/T045 land. No test edits are needed when the wiring merges.
 *
 * Cells:
 *  1. PLAN (green today): newly checked ⇒ `completion:state-name:Done` +
 *     `completion:state-id:<…0203>` on an `update` entry; newly unchecked ⇒ "Backlog"
 *     (…0201); control `no-change`; ZERO description-conflict labels on any entry and a
 *     conflict-free report (matrix §5: the completion channel never consults or populates
 *     `descriptionConflict`, US1 AC5) — `expected/plan.json` is the golden table.
 *  2. APPLY (red at the seam): gated apply (frozen `GateRequest`, pattern of
 *     `engine-bootstrap` test 4) ⇒ `updateIssue(stateTypeId=…0203)` for ACME-1 and
 *     `updateIssue(stateTypeId=…0201)` for ACME-2 — state-only patches (no
 *     title/description keys: independent of the description machinery) — and the page-0
 *     attachment payload read back AFTER apply carries EXACTLY ONE `checkbox-changed`
 *     history event per toggled task (FR-006/FR-009); the control task's attachment,
 *     issue and checkpoint row receive zero mutating port calls.
 *  3. PLAN-TIME VALIDATION (green today): variant world built IN-MEMORY via
 *     `buildWorld` config overrides — `teams["TEAM-A"].workflowStates.done` names a state
 *     the fake `discoverMetadata` snapshot does NOT carry ("Ghost State"). The plan must
 *     surface the R7 failure sanitized, not crash: the affected entry takes
 *     `decision:"conflict"` with `validation:completion-state` + a sanitized `reason:`
 *     label (names the state + team; leaks NO snapshot ids and NO body text), a
 *     `completion-state-validation` FAIL security assertion rides the report, and every
 *     other task plans normally (1.2 keeps its Backlog id).
 *  4. APPLY of that variant (red at the seam): apply for the validation task is
 *     REFUSED/FAILED per task — its `OperationOutcome` is `status:"failed"` with a
 *     sanitized detail, ZERO mutating calls target its issue or identity attachment (the
 *     engine can never invent a state id — R7 "not a runtime surprise"), while the
 *     unrelated 1.2 checkbox op still applies (task-level isolation, the FR-012
 *     task-create-abort precedent; documented interpretation pinned FOR T043).
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` via the shared harness, temp state
 * dir, injected fixed clock, placeholder identities only (Principle III). Titles prefixed
 * `engine-completion-states —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ConfigOverrides } from "task-linear-sync/config";
import type {
  Checkpoint,
  Plan,
  PlanTaskEntry,
  SyncHistoryEvent,
  SyncStatePayload,
} from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { ApplyResult, IssueUpdatePatch, SyncEngine } from "task-linear-sync/ports";

import {
  attachEngine,
  attachmentUrlFor,
  buildWorld,
  hasCheckpoints,
  mutationCalls,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────── world identities (world.json)

const UUID_11 = "dd837e71-fa46-5c11-8bff-31fb37eb5a8e"; // 1.1 newly checked  ⇒ Done
const UUID_12 = "5516e12e-613a-5b40-838c-4a39ea1c547b"; // 1.2 newly unchecked ⇒ Backlog
const UUID_13 = "d3e847c1-8de0-53e5-bb70-e3d0a003ef78"; // 1.3 control — zero ops

const ISSUE_1 = "ac000000-0000-4000-8000-000000000301"; // ACME-1
const ISSUE_2 = "ac000000-0000-4000-8000-000000000302"; // ACME-2
const ISSUE_3 = "ac000000-0000-4000-8000-000000000303"; // ACME-3 (control)

const STATE_BACKLOG = "ac000000-0000-4000-8000-000000000201";
const STATE_TODO = "ac000000-0000-4000-8000-000000000202";
const STATE_DONE = "ac000000-0000-4000-8000-000000000203";

/** Every seeded workflow-state id — a leak canary for the sanitized validation failure. */
const SNAPSHOT_STATE_IDS = [STATE_BACKLOG, STATE_TODO, STATE_DONE];

/** Configured done name for the plan-time-validation variant — absent from the snapshot. */
const UNKNOWN_DONE_NAME = "Ghost State";

/** Body-text canaries — must never surface in validation labels or outcome details. */
const BODY_CANARIES = ["Toggle body text", "Gauge body text", "Widget body text"];

// ────────────────────────────────────────────────────────────────────────── helpers

/** One entry of `expected/plan.json` (the worlds-lane golden table for this world). */
interface ExpectedPlanEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
  readonly matchedIssueKey: string | null;
  readonly decision: string;
  readonly descriptionConflict: string | null;
  readonly desiredStateName?: string;
  readonly desiredStateTypeId?: string;
  readonly historyEvent?: string;
  readonly note?: string;
}

interface ExpectedPlan {
  readonly world: string;
  readonly mode: "bootstrap" | "sync";
  readonly entries: readonly ExpectedPlanEntry[];
}

/** The plan report as persisted by stage 7 (fields this test reads; typed loosely). */
interface ReportJson {
  readonly planId: string;
  readonly securityAssertions: ReadonlyArray<{ guarantee: string; status: string; detail?: string }>;
  readonly groups: ReadonlyArray<{ entries: readonly { taskUuid: string; decision: string; reasons: readonly string[] }[] }>;
}

function entryFor(plan: Plan, taskUuid: string, what: string): PlanTaskEntry {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for ${taskUuid} (${what})`);
  return entry!;
}

/** Conflict LABELS only (`description-conflict:<type>`), same posture as T018. */
function conflictLabels(entry: PlanTaskEntry | { reasons: readonly string[] }): readonly string[] {
  return entry.reasons.filter((r) => r.includes("description-conflict:") || r.startsWith("conflict:"));
}

/** The frozen GateRequest satisfying every gate (pattern of `engine-bootstrap` test 4). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // exact per world config ("ACME")
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId, // persisted plans/<planId>.json (stage 7)
  };
}

/** Read + parse the page-0 canonical attachment payload straight from the raw fake. */
async function page0Payload(world: EngineWorld, taskUuid: string): Promise<SyncStatePayload | null> {
  const att = await world.fake.getAttachmentByUrl(attachmentUrlFor(world, taskUuid));
  if (att === null) return null;
  const raw = att.metadata[world.config.metadataNamespaceKey];
  if (typeof raw !== "string") return null;
  return JSON.parse(raw) as SyncStatePayload;
}

function eventsOfKind(payload: SyncStatePayload | null, kind: SyncHistoryEvent["kind"]): number {
  if (payload === null) return 0;
  return payload.history.filter((event) => event.kind === kind).length;
}

/** Mutating port calls whose arguments reference any of `needles` (issue id / uuid / URL). */
function mutationsTouching(world: EngineWorld, needles: readonly string[]): number {
  return mutationCalls(world).filter((c) => {
    const flat = JSON.stringify(c.args);
    return needles.some((n) => flat.includes(n));
  }).length;
}

/** The single plan-run report persisted under `reports/` (exactly one after a build). */
function readSoleReport(world: EngineWorld): ReportJson {
  const reportsDir = join(world.stateDir, "reports");
  assert.ok(existsSync(reportsDir), "reports/ exists after a plan build");
  const runDirs = readdirSync(reportsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.equal(runDirs.length, 1, `exactly one report run dir, found: ${runDirs.join(", ")}`);
  return JSON.parse(readFileSync(join(reportsDir, runDirs[0]!, "report.json"), "utf8")) as ReportJson;
}

function reportEntry(report: ReportJson, taskUuid: string): { decision: string; reasons: readonly string[] } {
  const entry = report.groups.flatMap((g) => [...g.entries]).find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `report entry for ${taskUuid}`);
  return entry!;
}

/** Seed the sync-mode checkpoints and attach the engine (the pinned seeding pattern). */
async function syncEngineOverCompletionToggle(world: EngineWorld): Promise<SyncEngine> {
  const seed = readExpectedJson<Record<string, Checkpoint>>(world, "checkpoint-seed.json");
  await seedCheckpoints(world, seed);
  assert.equal(await hasCheckpoints(world), true, "seeding flips the world to sync mode");
  return attachEngine(world, createSyncEngine, { keyProvider: world.keyProvider });
}

/**
 * Full `TEAM-A` identity for the plan-time-validation variant. `buildWorld` merges
 * `options.config` OVER `world.json` `config` with a TOP-LEVEL spread, so the override
 * replaces the whole `teams` key — supply the complete identity (world.json shape) and
 * change ONLY the done name.
 */
function variantConfigWithUnknownDone(): ConfigOverrides {
  return {
    teams: {
      "TEAM-A": {
        projects: ["proj-alpha"],
        workflowStates: {
          backlog: "Backlog",
          todo: "Todo",
          done: UNKNOWN_DONE_NAME, // NOT in the seeded discoverMetadata snapshot
          completedTypes: ["completed"],
          ignoredTypes: ["canceled", "duplicate"],
        },
      },
    },
  };
}

/** Assert the sanitized posture: no body text and no snapshot ids in the text. */
function assertSanitized(text: string, what: string): void {
  for (const canary of [...BODY_CANARIES, ...SNAPSHOT_STATE_IDS]) {
    assert.ok(!text.includes(canary), `${what} must stay sanitized (leak canary: "${canary}")`);
  }
}

// ─────────────────────────────────────────────────────────────────────────── tests

test("engine-completion-states — completion-toggle plan: checked ⇒ Done id, unchecked ⇒ Backlog id, zero description conflicts (R7, US1 AC5)", async () => {
  const w = await buildWorld("completion-toggle");
  try {
    const engine = await syncEngineOverCompletionToggle(w);
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assert.equal(expected.world, w.name);
    assert.equal(plan.entries.length, expected.entries.length, "plan entry count");

    for (const exp of expected.entries) {
      const entry = entryFor(plan, exp.taskUuid, `task ${exp.localTaskId} (${exp.note ?? ""})`);
      assert.ok(entry.reasons.includes("mode:sync"), `sync mode label on task ${exp.localTaskId}`);
      assert.equal(entry.decision, exp.decision, `decision for task ${exp.localTaskId} (${exp.note ?? ""})`);

      // FR-006 independence (matrix §5): the completion channel NEVER populates the
      // description-conflict machinery — every entry is an explicit clean verdict.
      assert.deepEqual(conflictLabels(entry), [], `no conflict label for task ${exp.localTaskId}`);
      assert.ok(entry.reasons.includes("no-description-conflict"), `clean description verdict for ${exp.localTaskId}`);

      if (exp.desiredStateTypeId !== undefined) {
        // R7 name→id resolution through the discoverMetadata snapshot.
        assert.ok(entry.reasons.includes(`completion:state-name:${exp.desiredStateName}`), `configured state name for ${exp.localTaskId}`);
        assert.ok(entry.reasons.includes(`completion:state-id:${exp.desiredStateTypeId}`), `resolved state id for ${exp.localTaskId}`);
        assert.ok(entry.changedFields.includes("state"), `changedFields carries the state channel for ${exp.localTaskId}`);
        assert.ok(!entry.changedFields.includes("description"), `no description channel for ${exp.localTaskId} (AC5)`);
        assert.deepEqual([...entry.expectedMarkdownChanges], [], `completion ops never plan a description rewrite (${exp.localTaskId})`);
      } else {
        assert.ok(!entry.reasons.some((r) => r.startsWith("completion:")), `control ${exp.localTaskId} carries no completion label`);
        assert.deepEqual([...entry.changedFields], [], `control ${exp.localTaskId} changed nothing`);
      }
    }

    // Report side (FR-005): no task rides the report as a conflict; no FAIL assertion.
    const report = readSoleReport(w);
    assert.equal(report.planId, plan.planId);
    for (const exp of expected.entries) {
      assert.deepEqual(conflictLabels(reportEntry(report, exp.taskUuid)), [], `report stays conflict-free for ${exp.taskUuid}`);
    }
    assert.equal(
      report.securityAssertions.filter((a) => a.status === "fail").length,
      0,
      "a clean completion plan carries no FAIL security assertion",
    );
  } finally {
    await w.dispose();
  }
});

test("engine-completion-states — completion-toggle gated apply: updateIssue(stateTypeId …0203/…0201) + exactly one checkbox-changed event per toggle; control untouched (FR-006)", async () => {
  const w = await buildWorld("completion-toggle");
  try {
    const engine = await syncEngineOverCompletionToggle(w);
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Control-side material snapshotted pre-apply (zero-change proof below).
    const controlUrl = attachmentUrlFor(w, UUID_13);
    const controlBefore = JSON.stringify((await w.fake.getAttachmentByUrl(controlUrl))?.metadata ?? null);
    const togglePayloadsBefore = await Promise.all([page0Payload(w, UUID_11), page0Payload(w, UUID_12)]);
    assert.ok(togglePayloadsBefore[0] && togglePayloadsBefore[1], "premise: toggled tasks have page-0 anchors pre-apply");
    assert.equal(eventsOfKind(togglePayloadsBefore[0], "checkbox-changed"), 0, "seeded history carries no checkbox-changed event");

    // Full CYCLE through the frozen gate contract — RED at this seam until T043/T045.
    const result: ApplyResult = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "gates are satisfied ⇒ no refusals");
    assert.equal(result.status, "applied", `clean completion run completes (got ${result.status})`);

    // update-issue seam: STATE-ONLY patches with the configured ids (FR-006; independent
    // of the description machinery — no title/description keys ride the patch).
    const updates = w.calls.filter((c) => c.method === "updateIssue" && c.ok);
    assert.equal(updates.length, 2, `exactly two updateIssue calls, saw ${updates.length}`);
    const patchById = new Map<string, IssueUpdatePatch>(updates.map((c) => [c.args[0] as string, c.args[1] as IssueUpdatePatch]));
    const patch11 = patchById.get(ISSUE_1);
    const patch12 = patchById.get(ISSUE_2);
    assert.ok(patch11 && patch12, "both toggled issues received the update");
    assert.equal(patch11!.stateTypeId, STATE_DONE, "newly checked ⇒ configured done state id (…0203)");
    assert.equal(patch12!.stateTypeId, STATE_BACKLOG, "newly unchecked ⇒ configured backlog state id (…0201)");
    for (const [issue, patch] of [[ISSUE_1, patch11], [ISSUE_2, patch12]] as const) {
      assert.equal(patch.description, undefined, `completion patch for ${issue} carries no description (AC5)`);
      assert.equal(patch.title, undefined, `completion patch for ${issue} carries no title`);
    }

    // History seam (FR-006/FR-009): EXACTLY ONE `checkbox-changed` event per affecting
    // action, read back from the page-0 attachment AFTER apply.
    assert.equal(eventsOfKind(await page0Payload(w, UUID_11), "checkbox-changed"), 1, "exactly one checkbox-changed event on 1.1's page-0 payload");
    assert.equal(eventsOfKind(await page0Payload(w, UUID_12), "checkbox-changed"), 1, "exactly one checkbox-changed event on 1.2's page-0 payload");

    // The control task is invisible to the run: zero mutating calls touch its issue,
    // uuid or identity attachment; its page-0 payload is byte-unchanged.
    assert.equal(mutationsTouching(w, [ISSUE_3, UUID_13, controlUrl]), 0, "control task received zero mutations");
    assert.equal(JSON.stringify((await w.fake.getAttachmentByUrl(controlUrl))?.metadata ?? null), controlBefore, "control attachment payload byte-unchanged");

    // Outcome + tracker reality agree: the fake resolved the patched ids to their states.
    assert.equal(w.fake.world.issues.get(ISSUE_1)?.stateType, "completed", "checked issue landed in the completed state");
    assert.equal(w.fake.world.issues.get(ISSUE_2)?.stateType, "backlog", "unchecked issue landed in the backlog state");
    for (const uuid of [UUID_11, UUID_12]) {
      const op = result.operations.find((o) => o.taskUuid === uuid);
      assert.ok(op && op.status === "applied", `operation outcome for ${uuid} is applied`);
    }
    const op13 = result.operations.find((o) => o.taskUuid === UUID_13);
    assert.ok(op13 === undefined || op13.status === "skipped", `control ${UUID_13} produced no applied op`);
  } finally {
    await w.dispose();
  }
});

test("engine-completion-states — unknown configured done name (in-memory config override): plan-time validation failure surfaced sanitized; siblings plan normally (R7)", async () => {
  const w = await buildWorld("completion-toggle", { config: variantConfigWithUnknownDone() });
  try {
    // Override landed (teams replaces wholesale ⇒ full identity supplied); backlog intact.
    assert.equal(w.config.teams?.["TEAM-A"]?.workflowStates.done, UNKNOWN_DONE_NAME);
    assert.equal(w.config.teams?.["TEAM-A"]?.workflowStates.backlog, "Backlog");

    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, seed);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // R7: a plan-time VALIDATION failure — the build SUCCEEDS, sanitized labels surface.
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(mutationsTouching(w, [ISSUE_1, ISSUE_2, ISSUE_3]), 0, "plan-time validation mutates nothing");

    const entry11 = entryFor(plan, UUID_11, "task 1.1 (unknown done name)");
    assert.equal(entry11.decision, "conflict", 'validation failure rides `decision:"conflict"` into the report (R7/BT024 interpretation)');
    assert.ok(entry11.reasons.includes("validation:completion-state"), "validation label present");
    const reason = entry11.reasons.find((r) => r.startsWith("reason:") && r.includes(UNKNOWN_DONE_NAME));
    assert.ok(reason, `sanitized reason naming the offending state '${UNKNOWN_DONE_NAME}': ${entry11.reasons.join(", ")}`);
    assert.ok(reason!.includes("TEAM-A"), "the failing team identity is named");
    for (const label of entry11.reasons) assertSanitized(label, "validation reason label");
    assert.ok(
      !entry11.reasons.some((r) => r.startsWith("completion:state-id:") || r.startsWith("completion:state-name:")),
      "no completion ids leak onto the failed entry",
    );

    // Every other task plans normally (documented interpretation pinned by `build.ts`).
    const entry12 = entryFor(plan, UUID_12, "task 1.2 (valid backlog mapping)");
    assert.equal(entry12.decision, "update", "the unchecked sibling still plans its backlog move");
    assert.ok(entry12.reasons.includes(`completion:state-id:${STATE_BACKLOG}`), "sibling completion id unaffected");
    assert.equal(entryFor(plan, UUID_13, "task 1.3").decision, "no-change");

    // Report: a `completion-state-validation` FAIL assertion rides the sanitized detail.
    const report = readSoleReport(w);
    const failing = report.securityAssertions.filter((a) => a.guarantee === "completion-state-validation");
    assert.equal(failing.length, 1, "exactly one completion-state-validation assertion");
    assert.equal(failing[0]!.status, "fail", "the validation assertion FAILS the run's security block");
    if (failing[0]!.detail !== undefined) assertSanitized(failing[0]!.detail, "validation report detail");
    assert.equal(reportEntry(report, UUID_11).decision, "conflict", "report names the task in the conflicts section (R7)");
  } finally {
    await w.dispose();
  }
});

test("engine-completion-states — unknown done name at apply: that task fails sanitized with zero mutations, sibling checkbox op still lands (R7, per-task isolation)", async () => {
  const w = await buildWorld("completion-toggle", { config: variantConfigWithUnknownDone() });
  try {
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, seed);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const entry11 = entryFor(plan, UUID_11, "task 1.1");
    assert.ok(entry11.reasons.includes("validation:completion-state"), "precondition: plan-side validation entry");

    // RED at the apply seam until T043/T045. PINNED INTERPRETATION FOR T043: the
    // validation-conflict entry is refused/failed PER TASK (never a raw runtime throw,
    // never an invented state id) while healthy sibling ops proceed — the FR-012
    // task-create-abort precedent; the overall run status is the engine's choice.
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "frozen gates pass — the failure is NOT a gate refusal (R14: no new refusal codes)");

    const op11 = result.operations.find((o) => o.taskUuid === UUID_11);
    assert.ok(op11, "the validation task appears in the operation outcomes");
    assert.equal(op11!.status, "failed", "apply for the validation task FAILS sanitized (R7 — never applies, never crashes)");
    assert.ok(op11!.detail !== undefined && op11!.detail.length > 0, "sanitized failure detail names the problem");
    assert.match(op11!.detail!, /completion/i, "the failure detail identifies the completion-validation channel");
    assertSanitized(op11!.detail!, "op11 failure detail");

    // R7 hard floor: the engine can never invent a state id — NOTHING mutates toward
    // the validation task's issue or identity attachment.
    assert.equal(mutationsTouching(w, [ISSUE_1, UUID_11, attachmentUrlFor(w, UUID_11)]), 0, "zero mutations target the validation task");
    assert.equal(w.fake.world.issues.get(ISSUE_1)?.stateType, "todo", "ACME-1 state untouched");

    // Task-level isolation: the unrelated unchecked sibling still moves to Backlog.
    const update12 = w.calls.find((c) => c.method === "updateIssue" && c.args[0] === ISSUE_2);
    assert.ok(update12, "the sibling checkbox op still applies (per-task failure)");
    assert.equal((update12!.args[1] as IssueUpdatePatch).stateTypeId, STATE_BACKLOG, "sibling lands in the configured backlog id");
  } finally {
    await w.dispose();
  }
});
