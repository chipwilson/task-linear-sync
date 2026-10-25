/**
 * T008 [US1] — `resolveRouting` unit tests (contracts/routing-resolution.md § Normative
 * behavior; 005 FR-001/FR-002 ← 001 R4.1–R4.4; research R1/R7). Pure function, no tracker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRouting } from "../../src/routing/resolve.js";
import {
  defaultSlice,
  emptyMapNoDefaults,
  emptyMapWithDefaults,
  nestedSlice,
  tieSlice,
} from "../fixtures/routing-titles/routing-maps.js";
import { makeRoutingSlice } from "../fixtures/routing-titles/factories.js";

test("routing nested prefixes — longest character-length prefix selects team and project (FR-001 AC1)", () => {
  const res = resolveRouting("specs/api/auth/login.md", nestedSlice);
  assert.deepEqual(res, {
    teamKey: "acme-team",
    project: "proj-gamma",
    matchedPrefix: "specs/api/auth/",
    defaulted: false,
  });
  // A shallower path under the same map selects its own deepest match.
  assert.deepEqual(resolveRouting("specs/api/gateway.md", nestedSlice), {
    teamKey: "acme-team-b",
    project: "proj-beta",
    matchedPrefix: "specs/api/",
    defaulted: false,
  });
  assert.deepEqual(resolveRouting("specs/overview.md", nestedSlice), {
    teamKey: "acme-team",
    project: "proj-alpha",
    matchedPrefix: "specs/",
    defaulted: false,
  });
  // Repeated derivation over unchanged inputs is identical (constitution IV).
  assert.deepEqual(resolveRouting("specs/api/auth/login.md", nestedSlice), res);
});

test("routing tie — equal-length prefixes break first-by-map-order with recorded indication (FR-001 AC2)", () => {
  const first = resolveRouting("specs/both/tasks.md", tieSlice);
  assert.deepEqual(first, {
    teamKey: "acme-team",
    project: "proj-alpha",
    matchedPrefix: "specs/both/",
    defaulted: false,
    tieBreak: "first-by-map-order",
  });
  // Deterministic: identical selection on every re-run.
  assert.deepEqual(resolveRouting("specs/both/tasks.md", tieSlice), first);
  // Greatest length beats map order — the shorter first-listed `specs/` entry does NOT win.
  assert.equal(first.tieBreak, "first-by-map-order");
  assert.equal(first.matchedPrefix, "specs/both/");
  // Swapping the two tied entries flips the selection to the new first-by-order entry.
  const swapped = makeRoutingSlice({
    projectByPath: [
      { prefix: "specs/both/", teamKey: "acme-team-b", project: "proj-beta" },
      { prefix: "specs/both/", teamKey: "acme-team", project: "proj-alpha" },
    ],
  });
  assert.deepEqual(resolveRouting("specs/both/tasks.md", swapped), {
    teamKey: "acme-team-b",
    project: "proj-beta",
    matchedPrefix: "specs/both/",
    defaulted: false,
    tieBreak: "first-by-map-order",
  });
});

test("routing defaults — unmatched path falls back to configured default team and project (FR-002 AC3)", () => {
  const res = resolveRouting("docs/other.md", defaultSlice);
  assert.deepEqual(res, { teamKey: "acme-team", project: "proj-default", defaulted: true });
  // A matched path never defaults, even when defaults are configured.
  const matched = resolveRouting("specs/api/gateway.md", defaultSlice);
  assert.equal(matched.defaulted, false);
  assert.equal(matched.project, "proj-beta");
});

test("routing defaults — absent or empty routing map applies the default path to every task (FR-002)", () => {
  const paths = ["anything/at/all.md", "src/index.ts", "docs/x/y/z.md", ""];
  for (const filePath of paths) {
    assert.deepEqual(resolveRouting(filePath, emptyMapWithDefaults), {
      teamKey: "acme-team-b",
      project: "proj-beta",
      defaulted: true,
    });
  }
  // An all-empty-prefix map is treated like an empty map (only non-empty prefixes match).
  const emptyPrefixes = makeRoutingSlice({
    projectByPath: [{ prefix: "", teamKey: "acme-team", project: "proj-alpha" }],
    defaultTeamKey: "acme-team-b",
    defaultProject: "proj-beta",
  });
  assert.deepEqual(resolveRouting("anything.md", emptyPrefixes), {
    teamKey: "acme-team-b",
    project: "proj-beta",
    defaulted: true,
  });
});

test("routing unassigned — no match and no defaults leaves the task unassigned and processing continues (FR-002 AC4)", () => {
  const first = resolveRouting("nowhere/file.md", nestedSlice);
  assert.deepEqual(first, { teamKey: "", project: "", defaulted: false, unassigned: true });

  // A multi-unrouted corpus: every task resolves (none abort), each with the indication.
  const unrouted = ["nowhere/one.md", "docs/two.md", "random/three.md"].map((p) =>
    resolveRouting(p, emptyMapNoDefaults),
  );
  assert.equal(unrouted.length, 3, "processing did not terminate early");
  for (const res of unrouted) {
    assert.deepEqual(res, { teamKey: "", project: "", defaulted: false, unassigned: true });
  }

  // Partly-routed corpus: routed tasks unaffected, unrouted flagged, order preserved.
  const mixed = ["specs/api/gateway.md", "nowhere/x.md", "specs/overview.md"].map((p) =>
    resolveRouting(p, nestedSlice),
  );
  assert.equal(mixed[0]?.project, "proj-beta");
  assert.equal(mixed[1]?.unassigned, true);
  assert.equal(mixed[2]?.project, "proj-alpha");
});

test("routing purity — resolver consults only path and config; no hardcoded destinations (001 R4.6)", () => {
  // Same path under two different maps yields exactly the two different configured answers.
  const sliceA = makeRoutingSlice({
    projectByPath: [{ prefix: "specs/", teamKey: "acme-team", project: "proj-alpha" }],
    defaultTeamKey: "acme-team",
    defaultProject: "proj-alpha",
  });
  const sliceB = makeRoutingSlice({
    projectByPath: [{ prefix: "specs/", teamKey: "acme-team-b", project: "proj-beta" }],
    defaultTeamKey: "acme-team-b",
    defaultProject: "proj-beta",
  });
  assert.deepEqual(resolveRouting("specs/x.md", sliceA), {
    teamKey: "acme-team",
    project: "proj-alpha",
    matchedPrefix: "specs/",
    defaulted: false,
  });
  assert.deepEqual(resolveRouting("specs/x.md", sliceB), {
    teamKey: "acme-team-b",
    project: "proj-beta",
    matchedPrefix: "specs/",
    defaulted: false,
  });
});
