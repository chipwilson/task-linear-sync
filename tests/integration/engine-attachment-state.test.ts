/**
 * T035 [P] [US2] — Attachment-state + history-rollover integration test over the
 * `history-rollover` world (FR-008/009/010/015; quickstart 2.5/2.6;
 * contracts/history-log.md §1–§3; data-model §7).
 *
 * RED/GREEN split (stub discipline — the apply seam awaits T042/T043/T045):
 *  - test 1 is GREEN today: the wired read-only pipeline plans the world and the
 *    seeded attachment chain is untouched by build (constitution I).
 *  - tests 2–3 are RED at the apply seam (`applySyncPlan` unwired until T045):
 *    they need `apply` (T043) driving the payload rewrite + page append/rollover
 *    (T042). No test edits are needed when those lanes merge.
 *
 * Asserts through `attachEngine(w, createSyncEngine, { keyProvider })` +
 * `getAttachmentByUrl` reads on `world.fake` (the raw fake — chain inspection
 * never pollutes `world.calls`):
 *  1. build side: sync-mode plan per `expected/plan.json` (1.1 spec-changed ⇒
 *     overwrite-linear conflict; 1.2 checkbox-changed update), `historyLogMaxEntries`
 *     pinned to 3, seeded chain (1.1: page 0 @ 3; 1.2: page 0 @ 3 + page 1 @ 3),
 *     zero mutations during build;
 *  2. gated apply — page-0 canonical rewritten AUTHORITATIVELY after screening:
 *     `taskUuid`, `frameworkMetadata`, `descriptionContentHash` (normalized
 *     mirrored content hash post-action — cross-checked against the post-apply
 *     checkpoint), `cursors.lastSyncAt` (injected clock ISO); a seeded extraneous
 *     non-history member (world-variant mutation of the fake before build) is
 *     REPLACED away (full replace, not merge); stable key ordering proven by
 *     byte-identical canonical re-serialization with the frozen serializer.
 *     Rollover (maxEntries 3, page 0 full): 1.1's landing `description-updated`
 *     stays OFF page 0 (unchanged 3-entry prefix) and lands on page 1 at the
 *     continuation URL; 1.2 (page 0 @ 3 + seeded page 1 @ 3) walks 0→1 and creates
 *     page 2 holding ONLY the new `checkbox-changed` event; the page walk via
 *     `getAttachmentByUrl` 0..n ends at the first absent page; EVERY prior entry
 *     byte-identical on its original page (append-only, never backwards, Principle IV);
 *  3. URL idempotency / SC-001 / FR-015: re-run build + apply ⇒ converged plan
 *     (zero pending) ⇒ zero attachment writes and byte-identical pages (fixed
 *     clock); exactly ONE attachment per page URL tracker-side; no locally stored
 *     attachment ids or page-index artifacts observable in the state directory
 *     (plans/reports/checkpoints/last-run scanned; manifests/journals are the
 *     sealed, contract-sanctioned URL recorders per FR-015 and are skipped for the
 *     continuation-URL check — attachment-ID scanning still covers every file).
 *
 * Hermetic (constitution VI): 007 fake via the shared harness, temp state dir,
 * fixed injected clock, placeholders only (Principle III).
 * Titles prefixed `engine-attachment-state —`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

import type { Checkpoint, Plan, PlanTaskEntry, SyncStatePayload } from "task-linear-sync/domain";
import { parseSyncStatePayload, serializeSyncStatePayload } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";

import {
  attachEngine,
  buildWorld,
  callsMark,
  callsOf,
  fixtureFile,
  attachmentUrlFor,
  hasCheckpoints,
  historyPageUrlFor,
  mutationCalls,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────── world expectation tables

/** One `expected/plan.json` entry (history-rollover golden authored by the worlds lane). */
interface ExpectedEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
  readonly title: string;
  readonly matchedIssueKey: string | null;
  readonly decision: string;
  readonly descriptionConflict: string | null;
  readonly defaultMapAction?: string;
  readonly historyEvent?: string;
  readonly desiredStateName?: string;
  readonly note?: string;
}

interface ExpectedPlan {
  readonly world: string;
  readonly mode?: "bootstrap" | "sync";
  readonly entries: readonly ExpectedEntry[];
}

/** The world seed — only the issue key→id map is needed for the pairing checks. */
interface WorldSeed {
  readonly issues?: ReadonlyArray<{ readonly id: string; readonly key: string }>;
}

function issueIdForKey(world: EngineWorld, key: string): string {
  const seed = JSON.parse(readFileSync(fixtureFile(world, "world.json"), "utf8")) as WorldSeed;
  const issue = (seed.issues ?? []).find((i) => i.key === key);
  assert.ok(issue, `world seed for issue key ${key} (expected/plan.json ↔ world.json pairing)`);
  return issue!.id;
}

function entryFor(plan: Plan, taskUuid: string, localTaskId: string): PlanTaskEntry {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for task ${localTaskId} (${taskUuid}) — plan.json golden`);
  return entry!;
}

/** The frozen GateRequest satisfying every gate (harness/US1-test precedent). */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

// ────────────────────────────────────────────────────────────── attachment reads
// Chain state is read ONLY via getAttachmentByUrl on the RAW fake (w.fake): pages
// are addressed purely by URL (history-log §3) and the reads never enter w.calls.

interface PageSnapshot {
  readonly page: number;
  readonly url: string;
  /** Raw `metadataNamespaceKey` value — the canonical-serialized page string. */
  readonly raw: string;
  /** Parsed page record (page 0: SyncStatePayload shape; n ≥ 1: { history, page, taskUuid }). */
  readonly rec: Record<string, unknown>;
}

/** Byte proxy for an event array: both sides originate from the frozen canonical
 *  serializer, so parse→JSON.stringify preserves serialized key order — equality of
 *  these strings means byte-identical entries (no edits, no reorder). */
function historyBytes(rec: Record<string, unknown>): string {
  return JSON.stringify(rec["history"]);
}

async function readPage(world: EngineWorld, taskUuid: string, page: number): Promise<PageSnapshot | null> {
  const url = page === 0 ? attachmentUrlFor(world, taskUuid) : historyPageUrlFor(world, taskUuid, page);
  const view = await world.fake.getAttachmentByUrl(url);
  if (view === null) return null;
  const value = view.metadata[world.config.metadataNamespaceKey];
  assert.equal(typeof value, "string", `page record at ${url} is the canonical-serialized string`);
  const raw = value as string;
  return { page, url, raw, rec: JSON.parse(raw) as Record<string, unknown> };
}

/** Walk pages 0..n via getAttachmentByUrl until the first absent page (history-log §3.1). */
async function walkChain(world: EngineWorld, taskUuid: string): Promise<readonly PageSnapshot[]> {
  const pages: PageSnapshot[] = [];
  for (let page = 0; ; page += 1) {
    const snap = await readPage(world, taskUuid, page);
    if (snap === null) break;
    pages.push(snap);
    assert.ok(pages.length <= 10, "page walk must terminate at the first absent page (no gaps)");
  }
  return pages;
}

/** Snapshot every page URL of BOTH chains (URL → canonical string) for byte-identity. */
async function captureChain(
  world: EngineWorld,
  taskUuids: readonly string[],
): Promise<Map<string, string>> {
  const chain = new Map<string, string>();
  for (const uuid of taskUuids) {
    for (const page of await walkChain(world, uuid)) chain.set(page.url, page.raw);
  }
  return chain;
}

/**
 * World-variant seeding (test 2): inject an EXTRA non-history member into the
 * page-0 payload of `url` directly on the in-memory fake world, before the build —
 * the authoritative rewrite (FR-008) must REPLACE the payload and drop it
 * (replace-not-merge evidence). Returns the parsed PRIOR payload.
 */
function seedExtraneousNonHistoryMember(world: EngineWorld, url: string): Record<string, unknown> {
  const carrier = [...world.fake.world.attachments.values()].find((a) => a.url === url);
  assert.ok(carrier, `seeded canonical attachment at ${url}`);
  const ns = world.config.metadataNamespaceKey;
  const priorRaw = carrier.metadata[ns];
  assert.equal(typeof priorRaw, "string");
  const prior = JSON.parse(priorRaw as string) as Record<string, unknown>;
  assert.equal(prior["seededExtraneousMember"], undefined, "prior payload is clean before variant seeding");
  carrier.metadata[ns] = JSON.stringify({
    ...prior,
    seededExtraneousMember: "seeded pre-apply non-history member — authoritative replace must drop it",
  });
  return prior;
}

/** All files under `dir` (state-dir hygiene scan). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────── tests

test("engine-attachment-state — history-rollover build: sync-mode plan per golden, seeded chain at threshold, zero mutations (green at the build seam)", async () => {
  const w = await buildWorld("history-rollover");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    assert.equal(await hasCheckpoints(w), true, "seeded checkpoints ⇒ sync mode (data-model §2)");
    assert.equal(w.config.historyLogMaxEntries, 3, "world pins the rollover threshold to 3 (FR-010)");

    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assert.equal(expected.world, w.name);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, expected.entries.length, "two matched tasks planned");
    for (const exp of expected.entries) {
      const entry = entryFor(plan, exp.taskUuid, exp.localTaskId);
      assert.equal(entry.decision, exp.decision, `decision for ${exp.localTaskId} (${exp.note ?? ""})`);
      assert.equal(entry.match?.issueId, issueIdForKey(w, exp.matchedIssueKey!), `task ${exp.localTaskId} matched`);
      assert.ok(
        !entry.reasons.includes("bootstrap-no-checkpoint"),
        `sync run must not label ${exp.localTaskId} bootstrap-no-checkpoint`,
      );
      if (exp.descriptionConflict !== null) {
        assert.ok(
          entry.reasons.some((r) => r.includes(`description-conflict:${exp.descriptionConflict}`)),
          `conflict label ${exp.descriptionConflict} for ${exp.localTaskId}`,
        );
        if (exp.defaultMapAction !== undefined) {
          assert.ok(
            entry.reasons.some((r) => r.includes(exp.defaultMapAction!)),
            `sync-map action "${exp.defaultMapAction}" for ${exp.localTaskId} (matrix §3)`,
          );
        }
      } else {
        assert.ok(
          entry.reasons.some((r) => r.startsWith("description-conflict:")) === false,
          `${exp.localTaskId} carries no conflict label (${exp.note ?? ""})`,
        );
      }
    }

    // Seeded chain exactly as the fixture README pins it: 1.1 page 0 @ 3 (no
    // continuation); 1.2 pages 0 AND 1 @ 3 each. Reads are fake-side (no call log).
    const [uuidA, uuidB] = expected.entries.map((e) => e.taskUuid);
    const pagesA = await walkChain(w, uuidA);
    assert.equal(pagesA.length, 1, "1.1 chain seeded page-0 only");
    assert.equal((pagesA[0]!.rec["history"] as unknown[]).length, 3, "1.1 page 0 AT threshold (3 = maxEntries)");
    const pagesB = await walkChain(w, uuidB);
    assert.equal(pagesB.length, 2, "1.2 chain seeded pages 0 and 1");
    for (const page of pagesB) {
      assert.equal((page.rec["history"] as unknown[]).length, 3, `1.2 page ${page.page} at threshold`);
    }

    // Build purity (constitution I): planning never touches the chain.
    assert.deepEqual(mutationCalls(w), [], "buildSyncPlan performs zero mutations");
  } finally {
    await w.dispose();
  }
});

test("engine-attachment-state — gated apply: authoritative page-0 rewrite (full replace, stable keys, clock cursor) + deterministic rollover with byte-identical priors (FR-008/009/010)", async () => {
  const w = await buildWorld("history-rollover");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    const [expA, expB] = expected.entries;
    const uuidA = expA.taskUuid;
    const uuidB = expB.taskUuid;

    // Prior chain state (world-variant: an extraneous non-history member seeded
    // onto 1.1's page 0 — full replacement must drop it).
    const priorA0 = seedExtraneousNonHistoryMember(w, attachmentUrlFor(w, uuidA));
    const pagesBeforeA = await walkChain(w, uuidA);
    const pagesBeforeB = await walkChain(w, uuidB);
    assert.equal(pagesBeforeA.length, 1);
    assert.equal(pagesBeforeB.length, 2);
    const priorB0 = pagesBeforeB[0]!.rec;
    const priorB1Raw = pagesBeforeB[1]!.raw;
    const seededEventJsons = [...pagesBeforeA, ...pagesBeforeB].flatMap(
      (p) => (p.rec["history"] as unknown[]).map((e) => JSON.stringify(e)),
    );

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const syncIso = w.clock.iso(); // fixed injected clock — every `at`/cursor stamp

    // RED at the apply seam until T043/T045 wire `applySyncPlan`.
    const result = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.deepEqual(result.gateFailures, [], "gates satisfied ⇒ no refusals");
    assert.equal(result.status, "applied", `apply must complete (got ${result.status})`);
    assert.equal(
      result.operations.some((o) => o.status === "failed"),
      false,
      "no failed op outcomes",
    );

    const store = await readCheckpointStore(w);
    assert.ok(store, "checkpoint store exists after apply (data-model §1)");

    // ── Assertion set (1): page-0 canonical rewritten authoritatively (FR-008).
    const pagesA = await walkChain(w, uuidA);
    assert.equal(pagesA.length, 2, "1.1: rollover appended page 1 (walk stops at absent page 2)");
    const page0Raw = pagesA[0]!.raw;
    const page0 = parseSyncStatePayload(page0Raw);
    assert.equal(page0.taskUuid, uuidA, "page-0 taskUuid authoritative");
    assert.deepEqual(
      page0.frameworkMetadata,
      priorA0["frameworkMetadata"] as SyncStatePayload["frameworkMetadata"],
      "frameworkMetadata rewritten verbatim from the task",
    );
    const hashA = store!.checkpoints[uuidA]!.descriptionContentHash;
    assert.equal(
      page0.descriptionContentHash,
      hashA,
      "payload hash == normalized mirrored content hash of the post-action checkpoint (R3/§1)",
    );
    assert.notEqual(
      page0.descriptionContentHash,
      priorA0["descriptionContentHash"],
      "1.1 overwrite-linear changed the mirrored content — the hash moved",
    );
    assert.equal(page0.cursors.lastSyncAt, syncIso, "cursors.lastSyncAt is the injected-clock ISO");
    // Full replace, not merge: the extraneous prior member is gone (authoritative rewrite).
    assert.equal(
      Object.prototype.hasOwnProperty.call(JSON.parse(page0Raw), "seededExtraneousMember"),
      false,
      "seeded extraneous non-history member REPLACED away (full replacement, history-log §1)",
    );
    // Stable key ordering: byte-identical re-serialization through the frozen canonical serializer.
    assert.equal(
      serializeSyncStatePayload(parseSyncStatePayload(page0Raw)),
      page0Raw,
      "page 0 is stored in canonical (sorted-key) serialization",
    );

    // ── Assertion set (2): rollover (FR-010) — page 0 keeps its 3-entry prefix,
    // the landing event alone rolls to the continuation page.
    assert.equal(page0.history.length, 3, "no new event stayed on page 0 (candidate overflowed the threshold)");
    assert.equal(
      historyBytes(page0 as unknown as Record<string, unknown>),
      historyBytes(priorA0),
      "page-0 entries byte-identical — the 3 seeded events, unedited and in order (append-only)",
    );
    const contA = pagesA[1]!;
    assert.equal(contA.url, historyPageUrlFor(w, uuidA, 1), "page 1 addressed by the deterministic continuation URL");
    assert.deepEqual(Object.keys(contA.rec), ["history", "page", "taskUuid"], "page record canonicalSorted shape");
    assert.equal(contA.rec["page"], 1, "page segment matches the record page");
    assert.equal(contA.rec["taskUuid"], uuidA, "continuation record keys the chain by taskUuid");
    const rolled = contA.rec["history"] as Array<Record<string, unknown>>;
    assert.equal(rolled.length, 1, "ONLY the overflowing tail event rolls (data-model §7)");
    assert.equal(rolled[0]!["kind"], "description-updated", "1.1 overwrite-linear lands description-updated (FR-009)");
    assert.equal(rolled[0]!["at"], syncIso, "event `at` from the injected clock");
    assert.equal(typeof rolled[0]!["description"], "string", "screened human-readable description present");
    assert.ok(
      ((rolled[0]!["references"] ?? []) as string[]).some((r) => r.includes(hashA)),
      `description-updated references the content hash (${hashA}) — history-log §2`,
    );

    // ── 1.2: walk 0→1 finds page 1 last; the candidate overflows ⇒ NEW page 2,
    // pages 0–1 untouched byte-for-byte.
    const pagesB = await walkChain(w, uuidB);
    assert.equal(pagesB.length, 3, "1.2: page 2 created, walk stops at absent page 3");
    assert.equal(historyBytes(pagesB[0]!.rec), historyBytes(priorB0), "1.2 page-0 entries byte-identical");
    assert.equal(pagesB[1]!.raw, priorB1Raw, "1.2 page 1 byte-identical (URL-idempotent, append-only)");
    const page0B = parseSyncStatePayload(pagesB[0]!.raw);
    assert.equal(page0B.cursors.lastSyncAt, syncIso, "1.2 cursor rewritten from the injected clock");
    assert.equal(
      page0B.descriptionContentHash,
      priorB0["descriptionContentHash"],
      "1.2 description unchanged on both sides — mirrored hash unchanged",
    );
    assert.equal(
      serializeSyncStatePayload(parseSyncStatePayload(pagesB[0]!.raw)),
      pagesB[0]!.raw,
      "1.2 page 0 stored canonically (stable keys)",
    );
    const page2 = pagesB[2]!;
    assert.equal(page2.url, historyPageUrlFor(w, uuidB, 2), "page 2 at the continuation URL");
    assert.deepEqual(Object.keys(page2.rec), ["history", "page", "taskUuid"], "page-2 record canonicalSorted shape");
    assert.equal(page2.rec["page"], 2, "page number matches the URL segment");
    const landedB = page2.rec["history"] as Array<Record<string, unknown>>;
    assert.equal(landedB.length, 1, "only the new event lands on page 2");
    assert.equal(landedB[0]!["kind"], "checkbox-changed", "1.2 checkbox flip lands checkbox-changed (FR-006/009)");
    assert.equal(landedB[0]!["at"], syncIso, "event `at` from the injected clock");
    assert.ok(
      ((landedB[0]!["references"] ?? []) as string[]).some((r) => r.includes(expB.desiredStateName!)),
      `checkbox-changed references the state name (${expB.desiredStateName}) — history-log §2`,
    );

    // Every prior entry stayed on its ORIGINAL page: the rolled/landed events are
    // NEW objects — none equals any seeded entry (nothing moved backwards, Principle IV).
    const newEvents = [JSON.stringify(rolled[0]), JSON.stringify(landedB[0])];
    for (const fresh of newEvents) {
      assert.equal(
        seededEventJsons.includes(fresh),
        false,
        "a seeded entry never moved onto a rolled/created page (append-only)",
      );
    }

    // Tracker-side URL idempotency after a single apply (FR-015).
    for (const snap of [...pagesA, ...pagesB]) {
      const carriers = [...w.fake.world.attachments.values()].filter((a) => a.url === snap.url);
      assert.equal(carriers.length, 1, `exactly one attachment at ${snap.url}`);
    }
  } finally {
    await w.dispose();
  }
});

test("engine-attachment-state — converged re-run + resumed apply: zero pending ⇒ zero attachment writes, byte-identical pages, one attachment per URL, no ids/page index locally (SC-001/FR-015)", async () => {
  const w = await buildWorld("history-rollover");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    const uuids = expected.entries.map((e) => e.taskUuid);

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // Run 1: plan + gated apply; snapshot the whole chain by URL.
    const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result1 = await engine.applySyncPlan(plan1, passingGates(w, plan1));
    assert.equal(result1.status, "applied", `first apply must complete (got ${result1.status})`);
    const chainAfterRun1 = await captureChain(w, uuids);
    assert.equal(chainAfterRun1.size, 5, "chain after run 1: 1.1 pages 0–1 + 1.2 pages 0–2");

    // Run 2 (re-run): the plan CONVERGES — zero pending changes ⇒ the apply has
    // nothing to write (SC-001). Red here (and in run 1 above) until T043/T045.
    const plan2 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(
      plan2.entries.filter((e) => e.decision !== "no-change"),
      [],
      "SC-001: second plan over unchanged inputs reports zero pending changes",
    );
    const mark = callsMark(w);
    const result2 = await engine.applySyncPlan(plan2, passingGates(w, plan2));
    assert.equal(result2.status, "applied", `converged apply completes (got ${result2.status})`);
    assert.equal(callsOf(w, "upsertAttachmentByUrl", mark).length, 0, "zero attachment writes on a converged run");
    assert.deepEqual(mutationCalls(w, mark), [], "zero tracker mutations on a converged run");

    // Resumed/repeated applies land byte-identical pages (fixed clock, FR-015).
    const chainAfterRun2 = await captureChain(w, uuids);
    assert.equal(chainAfterRun2.size, 5, "no new pages appeared on the converged run");
    for (const [url, raw] of chainAfterRun1) {
      assert.equal(chainAfterRun2.get(url), raw, `page at ${url} byte-identical after re-run`);
    }

    // No tracker-side duplication: exactly ONE attachment per page URL.
    for (const url of chainAfterRun2.keys()) {
      const carriers = [...w.fake.world.attachments.values()].filter((a) => a.url === url);
      assert.equal(carriers.length, 1, `exactly one attachment at ${url} (URL idempotency)`);
    }

    // No locally stored attachment ids / page index. Every attachment id (seeded
    // AND engine-created) must be absent from EVERY state file (sealed manifests/
    // journals are ciphertext — ids are never journaled in plaintext either);
    // continuation URLs must be absent from the unsealed observable artifacts
    // (plans/, reports/, sync-state.json, last-run.json) — the chain is re-derived
    // from URLs, and manifests/journals are the contract-sanctioned URL recorders
    // (FR-015). No artifact may be NAMED like an attachment/page index.
    const ids = [...w.fake.world.attachments.keys()];
    assert.ok(ids.length >= 5, "seeded + engine-created attachments exist to scan for");
    const continuationUrls = [
      historyPageUrlFor(w, uuids[0]!, 1),
      historyPageUrlFor(w, uuids[1]!, 1),
      historyPageUrlFor(w, uuids[1]!, 2),
    ];
    const files = listFiles(w.stateDir);
    assert.ok(files.length > 0, "state directory holds the run artifacts");
    for (const file of files) {
      const rel = relative(w.stateDir, file);
      assert.equal(
        /attachment|page-?index/i.test(basename(file)),
        false,
        `no attachment-id/page-index artifact: found ${rel}`,
      );
      const text = readFileSync(file).toString("latin1");
      for (const id of ids) {
        assert.equal(text.includes(id), false, `attachment id '${id}' never stored locally (${rel})`);
      }
      if (!/^(manifests|runs)[/\\]/.test(rel)) {
        for (const url of continuationUrls) {
          assert.equal(
            text.includes(url),
            false,
            `continuation page URL never cached in unsealed state (${rel}: ${url})`,
          );
        }
      }
    }
  } finally {
    await w.dispose();
  }
});
