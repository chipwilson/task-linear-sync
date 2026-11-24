/**
 * T024 support [US3] — unit tests for the lane→workflow-state resolver beside the
 * completion path (feature 023 contract C6.2; data-model §1 "Lane→state mapping";
 * amendment A-023-0). RED-FIRST: `resolveLaneState` lands with T024 in
 * `src/engine/completion.ts` — until then the guarded import yields no function.
 *
 * Posture pins:
 *  - NO built-in default and NO `defaultTeamKey` fallback — an unmapped lane resolves to
 *    `null` (untouched state + `lane-state-unmapped` finding, decided by the caller);
 *  - a MAPPED name that the snapshot cannot resolve throws the sanitized `EngineError`
 *    (conflict posture of the completion path — never a silent guess);
 *  - resolution yields the id AND the state TYPE (the live no-op check compares
 *    `IssueView.stateType` against the resolved type).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import type { TeamMetadataCollections } from "task-linear-sync/ports";

import { EngineError } from "../../src/engine/errors.js";

const moduleSpecifier = "../../src/engine/completion.js";
const mod = await import(moduleSpecifier);
const resolveLaneState = (mod as {
  resolveLaneState?: (
    config: ResolvedConfig,
    snapshot: ReadonlyArray<TeamMetadataCollections>,
    teamKey: string,
    lane: string,
  ) => { stateId: string; stateName: string; stateType: string } | null;
}).resolveLaneState;

const snapshot: ReadonlyArray<TeamMetadataCollections> = [
  {
    teamKey: "acme",
    projects: [{ id: "proj-alpha", name: "Project Alpha" }],
    workflowStates: [
      { id: "st-backlog", name: "Backlog", type: "backlog" },
      { id: "st-doing", name: "Doing", type: "started" },
      { id: "st-done", name: "Done", type: "completed" },
    ],
  },
];

function configWithLanes(lanes: Record<string, string> | undefined): ResolvedConfig {
  const base = structuredClone(builtInDefaults) as ResolvedConfig;
  return {
    ...base,
    defaultTeamKey: "other",
    teams: {
      ...base.teams,
      acme: { projects: ["proj-alpha"], workflowStates: { backlog: "Backlog", ...(lanes !== undefined ? { lanes } : {}) } },
    },
  } as ResolvedConfig;
}

test("023 lane resolver: mapped lane resolves name → id AND type through the snapshot", () => {
  assert.equal(typeof resolveLaneState, "function", "resolveLaneState exists (T024 subject)");
  const r = resolveLaneState!(
    configWithLanes({ in_progress: "Doing" }),
    snapshot,
    "acme",
    "in_progress",
  );
  assert.deepEqual(r, { stateId: "st-doing", stateName: "Doing", stateType: "started" });
});

test("023 lane resolver: unmapped lane and absent map resolve to NULL — no default, no defaultTeamKey fallback", () => {
  assert.equal(resolveLaneState!(configWithLanes({ in_progress: "Doing" }), snapshot, "acme", "canceled"), null, "lane absent from the map ⇒ untouched + reported (C6.2)");
  assert.equal(resolveLaneState!(configWithLanes({ genesis: "Doing" }), snapshot, "acme", "in_progress"), null, "a map for OTHER lanes never conjures this one");
  assert.equal(resolveLaneState!(configWithLanes(undefined), snapshot, "acme", "in_progress"), null, "absent lanes map is the shipped posture — NOTHING maps");
});

test("023 lane resolver: a mapped-but-unresolvable name throws the sanitized EngineError (conflict posture)", () => {
  assert.throws(
    () => resolveLaneState!(configWithLanes({ done: "Ghost State" }), snapshot, "acme", "done")!,
    EngineError,
    "unknown configured name is a plan-time validation failure, not a silent guess",
  );
});

test("023 lane resolver: an unknown team fails validation — the routed team is the ONLY team consulted", () => {
  assert.throws(() => resolveLaneState!(configWithLanes({ in_progress: "Doing" }), snapshot, "nope", "in_progress")!, EngineError);
});
