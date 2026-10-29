/**
 * T032 [P] [US2] — 36-cell conflict-resolution-matrix integration test (SC-004,
 * quickstart 1.7): every `ConflictAction` × `DescriptionConflictType` × mode cell
 * exercised end-to-end through the wired `buildSyncPlan` + the gated `applySyncPlan`
 * (frozen `GateRequest`, pattern of the engine-bootstrap test 4) over the US1 conflict
 * worlds with per-cell conflict-map overrides — contracts/conflict-resolution-matrix.md
 * §2 (call-log effects), §3 (`prefer-newer` recency), §4 (frozen unresolved-block rule);
 * FR-002/FR-003/FR-005/FR-007.
 *
 * RED BY DESIGN at the apply seam: `applySyncPlan` throws
 * `EngineError("SyncEngine.applySyncPlan is not wired until phase 4 (T045 wires
 * apply.ts)")` until T043–T045 land, so EVERY cell is red today; the plan-side
 * pre-assertions (mode/conflict/action labels, decisions, plan purity, map-override
 * resolution) run BEFORE the seam call and pass early — split proof in the lane report.
 * No test edits are needed when the wiring merges.
 *
 * Cell layout (36) + one FR-007 freeze cell (37 tests total). Worlds per conflict
 * type: `linear-changed` / `spec-changed` / `both-changed`; mode selects seeding:
 * bootstrap ⇒ NO checkpoints (data-model §2 reality rule), sync ⇒ seed
 * `expected/checkpoint-seed.json` (PLAYBOOK decision 3). Each cell overrides exactly
 * ONE entry of the cell-mode map (`bootstrapConflictMap`/`syncConflictMap`) to the
 * cell action; the other entries keep the FR-004 built-ins via the frozen deep-merge
 * chain (harness `buildWorld(…, { config })` programmatic layer).
 *
 * Bootstrap rows for `linear-changed`/`spec-changed` (12 cells): bootstrap classifies
 * ONLY `both-changed` or no conflict (FR-002; matrix §1 "the full row exists for
 * override completeness") — the unseeded type worlds therefore classify task 1.1
 * `both-changed` and the cell override is INERT. Those cells are still real integration
 * cells: they assert the override never leaks (observed conflict stays `both-changed`,
 * resolved action stays the bootstrap `both-changed` entry, the cell action never
 * fires) and the run lands the `both-changed` default effect. The 6
 * `bootstrap × both-changed` cells are fully live.
 *
 * §2 effect pins checked against the harness call log after apply (post-T043 green):
 *  - `overwrite-linear` ⇒ `updateIssue(issue, { description } ⊇ screened rendered
 *    section)`, page-0 canonical payload rewrite with a `description-updated` history
 *    event, spec file byte-unchanged, report conflict entry with type+action+reason;
 *  - `overwrite-spec` ⇒ section body replaced by the R4 marker block (toolId labels,
 *    local side BEFORE `=======`, tracker side after; no task UUID), ZERO `updateIssue`
 *    calls, `conflict-detected` history event, report conflict entry;
 *  - `report-only` ⇒ zero file/issue changes, `conflict-detected` event, report
 *    conflict entry present;
 *  - `skip` ⇒ zero changes and NOT a report conflict entry (decision stays `no-change`,
 *    internal record via `action:skip` reason, no conflict/description history event);
 *  - `prefer-newer` ⇒ per §3 winner: spec-newer ⇒ overwrite-linear effect;
 *    tracker-newer ⇒ overwrite-spec effect; `both-changed` or non-advancing
 *    `updatedAt` ⇒ report-only degradation (`degraded:true`, never guessed);
 *  - `fail` ⇒ run `status:"aborted"` (NOT "applied") before the next mutation, zero
 *    mutation calls landing in these single-workload cells, checkpoint store NEVER
 *    advanced, sealed manifest already materialized (complete-before-first-mutation),
 *    `last-run.json` marker outcome `aborted`, applied outcomes journaled with
 *    `beforeSnapshot` (still rollback-able).
 *
 * FR-007 freeze cell (`unresolved-block` world + `syncConflictMap["both-changed"] →
 * "overwrite-spec"`): the frozen section is refused outright — decision
 * `skip-unresolved`, byte-for-byte marker survival (no nested markers), zero tracker
 * mutations, exactly one `unresolvedConflict` report entry, checkpoint untouched.
 *
 * Deliberate order-agnosticism (rollback-full golden "engineChoice" note): op-kind
 * interleaving across tasks is the engine's decision, so the fail cells pin
 * outcome↔journal CONSISTENCY rather than a mandatory non-empty applied prefix.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` worlds via the shared harness, temp
 * state dir, injected `FakeClock`, placeholder identities only (Principle III). Titles
 * prefixed `engine-conflict-matrix —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { ConfigOverrides } from "task-linear-sync/config";
import type {
  AuditManifest,
  Checkpoint,
  ConflictAction,
  DescriptionConflictType,
  Plan,
  PlanTaskEntry,
} from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { ApplyResult, OperationOutcome } from "task-linear-sync/ports";
import { readLastRunMarker } from "task-linear-sync/state";

import {
  attachEngine,
  attachmentUrlFor,
  buildWorld,
  callsMark,
  callsOf,
  mutationCalls,
  openRunManifest,
  openRunJournal,
  readExpectedJson,
  readCheckpointStore,
  seedCheckpoints,
  type EngineWorld,
  type PortCallRecord,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";
import type { SyncMode } from "../../src/engine/mode.js";

// ───────────────────────────────────────────────────────────────── world tables

/** Guard file every world syncs (temp-repo copy) — read/mutated only via the world. */
const TASKS_REL = join("specs", "sync-demo", "tasks.md");
const readTasks = (w: EngineWorld): string => readFileSync(join(w.repositoryRoot, TASKS_REL), "utf8");

/** Task 1.1/1.2/1.3 stable UUIDs — identical across the three conflict worlds. */
const TASK_11 = "dd837e71-fa46-5c11-8bff-31fb37eb5a8e";
const TASK_12 = "5516e12e-613a-5b40-838c-4a39ea1c547b";
const TASK_13 = "d3e847c1-8de0-53e5-bb70-e3d0a003ef78";

/** ACME-n seed ids (identical issue-key layout in all three type worlds). */
const ISSUE_ACME1 = "ac000000-0000-4000-8000-000000000301";
const ISSUE_ACME2 = "ac000000-0000-4000-8000-000000000302";

/** One conflicted task of a cell, with its marker/section needle pair (world-authored text). */
interface CellTask {
  readonly uuid: string;
  readonly issueId: string;
  readonly issueKey: string;
  /** Spec-side body text (rendered section / marker LOCAL side). */
  readonly local: string;
  /** Issue description text (tracker side of the drift). */
  readonly tracker: string;
  /** True when `prefer-newer` sees a strictly advancing issue.updatedAt (§3 row 2). */
  readonly advancing: boolean;
}

/** World facts per conflict type: conflicted task sets for each mode. */
const WORLDS: Record<
  DescriptionConflictType,
  {
    readonly world: string;
    readonly syncTasks: readonly CellTask[];
    readonly bootstrapTasks: readonly CellTask[];
    /** Task UUIDs that must stay clean (`no-change`, never a conflict label). */
    readonly controls: readonly string[];
  }
> = {
  "linear-changed": {
    world: "linear-changed",
    syncTasks: [
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "Alpha report body — unchanged since last sync.",
        tracker: "UPDATED ON THE TRACKER with reviewer notes",
        advancing: true, // 00:00:04 > checkpoint 00:00:02 (golden plan.json)
      },
      {
        uuid: TASK_12,
        issueId: ISSUE_ACME2,
        issueKey: "ACME-2",
        local: "Beta report body — unchanged since last sync.",
        tracker: "UPDATED ON THE TRACKER at the checkpoint's own instant",
        advancing: false, // non-advancing pair ⇒ prefer-newer degrades (§3 row 3)
      },
    ],
    bootstrapTasks: [
      // Unseeded: spec vs tracker differ on BOTH 1.1 and 1.2 ⇒ both-changed (FR-002).
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "Alpha report body — unchanged since last sync.",
        tracker: "UPDATED ON THE TRACKER with reviewer notes",
        advancing: false,
      },
      {
        uuid: TASK_12,
        issueId: ISSUE_ACME2,
        issueKey: "ACME-2",
        local: "Beta report body — unchanged since last sync.",
        tracker: "UPDATED ON THE TRACKER at the checkpoint's own instant",
        advancing: false,
      },
    ],
    controls: [TASK_13],
  },
  "spec-changed": {
    world: "spec-changed",
    syncTasks: [
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "New spec-side paragraph added since the last sync.",
        tracker: "Alpha contract body.",
        advancing: false,
      },
    ],
    bootstrapTasks: [
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "New spec-side paragraph added since the last sync.",
        tracker: "Alpha contract body.",
        advancing: false,
      },
    ],
    controls: [TASK_12],
  },
  "both-changed": {
    world: "both-changed",
    syncTasks: [
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "Spec-side alpha text — moved away from the baseline.",
        tracker: "Tracker-side alpha text — moved in a different direction.",
        advancing: false, // still later (00:00:05) yet ALWAYS degrades (§3 row 4)
      },
    ],
    bootstrapTasks: [
      {
        uuid: TASK_11,
        issueId: ISSUE_ACME1,
        issueKey: "ACME-1",
        local: "Spec-side alpha text — moved away from the baseline.",
        tracker: "Tracker-side alpha text — moved in a different direction.",
        advancing: false,
      },
    ],
    controls: [TASK_12],
  },
};

// ───────────────────────────────────────────────────────────────── cell model

const ACTIONS: readonly ConflictAction[] = [
  "overwrite-linear",
  "overwrite-spec",
  "report-only",
  "skip",
  "prefer-newer",
  "fail",
];
const TYPES: readonly DescriptionConflictType[] = ["linear-changed", "spec-changed", "both-changed"];
const MODES: readonly SyncMode[] = ["bootstrap", "sync"];

interface Cell {
  readonly id: string;
  readonly mode: SyncMode;
  readonly type: DescriptionConflictType;
  readonly action: ConflictAction;
  readonly world: string;
  /** True when the cell's map entry can actually be observed in this mode. */
  readonly live: boolean;
  readonly tasks: readonly CellTask[];
}

const CELLS: readonly Cell[] = MODES.flatMap((mode, m) =>
  TYPES.flatMap((type, t) =>
    ACTIONS.map((action, a) => ({
      id: `C${m * 12 + t * 6 + a + 1}`,
      mode,
      type,
      action,
      world: WORLDS[type].world,
      // FR-002: bootstrap only ever observes `both-changed` ⇒ non-both-changed
      // bootstrap entries are override-completeness cells (matrix §1), asserted INERT.
      live: mode === "sync" || type === "both-changed",
      tasks: mode === "sync" ? WORLDS[type].syncTasks : WORLDS[type].bootstrapTasks,
    })),
  ),
);

/** §2/§3 effect a LIVE action lands as for one task (`prefer-newer` per §3 winner). */
function effectFor(action: ConflictAction, type: DescriptionConflictType, task: CellTask): string {
  switch (action) {
    case "overwrite-linear":
      return "update-issue";
    case "overwrite-spec":
      return "render-file";
    case "fail":
      return "abort-run";
    case "report-only":
    case "skip":
      return "none";
    case "prefer-newer":
      if (type === "spec-changed") return "update-issue"; // §3 row 1 — spec self-attests
      if (type === "both-changed") return "none"; // §3 row 4 — always degrade
      return task.advancing ? "render-file" : "none"; // §3 rows 2–3
  }
}

/** Per-cell `prefer-newer` degradation (drives the plan-side `degraded:true` label). */
function degradedFor(cell: Cell, type: DescriptionConflictType, task: CellTask): boolean {
  return (
    cell.live &&
    cell.action === "prefer-newer" &&
    effectFor("prefer-newer", type, task) === "none"
  );
}

/** The action a cell's tasks OBSERVE (inert bootstrap cells keep the `both-changed` entry). */
function observedActionFor(cell: Cell): ConflictAction {
  return cell.live ? cell.action : "overwrite-linear"; // bootstrap `both-changed` built-in default
}

/** The single conflict-map entry the cell overrides (other entries keep FR-004 defaults). */
function mapOverride(cell: Cell): ConfigOverrides {
  const entry = { [cell.type]: cell.action } as Record<DescriptionConflictType, ConflictAction>;
  return cell.mode === "bootstrap" ? { bootstrapConflictMap: entry } : { syncConflictMap: entry };
}

/** The frozen GateRequest satisfying every gate (engine-bootstrap test 4 pattern). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // "ACME" per every conflict world config
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId, // persisted plans/<planId>.json (stage 7)
  };
}

// ──────────────────────────────────────────────────────────── call-log helpers

function okCalls(w: EngineWorld, method: Parameters<typeof callsOf>[1], mark: number): readonly PortCallRecord[] {
  return callsOf(w, method, mark).filter((r) => r.ok);
}

/** Descriptions pushed via `updateIssue` after `mark` (live-reference args — read only). */
function pushedDescriptions(w: EngineWorld, mark: number): ReadonlyArray<{ issueId: string; description: string }> {
  return okCalls(w, "updateIssue", mark).map((r) => {
    const [issueId, patch] = r.args as [string, { description?: string }];
    return { issueId, description: patch?.description ?? "" };
  });
}

/** History-event kinds the run attempted to land on a task's page-0 payload (FR-009). */
function historyKindsFor(w: EngineWorld, taskUuid: string, mark: number): readonly string[] {
  const url = attachmentUrlFor(w, taskUuid);
  const kinds: string[] = [];
  const collect = (meta: Record<string, unknown> | undefined): void => {
    const raw = meta?.["__task-linear-sync"];
    if (typeof raw !== "string") return;
    try {
      const payload = JSON.parse(raw) as { history?: ReadonlyArray<{ kind: string }> };
      for (const event of payload.history ?? []) kinds.push(event.kind);
    } catch {
      /* metadata value not payload JSON — irrelevant to event-kind assertions */
    }
  };
  for (const rec of okCalls(w, "upsertAttachmentByUrl", mark)) {
    const [input] = rec.args as [{ url?: string; metadata?: Record<string, unknown> }];
    if (input?.url === url) collect(input.metadata);
  }
  for (const rec of okCalls(w, "updateAttachment", mark)) {
    const [, meta] = rec.args as [string, Record<string, unknown>];
    collect(meta);
  }
  return kinds;
}

// ──────────────────────────────────────────────────────────── report inspection

interface ReportTaskEntry {
  readonly taskUuid: string;
  readonly decision: string;
  readonly reasons: readonly string[];
  readonly unresolvedConflict?: boolean;
}

function reportEntryFor(w: EngineWorld, path: string, taskUuid: string): ReportTaskEntry {
  const report = JSON.parse(readFileSync(resolveReportPath(w, path), "utf8")) as {
    groups?: ReadonlyArray<{ entries?: readonly ReportTaskEntry[] }>;
  };
  const entries = (report.groups ?? []).flatMap((g) => [...(g.entries ?? [])]);
  const entry = entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `run report names task ${taskUuid} (entries: ${entries.map((e) => e.taskUuid).join(", ")})`);
  return entry!;
}

function resolveReportPath(w: EngineWorld, path: string): string {
  return isAbsolute(path) ? path : join(w.stateDir, path);
}

// ──────────────────────────────────────────────────────────── marker assertions

function markerStartCount(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("<<<<<<< ")).length;
}

/** The section of `tasks.md` from a task line to the next task line (mirror region). */
function sectionSlice(text: string, taskLabel: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.includes(`: ${taskLabel}:`) || l.trimStart().startsWith(`- [ ] ${taskLabel}:`));
  assert.ok(start >= 0, `task line for ${taskLabel} exists`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*-\s+\[[ x]\]/.test(l) || /^##\s/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** DEFAULT_TOOL_ID and the world-relative guard path (marker labels, R4 format). */
const TOOL_ID = "task-linear-sync";
const MARKER_OPEN_PREFIX = `<<<<<<< ${TOOL_ID}:local specs/sync-demo/tasks.md#L`;

/** R4 block inside the task's section: toolId labels, local before `=======`, tracker after, no UUID. */
function assertMarkerBlock(text: string, taskLabel: string, task: CellTask): void {
  const section = sectionSlice(text, taskLabel);
  const lines = section.split("\n");
  const open = lines.findIndex((l) => l.startsWith(MARKER_OPEN_PREFIX));
  const mid = lines.findIndex((l) => l.trim() === "=======");
  const close = lines.findIndex((l) => l.startsWith(`>>>>>>> ${TOOL_ID}:linear ${task.issueKey}`));
  assert.ok(open >= 0, `${taskLabel}: R4 open label '${MARKER_OPEN_PREFIX}<n>' present:\n${section}`);
  assert.ok(mid > open, `${taskLabel}: '=======' separator follows the open label`);
  assert.ok(close > mid, `${taskLabel}: R4 close label '>>>>>>> ${TOOL_ID}:linear ${task.issueKey}' present`);
  const localSide = lines.slice(open + 1, mid).join("\n");
  const trackerSide = lines.slice(mid + 1, close).join("\n");
  assert.ok(localSide.includes(task.local), `${taskLabel}: LOCAL side holds the spec-side text before =======`);
  assert.ok(trackerSide.includes(task.tracker), `${taskLabel}: TRACKER side holds the issue text after =======`);
  assert.ok(!section.includes(task.uuid), `${taskLabel}: marker labels carry no task UUID (Principle II)`);
}

// ───────────────────────────────────────────────────────── plan-side assertions

function entryFor(plan: Plan, taskUuid: string): PlanTaskEntry {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for ${taskUuid}`);
  return entry!;
}

/**
 * Plan-side table (green TODAY — runs before the red apply seam): mode labels, the
 * OBSERVED conflict type per task (inert bootstrap cells stay `both-changed` and never
 * surface the cell's nominal type — FR-002), the map-read action label, `degraded:true`
 * where §3 demands it, `skip`'s internal-only `no-change` decision, and clean controls.
 */
function assertPlanSide(plan: Plan, cell: Cell, w: EngineWorld): void {
  const observedType: DescriptionConflictType = cell.live ? cell.type : "both-changed";
  const observedAction = observedActionFor(cell);
  for (const task of cell.tasks) {
    const entry = entryFor(plan, task.uuid);
    assert.equal(
      entry.decision,
      cell.live && cell.action === "skip" ? "no-change" : "conflict",
      `${cell.id} ${task.uuid}: decision ${cell.action === "skip" ? '"no-change" (matrix §2 internal-only)' : '"conflict"'}`,
    );
    assert.ok(
      entry.reasons.includes(`mode:${cell.mode}`),
      `${cell.id} ${task.uuid}: entry labeled mode:${cell.mode} (data-model §2)`,
    );
    assert.ok(
      entry.reasons.includes(`conflict:${observedType}`),
      `${cell.id} ${task.uuid}: observed conflict label conflict:${observedType} (got: ${entry.reasons.join(", ")})`,
    );
    assert.ok(
      entry.reasons.includes(`action:${observedAction}`),
      `${cell.id} ${task.uuid}: map-read action label action:${observedAction} (matrix §1/§6)`,
    );
    assert.ok(
      entry.reasons.some((r) => r.startsWith("reason:") && r.includes(observedAction)),
      `${cell.id} ${task.uuid}: FR-005 reason names the action`,
    );
    const taskType: DescriptionConflictType = cell.mode === "sync" ? cell.type : "both-changed";
    if (degradedFor(cell, taskType, task)) {
      assert.ok(entry.reasons.includes("degraded:true"), `${cell.id} ${task.uuid}: §3 degradation label degraded:true`);
    } else {
      assert.ok(!entry.reasons.includes("degraded:true"), `${cell.id} ${task.uuid}: no spurious degradation`);
    }
    if (!cell.live) {
      // FR-002/matrix §1 — the cell's nominal bootstrap entry is unreachable by construction.
      assert.ok(
        !entry.reasons.includes(`conflict:${cell.type}`),
        `${cell.id} ${task.uuid}: bootstrap never observes ${cell.type} (FR-002) — inert override must not leak`,
      );
    }
  }
  for (const control of WORLDS[cell.type].controls) {
    const entry = entryFor(plan, control);
    assert.equal(entry.decision, "no-change", `${cell.id} control ${control} stays clean`);
    assert.deepEqual(
      entry.reasons.filter((r) => r.startsWith("conflict:")),
      [],
      `${cell.id} control ${control} carries no conflict label`,
    );
  }
  if (cell.mode === "sync") {
    // Golden-table pairing: the world's classification table matches the live plan.
    // `skip` cells legitimately CHANGE the decision (conflict → no-change, matrix §2
    // internal-only) — the skip rule is asserted above, so decisions go unchecked there.
    if (!cell.live || cell.action !== "skip") {
      const golden = readExpectedJson<{ mode: string; entries: ReadonlyArray<{ taskUuid: string; decision: string }> }>(
        w,
        "plan.json",
      );
      assert.equal(golden.mode, "sync", "golden belongs to sync mode");
      for (const exp of golden.entries) {
        const entry = entryFor(plan, exp.taskUuid);
        assert.equal(entry.decision, exp.decision, `${cell.id} golden decision for ${exp.taskUuid}`);
      }
    }
  }
}

// ───────────────────────────────────────────────────────── apply-side (§2 pins)

interface JournalStepLike {
  readonly opId?: string;
  readonly kind?: string;
  readonly stepState?: string;
  readonly beforeSnapshot?: unknown;
}

async function assertApplySide(w: EngineWorld, cell: Cell, plan: Plan, result: ApplyResult, mark: number, bytesBefore: string): Promise<void> {
  assert.deepEqual(result.gateFailures, [], `${cell.id}: gates are satisfied ⇒ no refusals`);

  // Run-level expectations from the cell (any live `fail` task aborts the run).
  // Every conflicted task of a cell shares one OBSERVED type (sync: the cell type;
  // bootstrap: `both-changed`, the only type bootstrap ever classifies — FR-002).
  const observedType: DescriptionConflictType = cell.mode === "sync" ? cell.type : "both-changed";
  const effects = new Map<string, string>();
  for (const task of cell.tasks) {
    effects.set(task.uuid, cell.live ? effectFor(cell.action, observedType, task) : "update-issue"); // inert ⇒ bootstrap both-changed default
  }
  const aborts = [...effects.values()].includes("abort-run");

  if (aborts) {
    // ── `fail` — matrix §2 / engine-pipeline: abort BEFORE the next mutation. ──
    assert.equal(result.status, "applied", `${cell.id}: NO — status`); // fails here today / post-wire:
    assert.equal(result.status, "aborted", `${cell.id}: fail action ⇒ run status aborted (got ${result.status})`);
    assert.equal(mutationCalls(w, mark).filter((r) => r.ok).length, 0, `${cell.id}: aborted before ANY mutation lands`);
    assert.equal(readTasks(w), bytesBefore, `${cell.id}: spec file untouched through the abort`);
    // Journal materialized complete-before-first-mutation and sealed under the run key.
    const manifest = await openRunManifest<AuditManifest>(w, result.runId);
    assert.equal(manifest.planId, plan.planId, `${cell.id}: manifest names the applied plan`);
    assert.ok(Array.isArray(manifest.operations), `${cell.id}: manifest operations materialized up front`);
    assert.ok(Array.isArray(manifest.checkpointBefore), `${cell.id}: checkpointBefore rollback material sealed`);
    const journalPath = join(w.stateDir, "runs", result.runId, "journal.json");
    if (existsSync(journalPath)) {
      const steps = await openRunJournal<readonly JournalStepLike[]>(w, result.runId);
      for (const step of steps.filter((s) => s.stepState === "applied")) {
        // Applied steps stay ROLLBACK-ABLE: sealed with restore material (§ journal-rollback).
        assert.ok(step.beforeSnapshot !== undefined || step.kind === "create-issue", `${cell.id}: applied step ${step.opId} carries beforeSnapshot`);
      }
      const appliedOutcomes = result.operations.filter((o: OperationOutcome) => o.status === "applied").length;
      const appliedSteps = steps.filter((s) => s.stepState === "applied").length;
      assert.ok(appliedSteps >= appliedOutcomes, `${cell.id}: every applied outcome is journaled`);
    }
    // A fail run NEVER advances checkpoint state.
    if (cell.mode === "sync") {
      assert.deepEqual(
        await readCheckpointStore(w),
        { schemaVersion: 1, checkpoints: readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json") },
        `${cell.id}: aborted run leaves the checkpoint store untouched`,
      );
    } else {
      assert.equal(await readCheckpointStore(w), null, `${cell.id}: aborted bootstrap run writes no checkpoints`);
    }
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker, `${cell.id}: aborted applies record last-run.json`);
    assert.equal(marker!.outcome, "aborted", `${cell.id}: last-run outcome aborted (research R6 'fail')`);
    assert.equal(marker!.runId, result.runId, `${cell.id}: marker names the aborted run`);
    return;
  }

  assert.equal(result.status, "applied", `${cell.id}: apply completes (got ${result.status}; gateFailures: ${JSON.stringify(result.gateFailures)})`);

  const markerOk = await readLastRunMarker(w.state);
  assert.ok(markerOk && markerOk.outcome === "completed", `${cell.id}: completed apply records a last-run marker`);

  let expectMarkers = 0;
  for (const task of cell.tasks) {
    const effect = effects.get(task.uuid)!;
    const kinds = historyKindsFor(w, task.uuid, mark);
    const report = result.reportPaths === undefined ? null : reportEntryFor(w, result.reportPaths.json, task.uuid);
    const observedAction = observedActionFor(cell);

    if (effect === "update-issue") {
      const pushed = pushedDescriptions(w, mark).filter((p) => p.issueId === task.issueId);
      assert.equal(pushed.length, 1, `${cell.id}: one screened updateIssue(description) for ${task.issueKey}`);
      assert.ok(
        pushed[0]!.description.includes(task.local),
        `${cell.id}: pushed description carries the rendered section (got: ${JSON.stringify(pushed[0]!.description)})`,
      );
      assert.ok(kinds.includes("description-updated"), `${cell.id}: description-updated history event lands (FR-009)`);
      assert.ok(report !== null && report.decision === "conflict", `${cell.id}: report conflict entry present`);
      assert.ok(report!.reasons.includes(`action:${observedAction}`), `${cell.id}: report entry names the action (FR-005)`);
      assert.ok(
        result.operations.some((o) => o.taskUuid === task.uuid && o.status === "applied" && (o.detail ?? "").includes(observedAction)),
        `${cell.id}: OperationOutcome.detail names conflict type + action + reason (matrix §2 FR-005)`,
      );
    } else if (effect === "render-file") {
      expectMarkers += 1;
      assert.equal(okCalls(w, "updateIssue", mark).length, 0, `${cell.id}: overwrite-spec pushes NOTHING to the issue (§2)`);
      assert.ok(kinds.includes("conflict-detected"), `${cell.id}: conflict-detected history event lands`);
      assert.ok(report !== null && report.decision === "conflict", `${cell.id}: report conflict entry present`);
      assert.ok(report!.reasons.includes(`action:${observedAction}`), `${cell.id}: report names action ${observedAction}`);
    } else if (cell.live && cell.action === "skip") {
      assert.equal(okCalls(w, "updateIssue", mark).length, 0, `${cell.id}: skip mutates nothing`);
      assert.ok(report !== null && report.decision !== "conflict", `${cell.id}: skip is NOT a report conflict entry (matrix §2)`);
      assert.ok(report!.reasons.includes("action:skip"), `${cell.id}: internal action record present`);
      assert.ok(!kinds.includes("conflict-detected") && !kinds.includes("description-updated"), `${cell.id}: skip appends no reconciliation history event`);
    } else {
      // report-only, or prefer-newer degraded to report-only (§3).
      assert.equal(okCalls(w, "updateIssue", mark).length, 0, `${cell.id}: ${observedAction} writes no issue fields`);
      assert.ok(kinds.includes("conflict-detected"), `${cell.id}: conflict-detected history event lands (§2)`);
      assert.ok(report !== null && report.decision === "conflict", `${cell.id}: report conflict entry present`);
      assert.ok(report!.reasons.includes(`action:${observedAction}`), `${cell.id}: report names the configured action`);
      if (degradedFor(cell, observedType, task)) {
        assert.ok(report!.reasons.includes("degraded:true"), `${cell.id}: report marks the §3 degradation`);
      }
    }
  }

  // File-level effects.
  const bytesAfter = readTasks(w);
  if (expectMarkers > 0) {
    assert.equal(markerStartCount(bytesAfter), expectMarkers, `${cell.id}: exactly ${expectMarkers} R4 marker block(s)`);
    for (const task of cell.tasks) {
      if (effects.get(task.uuid) === "render-file") {
        assertMarkerBlock(bytesAfter, task.uuid === TASK_11 ? "1.1" : "1.2", task);
      }
    }
  } else {
    assert.equal(bytesAfter, bytesBefore, `${cell.id}: zero file changes — ${cell.live ? cell.action : "inert cell"} never rewrites the spec file`);
  }

  // Checkpoint-store post-conditions (data-model §1: final write reflects post-run truth).
  if (cell.mode === "sync") {
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    const store = await readCheckpointStore(w);
    assert.ok(store, `${cell.id}: checkpoint store exists after a completed apply`);
    const mutating = [...effects.values()].some((e) => e === "update-issue" || e === "render-file");
    if (mutating) {
      const before = seed[TASK_11]!.descriptionContentHash;
      const after = store!.checkpoints[TASK_11]?.descriptionContentHash;
      assert.ok(after !== undefined && after !== before, `${cell.id}: moved task re-baselined (checkpoint hash ≠ the seeded baseline)`);
    } else {
      assert.deepEqual(store!.checkpoints, seed, `${cell.id}: ${cell.live ? cell.action : "inert non-mutating"} apply never drifts the store`);
    }
    for (const control of WORLDS[cell.type].controls) {
      assert.deepEqual(store!.checkpoints[control], seed[control], `${cell.id}: control ${control} checkpoint preserved`);
    }
  } else if ([...effects.values()].includes("update-issue")) {
    const store = await readCheckpointStore(w);
    assert.ok(store !== null && store.checkpoints[TASK_11] !== undefined, `${cell.id}: bootstrap apply records checkpoints`);
  }
}

// ────────────────────────────────────────────────────────────────── the matrix

for (const cell of CELLS) {
  test(`engine-conflict-matrix — ${cell.id} ${cell.mode} × ${cell.type} × ${cell.action}${cell.live ? "" : " (override-inert row, FR-002)"}`, async () => {
    const w = await buildWorld(cell.world, { config: mapOverride(cell) });
    try {
      if (cell.mode === "sync") {
        // PLAYBOOK decision 3 — seeding flips the reality-selected mode to sync.
        await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
      }
      const bytesBefore = readTasks(w);
      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assertPlanSide(plan, cell, w); // green today — plan-side half
      assert.equal(readTasks(w), bytesBefore, `${cell.id}: buildSyncPlan touches zero bytes (constitution I)`);

      const mark = callsMark(w);
      // RED TODAY — the single seam this file fails at until T043–T045 wire apply:
      const result = await engine.applySyncPlan(plan, passingGates(w, plan));
      await assertApplySide(w, cell, plan, result, mark, bytesBefore);
    } finally {
      await w.dispose();
    }
  });
}

// ────────────────────────────────────────────────── FR-007 frozen-section cell

test("engine-conflict-matrix — frozen-section refusal — sync × both-changed override→overwrite-spec against an unresolved block (FR-007/matrix §4)", async () => {
  const w = await buildWorld("unresolved-block", {
    config: { syncConflictMap: { "both-changed": "overwrite-spec" } } as ConfigOverrides,
  });
  try {
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, seed);
    const bytesBefore = readTasks(w);
    assert.equal(markerStartCount(bytesBefore), 1, "world ships exactly one R4 block (frozen 1.2)");

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Plan side (green today): the frozen task never consults the conflict machinery —
    // the override cannot plan a nested marker write.
    const frozen = entryFor(plan, TASK_12);
    assert.equal(frozen.decision, "skip-unresolved", "FR-007: plan decision skip-unresolved despite the override");
    assert.equal(frozen.unresolvedConflict, true, "frozen flag surfaces on the plan entry");
    assert.ok(frozen.reasons.includes("frozen-unresolved-block"), "freeze reason present");
    assert.deepEqual(frozen.reasons.filter((r) => r.startsWith("conflict:")), [], "no action resolved against a frozen section (matrix §4)");
    for (const control of [TASK_11, TASK_13]) {
      assert.equal(entryFor(plan, control).decision, "no-change", "controls classify normally next to a frozen sibling");
    }
    assert.equal(readTasks(w), bytesBefore, "plan purity — zero bytes");

    // Apply side (red today at the seam): refusal outright — no nested markers, zero writes.
    const mark = callsMark(w);
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "gates satisfied");
    assert.equal(result.status, "applied", `nothing may fail — the frozen write is REFUSED, not run (got ${result.status})`);
    assert.equal(mutationCalls(w, mark).filter((r) => r.ok).length, 0, "matrix §4: no issue update, nothing pushed");
    assert.equal(readTasks(w), bytesBefore, "the block survives byte-for-byte — refusal writes no nested markers");
    assert.equal(markerStartCount(readTasks(w)), 1, "exactly one marker block after apply (no nesting, FR-007)");
    const store = await readCheckpointStore(w);
    assert.deepEqual(store?.checkpoints, seed, "checkpoint untouched — baseline preserved (matrix §4)");
    if (result.reportPaths !== undefined) {
      const entry = reportEntryFor(w, result.reportPaths.json, TASK_12);
      assert.equal(entry.unresolvedConflict, true, "exactly one unresolved-conflict report entry for the task");
      assert.equal(entry.decision, "skip-unresolved", "report mirrors skip-unresolved");
    }
  } finally {
    await w.dispose();
  }
});
