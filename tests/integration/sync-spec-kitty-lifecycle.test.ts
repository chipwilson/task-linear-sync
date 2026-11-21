/**
 * T030 [022 US3] — the work-package lifecycle over the injected fake `Linear_Port`
 * (world `spec-kitty-lifecycle`, T029; spec US3 AC1–AC4, SC-003/SC-005, FR-010;
 * contract C4.2 + C6.1 apply-side; quickstart step 5). Replaces the deleted
 * `sync-spec-kitty-drift.test.ts`.
 *
 * @steps 1: bootstrap plan+apply creates exactly one issue per WP document (2)
 *        2: re-plan over unchanged inputs is a FULL no-op (all `no-change`, apply
 *           mutates nothing)
 *        3: flip `lane: planned → claimed`, append Activity Log lines and a
 *           `## Review Report` section, and rename the file inside its `tasks/`
 *           folder — re-plan: `{create:0, update:1, no-change:1}` in shape (the
 *           frozen 008 taxonomy rides the one-sided content push on the
 *           conflict/overwrite-linear lane); the update is the SAME Stable_UUID
 *           onto the SAME issue; apply performs exactly one description update —
 *           zero creates, zero archives (identity signals — lane, file name —
 *           move nothing)
 *        4: the landed repo files are BYTE-IDENTICAL to the user's edited files
 *           (zero confirmation prefixes anywhere — document tasks never write back)
 *        5: the two missions' `WP01` are two distinct issues, each described by its
 *           own mission document (FR-007/US3-AC3); the settling re-plan is a full no-op
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { Plan } from "task-linear-sync/domain";
import type { CreateIssueInput, IssueUpdatePatch } from "task-linear-sync/ports";

import {
  attachEngine,
  buildWorld,
  callsMark,
  callsOf,
  mutationCalls,
  type EngineWorld,
} from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

function gates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

const countBy = (plan: Plan): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of plan.entries) out[e.decision] = (out[e.decision] ?? 0) + 1;
  return out;
};

/** Byte walk of the temp repo (post-edit world state — the write-back witness). */
function walk(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? d.name : `${prefix}/${d.name}`;
    if (d.isDirectory()) Object.assign(out, walk(join(dir, d.name), rel));
    else out[rel] = readFileSync(join(dir, d.name), "utf8");
  }
  return out;
}

test("work-package lifecycle: lane flips, appends and renames update the SAME issue (US3)", async () => {
  const w = await buildWorld("spec-kitty-lifecycle");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // 1 — bootstrap: exactly one issue per WP document.
    const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan1.entries.length, 2);
    assert.deepEqual(countBy(plan1), { create: 2 });
    assert.ok(plan1.entries.every((e) => e.expectedMarkdownChanges.length === 0));
    const alphaEntry1 = plan1.entries.find((e) => e.filePath.includes("002-alpha"))!;
    const betaEntry1 = plan1.entries.find((e) => e.filePath.includes("003-beta"))!;
    assert.notEqual(alphaEntry1.taskUuid, betaEntry1.taskUuid, "two missions' WP01 are two identities");

    const applied1 = await engine.applySyncPlan(plan1, gates(w, plan1));
    assert.equal(applied1.status, "applied");
    const creates = callsOf(w, "createIssue");
    assert.equal(creates.length, 2);
    const created = creates.map((c) => c.args[0] as CreateIssueInput);
    assert.ok(created.some((c) => c.title === "One" && c.description.includes("002-alpha")));
    assert.ok(created.some((c) => c.title === "Two" && c.description.includes("003-beta")));

    // 2 — unchanged re-plan is a FULL no-op.
    const plan2 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(countBy(plan2), { "no-change": 2 });
    const alphaIssueId = plan2.entries.find((e) => e.filePath.includes("002-alpha"))!.match!.issueId;
    const betaIssueId = plan2.entries.find((e) => e.filePath.includes("003-beta"))!.match!.issueId;
    assert.notEqual(alphaIssueId, betaIssueId, "each mission's WP01 rides its own issue");
    const mark = callsMark(w);
    await engine.applySyncPlan(plan2, gates(w, plan2));
    assert.equal(mutationCalls(w, mark).length, 0, "no-op apply mutates nothing");

    // 3 — the lifecycle edits: lane flip, Activity Log append, Review Report append, rename.
    const alphaPath = join(w.repositoryRoot, "kitty-specs/002-alpha/tasks/WP01-one.md");
    const edited = readFileSync(alphaPath, "utf8")
      .replace("lane: planned", "lane: claimed")
      .replace(
        "- 2026-11-10 work package created",
        "- 2026-11-10 work package created\n- 2026-11-12 flipped to claimed and started",
      )
      .concat("\n## Review Report\n\nSkeleton reviewed — proceed to wiring.\n");
    writeFileSync(alphaPath, edited, "utf8");
    const renamedPath = join(w.repositoryRoot, "kitty-specs/002-alpha/tasks/WP01-one-tooling.md");
    renameSync(alphaPath, renamedPath);

    const plan3 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    // The frozen 008 taxonomy routes a one-sided (spec-changed) description drift as a
    // CONFLICT-decided entry whose resolved action is overwrite-linear — the content
    // push lane every other framework's edit scenario uses; `update` remains for the
    // title/checkbox drift channels. Zero creates is the load-bearing US3 number.
    assert.deepEqual(countBy(plan3), { conflict: 1, "no-change": 1 });
    const alphaEntry3 = plan3.entries.find((e) => e.filePath.endsWith("WP01-one-tooling.md"))!;
    assert.ok(alphaEntry3.reasons.includes("action:overwrite-linear"), "single content-push lane");
    assert.equal(alphaEntry3.taskUuid, alphaEntry1.taskUuid, "identity survives the rename");
    assert.equal(alphaEntry3.match!.issueId, alphaIssueId, "the update lands on the SAME issue");
    assert.deepEqual([...alphaEntry3.changedFields].sort(), ["description"], "content-only update");
    assert.ok(plan3.entries.every((e) => e.expectedMarkdownChanges.length === 0));

    const updateMark = callsMark(w);
    const applied3 = await engine.applySyncPlan(plan3, gates(w, plan3));
    assert.equal(applied3.status, "applied");
    const updates = callsOf(w, "updateIssue", updateMark);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.args[0], alphaIssueId);
    const patch = updates[0]!.args[1] as IssueUpdatePatch;
    assert.equal(patch.title, undefined, "no title churn (H1 cascade keeps the title)");
    assert.ok(patch.description!.includes("flipped to claimed and started"));
    assert.ok(patch.description!.includes("## Review Report"));
    assert.equal(callsOf(w, "createIssue", updateMark).length, 0, "zero new issues");
    assert.equal(callsOf(w, "archiveIssue", updateMark).length, 0, "zero archives");

    // 4 — write-back NEVER touches the documents: repo bytes == the user's edits.
    const landed = walk(w.repositoryRoot);
    assert.equal(landed["kitty-specs/002-alpha/tasks/WP01-one-tooling.md"], edited);
    assert.ok(
      !Object.values(landed).some((text) => text.includes("[SYNC-")),
      "zero confirmation prefixes land in the repo (C6.1 apply side)",
    );

    // 5 — settling re-plan: full no-op, both issues intact.
    const plan4 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(countBy(plan4), { "no-change": 2 });
    assert.equal(plan4.unmappedIssues.length, 0);
    assert.equal(
      plan4.entries.find((e) => e.filePath.endsWith("WP01-one-tooling.md"))!.match!.issueId,
      alphaIssueId,
    );
    assert.equal(
      plan4.entries.find((e) => e.filePath.endsWith("WP01-two.md"))!.match!.issueId,
      betaIssueId,
    );
  } finally {
    await w.dispose();
  }
});
