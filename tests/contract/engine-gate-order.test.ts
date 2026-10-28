/**
 * T030 [P] [US2] — Frozen gate vocabulary + enforcement-order contract test
 * (contracts/engine-pipeline.md "applySyncPlan" + "rollbackRun"; tasks.md T030; frozen
 * vocabulary `src/gates/gates.ts`; refusals reuse frozen codes only — research R14).
 *
 * RED BY DESIGN at the apply/rollback wiring seams: `createSyncEngine` composes today and
 * `buildSyncPlan` is wired (T026), but `applySyncPlan`/`rollbackRun` throw
 * `EngineError("… not wired until phase 4 (T045 …)")` until T043–T045 land. Every cell
 * therefore runs its plan/artifact-side preconditions green TODAY and fails at exactly
 * one seam call; no test edits are needed when the wiring merges.
 *
 * Cells (enforcement order — gates → lock → stability re-check → journal → mutations):
 *  1. `APPLY_FLAG_MISSING` + `CONFIRMATION_KEY_MISMATCH` + `LOW_CONFIDENCE_NOT_ACCEPTED`
 *     collected together as `ApplyResult{ status:"refused" }` — before `lock.acquire`
 *     (no lock file, no lock record) and before ANY read-back (zero port calls);
 *  2. `PLAN_REFERENCE_UNKNOWN`: a never-persisted planId, refused via the frozen
 *     `validatePlanReference(plan = null)` re-run at apply start — no lock, no port calls;
 *  3. `PLAN_REFERENCE_STALE`: guards drifted after planning (the plan IS persisted by the
 *     wired `buildSyncPlan`; we mutate the guarded repo file) ⇒ refused, zero mutations.
 *     No lock/port assertions — the contract permits the drift to surface either at the
 *     gate stage or the post-lock stability re-check;
 *  4. `LOCK_HELD`: `holdRunLock` (same-pid ⇒ provably alive) then apply ⇒ the holder's
 *     `lock.json` record is untouched (no re-acquire, no takeover), zero read-backs;
 *  5. `rollbackRun` refuses `MANIFEST_UNJOURNALED` with `journalingEnabled:false`
 *     (manifest absent, no port calls, no lock residue);
 *  6. `rollbackRun` refuses `MANIFEST_EXPIRED` — a journaled run is fabricated directly in
 *     the state dir with the frozen `sealManifest` (both artifacts, journal-rollback.md §1
 *     layout) because apply cannot produce one until T043; the frozen `isManifestExpired`
 *     predicate pins the fixture green TODAY on both sides of `advancePastManifestExpiry`,
 *     so only the rollback seam itself is red — no skip needed;
 *  7. envelope tamper (`tamperRunArtifact` ciphertext byte flip) ⇒ refusal with NO
 *     plaintext: a canary exists only inside the sealed plaintext and must appear in
 *     neither a refusal payload nor a thrown `JournalError`/`ManifestTamperError` chain.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` worlds via the shared harness, temp
 * state dir, injected `FakeClock`, placeholder identities only (Principle III). Titles
 * prefixed `engine-gate-order —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { AuditManifest, Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { ApplyResult, RollbackResult } from "task-linear-sync/ports";
import type { RunLockRecord } from "task-linear-sync/state";
import { isManifestExpired, sealManifest } from "task-linear-sync/state";

import {
  advancePastManifestExpiry,
  attachEngine,
  buildWorld,
  callsMark,
  callsSince,
  holdRunLock,
  mutationCalls,
  sha256Hex,
  tamperRunArtifact,
  uuidFromLabel,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────────────────── helpers

/** Apply-side cells plan against this world (stage 7 persists `plans/<planId>.json`). */
const APPLY_WORLD = "first-run-bootstrap";

/** The world's only guarded task file (relative form matches `plan.guards.fileHashes`). */
const TASKS_REL = join("specs", "sync-demo", "tasks.md");

/** Distinctly wrong confirmation key (world config pins `"ACME"` — exact-match gate). */
const DECOY_CONFIRMATION_KEY = "T030-DECOY-KEY";

/** The frozen GateRequest satisfying every gate (pattern of `engine-bootstrap` test 4). */
function passingGates(world: EngineWorld, plan: Plan, overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // exact per world config
    acceptLowConfidence: plan.lowConfidencePresent, // accept iff the plan actually needs it
    planReference: plan.planId, // persisted plans/<planId>.json (stage 7)
    ...overrides,
  };
}

/** The refusal codes of an `ApplyResult`, in engine order (complete listing). */
function gateCodes(result: ApplyResult): readonly string[] {
  return result.gateFailures.map((f) => f.code);
}

/** Deterministic 64-hex runId (same shape as `deriveRunId`; never a real run here). */
const runIdFor = (label: string): string => sha256Hex(`t030/${label}`);

/**
 * Seed the artifacts a completed journaled apply would leave behind (frozen
 * `AuditManifest` at `manifests/<runId>.json` + 008 step journal at
 * `runs/<runId>/journal.json`, both sealed under the identical envelope posture,
 * journal-rollback.md §1) directly via the frozen `sealManifest` + `StateStore` —
 * rollback REFUSAL cells need readable artifacts, not live mutations, so they do not
 * wait on T043. `plaintextCanary` (when given) exists ONLY inside the sealed plaintext.
 */
async function seedJournaledRunArtifacts(world: EngineWorld, runId: string, plaintextCanary?: string): Promise<void> {
  const issueId = uuidFromLabel(`t030/${runId}/issue`);
  const opId = sha256Hex(`t030/${runId}/op`);
  const manifest: AuditManifest = {
    runId,
    createdAt: world.clock.now().toISOString(),
    repoRoot: world.repositoryRoot,
    planId: sha256Hex(`t030/${runId}/plan`),
    fileBackups: [],
    checkpointBefore: [],
    operations: [{ opId, kind: "update-issue", targetIssueId: issueId, stepState: "applied" }],
  };
  const steps = [
    {
      opId,
      kind: "update-issue",
      targetIssueId: issueId,
      beforeSnapshot: { title: "placeholder before title (T030 fixture)" },
      afterSnapshot: { title: "placeholder after title (T030 fixture)" },
      stepState: "applied",
    },
  ];
  const manifestValue = plaintextCanary === undefined ? manifest : { ...manifest, harnessCanary: plaintextCanary };
  const manifestEnv = await sealManifest(manifestValue, world.config, world.keyProvider, world.clock);
  await world.state.writeJson(`manifests/${runId}.json`, manifestEnv);
  const journalEnv = await sealManifest(steps, world.config, world.keyProvider, world.clock);
  await world.state.writeJson(`runs/${runId}/journal.json`, journalEnv);
}

/** `name: message` of the whole error/cause chain — the only thing a refusal may surface. */
function serializeErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(`${current.name}: ${current.message}`);
    current = (current as Error & { readonly cause?: unknown }).cause;
  }
  return parts.join("\n");
}

// ────────────────────────────────────────────────────────────────────────── tests

test("engine-gate-order — APPLY_FLAG_MISSING + CONFIRMATION_KEY_MISMATCH + LOW_CONFIDENCE_NOT_ACCEPTED collected together, no lock, zero port calls", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    // Fixture pairing guard: the low-confidence gate only fires for a plan that NEEDS acceptance.
    assert.equal(plan.lowConfidencePresent, true, `${APPLY_WORLD} must yield a low-confidence plan`);
    const mark = callsMark(w);

    // RED today at the wiring seam: applySyncPlan throws EngineError "not wired until phase 4".
    const result = await engine.applySyncPlan(
      plan,
      passingGates(w, plan, {
        applyFlag: false, // ⇒ APPLY_FLAG_MISSING
        confirmationKey: DECOY_CONFIRMATION_KEY, // ⇒ CONFIRMATION_KEY_MISMATCH (≠ "ACME")
        acceptLowConfidence: false, // ⇒ LOW_CONFIDENCE_NOT_ACCEPTED
        planReference: plan.planId, // valid ⇒ no PLAN_REFERENCE_* failure dilutes the trio
      }),
    );

    assert.equal(result.status, "refused", `complete gate listing refuses the run (got ${result.status})`);
    assert.deepEqual(
      [...gateCodes(result)].sort(),
      ["APPLY_FLAG_MISSING", "CONFIRMATION_KEY_MISMATCH", "LOW_CONFIDENCE_NOT_ACCEPTED"],
      `all three failures report TOGETHER — complete listing, frozen vocabulary only (got: ${gateCodes(result).join(", ")})`,
    );
    for (const failure of result.gateFailures) {
      assert.ok(failure.detail.length > 0, `GateFailure ${failure.code} carries a human-readable detail`);
    }
    assert.deepEqual([...result.operations], [], "a refused apply carries no operation outcomes");

    // Enforcement order: gates run BEFORE lock.acquire and BEFORE any read-back.
    assert.equal(existsSync(w.state.paths.lock), false, "gate refusal precedes lock.acquire — no lock file");
    assert.equal(await w.state.readJson<RunLockRecord>("lock.json"), null, "no lock record in the state dir");
    assert.deepEqual([...callsSince(w, mark)], [], "zero port calls during apply — gates precede any read-back");
    assert.deepEqual([...mutationCalls(w, mark)], [], "zero mutations");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — unknown planReference refuses PLAN_REFERENCE_UNKNOWN via frozen validatePlanReference, before lock and read-back", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.ok(
      existsSync(join(w.stateDir, "plans", `${plan.planId}.json`)),
      "the REAL planId is stored (stage 7) — so the refusal below proves the unknown reference itself",
    );
    const mark = callsMark(w);

    // Valid planId SHAPE (64-hex, derivePlanId-style) that was never persisted ⇒ plan = null.
    const unknownPlanId = sha256Hex("plan-reference-unknown");
    const result = await engine.applySyncPlan(plan, passingGates(w, plan, { planReference: unknownPlanId }));

    assert.equal(result.status, "refused");
    assert.deepEqual([...gateCodes(result)], ["PLAN_REFERENCE_UNKNOWN"], "sole refusal — every other gate passes");
    assert.equal(existsSync(w.state.paths.lock), false, "the planReference gate is part of the gate stage — no lock");
    assert.deepEqual([...callsSince(w, mark)], [], "zero port calls — no read-back behind a gate refusal");
    assert.deepEqual([...mutationCalls(w, mark)], [], "zero mutations");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — guards drifted after planning refuse PLAN_REFERENCE_STALE at apply start, zero mutations", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.ok(Object.keys(plan.guards.fileHashes).length > 0, "the plan captured guard file hashes (stage 6)");

    // Guards drift AFTER planning: the plan stands, the world moved — a drifted plan is
    // NEVER valid again; a rebuild is required (data-model §9 transition).
    appendFileSync(join(w.repositoryRoot, TASKS_REL), "\nT030 guard drift injected after planning.\n", "utf8");

    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    assert.equal(result.status, "refused");
    assert.deepEqual(
      [...gateCodes(result)],
      ["PLAN_REFERENCE_STALE"],
      `frozen validatePlanReference re-run refuses the drift (got: ${gateCodes(result).join(", ")})`,
    );
    assert.ok(result.gateFailures[0]!.detail.length > 0, "the stale refusal names the broken guards");
    // Deliberately NO lock/port-call assertions here: the contract permits the drift to
    // surface at the gate stage OR the post-lock stability re-check — only the frozen
    // zero-mutation guarantee is pinned across both compliant orderings.
    assert.deepEqual([...mutationCalls(w)], [], "zero mutations for the world lifetime (plan + drifted apply)");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — live lock contention refuses LOCK_HELD without re-acquiring or touching the holder's record", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    // Harness pre-seed: same-process pid ⇒ provably alive ⇒ stale takeover is impossible.
    const holder = await holdRunLock(w, runIdFor("live-lock-holder"));
    const mark = callsMark(w);

    const result = await engine.applySyncPlan(plan, passingGates(w, plan)); // gates all pass ⇒ lock stage refuses

    assert.equal(result.status, "refused");
    assert.deepEqual([...gateCodes(result)], ["LOCK_HELD"], "gates pass, so the refusal is exactly the contention");
    const record = await w.state.readJson<RunLockRecord>("lock.json");
    assert.ok(record, "the holder's lock.json survives the refusal");
    assert.equal(record!.runId, holder.runId, "no re-acquire/takeover — recorded runId untouched");
    assert.equal(record!.pid, holder.pid, "no re-acquire/takeover — recorded pid untouched");
    assert.deepEqual([...callsSince(w, mark)], [], "the lock refusal precedes any read-back (enforcement order)");
    assert.deepEqual([...mutationCalls(w, mark)], [], "zero mutations");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — rollbackRun refuses MANIFEST_UNJOURNALED when journaling is disabled", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    // journalingEnabled:false ⇒ applies proceed unjournaled and rollback MUST refuse
    // (frozen MANIFEST_UNJOURNALED posture, contracts/engine-pipeline.md EngineOptions).
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider, journalingEnabled: false });
    const runId = runIdFor("unjournaled-run");

    // RED today at the wiring seam: rollbackRun throws EngineError "not wired until phase 4".
    const result = await engine.rollbackRun(runId);

    assert.equal(result.status, "refused");
    assert.equal(result.refusal?.code, "MANIFEST_UNJOURNALED", "journaling off ⇒ frozen unjournaled refusal");
    assert.ok(result.refusal !== undefined && result.refusal.detail.length > 0, "the refusal carries a detail");
    assert.equal(result.reversedOperations, 0, "a refusal reverses nothing");
    assert.equal(existsSync(join(w.stateDir, "manifests", `${runId}.json`)), false, "journaling off ⇒ no manifest exists");
    assert.equal(await w.state.readJson("lock.json"), null, "a refused rollback leaves no advisory lock");
    assert.deepEqual([...w.calls], [], "a refused rollback performs zero port calls");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — rollbackRun refuses MANIFEST_EXPIRED once the envelope header passes manifestExpiryDays", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const runId = runIdFor("expired-run");
    // Feasible without apply (T043 NOT skipped): the frozen envelope functions produce the
    // exact artifacts a journaled run leaves behind — expiry is header-driven and needs no
    // mutations at all (journal-rollback.md §2: clock-injected, encryption-independent).
    await seedJournaledRunArtifacts(w, runId);

    const header = await w.state.readJson<{ readonly createdAt: string }>(`manifests/${runId}.json`);
    assert.ok(header, "sealed manifest exists at manifests/<runId>.json");
    assert.equal(isManifestExpired(header!, w.config, w.clock), false, "the fixture starts inside the expiry window");
    advancePastManifestExpiry(w); // frozen isManifestExpired uses strict `>` — the harness +1 day matters
    assert.equal(isManifestExpired(header!, w.config, w.clock), true, "fixture provably crosses the frozen threshold");
    const mark = callsMark(w);

    const result = await engine.rollbackRun(runId);

    assert.equal(result.status, "refused");
    assert.equal(result.refusal?.code, "MANIFEST_EXPIRED", "expiry refuses from the unencrypted header — no key needed");
    assert.ok(result.refusal !== undefined && result.refusal.detail.length > 0, "the refusal carries a detail");
    assert.equal(result.reversedOperations, 0, "a refusal reverses nothing");
    assert.deepEqual([...callsSince(w, mark)], [], "expiry refusal needs no decryption and no port read-back");
    assert.deepEqual([...mutationCalls(w, mark)], [], "zero mutations");
    assert.equal(await w.state.readJson("lock.json"), null, "a refused rollback leaves no advisory lock");
  } finally {
    await w.dispose();
  }
});

test("engine-gate-order — tampered envelope refuses with NO plaintext returned (JournalError diagnostic only)", async () => {
  const w = await buildWorld(APPLY_WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const runId = runIdFor("tampered-run");
    const canary = sha256Hex("plaintext-canary"); // exists ONLY inside the sealed plaintext
    await seedJournaledRunArtifacts(w, runId, canary);
    await tamperRunArtifact(w, runId, "manifest"); // ciphertext byte flip ⇒ openManifest tag check fails
    const mark = callsMark(w);

    let result: RollbackResult | undefined;
    let thrown: unknown;
    try {
      result = await engine.rollbackRun(runId);
    } catch (error) {
      thrown = error;
    }

    // Refusal either way — a frozen `RollbackResult{ status:"refused" }` or a thrown
    // JournalError/ManifestTamperError diagnostic — but the tag failure must surface AS a
    // tamper/tag failure (never success, never the unwired skeleton throw).
    if (thrown !== undefined) {
      const chain = serializeErrorChain(thrown);
      assert.match(
        chain,
        /tag check|tamper|journal|reject/i,
        `tamper must surface as a JournalError/ManifestTamperError diagnostic (red until T044/T045 wire rollbackRun — got: ${chain})`,
      );
      assert.ok(!chain.includes(canary), "the diagnostic chain carries NO plaintext");
    } else {
      assert.equal(result!.status, "refused", `a tampered journal cannot roll back (got ${result!.status})`);
    }
    assert.ok(!JSON.stringify(result ?? null).includes(canary), "the refusal payload carries NO plaintext");

    assert.deepEqual([...callsSince(w, mark)], [], "the tag check precedes any port read-back");
    assert.deepEqual([...mutationCalls(w, mark)], [], "zero mutations");
  } finally {
    await w.dispose();
  }
});
