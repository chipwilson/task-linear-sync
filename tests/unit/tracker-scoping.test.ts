/**
 * T025 [US1] — per-team scoping unit tests (research R6; FR-001 verbatim): inclusion is
 * "belongs to a configured team AND one of that team's configured projects AND are not in an
 * ignored state type (default: canceled, duplicate)". Filters are built PER TEAM — "Per-team
 * scoping never leaks: project/state filters are evaluated per team" — never a global union;
 * the client-side guard re-checks every row (belt-and-braces); `pageSize` clamps 1..250 with
 * the `page-size-clamped` diagnostic naming the config KEY only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildIssuesFilterVariables,
  clampPageSize,
  issueInScope,
  PLATFORM_CONNECTION_MAX,
  type IssueView,
  type TrackerDiagnostic,
} from "task-linear-sync/tracker";

const row = (over: Partial<IssueView> = {}): IssueView => ({
  id: "i1",
  key: "ACM-1",
  teamKey: "acme-team",
  projectId: "prj-alpha",
  title: "t",
  description: "d",
  stateType: "unstarted",
  updatedAt: "2026-10-01T00:00:00.000Z",
  archived: false,
  ...over,
});

const acmeProjects = new Set(["prj-alpha", "prj-beta"]);
const ignored = new Set(["canceled", "duplicate"]);

test("scoping: inclusion = team AND project AND not-ignored-state (all four negatives)", () => {
  assert.equal(issueInScope(row(), "acme-team", acmeProjects, ignored), true);
  assert.equal(issueInScope(row(), "globex-team", new Set(["prj-main"]), ignored), false, "not a configured team");
  assert.equal(issueInScope(row({ projectId: "prj-foreign" }), "acme-team", acmeProjects, ignored), false, "foreign project");
  assert.equal(issueInScope(row({ stateType: "canceled" }), "acme-team", acmeProjects, ignored), false, "ignored state canceled");
  assert.equal(issueInScope(row({ stateType: "duplicate" }), "acme-team", acmeProjects, ignored), false, "ignored state duplicate");
  assert.equal(issueInScope(row({ stateType: "started" }), "acme-team", acmeProjects, ignored), true, "non-ignored states pass");
});

test("scoping: per-team filter construction — never a global project/state union", () => {
  const acme = buildIssuesFilterVariables("acme-team", ["prj-alpha"], ["canceled", "duplicate"]);
  const globex = buildIssuesFilterVariables("globex-team", ["prj-main"], ["canceled"]);
  assert.deepEqual(acme, { teamKey: "acme-team", projectIds: ["prj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] });
  assert.deepEqual(globex, { teamKey: "globex-team", projectIds: ["prj-main"], ignoredStateTypes: ["canceled"] });
  // Per-team isolation: globex's filter carries ONLY globex's projects — an acme identity can
  // never satisfy it, so a cross-team row is excluded at BOTH layers, not absorbed by a union.
  assert.equal(globex.projectIds.includes("prj-alpha"), false);
  assert.equal(issueInScope(row({ teamKey: "globex-team", projectId: "prj-alpha" }), "globex-team", new Set(["prj-main"]), new Set()), false, "cross-team trap: team B row wearing team A project is rejected by team B's filter");
  assert.equal(issueInScope(row({ teamKey: "globex-team", projectId: "prj-alpha" }), "acme-team", acmeProjects, new Set()), false, "…and by team A's filter too (it is not an acme row)");
});

test("scoping: pageSize clamp 1..250 with page-size-clamped diagnostic naming the config key only", () => {
  const notes: TrackerDiagnostic[] = [];
  const report = (d: TrackerDiagnostic): void => void notes.push(d);
  assert.equal(clampPageSize(100, report), 100, "in range: untouched");
  assert.equal(clampPageSize(1, report), 1);
  assert.equal(clampPageSize(PLATFORM_CONNECTION_MAX, report), 250);
  assert.equal(clampPageSize(99.7, report), 99, "fractional sizes floor down (integer first)");
  assert.equal(notes.length, 0, "no diagnostics for in-range values");

  assert.equal(clampPageSize(251, report), 250);
  assert.equal(clampPageSize(100_000, report), 250);
  assert.equal(clampPageSize(0, report), 1);
  assert.equal(clampPageSize(-5, report), 1);
  assert.equal(clampPageSize(Number.NaN, report), 1);
  assert.equal(clampPageSize(Number.POSITIVE_INFINITY, report), 250, "infinite clamps to the ceiling");
  assert.equal(notes.length, 6, "every clamp reported exactly one diagnostic");
  for (const note of notes) {
    assert.equal(note.code, "page-size-clamped");
    assert.match(note.message, /pageSize/, "names the config key");
    assert.doesNotMatch(note.message, /100000|251|-5|NaN/, "names the key, never the offending value");
  }
});

test("scoping: the guard is the same shared function the fake uses (belt-and-braces, one implementation)", async () => {
  const core = await import("task-linear-sync/tracker");
  const testing = await import("task-linear-sync/tracker/testing");
  assert.strictEqual(core.issueInScope, testing.issueInScope, "shared module — not a re-implementation");
});
