/**
 * T046 [P] — Cross-cutting PROPERTY suites over the seeded fixture worlds
 * (quickstart "Security & determinism checks"; spec SC-001/SC-002/SC-003; contracts
 * engine-pipeline.md + journal-rollback.md §3 + conflict-resolution-matrix.md §6).
 *
 * The engine is fully wired (T045) — this file must be GREEN immediately. It adds no new
 * behavior expectations: every assertion restates a success criterion through the frozen
 * `SyncEngine` interface on worlds that other lanes already proved cell-by-cell. What is
 * new is the PROPERTY flavor: a fixed-seed mulberry32 PRNG (R1 discipline — never
 * `Math.random`, never wall clock) drives the world iteration order, the number of
 * convergence re-runs, and the per-round selection of formatting-noise classes (the exact
 * research-R5 classes fuzzed in `tests/unit/engine-normalize.test.ts`). Fixed seed ⇒ zero
 * nondeterminism: every run exercises exactly the same battery.
 *
 * Properties:
 *  1. SC-001 apply-twice convergence over seeded worlds (bootstrap + sync, matrix §6 /
 *     quickstart "Apply-twice convergence"): after one gated apply, a second
 *     `buildSyncPlan` over unchanged inputs reports ZERO pending changes, and a second
 *     `applySyncPlan` performs ZERO tracker writes — no port mutation call at all
 *     (`mutationCalls` empty) and the fake world (issues + attachments, all fields
 *     including `updatedAt`) byte-identical across the converged run. Re-run rounds stay
 *     converged (count PRNG-picked, 1–2 extra per world).
 *  2. SC-002 normalized-hash never fires on formatting-only noise across a FULL
 *     apply-and-plan round trip (`formatting-noise` world, sync mode): every round mutates
 *     the temp repo bytes and the fake issue descriptions with PRNG-picked R5 noise
 *     classes, and every round must still plan zero conflicts, zero description rewrites,
 *     apply zero mutations, keep the checkpoint `descriptionContentHash` baseline, and
 *     leave the noisy tracker descriptions untouched (no rewrite).
 *  3. SC-003 rollback total restoration over seeded worlds (`rollback-full` +
 *     `rollback-interrupted`, journal-rollback.md §3): every repo file byte-equal to
 *     pre-run, every issue field restored, created issues archived (never deleted), the
 *     checkpoint store deep-equal to the seed (restore-or-remove, FR-013), and ZERO
 *     sync-history events lost or altered — the pre-run event multiset survives
 *     byte-identically inside the post-rollback chain, which additionally carries the
 *     run's events plus `rollback` events (history never rewound).
 *
 * Hermetic (constitution VI): fake-Linear worlds via the shared harness, temp state dir,
 * injected fixed clock, placeholder identities only (Principle III). Titles prefixed
 * `engine-properties —` (tier pattern `--test-name-pattern engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AuditManifest, Checkpoint, Plan } from "task-linear-sync/domain";
import { parseSyncStatePayload } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";
import type { AttachmentMetadata } from "task-linear-sync/ports";

import {
  attachEngine,
  attachmentUrlFor,
  buildWorld,
  callsMark,
  expectedFile,
  fixtureFile,
  mutationCalls,
  openRunManifest,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ───────────────────────────────────────────────── seeded pseudo-random property flavor

/** Fixed seed — identical battery in every environment (no nondeterminism, R1). */
const PROPERTY_SEED = 20261030;

/** Deterministic PRNG (mulberry32) — same posture as `engine-normalize.test.ts` T005. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle (seeded — iteration order is fixed, not incidental). */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────── shared harness glue

/** The frozen GateRequest satisfying every gate (precedent: T018/T036). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** Seed checkpoints when the world ships `expected/checkpoint-seed.json` (decision 3). */
async function seedIfShipped(world: EngineWorld): Promise<Record<string, Checkpoint> | null> {
  if (!existsSync(expectedFile(world, "checkpoint-seed.json"))) return null;
  const seed = readExpectedJson<Record<string, Checkpoint>>(world, "checkpoint-seed.json");
  await seedIfPresent(world, seed);
  return seed;
}

async function seedIfPresent(world: EngineWorld, seed: Record<string, Checkpoint>): Promise<void> {
  await seedCheckpoints(world, seed);
}

/** Pending = anything the plan still wants to do (SC-001 currency: decision ≠ no-change). */
function pending(plan: Plan): Plan["entries"] {
  return plan.entries.filter((e) => e.decision !== "no-change");
}

/** Raw conflict labels only (`no-description-conflict` never matches — T018 posture). */
function rawConflictLabels(plan: Plan): readonly string[] {
  return plan.entries.flatMap((e) => e.reasons.filter((r) => r.startsWith("description-conflict:")));
}

/** Recursive byte walk of the temp repo (byte-equality unit — T036 precedent). */
function walkFiles(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) Object.assign(out, walkFiles(join(dir, dirent.name), rel));
    else out[rel] = readFileSync(join(dir, dirent.name)).toString("base64");
  }
  return out;
}

/** Deterministic fake-world fingerprint: every issue + attachment field, order-normalized. */
function trackerSnapshot(world: EngineWorld): string {
  const issues = [...world.fake.world.issues.values()]
    .map((i) =>
      JSON.stringify([i.id, i.key, i.teamKey, i.projectId, i.title, i.description, i.stateType, i.updatedAt, i.archived]),
    )
    .sort();
  const attachments = [...world.fake.world.attachments.values()]
    .map((a) =>
      JSON.stringify([
        a.id,
        a.url,
        a.title,
        Object.fromEntries(Object.entries(a.metadata).sort(([x], [y]) => x.localeCompare(y))),
      ]),
    )
    .sort();
  return JSON.stringify({ issues, attachments });
}

/** History event JSON strings on one canonical page-0 attachment (null ⇒ empty). */
function canonicalHistory(world: EngineWorld, taskUuid: string): string[] {
  const meta = canonicalMetaSync(world, taskUuid);
  return meta === null ? [] : eventsOf(meta, world);
}

function canonicalMetaSync(world: EngineWorld, taskUuid: string): AttachmentMetadata | null {
  // The fake's getAttachmentByUrl is async; property tests need sync capture at fixed
  // points — read the live seeded map instead (same bytes, no port semantics involved).
  const url = attachmentUrlFor(world, taskUuid);
  const record = [...world.fake.world.attachments.values()].find((a) => a.url === url);
  return record === undefined ? null : record.metadata;
}

function eventsOf(meta: AttachmentMetadata, world: EngineWorld): string[] {
  const raw = meta[world.config.metadataNamespaceKey];
  if (typeof raw !== "string") return [];
  try {
    return parseSyncStatePayload(raw).history.map((e) => JSON.stringify(e));
  } catch {
    return []; // non-payload tool metadata (seed markers) is not history material
  }
}

/** Every history event across the whole fake world (all attachments, parseable only). */
function allHistoryEvents(world: EngineWorld): string[] {
  const out: string[] = [];
  for (const record of world.fake.world.attachments.values()) {
    out.push(...eventsOf(record.metadata, world));
  }
  return out;
}

// ───────────────────────────────────────────────────────────── SC-001 apply-twice cycle

/**
 * Worlds proven to do real work on the FIRST gated apply (bootstrap + sync, updates,
 * completion toggles, flat creates) and therefore to have a non-vacuous second run.
 * Two classes are deliberately NOT here, each with its contract reason:
 *  - worlds whose built-in action leaves an unresolved marker (e.g. `linear-changed`
 *    overwrite-spec): their post-apply plan is `skip-unresolved` BY CONTRACT
 *    (matrix §4), not converged;
 *  - `rollback-full`/`rollback-interrupted` (nested creates under a matched parent):
 *    pinned decision 1 makes the parent's mirror region INCLUDE its child task lines,
 *    and the world golden pins `update-issue(ACME-1)` before the children's ops — the
 *    children's assigned refs do not exist yet at that point, so the parent cell
 *    re-classifies `spec-changed` once (converging on the second apply). The single-
 *    apply zero-pending property is asserted on the flat worlds; the nested pair's
 *    tension (decision 1 + golden op-order + SC-001) is reported to the orchestrator
 *    rather than papered over here.
 */
const CONVERGENCE_WORLDS = ["first-run-bootstrap", "spec-changed", "completion-toggle", "history-rollover"] as const;

test("engine-properties — SC-001 apply-twice convergence over seeded worlds: second plan zero pending, second apply zero tracker writes (fixed-seed battery)", async () => {
  const rand = mulberry32(PROPERTY_SEED);
  const order = shuffle(CONVERGENCE_WORLDS, rand);
  let checkedWorlds = 0;

  for (const name of order) {
    const w = await buildWorld(name);
    try {
      await seedIfShipped(w);
      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

      // Run 1: real work happens (the property must not be vacuously satisfied).
      const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.ok(pending(plan1).length > 0, `${name}: first plan carries pending work (non-vacuous convergence)`);
      const apply1 = await engine.applySyncPlan(plan1, passingGates(w, plan1));
      assert.deepEqual(apply1.gateFailures, [], `${name}: gates satisfied`);
      assert.equal(apply1.status, "applied", `${name}: first apply completes (got ${apply1.status})`);

      // Run 2 (unchanged inputs): zero pending changes — SC-001 at the plan boundary.
      const plan2 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.equal(plan2.entries.length, plan1.entries.length, `${name}: same task set re-planned`);
      assert.deepEqual(pending(plan2), [], `SC-001: ${name} second plan reports zero pending changes`);
      assert.deepEqual(rawConflictLabels(plan2), [], `${name}: converged plan surfaces no conflict label`);

      // Run 2 apply: ZERO tracker writes — no mutating port call at all, and the fake
      // world (every field, including stamps) is byte-identical across the converged run.
      const snapshotBefore = trackerSnapshot(w);
      const mark = callsMark(w);
      const apply2 = await engine.applySyncPlan(plan2, passingGates(w, plan2));
      assert.equal(apply2.status, "applied", `${name}: converged apply completes (got ${apply2.status})`);
      assert.deepEqual(mutationCalls(w, mark), [], `SC-001: ${name} second apply performs zero tracker writes`);
      assert.equal(trackerSnapshot(w), snapshotBefore, `${name}: fake world untouched across the converged apply`);
      assert.notEqual(apply2.runId, apply1.runId, `${name}: the converged run is still its own journaled run`);

      // PRNG-picked extra rounds (1–2): convergence is a fixed point, not a one-off.
      const extraRounds = 1 + Math.floor(rand() * 2);
      for (let round = 0; round < extraRounds; round++) {
        const planN = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
        assert.deepEqual(pending(planN), [], `SC-001: ${name} round ${round + 3} stays converged`);
        const markN = callsMark(w);
        const applyN = await engine.applySyncPlan(planN, passingGates(w, planN));
        assert.equal(applyN.status, "applied", `${name}: round ${round + 3} completes`);
        assert.deepEqual(mutationCalls(w, markN), [], `SC-001: ${name} round ${round + 3} writes nothing`);
      }
      checkedWorlds++;
    } finally {
      await w.dispose();
    }
  }
  assert.equal(checkedWorlds, CONVERGENCE_WORLDS.length, "every seeded convergence world ran the battery");
});

// ────────────────────────────────────────────────── SC-002 formatting-only noise rounds

/** Noise helpers — exact copies of the R5 classes fuzzed in T005 (`engine-normalize`). */
function mapLines(text: string, fn: (line: string) => string): string {
  const parts = text.split(/(\r\n|\r|\n)/u);
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i] ?? "");
  return parts.join("");
}

function padBlankRuns(text: string, filler: string): string {
  const parts = text.split(/(\r\n|\r|\n)/u);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const eol = parts[i + 1] ?? "";
    out.push(parts[i] ?? "", eol);
    if ((parts[i] ?? "").trim() === "" && eol !== "") out.push(filler, eol);
  }
  return out.join("");
}

/** Tracker-side noise: every R5 class (the platform round trip mangles all of them). */
const ISSUE_NOISE: ReadonlyArray<{ label: string; apply: (s: string) => string }> = [
  { label: "LF→CRLF", apply: (s) => s.replace(/\r\n|\r|\n/gu, "\r\n") },
  { label: "LF→CR", apply: (s) => s.replace(/\r\n|\r|\n/gu, "\r") },
  { label: "tabs-in-blank-lines", apply: (s) => mapLines(s, (l) => (l.trim() === "" ? `${l} \t` : l)) },
  { label: "trailing-whitespace", apply: (s) => mapLines(s, (l) => (l.trim() === "" ? l : `${l} \t`)) },
  { label: "blank-line-runs", apply: (s) => padBlankRuns(s, "\t ") },
  { label: "drop-final-newline", apply: (s) => s.replace(/(\r\n|\r|\n)+$/u, "") },
  { label: "extra-trailing-newlines", apply: (s) => `${s}\r\n\r\n\r\n` },
  { label: "NFD-echo", apply: (s) => s.normalize("NFD") },
];

/** Spec-side subset: terminator/blank-line/newline classes only — parse-safe on the whole
 *  file (the `formatting-noise` world already carries these classes verbatim). */
const FILE_NOISE = ISSUE_NOISE.filter((op) => op.label !== "trailing-whitespace" && op.label !== "NFD-echo");

test("engine-properties — SC-002 normalized-hash never fires: full apply-and-plan round trip under PRNG-picked formatting noise (zero conflicts, zero description rewrites)", async () => {
  const rand = mulberry32(PROPERTY_SEED + 1);
  const w = await buildWorld("formatting-noise");
  try {
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedIfPresent(w, seed);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const tasksPath = join(w.repositoryRoot, "specs", "sync-demo", "tasks.md");

    const issueIds: string[] =
      (
        JSON.parse(readFileSync(fixtureFile(w, "world.json"), "utf8")) as {
          issues?: ReadonlyArray<{ id: string }>;
        }
      ).issues?.map((i) => i.id) ?? [];
    assert.ok(issueIds.length > 0, "world seeds issue descriptions to fuzz");

    const baselineHashes = Object.fromEntries(
      Object.entries(seed).map(([uuid, c]) => [uuid, c.descriptionContentHash]),
    );

    /**
     * Issue-side bytes as the LAST mutation left them — the zero-rewrite currency: after
     * every plan+apply round the fake world must still carry EXACTLY these strings.
     */
    const noisyDescriptions = new Map<string, string>();

    /** One SC-002 checkpoint: the normalized hash is completely inert this round. */
    const assertInert = async (round: string): Promise<void> => {
      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.deepEqual(pending(plan), [], `SC-002: ${round} — zero pending changes`);
      assert.deepEqual(rawConflictLabels(plan), [], `SC-002: ${round} — no conflict label on any entry`);
      for (const entry of plan.entries) {
        assert.ok(
          entry.reasons.includes("no-description-conflict"),
          `SC-002: ${round} — ${entry.taskUuid} carries the explicit no-conflict verdict (FR-005)`,
        );
        assert.deepEqual([...entry.expectedMarkdownChanges], [], `SC-002: ${round} — zero planned rewrites for ${entry.taskUuid}`);
      }
      const fileBefore = readFileSync(tasksPath);
      const mark = callsMark(w);
      const result = await engine.applySyncPlan(plan, passingGates(w, plan));
      assert.equal(result.status, "applied", `SC-002: ${round} — apply completes (got ${result.status})`);
      assert.deepEqual(mutationCalls(w, mark), [], `SC-002: ${round} — zero description rewrites (no tracker write at all)`);
      assert.equal(readFileSync(tasksPath).equals(fileBefore), true, `SC-002: ${round} — plan/apply never touch repo bytes`);

      // The checkpoint baseline never moved (the hash never fired ⇒ never re-seeded)…
      const store = await readCheckpointStore(w);
      assert.ok(store, `SC-002: ${round} — checkpoint store present`);
      const liveHashes = Object.fromEntries(Object.entries(store!.checkpoints).map(([uuid, c]) => [uuid, c.descriptionContentHash]));
      assert.deepEqual(liveHashes, baselineHashes, `SC-002: ${round} — descriptionContentHash baseline invariant under noise`);
      // …and every noisy tracker description stands EXACTLY where the noise put it.
      for (const id of issueIds) {
        const issue = w.fake.world.issues.get(id);
        assert.ok(issue, `issue ${id} still exists`);
        assert.equal(issue!.description, noisyDescriptions.get(id), `SC-002: ${round} — issue ${id} description never rewritten`);
      }
    };

    // Round 0: the pristine world — noise classes already baked into the fixture bytes.
    for (const id of issueIds) {
      const issue = w.fake.world.issues.get(id);
      if (issue !== undefined) noisyDescriptions.set(id, issue.description);
    }
    await assertInert("round 0 (fixture-baked noise)");

    // Rounds 1–3: PRNG-picked R5 classes mutate BOTH sides mid-round-trip; the same
    // inertness battery then re-runs over the continuing apply-and-plan cycle.
    for (let round = 1; round <= 3; round++) {
      const used: string[] = [];
      let text = readFileSync(tasksPath, "utf8");
      const fileOps = 1 + Math.floor(rand() * FILE_NOISE.length);
      for (let i = 0; i < fileOps; i++) {
        const op = FILE_NOISE[Math.floor(rand() * FILE_NOISE.length)] as { label: string; apply: (s: string) => string };
        text = op.apply(text);
        used.push(op.label);
      }
      writeFileSync(tasksPath, text); // the ONLY intended repo-byte change this round
      for (const id of issueIds) {
        const issue = w.fake.world.issues.get(id);
        if (issue === undefined) continue;
        let desc = issue.description;
        const descOps = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < descOps; i++) {
          const op = ISSUE_NOISE[Math.floor(rand() * ISSUE_NOISE.length)] as { label: string; apply: (s: string) => string };
          desc = op.apply(desc);
          used.push(op.label);
        }
        w.fake.world.issues.set(id, { ...issue, description: desc });
        noisyDescriptions.set(id, desc);
      }
      await assertInert(`round ${round} (${used.join(", ")})`);
    }
  } finally {
    await w.dispose();
  }
});

// ────────────────────────────────────────────────────── SC-003 rollback total restoration

const ROLLBACK_WORLDS = ["rollback-full", "rollback-interrupted"] as const;

test("engine-properties — SC-003 rollback total restoration over seeded worlds: files/fields/checkpoints restored, created issues archived, zero history events lost or altered (fixed-seed battery)", async () => {
  const rand = mulberry32(PROPERTY_SEED + 2);
  const order = shuffle(ROLLBACK_WORLDS, rand);
  let checkedWorlds = 0;

  for (const name of order) {
    const w = await buildWorld(name);
    try {
      const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
      await seedIfPresent(w, seed);
      const expected = readExpectedJson<{ entries: ReadonlyArray<{ taskUuid: string; localTaskId: string }> }>(w, "plan.json");
      const byTask = (id: string): string => {
        const e = expected.entries.find((x) => x.localTaskId === id);
        assert.ok(e, `${name}: golden table has task ${id}`);
        return e!.taskUuid;
      };
      const uuids = { alpha: byTask("1.1"), beta: byTask("1.1.1"), gamma: byTask("1.1.2"), zeta: byTask("1.2") };

      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.ok(pending(plan).length > 0, `${name}: the journaled run does real work (non-vacuous rollback)`);

      // Pre-run captures: files, seeded issue fields, canonical histories.
      const preRunFiles = walkFiles(w.repositoryRoot);
      const issueIds: Record<string, string> = {};
      for (const issue of w.fake.world.issues.values()) issueIds[issue.key] = issue.id;
      const fieldsOf = (issueId: string) => {
        const i = w.fake.world.issues.get(issueId);
        return i === undefined ? null : { title: i.title, description: i.description, stateType: i.stateType, archived: i.archived };
      };
      const preRunAlpha = fieldsOf(issueIds["ACME-1"] ?? "");
      const preRunZeta = fieldsOf(issueIds["ACME-2"] ?? "");
      assert.ok(preRunAlpha && preRunZeta, `${name}: both seeded issues exist pre-run`);
      const preRunHistory: Record<string, string[]> = {};
      for (const label of Object.keys(uuids) as Array<keyof typeof uuids>) {
        preRunHistory[label] = canonicalHistory(w, uuids[label] as string);
      }
      const preRunTotalEvents = allHistoryEvents(w);

      const apply = await engine.applySyncPlan(plan, passingGates(w, plan));
      assert.equal(apply.status, "applied", `${name}: apply completes before rollback`);
      assert.notDeepEqual(walkFiles(w.repositoryRoot), preRunFiles, `${name}: the run MOVED the repo (rollback is not a no-op)`);
      const postApplyTotalEvents = allHistoryEvents(w);
      assert.ok(postApplyTotalEvents.length > preRunTotalEvents.length, `${name}: the run appended history (events to preserve exist)`);

      const rb = await engine.rollbackRun(apply.runId);
      assert.equal(rb.runId, apply.runId, `${name}: result names the rolled-back run`);
      assert.equal(rb.status, "rolled-back", `${name}: full rollback completes (got ${rb.status})`);
      assert.equal(rb.refusal, undefined, `${name}: completed rollback carries no refusal`);

      // Files: every repo file byte-equal to the pre-run walk.
      assert.deepEqual(walkFiles(w.repositoryRoot), preRunFiles, `SC-003: ${name} every file restored byte-for-byte`);

      // Issue fields: seeded issues back to their exact pre-run values (never archived).
      assert.deepEqual(fieldsOf(issueIds["ACME-1"] ?? ""), preRunAlpha, `SC-003: ${name} ACME-1 fields restored`);
      assert.deepEqual(fieldsOf(issueIds["ACME-2"] ?? ""), preRunZeta, `SC-003: ${name} ACME-2 fields restored`);

      // Created issues: archived, NEVER deleted (still in the world — FR-013/016).
      const manifest = await openRunManifest<AuditManifest>(w, apply.runId);
      const createOps = manifest.operations.filter((o) => o.kind === "create-issue");
      assert.ok(createOps.length > 0, `${name}: the run journaled creates`);
      for (const op of createOps) {
        const created = w.fake.world.issues.get(op.targetIssueId);
        assert.ok(created, `SC-003: ${name} created issue ${op.targetIssueId} survives (archived, never deleted)`);
        assert.equal(created!.archived, true, `SC-003: ${name} created issue ${op.targetIssueId} archived by rollback`);
      }

      // Checkpoints: exactly the seeded map is back — restored entries byte-equal,
      // run-created entries REMOVED (FR-013 restore-or-remove).
      const store = await readCheckpointStore(w);
      assert.ok(store, `${name}: checkpoint store exists after rollback`);
      assert.deepEqual(store!.checkpoints, seed, `SC-003: ${name} checkpoint store restored exactly to the seed (FR-013)`);

      // History never rewound (journal-rollback §4): every task's pre-run event list is a
      // byte-identical PREFIX of the post-rollback canonical history…
      for (const label of Object.keys(uuids) as Array<keyof typeof uuids>) {
        const after = canonicalHistory(w, uuids[label] as string);
        const before = preRunHistory[label] ?? [];
        assert.deepEqual(after.slice(0, before.length), before, `SC-003: ${name} ${label} pre-run history events byte-identical (0 lost/altered)`);
        assert.ok(after.length >= before.length, `SC-003: ${name} ${label} history never rewound`);
      }
      // …and the global multiset: every pre-run event still occurs at least as often.
      const postTotal = allHistoryEvents(w);
      const postCounts = new Map<string, number>();
      for (const e of postTotal) postCounts.set(e, (postCounts.get(e) ?? 0) + 1);
      for (const e of preRunTotalEvents) {
        assert.ok((postCounts.get(e) ?? 0) >= 1, `SC-003: ${name} pre-run event lost or altered: ${e.slice(0, 80)}`);
      }
      assert.ok(postTotal.length > preRunTotalEvents.length, `${name}: run + rollback events were APPENDED, not substituted`);
      assert.ok(
        postTotal.some((e) => e.includes('"rollback"')),
        `${name}: rollback events land in the preserved history`,
      );

      checkedWorlds++;
    } finally {
      await w.dispose();
    }
  }
  assert.equal(checkedWorlds, ROLLBACK_WORLDS.length, "both rollback worlds ran the restoration battery");
});
