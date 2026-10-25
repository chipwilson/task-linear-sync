/**
 * T031 [US2] — integrity-abort unit tests (spec US2 AC2 verbatim): "more than one issue
 * carrying the same task UUID, WHEN matching runs, THEN the run aborts with a hard
 * integrity failure and no changes"; 001 R5 c3: "THE System SHALL abort the run, apply
 * no changes, and report the task UUID and the identifiers of all conflicting issues."
 * Both collision shapes from contracts/candidate-projection.md §Integrity (case a across
 * issues; case b contradictory anchors on one issue). "No changes" is structural: the
 * pure projection THROWS, emitting no MatchingResult — and the abort is
 * scoring-independent, so it "cannot be sidestepped by configuration".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { AttachmentView, IssueView } from "task-linear-sync/ports";
import { DurableIdentityCollisionError, projectCandidates } from "task-linear-sync/matching";
import { defaultConfig, readJsonFixture } from "../helpers/matching-factory.js";

const config = defaultConfig();

interface IntegrityFixture {
  readonly issues: IssueView[];
  readonly attachmentsByIssue: Record<string, AttachmentView[]>;
  readonly expected: {
    readonly taskUuid: string;
    readonly issueIds: string[];
    readonly smaller?: string;
    readonly larger?: string;
    readonly other?: string;
  };
}

const project = (fixture: IntegrityFixture) =>
  projectCandidates({
    issues: fixture.issues,
    attachmentsByIssue: fixture.attachmentsByIssue,
    config,
  });

test("matching integrity case a: duplicate task UUID across issues aborts with every conflicting issue id sorted", () => {
  const fixture = readJsonFixture<IntegrityFixture>("matching/dup-uuid/case-a.json");
  assert.throws(
    () => project(fixture),
    (error: unknown) => {
      assert.ok(error instanceof DurableIdentityCollisionError, "typed integrity abort surface");
      assert.equal(error.taskUuid, fixture.expected.taskUuid);
      assert.deepEqual([...error.issueIds], [...fixture.expected.issueIds].sort());
      return true;
    },
  );
});

test("matching integrity case a: the abort names the lexicographically-smallest offending taskUuid first", () => {
  const fixture = readJsonFixture<IntegrityFixture>("matching/dup-uuid/case-a.json");
  try {
    project(fixture);
    assert.fail("expected DurableIdentityCollisionError");
  } catch (error) {
    assert.ok(error instanceof DurableIdentityCollisionError);
    assert.equal(error.taskUuid, fixture.expected.smaller);
    assert.notEqual(error.taskUuid, fixture.expected.larger);
    // The named group carries ALL of its conflicting issue ids, ascending.
    assert.deepEqual([...error.issueIds], ["i-201", "i-202"]);
  }
});

test("matching integrity case b: contradictory anchors on ONE issue abort on the smallest offending taskUuid", () => {
  const fixture = readJsonFixture<IntegrityFixture>("matching/dup-uuid/case-b.json");
  assert.throws(
    () => project(fixture),
    (error: unknown) => {
      assert.ok(error instanceof DurableIdentityCollisionError);
      assert.equal(error.taskUuid, fixture.expected.taskUuid, "lexicographically-smallest of the two anchors");
      assert.ok(error.taskUuid < fixture.expected.other!, "smallest offending taskUuid first");
      assert.deepEqual([...error.issueIds], ["i-301"], "conflict set names the contradictory issue");
      return true;
    },
  );
});

test("matching integrity: the abort fires before any scoring — no MatchingResult exists to inspect", () => {
  const fixture = readJsonFixture<IntegrityFixture>("matching/dup-uuid/case-a.json");
  // "cannot be sidestepped by configuration": every other matching-slice setting is valid;
  // the scan is structural to projection, which runs before matchAllTasks consumes it.
  const alternateConfig = loadConfig({ overrides: { minimumMatchMargin: 42 } });
  assert.throws(
    () =>
      projectCandidates({
        issues: fixture.issues,
        attachmentsByIssue: fixture.attachmentsByIssue,
        config: alternateConfig,
      }),
    DurableIdentityCollisionError,
  );
  let projected: unknown = "not called";
  try {
    projected = project(fixture); // throws ⇒ `projected` never gets a value
  } catch (error) {
    assert.ok(error instanceof DurableIdentityCollisionError);
  }
  assert.equal(projected, "not called", "no candidate list, hence no MatchingResult — 'no changes' holds");
});

test("matching integrity: unique durable UUIDs across issues project without aborting", () => {
  const fixture = readJsonFixture<IntegrityFixture>("matching/moved/corpus.json");
  const candidates = project(fixture); // three distinct anchors — integrity holds
  const anchorsByIssue = new Map(
    candidates.map((c) => [c.issueId, c.durableTaskUuid ?? null]),
  );
  assert.equal(anchorsByIssue.get("i-101"), "0f1e2d3c-4b5a-4978-8675-4321fedcb201");
  assert.equal(anchorsByIssue.get("i-102"), null, "i-102 carries no anchor (decoy)");
  assert.equal(anchorsByIssue.get("i-103"), "0f1e2d3c-4b5a-4978-8675-4321fedcb202");
  assert.equal(anchorsByIssue.get("i-104"), "0f1e2d3c-4b5a-4978-8675-4321fedcb203");
});
