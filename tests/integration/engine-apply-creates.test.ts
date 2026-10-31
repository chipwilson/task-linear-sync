/**
 * T034 [P] [US2] — Apply-side creates integration test through the frozen `SyncEngine`
 * interface (US2 AC1/AC2; FR-011/FR-012; quickstart 2.1–2.2; research R10; data-model §8;
 * worlds `rollback-full` + `indeterminate-create` with expectations from their
 * `expected/plan.json` tables — never re-derived inline).
 *
 * RED BY DESIGN at the apply seam: `createSyncEngine` composes and `buildSyncPlan` is wired
 * (T026), but `applySyncPlan` throws `EngineError` until T043–T045 wire `apply.ts`. Every
 * cell runs its plan-side preconditions green TODAY and fails at exactly the seam call;
 * no test edits are needed when the wiring merges.
 *
 * Cells:
 *  1. `rollback-full` (quickstart 2.1) — mutation-order CONSTRAINTS asserted from
 *     `world.calls` (the exact cross-task interleaving is the engine's decision per the
 *     world's `expectedOpOrder`): same-parent siblings REVERSED (GAMMA create strictly
 *     before BETA create, FR-011); children never precede the matched parent's own
 *     update-issue op; every create carries the parent issue as `parentId` (parents
 *     before children). The pushed ACME-1 description is the drifted spec-side mirror
 *     INCLUDING the nested child task lines (pinned cross-lane decision 1 — body below
 *     the task line only, never the task line/heading). Exactly one page-0 canonical
 *     attachment upsert per landed task (FR-008) with one history event per affecting
 *     action, append-only (FR-009); the `no-change` control task sees zero calls. Assigned
 *     task lines are rewritten in place through 004 `renderTaskLines` with the created
 *     issue reference + derived title — byte-exact re-render of the temp repo file after
 *     apply. Checkpoint store, run report and `last-run.json` marker land.
 *  2. `indeterminate-create`, ZERO-match reconciliation (quickstart 2.2, FR-012,
 *     data-model §8): the world.json `createFailures` script (auto-armed by `buildWorld`,
 *     harness docblock) throws `HarnessCreateFailureError` without the fake EVER seeing
 *     the create — exactly ONE attempt, never retried. `findIssuesByAttachmentUrl`
 *     reconciles the probe's canonical URL, finds 0 (the seed mentions the probe UUID
 *     nowhere) ⇒ exactly one intent file, terminal `indeterminate` (frozen
 *     `src/state/intent.ts` shapes); child 2.1.1 creation ABORTS (zero create calls, zero
 *     intents); the task's op outcome is `failed` with a sanitized detail and the run
 *     still lands healthy task 2.2 and writes the marker. A SECOND apply run (fresh plan +
 *     fresh engine over the same world — "resume") replays ZERO `createIssue` calls and
 *     leaves the intent set byte-stable (FR-012: indeterminate is never auto-replayed).
 *  3. `indeterminate-create` ONE-match variant: after planning and before apply, seed ONE
 *     attachment carrying the probe's canonical URL on a fresh carrier issue (the fake
 *     world maps are the seeded reality the reconcile consults, harness docblock) ⇒ the
 *     reconcile adopts it: intent terminal `confirmed-created`/`reconciled` (never
 *     `pending`/`indeterminate`), page-0 canonical attachment + exactly one
 *     `issue-created` history event land on the carrier (history-log.md: adoption IS an
 *     issue-created action), and child 2.1.1 creation PROCEEDS hanging off the adopted
 *     issue (`parentId`).
 *  4. `indeterminate-create` MULTI-match variant: TWO carriers seeded at the same
 *     canonical URL ⇒ intent terminal `indeterminate`, task creation aborts (child sees
 *     zero creates, zero intents), and the Principle II integrity-failure diagnostic is
 *     SURFACED — containment, not run abort: the diagnostic rides the task's op outcome
 *     sanitized detail (frozen `ApplyResult` posture: "OperationOutcomes carry sanitized
 *     details"; R10 aborts further creation FOR THAT TASK while FR-012 keeps the run
 *     alive), and healthy 2.2 still lands.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` worlds via the shared harness, temp
 * state directory, injected `FakeClock`, placeholder identities only (Principle III).
 * Titles prefixed `engine-apply-creates —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  Checkpoint,
  IssueRef,
  Plan,
  SyncHistoryEvent,
  SyncStatePayload,
  Task,
} from "task-linear-sync/domain";
import { parseSyncStatePayload } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import { builtInAdapters } from "task-linear-sync/discovery";
import type { LineAssignment, TaskFileAdapter } from "task-linear-sync/parsing";
import { parseTaskFile, renderTaskLines } from "task-linear-sync/parsing";
import type { ApplyResult, CreateIssueInput, IssueUpdatePatch, IssueView } from "task-linear-sync/ports";
import type { CreateIntent } from "task-linear-sync/state";
import { listIntentsByTask, readLastRunMarker } from "task-linear-sync/state";

import {
  attachmentUrlFor,
  attachEngine,
  buildWorld,
  callsMark,
  callsOf,
  mutationCalls,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  uuidFromLabel,
  type EngineWorld,
  type PortCallRecord,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────────────────── helpers

/** The guarded task file, repo-relative POSIX (the plan/parse identity form). */
const TASKS_POSIX = "specs/sync-demo/tasks.md";

/** One entry of a world's `expected/plan.json`. */
interface ExpectedPlanEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
  readonly title: string;
  readonly matchedIssueKey: string | null;
  readonly decision: string;
  readonly parentUuid?: string;
  readonly note?: string;
}

interface ExpectedPlanFile {
  readonly world: string;
  readonly mode?: "bootstrap" | "sync";
  readonly entries: readonly ExpectedPlanEntry[];
}

/** The frozen `GateRequest` satisfying every gate (pattern of `engine-gate-order`/`engine-bootstrap`). */
function passingGates(world: EngineWorld, plan: Plan, overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
    ...overrides,
  };
}

/** Seeded issue id by tracker key (placeholder `ACME-*` from `world.json`). */
function issueIdByKey(world: EngineWorld, key: string): string {
  for (const view of world.fake.world.issues.values()) {
    if (view.key === key) return view.id;
  }
  assert.fail(`fixture world '${world.name}' has no seeded issue with key '${key}'`);
}

/** Every attempted `createIssue` (the harness decorator logs attempts, ok:false included). */
function createRecords(world: EngineWorld, sinceMark = 0): readonly PortCallRecord[] {
  return callsOf(world, "createIssue", sinceMark);
}

const createTitle = (record: PortCallRecord): string => (record.args[0] as CreateIssueInput).title;

/** First index into `world.calls` matching `pred`, or -1. */
function indexOfCall(world: EngineWorld, pred: (record: PortCallRecord) => boolean): number {
  return world.calls.findIndex(pred);
}

/** The fake-world issue carrying `title` (newly created or seeded). */
function fakeIssueByTitle(world: EngineWorld, title: string): IssueView {
  for (const view of world.fake.world.issues.values()) {
    if (view.title === title) return view;
  }
  assert.fail(`fake world carries no issue titled '${title}'`);
}

/**
 * Split a tracker key `KEY-123` into the 004 `IssueRef` shape — in the world's issue-key
 * namespace. The harness port decorator re-keys fake-minted identifiers (`teamAbbrev-N`) to
 * `<confirmationKey>-N`, the only prefix the frozen 005 title strip recognizes
 * (src/titles/strip.ts), and the engine rewrites that re-keyed ref into the spec; the expected
 * re-render must therefore split the NUMBER from the raw key but carry the namespace.
 */
function splitIssueRef(world: EngineWorld, view: IssueView): IssueRef {
  const match = /^(.+)-(\d+)$/.exec(view.key);
  assert.ok(match?.[1] !== undefined && match[2] !== undefined, `issue key '${view.key}' is not KEY-number`);
  return { key: world.config.confirmationKey, number: Number(match[2]) };
}

/** The current sync-state payload on the attachment living at `url` (fake-world read). */
function attachmentPayloadAt(world: EngineWorld, url: string): SyncStatePayload {
  for (const record of world.fake.world.attachments.values()) {
    if (record.url !== url) continue;
    const raw = record.metadata[`__${world.config.toolId}`];
    assert.equal(typeof raw, "string", `attachment at ${url} lacks the tool sync-state metadata key`);
    return parseSyncStatePayload(raw as string);
  }
  assert.fail(`fake world carries no attachment at ${url}`);
}

/**
 * Seed a reconciliation carrier AFTER planning: one issue + one attachment carrying
 * `taskUuid` at canonical `url`, registered in the fake's live `attachments`/`byUrl`/
 * `perIssue` maps exactly like `createFakeLinearPort` seeding does — `findIssuesByAttachmentUrl`
 * outcome count IS the number of such carriers (harness docblock: seed one ⇒ adopt,
 * seed two ⇒ integrity). Placeholders only (Principle III).
 */
function seedReconcileCarrier(world: EngineWorld, url: string, taskUuid: string, n: number): IssueView {
  const issueId = uuidFromLabel(`t034/reconcile-carrier-${n}`);
  const view: IssueView = {
    id: issueId,
    key: `CAR-${700 + n}`,
    teamKey: "TEAM-A",
    projectId: "proj-alpha",
    title: `Reconcile carrier ${n} (T034 fixture placeholder)`,
    description: "Placeholder carrier body — the create response was lost; the identity attachment proves it landed.\n",
    stateType: "todo",
    updatedAt: "2026-01-01T00:00:03.000Z",
    archived: false,
  };
  world.fake.world.issues.set(issueId, view);
  const attachmentId = `att-t034-reconcile-${n}`;
  world.fake.world.attachments.set(attachmentId, {
    id: attachmentId,
    issueId,
    url,
    title: "task-linear-sync sync state",
    metadata: { taskUuid },
  });
  const carriers = world.fake.world.byUrl.get(url) ?? new Set<string>();
  carriers.add(issueId);
  world.fake.world.byUrl.set(url, carriers);
  const perIssue = world.fake.world.perIssue.get(issueId) ?? [];
  perIssue.push(attachmentId);
  world.fake.world.perIssue.set(issueId, perIssue);
  return view;
}

/** The op outcome for `taskUuid`, or undefined when the run recorded none. */
function outcomeFor(result: ApplyResult, taskUuid: string) {
  return result.operations.find((o) => o.taskUuid === taskUuid);
}

/** Read the `description` of the (single) description-pushing `updateIssue` on `issueId`. */
function pushedDescription(world: EngineWorld, issueId: string): string {
  const updates = world.calls.filter(
    (c) => c.method === "updateIssue" && c.args[0] === issueId && (c.args[1] as IssueUpdatePatch).description !== undefined,
  );
  assert.equal(updates.length, 1, `expected exactly one description-carrying updateIssue on ${issueId}`);
  return (updates[0]!.args[1] as IssueUpdatePatch).description as string;
}

/** The (single) upsert call at the canonical page-0 URL of `taskUuid`. */
function assertOnePageZeroUpsert(world: EngineWorld, taskUuid: string): void {
  const url = attachmentUrlFor(world, taskUuid);
  const upserts = callsOf(world, "upsertAttachmentByUrl").filter(
    (c) => (c.args[0] as { url: string }).url === url,
  );
  assert.equal(upserts.length, 1, `expected exactly one page-0 canonical upsert for ${taskUuid} (FR-008)`);
}

/** Count history events of `kind` in a payload (append-only log page). */
function eventsOfKind(payload: SyncStatePayload, kind: SyncHistoryEvent["kind"]): number {
  return payload.history.filter((h) => h.kind === kind).length;
}

// ─────────────────────────────────────────────────── cell 1: rollback-full (2.1)

test("engine-apply-creates — rollback-full apply: reversed siblings + parents-before-children from the call log, task lines byte-re-rendered via 004, one page-0 attachment + one history event per landed action", async () => {
  const w = await buildWorld("rollback-full");
  try {
    const expected = readExpectedJson<ExpectedPlanFile>(w, "plan.json");
    const [alpha, gamma, beta, zeta] = expected.entries as [
      ExpectedPlanEntry,
      ExpectedPlanEntry,
      ExpectedPlanEntry,
      ExpectedPlanEntry,
    ];
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, seed);

    const tasksPath = join(w.repositoryRoot, "specs", "sync-demo", "tasks.md");
    const preBytes = readFileSync(tasksPath, "utf8");

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    assert.equal(result.status, "applied");
    assert.match(result.runId, /^[0-9a-f]{64}$/);
    assert.deepEqual(result.gateFailures, []);
    assert.ok(
      result.operations.every((o) => o.status !== "failed"),
      `no op may fail in the healthy world: ${JSON.stringify(result.operations)}`,
    );

    // ── call-log order constraints (world expectedOpOrder — interleaving is engine's choice) ──
    const acme1Id = issueIdByKey(w, "ACME-1");
    const acme2Id = issueIdByKey(w, "ACME-2");

    const creates = createRecords(w);
    assert.equal(creates.length, 2, "exactly Beta + Gamma are created");
    assert.ok(creates.every((c) => c.ok), "no create fails in this world");
    assert.deepEqual(creates.map(createTitle).sort(), [beta.title, gamma.title].sort(), "derived titles land on the create inputs");
    const gammaIdx = creates.findIndex((c) => createTitle(c) === gamma.title);
    const betaIdx = creates.findIndex((c) => createTitle(c) === beta.title);
    assert.ok(gammaIdx >= 0 && betaIdx >= 0);
    assert.ok(gammaIdx < betaIdx, "FR-011: same-parent siblings emit in REVERSED working order — GAMMA before BETA");
    for (const c of creates) {
      assert.equal((c.args[0] as CreateIssueInput).parentId, acme1Id, "creates carry the matched parent issue");
    }

    const parentUpdateIdx = indexOfCall(
      w,
      (c) => c.method === "updateIssue" && c.args[0] === acme1Id && (c.args[1] as IssueUpdatePatch).description !== undefined,
    );
    assert.ok(parentUpdateIdx >= 0, "the matched parent's spec-changed description is pushed");
    const firstCreateIdx = indexOfCall(w, (c) => c.method === "createIssue");
    assert.ok(parentUpdateIdx < firstCreateIdx, "children never precede their parent's own ops (parents before children)");

    // ── pushed mirror region: drifted body incl. child task lines, never the task line/heading ──
    const pushed = pushedDescription(w, acme1Id);
    assert.ok(pushed.includes("Spec-side paragraph added since the last sync"), "the drift paragraph is in the pushed region");
    assert.match(pushed, /- \[ \] 1\.1\.1: (?:\[[^\]]+\] )?Beta child task/, "child task line 1.1.1 in the pushed region (T031 note)");
    assert.match(pushed, /- \[ \] 1\.1\.2: (?:\[[^\]]+\] )?Gamma sibling task/, "child task line 1.1.2 in the pushed region (T031 note)");
    assert.ok(!pushed.includes(alpha.title), "the mirrored region never carries the task's own line title");
    assert.ok(!pushed.includes("Phase 1"), "the mirrored region never carries the heading");

    // ── the no-change control: zero calls, payload byte-stable ──
    assert.ok(
      !w.calls.some((c) => (c.method === "updateIssue" || c.method === "archiveIssue") && c.args[0] === acme2Id),
      "Zeta is untouched on the tracker",
    );
    assertOnePageZeroUpsert(w, alpha.taskUuid);
    assertOnePageZeroUpsert(w, beta.taskUuid);
    assertOnePageZeroUpsert(w, gamma.taskUuid);
    assert.equal(
      callsOf(w, "upsertAttachmentByUrl").filter((c) => (c.args[0] as { url: string }).url === attachmentUrlFor(w, zeta.taskUuid)).length,
      0,
      "zero-change ⇒ no page-0 rewrite for Zeta",
    );

    // ── one history event per affecting action, append-only (FR-009) ──
    const alphaPayload = attachmentPayloadAt(w, attachmentUrlFor(w, alpha.taskUuid));
    assert.equal(alphaPayload.history[0]?.kind, "matched", "the seeded history entry is preserved (never rewound)");
    assert.equal(eventsOfKind(alphaPayload, "description-updated"), 1, "exactly one description-updated event");
    for (const child of [beta, gamma]) {
      const payload = attachmentPayloadAt(w, attachmentUrlFor(w, child.taskUuid));
      assert.equal(payload.taskUuid, child.taskUuid);
      assert.equal(eventsOfKind(payload, "issue-created"), 1, `one issue-created event for ${child.localTaskId}`);
    }
    const zetaPayload = attachmentPayloadAt(w, attachmentUrlFor(w, zeta.taskUuid));
    assert.deepEqual(zetaPayload.history.map((h) => h.kind), ["matched"], "Zeta's history log is untouched");
    assert.equal(zetaPayload.descriptionContentHash, seed[zeta.taskUuid]?.descriptionContentHash);

    // ── created issues in the fake world ──
    const betaView = fakeIssueByTitle(w, beta.title);
    const gammaView = fakeIssueByTitle(w, gamma.title);
    assert.equal(betaView.archived, false);
    assert.equal(gammaView.archived, false);

    // ── assigned task lines rewritten via 004 renderTaskLines: byte-exact re-render ──
    const parsed = parseTaskFile(TASKS_POSIX, preBytes, builtInAdapters.generic as TaskFileAdapter, w.config);
    const betaTask = parsed.file.tasks.find((t) => t.localTaskId === "1.1.1");
    const gammaTask = parsed.file.tasks.find((t) => t.localTaskId === "1.1.2");
    assert.ok(betaTask !== undefined && gammaTask !== undefined, "fixture parses to the child tasks");
    assert.equal(betaTask.stableUuid, beta.taskUuid, "parse identity aligns with the plan entry");
    assert.equal(gammaTask.stableUuid, gamma.taskUuid);
    const betaCreate = creates[betaIdx]!;
    const gammaCreate = creates[gammaIdx]!;
    const assignments: readonly LineAssignment[] = [
      { task: betaTask as Task, desiredTitle: createTitle(betaCreate), issueRef: splitIssueRef(w, betaView) },
      { task: gammaTask as Task, desiredTitle: createTitle(gammaCreate), issueRef: splitIssueRef(w, gammaView) },
    ];
    const expectedContent = renderTaskLines(TASKS_POSIX, preBytes, assignments, w.config).content;
    assert.equal(readFileSync(tasksPath, "utf8"), expectedContent, "assigned task lines carry issue ref + derived title");
    const betaNumber = /-(\d+)$/.exec(betaView.key)?.[1] ?? "";
    assert.match(readFileSync(tasksPath, "utf8"), new RegExp(`1\\.1\\.1: \\[${w.config.confirmationKey}\\-${betaNumber}\\]`));
    assert.ok(
      preBytes.split("\n").some((line) => line.includes("1.1: [ACME-1] Alpha rehearsal root")) &&
        readFileSync(tasksPath, "utf8").includes("1.1: [ACME-1] Alpha rehearsal root"),
      "the parent's own task line is untouched (pinned decision 1)",
    );

    // ── checkpoints, report, marker ──
    const store = await readCheckpointStore(w);
    assert.ok(store !== null);
    for (const entry of expected.entries) {
      assert.ok(store.checkpoints[entry.taskUuid] !== undefined, `checkpoint for ${entry.localTaskId} lands`);
    }
    assert.equal(store.checkpoints[beta.taskUuid]?.issueId, betaView.id);
    assert.equal(store.checkpoints[gamma.taskUuid]?.issueId, gammaView.id);
    assert.notEqual(store.checkpoints[alpha.taskUuid]?.descriptionContentHash, seed[alpha.taskUuid]?.descriptionContentHash, "the drifted baseline is re-baselined");
    assert.deepEqual(store.checkpoints[zeta.taskUuid], seed[zeta.taskUuid], "the no-change checkpoint is byte-stable");
    assert.equal(mutationCalls(w).every((c) => c.ok), true, "no mutation failed");
    assert.ok(result.reportPaths !== undefined && existsSync(result.reportPaths.json), "run report lands");
    const marker = await readLastRunMarker(w.state);
    assert.equal(marker?.runId, result.runId, "last-run.json marker records the applied run");
  } finally {
    await w.dispose();
  }
});

// ──────────────────────────── cell 2: indeterminate-create, zero match + resume

test("engine-apply-creates — indeterminate-create: scripted create failure + ZERO identity matches ⇒ terminal indeterminate intent, child + resume replay aborted (zero createIssue calls), healthy task still lands (FR-012)", async () => {
  const w = await buildWorld("indeterminate-create");
  try {
    const expected = readExpectedJson<ExpectedPlanFile>(w, "plan.json");
    const [probe, child, healthy] = expected.entries as [ExpectedPlanEntry, ExpectedPlanEntry, ExpectedPlanEntry];
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    // ── exactly ONE create attempt; it fails in the harness injector, the fake never sees it ──
    const creates = createRecords(w);
    assert.equal(creates.length, 1, "a failed create is NEVER auto-retried");
    assert.equal(createTitle(creates[0]!), probe.title);
    assert.equal(creates[0]!.ok, false);
    assert.match(creates[0]!.error ?? "", /HarnessCreateFailureError/);
    assert.equal(
      w.requests().filter((r) => r.op === "issueCreate" && r.vars.title === probe.title).length,
      0,
      "the scripted failure never reaches the fake (world unchanged)",
    );
    assert.equal(creates.filter((c) => createTitle(c).includes(child.title)).length, 0, "the child never sees a create call");

    // ── reconciliation ran over the canonical URL (zero matches) ──
    const probeUrl = attachmentUrlFor(w, probe.taskUuid);
    assert.ok(
      callsOf(w, "findIssuesByAttachmentUrl").some((c) => c.args[0] === probeUrl),
      "the failed create is reconciled by canonical identity URL",
    );

    // ── intents: exactly one probe intent, terminal indeterminate; zero child intents ──
    const probeIntents = await listIntentsByTask(w.state, probe.taskUuid);
    assert.equal(probeIntents.length, 1);
    assert.equal(probeIntents[0]!.status, "indeterminate", "data-model §8 terminal state for a zero-match reconcile");
    assert.deepEqual(await listIntentsByTask(w.state, child.taskUuid), [], "the aborted child never wrote an intent");

    // ── op outcomes: probe failed with a sanitized report detail; child aborted; run survives ──
    const probeOp = outcomeFor(result, probe.taskUuid);
    assert.ok(probeOp !== undefined, "the indeterminate task carries a report entry");
    assert.equal(probeOp.status, "failed");
    assert.equal(typeof probeOp.detail, "string");
    assert.ok((probeOp.detail ?? "").length > 0, "sanitized detail names the failure");
    assert.ok(!(probeOp.detail ?? "").includes("Probe body"), "details stay sanitized — no raw content");
    const childOp = outcomeFor(result, child.taskUuid);
    assert.ok(childOp === undefined || childOp.status !== "applied", "the child op never applies");

    // ── the healthy task still lands (FR-012 keeps the run alive for other work) ──
    const acme1Id = issueIdByKey(w, "ACME-1");
    assert.ok(
      pushedDescription(w, acme1Id).includes("Spec-side paragraph added since the last sync"),
      "healthy 2.2's update lands after the probe's abort",
    );
    assert.equal(eventsOfKind(attachmentPayloadAt(w, attachmentUrlFor(w, healthy.taskUuid)), "description-updated"), 1);
    const marker = await readLastRunMarker(w.state);
    assert.ok(marker !== null, "the run completed far enough to write last-run.json");

    // ── resume: a SECOND apply run replays ZERO creates (FR-012, never auto-replayed) ──
    const mark = callsMark(w);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result2 = await engine2.applySyncPlan(plan2, passingGates(w, plan2));
    assert.notEqual(result2.status, "refused", "the resume run executes (it is not a gate refusal)");
    assert.equal(callsOf(w, "createIssue", mark).length, 0, "ZERO replay create calls in-run AND on resume — probe and child alike");
    const probeIntents2 = await listIntentsByTask(w.state, probe.taskUuid);
    assert.equal(probeIntents2.length, 1, "no second intent file was written for the indeterminate task");
    assert.equal(probeIntents2[0]!.status, "indeterminate", "the terminal state survives the resume run");
    assert.deepEqual(await listIntentsByTask(w.state, child.taskUuid), []);
  } finally {
    await w.dispose();
  }
});

// ──────────────────────────── cell 3: indeterminate-create, one match ⇒ adopt

test("engine-apply-creates — indeterminate-create ONE-match reconcile ⇒ adopt: intent confirmed-created/reconciled, page-0 + issue-created history land on the adopted issue, child creation proceeds (data-model §8)", async () => {
  const w = await buildWorld("indeterminate-create");
  try {
    const expected = readExpectedJson<ExpectedPlanFile>(w, "plan.json");
    const [probe, child, healthy] = expected.entries as [ExpectedPlanEntry, ExpectedPlanEntry, ExpectedPlanEntry];
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Seed the ONE-match variant AFTER planning (the create "landed" but its response was lost).
    const probeUrl = attachmentUrlFor(w, probe.taskUuid);
    const carrier = seedReconcileCarrier(w, probeUrl, probe.taskUuid, 1);
    assert.equal(w.fake.world.byUrl.get(probeUrl)?.size, 1, "fixture self-check: exactly one carrier at the canonical URL");

    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    // One attempt for the PROBE (scripted failure), then the reconcile finds the carrier
    // and adopts it — the child's own create (asserted below, T034 cell 3) is a separate
    // legitimate attempt, so the exactly-one-attempt pin is scoped to the probe task
    // (data-model §8: EXACTLY ONE createIssue attempt for the failed task, never retried).
    const probeCreates = createRecords(w).filter((c) => createTitle(c).includes(probe.title));
    assert.equal(probeCreates.length, 1, "the probe create is attempted exactly once, never retried (data-model §8)");
    assert.equal(probeCreates[0]!.ok, false);
    assert.ok(
      callsOf(w, "findIssuesByAttachmentUrl").some((c) => c.args[0] === probeUrl),
      "reconciliation consults findIssuesByAttachmentUrl at the canonical URL",
    );

    const intents: CreateIntent[] = await listIntentsByTask(w.state, probe.taskUuid);
    assert.equal(intents.length, 1);
    assert.ok(
      intents[0]!.status === "confirmed-created" || intents[0]!.status === "reconciled",
      `adopted intents land confirmed-created/reconciled (data-model §8), got '${intents[0]!.status}'`,
    );

    const probeOp = outcomeFor(result, probe.taskUuid);
    assert.ok(probeOp !== undefined);
    assert.equal(probeOp.status, "applied", "adoption resolves the create op");
    assert.equal(probeOp.issueId, carrier.id, "the op outcome reports the adopted issue id");

    const payload = attachmentPayloadAt(w, probeUrl);
    assert.equal(payload.taskUuid, probe.taskUuid);
    assert.equal(eventsOfKind(payload, "issue-created"), 1, "adoption is journalled as an issue-created event (history-log.md)");

    const childCreates = createRecords(w).filter((c) => createTitle(c).includes(child.title));
    assert.equal(childCreates.length, 1, "adoption un-aborts the child — its create PROCEEDS");
    assert.equal(childCreates[0]!.ok, true);
    assert.equal((childCreates[0]!.args[0] as CreateIssueInput).parentId, carrier.id, "the child hangs off the adopted issue");

    assert.ok(
      pushedDescription(w, issueIdByKey(w, "ACME-1")).includes("Spec-side paragraph added since the last sync"),
      "healthy 2.2 still lands",
    );
    assert.equal(eventsOfKind(attachmentPayloadAt(w, attachmentUrlFor(w, healthy.taskUuid)), "description-updated"), 1);
  } finally {
    await w.dispose();
  }
});

// ────────────────────────── cell 4: indeterminate-create, multi-match variant

test("engine-apply-creates — indeterminate-create TWO carriers at one canonical URL ⇒ indeterminate + Principle II integrity diagnostic surfaced, task + child creation aborted, run survives (FR-012)", async () => {
  const w = await buildWorld("indeterminate-create");
  try {
    const expected = readExpectedJson<ExpectedPlanFile>(w, "plan.json");
    const [probe, child, healthy] = expected.entries as [ExpectedPlanEntry, ExpectedPlanEntry, ExpectedPlanEntry];
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    const probeUrl = attachmentUrlFor(w, probe.taskUuid);
    seedReconcileCarrier(w, probeUrl, probe.taskUuid, 1);
    seedReconcileCarrier(w, probeUrl, probe.taskUuid, 2);
    assert.equal(w.fake.world.byUrl.get(probeUrl)?.size, 2, "fixture self-check: two carriers share the canonical URL");

    const result = await engine.applySyncPlan(plan, passingGates(w, plan));

    assert.equal(createRecords(w).length, 1, "the failed create is attempted exactly once");
    const intents = await listIntentsByTask(w.state, probe.taskUuid);
    assert.equal(intents.length, 1);
    assert.equal(intents[0]!.status, "indeterminate", ">1 identity matches is terminal indeterminate, never silently adopted");
    assert.deepEqual(await listIntentsByTask(w.state, child.taskUuid), [], "the child aborts with the parent");
    assert.equal(
      createRecords(w).filter((c) => createTitle(c).includes(child.title)).length,
      0,
      "zero create calls ever carry the child",
    );

    const probeOp = outcomeFor(result, probe.taskUuid);
    assert.ok(probeOp !== undefined);
    assert.equal(probeOp.status, "failed");
    assert.match(
      probeOp.detail ?? "",
      /identity|integrity/i,
      "the Principle II integrity-failure diagnostic is surfaced (sanitized op detail — never silently swallowed)",
    );
    assert.ok(!(probeOp.detail ?? "").includes("Probe body"), "the diagnostic stays sanitized — no raw content");

    assert.ok(
      pushedDescription(w, issueIdByKey(w, "ACME-1")).includes("Spec-side paragraph added since the last sync"),
      "the integrity abort is contained to its task — healthy 2.2 still lands (FR-012)",
    );
    assert.equal(eventsOfKind(attachmentPayloadAt(w, attachmentUrlFor(w, healthy.taskUuid)), "description-updated"), 1);
  } finally {
    await w.dispose();
  }
});
