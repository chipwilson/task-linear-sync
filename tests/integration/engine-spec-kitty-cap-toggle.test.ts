/**
 * T018 [P] [US2] — cap-toggle convergence over world `spec-kitty-two-level` (feature 023
 * US2; quickstart scenario 4; FR-010/FR-011, SC-005; decision table "Depth config 1 → 2 → 1").
 *
 * Cycle: apply at depth 2 (2 parents + 7 children) → reconfigure to 1 → plan+apply: the
 * children fold verbatim into the parents (parent descriptions byte-equal the FLAT
 * baseline = the contiguous body slice), the 7 former child issues surface in
 * `plan.unmappedIssues` with ZERO archive/delete calls (stale/leftover posture, no
 * auto-deletion) → reconfigure to 2: the durable anchors re-match the SAME child issues
 * (zero re-creation; SC-005) and a further re-plan is fully quiescent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import type { Plan } from "task-linear-sync/domain";

import { attachEngine, buildWorld, callsMark, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const MISSION = "002-auth-system";
const WP01 = `kitty-specs/${MISSION}/tasks/WP01-setup.md`;
const WP02 = `kitty-specs/${MISSION}/tasks/WP02-oauth.md`;

const CHILD_TITLES = [
  "Scaffold the package",
  "Add the configuration loader",
  "Wire the storage adapter",
  "Add start-up checks",
  "Request-token exchange",
  "Consent redirect handling",
  "Access-token refresh",
] as const;

/**
 * Re-configure the world between engine constructions: `deps.config` IS `world.config`
 * (shared reference through `buildWorld`), so the effective cap for every LATER
 * `attachEngine` + `buildSyncPlan` is this value — the same in-process reconfiguration
 * an operator performs by editing the config file between runs.
 */
function setCap(world: EngineWorld, cap: number): void {
  (world.config as { maxTaskIssueDepth: number }).maxTaskIssueDepth = cap;
}

function gates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** The 0.6.0 contiguous body slice (the FLAT baseline description bytes). */
function contiguousBody(content: string): string {
  const lines = content.split(/\r\n|\r|\n/);
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim() === "---") {
      close = i;
      break;
    }
  }
  assert.ok(close > 0, "front-matter fence closes");
  let start = close + 1;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start += 1;
  let last = lines.length - 1;
  while (last > start && (lines[last] ?? "").trim() === "") last -= 1;
  return lines.slice(start, last + 1).join("\n");
}

test("023 cap toggle 2 → 1 → 2: children fold verbatim, former children surface unmapped with zero deletion, then re-match their SAME issues", async () => {
  const w = await buildWorld("spec-kitty-two-level"); // world.json cap 2
  try {
    const flatBodies: Record<string, { body: string; anchor: string }> = {
      Setup: { body: contiguousBody(readFileSync(join(w.repositoryRoot, WP01), "utf8")), anchor: "### Subtask T001" },
      "OAuth bridge": { body: contiguousBody(readFileSync(join(w.repositoryRoot, WP02), "utf8")), anchor: "### Subtask T005" },
    };

    // ── Phase 1: apply at depth 2 — 9 issues, hole-sliced parents ────────────────────
    const engine1 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan1 = await engine1.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const applied1 = await engine1.applySyncPlan(plan1, gates(w, plan1));
    assert.equal(applied1.status, "applied");
    assert.equal(callsOf(w, "createIssue").length, 9, "2 parents + 7 children");
    const childIssueIds = new Set(
      [...w.fake.world.issues.values()].filter((i) => (CHILD_TITLES as readonly string[]).includes(i.title)).map((i) => i.id),
    );
    assert.equal(childIssueIds.size, 7, "all seven child issues exist");

    // ── Phase 2: reconfigure to 1 — fold, report, NEVER delete ───────────────────────
    setCap(w, 1);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    assert.equal(plan2.entries.length, 2, "only the two parents remain tasks (C0.2)");
    assert.ok(
      plan2.entries.every((e) => e.changedFields.includes("description")),
      "the parents gain the folded sections back — description drift toward the flat bytes",
    );
    const unmappedIds = new Set(plan2.unmappedIssues.map((u) => u.issueId));
    assert.equal(plan2.unmappedIssues.length, 7, "the 7 former child issues surface as stale/leftover (FR-010)");
    for (const id of childIssueIds) assert.ok(unmappedIds.has(id), "every former child issue is reported, never guessed away");

    const mark2 = callsMark(w);
    const applied2 = await engine2.applySyncPlan(plan2, gates(w, plan2));
    assert.equal(applied2.status, "applied");
    assert.equal(
      callsOf(w, "createIssue", mark2).length,
      0,
      "the fold creates nothing",
    );
    assert.equal(callsOf(w, "archiveIssue", mark2).length, 0, "zero auto-deletion (FR-010)");
    const updates = callsOf(w, "updateIssue", mark2);
    assert.equal(updates.length, 2, "the two parent descriptions fold back");
    for (const [title, expected] of Object.entries(flatBodies)) {
      const issue = [...w.fake.world.issues.values()].find((i) => i.title === title)!;
      assert.equal(issue.description, expected.body, `${title}: folded body is BYTE-EQUAL to the flat baseline`);
      assert.ok(issue.description.includes(expected.anchor), `${title}: sections ride verbatim`);
    }

    // ── Phase 3: reconfigure to 2 — durable anchors re-match the SAME issues ─────────
    setCap(w, 2);
    const engine3 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan3 = await engine3.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    assert.equal(plan3.entries.length, 9, "the seven children are tasks again");
    const remapped = plan3.entries.filter((e) => e.match !== undefined && childIssueIds.has(e.match.issueId));
    assert.equal(remapped.length, 7, "all seven children re-pair to their durable issues (SC-005)");
    assert.ok(
      remapped.every((e) => e.decision !== "create"),
      "re-matched children never carry a create decision — no re-creation",
    );
    assert.equal(plan3.unmappedIssues.length, 0);

    const mark3 = callsMark(w);
    const applied3 = await engine3.applySyncPlan(plan3, gates(w, plan3));
    assert.equal(applied3.status, "applied");
    assert.equal(callsOf(w, "createIssue", mark3).length, 0, "zero re-creation through the toggle back");
    assert.equal(w.fake.world.issues.size, 9, "still exactly nine issues in the tracker");
    for (const title of CHILD_TITLES) {
      const issue = [...w.fake.world.issues.values()].find((i) => i.title === title)!;
      assert.ok(issue.description.startsWith("### Subtask T"), `${title}: child body is back on the SAME issue`);
    }

    // ── Phase 4: full sync is a fixpoint again ───────────────────────────────────────
    const engine4 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan4 = await engine4.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(
      plan4.entries.filter((e) => e.decision === "create" || e.decision === "update" || e.decision === "conflict"),
      [],
      "the toggle round-trip converges to zero pending actions",
    );
    assert.equal(plan4.unmappedIssues.length, 0);
  } finally {
    await w.dispose();
  }
});
