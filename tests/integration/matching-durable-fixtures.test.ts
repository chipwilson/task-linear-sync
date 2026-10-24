/**
 * T032 [US2] — relocation-survival integration over `tests/fixtures/matching/moved/`
 * through the fake-port pipeline (quickstart US2 #4 + spec US2 Independent Test):
 * "issues relocated across teams/projects/frameworks and renamed still pair 1:1 with
 * their tasks (100% pairing survival), zero gating exclusions for durable candidates,
 * and results byte-identical across re-runs (Principle IV)."
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { AttachmentView, IssueScope, IssueView } from "task-linear-sync/ports";
import type { RoutingResolution, Task } from "task-linear-sync/domain";
import {
  applyGate,
  matchAllTasks,
  projectCandidates,
  resolveWeights,
  scorePair,
  serializeMatchingResult,
} from "task-linear-sync/matching";
import { defaultConfig, makeTask, readJsonFixture } from "../helpers/matching-factory.js";
import { makeMatchingLinearFake } from "../helpers/matching-linear-fake.js";

interface MovedFixture {
  readonly tasks: ReadonlyArray<{
    readonly name: string;
    readonly task: {
      readonly stableUuid: string;
      readonly title: string;
      readonly frameworkId: string;
      readonly featureName?: string;
      readonly filePath?: string;
    };
    readonly routing: RoutingResolution;
  }>;
  readonly issues: IssueView[];
  readonly attachmentsByIssue: Record<string, AttachmentView[]>;
}

const fixture = readJsonFixture<MovedFixture>("matching/moved/corpus.json");
const config = defaultConfig();

/** Scan surface spanning BOTH the pre-move containers the routed tasks still name AND
 * the destination containers (007 scans the team's projects; durable identity survives
 * regardless of which project the issue moved into). */
const scope: IssueScope = {
  teamKeys: ["acme-team", "glob-team"],
  perTeam: {
    "acme-team": { projects: ["proj-alpha", "proj-beta"], ignoredStateTypes: [] },
    "glob-team": { projects: ["proj-gamma"], ignoredStateTypes: [] },
  },
  pageSize: 100,
};

async function readViaFake(): Promise<{ issues: IssueView[]; attachmentsByIssue: Record<string, AttachmentView[]> }> {
  const fake = makeMatchingLinearFake({ issues: fixture.issues, attachmentsByIssue: fixture.attachmentsByIssue });
  const issues: IssueView[] = [];
  for await (const issue of fake.listIssues(scope)) issues.push(issue);
  const attachmentsByIssue: Record<string, AttachmentView[]> = {};
  for (const issue of issues) {
    attachmentsByIssue[issue.id] = [...(await fake.listAttachments(issue.id)).items];
  }
  return { issues, attachmentsByIssue };
}

function taskInputs() {
  return fixture.tasks.map((entry) => ({
    task: makeTask({
      stableUuid: entry.task.stableUuid,
      title: entry.task.title,
      frameworkId: entry.task.frameworkId as Task["frameworkId"],
      ...(entry.task.featureName !== undefined ? { featureName: entry.task.featureName } : {}),
      ...(entry.task.filePath !== undefined ? { filePath: entry.task.filePath } : {}),
    }),
    routing: entry.routing,
  }));
}

test("matching moved fixtures: 100% pairing survival across moves AND renames", async () => {
  const { issues, attachmentsByIssue } = await readViaFake();
  const candidates = projectCandidates({ issues, attachmentsByIssue, config });
  const result = matchAllTasks(taskInputs(), candidates, config);

  const byTask = new Map(result.matches.map((m) => [m.taskUuid, m]));
  // spec US2 Independent Test: every relocated task keeps ITS issue (1:1, truth-based).
  const expectedPairs: ReadonlyArray<[string, string]> = [
    ["0f1e2d3c-4b5a-4978-8675-4321fedcb201", "i-101"], // team+project+framework move + rename
    ["0f1e2d3c-4b5a-4978-8675-4321fedcb202", "i-103"], // project-only move
    ["0f1e2d3c-4b5a-4978-8675-4321fedcb203", "i-104"], // renamed in place
  ];
  assert.equal(result.matches.length, expectedPairs.length, "one-to-one full pairing");
  for (const [taskUuid, issueId] of expectedPairs) {
    const match = byTask.get(taskUuid);
    assert.ok(match, `${taskUuid} must still pair with ${issueId}`);
    assert.equal(match.issueId, issueId);
    assert.equal(match.durableIdentity, true, "the anchor, not the container, made the match");
    assert.equal(match.confidence, "high");
    assert.ok(!match.reasons.includes("ambiguous-margin"));
  }
  // The exact-title decoy stayed unmapped: the durable pair owns its task.
  assert.deepEqual([...result.unmappedIssues], ["i-102"]);
  assert.deepEqual(result.unresolved, [], "no task orphaned by the move");
});

test("matching moved fixtures: ZERO gating exclusions for durable candidates", async () => {
  const { issues, attachmentsByIssue } = await readViaFake();
  const candidates = projectCandidates({ issues, attachmentsByIssue, config });
  const weights = resolveWeights(config);
  const byId = new Map(candidates.map((c) => [c.issueId, c]));
  for (const entry of fixture.tasks) {
    const input = {
      task: makeTask({
        stableUuid: entry.task.stableUuid,
        title: entry.task.title,
        frameworkId: entry.task.frameworkId as Task["frameworkId"],
      }),
      routing: entry.routing,
    };
    for (const issueId of ["i-101", "i-103", "i-104"]) {
      const candidate = byId.get(issueId)!;
      if (candidate.durableTaskUuid === undefined) continue;
      const pair = applyGate(scorePair(input, candidate, weights), input, candidate, config.confidenceFloors.plausible);
      if (candidate.durableTaskUuid === entry.task.stableUuid) {
        assert.equal(pair.exclusion, undefined, `durable ${entry.name} vs ${issueId}: exclusion recorded`);
        assert.equal(pair.usable, true);
      }
    }
  }
});

test("matching moved fixtures: results byte-identical across re-runs (Principle IV)", async () => {
  const { issues, attachmentsByIssue } = await readViaFake();
  const candidates = projectCandidates({ issues, attachmentsByIssue, config });
  const run1 = serializeMatchingResult(matchAllTasks(taskInputs(), candidates, config));
  const run2 = serializeMatchingResult(matchAllTasks(taskInputs(), candidates, config));
  assert.equal(run1, run2);

  // Zero mutating port calls on the whole path (invariant 7 restated for US2 data).
  const fake = makeMatchingLinearFake({ issues: fixture.issues, attachmentsByIssue: fixture.attachmentsByIssue });
  for await (const issue of fake.listIssues(scope)) void issue;
  assert.deepEqual(fake.mutatingCalls(), []);
});
