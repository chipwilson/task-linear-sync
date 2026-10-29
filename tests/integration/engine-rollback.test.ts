/**
 * T036 [P] [US2] — Rollback lifecycle integration test through the frozen `SyncEngine`
 * interface (US2 AC3/AC4/AC5; FR-013/014/015/016; SC-003; contracts/journal-rollback.md
 * §2–§4 are normative for EVERY assertion here; quickstart 2.3 / 2.4 / 2.6; the
 * `rollback-full` / `rollback-interrupted` worlds ship the expectation table
 * (`expected/plan.json`) and the checkpoint baseline the rollback must restore-or-remove).
 *
 * RED BY DESIGN: this file COMPILES and FAILS at runtime while the apply/rollback seams
 * are unwired — `createSyncEngine` currently throws `EngineError` ("not wired until
 * phase 4") from `applySyncPlan`/`rollbackRun`. The structure needs NO edits when
 * T043/T044/T045 merge: every expectation comes from the contracts, the world goldens,
 * and the journal artifacts themselves — never re-derived inline, never hardcoded counts
 * (the interrupt-matrix bound is MEASURED from a real rollback's port-call count).
 *
 * Cells (one `engine-rollback —` titled test each, matrix = subtests):
 *  1. FULL LIFECYCLE (both worlds, one parametrized table): plan → gated apply →
 *     `rollbackRun(runId)` ⇒ every repo file byte-equal to the pre-run walk; the patched
 *     Alpha description restored (fake `getIssue` after === before); created Beta/Gamma
 *     issues `archived === true` and still `getIssue`-able (FR-016 never deletes);
 *     checkpoint entries restored, absent-in-`checkpointBefore` entries REMOVED (FR-013);
 *     journal + manifest steps all `rolled-back`; manifest `operations` complete — every
 *     attachment op (canonical AND continuation) with target issue, addressed URL and
 *     `priorMetadata` where one existed (FR-015); history per task after === before +
 *     exactly ONE `rollback` event referencing reversed opIds, zero prior events altered,
 *     zero attachment URLs removed, page-0 canonicals RETAINED with non-history payload
 *     mirroring the restored state (Alpha's `descriptionContentHash` back to the
 *     checkpoint value; the run-created Gamma/Beta canonicals survive);
 *  2. INTERRUPT MATRIX: `armInterrupt(w, { phase: "rollbackRun", atCall: N })` for every
 *     N in 1..measured-call-count — each armed run throws exactly once (`fired === 1`), a
 *     fresh engine (re-`attachEngine`) resumes to the cell-1 final state, and steps
 *     already `rolled-back` are NEVER re-executed (no repeated inverse calls after the
 *     resume mark, FR-014 / quickstart 2.4);
 *  3. CORRUPTED STEP: journal surgery so one step's live state matches NEITHER snapshot
 *     ⇒ `RollbackResult{ status: "partial" }`, journal stepState `conflict-halted` naming
 *     the op, walk HALTs; after an external fix the resume proceeds to completion;
 *  4. PRESERVATION: history never rewound, `CreateIntent` records never rewritten to
 *     `pending` nor replayed (zero `createIssue` calls during rollback), `last-run.json`
 *     outcome marker + report written for the rollback run (§2, §4);
 *  5. LOCK: `rollbackRun` acquires the advisory lock itself — refuses `LOCK_HELD` while a
 *     live lock exists (no mutation, journal untouched), then succeeds after release.
 *
 * Hermetic (constitution VI): fake-Linear worlds via the shared harness, temp state dir,
 * injected fixed clock, placeholder identities only (Principle III). Titles prefixed
 * `engine-rollback —` (tier pattern `--test-name-pattern engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AuditManifest,
  AuditOperation,
  Checkpoint,
  LastRunMarker,
  Plan,
  PlanDecision,
  SyncHistoryEvent,
} from "task-linear-sync/domain";
import { parseSyncStatePayload } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type {
  ApplyResult,
  AttachmentMetadata,
  AttachmentView,
  RollbackResult,
  SyncEngine,
} from "task-linear-sync/ports";
import { releaseRunLock } from "task-linear-sync/state";

import {
  armInterrupt,
  attachmentUrlFor,
  attachEngine,
  buildWorld,
  callsMark,
  callsOf,
  callsSince,
  corruptRunStepState,
  fixtureFile,
  holdRunLock,
  mutationCalls,
  openRunJournal,
  openRunManifest,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  sha256Hex,
  HarnessInterruptError,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";
import type { JournalStep } from "../../src/engine/journal.js";

// ───────────────────────────────────────────────────────── world expectation tables

/** One row of the worlds' `expected/plan.json` golden table (authored by the worlds lane). */
interface ExpectedEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
  readonly title: string;
  /** Issue KEY (placeholder ACME-*) resolved to the world seed id, or null ⇒ unmatched. */
  readonly matchedIssueKey: string | null;
  readonly decision: PlanDecision;
  readonly note?: string;
}

interface ExpectedWorldPlan {
  readonly world: string;
  readonly mode?: string;
  readonly entries: readonly ExpectedEntry[];
  readonly rollbackExpectations?: string;
}

/** Deterministic world identities by local task id (golden table, both worlds identical). */
interface WorldUuids {
  readonly alpha: string; // 1.1   matched spec-changed root (ACME-1)
  readonly beta: string; // 1.1.1 unmatched create (reversed order: second)
  readonly gamma: string; // 1.1.2 unmatched create (reversed order: FIRST per FR-011)
  readonly zeta: string; // 1.2   no-change control (ACME-2)
}

function uuidsFrom(expected: ExpectedWorldPlan): WorldUuids {
  const byTask = (localTaskId: string): string => {
    const entry = expected.entries.find((e) => e.localTaskId === localTaskId);
    assert.ok(entry, `golden table has task ${localTaskId}`);
    return entry!.taskUuid;
  };
  return {
    alpha: byTask("1.1"),
    beta: byTask("1.1.1"),
    gamma: byTask("1.1.2"),
    zeta: byTask("1.2"),
  };
}

/** The world seed's issue key→id map (same precedent as `engine-bootstrap.test.ts`). */
function issueIdForKey(world: EngineWorld, key: string): string {
  const seed = JSON.parse(readFileSync(fixtureFile(world, "world.json"), "utf8")) as {
    issues?: ReadonlyArray<{ readonly id: string; readonly key: string }>;
  };
  const issue = (seed.issues ?? []).find((i) => i.key === key);
  assert.ok(issue, `world seed for issue key ${key} (expected/plan.json ↔ world.json pairing)`);
  return issue!.id;
}

/** The frozen GateRequest satisfying every gate (precedent: `engine-bootstrap.test.ts`). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // exact per world config ("ACME")
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

// ─────────────────────────────────────────────────────────────────── read-side helpers

/** Recursive byte walk of the temp repo — the byte-equality unit for file restoration. */
function walkFiles(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) {
      Object.assign(out, walkFiles(join(dir, dirent.name), rel));
    } else {
      out[rel] = readFileSync(join(dir, dirent.name)).toString("base64");
    }
  }
  return out;
}

/** Every attachment of an issue across ALL pages (pagination is the fake's, not asserted away). */
async function allAttachments(world: EngineWorld, issueId: string): Promise<AttachmentView[]> {
  const views: AttachmentView[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await world.port.listAttachments(issueId, cursor);
    views.push(...page.items);
    if (page.nextCursor === null || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return views;
}

/** Tool-metadata value under the configured namespace key (string by the Attachment rule). */
function namespaceValue(meta: AttachmentMetadata, world: EngineWorld): string {
  const raw = meta[world.config.metadataNamespaceKey];
  assert.equal(typeof raw, "string", `${world.config.metadataNamespaceKey} metadata is a string`);
  return raw as string;
}

function parsePayload(meta: AttachmentMetadata, world: EngineWorld) {
  return parseSyncStatePayload(namespaceValue(meta, world));
}

async function canonicalMeta(
  world: EngineWorld,
  taskUuid: string,
): Promise<AttachmentMetadata | null> {
  const view = await world.port.getAttachmentByUrl(attachmentUrlFor(world, taskUuid));
  return view === null ? null : view.metadata;
}

/** Opened step journal (normalizes `JournalStep[]` vs `{ steps }` envelopes, harness §API). */
async function openJournal(world: EngineWorld, runId: string): Promise<JournalStep[]> {
  const doc = await openRunJournal<unknown>(world, runId);
  if (Array.isArray(doc)) return doc as JournalStep[];
  if (typeof doc === "object" && doc !== null && "steps" in doc && Array.isArray((doc as { steps: unknown }).steps)) {
    return (doc as { steps: JournalStep[] }).steps;
  }
  assert.fail(`journal for run '${runId}' is neither JournalStep[] nor { steps: JournalStep[] }`);
}

const openManifest = (world: EngineWorld, runId: string): Promise<AuditManifest> =>
  openRunManifest<AuditManifest>(world, runId);

/** Intent-directory audit snapshot: every `intents/*.json` byte (base64) by file name. */
function intentFiles(world: EngineWorld): Record<string, string> {
  const dir = join(world.stateDir, "intents");
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) out[name] = readFileSync(join(dir, name)).toString("base64");
  return out;
}

// ────────────────────────────────────────────────────────────────────── run fixtures

/**
 * A fully APPLIED run on a fresh world plus every pre-/post-apply capture the rollback
 * assertions need. Red at the apply seam today (T043/T045); afterwards it doubles as the
 * shared "state before rollback" evidence pack for every cell.
 */
interface AppliedFixture {
  readonly w: EngineWorld;
  readonly engine: SyncEngine;
  readonly expected: ExpectedWorldPlan;
  readonly seed: Record<string, Checkpoint>;
  readonly plan: Plan;
  readonly apply: ApplyResult;
  readonly uuids: WorldUuids;
  readonly alphaId: string;
  readonly betaId: string; // created-issue ids resolved via manifest + title (FR-011 order pinned)
  readonly gammaId: string;
  readonly tasksRel: string;
  readonly preRunFiles: Record<string, string>;
  readonly preRunTasksMd: string;
  readonly preRunAlphaDescription: string;
  readonly preRunAlphaTitle: string;
  readonly preRunCanonical: Record<"alpha" | "beta" | "gamma" | "zeta", AttachmentMetadata | null>;
  readonly postApplyCanonical: Record<"alpha" | "beta" | "gamma" | "zeta", AttachmentMetadata | null>;
  readonly postApplyIssueUrls: Record<string, string[]>;
  readonly postApplyIntents: Record<string, string>;
}

async function buildAppliedFixture(worldName: string): Promise<AppliedFixture> {
  const w = await buildWorld(worldName);
  const expected = readExpectedJson<ExpectedWorldPlan>(w, "plan.json");
  const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
  const uuids = uuidsFrom(expected);
  const alphaId = issueIdForKey(w, "ACME-1");
  await seedCheckpoints(w, seed);

  const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
  const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

  // Plan-boundary sanity (deep classification is T018/T020/T034 territory — decisions only):
  assert.equal(plan.entries.length, expected.entries.length, `${worldName}: plan entry count`);
  for (const exp of expected.entries) {
    const entry = plan.entries.find((e) => e.taskUuid === exp.taskUuid);
    assert.ok(entry, `plan entry for ${exp.localTaskId}`);
    assert.equal(entry!.decision, exp.decision, `plan decision for ${exp.localTaskId} (${exp.note ?? ""})`);
  }
  const tasksRel = plan.entries.find((e) => e.taskUuid === uuids.alpha)!.filePath;

  // Pre-run captures (nothing has mutated yet — plan is read-only by contract).
  const preRunFiles = walkFiles(w.repositoryRoot);
  const preRunTasksMd = readFileSync(join(w.repositoryRoot, tasksRel), "utf8");
  const alphaBefore = await w.port.getIssue(alphaId);
  assert.ok(alphaBefore, "seeded ACME-1 exists pre-apply");
  const preRunCanonical = {
    alpha: await canonicalMeta(w, uuids.alpha),
    beta: await canonicalMeta(w, uuids.beta),
    gamma: await canonicalMeta(w, uuids.gamma),
    zeta: await canonicalMeta(w, uuids.zeta),
  };
  assert.equal(preRunCanonical.beta, null, "Beta has no canonical page-0 pre-run (world seed)");
  assert.equal(preRunCanonical.gamma, null, "Gamma has no canonical page-0 pre-run (world seed)");

  // THE RED SEAM: gated apply throws EngineError ("not wired until phase 4") until
  // T043/T045 land. Afterwards it must complete with zero gate refusals.
  const apply = await engine.applySyncPlan(plan, passingGates(w, plan));
  assert.deepEqual(apply.gateFailures, [], "gates are satisfied ⇒ no refusals");
  assert.equal(apply.status, "applied", `apply must complete (got ${apply.status})`);

  // The run must have MOVED observable state (otherwise a "restored" rollback is vacuous).
  const alphaAfter = await w.port.getIssue(alphaId);
  assert.notEqual(alphaAfter!.description, alphaBefore!.description, "apply rewrote the drifted description");
  const postApplyCanonical = {
    alpha: await canonicalMeta(w, uuids.alpha),
    beta: await canonicalMeta(w, uuids.beta),
    gamma: await canonicalMeta(w, uuids.gamma),
    zeta: await canonicalMeta(w, uuids.zeta),
  };
  assert.notDeepEqual(postApplyCanonical.alpha, preRunCanonical.alpha, "canonical page-0 payload moved");

  // Created issues: exactly the two golden creates, discovered engine-neutrally from the
  // manifest and identified by title (FR-011 order is pinned in expected/plan.json).
  const manifest = await openManifest(w, apply.runId);
  const createOps = manifest.operations.filter((o) => o.kind === "create-issue");
  assert.equal(createOps.length, 2, "two journaled create ops (Beta + Gamma goldens)");
  let betaId = "";
  let gammaId = "";
  for (const op of createOps) {
    const issue = await w.port.getIssue(op.targetIssueId);
    assert.ok(issue, `created issue ${op.targetIssueId} is getIssue-able`);
    assert.equal(issue!.archived, false, "created issue is active post-apply");
    if (issue!.title === "Beta child task") betaId = op.targetIssueId;
    if (issue!.title === "Gamma sibling task") gammaId = op.targetIssueId;
  }
  assert.ok(betaId !== "" && gammaId !== "", "created-issue titles match the golden table");

  const postApplyIssueUrls: Record<string, string[]> = {};
  for (const [label, issueId] of Object.entries({ alpha: alphaId, beta: betaId, gamma: gammaId })) {
    postApplyIssueUrls[label] = (await allAttachments(w, issueId)).map((a) => a.url).sort();
  }

  // Create-intents: both golden creates journaled an intent BEFORE the attempt (R10);
  // a completed apply leaves them `confirmed-created` — never `pending`.
  const postApplyIntents = intentFiles(w);
  assert.equal(Object.keys(postApplyIntents).length, 2, "one CreateIntent per golden create");
  for (const [name, b64] of Object.entries(postApplyIntents)) {
    const intent = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { status?: string };
    assert.equal(intent.status, "confirmed-created", `intent ${name} confirmed after a landed create`);
  }

  return {
    w,
    engine,
    expected,
    seed,
    plan,
    apply,
    uuids,
    alphaId,
    betaId,
    gammaId,
    tasksRel,
    preRunFiles,
    preRunTasksMd,
    preRunAlphaDescription: alphaBefore!.description,
    preRunAlphaTitle: alphaBefore!.title,
    preRunCanonical,
    postApplyCanonical,
    postApplyIssueUrls,
    postApplyIntents,
  };
}

/**
 * Engine-neutral FINAL-STATE capture after a completed rollback — the value deep-compared
 * across the full-lifecycle cell and every interrupt-matrix resume (quickstart 2.4:
 * "the final state equals rollback-full's"). Content only — no per-scenario ids or wall
 * clock — everything deterministic under the injected clock (R14).
 */
async function captureRestoredStateAsync(fx: AppliedFixture): Promise<Record<string, unknown>> {
  const { w, uuids } = fx;
  const alpha = await w.port.getIssue(fx.alphaId);
  const beta = await w.port.getIssue(fx.betaId);
  const gamma = await w.port.getIssue(fx.gammaId);
  const store = await readCheckpointStore(w);
  const canonical: Record<string, AttachmentMetadata | null> = {};
  for (const label of ["alpha", "beta", "gamma", "zeta"] as const) {
    canonical[label] = await canonicalMeta(w, uuids[label]);
  }
  const historyLengths: Record<string, number | null> = {};
  for (const label of ["alpha", "beta", "gamma", "zeta"] as const) {
    const final = canonical[label];
    historyLengths[label] = final === null ? null : parsePayload(final, w).history.length;
  }
  return {
    files: walkFiles(w.repositoryRoot),
    alphaIssue: alpha === null ? null : { title: alpha.title, description: alpha.description, archived: alpha.archived },
    betaIssue: beta === null ? null : { title: beta.title, archived: beta.archived },
    gammaIssue: gamma === null ? null : { title: gamma.title, archived: gamma.archived },
    checkpoints: store === null ? null : store.checkpoints,
    canonical,
    historyLengths,
  };
}

/**
 * The SC-003 battery (journal-rollback.md §3–§4) against a completed rollback — used by
 * cell 1, the matrix golden world, and the post-fix resume of cell 3.
 */
async function assertFullRestoration(fx: AppliedFixture, rb: RollbackResult): Promise<void> {
  const { w, uuids } = fx;
  assert.equal(rb.runId, fx.apply.runId, "result names the rolled-back run");
  assert.equal(rb.status, "rolled-back", "full rollback completes");
  assert.equal(rb.refusal, undefined, "a completed rollback carries no refusal");

  const manifest = await openManifest(w, fx.apply.runId);
  const steps = await openJournal(w, fx.apply.runId);

  // §3 step-state machine: every journaled step reached `rolled-back`; manifest and
  // journal stay aligned by opId (both artifacts re-sealed per transition).
  assert.equal(steps.length, manifest.operations.length, "journal ↔ manifest op alignment");
  assert.deepEqual(steps.map((s) => s.opId), manifest.operations.map((o) => o.opId), "opId order alignment");
  for (const step of steps) {
    assert.equal(step.stepState, "rolled-back", `step ${step.opId} (${step.kind}) rolled back`);
  }
  for (const op of manifest.operations) {
    assert.equal(op.stepState, "rolled-back", `manifest op ${op.opId} mirrors the rolled-back state`);
  }

  // §1/FR-015 manifest completeness: unique sha256 opIds; every attachment op (canonical
  // AND continuation) carries target issue + addressed URL + prior metadata where one
  // existed; file backups hold the FULL pre-run content; checkpointBefore is the seed map.
  const opIds = new Set(manifest.operations.map((o) => o.opId));
  assert.equal(opIds.size, manifest.operations.length, "opIds are unique");
  for (const op of manifest.operations) {
    assert.match(op.opId, /^[0-9a-f]{64}$/, `opId is a sha256 hex (§1): ${op.opId}`);
    assert.ok(op.targetIssueId !== "", `op ${op.opId} targets an issue (frozen shape)`);
    if (op.kind === "upsert-attachment") {
      assert.ok(typeof op.attachmentUrl === "string" && op.attachmentUrl !== "", `attachment op ${op.opId} addresses its URL (FR-015)`);
      const priorKey = (["alpha", "beta", "gamma", "zeta"] as const).find(
        (label) => attachmentUrlFor(w, uuids[label]) === op.attachmentUrl,
      );
      const priorMeta = priorKey === undefined ? null : fx.preRunCanonical[priorKey];
      if (priorMeta !== null) {
        assert.notDeepEqual(op.priorMetadata, undefined, `op ${op.opId} journaled prior metadata (FR-015)`);
        assert.deepEqual(op.priorMetadata, priorMeta, `priorMetadata of ${op.attachmentUrl} equals the pre-run map`);
      }
    }
  }
  const tasksBackup = manifest.fileBackups.find((b) => b.path === fx.tasksRel || b.path.endsWith("/tasks.md"));
  assert.ok(tasksBackup, `manifest backed up ${fx.tasksRel} (fileBackups)`);
  assert.equal(tasksBackup!.beforeContent, fx.preRunTasksMd, "fileBackup carries the FULL pre-run content");
  assert.equal(tasksBackup!.beforeContentHash, sha256Hex(fx.preRunTasksMd), "fileBackup hash matches its content");
  const checkpointBefore: Record<string, Checkpoint> = {};
  for (const c of manifest.checkpointBefore) checkpointBefore[c.taskUuid] = c;
  assert.deepEqual(checkpointBefore, fx.seed, "checkpointBefore is exactly the seeded map (FR-013 material)");

  // Files: byte-equal to the pre-run walk.
  assert.deepEqual(walkFiles(w.repositoryRoot), fx.preRunFiles, "every repo file is byte-equal to pre-run");

  // Issue fields: the patched Alpha description restored to the exact pre-run value.
  const alpha = await w.port.getIssue(fx.alphaId);
  assert.ok(alpha, "ACME-1 still resolvable");
  assert.equal(alpha!.description, fx.preRunAlphaDescription, "ACME-1 description back to the pre-run value");
  assert.equal(alpha!.title, fx.preRunAlphaTitle, "ACME-1 title unchanged");
  assert.equal(alpha!.archived, false, "matched issue is never archived by rollback");

  // Created issues: archived, NEVER deleted (still getIssue-able — FR-013/016).
  for (const [label, id] of Object.entries({ beta: fx.betaId, gamma: fx.gammaId })) {
    const issue = await w.port.getIssue(id);
    assert.ok(issue, `created ${label} issue still getIssue-able — never deleted (FR-016)`);
    assert.equal(issue!.archived, true, `created ${label} issue archived === true`);
  }

  // Checkpoints: restored-or-removed (FR-013) — exactly the seed map survives.
  const store = await readCheckpointStore(w);
  assert.ok(store, "checkpoint store survives");
  assert.deepEqual(store!.checkpoints, fx.seed, "checkpoint map deep-equals the seed (Beta/Gamma REMOVED)");

  // FR-016/§4 history battery on the page-0 canonicals.
  const runOpIds = new Set(manifest.operations.map((o) => o.opId));
  for (const label of ["alpha", "beta", "gamma"] as const) {
    const url = attachmentUrlFor(w, uuids[label]);
    const retained = await w.port.getAttachmentByUrl(url);
    assert.ok(retained, `page-0 canonical ${url} RETAINED, never deleted (FR-016)`);
    const finalHistory = parsePayload(retained!.metadata, w).history;
    const postApply = fx.postApplyCanonical[label];
    assert.ok(postApply, `post-apply canonical for ${label} was captured`);
    const postApplyHistory = parsePayload(postApply!, w).history;
    const preRunMeta = fx.preRunCanonical[label];

    // exactly ONE appended `rollback` event; every prior event byte-identical.
    assert.equal(finalHistory.length, postApplyHistory.length + 1, `${label}: exactly one rollback event appended`);
    assert.deepEqual(finalHistory.slice(0, postApplyHistory.length), postApplyHistory, `${label}: zero prior events altered`);
    const rbEvent = finalHistory[finalHistory.length - 1]!;
    assert.equal<string | undefined>(rbEvent.kind, "rollback", `${label}: appended event kind`);
    assert.ok(rbEvent.references !== undefined && rbEvent.references.length > 0, `${label}: rollback event references reversed opIds`);
    for (const ref of rbEvent.references ?? []) {
      assert.ok(runOpIds.has(ref), `${label}: rollback reference '${ref}' is a journaled opId`);
    }
    // the seeded pre-run prefix (where one existed) survives byte-for-byte:
    if (preRunMeta !== null) {
      const preRunHistory = parsePayload(preRunMeta, w).history;
      assert.deepEqual(
        finalHistory.slice(0, preRunHistory.length),
        preRunHistory,
        `${label}: zero events lost since the pre-run prefix (never rewound)`,
      );
    }
  }

  // §4 zero pages removed: every attachment URL that existed post-apply still addresses.
  for (const [label, urls] of Object.entries(fx.postApplyIssueUrls)) {
    for (const url of urls) {
      const view = await w.port.getAttachmentByUrl(url);
      assert.ok(view, `attachment ${url} (task ${label}) retained — zero pages removed (FR-016)`);
    }
  }

  // FR-016 payload mirroring: Alpha's non-history payload reflects the RESTORED state —
  // descriptionContentHash back to the pre-run checkpoint value (the spec drift unwound).
  const alphaPayload = parsePayload((await canonicalMeta(w, uuids.alpha))!, w);
  assert.equal(
    alphaPayload.descriptionContentHash,
    fx.seed[uuids.alpha]!.descriptionContentHash,
    "page-0 payload mirrors the restored description (checkpoint hash)",
  );
  for (const label of ["beta", "gamma"] as const) {
    const meta = await canonicalMeta(w, uuids[label]);
    assert.ok(meta, `${label} run-created canonical RETAINED (FR-016)`);
    assert.equal(parsePayload(meta!, w).taskUuid, uuids[label], `${label} canonical keeps its identity anchor`);
  }
  // The no-change control was never touched: byte-identical metadata across the whole run.
  const zetaFinal = await canonicalMeta(w, uuids.zeta);
  assert.notDeepEqual(zetaFinal, null, "Zeta control canonical present");
  assert.deepEqual(zetaFinal, fx.preRunCanonical.zeta, "Zeta control canonical byte-identical — zero events, zero ops");
}

// ════════════════════════════════════════════════════════════════════════ CELLS

// ─── Cell 1: FULL LIFECYCLE on both worlds (one parametrized expectation table) ───
for (const worldName of ["rollback-full", "rollback-interrupted"]) {
  test(`engine-rollback — full lifecycle: every modified byte, field, checkpoint and history event restored (${worldName})`, async () => {
    const fx = await buildAppliedFixture(worldName);
    try {
      const rb = await fx.engine.rollbackRun(fx.apply.runId);
      await assertFullRestoration(fx, rb);
      // Result accounting: a clean full rollback reverses every journaled op (§3 walk).
      const manifest = await openManifest(fx.w, fx.apply.runId);
      assert.equal(rb.reversedOperations, manifest.operations.length, "every journaled op reversed");
    } finally {
      await fx.w.dispose();
    }
  });
}

// ─── Cell 2: INTERRUPT MATRIX (quickstart 2.4 / FR-014) ───
test("engine-rollback — interrupted rollbackRun: every port-call index resumes without repeating rolled-back steps", async (t) => {
  // Derive the matrix bound EMPIRICALLY: port calls made by one complete rollback run on
  // a fresh world (never hardcoded). Also seeds the golden final state.
  const goldenFx = await buildAppliedFixture("rollback-interrupted");
  let golden: Record<string, unknown> | null = null;
  let totalCalls = 0;
  try {
    const mark0 = callsMark(goldenFx.w);
    const rb0 = await goldenFx.engine.rollbackRun(goldenFx.apply.runId);
    totalCalls = callsSince(goldenFx.w, mark0).length;
    await assertFullRestoration(goldenFx, rb0);
    const manifest0 = await openManifest(goldenFx.w, goldenFx.apply.runId);
    assert.ok(totalCalls >= manifest0.operations.length, "rollback touches ≥1 port call per journaled op (bound sanity)");
    golden = await captureRestoredStateAsync(goldenFx);
  } finally {
    await goldenFx.w.dispose();
  }
  assert.ok(golden !== null);

  for (let n = 1; n <= totalCalls; n++) {
    await t.test(`crash at rollback port call ${n} of ${totalCalls} — resume completes to the golden state`, async () => {
      const fx = await buildAppliedFixture("rollback-interrupted");
      try {
        const handle = armInterrupt(fx.w, { phase: "rollbackRun", atCall: n });
        await assert.rejects(() => fx.engine.rollbackRun(fx.apply.runId), HarnessInterruptError, "interrupt throws at call N");
        assert.equal(handle.fired, 1, "the armed guard fired exactly once (and disarmed)");

        const stepsAtCrash = await openJournal(fx.w, fx.apply.runId);
        assert.ok(
          stepsAtCrash.every((s) => s.stepState === "rolled-back" || s.stepState === "applied" || s.stepState === "pending"),
          "the crashed journal holds only regular step states (no halt from a crash)",
        );
        const doneAtCrash = stepsAtCrash.filter((s) => s.stepState === "rolled-back");
        const manifest = await openManifest(fx.w, fx.apply.runId);
        const opById = new Map<string, AuditOperation>(manifest.operations.map((o) => [o.opId, o]));

        // RESUME on a FRESH engine (re-attachEngine): once-armed guard is spent, rollback proceeds.
        const mark = callsMark(fx.w);
        const engine2 = attachEngine(fx.w, createSyncEngine, { keyProvider: fx.w.keyProvider });
        const rb = await engine2.rollbackRun(fx.apply.runId);
        assert.equal(rb.status, "rolled-back", `resume after interrupt at call ${n} completes the rollback`);

        // FR-014: steps already `rolled-back` are never re-executed — no inverse call
        // after the resume mark may target an already-reversed op's subject.
        const violations: string[] = [];
        for (const call of callsSince(fx.w, mark)) {
          for (const step of doneAtCrash) {
            const op = opById.get(step.opId);
            if (op === undefined) continue;
            if (call.method === "archiveIssue" && op.kind === "create-issue" && call.args[0] === op.targetIssueId) {
              violations.push(`re-archived ${op.targetIssueId} (create op ${op.opId} was already rolled back)`);
            }
            if (call.method === "updateIssue" && op.kind === "update-issue" && call.args[0] === op.targetIssueId) {
              violations.push(`re-updated ${op.targetIssueId} (update op ${op.opId} was already rolled back)`);
            }
            if (call.method === "upsertAttachmentByUrl" && op.kind === "upsert-attachment" && op.attachmentUrl !== undefined) {
              const arg = call.args[0] as { url?: unknown } | undefined;
              if (arg !== undefined && arg.url === op.attachmentUrl) {
                violations.push(`re-upserted ${op.attachmentUrl} (attachment op ${op.opId} was already rolled back)`);
              }
            }
          }
        }
        assert.deepEqual(violations, [], `resume after interrupt at call ${n} replays no completed inverse`);

        // Final state equals the golden full-lifecycle outcome (quickstart 2.4).
        assert.deepEqual(await captureRestoredStateAsync(fx), golden, "interrupted-then-resumed final state is the golden state");
      } finally {
        await fx.w.dispose();
      }
    });
  }
});

// ─── Cell 3: CORRUPTED STEP — neither snapshot matches ⇒ conflict-halted + partial ───
test("engine-rollback — a step matching neither snapshot halts with partial, and an external fix lets the resume finish", async () => {
  const fx = await buildAppliedFixture("rollback-interrupted");
  try {
    // Corrupt the FIRST journaled op (reversed LAST by the reverse walk) so its live
    // state matches neither snapshot; keep the originals for the external fix.
    const steps = await openJournal(fx.w, fx.apply.runId);
    const target = steps[0]!;
    const saved = JSON.parse(JSON.stringify({ before: target.beforeSnapshot, after: target.afterSnapshot })) as {
      before: unknown;
      after: unknown;
    };
    await corruptRunStepState(fx.w, fx.apply.runId, { stepIndex: 0 }); // sentinel snapshots, stepState := applied

    const rb = await fx.engine.rollbackRun(fx.apply.runId);
    assert.equal(rb.status, "partial", "corrupted step ⇒ status partial (§3)");
    assert.equal(rb.refusal, undefined, "partial is a walk outcome, not a refusal (§2)");

    const halted = await openJournal(fx.w, fx.apply.runId);
    const conflicts = halted.filter((s) => s.stepState === "conflict-halted");
    assert.equal(conflicts.length, 1, "exactly one conflict-halted step (§3 HALT)");
    assert.equal(conflicts[0]!.opId, target.opId, "the halted step NAMES the corrupted op");
    const reversedBeforeHalt = halted.filter((s) => s.stepState === "rolled-back").length;
    assert.equal(rb.reversedOperations, reversedBeforeHalt, "result counts the steps reversed before the halt");
    assert.equal(halted.length - 1, reversedBeforeHalt, "the walk stopped at the halt — later steps untouched");

    // External fix: the operator reconciles the journal record; resume RE-EVALUATES the
    // halted step (§3 "resume re-evaluates") and completes the walk.
    await corruptRunStepState(fx.w, fx.apply.runId, {
      opId: target.opId,
      mutate: (step) => {
        step.beforeSnapshot = saved.before;
        step.afterSnapshot = saved.after;
      },
    });
    const engine2 = attachEngine(fx.w, createSyncEngine, { keyProvider: fx.w.keyProvider });
    const rb2 = await engine2.rollbackRun(fx.apply.runId);
    assert.equal(rb2.status, "rolled-back", "after the external fix the resume proceeds to completion");
    assert.ok(rb2.reversedOperations >= 1, "the resume reverses at least the fixed step");
    await assertFullRestoration(fx, rb2);
  } finally {
    await fx.w.dispose();
  }
});

// ─── Cell 4: PRESERVATION — history never rewound, intents never reset, marker written ───
test("engine-rollback — rollback preserves intents, replays no create, and writes the last-run marker", async () => {
  const fx = await buildAppliedFixture("rollback-full");
  try {
    const w = fx.w;
    const reportsDir = join(w.stateDir, "reports");
    const reportsBefore = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
    const mark = callsMark(w);

    const rb = await fx.engine.rollbackRun(fx.apply.runId);
    assert.equal(rb.status, "rolled-back");

    // Zero replay: rollback never re-attempts creates (FR-014/§4), whatever else it calls.
    assert.deepEqual(callsOf(w, "createIssue", mark), [], "zero createIssue calls during rollback");

    // CreateIntent records survive byte-identical — never rewritten to `pending` (§4).
    assert.deepEqual(intentFiles(w), fx.postApplyIntents, "CreateIntent files byte-identical across rollback");
    for (const [name, b64] of Object.entries(intentFiles(w))) {
      const intent = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { status?: string };
      assert.notEqual(intent.status, "pending", `intent ${name} never reset to pending (§4)`);
    }

    // History never rewound: post-apply prefixes byte-identical on every canonical.
    for (const label of ["alpha", "beta", "gamma", "zeta"] as const) {
      const meta = await canonicalMeta(w, fx.uuids[label]);
      assert.ok(meta, `${label} canonical retained post-rollback (FR-016)`);
      const finalHistory = parsePayload(meta!, w).history;
      const postApply = parsePayload(fx.postApplyCanonical[label]!, w).history;
      assert.deepEqual(finalHistory.slice(0, postApply.length), postApply, `${label}: history is a prefix-extension (never rewound)`);
      const added = finalHistory.slice(postApply.length).map((e: SyncHistoryEvent) => e.kind);
      assert.ok(added.every((k) => k === "rollback"), `${label}: only rollback events appended post-apply`);
    }

    // §2: the rollback run wrote its own report + the last-run.json outcome marker.
    const marker = await w.state.readJson<LastRunMarker>("last-run.json");
    assert.ok(marker, "last-run.json outcome marker written by the rollback run");
    assert.ok(marker!.runId !== "", "marker names a run");
    assert.ok(["completed", "failed", "aborted"].includes(marker!.outcome), `marker outcome is a legal value (${marker!.outcome})`);
    const reportsAfter = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
    const newReports = reportsAfter.filter((r) => !reportsBefore.includes(r));
    assert.equal(newReports.length, 1, "exactly one report directory for the rollback run");
    assert.ok(marker!.reportPaths, "marker carries reportPaths");
    for (const p of [marker!.reportPaths!.json, marker!.reportPaths!.markdown]) {
      assert.ok(existsSync(p) || existsSync(join(w.stateDir, p)), `report file exists: ${p}`);
    }
  } finally {
    await fx.w.dispose();
  }
});

// ─── Cell 5: LOCK — rollback acquires the advisory lock itself; refusal under contention ───
test("engine-rollback — rollback acquires the advisory lock and refuses LOCK_HELD while another run holds it", async () => {
  const fx = await buildAppliedFixture("rollback-full");
  try {
    const w = fx.w;
    const live = await holdRunLock(w, "engine-rollback-live-holder"); // same-pid ⇒ provably alive

    const mark = callsMark(w);
    const refused = await fx.engine.rollbackRun(fx.apply.runId);
    assert.equal(refused.status, "refused", "rollback refuses while the advisory lock is held (§2)");
    assert.equal(refused.refusal?.code, "LOCK_HELD", `refusal names LOCK_HELD (got ${refused.refusal?.code})`);
    assert.ok(typeof refused.refusal?.detail === "string" && refused.refusal!.detail !== "", "refusal detail is populated");
    assert.equal(refused.reversedOperations, 0, "a refused rollback reverses nothing");
    assert.deepEqual(mutationCalls(w, mark), [], "the refused rollback performed zero mutations");

    const steps = await openJournal(w, fx.apply.runId);
    assert.ok(steps.every((s) => s.stepState === "pending" || s.stepState === "applied"), "journal untouched by the refusal");
    const beta = await w.port.getIssue(fx.betaId);
    assert.equal(beta!.archived, false, "live state untouched while refused");
    assert.notEqual(
      readFileSync(join(w.repositoryRoot, fx.tasksRel), "utf8"),
      fx.preRunTasksMd,
      "the backed-up file is NOT restored by a refused rollback",
    );

    // Positive control: with the lock free, rollback acquires it itself and completes;
    // afterwards it released it again (the harness can re-acquire).
    await releaseRunLock(w.state, live);
    const done = await fx.engine.rollbackRun(fx.apply.runId);
    assert.equal(done.status, "rolled-back", "after release the rollback proceeds (it locks itself)");
    const probe = await holdRunLock(w, "engine-rollback-post-release-probe");
    await releaseRunLock(w.state, probe);
  } finally {
    await fx.w.dispose();
  }
});
