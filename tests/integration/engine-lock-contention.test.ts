/**
 * T038 [P] [US2] — Apply-side lock contention through the frozen `SyncEngine` interface
 * (frozen `src/state/lock.ts` advisory-lock semantics; research R10 enforcement order;
 * contracts/engine-pipeline.md: gates → **advisory lock** → stability re-fetch → journal →
 * mutations; tasks.md T038).
 *
 * RED BY DESIGN at the apply seam: `createSyncEngine` composes and `buildSyncPlan` is wired
 * (T026), but `applySyncPlan` throws `EngineError` until T043–T045 wire `apply.ts`. Every
 * cell runs its plan-side preconditions green TODAY and fails at exactly the seam call;
 * no test edits are needed when the wiring merges.
 *
 * Cell: a lock held EXTERNALLY — `holdRunLock` acquires via the frozen `acquireRunLock` and
 * never releases; the record carries this process's pid ⇒ provably alive ⇒ neither the
 * stale rule nor a takeover can apply — then a fully passing `GateRequest` hits
 * `applySyncPlan`:
 *  - `ApplyResult{ status: "refused", gateFailures: [LOCK_HELD] }` — the frozen code
 *    verbatim, with a non-empty sanitized detail (no engine-local refusal vocabulary);
 *  - the holder's `lock.json` record is byte-identical before/after: no re-acquire, no
 *    takeover, no rewrite of `acquiredAt`, no release (the loser reports and exits —
 *    frozen lock.ts contract);
 *  - ZERO port calls within the refused apply invocation — the lock refusal precedes the
 *    stability re-fetch (gate stage does the state-dir plan-reference check only), so no
 *    read-mutation either — and zero mutating calls across the whole world;
 *  - no journal/manifest artifacts and no `last-run.json` marker: a refusal produces no
 *    run residue;
 *  - a second apply attempt under the same external hold refuses identically and still
 *    leaves the holder's record untouched.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` world via the shared harness, temp
 * state directory, injected `FakeClock`, placeholder identities only (Principle III).
 * Titles prefixed `engine-lock-contention —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { RunLockRecord } from "task-linear-sync/state";
import { readLastRunMarker, releaseRunLock } from "task-linear-sync/state";

import {
  attachEngine,
  buildWorld,
  callsMark,
  callsSince,
  holdRunLock,
  mutationCalls,
  sha256Hex,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────────────────── helpers

/** The frozen `GateRequest` satisfying every gate (pattern of `engine-gate-order` test 4). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** The holder's lock record straight off the state dir (`lock.json` — frozen paths). */
function lockRecord(world: EngineWorld): RunLockRecord {
  return JSON.parse(readFileSync(join(world.stateDir, "lock.json"), "utf8")) as RunLockRecord;
}

/** Refusal codes of an `ApplyResult`, in engine order (complete listing). */
function gateCodes(result: { readonly gateFailures: readonly { code: string }[] }): readonly string[] {
  return result.gateFailures.map((f) => f.code);
}

// ──────────────────────────────────────────────────────────────────────── tests

test("engine-lock-contention — externally held lock ⇒ apply refuses with LOCK_HELD, holder record untouched, zero port calls, zero run residue", async () => {
  const w = await buildWorld("first-run-bootstrap");
  let holder: RunLockRecord | undefined;
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    holder = await holdRunLock(w, sha256Hex("t038/external-holder"));
    const holderBytes = readFileSync(join(w.stateDir, "lock.json"), "utf8");
    const before = lockRecord(w);
    assert.equal(before.runId, holder.runId, "fixture self-check: the external holder owns lock.json");
    assert.equal(before.pid, process.pid, "same-process pid ⇒ provably alive (no stale rule applies)");

    const mark = callsMark(w);
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    assert.equal(result.status, "refused");
    assert.deepEqual(gateCodes(result), ["LOCK_HELD"], "exactly the frozen LOCK_HELD code — all failures together, nothing invented");
    assert.ok(result.gateFailures[0]!.detail.length > 0, "the refusal carries a non-empty detail");
    assert.equal(result.operations.length, 0, "a refusal produces no operation outcomes");

    // The loser reports and exits: the holder's record is byte-identical — no re-acquire,
    // no takeover, no acquiredAt rewrite, no release.
    assert.deepEqual(lockRecord(w), before);
    assert.equal(readFileSync(join(w.stateDir, "lock.json"), "utf8"), holderBytes);

    // Zero read-backs AND zero mutations inside the refused invocation (the lock refusal
    // precedes the stability re-fetch); zero mutations across the whole world.
    assert.deepEqual(callsSince(w, mark), [], "no port call at all inside the refused apply — refusal precedes any read-back");
    assert.equal(mutationCalls(w).length, 0, "zero mutating port calls ever happened in this world");

    // No run residue: nothing was journaled, reported or marked.
    assert.equal(await readLastRunMarker(w.state), null, "a refused apply never touches last-run.json");
    assert.ok(!existsSync(join(w.stateDir, "manifests")), "no audit manifest materialized for the refused run");
    assert.ok(!existsSync(join(w.stateDir, "runs")), "no step journal materialized for the refused run");
  } finally {
    if (holder !== undefined) await releaseRunLock(w.state, holder);
    await w.dispose();
  }
});

test("engine-lock-contention — a second apply under the same external hold refuses identically and still leaves the holder record untouched", async () => {
  const w = await buildWorld("first-run-bootstrap");
  let holder: RunLockRecord | undefined;
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    holder = await holdRunLock(w, sha256Hex("t038/external-holder-persistent"));
    const holderBytes = readFileSync(join(w.stateDir, "lock.json"), "utf8");

    const first = await engine.applySyncPlan(plan, passingGates(w, plan));
    const second = await engine.applySyncPlan(plan, passingGates(w, plan));

    assert.equal(first.status, "refused");
    assert.equal(second.status, "refused");
    assert.deepEqual(gateCodes(second), ["LOCK_HELD"], "contention is idempotent — the loser always reports, never proceeds");
    assert.equal(readFileSync(join(w.stateDir, "lock.json"), "utf8"), holderBytes, "the holder's record is byte-stable across both refusals");
    assert.equal(mutationCalls(w).length, 0, "still zero mutations after both attempts");
  } finally {
    if (holder !== undefined) await releaseRunLock(w.state, holder);
    await w.dispose();
  }
});
