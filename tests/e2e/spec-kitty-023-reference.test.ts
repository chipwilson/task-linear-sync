/**
 * T029 [023 US4] — reference-reproduction acceptance e2e (research R8) over the world
 * `spec-kitty-023-reference`: three mission naming styles (`042-*`, `*-01KQ2VNJ`, bare
 * slug), full artifact sets, duplicated-`work_package_id` sub-folder artifacts, a mixed
 * status-event log, and WP documents carrying block-list/flow-list `subtasks` rosters,
 * `### Subtask Tnnn – Title` anchors and Activity-Log restatements.
 *
 * Scenarios (constitution VI: hermetic fake port, zero network):
 *  - STOCK DEFAULTS — SC-002 count parity (tasks = canonical WP documents, zero
 *    sub-issues), SC-007 zero collision refusals, SC-003 the event log alone moves the
 *    one mapped lane (status.json says `done`, front matter says `planned` — the last
 *    qualifying log line `in_progress` wins), unmapped lane reported, no-log mission
 *    untouched, findings for the malformed line and the unknown `WP99`;
 *  - DEPTH 2 — SC-001 children equal the anchors, parented; the parent body carries
 *    holes where anchors were holed out (promoted spans), children mirror verbatim;
 *  - CAP TOGGLE 2→1→CONVERGE — FR-010/SC-005: former children surface as unmapped with
 *    zero archive/delete, parents re-converge, the toggle back re-matches with zero
 *    re-creation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";

import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const WORLD = "spec-kitty-023-reference";

const WP01_ONBOARDING = "kitty-specs/042-auth-system/tasks/WP01-onboarding.md";
const WP02_ROTATION = "kitty-specs/042-auth-system/tasks/WP02-token-rotation.md";
const WP01_GATEWAY = "kitty-specs/auth-system-01KQ2VNJ/tasks/WP01-gateway.md";
const WP01_VERIFY = "kitty-specs/bare-slug-mission/tasks/WP01-verify.md";

const gates = (world: EngineWorld, plan: Plan): GateRequest => ({
  applyFlag: true,
  confirmationKey: world.config.confirmationKey,
  acceptLowConfidence: plan.lowConfidencePresent,
  planReference: plan.planId,
});

function setCap(world: EngineWorld, cap: number): void {
  (world.config as { maxTaskIssueDepth: number }).maxTaskIssueDepth = cap;
}

interface ReportJson {
  securityAssertions: ReadonlyArray<{ guarantee: string; status: string; detail?: string }>;
}

function readLatestReport(world: EngineWorld): ReportJson {
  const reportsDir = join(world.stateDir, "reports");
  const runDirs = readdirSync(reportsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  return JSON.parse(readFileSync(join(reportsDir, runDirs[runDirs.length - 1]!, "report.json"), "utf8")) as ReportJson;
}

test("spec-kitty 023 reference reproduction (stock defaults): count parity, zero collisions, the log alone moves the mapped lane, findings reported, second pass quiescent", async () => {
  const w = await buildWorld(WORLD);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }); // SC-007: must not refuse

    // SC-002: one task per canonical WP document — artifacts, roll-ups, README, spec/plan
    // and the status files contribute NOTHING; zero sub-issues at the default cap.
    assert.deepEqual(
      plan.entries.map((e) => e.filePath).sort(),
      [WP01_ONBOARDING, WP01_GATEWAY, WP01_VERIFY, WP02_ROTATION].sort(),
      "tasks = the four canonical WP documents",
    );

    // SC-003 posture at plan time.
    const byPath = (p: string) => plan.entries.find((e) => e.filePath === p)!;
    assert.ok(byPath(WP01_ONBOARDING).reasons.includes("lane:in_progress"), "LAST qualifying log line wins — status.json 'done' and front-matter 'planned' are never consulted");
    assert.ok(
      byPath(WP01_GATEWAY).reasons.includes("lane-state-unmapped"),
      "blocked has no default counterpart (FR-003, 024) — untouched + reported",
    );
    assert.ok(!byPath(WP02_ROTATION).reasons.some((r) => r.startsWith("lane:")), "annotation-only log — no lane, no label");
    assert.ok(!byPath(WP01_VERIFY).reasons.some((r) => r.startsWith("lane")), "the no-log mission is untouched — nothing is even reported");

    const report = readLatestReport(w);
    const malformed = report.securityAssertions.filter((a) => a.guarantee === "status-event-log");
    assert.equal(malformed.length, 1, "one malformed-count finding for the mission carrying junk");
    assert.match(malformed[0]!.detail ?? "", /1/);
    assert.ok(!(malformed[0]!.detail ?? "").includes("malformed —"), "malformed content never propagates");
    const unknown = report.securityAssertions.filter((a) => a.guarantee === "status-event-unknown-wp");
    assert.equal(unknown.length, 1);
    assert.match(unknown[0]!.detail ?? "", /WP99/, "the unknown id is named, then ignored");

    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 4, "zero sub-issues (SC-002) — exactly the four documents create");
    for (const c of creates) {
      const input = c.args[0] as CreateIssueInput;
      if (input.title === "Onboarding flow") {
        assert.equal(input.stateType, "started", "the mapped create carries the log-driven state (Doing / started)");
      } else {
        assert.equal(input.stateType, undefined, "unmapped/absent lanes create at the tracker default");
      }
      assert.ok(!input.description.includes("lane"), "status text never rides mirrored content");
      assert.ok(!input.description.includes("---"), "no front-matter block ever mirrors");
    }
    assert.equal(w.fake.world.issues.size, 4, "WP99 and every artifact conjured nothing");

    // Quiescent second pass.
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(plan2.entries.filter((e) => e.decision !== "no-change"), [], "second plan is fully quiescent");
    const applied2 = await engine2.applySyncPlan(plan2, gates(w, plan2));
    assert.equal(applied2.status, "applied");
    assert.equal(callsOf(w, "createIssue").length, 4, "the no-op pass mutates nothing");
  } finally {
    await w.dispose();
  }
});

test("spec-kitty 023 reference reproduction (depth 2): children equal the anchors, parented; parent bodies hole out promoted spans; children mirror verbatim", async () => {
  const w = await buildWorld(WORLD, { config: { maxTaskIssueDepth: 2 } });
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 8, "4 documents + 4 `### Subtask Tnnn` anchors (SC-001)");

    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(w, "createIssue").map((c) => c.args[0] as CreateIssueInput);
    assert.equal(creates.length, 8);
    const children = creates.filter((c) => c.parentId !== undefined);
    assert.equal(children.length, 4, "every anchor child is parented to its WP issue");

    const parent = creates.find((c) => c.title === "Onboarding flow")!;
    assert.ok(!parent.description.includes("Section content for T001"), "the promoted span is holed out of the parent body");
    const child = children.find((c) => c.title === "Wire the login route")!;
    assert.ok(child, "anchor title becomes the child issue title");
    assert.ok(child.description.includes("Section content for T001 of WP01"), "child mirrors its section verbatim");
    const rotationParent = creates.find((c) => c.title === "Token rotation")!;
    assert.ok(!rotationParent.description.includes("Section content for T001 of WP02"), "the flow-list-roster document holes its single promoted anchor too");

    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(plan2.entries.filter((e) => e.decision !== "no-change"), [], "depth-2 second plan is quiescent too");
  } finally {
    await w.dispose();
  }
});

test("spec-kitty 023 reference reproduction (cap toggle 2→1→converge): former children unmapped with zero archive, parents re-converge, toggle back re-matches", async () => {
  const w = await buildWorld(WORLD, { config: { maxTaskIssueDepth: 2 } });
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal((await engine.applySyncPlan(plan, gates(w, plan))).status, "applied");
    assert.equal(w.fake.world.issues.size, 8);

    // Tighten to the flat default: the 4 former children surface as unmapped, NOTHING is
    // archived or deleted (FR-010/SC-005); the parents re-converge with folded content.
    setCap(w, 1);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan2.entries.length, 4, "level-1 count is the canonical document count at BOTH caps");
    assert.equal(plan2.unmappedIssues.length, 4, "the former children surface via unmappedIssues");
    const mark = callsOf(w, "archiveIssue").length;
    const applied2 = await engine2.applySyncPlan(plan2, gates(w, plan2));
    assert.equal(applied2.status, "applied");
    assert.equal(callsOf(w, "archiveIssue").length, mark, "zero auto-archival on the fold");
    assert.equal(w.fake.world.issues.size, 8, "nothing is deleted — the tracker keeps the stale children as leftovers");

    // Toggle back: the durable anchors re-match the SAME issues with zero re-creation.
    const mark2 = callsOf(w, "createIssue").length;
    setCap(w, 2);
    const engine3 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan3 = await engine3.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan3.entries.length, 8);
    const applied3 = await engine3.applySyncPlan(plan3, gates(w, plan3));
    assert.equal(applied3.status, "applied");
    assert.equal(callsOf(w, "createIssue").length, mark2, "zero re-creation through the toggle back");
    assert.equal(plan3.unmappedIssues.length, 0);
  } finally {
    await w.dispose();
  }
});
