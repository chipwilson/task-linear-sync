/**
 * T051 [P] [US1+US2] — the end-to-end walkthrough (quickstart.md "End-to-end walkthrough";
 * the feature's Independent Test statement in one runnable story). ONE story-driven chain
 * on ONE hermetic fixture repo (reuses the existing `rollback-full` world — zero new
 * fixture content), through the frozen `SyncEngine` composed by `createSyncEngine`:
 *
 *   bootstrap apply on a fresh fixture repo (no checkpoints ⇒ bootstrap mode,
 *   `bootstrapConflictMap`) → the story converges (a re-run reaches zero pending —
 *   SC-001, absorbing the engine's own child-issue-ref task-line re-render into the
 *   mirrored description) → mutate the spec side (parent + nested-child paragraphs) AND
 *   the fake world's issue side (raw-fake teammate edits) → `buildSyncPlan` classifies
 *   the conflict-matrix cells: `spec-changed` ⇒ `overwrite-linear`, `linear-changed` ⇒
 *   `overwrite-spec`, `both-changed` ⇒ `report-only` (conflict-resolution-matrix.md §1–2,
 *   FR-004/FR-005) → `applySyncPlan` with the frozen GateRequest satisfied (push the
 *   screened rendered region; git-style marker block into the drifted section, issue
 *   untouched; conflict recorded, nothing written) → checkpoints + history pages
 *   verified (advance-on-landed / hold-on-report-only, append-only events,
 *   checkpoint↔payload cross-check; FR-008/FR-009) → `rollbackRun` → SC-003 assertions
 *   (journal-rollback.md §3–§4: every step rolled-back, byte-equal file restore, tracker
 *   restore, checkpoints restored, one `rollback` event referencing the reversed opIds,
 *   pages retained) → re-plan + re-apply lands byte-identically (determinism) → resolve
 *   the marker by hand (keep the local side) → the next `buildSyncPlan` classifies
 *   normally — no `skip-unresolved`/frozen state anywhere (matrix §4's post-resolution
 *   posture).
 *
 * Deep per-cell/per-step verification lives in the integration tier (T018/T034/T036);
 * this file proves the COMPOSED journey needs no handoffs the engine does not itself
 * perform. Hermetic (constitution VI): 007 fake `LinearPort` via the shared harness,
 * temp state dir, injected fixed clock — zero network, credentials, or wall-clock;
 * teammate edits go to the RAW fake (`w.fake`) so they never pollute the engine-attempt
 * call log. Placeholders only (Principle III). Titles prefixed `engine-user-stories —`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Checkpoint, Plan, PlanTaskEntry, SyncHistoryEvent } from "task-linear-sync/domain";
import { parseSyncStatePayload } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { IssueUpdatePatch } from "task-linear-sync/ports";
import { readLastRunMarker } from "task-linear-sync/state";

import {
  attachmentUrlFor,
  attachEngine,
  buildWorld,
  callsMark,
  hasCheckpoints,
  mutationCalls,
  openRunJournal,
  readCheckpointStore,
  readExpectedJson,
  type EngineWorld,
} from "../helpers/engine-harness.js";

// The e2e tier exercises the DISTRIBUTED package surface exactly as downstream features
// (009/010/012) consume it — `task-linear-sync/engine` → the built `dist/` artifact —
// mirroring the conformance "real-over-package" posture of the 002/007 suites. Unit and
// integration tiers keep relative `../../src/engine/*` imports for module-level seams.
import { createSyncEngine } from "task-linear-sync/engine";

// ─────────────────────────────────────────────────────────── world table + helpers

/** The `rollback-full` golden table (authored by the worlds lane) — identities only. */
interface GoldenEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
}
interface GoldenPlanFile {
  readonly world: string;
  readonly entries: readonly GoldenEntry[];
}

/** The frozen GateRequest satisfying every gate (precedent: `engine-bootstrap.test.ts`). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // exact per world config ("ACME")
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId, // persisted plans/<planId>.json (stage 7)
  };
}

function entryFor(plan: Plan, taskUuid: string): PlanTaskEntry {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for task ${taskUuid}`);
  return entry!;
}

function hasReason(entry: PlanTaskEntry, needle: string): boolean {
  return entry.reasons.some((r) => r.includes(needle));
}

/** Recursive byte walk of the temp repo — the byte-equality unit (T036 precedent). */
function walkFiles(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) Object.assign(out, walkFiles(join(dir, dirent.name), rel));
    else out[rel] = readFileSync(join(dir, dirent.name)).toString("base64");
  }
  return out;
}

/** The tool sync-state payload of a task's canonical page-0 attachment (T034 precedent). */
function payloadOf(world: EngineWorld, taskUuid: string): ReturnType<typeof parseSyncStatePayload> {
  const url = attachmentUrlFor(world, taskUuid);
  for (const record of world.fake.world.attachments.values()) {
    if (record.url !== url) continue;
    const raw = record.metadata[`__${world.config.toolId}`];
    assert.equal(typeof raw, "string", `canonical attachment at ${url} carries the tool payload`);
    return parseSyncStatePayload(raw as string);
  }
  assert.fail(`fake world carries no canonical attachment at ${url}`);
}

function historyKinds(world: EngineWorld, taskUuid: string): string[] {
  return payloadOf(world, taskUuid).history.map((h) => h.kind);
}

/** Append-only guarantee: `before` must remain the exact prefix of `after` (§4). */
function appendedSince(
  before: readonly SyncHistoryEvent[],
  after: readonly SyncHistoryEvent[],
  label: string,
): readonly SyncHistoryEvent[] {
  assert.deepEqual(after.slice(0, before.length), before, `${label}: prior events never rewound or altered`);
  return after.slice(before.length);
}

/** Journal step states for a run — sealed envelopes open through the harness; the
 *  T036 precedent normalizes `JournalStep[]` vs `{ steps }` envelopes. */
async function stepStates(world: EngineWorld, runId: string): Promise<string[]> {
  const doc = await openRunJournal<unknown>(world, runId);
  const steps = Array.isArray(doc)
    ? (doc as readonly { readonly stepState?: string }[])
    : typeof doc === "object" && doc !== null && Array.isArray((doc as { steps?: unknown[] }).steps)
      ? ((doc as { steps: readonly { readonly stepState?: string }[] }).steps)
      : assert.fail(`journal for run '${runId}' is neither JournalStep[] nor { steps }`);
  return steps.map((s) => String(s.stepState));
}

/** Remove the conflict-marker block keeping its LOCAL side — a human, git-style. */
function resolveMarkerKeepLocal(content: string, closeLabel: string): string {
  const kept: string[] = [];
  let zone: "outside" | "local" | "tracker" = "outside";
  for (const line of content.split("\n")) {
    if (zone === "outside" && line.startsWith("<<<<<<< task-linear-sync:local")) zone = "local";
    else if (zone === "local" && line === "=======") zone = "tracker";
    else if (zone === "tracker" && line.startsWith(closeLabel)) zone = "outside";
    else if (zone !== "tracker") kept.push(line);
  }
  assert.equal(zone, "outside", "the marker block was a well-formed open..close pair");
  return kept.join("\n");
}

// ─────────────────────────────────────────────────────────────────── the story chain

test("engine-user-stories — bootstrap apply → both-side drift → matrix cells → gated apply → checkpoints/history verified → rollback (SC-003) → byte-identical re-apply → hand-resolved markers classify normally", async (t) => {
  const w = await buildWorld("rollback-full");
  try {
    const golden = readExpectedJson<GoldenPlanFile>(w, "plan.json");
    assert.equal(golden.world, "rollback-full", "golden belongs to this world");
    const uuid = (localTaskId: string): string =>
      golden.entries.find((e) => e.localTaskId === localTaskId)!.taskUuid;
    const id = { alpha: uuid("1.1"), beta: uuid("1.1.1"), gamma: uuid("1.1.2"), zeta: uuid("1.2") } as const;

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const tasksPath = join(w.repositoryRoot, "specs", "sync-demo", "tasks.md");
    const mutatingRunIds: string[] = [];

    // State the story carries between steps (assigned in story order, read downstream).
    let alphaIssueId = "";
    let betaIssueId = "";
    let zetaIssueId = "";
    let driftPlan: Plan | null = null; // plan4 — the drift-time plan applied in step 4
    let r2RunId = "";
    let preR2Files: Record<string, string> = {};
    let preR2TasksMd = "";
    let preR2AlphaDescription = "";
    let preR2Checkpoints: Record<string, Checkpoint> = {};
    let preR2History!: Record<keyof typeof id, SyncHistoryEvent[]>;
    let alphaHistoryAfterR2: SyncHistoryEvent[] = [];
    let tasksMdAfterR2 = "";

    // ── 1 — bootstrap apply on the fresh fixture repo ──────────────────────────────
    await t.test("engine-user-stories — fresh fixture repo: bootstrap mode drives bootstrapConflictMap; gated apply creates the tracker side, rewrites task lines, and writes checkpoints + history", async () => {
      assert.equal(await hasCheckpoints(w), false, "fresh fixture repo ⇒ no checkpoints (data-model §2)");

      const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.equal(plan1.entries.length, 4, "one entry per fixture task");
      const alpha1 = entryFor(plan1, id.alpha);
      alphaIssueId = alpha1.match!.issueId;
      zetaIssueId = entryFor(plan1, id.zeta).match!.issueId;
      for (const entry of plan1.entries) {
        assert.ok(hasReason(entry, "mode:bootstrap"), `entry ${entry.taskUuid} is labeled mode:bootstrap`);
        assert.ok(hasReason(entry, "bootstrap-no-checkpoint"), `entry ${entry.taskUuid} carries bootstrap-no-checkpoint (AC1)`);
      }
      // No baseline ⇒ the drifted root is side-vs-side both-changed, yet the ACTION comes
      // from bootstrapConflictMap's overwrite-linear — never the sync report-only (§1).
      assert.equal(alpha1.decision, "conflict");
      assert.ok(hasReason(alpha1, "description-conflict:both-changed"), "bootstrap both-changed on a meaningful side-vs-side diff (AC1)");
      assert.ok(hasReason(alpha1, "overwrite-linear") && !hasReason(alpha1, "report-only"), "bootstrapConflictMap overwrites the tracker — spec is the bootstrap authority");
      assert.equal(entryFor(plan1, id.beta).decision, "create", "unmatched child 1.1.1 seeds the tracker");
      assert.equal(entryFor(plan1, id.gamma).decision, "create", "unmatched child 1.1.2 seeds the tracker");
      assert.equal(entryFor(plan1, id.zeta).decision, "no-change", "normalized-identical ⇒ no conflict (SC-002)");

      const apply1 = await engine.applySyncPlan(plan1, passingGates(w, plan1));
      assert.deepEqual(apply1.gateFailures, [], "gates satisfied ⇒ no refusals (US2 AC1)");
      assert.equal(apply1.status, "applied", `bootstrap apply completes (got ${apply1.status})`);
      mutatingRunIds.push(apply1.runId);

      // The world moved: creates landed, assigned task lines carry their issue refs.
      const tasksMd = readFileSync(tasksPath, "utf8");
      assert.match(tasksMd, /- \[ \] 1\.1\.1: \[ACME-\d+\] Beta child task/, "Beta task line carries its issue ref (FR-011 render)");
      assert.match(tasksMd, /- \[ \] 1\.1\.2: \[ACME-\d+\] Gamma sibling task/, "Gamma task line carries its issue ref");

      const store1 = await readCheckpointStore(w);
      assert.ok(store1, "checkpoint store written as the final apply step (data-model §1)");
      assert.deepEqual(Object.keys(store1!.checkpoints).sort(), Object.values(id).sort(), "one checkpoint per task, creates included");
      betaIssueId = store1!.checkpoints[id.beta]!.issueId;
      const createdBeta = await w.port.getIssue(betaIssueId);
      assert.ok(createdBeta !== null && createdBeta.archived === false, "created Beta is live in the fake world (never deleted — FR-016 posture)");

      // History pages (FR-009): exactly one affecting event per landed action, appended
      // onto the seeded world payload; the converged control seeds `discovered`.
      assert.deepEqual(historyKinds(w, id.alpha), ["matched", "description-updated"]);
      assert.deepEqual(historyKinds(w, id.beta), ["issue-created"]);
      assert.deepEqual(historyKinds(w, id.gamma), ["issue-created"]);
      assert.deepEqual(historyKinds(w, id.zeta), ["matched", "discovered"]);

      // Checkpoint ↔ canonical page-0 payload cross-check (the mirror hash, FR-008).
      assert.equal(
        payloadOf(w, id.alpha).descriptionContentHash,
        store1!.checkpoints[id.alpha]!.descriptionContentHash,
        "page-0 payload hash and checkpoint agree after the push",
      );

      const marker = await readLastRunMarker(w.state);
      assert.equal(marker?.runId, apply1.runId, "last-run.json names the apply run");
      assert.equal(marker?.outcome, "completed");
    });

    // ── 2 — the story converges (SC-001) ───────────────────────────────────────────
    await t.test("engine-user-stories — a re-run converges: the parent's freshly-minted child refs re-push once, and the NEXT plan reports zero pending changes (SC-001)", async () => {
      // The child task lines the create flow rewrote sit INSIDE the parent's mirrored
      // region (004 nesting includes descendants — pinned decision 1), and a description
      // pushed at plan time cannot carry ids minted mid-run: exactly one pure-
      // convergence re-push remains, then the inputs are at a fixed point.
      const plan2 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.deepEqual(
        plan2.entries.filter((e) => e.decision !== "no-change").map((e) => e.taskUuid),
        [id.alpha],
        "only the parent re-push remains; the create/no-change cells are settled",
      );
      const converge = await engine.applySyncPlan(plan2, passingGates(w, plan2));
      assert.equal(converge.status, "applied");
      mutatingRunIds.push(converge.runId);
      const acme1 = await w.port.getIssue(alphaIssueId);
      assert.match(acme1!.description, /\[ACME-\d+\] Beta child task/, "the mirrored description now carries the engine-minted child refs");

      const plan3 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.deepEqual(plan3.entries.filter((e) => e.decision !== "no-change"), [], "SC-001: zero pending changes over unchanged inputs");
      for (const entry of plan3.entries) {
        assert.ok(hasReason(entry, "mode:sync"), "checkpoints exist ⇒ sync mode (data-model §2)");
        assert.ok(!hasReason(entry, "bootstrap-no-checkpoint"), "sync runs never carry the bootstrap label");
      }
    });

    // ── 3 — both sides move; the plan classifies the matrix cells ──────────────────
    await t.test("engine-user-stories — a human edits the spec side while a teammate edits the issue side ⇒ buildSyncPlan classifies all three sync-matrix cells (FR-002/FR-004)", async () => {
      preR2AlphaDescription = (await w.port.getIssue(alphaIssueId))!.description;
      preR2Checkpoints = (await readCheckpointStore(w))!.checkpoints;
      preR2History = {
        alpha: payloadOf(w, id.alpha).history.slice(),
        beta: payloadOf(w, id.beta).history.slice(),
        gamma: payloadOf(w, id.gamma).history.slice(),
        zeta: payloadOf(w, id.zeta).history.slice(),
      };

      // Spec side: a paragraph under the parent, one under the nested child.
      writeFileSync(
        tasksPath,
        readFileSync(tasksPath, "utf8")
          .replace(
            "- [ ] 1.1: [ACME-1] Alpha rehearsal root\n",
            "- [ ] 1.1: [ACME-1] Alpha rehearsal root\n  Story walkabout — a spec-side edit for the e2e story.\n\n",
          )
          .replace(
            "    Beta child body — exists only in the spec; no tracker issue yet.\n",
            "    Beta child body — exists only in the spec; no tracker issue yet.\n    Beta spec-side story edit — a human moved the nested child body.\n\n",
          ),
        "utf8",
      );
      // The engine's PRE-RUN state starts here — the human edits are part of it, so the
      // rollback restore target includes them (they were never a run mutation).
      preR2TasksMd = readFileSync(tasksPath, "utf8");
      preR2Files = walkFiles(w.repositoryRoot);

      // Issue side: TEAMMATE edits go to the RAW fake (`w.fake`), bypassing the engine's
      // decorated port — `w.calls` stays the authoritative engine-attempt log.
      await w.fake.updateIssue(betaIssueId, {
        description: "Beta tracker-side drift — a teammate edited the issue in Linear.\n",
      });
      await w.fake.updateIssue(zetaIssueId, {
        description: "Zeta tracker-side drift — a teammate edit for the marker cell.\n",
      });

      const mark = callsMark(w);
      const plan4 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.deepEqual(mutationCalls(w, mark), [], "buildSyncPlan is read-only (constitution I)");
      driftPlan = plan4;

      const alpha4 = entryFor(plan4, id.alpha);
      assert.equal(alpha4.decision, "conflict");
      assert.ok(hasReason(alpha4, "description-conflict:spec-changed") && hasReason(alpha4, "action:overwrite-linear"), "cell: spec-changed ⇒ overwrite-linear (matrix §1–2)");
      const beta4 = entryFor(plan4, id.beta);
      assert.equal(beta4.decision, "conflict");
      assert.ok(hasReason(beta4, "description-conflict:both-changed") && hasReason(beta4, "action:report-only"), "cell: both-changed ⇒ report-only (built-in sync map, matrix §1)");
      const zeta4 = entryFor(plan4, id.zeta);
      assert.equal(zeta4.decision, "conflict");
      assert.ok(hasReason(zeta4, "description-conflict:linear-changed") && hasReason(zeta4, "action:overwrite-spec"), "cell: linear-changed ⇒ overwrite-spec (matrix §1–2)");
      assert.equal(entryFor(plan4, id.gamma).decision, "no-change", "the untouched control stays no-change");

      // FR-005: every conflict entry's reasons name BOTH the conflict type and the
      // resolved action — in the label, in the action tag, and in the composed reason.
      for (const [entry, type, action] of [
        [alpha4, "spec-changed", "overwrite-linear"],
        [beta4, "both-changed", "report-only"],
        [zeta4, "linear-changed", "overwrite-spec"],
      ] as const) {
        assert.ok(hasReason(entry, `conflict:${type}`), `conflict-type label for ${entry.taskUuid}`);
        assert.ok(hasReason(entry, `action:${action}`), `action label for ${entry.taskUuid}`);
        assert.ok(
          entry.reasons.some((r) => r.startsWith("reason:") && r.includes(type) && r.includes(action)),
          `FR-005 composed type+action reason for ${entry.taskUuid}: ${entry.reasons.join(" | ")}`,
        );
      }
    });

    // ── 4 — gated apply lands each cell per the matrix ─────────────────────────────
    await t.test("engine-user-stories — applySyncPlan (gates satisfied): the push transmits, the marker block renders into the drifted section, report-only writes nothing to either side", async () => {
      const mark = callsMark(w);
      const plan = driftPlan;
      assert.ok(plan !== null, "drift-time plan captured in the previous step");
      const apply2 = await engine.applySyncPlan(plan!, passingGates(w, plan!));
      assert.deepEqual(apply2.gateFailures, [], "gates satisfied ⇒ no refusals");
      assert.equal(apply2.status, "applied");
      r2RunId = apply2.runId;
      mutatingRunIds.push(apply2.runId);

      const statusOf = (taskUuid: string): string => apply2.operations.find((o) => o.taskUuid === taskUuid)!.status;
      assert.equal(statusOf(id.alpha), "applied", "spec-changed push landed");
      assert.equal(statusOf(id.beta), "skipped", "report-only surfaced the conflict without mutating either side");
      assert.equal(statusOf(id.gamma), "skipped", "no-change control wrote nothing");
      assert.equal(statusOf(id.zeta), "applied", "overwrite-spec marker write landed");

      // Push: the screened rendered REGION (body below the task line — pinned decision 1,
      // child lines with their refs included) reached ACME-1.
      const pushes = w.calls.slice(mark).filter((c) => c.method === "updateIssue" && c.args[0] === alphaIssueId);
      assert.equal(pushes.length, 1, "exactly one updateIssue toward ACME-1 in the run");
      const pushed = (pushes[0]!.args[1] as IssueUpdatePatch).description as string;
      assert.ok(pushed.includes("Story walkabout"), "the pushed description carries the human's spec edit");
      assert.ok(pushed.includes("Beta child task") && pushed.includes("[ACME-"), "the mirrored region carries the child task lines with their refs");
      assert.ok(!pushed.includes("Alpha rehearsal root"), "the parent's own task line never enters the mirrored region (decision 1)");

      // Matrix §2: the report-only and overwrite-spec cells push NOTHING to their issues.
      const issueWrites = w.calls.filter((c) => c.method === "updateIssue" && (c.args[0] === betaIssueId || c.args[0] === zetaIssueId));
      assert.deepEqual(issueWrites, [], "zero updateIssue toward the report-only and marker cells, across the whole story so far");
      assert.equal(
        (await w.port.getIssue(zetaIssueId))!.description,
        "Zeta tracker-side drift — a teammate edit for the marker cell.\n",
        "the marker cell's issue is byte-untouched",
      );

      // The R4 marker block replaced the drifted section body (research R4; toolId labels).
      const tasksMd = readFileSync(tasksPath, "utf8");
      const markerBlock =
        /<{7} task-linear-sync:local specs\/sync-demo\/tasks\.md#L\d+\n([\s\S]*?)\n={7}\n([\s\S]*?)\n>{7} task-linear-sync:linear ACME-2/.exec(tasksMd);
      assert.ok(markerBlock, "a git-style conflict block replaced the drifted section body (AC3)");
      assert.ok(markerBlock![1]!.includes("Zeta control body"), "LOCAL side = the pre-run section body verbatim");
      assert.ok(markerBlock![2]!.includes("teammate edit for the marker cell"), "TRACKER side = the issue description verbatim");
      tasksMdAfterR2 = tasksMd;

      // A conflict-only run creates and archives nothing.
      assert.deepEqual(w.calls.slice(mark).filter((c) => c.method === "createIssue" || c.method === "archiveIssue"), [], "no creates/archives in a conflict-only run");
    });

    // ── 5 — checkpoints + history pages verified ───────────────────────────────────
    await t.test("engine-user-stories — checkpoints advance ONLY for landed sync actions; canonical pages stay append-only with one event per affecting action (FR-008/FR-009)", async () => {
      const store2 = await readCheckpointStore(w);
      assert.ok(store2 !== null, "checkpoint store present");
      assert.notDeepEqual(store2!.checkpoints[id.alpha], preR2Checkpoints[id.alpha], "the landed push advanced the parent checkpoint (data-model §1)");
      assert.deepEqual(store2!.checkpoints[id.beta], preR2Checkpoints[id.beta], "report-only does NOT advance the checkpoint");
      assert.deepEqual(store2!.checkpoints[id.zeta], preR2Checkpoints[id.zeta], "a marker write does NOT advance the checkpoint (the cell is frozen until a human resolves)");
      assert.equal(
        payloadOf(w, id.alpha).descriptionContentHash,
        store2!.checkpoints[id.alpha]!.descriptionContentHash,
        "checkpoint and canonical page-0 payload agree after the landed action (FR-008)",
      );

      const alphaNow = payloadOf(w, id.alpha).history;
      assert.deepEqual(appendedSince(preR2History.alpha, alphaNow, "alpha").map((e) => e.kind), ["description-updated"], "one description-updated event for the landed action (FR-009)");
      alphaHistoryAfterR2 = alphaNow.slice();
      assert.deepEqual(appendedSince(preR2History.beta, payloadOf(w, id.beta).history, "beta").map((e) => e.kind), ["conflict-detected"], "conflict detection is an affecting action (matrix §2)");
      assert.deepEqual(
        appendedSince(preR2History.zeta, payloadOf(w, id.zeta).history, "zeta").map((e) => e.kind),
        ["conflict-detected"],
        "the marker write records conflict-detected (action:overwrite-spec)",
      );
      assert.ok(
        payloadOf(w, id.zeta).history.some((e) => e.kind === "conflict-detected" && (e.references ?? []).includes("action:overwrite-spec")),
        "the event references the action taken",
      );
      assert.deepEqual(historyKinds(w, id.gamma), ["issue-created"], "the untouched control's log is byte-stable");
    });

    // ── 6 — rollbackRun → SC-003 ───────────────────────────────────────────────────
    await t.test("engine-user-stories — rollbackRun fully restores (SC-003): every step rolled-back, files byte-equal, tracker reverted, checkpoints restored, one rollback event appended, pages retained", async () => {
      const rollback = await engine.rollbackRun(r2RunId);
      assert.equal(rollback.runId, r2RunId, "the result names the rolled-back run");
      assert.equal(rollback.status, "rolled-back", "the full rollback completes");
      assert.equal(rollback.refusal, undefined, "a journaled, unexpired run never refuses");
      assert.ok(rollback.reversedOperations >= 1, "inverse operations executed");

      // §3: the whole journal walk ended at rolled-back steps.
      const states = await stepStates(w, r2RunId);
      assert.ok(states.length >= 1, "the run journaled its steps");
      assert.deepEqual([...new Set(states)], ["rolled-back"], "every journaled step reached rolled-back");

      // §4: byte-equal repo restore — the marker is gone, the human's edits remain.
      assert.deepEqual(walkFiles(w.repositoryRoot), preR2Files, "the temp repo is byte-identical to the pre-run walk");
      const restoredMd = readFileSync(tasksPath, "utf8");
      assert.ok(!restoredMd.includes("<<<<<<<"), "the conflict-marker block was undone");
      assert.ok(restoredMd.includes("Story walkabout"), "the human's own edits are NOT undone — the restore target is the PRE-RUN state");

      // Tracker restore + zero collateral: ACME-1 back to its pre-run description.
      assert.equal((await w.port.getIssue(alphaIssueId))!.description, preR2AlphaDescription, "ACME-1 description restored to the pre-run value");
      assert.equal(
        (await w.port.getIssue(betaIssueId))!.description,
        "Beta tracker-side drift — a teammate edited the issue in Linear.\n",
        "the teammate edit was never part of the run — untouched by rollback",
      );

      // Checkpoints restored to the captured pre-run map (FR-013 restore-or-remove).
      assert.deepEqual((await readCheckpointStore(w))!.checkpoints, preR2Checkpoints, "the checkpoint store is restored from the journaled pre-run map");

      // History: pages retained and never rewound; the parent's page gains exactly one
      // `rollback` event referencing the reversed opIds (journal-rollback §3–§4, FR-016).
      const alphaAfter = payloadOf(w, id.alpha).history;
      const fresh = appendedSince(alphaHistoryAfterR2, alphaAfter, "alpha post-rollback");
      assert.ok(fresh.length >= 1 && fresh.every((e) => e.kind === "rollback"), "only `rollback` events were appended");
      assert.ok((fresh[0]!.references ?? []).length > 0, "the rollback event references the reversed opIds");
      for (const key of ["beta", "gamma", "zeta"] as const) {
        appendedSince(preR2History[key], payloadOf(w, id[key]).history, `${key} post-rollback`);
      }

      // Zero attachment URLs removed (FR-016): every story URL still resolves.
      for (const taskUuid of Object.values(id)) {
        assert.ok(
          [...w.fake.world.attachments.values()].some((a) => a.url === attachmentUrlFor(w, taskUuid)),
          "canonical page-0 URL retained",
        );
      }

      // The rollback run writes ITS OWN report + last-run marker (T036 precedent: the
      // rollback's own deterministic run id is distinct from the rolled-back run's).
      const marker = await readLastRunMarker(w.state);
      assert.ok(marker !== null, "last-run.json outcome marker written by the rollback run");
      assert.notEqual(marker!.runId, r2RunId, "the marker names the rollback's own run, not the rolled-back run");
      assert.equal(marker!.outcome, "completed");
      mutatingRunIds.push(marker!.runId);
      assert.ok(marker!.reportPaths, "the marker carries its report paths");
    });

    // ── 7 — re-plan + re-apply lands byte-identically ──────────────────────────────
    await t.test("engine-user-stories — after the rollback a fresh plan + apply lands byte-identically — the same cells recompute and the same marker bytes re-render", async () => {
      const rePlan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.equal(entryFor(rePlan, id.alpha).decision, "conflict", "the spec-changed cell recomputed");
      assert.ok(hasReason(entryFor(rePlan, id.zeta), "action:overwrite-spec"), "the linear-changed cell recomputed");

      const apply3 = await engine.applySyncPlan(rePlan, passingGates(w, rePlan));
      assert.equal(apply3.status, "applied");
      mutatingRunIds.push(apply3.runId);

      assert.equal(readFileSync(tasksPath, "utf8"), tasksMdAfterR2, "the re-applied file — marker block included, byte-for-byte — equals run R2's (determinism, R14)");
    });

    // ── 8 — resolve the marker by hand; the next run classifies normally ───────────
    await t.test("engine-user-stories — a human resolves the marker by hand (keeps the local side) and the NEXT buildSyncPlan classifies normally — no frozen state anywhere (matrix §4)", async () => {
      const resolved = resolveMarkerKeepLocal(readFileSync(tasksPath, "utf8"), ">>>>>>> task-linear-sync:linear ACME-2");
      writeFileSync(tasksPath, resolved, "utf8");
      assert.equal(resolved, preR2TasksMd, "keeping the local side restores the exact hand-edited bytes — the marker round-trip is loss-free");
      assert.ok(!resolved.includes("<<<<<<<") && !resolved.includes(">>>>>>>"), "no marker delimiters remain");

      const mark = callsMark(w);
      const plan5 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.deepEqual(mutationCalls(w, mark), [], "the post-resolution plan stays read-only");

      for (const entry of plan5.entries) {
        assert.notEqual(entry.decision, "skip-unresolved", "nothing is frozen once the human resolved the markers (FR-007 freeze lifted)");
        assert.ok(!hasReason(entry, "unresolved-conflict"), `no unresolved-conflict label on ${entry.taskUuid}`);
        assert.notEqual(entry.unresolvedConflict, true, "no entry carries the unresolved flag");
      }
      const zeta5 = entryFor(plan5, id.zeta);
      assert.ok(
        hasReason(zeta5, "description-conflict:linear-changed") && hasReason(zeta5, "action:overwrite-spec"),
        "the resolved section classifies as the ORDINARY linear-changed cell — the tracker text simply hasn't been adopted yet (post-resolution posture, matrix §4)",
      );
      assert.equal(entryFor(plan5, id.alpha).decision, "no-change", "the parent converged for good (SC-001 closure)");
      assert.ok(hasReason(entryFor(plan5, id.alpha), "no-description-conflict"));
      const beta5 = entryFor(plan5, id.beta);
      assert.ok(
        hasReason(beta5, "description-conflict:both-changed") && hasReason(beta5, "action:report-only"),
        "the conflict the story left for a human keeps classifying normally — reported, never silently overwritten",
      );
    });

    // ── epilogue — every mutating run reported under reports/<runId>/ ──────────────
    await t.test("engine-user-stories — every apply/rollback run wrote its report pair under reports/<runId>/ (frozen plan-report posture)", () => {
      const reportsRoot = join(w.stateDir, "reports");
      assert.ok(existsSync(reportsRoot), "reports/ exists");
      const dirs = new Set(readdirSync(reportsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
      assert.ok(mutatingRunIds.length >= 5, "the story performed its mutating runs");
      for (const runId of mutatingRunIds) {
        assert.ok(dirs.has(runId), `reports/${runId}/ exists (one report dir per mutating run)`);
        assert.ok(existsSync(join(reportsRoot, runId, "report.json")), `reports/${runId}/report.json`);
        assert.ok(existsSync(join(reportsRoot, runId, "report.md")), `reports/${runId}/report.md (sanitized markdown)`);
      }
    });
  } finally {
    await w.dispose();
  }
});
