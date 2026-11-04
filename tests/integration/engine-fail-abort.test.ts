/**
 * T037 [P] [US2] — Mapped `fail` action mid-run ⇒ `status:"aborted"` BEFORE the failing
 * task's mutation, applied steps stay rollback-able (tasks.md T037; quickstart 1.7 edge
 * case `fail`; contracts/conflict-resolution-matrix.md §2 `fail` row; data-model §9 run
 * lifecycle; research R6; `EngineFailError`).
 *
 * World: an IN-MEMORY variant of `spec-changed` (the stock `both-changed` world ships a
 * SINGLE conflicting task — too few for "fail on the SECOND conflicting task", so the
 * variant is authored per the harness schema): the fixture directory is copied to a temp
 * tree, `world.json` + `repo/` are edited (task 1.2 becomes a `both-changed` cell —
 * tracker side and spec side each moved away from a stale shared baseline), the copy is
 * fed to `buildWorld(dir)` (an existing directory path passes through), and the
 * programmatic config layer maps `syncConflictMap["both-changed"]` to `fail` while the
 * built-in keeps `spec-changed → overwrite-linear` (deep-merge, siblings retained). The
 * deterministic working order (filePath asc, lineNumber asc) then applies task 1.1
 * (`spec-changed` ⇒ `overwrite-linear`, a REAL `updateIssue` mutation) before task 1.2
 * resolves `fail` — the abort must land before 1.2's first mutation.
 *
 * RED BY DESIGN at the apply seam (posture of `engine-bootstrap` / `engine-gate-order`):
 * the PLAN-side cell passes TODAY (both `action:` labels resolve in the wired
 * `buildSyncPlan`); the abort cell calls `engine.applySyncPlan(plan, gates)` and fails at
 * exactly that seam with `EngineError("… not wired until phase 4 (T045 …)")` until
 * T043/T045 land. No test edits are needed when the wiring merges.
 *
 * The abort cell pins (matrix §2 `fail` row; data-model §9):
 *  - `ApplyResult.status === "aborted"`, gates satisfied (no refusals); 1.1's outcome
 *    `applied`, 1.2's `failed` with a SANITIZED detail (no body text propagates);
 *  - call log: 1.1's `updateIssue` (+ its `description-updated` history append) LANDED;
 *    ZERO mutating calls target 1.2 (issue id, uuid or canonical URL) — the run aborted
 *    BEFORE that task's mutation;
 *  - applied steps remain rollback-able WITHOUT re-running anything: the audit manifest
 *    (`manifests/<runId>.json`) and step journal (`runs/<runId>/journal.json`) exist for
 *    `result.runId` with 1.1's step `stepState:"applied"` (T036 exercises the actual
 *    `rollbackRun`; the seam is unwired today);
 *  - report + `last-run.json` record the abort: frozen `LastRunMarker.outcome ===
 *    "aborted"` naming `result.runId`, paired `reports/<runId>/report.json|md` exist and
 *    the report carries a FAIL security assertion naming the fail/abort (the exact
 *    guarantee label is T045's — the assertion's presence is the contract);
 *  - NO automatic rollback: zero `archiveIssue` calls and 1.1's pushed description stays
 *    applied (nothing reverts; the operator decides — R6);
 *  - the atomic checkpoint write follows the LAST mutation, so an aborted run leaves the
 *    checkpoint store byte-equal to the seed (rollback material stays consistent).
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` worlds via the shared harness, temp
 * variant + temp state dir, injected fixed clock, placeholder identities only
 * (Principle III). Titles prefixed `engine-fail-abort —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuditManifest, Checkpoint, Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { ApplyResult } from "task-linear-sync/ports";
import { readLastRunMarker } from "task-linear-sync/state";

import {
  attachEngine,
  attachmentUrlFor,
  buildWorld,
  hasCheckpoints,
  mutationCalls,
  openRunJournal,
  openRunManifest,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  sha256Hex,
  worldDir,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";
import type { JournalStep } from "../../src/engine/journal.js";

// ────────────────────────────────────────────────────── variant-world identities/material

/** 1.1 — `spec-changed` (first working row ⇒ `overwrite-linear` mutation lands first). */
const UUID_11 = "dd837e71-fa46-5c11-8bff-31fb37eb5a8e";
/** 1.2 — `both-changed` mapped to `fail` (second working row ⇒ abort target). */
const UUID_12 = "5516e12e-613a-5b40-838c-4a39ea1c547b";

const ISSUE_1 = "ac000000-0000-4000-8000-000000000301"; // ACME-1
const ISSUE_2 = "ac000000-0000-4000-8000-000000000302"; // ACME-2 (the fail cell)

/** Spec-side drift of 1.1 (untouched in the variant) — proof the applied write landed. */
const SPEC_PARAGRAPH_CANARY = "New spec-side paragraph added since the last sync.";
/** Original shared line for 1.2 in the `spec-changed` fixture (replaced by the variant). */
const ORIGINAL_BODY_12 = "  Beta contract body — untouched on both sides.";
/** Variant material — the two sides now moved in different directions (both-changed). */
const SPEC_SIDE_12 = "  Beta contract body — the spec side moved away.";
const TRACKER_SIDE_12 = "  Beta contract body — the tracker side moved away.\n";
/** Shared baseline NEITHER side still matches — arbitrary stale hash (R3 posture). */
const STALE_BASELINE_12 = "fail-abort variant: the shared baseline text moved on both sides";
/** Body-text canaries — sanitized surfaces must never carry them. */
const BODY_CANARIES = ["Beta contract body", SPEC_PARAGRAPH_CANARY];

// ────────────────────────────────────────────────────────────────────────── helpers

/** The frozen GateRequest satisfying every gate (pattern of `engine-bootstrap` test 4). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** Mutating port calls whose arguments reference any of `needles`. */
function mutationsTouching(world: EngineWorld, needles: readonly string[]): number {
  return mutationCalls(world).filter((c) => {
    const flat = JSON.stringify(c.args);
    return needles.some((n) => flat.includes(n));
  }).length;
}

/**
 * The in-memory variant world: copy `spec-changed`, drift BOTH sides of task 1.2
 * (world.json tracker side + repo tasks.md spec side), drop `name` (the harness pins it
 * to the directory basename), and deep-override `syncConflictMap["both-changed"] → fail`
 * through `buildWorld`'s programmatic config layer. Returns the world plus the temp
 * source root to remove AFTER `dispose()`.
 */
async function buildFailAbortVariant(): Promise<{ world: EngineWorld; variantRoot: string }> {
  const variantRoot = await mkdtemp(join(tmpdir(), "tls-008-fail-abort-src-"));
  try {
    const fixtureDir = join(variantRoot, "fail-abort-variant");
    await cp(worldDir("spec-changed"), fixtureDir, { recursive: true });

    const worldJsonPath = join(fixtureDir, "world.json");
    const doc = JSON.parse(readFileSync(worldJsonPath, "utf8")) as Record<string, unknown>;
    delete doc["name"]; // must equal the directory basename — let it derive
    const issues = doc["issues"] as Array<Record<string, unknown>>;
    const acme2 = issues.find((issue) => issue["key"] === "ACME-2");
    assert.ok(acme2, "fixture drift premise: spec-changed ships ACME-2");
    acme2!["description"] = TRACKER_SIDE_12; // tracker side moved
    doc["metadata"] = { scenario: "T037 variant: 1.1 spec-changed (overwrite-linear) then 1.2 both-changed mapped to fail" };
    await writeFile(worldJsonPath, `${JSON.stringify(doc, null, 2)}\n`);

    const tasksPath = join(fixtureDir, "repo", "specs", "sync-demo", "tasks.md");
    const tasks = readFileSync(tasksPath, "utf8");
    assert.ok(tasks.includes(ORIGINAL_BODY_12), "fixture drift premise: 1.2 ships the shared line");
    await writeFile(tasksPath, tasks.replace(ORIGINAL_BODY_12, SPEC_SIDE_12)); // spec side moved

    const world = await buildWorld(fixtureDir, {
      config: { syncConflictMap: { "both-changed": "fail" } }, // partial map — siblings kept
    });
    return { world, variantRoot };
  } catch (error) {
    await rm(variantRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Seed sync-mode checkpoints: 1.1 from the fixture golden, 1.2 against the stale hash. */
async function seedVariantCheckpoints(world: EngineWorld): Promise<Record<string, Checkpoint>> {
  const golden = readExpectedJson<Record<string, Checkpoint>>(world, "checkpoint-seed.json");
  const stale: Checkpoint = {
    ...golden[UUID_12]!,
    descriptionContentHash: sha256Hex(STALE_BASELINE_12), // matches NEITHER side ⇒ both-changed
  };
  const checkpoints = { ...golden, [UUID_12]: stale };
  await seedCheckpoints(world, checkpoints);
  assert.equal(await hasCheckpoints(world), true, "seeded ⇒ sync mode");
  return checkpoints;
}

function entryFor(plan: Plan, taskUuid: string, what: string): Plan["entries"][number] {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for ${taskUuid} (${what})`);
  return entry!;
}

// ─────────────────────────────────────────────────────────────────────────── tests

test("engine-fail-abort — variant plan: spec-changed overwrite-linear first, both-changed mapped to fail second (matrix §1/§2 recorded at plan time)", async () => {
  const { world: w, variantRoot } = await buildFailAbortVariant();
  try {
    // Deep-merge landed: the fail override plus the built-in spec-changed default.
    assert.equal(w.config.syncConflictMap["both-changed"], "fail", "programmatic override maps both-changed ⇒ fail");
    assert.equal(w.config.syncConflictMap["spec-changed"], "overwrite-linear", "built-in sync default retained for spec-changed");

    await seedVariantCheckpoints(w);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 2, "two tasks: the mutation cell + the fail cell");

    const entry11 = entryFor(plan, UUID_11, "1.1 spec-changed");
    assert.deepEqual(
      entry11.reasons.filter((r) => r.startsWith("conflict:")),
      ["conflict:spec-changed"],
      "1.1 classifies spec-changed",
    );
    assert.ok(entry11.reasons.includes("action:overwrite-linear"), "1.1 resolves the built-in overwrite-linear");
    assert.equal(entry11.decision, "conflict", "conflict decisions ride the frozen report channel (R13)");

    const entry12 = entryFor(plan, UUID_12, "1.2 both-changed → fail");
    assert.deepEqual(
      entry12.reasons.filter((r) => r.startsWith("conflict:")),
      ["conflict:both-changed"],
      "1.2 classifies both-changed (both sides moved away from the stale baseline)",
    );
    assert.ok(entry12.reasons.includes("action:fail"), "the map override is recorded FR-005-style at plan time");
    assert.ok(!entry12.reasons.includes("degraded:true"), "fail is the map read — not a degradation");

    // Plan purity: recording `fail` is inert — the abort belongs to apply.
    assert.equal(mutationsTouching(w, [ISSUE_1, ISSUE_2, UUID_11, UUID_12]), 0, "planning mutates nothing");
    assert.equal(existsSync(join(w.stateDir, "last-run.json")), false, "plan runs never write the marker (R13)");
  } finally {
    await w.dispose();
    await rm(variantRoot, { recursive: true, force: true });
  }
});

test("engine-fail-abort — mapped fail on the second conflicting task: aborted before its mutation, earlier step rollback-able, report + last-run.json record the abort, no automatic rollback", async () => {
  const { world: w, variantRoot } = await buildFailAbortVariant();
  try {
    const seeded = await seedVariantCheckpoints(w);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const acme1Before = w.fake.world.issues.get(ISSUE_1)?.description;
    assert.ok(acme1Before !== undefined, "premise: ACME-1 seeded");

    // Working order 1.1 → 1.2: the FIRST cell must land before the SECOND cell aborts
    // the run. RED at this seam until T043/T045 wire applySyncPlan.
    const result: ApplyResult = await engine.applySyncPlan(plan, passingGates(w, plan));

    // ── Abort shape (matrix §2 `fail` row; data-model §9).
    assert.deepEqual(result.gateFailures, [], "gates are satisfied ⇒ no refusals");
    assert.equal(result.status, "aborted", `the fail action aborts the run (got ${result.status})`);

    const op11 = result.operations.find((o) => o.taskUuid === UUID_11);
    const op12 = result.operations.find((o) => o.taskUuid === UUID_12);
    assert.ok(op11 && op11.status === "applied" && op11.issueId === ISSUE_1, "the earlier task applied through");
    assert.ok(op12, "the fail cell reports an operation outcome");
    assert.equal(op12!.status, "failed", "the fail cell FAILED before any mutation of its own");
    assert.ok(op12!.detail !== undefined && op12!.detail.length > 0, "sanitized fail detail surfaced");
    for (const canary of BODY_CANARIES) {
      assert.ok(!op12!.detail!.includes(canary), `fail detail stays sanitized (leak canary: "${canary}")`);
    }

    // ── Call log: 1.1's updateIssue + history append LANDED; 1.2 received NOTHING.
    const updates = w.calls.filter((c) => c.method === "updateIssue" && c.ok);
    assert.equal(updates.length, 1, `exactly one updateIssue (1.1 only), saw ${updates.length}`);
    assert.equal(updates[0]!.args[0], ISSUE_1, "the landed update targets ACME-1");
    const pushed = (updates[0]!.args[1] as { description?: string }).description ?? "";
    assert.ok(pushed.includes(SPEC_PARAGRAPH_CANARY), "overwrite-linear pushed the rendered spec side (screened)");
    assert.equal(mutationsTouching(w, [ISSUE_2, UUID_12, attachmentUrlFor(w, UUID_12)]), 0, "no mutation ever targeted the fail cell");

    // ── Applied steps remain rollback-able WITHOUT any rollback run: manifest + step
    // journal exist for result.runId with 1.1's step journaled `applied` (T036 owns the
    // rollbackRun itself — its seam is unwired today).
    const manifest = await openRunManifest<AuditManifest>(w, result.runId);
    assert.equal(manifest.runId, result.runId, "manifest names the aborted run");
    assert.equal(manifest.planId, plan.planId, "manifest carries the plan identity");
    assert.ok(manifest.operations.length >= 1, "the audit manifest recorded the applied operation(s)");
    const journal = await openRunJournal<JournalStep[] | { steps: JournalStep[] }>(w, result.runId);
    const steps = Array.isArray(journal) ? journal : journal.steps;
    assert.ok(
      steps.some((s) => s.stepState === "applied" && s.targetIssueId === ISSUE_1),
      "the step journal keeps ACME-1's step rollback-able (stepState applied)",
    );

    // ── Report + last-run.json record the abort (frozen LastRunMarker vocabulary).
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker, "the aborted run writes last-run.json");
    assert.equal(marker!.outcome, "aborted", "last-run.json records the abort");
    assert.equal(marker!.runId, result.runId, "the marker names the aborted run");
    assert.ok(marker!.reportPaths, "the marker references the paired run report");
    assert.equal(marker!.reportPaths!.json, join(w.stateDir, "reports", result.runId, "report.json"), "run report rides reports/<runId>/");
    assert.ok(existsSync(marker!.reportPaths!.json), "report.json exists");
    assert.ok(existsSync(marker!.reportPaths!.markdown), "report.md exists");
    const report = JSON.parse(readFileSync(marker!.reportPaths!.json, "utf8")) as {
      securityAssertions: ReadonlyArray<{ guarantee: string; status: string }>;
    };
    // The exact guarantee label is T045's decision — presence of the FAIL entry is the
    // contract ("report records the abort").
    assert.ok(
      report.securityAssertions.some((a) => a.status === "fail"),
      "the run report carries the abort as a FAIL security assertion",
    );

    // ── NO automatic rollback (R6: the operator decides): nothing archives, nothing
    // reverts, and the checkpoint store byte-matches the seed (its atomic write follows
    // the LAST mutation — an aborted run never reaches it, keeping rollback material
    // consistent with `checkpointBefore`).
    assert.equal(w.calls.filter((c) => c.method === "archiveIssue").length, 0, "no automatic archiveIssue");
    assert.equal(w.fake.world.issues.get(ISSUE_1)?.description, pushed, "1.1's applied description remains (no revert)");
    assert.notEqual(w.fake.world.issues.get(ISSUE_1)?.description, acme1Before, "the applied write is NOT rolled back");
    assert.equal(w.fake.world.issues.get(ISSUE_2)?.description, TRACKER_SIDE_12, "the fail cell's tracker side is untouched");
    const store = await readCheckpointStore(w);
    assert.deepEqual(store?.checkpoints, seeded, "aborted runs never write the checkpoint store");
  } finally {
    await w.dispose();
    await rm(variantRoot, { recursive: true, force: true });
  }
});
