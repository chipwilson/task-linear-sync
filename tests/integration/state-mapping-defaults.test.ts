/**
 * T018 [P] [US3] — quickstart V3: the shared default table serves EVERY framework
 * (feature 024; FR-004/FR-005; contract C1.3; SC-001/SC-006). World
 * `state-mapping-frameworks-default` configures the team with a bare `projects` row —
 * zero mapping keys — against a team whose workflow is exactly Linear's default states,
 * and carries one feature per framework: kiro, spec-kit, open-spec, bmad, generic
 * (checkbox movements) and spec-superpower (participation pinned below).
 *
 * Pinned posture:
 *  - bootstrap creates land at the TRACKER default — a checkbox create is never
 *    pre-seeded with a completion state (the completion arm fires on CHECKED DRIFT);
 *  - run B checks one task per framework ⇒ every entry resolves the SAME `Done`
 *    state id — identical targets across frameworks (FR-005), each an `update` with
 *    `completion:state-name:Done`;
 *  - run C unchecks them ⇒ every entry resolves the SAME `Backlog` state id (FR-004);
 *  - spec-superpower: its `Task N:` heading tasks carry no checkbox (018 — every
 *    checkbox line is mirrored roll-up body, never a task), so no checkbox-driven
 *    state move is possible; what IS pinned here is the FR-005 half that applies: the
 *    framework's tasks ride the SAME zero-config identity table (its creates pass the
 *    bootstrap validator and carry no invented state), and its completion-NAME
 *    resolution equality is pinned per-framework by T020 at the unit seam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { IssueUpdatePatch } from "task-linear-sync/ports";
import type { Plan } from "task-linear-sync/domain";

import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const DONE_ID = "ac000000-0000-4000-8000-000000000204";
const BACKLOG_ID = "ac000000-0000-4000-8000-000000000201";

/** The one "Task A" line per checkbox framework — flipped together each run. */
const CHECKBOX_FILES: ReadonlyArray<{ frameworkId: string; rel: string; needle: string }> = [
  { frameworkId: "kiro", rel: ".kiro/specs/auth/tasks.md", needle: "Task A — wire the token verifier" },
  { frameworkId: "spec-kit", rel: "specs/pay/tasks.md", needle: "Task A — charge the card" },
  { frameworkId: "open-spec", rel: "openspec/cart/tasks.md", needle: "T001 Task A — merge cart lines" },
  { frameworkId: "bmad", rel: "bmad/epic-1/tasks.md", needle: "T001 Task A — scaffold the story" },
  { frameworkId: "generic", rel: "notes/tasks.md", needle: "Task A — sweep the strays" },
];

function gates(w: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: w.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

function setChecked(w: EngineWorld, rel: string, needle: string, checked: boolean): void {
  const path = join(w.repositoryRoot, rel);
  const src = readFileSync(path, "utf8");
  const line = src.split("\n").find((l) => l.includes(needle) && /^- \[[ x]\]/u.test(l));
  assert.ok(line !== undefined, `checkbox line for '${needle}' in ${rel}`);
  const next = checked ? line.replace("- [ ]", "- [x]") : line.replace("- [x]", "- [ ]");
  writeFileSync(path, src.replace(line, next));
}

function updatePatches(w: EngineWorld): ReadonlyArray<{ args: readonly [string, IssueUpdatePatch] }> {
  return callsOf(w, "updateIssue") as unknown as ReadonlyArray<{ args: readonly [string, IssueUpdatePatch] }>;
}

test("framework matrix: one zero-config table moves every framework to the SAME Done/Backlog states (V3, FR-004/005)", async () => {
  const w = await buildWorld("state-mapping-frameworks-default");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // ── Run A — bootstrap: every framework's tasks create at the tracker default. ──
    const planA = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const byFramework = new Set<string>(planA.entries.map((e) => e.frameworkId));
    for (const fw of ["kiro", "spec-kit", "open-spec", "bmad", "generic", "spec-superpower"]) {
      assert.ok(byFramework.has(fw), `framework '${fw}' plans through the shared zero-config world`);
    }
    const appliedA = await engine.applySyncPlan(planA, gates(w, planA));
    assert.equal(appliedA.status, "applied");
    for (const c of callsOf(w, "createIssue")) {
      const input = c.args[0] as { stateType?: string; stateTypeId?: string };
      assert.equal(input.stateType ?? input.stateTypeId, undefined, "checkbox creates are never pre-seeded with a completion state");
    }
    const superpowerEntries = planA.entries.filter((e) => e.frameworkId === "spec-superpower");
    assert.ok(superpowerEntries.length >= 3, "spec-superpower heading tasks ride the same bootstrap (validator-passing, default-workflow) seam");
    for (const e of superpowerEntries) {
      assert.ok(!e.changedFields.includes("state"), "no state is invented for checkbox-less heading tasks (018 roll-up posture preserved)");
    }

    // ── Run B — check one task per checkbox framework ⇒ ALL move to the same Done. ──
    for (const f of CHECKBOX_FILES) setChecked(w, f.rel, f.needle, true);
    const planB = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const doneEntries = planB.entries.filter((e) => e.reasons.includes("completion:state-name:Done"));
    assert.equal(doneEntries.length, CHECKBOX_FILES.length, "exactly the five checked tasks drift");
    for (const e of doneEntries) {
      assert.equal(e.decision, "update");
      assert.ok(e.changedFields.includes("state"), "state drift is recorded per framework");
      assert.ok(e.reasons.includes("completion:state-id:" + DONE_ID), `${e.frameworkId}: the SHARED table resolves the identical Done id`);
    }
    assert.deepEqual(
      new Set(doneEntries.map((e) => e.frameworkId)),
      new Set(CHECKBOX_FILES.map((f) => f.frameworkId)),
      "every checkbox framework participated (SC-006)",
    );
    const appliedB = await engine.applySyncPlan(planB, gates(w, planB));
    assert.equal(appliedB.status, "applied");
    const patches = updatePatches(w);
    assert.equal(patches.length, CHECKBOX_FILES.length, "one state patch per framework, nothing else moved");
    for (const p of patches) {
      assert.equal(p.args[1].stateTypeId, DONE_ID, "the SAME Done state id lands for every framework (FR-005)");
    }

    // ── Run C — uncheck ⇒ ALL resolve the same Backlog (the unchecked arm). ──
    for (const f of CHECKBOX_FILES) setChecked(w, f.rel, f.needle, false);
    const planC = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const backlogEntries = planC.entries.filter((e) => e.reasons.includes("completion:state-name:Backlog"));
    assert.equal(backlogEntries.length, CHECKBOX_FILES.length);
    for (const e of backlogEntries) {
      assert.ok(e.reasons.includes("completion:state-id:" + BACKLOG_ID), `${e.frameworkId}: identical Backlog id across frameworks`);
    }
    const appliedC = await engine.applySyncPlan(planC, gates(w, planC));
    assert.equal(appliedC.status, "applied");
    const backlogPatches = updatePatches(w).slice(patches.length);
    assert.equal(backlogPatches.length, CHECKBOX_FILES.length);
    for (const p of backlogPatches) {
      assert.equal(p.args[1].stateTypeId, BACKLOG_ID, "the SAME Backlog state id lands for every framework (FR-004)");
    }
    // No stray state moves: the ONLY updateIssue patches across B and C are the ten
    // completion transitions asserted above.
    assert.equal(updatePatches(w).length, CHECKBOX_FILES.length * 2, "nothing else moved any issue state");
  } finally {
    await w.dispose();
  }
});
