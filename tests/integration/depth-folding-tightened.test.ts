/**
 * T031 [P] [US3] — Tightened-cap integration scenario over the shared engine harness
 * (feature 020 US3 AC1/AC2; contracts/depth-folding.md rules C7/C8; SC-003).
 *
 * World `depth-folding-tightened`: a repository whose depth-2 child (local id `1.1.1`,
 * issue ACME-3) was synced BEFORE the cap tightened — page-0 canonical attachment anchor
 * in `world.json`, matching checkpoints seeded programmatically via `seedCheckpoints`
 * (precedent: `engine-rollback.test.ts` + the worlds' `checkpoint-seed.json`). The world
 * config now pins `maxTaskIssueDepth: 1`; a replan must treat the orphaned child as
 * report-only.
 *
 * Cells (all through the frozen `SyncEngine` seam, fake port, fixed clock, placeholders
 * only — constitution VI / Principle III):
 *  (a) the child's file line is not touched — the plan carries no entry for the child
 *      task, neither report artifact mentions the child task uuid or issue id, no
 *      `updateIssue` (or any mutating call) ever targets the child issue, and the task
 *      file stays byte-identical across the plan;
 *  (b) the child issue appears EXACTLY ONCE in the plan's unmapped-issue section
 *      (report-only — C7, US3 AC1), with the parent's issue absent from it;
 *  (c) zero archive/delete operations — SC-003: the fake-port call log contains no
 *      `archiveIssue` and no mutating port method at all, and the child issue survives
 *      unarchived in the tracker;
 *  (d) US3 AC2 — the surviving parent line carries the visible `[ACME-7]` token; its
 *      match against the seeded issue stays high-confidence with the `issue-ref-exact`
 *      signal and durable identity (identity comes from token + local id + anchor, not
 *      from ordinals, which the fold shifts).
 *
 * Header task IDs: T031.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "task-linear-sync/config";
import type { Checkpoint, Plan } from "task-linear-sync/domain";
import { builtInAdapters } from "task-linear-sync/discovery";
import { derivePlanReportRunId } from "task-linear-sync/engine";
import { parseTaskFile, type TaskFileAdapter } from "task-linear-sync/parsing";
import type { ConfigOverrides } from "task-linear-sync/config";

import {
  attachEngine,
  buildWorld,
  callsOf,
  fixtureFile,
  mutationCalls,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────────────────── constants

/** The guarded task file, repo-relative POSIX. */
const TASKS_REL = "specs/sync-demo/tasks.md";

/** Stable identities of the two fixture tasks (local ids 1.1 / 1.1.1). */
const PARENT_UUID = "dd837e71-fa46-5c11-8bff-31fb37eb5a8e";
const CHILD_UUID = "70c4cdec-4df4-5dbe-8cfb-40df2949555e";

/** World seed issue ids (ACME-7 parent / ACME-3 previously-synced child). */
function issueIdForKey(world: EngineWorld, key: string): string {
  const seed = JSON.parse(readFileSync(fixtureFile(world, "world.json"), "utf8")) as {
    issues?: ReadonlyArray<{ readonly id: string; readonly key: string }>;
  };
  const issue = (seed.issues ?? []).find((i) => i.key === key);
  assert.ok(issue, `world seed for issue key ${key}`);
  return issue!.id;
}

/** Parse the temp-repo task file at an explicit cap (identity/fold ground truth). */
function parseWorldTasks(world: EngineWorld, cap: number) {
  const content = readFileSync(join(world.repositoryRoot, TASKS_REL), "utf8");
  const config = loadConfig({ overrides: { ...(world.config as ConfigOverrides), maxTaskIssueDepth: cap } });
  return parseTaskFile(TASKS_REL, content, builtInAdapters["generic"] as unknown as TaskFileAdapter, config);
}

// ──────────────────────────────────────────────────────────────────────────── test

test("depth-folding-tightened — cap-1 replan over a previously synced child: report-only orphan, zero archive, token match stays high (C7/C8, SC-003, US3 AC1/AC2)", async () => {
  const w = await buildWorld("depth-folding-tightened");
  try {
    const childIssueId = issueIdForKey(w, "ACME-3");
    const parentIssueId = issueIdForKey(w, "ACME-7");

    // ── Identity ground truth: the checkpoint seed and the attachment anchors are keyed
    // by the SAME Stable_UUIDs the parser derives for these tasks (no stale literals).
    const at64 = parseWorldTasks(w, 64);
    const parentTask = at64.file.tasks.find((t) => t.localTaskId === "1.1");
    const childTask = at64.file.tasks.find((t) => t.localTaskId === "1.1.1");
    assert.ok(parentTask && childTask, "both tasks exist pre-tightening at cap 64");
    assert.equal(parentTask!.stableUuid, PARENT_UUID, "parent Stable_UUID");
    assert.equal(childTask!.stableUuid, CHILD_UUID, "child Stable_UUID");
    assert.equal(childTask!.parentUuid, PARENT_UUID, "child is nested under the parent (depth 2)");
    assert.deepEqual(parentTask!.issueRef, { key: "ACME", number: 7 }, "parent line carries the visible [ACME-7] token");
    assert.equal(childTask!.issueRef, undefined, "child line carries no issue-reference token");
    const worldDoc = JSON.parse(readFileSync(fixtureFile(w, "world.json"), "utf8")) as {
      attachments?: ReadonlyArray<{ readonly metadata: Record<string, unknown> }>;
    };
    const anchorUuids = new Set(
      (worldDoc.attachments ?? []).map((a) => String(a.metadata["taskUuid"])),
    );
    assert.ok(anchorUuids.has(CHILD_UUID), "world attachment anchors the child taskUuid (previously synced)");

    // ── Fold reality at the tightened cap BEFORE the engine even runs (C3/C5/C4):
    const atCap1 = parseWorldTasks(w, 1);
    assert.deepEqual(
      atCap1.file.tasks.map((t) => t.localTaskId),
      ["1.1"],
      "cap 1: only the parent survives",
    );
    assert.deepEqual(
      atCap1.exclusions.filter((e) => e.reason === "depth-folded"),
      [{ lineNumber: 6, kind: "checklist", reason: "depth-folded", text: "  - [ ] 1.1.1: Child task previously synced" }],
      "the child line folds verbatim into the parent body and earns exactly one ascending depth-folded exclusion",
    );

    // ── Pre-tightening sync state (checkpoints seeded programmatically — rollback-world
    // precedent): both tasks were fully synced at cap 2 ⇒ sync-mode reality.
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    assert.deepEqual(
      Object.keys(seed).sort(),
      [CHILD_UUID, PARENT_UUID].sort(),
      "checkpoint seed covers parent and previously-synced child",
    );
    await seedCheckpoints(w, seed);

    const tasksBefore = readFileSync(join(w.repositoryRoot, TASKS_REL));

    // ── Replan at the tightened cap.
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan: Plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // (a) The child's file line is not touched: no plan entry, no report entry, no
    // update ever targets the child issue, and the repo file stays byte-identical.
    assert.equal(plan.entries.length, 1, "exactly one surviving plan entry (the folded child is invisible downstream — C8)");
    assert.equal(plan.entries[0]!.taskUuid, PARENT_UUID, "the only entry is the parent");
    assert.ok(
      plan.entries.every((e) => e.taskUuid !== CHILD_UUID),
      "no plan entry for the folded child task",
    );
    assert.ok(
      plan.entries.every((e) => e.match?.issueId !== childIssueId),
      "no surviving task matches (and therefore would update) the child issue",
    );
    const runId = derivePlanReportRunId(plan.planId, w.clock);
    const reportJsonPath = join(w.stateDir, "reports", runId, "report.json");
    const reportMdPath = join(w.stateDir, "reports", runId, "report.md");
    assert.ok(existsSync(reportJsonPath) && existsSync(reportMdPath), "paired report artifacts exist");
    // No REPORT TASK ENTRY for the child: the grouped entries (both artifacts) stay free
    // of the child's task uuid; in the JSON artifact no grouped entry references its
    // issue either — the child id may legitimately appear ONLY in the unmapped section.
    const report = JSON.parse(readFileSync(reportJsonPath, "utf8")) as {
      groups: ReadonlyArray<{ entries: ReadonlyArray<Record<string, unknown>> }>;
      unmapped: ReadonlyArray<{ issueId: string }>;
    };
    const groupedEntries = report.groups.flatMap((g) => g.entries);
    for (const artifact of [reportJsonPath, reportMdPath]) {
      assert.ok(!readFileSync(artifact, "utf8").includes(CHILD_UUID), `${artifact}: the child task uuid appears nowhere — no task entry exists for it`);
    }
    // No grouped entry TARGETS the child issue (its `match` never resolves to it); the
    // id may legitimately appear inside the parent entry's `alternatives` — that is the
    // scoring record of a rejected competitor, never a mutation target.
    assert.ok(
      groupedEntries.every((e) => (e["match"] as { issueId?: string } | undefined)?.issueId !== childIssueId),
      "report.json: no grouped task entry matches/targets the child issue",
    );
    assert.equal(groupedEntries.length, 1, "report carries exactly one task entry (the parent)");
    assert.equal(report.unmapped.filter((u) => u.issueId === childIssueId).length, 1, "report.json unmapped section lists the child issue exactly once");
    assert.ok(
      readFileSync(join(w.repositoryRoot, TASKS_REL)).equals(tasksBefore),
      "plan is read-only: the task file (including the folded child line) is byte-identical",
    );
    const childLine = readFileSync(join(w.repositoryRoot, TASKS_REL), "utf8").split("\n")[5] ?? "";
    assert.equal(childLine, "  - [ ] 1.1.1: Child task previously synced", "the child line keeps its original text — no reference token was assigned to a folded line (I4)");

    // (d) US3 AC2 — the token-bearing parent re-matches at high confidence. The seed
    // issue number (7) is far from the surviving task's ordinal position (1): the match
    // rides the `[ACME-7]` token + local id + durable anchor, exactly what the toggle
    // guidance promises for tasks carrying visible reference tokens.
    const parentEntry = plan.entries[0]!;
    assert.equal(parentEntry.confidence, "high", "parent match stays high-confidence at the tightened cap");
    assert.ok(parentEntry.match, "parent entry carries its match");
    assert.equal(parentEntry.match!.issueId, parentIssueId, "parent matches ACME-7 — the token's number, not an ordinal");
    assert.equal(parentEntry.match!.durableIdentity, true, "durable-identity anchor honored");
    assert.ok(parentEntry.match!.reasons.includes("issue-ref-exact"), "issue-ref-exact signal awarded");
    assert.ok(parentEntry.match!.reasons.includes("local-task-id"), "local-task-id signal awarded");
    assert.ok(parentEntry.match!.reasons.includes("durable-uuid"), "durable-uuid signal awarded");
    assert.ok(parentEntry.score > 0 && parentEntry.margin > 0, "high-confidence match carries score and margin");
    assert.ok(parentEntry.reasons.includes("mode:sync"), "checkpoint reality selects sync mode");
    assert.equal(parentEntry.decision, "no-change", "the synced parent is unchanged — the fold alone triggers no mutation");

    // (b) The orphaned child issue surfaces EXACTLY ONCE in the unmapped-issue section.
    assert.equal(plan.unmappedIssues.length, 1, "exactly one unmapped issue");
    assert.equal(plan.unmappedIssues[0]!.issueId, childIssueId, "the unmapped issue is the previously-synced child (report-only — C7, US3 AC1)");
    assert.equal(plan.unmappedIssues.filter((u) => u.issueId === childIssueId).length, 1, "the child issue appears exactly once — never duplicated");
    assert.ok(!plan.unmappedIssues.some((u) => u.issueId === parentIssueId), "the mapped parent issue is NOT unmapped");
    assert.ok(plan.unmappedIssues[0]!.title.includes("Child task previously synced"), "screened title identifies the child");

    // (c) SC-003 — zero archive/delete vocabulary executed, nothing mutates at all.
    assert.equal(callsOf(w, "archiveIssue").length, 0, "zero archiveIssue calls");
    assert.ok(
      w.calls.every((c) => !/archive|delete/i.test(c.method)),
      `call log names no archive/delete method: ${w.calls.map((c) => c.method).join(",")}`,
    );
    assert.equal(mutationCalls(w).length, 0, "zero mutating port calls during the replan (plan is read-only by contract)");
    assert.ok(
      callsOf(w, "updateIssue").every((c) => c.args[0] !== childIssueId),
      "the child issue is never targeted by an update",
    );
    const childAfter = await w.port.getIssue(childIssueId);
    assert.ok(childAfter !== null, "the child issue still exists in the tracker (never deleted)");
    assert.equal(childAfter!.archived, false, "the child issue is not archived");

    // The checkpoint store is untouched too — tightening never rewrites sync state.
    const storeAfter = await readCheckpointStore(w);
    assert.deepEqual(storeAfter, { schemaVersion: 1, checkpoints: seed }, "checkpoint store byte-stable across the cap-1 replan");

    assert.equal(plan.lowConfidencePresent, false, "no low-confidence gate input leaks from folded lines (C8)");
  } finally {
    await w.dispose();
  }
});
