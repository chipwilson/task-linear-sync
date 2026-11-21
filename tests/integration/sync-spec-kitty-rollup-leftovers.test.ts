/**
 * T028 [022 US2] — roll-up-era leftovers never pair and never vanish (spec SC-004;
 * contracts C5.1/C5.2; quickstart step 6). World `spec-kitty-rollup-leftovers`: the
 * upstream-reproduction fixture repo (T002/T003) with the 002 mission's PRE-022 sync
 * state simulated on the fake `Linear_Port` — 16 checklist-line issues (`Tnnn` seeds)
 * and 3 work-package-heading issues (ordinal-fallback seeds), each carrying its durable
 * anchor attachment — plus a planning-only mission `003-plan-only` (no collection).
 *
 * @steps a: the plan contains ONLY work-package documents — zero roll-up-line entries
 *          (FR-005), every entry a `tasks/` document under the two real missions
 *        b: EVERY seeded roll-up-era issue is unmapped; ZERO pair onto document-kind
 *          tasks — including the heading whose title contains `Release Validation
 *          Tooling` (the durable-only veto of T027 in the real pipeline)
 *        c: apply creates the 5 documents and mutates NOTHING of the seeded issues —
 *          zero archives, zero updates (C5.2); a re-plan converges (no re-create)
 *        d: `003-plan-only` (roll-up, no collection) contributes zero tasks and the
 *          run is not an error (US2-AC3)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { CreateIssueInput } from "task-linear-sync/ports";

import {
  attachEngine,
  buildWorld,
  callsOf,
  mutationCalls,
  type EngineWorld,
} from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const MISSION = "002-lightweight-pypi-release";

function gates(world: EngineWorld, plan: { planId: string; lowConfidencePresent: boolean }): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

test("roll-up-era leftovers: plan is documents-only, legacy issues unmapped, nothing deleted (C5.1/C5.2)", async () => {
  const w = await buildWorld("spec-kitty-rollup-leftovers");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // (a) documents only — every entry lives in a tasks/ collection of a real mission.
    assert.ok(plan.entries.length > 0);
    assert.ok(
      plan.entries.every((e) => e.filePath.includes("/tasks/") && !e.filePath.endsWith("tasks.md")),
      `only collection documents are planned (got ${plan.entries.map((e) => e.filePath).join(", ")})`,
    );
    assert.ok(plan.entries.every((e) => e.frameworkId === "spec-kitty"));
    assert.ok(plan.entries.every((e) => e.decision === "create"), "bootstrap: nothing pairs with a document task");
    const missions = new Set(plan.entries.map((e) => e.featureName));
    assert.deepEqual([...missions].sort(), ["001-triage", MISSION]);

    // (d) 003-plan-only contributes zero tasks and is not an error (US2-AC3).
    assert.ok(!plan.entries.some((e) => (e.featureName ?? "").startsWith("003-plan-only")));
    assert.equal(
      plan.entries.filter((e) => e.filePath.startsWith("kitty-specs/003-plan-only")).length,
      0,
    );

    // (b) every seeded legacy issue is unmapped — including the title-contained bait.
    const seededIds = (
      JSON.parse(readFileSync(join(w.fixtureDir, "world.json"), "utf8")) as {
        issues: { id: string; title: string }[];
      }
    ).issues;
    const unmapped = new Set(plan.unmappedIssues.map((u) => u.issueId));
    for (const issue of seededIds) assert.ok(unmapped.has(issue.id), `legacy issue ${issue.id} unmapped`);
    const bait = seededIds.find((i) => i.title.includes("Release Validation Tooling"));
    assert.ok(bait !== undefined, "fixture carries the title-contained bait issue");
    assert.ok(plan.unmappedIssues.some((u) => u.issueId === bait!.id));
    assert.ok(
      plan.entries.every((e) => e.match === undefined),
      "no document entry pairs with ANY issue (durable-only veto on live anchors)",
    );

    // (c) apply creates the documents only — legacy issues untouched, none deleted.
    const mark = callsOf(w, "archiveIssue").length;
    const applied = await engine.applySyncPlan(plan, gates(w, plan));
    assert.equal(applied.status, "applied");
    const creates = callsOf(w, "createIssue", mark);
    assert.equal(creates.length, plan.entries.length);
    const createdTitles = creates.map((c) => (c.args[0] as CreateIssueInput).title);
    assert.ok(createdTitles.includes("Release Validation Tooling"));
    assert.equal(callsOf(w, "archiveIssue", mark).length, 0, "C5.2: nothing archives the leftovers");
    const seededIdSet = new Set(seededIds.map((i) => i.id));
    assert.ok(
      mutationCalls(w).every(
        (c) => c.method === "createIssue" || !seededIdSet.has(String(c.args[0] ?? "")),
      ),
      "no mutation targets a seeded legacy issue",
    );

    // Convergence: re-plan creates nothing further; the 19 remain unmapped.
    const rePlan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(rePlan.entries.length, plan.entries.length);
    assert.ok(rePlan.entries.every((e) => e.decision !== "create"), "applied documents converge");
    assert.equal(rePlan.unmappedIssues.length, seededIds.length);
  } finally {
    await w.dispose();
  }
});
