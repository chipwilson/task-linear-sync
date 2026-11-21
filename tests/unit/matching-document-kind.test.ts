/**
 * T026 [022 US2] — document-kind tasks match on the durable anchor ONLY (spec: 022
 * FR-005/FR-011; contracts C4.1–C4.3, C5.1). A `kind: "document"` task without a
 * candidate carrying `durableTaskUuid === task.stable_uuid` scores ZERO on every
 * heuristic signal — title (all three forms), local-ID, issue-ref, and the
 * same-project/same-framework alignments — under EVERY threshold and band
 * configuration; heading/checklist-kind scoring is untouched (SC-005).
 *
 * @steps a: the durable anchor pairs a document task — its bypass survives foreign
 *          team/project gates (C4.2; 006 C3.x durable stance unchanged)
 *        b: every heuristic signal scores 0 for an unanchored document task that
 *          WOULD score as a heading task (control pair, same data)
 *        c: document tasks stay unmatched even under zero floors / zero margin
 *          (FR-011 is absolute); identical heading tasks still match
 *        d: an anchored document pair carries ONLY the durable contribution — the
 *          title signals are vetoed even beside an anchor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAllTasks, scorePair, resolveWeights } from "task-linear-sync/matching";
import type { MatchCandidate, TaskMatchInput } from "task-linear-sync/matching";
import { builtInDefaults as config } from "task-linear-sync/config";
import type { Task } from "task-linear-sync/domain";

const HEADING_UUID = "018B0000-0000-4000-8000-0000000000A1";

const task = (over: Partial<Task> = {}): Task => ({
  stableUuid: HEADING_UUID,
  kind: "heading",
  filePath: "kitty-specs/billing/tasks/wp01-billing.md",
  lineNumber: 1,
  frameworkId: "spec-kitty",
  title: "Billing Reword",
  childUuids: [],
  taskBody: { startLine: 1, endLine: 1 },
  unresolvedConflict: false,
  localTaskId: "WP01",
  featureName: "billing",
  ...over,
});

const docTask = (over: Partial<Task> = {}): Task => task({ kind: "document", ...over });

const input = (t: Task): TaskMatchInput => ({
  task: t,
  // Routed (not unassigned) so the 006 gates are live — durable must bypass them.
  routing: { teamKey: "KIT", project: "P1", defaulted: false },
});

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  issueId: "issue-1",
  issueKey: "KIT-7",
  teamKey: "KIT",
  projectRef: "P1",
  title: "Billing Reword",
  frameworkId: "spec-kitty",
  featureName: "billing",
  localTaskId: "WP01",
  ...over,
});

test("a: the durable anchor pairs a document task across foreign gates", () => {
  const anchored = candidate({
    durableTaskUuid: HEADING_UUID,
    teamKey: "OTHER",
    projectRef: "OTHER-P",
    title: "an unrelated issue title",
    localTaskId: undefined,
  });
  const result = matchAllTasks([input(docTask())], [anchored], config);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.issueId, "issue-1");
});

test("b: every heuristic signal scores 0 for an unanchored document task", () => {
  const weights = resolveWeights(config, {});
  const variants: Array<[string, Partial<MatchCandidate>]> = [
    ["title-exact + local-id + alignments", {}],
    ["title-contained", { title: "Billing Reword Sprint Plan", localTaskId: undefined }],
    ["title-fuzzy", { title: "Billing Rework Draft", localTaskId: undefined }],
    ["issue-ref / container only", { title: "unrelated", localTaskId: undefined }],
    ["anchor of ANOTHER task is not durable here", {
      durableTaskUuid: "018B0000-0000-4000-8000-00000000DEAD",
    }],
  ];
  for (const [label, over] of variants) {
    const c = candidate(over);
    const heading = scorePair(input(task()), c, weights);
    const doc = scorePair(input(docTask()), c, weights);
    // Control: the same data CAN score for a heading task (006 totals untouched).
    assert.ok(heading.total > 0, `control ${label}: heading scoring must stay alive`);
    assert.equal(doc.total, 0, `${label}: document kind must score 0 without the anchor`);
    assert.ok(
      doc.contributions.every((s) => s.points === 0),
      `${label}: no positive heuristic contribution for a document kind`,
    );
  }
});

test("c: document tasks stay unmatched under zero floors; headings still match", () => {
  const permissive = {
    ...structuredClone(config),
    confidenceFloors: { medium: 0, plausible: 0 },
    minimumMatchMargin: 1, // the minimum allowed — as permissive as config permits
  };
  const cands = [candidate(), candidate({ issueId: "issue-2", issueKey: "KIT-8" })];
  const docRun = matchAllTasks(
    [input(docTask()), input(docTask({ stableUuid: "018B0000-0000-4000-8000-0000000000A2", localTaskId: "WP02" }))],
    cands,
    permissive,
  );
  assert.deepEqual(docRun.matches, []);
  const headingRun = matchAllTasks(
    [input(task()), input(task({ stableUuid: "018B0000-0000-4000-8000-0000000000A2", localTaskId: "WP02" }))],
    cands,
    permissive,
  );
  assert.equal(headingRun.matches.length, 2);
});

test("d: an anchored document pair carries ONLY the durable contribution", () => {
  const weights = resolveWeights(config, {});
  const anchored = candidate({ durableTaskUuid: HEADING_UUID });
  const doc = scorePair(input(docTask()), anchored, weights);
  assert.deepEqual(
    doc.contributions.filter((s) => s.points > 0).map((s) => s.signal),
    ["durable-uuid"],
  );
  const heading = scorePair(input(task()), anchored, weights);
  assert.ok(
    heading.contributions.some((s) => s.points > 0 && s.signal === "title-exact"),
    "heading tasks keep the title signals beside an anchor",
  );
});
