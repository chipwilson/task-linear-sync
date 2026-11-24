/**
 * T021 [P] [US3] — event-log status authority over world `spec-kitty-event-status`
 * (feature 023 quickstart scenario 3 / SC-003, FR-007; contract C6; amendment A-023-3).
 * RED-FIRST: the status loader (T022/T023), the lane resolver (T024) and the entry-assembly
 * integration (T025) land after this file — until then no lane label, state drift, or
 * `lane-changed` history exists and every pin below fails.
 *
 * Pinned posture (data-model §4, C6.2/C6.3):
 *  - ONLY `WP02` (last qualifying event `in_progress`, mapped to `Doing`) plans
 *    `changedFields += "state"` with label `lane:in_progress`; apply patches the `Doing`
 *    state id and records the append-only `"lane-changed"` history event;
 *  - `WP01` (no lane events) stays untouched, no label; `WP03` (`canceled`, unmapped) is
 *    untouched with `lane-state-unmapped` reported;
 *  - the contradiction fixture NEVER resolves to `status.json` / front matter (they say
 *    `planned`); mirrored descriptions carry no status text and no `---` block;
 *  - the malformed log line is counted into ONE reported finding (content never propagates);
 *    the unknown `WP99` event is ignored with a finding and conjures nothing;
 *  - a second plan+apply against unchanged inputs is a no-op (live state matches);
 *  - read-only lanes never mutate, and NO lane ever writes a repo file (status files
 *    included — byte-equal walk across the whole run).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput, IssueUpdatePatch } from "task-linear-sync/ports";
import type { Plan, SyncHistoryEvent, SyncStatePayload } from "task-linear-sync/domain";
import { taskStableSeed } from "task-linear-sync/domain";

import { attachEngine, attachmentUrlFor, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";
import { deriveStableUuid } from "../../src/parsing/identity.js";

const DOING_ID = "ac000000-0000-4000-8000-000000000203";
const WP02_ISSUE_ID = "ac000000-0000-4000-8000-000000000510";

const gates = (world: EngineWorld, plan: Plan): GateRequest => ({
  applyFlag: true,
  confirmationKey: world.config.confirmationKey,
  acceptLowConfidence: plan.lowConfidencePresent,
  planReference: plan.planId,
});

const wp02Uuid = (toolId: string): string =>
  deriveStableUuid(
    taskStableSeed({ frameworkId: "spec-kitty", featureName: "002-auth-system", localTaskId: "WP02" }, { ordinal: 0, filePath: "kitty-specs/002-auth-system/tasks/WP02-oauth.md" }),
    toolId,
  );

interface ReportJson {
  securityAssertions: ReadonlyArray<{ guarantee: string; status: string; detail?: string }>;
}

/** The LATEST persisted plan report (each build writes its own `reports/<runId>/`). */
function readLatestReport(world: EngineWorld): ReportJson {
  const reportsDir = join(world.stateDir, "reports");
  assert.ok(existsSync(reportsDir), "reports/ exists after a plan build");
  const runDirs = readdirSync(reportsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.ok(runDirs.length > 0, "at least one report run dir");
  return JSON.parse(readFileSync(join(reportsDir, runDirs[runDirs.length - 1]!, "report.json"), "utf8")) as ReportJson;
}

async function page0Payload(world: EngineWorld, taskUuid: string): Promise<SyncStatePayload | null> {
  const att = await world.fake.getAttachmentByUrl(attachmentUrlFor(world, taskUuid));
  if (att === null) return null;
  const raw = att.metadata[world.config.metadataNamespaceKey];
  if (typeof raw !== "string") return null;
  return JSON.parse(raw) as SyncStatePayload;
}

/** Raw byte walk of the temp repo (status files included). */
function walk(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? d.name : `${prefix}/${d.name}`;
    if (d.isDirectory()) Object.assign(out, walk(join(dir, d.name), rel));
    else out[rel] = readFileSync(join(dir, d.name)).toString("base64");
  }
  return out;
}

test("023 event-status: the log is the SOLE status authority — one lane move, two untouched WPs, findings reported, second run no-op", async () => {
  const w = await buildWorld("spec-kitty-event-status");
  try {
    const preRun = walk(w.repositoryRoot);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Plan is read-only (Principle I).
    assert.equal(callsOf(w, "createIssue").length, 0);

    assert.equal(plan.entries.length, 3, "three canonical documents (cap 1 — no children)");
    const uuid2 = wp02Uuid(w.config.toolId);
    assert.equal(uuid2, "8a712f9e-841d-5401-9b12-733eb3959d36", "the world's seeded durable anchor IS the WP02 identity");
    const wp02 = plan.entries.find((e) => e.taskUuid === uuid2)!;
    assert.ok(wp02, "WP02 plans against its seeded issue");
    assert.equal(wp02.decision, "update", "the lane move is an update");
    assert.ok(wp02.changedFields.includes("state"), "state drift from the LAST lane event only");
    assert.ok(!wp02.changedFields.includes("description"), "the description channel stays clean");
    assert.ok(wp02.reasons.includes("lane:in_progress"), `label lane:<lane>, got ${wp02.reasons.join(",")}`);

    const byPath = (needle: string) => plan.entries.find((e) => e.filePath.includes(needle))!;
    const wp01 = byPath("WP01-setup");
    assert.equal(wp01.decision, "create");
    assert.ok(!wp01.reasons.some((r) => r.startsWith("lane:")), "no lane events ⇒ untouched, NO label");
    assert.ok(!wp01.reasons.includes("lane-state-unmapped"));
    const wp03 = byPath("WP03-teardown");
    assert.equal(wp03.decision, "create");
    assert.ok(wp03.reasons.includes("lane-state-unmapped"), "canceled is NOT configured for team acme — untouched + reported");
    assert.ok(!wp03.changedFields.includes("state"), "an unmapped lane never patches state");

    // Reported findings: the malformed line COUNT (content never propagates) and the
    // unknown wp_id (ignored — nothing conjured).
    const report = readLatestReport(w);
    const malformed = report.securityAssertions.filter((a) => a.guarantee === "status-event-log");
    assert.equal(malformed.length, 1, `one malformed-count finding per mission, got ${malformed.length}`);
    assert.match(malformed[0]!.detail ?? "", /1/, "the count rides the finding");
    assert.ok(!(malformed[0]!.detail ?? "").includes("malformed —"), "malformed CONTENT never propagates into reports");
    const unknown = report.securityAssertions.filter((a) => a.guarantee === "status-event-unknown-wp");
    assert.equal(unknown.length, 1, "one unknown-wp_id finding for the mission");
    assert.match(unknown[0]!.detail ?? "", /WP99/, "the unknown id is named in the finding");

    // ── APPLY ─────────────────────────────────────────────────────────────────────────
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");

    const updates = callsOf(w, "updateIssue");
    assert.equal(updates.length, 1, "exactly the WP02 state patch lands");
    const patch = updates[0]!.args[1] as IssueUpdatePatch;
    assert.equal(patch.stateTypeId, DOING_ID, "the Doing state id resolved through the snapshot");
    assert.equal(patch.description, undefined, "no description churn — status text NEVER rides mirrored content");
    assert.equal(patch.title, undefined);

    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 2, "WP01 + WP03 create; WP02 re-matched its seeded issue");
    for (const c of creates) {
      assert.equal((c.args[0] as CreateIssueInput).stateType, undefined, "unmapped/absent lanes create at the tracker default");
    }

    // `lane-changed` history (append-only additive kind) — NOT a checkbox event.
    const payload = await page0Payload(w, uuid2);
    assert.ok(payload, "WP02 page-0 payload exists");
    const laneEvents = payload.history.filter((e: SyncHistoryEvent) => e.kind === "lane-changed");
    assert.equal(laneEvents.length, 1, "one append-only lane-changed event");
    assert.equal(payload.history.filter((e: SyncHistoryEvent) => e.kind === "checkbox-changed").length, 0, "the lane move is never a checkbox-changed event");

    // Tracker-visible state moved; descriptions carry NO status text and no front matter.
    const issue = w.fake.world.issues.get(WP02_ISSUE_ID)!;
    assert.equal(issue.stateType, "started", "live state follows the event log (Doing / started)");
    assert.ok(!issue.description.includes("lane"), "no status text in the mirrored body");
    assert.ok(!issue.description.includes("---"), "no front-matter block ever mirrors");

    // WP99 conjured nothing: exactly three issues exist (1 seed + 2 creates).
    assert.equal(w.fake.world.issues.size, 3);

    // Zero repo writes across the whole run — status files ride read-only (Principle I).
    assert.deepEqual(walk(w.repositoryRoot), preRun, "every repo byte survives (status files untouched)");

    // ── RE-RUN — the live state matches ⇒ full no-op ───────────────────────────────────
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const wp02b = plan2.entries.find((e) => e.taskUuid === uuid2)!;
    assert.equal(wp02b.decision, "no-change", "mapped lane already matches live state — idempotent");
    assert.ok(!wp02b.changedFields.includes("state"));
    assert.deepEqual(
      plan2.entries.filter((e) => e.decision === "create" || e.decision === "update" || e.decision === "conflict"),
      [],
      "second pass is fully quiescent",
    );
    const applied2 = await engine2.applySyncPlan(plan2, gates(w, plan2));
    assert.equal(applied2.status, "applied", "the no-op plan still applies cleanly (zero pending actions)");
    assert.equal(applied2.status, "applied");
    const payload2 = await page0Payload(w, uuid2);
    assert.equal(
      payload2!.history.filter((e: SyncHistoryEvent) => e.kind === "lane-changed").length,
      1,
      "the no-op re-run appends nothing (append-only vocabulary, zero duplicates)",
    );
  } finally {
    await w.dispose();
  }
});

test("023 event-status: a fresh document with a mapped lane CREATES straight into the mapped state", async () => {
  const w = await buildWorld("spec-kitty-event-status");
  try {
    // Un-seed WP02's pre-existing issue: the same document now bootstraps.
    w.fake.world.issues.delete(WP02_ISSUE_ID);
    for (const [id, att] of [...w.fake.world.attachments.entries()]) {
      if (att.issueId === WP02_ISSUE_ID) w.fake.world.attachments.delete(id);
    }
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const wp02 = plan.entries.find((e) => e.filePath.includes("WP02"))!;
    assert.equal(wp02.decision, "create");
    assert.ok(wp02.reasons.includes("lane:in_progress"), "the lane label rides the create too");

    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const create = callsOf(w, "createIssue").find((c) => (c.args[0] as CreateIssueInput).title === "OAuth bridge")!;
    assert.ok(create, "WP02 created");
    assert.equal((create.args[0] as CreateIssueInput).stateType, "started", "creates carry the MAPPED state (C6.3)");

    // The carried state is already the desired one — the next plan sees no drift at all.
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const wp02b = plan2.entries.find((e) => e.filePath.includes("WP02"))!;
    assert.equal(wp02b.decision, "no-change", "create-with-state is idempotent on the next pass");
  } finally {
    await w.dispose();
  }
});
