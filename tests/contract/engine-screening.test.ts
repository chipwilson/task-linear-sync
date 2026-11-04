/**
 * T039 [P] [US2] — Security contract test for engine screening (constitution I security
 * posture, research R12, contracts/engine-pipeline.md "Screening enforcement point").
 * World `secret-shape`: task 1.1's moved section carries a fabricated high-entropy
 * `api_key=…` assignment (blocking `secret-token`), task 1.2's moved section carries an
 * email (non-blocking redaction, `[redacted:email]`) and a `REVIEW REQUIRED` term
 * (non-blocking annotation, `…[review-term]`).
 *
 * RED BY DESIGN: `applySyncPlan` throws until T043/T045 wire the apply seam, so the
 * apply-side cells (2–6) FAIL at that seam today; the plan-side cell (1) exercises the
 * WIRED `buildSyncPlan` (T024/T026) + report screener pass (T025) and is green now. The
 * structure needs NO edits when the apply lanes merge — every expectation comes from the
 * frozen contract (per-op screen-before-transmit, sanitized category-only detail) and
 * the world fixtures, never from today's behavior. The engine runs with
 * `EngineOptions.screener = createDefaultSecurityScreener(config)` (harness constraint 6:
 * T039 pins its own screener), so the asserted vocabulary is the built-in rule set:
 * `secret-token`/`email`/`review-term`, sentinels `[blocked:<category>]`/`[redacted:email]`.
 *
 * Cells:
 *  1. PLAN SIDE (green today): after `buildSyncPlan`, nothing under the state dir
 *     (`plans/`, `reports/`) carries the raw sentinel, the secret value, a distinctive
 *     task-1 body phrase, or the raw email — the report writer pipes both artifacts
 *     through `screener.screen()` and plan entries carry hashes by construction.
 *  2. Blocked content never transmits (apply): NO task-1 string (raw sentinel, secret
 *     value, distinctive body phrase) appears in ANY recorded port-call argument — the
 *     `update-issue` op fails BEFORE transmission — and the clean sibling 1.2 still
 *     syncs (its `updateIssue` description update landed).
 *  3. Fails ONLY that op (apply): `ApplyResult.operations` shows 1.1 `failed` with a
 *     sanitized detail naming the finding CATEGORY (`secret-token`) and never the
 *     content; 1.2 `applied`; the run is not refused and not aborted (only a `fail`
 *     action aborts per engine-pipeline.md); `last-run.json` + result strings leak no
 *     content.
 *  4. Email redaction (apply): the transmitted description carries `[redacted:email]`;
 *     the raw `ops@example.invalid` address appears in NO port-call argument.
 *  5. Port-input screening, observable proxy (apply): the ONLY producer of the string
 *     `REVIEW REQUIRED[review-term]` is `screener.screen()`'s annotation posture
 *     (`screening.ts`, non-blocking `redact: false`), so finding the annotation in the
 *     text handed to `port.updateIssue`/`port.upsertAttachmentByUrl` proves the screener
 *     ran BEFORE transmission; the universal half asserts no bare (un-annotated) review
 *     term ever leaves through those methods.
 *  6. Artifacts stay clean (apply): the secret material appears in NO file under the
 *     state dir (`reports/`, `manifests/`, `runs/`, `plans/`, `last-run.json`) — sealed
 *     manifest/journal are OPENED with `world.keyProvider` and scanned as plaintext —
 *     and in no port-call argument.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` via the shared harness, temp state
 * directory, injected fixed clock, placeholder-only fixture material (Principle III — the
 * `api_key` value is a fabricated sentinel, never credential material).
 * Titles prefixed `engine-screening —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Checkpoint, Plan } from "task-linear-sync/domain";
import type { ApplyResult, IssueUpdatePatch } from "task-linear-sync/ports";
import type { GateRequest } from "task-linear-sync/gates";
import { readLastRunMarker } from "task-linear-sync/state";

import {
  attachEngine,
  buildWorld,
  callsOf,
  openRunJournal,
  openRunManifest,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";
import { createDefaultSecurityScreener } from "../../src/engine/screening.js";

// ────────────────────────────────────────────────────────────── fixture material

const TASK1_UUID = "dd837e71-fa46-5c11-8bff-31fb37eb5a8e"; // 1.1 — blocking section
const TASK2_UUID = "5516e12e-613a-5b40-838c-4a39ea1c547b"; // 1.2 — clean (redact/annotate)
const ISSUE1_ID = "ac000000-0000-4000-8000-000000000301"; // ACME-1
const ISSUE2_ID = "ac000000-0000-4000-8000-000000000302"; // ACME-2

/** The fabricated secret (world `repo/specs/sync-demo/tasks.md`, task 1.1). */
const SECRET_VALUE = "Ab1cD3eF5gH7iJ9kL2mN4oP6qR8sT";
const RAW_SENTINEL = `api_key=${SECRET_VALUE}`;
/** Distinctive substring of the task-1 body (only that section contains it). */
const TASK1_PHRASE = "rotate the deploy host";
/** Non-blocking PII needle (task 1.2 body) — must never transmit raw. */
const EMAIL_RAW = "ops@example.invalid";

/** Strings that must appear NOWHERE transmits or persists once screening is in force. */
const SECRET_NEEDLES: readonly string[] = [RAW_SENTINEL, SECRET_VALUE, TASK1_PHRASE];

function leaksIn(text: string, needles: readonly string[]): string[] {
  return needles.filter((n) => text.includes(n));
}

/** Every plain file under `dir`, recursively (state-dir sweeps). */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

/** Every string leaf of a call-args value (nested objects/arrays incl. serialized payloads). */
function* stringLeaves(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringLeaves(v);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) yield* stringLeaves(v);
}

/** The frozen all-green GateRequest (mirrors the T018 precedent). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/**
 * Seed the pinned sync-mode baseline (`expected/checkpoint-seed.json`), attach the engine
 * with the BUILT-IN default screener (research R12 vocabulary), build the plan, and apply
 * with satisfied gates. Today this throws at `applySyncPlan` ("not wired until T045") —
 * exactly the red seam this contract test is written against.
 */
async function drivePlanAndApply(world: EngineWorld): Promise<{ plan: Plan; result: ApplyResult }> {
  const engine = attachEngine(world, createSyncEngine, {
    keyProvider: world.keyProvider,
    screener: createDefaultSecurityScreener(world.config),
  });
  const plan = await engine.buildSyncPlan({ repositoryRoot: world.repositoryRoot });
  const result = await engine.applySyncPlan(plan, passingGates(world, plan));
  return { plan, result };
}

/** `updateIssue` attempts as (issueId, patch) views. */
function updateIssuePatches(world: EngineWorld): Array<{ id: string; patch: IssueUpdatePatch; ok: boolean }> {
  return callsOf(world, "updateIssue").map((c) => ({
    id: String(c.args[0]),
    patch: c.args[1] as IssueUpdatePatch,
    ok: c.ok,
  }));
}

function outcomeFor(result: ApplyResult, taskUuid: string) {
  const outcome = result.operations.find((o) => o.taskUuid === taskUuid);
  assert.ok(outcome, `ApplyResult.operations names task ${taskUuid} (per-op outcomes are complete)`);
  return outcome!;
}

/** Assert the full plan-side preconditions both apply tests rely on (world self-check). */
function assertBothSectionsPlanned(plan: Plan): void {
  assert.equal(plan.entries.length, 2, "world carries exactly the two sync-demo tasks");
  for (const uuid of [TASK1_UUID, TASK2_UUID]) {
    const entry = plan.entries.find((e) => e.taskUuid === uuid);
    assert.ok(entry, `plan entry for ${uuid}`);
    assert.ok(
      entry!.reasons.some((r) => r.includes("action:overwrite-linear")),
      `task ${uuid} plans the screened section toward the port (sync-map overwrite-linear): ${entry!.reasons.join(", ")}`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────── tests

test("engine-screening — plan side: stored plan and report artifacts carry no secret or address (report screener pass)", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const engine = attachEngine(w, createSyncEngine, {
      keyProvider: w.keyProvider,
      screener: createDefaultSecurityScreener(w.config),
    });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assertBothSectionsPlanned(plan);

    // Stage-7 persistence actually produced the artifacts this cell guards.
    assert.ok(existsSync(join(w.stateDir, "plans", `${plan.planId}.json`)), "plans/<planId>.json written");
    assert.ok(existsSync(join(w.stateDir, "reports")), "reports/ written");

    // Every persisted plan/report byte is content-free: hashes + screened summaries
    // (report.ts screener pass), never the raw section (constitution I).
    const files = filesUnder(w.stateDir);
    assert.ok(files.length > 0, "state dir holds plan artifacts");
    for (const file of files) {
      const leaks = leaksIn(readFileSync(file, "utf8"), [...SECRET_NEEDLES, EMAIL_RAW]);
      assert.deepEqual(leaks, [], `state-dir file '${file}' must carry no secret material (found: ${leaks.join(", ")})`);
    }
  } finally {
    await w.dispose();
  }
});

test("engine-screening — blocked section never transmits: no task-1 content in any port call; clean task 1.2 still syncs", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const { plan, result } = await drivePlanAndApply(w);
    assertBothSectionsPlanned(plan);
    assert.equal(result.status, "applied", `apply must complete (got ${result.status})`);

    // The blocked op must NOT transmit: every recorded argument — every method, incl.
    // attempted-but-thrown calls — stays free of raw sentinel, secret value, and any
    // distinctive task-1 body phrase.
    for (const call of w.calls) {
      const leaks = leaksIn(JSON.stringify(call.args), SECRET_NEEDLES);
      assert.deepEqual(leaks, [], `#${call.seq} ${call.method} args must carry no task-1 content (found: ${leaks.join(", ")})`);
    }
    assert.deepEqual(
      updateIssuePatches(w).filter((c) => c.id === ISSUE1_ID),
      [],
      "no updateIssue for ACME-1 may even be attempted — screening fails the op before transmission",
    );

    // The unaffected sibling syncs: 1.2's description update landed with its own body.
    const t2 = updateIssuePatches(w).find((c) => c.id === ISSUE2_ID);
    assert.ok(t2, "updateIssue for ACME-2 (screened section push)");
    assert.equal(t2!.ok, true, "ACME-2 update reached the fake port");
    assert.ok(
      t2!.patch.description?.includes("Ops digest baseline."),
      "the clean section still propagates (only the secret-shaped content is aborted)",
    );
  } finally {
    await w.dispose();
  }
});

test("engine-screening — blocking finding fails only its op: sanitized detail names categories, never content", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const { result } = await drivePlanAndApply(w);
    assert.deepEqual(result.gateFailures, [], "gates satisfied ⇒ no refusals");
    // A blocked op fails ONLY that content (R12): the run itself is neither refused nor
    // aborted — only a `fail` action drives status "aborted" (contracts/engine-pipeline.md).
    assert.equal(result.status, "applied", `blocking finding must not abort the run (got ${result.status})`);

    const blocked = outcomeFor(result, TASK1_UUID);
    assert.equal(blocked.status, "failed", `task 1.1 op fails on the secret-token finding (got ${blocked.status})`);
    assert.ok(blocked.detail, "failed op carries a detail");
    assert.ok(blocked.detail!.includes("secret-token"), `detail names the finding CATEGORY: ${blocked.detail}`);
    assert.deepEqual(leaksIn(blocked.detail!, SECRET_NEEDLES), [], "detail is sanitized — category only, never content");

    const clean = outcomeFor(result, TASK2_UUID);
    assert.equal(clean.status, "applied", `task 1.2 op still applies (got ${clean.status})`);
    assert.equal(clean.issueId, ISSUE2_ID, "1.2 outcome names its issue");

    // No result-side string leaks, and the run marker exists, names the run, and leaks.
    assert.deepEqual(leaksIn(JSON.stringify(result), SECRET_NEEDLES), [], "ApplyResult carries no content");
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker, "last-run.json marker written by apply (R13)");
    assert.equal(marker!.runId, result.runId, "marker names this run");
    assert.deepEqual(leaksIn(JSON.stringify(marker), SECRET_NEEDLES), [], "last-run marker carries no content");
  } finally {
    await w.dispose();
  }
});

test("engine-screening — email redacted in propagated output: [redacted:email] transmits, the raw address never does", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const { result } = await drivePlanAndApply(w);
    assert.equal(result.status, "applied", "the run completes (email is non-blocking)");

    const t2 = updateIssuePatches(w).find((c) => c.id === ISSUE2_ID);
    assert.ok(t2?.ok, "ACME-2 description update landed");
    assert.ok(
      t2!.patch.description?.includes("[redacted:email]"),
      `transmitted description carries the redaction sentinel: ${JSON.stringify(t2!.patch.description)}`,
    );

    for (const call of w.calls) {
      const text = JSON.stringify(call.args);
      assert.ok(!text.includes(EMAIL_RAW), `#${call.seq} ${call.method} args must not carry the raw email`);
    }
  } finally {
    await w.dispose();
  }
});

test("engine-screening — observable proxy: transmitted text is POST-annotation, proving port inputs passed the screener", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const { result } = await drivePlanAndApply(w);
    assert.equal(result.status, "applied", "the run completes");

    // OBSERVABLE PROXY: `REVIEW REQUIRED[review-term]` is produced ONLY by the built-in
    // screener's annotation posture (screening.ts, non-blocking `redact: false`). The
    // world's source text is bare `REVIEW REQUIRED`, so finding the annotation in the
    // transmitted description proves `screener.screen()` ran BEFORE the hand-off — no
    // internal call-spying needed.
    const t2 = updateIssuePatches(w).find((c) => c.id === ISSUE2_ID);
    assert.ok(
      t2?.ok && t2!.patch.description?.includes("REVIEW REQUIRED[review-term]"),
      "task 1.2's transmitted description is post-annotation (screener ran pre-transmission)",
    );

    // Universal half: a BARE review term must never leave through the content-bearing
    // port methods, whatever payload shape they carry (string leaves of the args).
    for (const method of ["updateIssue", "upsertAttachmentByUrl"] as const) {
      for (const call of callsOf(w, method)) {
        for (const leaf of stringLeaves(call.args)) {
          const bare = leaf.replaceAll("REVIEW REQUIRED[review-term]", "");
          assert.ok(
            !bare.includes("REVIEW REQUIRED"),
            `#${call.seq} ${method} carries an UN-annotated review term — content bypassed the screener`,
          );
        }
      }
    }
  } finally {
    await w.dispose();
  }
});

test("engine-screening — sentinels land nowhere under the state dir nor in any port call after apply", async () => {
  const w = await buildWorld("secret-shape");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const { plan, result } = await drivePlanAndApply(w);
    assertBothSectionsPlanned(plan);
    assert.equal(result.status, "applied", "the run completes to exercise the full artifact surface");

    // Every plain file: plans/, reports/, runs/, manifests/, sync-state.json, lock.json,
    // last-run.json — the whole state tree, no allow-list.
    const files = filesUnder(w.stateDir);
    assert.ok(files.length > 0, "apply wrote state artifacts to scan");
    for (const file of files) {
      const leaks = leaksIn(readFileSync(file, "utf8"), SECRET_NEEDLES);
      assert.deepEqual(leaks, [], `state-dir file '${file}' must carry no secret material (found: ${leaks.join(", ")})`);
    }
    assert.ok(existsSync(join(w.stateDir, "last-run.json")), "last-run.json marker exists after apply (R13)");

    // Sealed artifacts: ciphertext alone is not the standard — OPEN and scan the
    // plaintext (a journal step embedding an unscreened snapshot must not hide sealed).
    const manifest = await openRunManifest<unknown>(w, result.runId);
    assert.deepEqual(leaksIn(JSON.stringify(manifest), SECRET_NEEDLES), [], "opened audit manifest carries no secret material");
    const journal = await openRunJournal<unknown>(w, result.runId);
    assert.deepEqual(leaksIn(JSON.stringify(journal), SECRET_NEEDLES), [], "opened step journal carries no secret material");

    // And nothing was ever handed to the port (post-apply, whole lifetime).
    for (const call of w.calls) {
      const leaks = leaksIn(JSON.stringify(call.args), SECRET_NEEDLES);
      assert.deepEqual(leaks, [], `#${call.seq} ${call.method} args must carry no secret material (found: ${leaks.join(", ")})`);
    }
  } finally {
    await w.dispose();
  }
});
