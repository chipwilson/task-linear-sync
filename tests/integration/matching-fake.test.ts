/**
 * T022 [US1] — integration test over the fake port (research R8). Drives
 * `projectCandidates` from `listIssues`/`listAttachments` reads through
 * `tests/helpers/matching-linear-fake.ts` (fixtures under
 * `tests/fixtures/matching/fake-pipeline/`); asserts projection parity with direct
 * fixtures; asserts ZERO mutating `LinearPort` calls recorded on the entire
 * 006-reachable path (constitution I posture; contracts/matching-api.md invariant 7);
 * and pins the fake's frozen-interface conformance at compile time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { AttachmentView, IssueScope, IssueView, LinearPort } from "task-linear-sync/ports";
import { matchAllTasks, projectCandidates } from "task-linear-sync/matching";
import { defaultConfig, makeTask, readJsonFixture } from "../helpers/matching-factory.js";
import { MUTATING_PORT_METHODS, makeMatchingLinearFake } from "../helpers/matching-linear-fake.js";

interface PipelineFixture {
  readonly issues: IssueView[];
  readonly attachmentsByIssue: Record<string, AttachmentView[]>;
  readonly expectedCandidates: Array<Record<string, unknown>>;
}

const fixture = readJsonFixture<PipelineFixture>("matching/fake-pipeline/pipeline.json");
const config = defaultConfig();

/** Compile-time frozen-interface conformance (research R8): `LinearPort` assignment. */
const port: LinearPort = makeMatchingLinearFake({
  issues: fixture.issues,
  attachmentsByIssue: fixture.attachmentsByIssue,
});
void port;

async function readViaFake(): Promise<{ issues: IssueView[]; attachmentsByIssue: Record<string, AttachmentView[]> }> {
  const fake = makeMatchingLinearFake({
    issues: fixture.issues,
    attachmentsByIssue: fixture.attachmentsByIssue,
  });
  const scope: IssueScope = {
    teamKeys: ["acme-team"],
    perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] } },
    pageSize: 100,
  };
  const issues: IssueView[] = [];
  for await (const issue of fake.listIssues(scope)) issues.push(issue);
  const attachmentsByIssue: Record<string, AttachmentView[]> = {};
  for (const issue of issues) {
    const collected: AttachmentView[] = [];
    let cursor: string | null = null;
    do {
      const page = await fake.listAttachments(issue.id, cursor);
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    attachmentsByIssue[issue.id] = collected;
  }
  // Identity lookup surface, exercised for shape conformance.
  await fake.discoverMetadata(["acme-team"]);
  await fake.findIssuesByAttachmentUrl("https://sync.example.invalid/task-linear-sync/00000000-0000-4000-8000-000000000000");
  await fake.getAttachmentByUrl("https://sync.example.invalid/task-linear-sync/00000000-0000-4000-8000-000000000000");
  return { issues, attachmentsByIssue };
}

test("matching fake pipeline: projection over fake-port reads equals the direct fixture projection", async () => {
  const { issues, attachmentsByIssue } = await readViaFake();
  const viaFake = projectCandidates({ issues, attachmentsByIssue, config });
  const direct = projectCandidates({
    issues: fixture.issues,
    attachmentsByIssue: fixture.attachmentsByIssue,
    config,
  });
  assert.deepEqual(viaFake, direct, "fake-fed data projects identically to fixtures");
  assert.deepEqual(
    viaFake,
    fixture.expectedCandidates,
    "fixture expectations: only the page-0 canonical attachment carries identity",
  );
});

test("matching fake pipeline: identity rules — continuation pages, description uuids, foreign keys never match", async () => {
  const { issues, attachmentsByIssue } = await readViaFake();
  const byId = new Map(projectCandidates({ issues, attachmentsByIssue, config }).map((c) => [c.issueId, c]));
  assert.ok(byId.get("i-401")?.durableTaskUuid, "i-401 page-0 canonical payload carries identity");
  assert.equal(byId.get("i-401")?.localTaskId, "Task 2.1", "framework context flows through the payload");
  assert.equal(byId.get("i-402")?.durableTaskUuid, undefined, "continuation-only + description-embedded uuid: never identity");
  assert.equal(byId.get("i-402")?.frameworkId, undefined);
  assert.equal(byId.get("i-403")?.durableTaskUuid, undefined, "malformed page-0 payload ⇒ non-durable");
});

test("matching fake pipeline: ZERO mutating LinearPort calls on the entire 006-reachable path (invariant 7)", async () => {
  const fake = makeMatchingLinearFake({
    issues: fixture.issues,
    attachmentsByIssue: fixture.attachmentsByIssue,
  });
  const scope: IssueScope = {
    teamKeys: ["acme-team"],
    perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: [] } },
    pageSize: 100,
  };
  const issues: IssueView[] = [];
  for await (const issue of fake.listIssues(scope)) issues.push(issue);
  const attachmentsByIssue: Record<string, AttachmentView[]> = {};
  for (const issue of issues) {
    attachmentsByIssue[issue.id] = [...(await fake.listAttachments(issue.id)).items];
  }
  const candidates = projectCandidates({ issues, attachmentsByIssue, config });
  const durable = candidates.find((c) => c.durableTaskUuid !== undefined)!;
  const task = makeTask({
    stableUuid: durable.durableTaskUuid!,
    title: "Rotate signing keys",
    filePath: "specs/demo-feature/tasks.md",
  });
  const result = matchAllTasks([{ task }], candidates, config);
  assert.equal(result.matches.length, 1, "durable pair matched through the fake-fed pipeline");
  assert.equal(result.matches[0]!.durableIdentity, true);

  for (const method of MUTATING_PORT_METHODS) {
    assert.deepEqual(fake.callsTo(method), [], `mutating port method '${method}' must never be called by 006 paths`);
  }
  assert.deepEqual(fake.mutatingCalls(), [], "constitution I posture: zero tracker mutations");
  assert.ok(fake.calls.length > 0, "read side WAS exercised (so the zero-mutation proof is meaningful)");
});

test("matching fake pipeline: fake yields deterministic page ordering across runs", async () => {
  const first = await readViaFake();
  const second = await readViaFake();
  assert.deepEqual(first, second);
});
