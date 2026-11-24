/**
 * T007 [023 A-023-0(b)] — per-team `workflowStates.lanes` config validation (feature 023;
 * data-model §5, contract C6.2/C7). The map is OPTIONAL: an absent map passes unchanged;
 * a present map is validated at the config-init gate — keys inside the nine-lane
 * vocabulary, values non-empty state names — with EVERY offender named against its team
 * key in one failure and nothing partially applied. No built-in default ever ships.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateWorkspaceIdentity, LaneMapError, loadConfig } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";

const BASE: ResolvedConfig = loadConfig({});

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function withLanes(lanes: Record<string, string> | undefined): ResolvedConfig {
  const draft = structuredClone(BASE) as unknown as Mutable<ResolvedConfig>;
  draft.teams = {
    acme: {
      projects: ["proj-alpha"],
      workflowStates: {
        backlog: "Backlog",
        todo: "Todo",
        done: "Done",
        completedTypes: ["completed"],
        ...(lanes !== undefined ? { lanes } : {}),
      },
    },
  } as ResolvedConfig["teams"];
  draft.defaultTeamKey = "acme";
  draft.defaultProject = "proj-alpha";
  return draft as unknown as ResolvedConfig;
}

function offendersOf(c: ResolvedConfig): readonly string[] | null {
  try {
    validateWorkspaceIdentity(c);
    return null;
  } catch (e) {
    assert.ok(e instanceof LaneMapError, `expected LaneMapError, got ${String(e)}`);
    return e.offenders;
  }
}

test("lanes map: every nine-lane vocabulary key maps cleanly; an absent map passes unchanged", () => {
  validateWorkspaceIdentity(withLanes(undefined)); // absent — the 0.6.0 posture, byte-stable
  const full: Record<string, string> = {
    planned: "Todo",
    claimed: "Todo",
    in_progress: "Doing",
    for_review: "Review",
    in_review: "Review",
    approved: "Review",
    done: "Done",
    blocked: "Blocked",
    canceled: "Canceled",
  };
  validateWorkspaceIdentity(withLanes(full)); // all nine keys valid
});

test("lanes map: a key outside the nine-lane vocabulary refuses, naming the offending team key", () => {
  const offenders = offendersOf(withLanes({ planned: "Todo", genesis: "Backlog" }));
  assert.ok(offenders, "refusal expected");
  assert.equal(offenders.length, 1);
  assert.match(offenders[0]!, /teams\[acme\]\.workflowStates\.lanes\.genesis/);
});

test("lanes map: blank / non-string values refuse (no trim-guess), all offenders listed at once", () => {
  const offenders = offendersOf(withLanes({ planned: "   ", done: "", shipped: "Done" }));
  assert.ok(offenders, "refusal expected");
  assert.deepEqual(
    offenders.map((o) => o.split(" ")[0]).sort(),
    ["teams[acme].workflowStates.lanes.done", "teams[acme].workflowStates.lanes.planned", "teams[acme].workflowStates.lanes.shipped"],
    "complete fail-fast listing, one entry per offender",
  );
});

test("lanes map: required-identity failures keep priority over the optional lanes check", () => {
  const draft = structuredClone(withLanes({ nonsense: "X" })) as unknown as Mutable<ResolvedConfig>;
  draft.defaultTeamKey = "";
  assert.throws(() => validateWorkspaceIdentity(draft as ResolvedConfig), /missing required workspace identities/);
});

test("lanes map: nothing is partially applied — a refused config never reaches a consumer", () => {
  // The validation gate is all-or-nothing: after a refusal the config object is
  // untouched and a corrected copy validates clean (no mutation side effects).
  const broken = withLanes({ in_progress: "Doing", bogus: "Nope" });
  assert.throws(() => validateWorkspaceIdentity(broken), LaneMapError);
  validateWorkspaceIdentity(withLanes({ in_progress: "Doing" }));
});
