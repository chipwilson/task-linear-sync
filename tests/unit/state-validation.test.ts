/**
 * T010 [P] [US2] — unit semantics of the bootstrap mapping validator (feature 024;
 * contract C4.2/C4.4; data-model §4/§5; research R5/R6). RED-FIRST: the validator
 * (`src/engine/state-validation.ts`) lands with T013 — until then the guarded import
 * yields no functions and every pin below fails.
 *
 * Pinned posture:
 *  - one pass over ALL configured teams; exact case-sensitive presence test against the
 *    snapshot; near-match (case-insensitive) hints NEVER clear a miss (no guessing, R5);
 *  - `missingTypes` flags an absent `completed`-type or `canceled`-type state (FR-008
 *    second clause);
 *  - a snapshot with no states for a team (including teams the snapshot omits) yields
 *    `workflowEmpty: true` as a DISTINCT outcome instead of N missing-name noise;
 *  - a team passes only when missing = ∅ ∧ missingTypes = ∅ ∧ ¬workflowEmpty;
 *  - lane scope: targets of a NON-NULL map only; a `null` map skips lane entries;
 *    `blocked` (no default entry) is checked only when configured;
 *  - mapping-disabled teams (global or per-team) validate vacuously (their names are
 *    not mapped — US4-AC2 byte-identical posture);
 *  - one error carries every team's report (pass AND fail), grouped, with entry paths,
 *    available `name (type)` states (never ids), hints, and correction steps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { ConfigOverrides, ResolvedConfig } from "task-linear-sync/config";
import type { TeamMetadataCollections } from "task-linear-sync/ports";

const moduleSpecifier = "../../src/engine/state-validation.js";
const mod = await import(moduleSpecifier).catch(() => ({} as Record<string, unknown>));
type Report = {
  teamKey: string;
  missing: ReadonlyArray<{ entryPath: string; intendedName: string }>;
  nearMatches: ReadonlyArray<{ entryPath: string; intendedName: string; availableName: string }>;
  available: ReadonlyArray<{ name: string; type: string }>;
  missingTypes: ReadonlyArray<string>;
  workflowEmpty: boolean;
};
const computeReports = mod.computeBootstrapMappingReports as
  | ((config: ResolvedConfig, snapshot: ReadonlyArray<TeamMetadataCollections>) => readonly Report[])
  | undefined;
const assertMapping = mod.assertBootstrapStateMapping as
  | ((config: ResolvedConfig, snapshot: ReadonlyArray<TeamMetadataCollections>) => void)
  | undefined;
const MappingErrorClass = mod.StateMappingBootstrapError as (new (...args: never[]) => Error) | undefined;

// ── helpers ──────────────────────────────────────────────────────────────────────────

/** Linear default-workflow metadata for a team (the validator's happy snapshot). */
function defaultWorkflow(teamKey: string, idSeed: string): TeamMetadataCollections {
  return {
    teamKey,
    projects: [{ id: "proj-alpha", name: "Project Alpha" }],
    workflowStates: [
      { id: `${idSeed}-1`, name: "Backlog", type: "backlog" },
      { id: `${idSeed}-2`, name: "Todo", type: "todo" },
      { id: `${idSeed}-3`, name: "In Progress", type: "started" },
      { id: `${idSeed}-4`, name: "Done", type: "completed" },
      { id: `${idSeed}-5`, name: "Canceled", type: "canceled" },
    ],
  };
}

function configOver(overrides: ConfigOverrides): ResolvedConfig {
  return loadConfig({
    overrides: { defaultTeamKey: "acme", defaultProject: "proj-alpha", ...overrides },
  });
}

/** Team-level override row merged into acme's config entry (root keys go through configOver). */
type TeamOverride = NonNullable<ConfigOverrides["teams"]>[string];
const acmeOnly = (extra?: TeamOverride): ResolvedConfig =>
  configOver({ teams: { acme: { projects: ["proj-alpha"], ...(extra ?? {}) } } });

function reportFor(reports: readonly Report[], teamKey: string): Report {
  const r = reports.find((x) => x.teamKey === teamKey);
  assert.ok(r, `report for ${teamKey}`);
  return r!;
}

// ── the module under test exists ────────────────────────────────────────────────────

test("024 US2: state-validation exports the validator, the guard, and the named error (T013 subject)", () => {
  assert.equal(typeof computeReports, "function", "computeBootstrapMappingReports exists");
  assert.equal(typeof assertMapping, "function", "assertBootstrapStateMapping exists");
  assert.equal(typeof MappingErrorClass, "function", "StateMappingBootstrapError exists");
});

// ── pass / fail semantics (C4.2) ────────────────────────────────────────────────────

test("024 validator: a zero-config team against the default workflow PASSES (SC-001)", () => {
  const reports = computeReports!(acmeOnly(), [defaultWorkflow("acme", "st-a")]);
  assert.equal(reports.length, 1, "one report per configured team");
  const r = reportFor(reports, "acme");
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.nearMatches, []);
  assert.deepEqual(r.missingTypes, []);
  assert.equal(r.workflowEmpty, false);
  assert.deepEqual(r.available.map((s) => s.name), ["Backlog", "Todo", "In Progress", "Done", "Canceled"]);
});

test("024 validator: exact case-sensitive presence — a renamed state is MISSING with the entry path and intended name (FR-008, V6)", () => {
  const world = defaultWorkflow("acme", "st-a");
  const renamed: TeamMetadataCollections = {
    ...world,
    workflowStates: world.workflowStates.map((s) => (s.name === "In Progress" ? { ...s, name: "WIP" } : s)),
  };
  const r = reportFor(computeReports!(acmeOnly(), [renamed]), "acme");
  const paths = r.missing.map((m) => m.entryPath);
  assert.ok(
    paths.includes("teams[acme].workflowStates.inProgress"),
    `inProgress identity flagged via its config entry path, got ${paths.join(", ")}`,
  );
  assert.ok(
    paths.includes("teams[acme].workflowStates.lanes.in_progress"),
    "lane targets of the (default-filled) map are checked too",
  );
  assert.ok(r.missing.every((m) => m.intendedName === "In Progress"), "intended names named");
  assert.deepEqual(r.nearMatches, [], "'WIP' is not a case-variant of 'In Progress' — no hint");
});

test("024 validator: case-insensitive near matches are HINTS and never clear the miss (R5, spec edge case)", () => {
  const config = acmeOnly({ workflowStates: { todo: "todo" } });
  const r = reportFor(computeReports!(config, [defaultWorkflow("acme", "st-a")]), "acme");
  assert.ok(
    r.missing.some((m) => m.entryPath === "teams[acme].workflowStates.todo" && m.intendedName === "todo"),
    "the case-mismatched configured name stays missing",
  );
  assert.ok(
    r.nearMatches.some(
      (n) => n.entryPath === "teams[acme].workflowStates.todo" && n.intendedName === "todo" && n.availableName === "Todo",
    ),
    "'todo' vs available 'Todo' — case differs (hint recorded)",
  );
});

test("024 validator: missing completed-type and canceled-type STATES are flagged as categories (FR-008 second clause)", () => {
  const world = defaultWorkflow("acme", "st-a");
  const noCancels: TeamMetadataCollections = {
    ...world,
    workflowStates: world.workflowStates.filter((s) => s.type !== "canceled" && s.type !== "completed"),
  };
  const r = reportFor(computeReports!(acmeOnly(), [noCancels]), "acme");
  assert.deepEqual([...r.missingTypes].sort(), ["canceled", "completed"]);
});

test("024 validator: a team the snapshot omits (or carries zero states for) is workflowEmpty — NOT N missing names (V9)", () => {
  const omitted = reportFor(computeReports!(acmeOnly(), []), "acme");
  assert.equal(omitted.workflowEmpty, true, "team absent from the snapshot ⇒ distinct workflowEmpty outcome");
  assert.deepEqual(omitted.missing, [], "no missing-name noise for an unreachable/empty team");

  const emptyStates: TeamMetadataCollections = { teamKey: "acme", projects: [], workflowStates: [] };
  const empty = reportFor(computeReports!(acmeOnly(), [emptyStates]), "acme");
  assert.equal(empty.workflowEmpty, true, "zero states ⇒ workflowEmpty");
  assert.deepEqual(empty.missing, []);
  assert.deepEqual(empty.missingTypes, [], "type categories are not noise on an empty workflow either");
});

// ── lane scope (C4.2, C3.3) ─────────────────────────────────────────────────────────

test("024 validator: lanes null skips lane entries; identities and type categories still apply (C3.3, T022)", () => {
  const world = defaultWorkflow("acme", "st-a");
  const brokenTodo: TeamMetadataCollections = {
    ...world,
    workflowStates: world.workflowStates.map((s) => (s.name === "Todo" ? { ...s, name: "Queue" } : s)),
  };
  const withNullLanes = acmeOnly({ workflowStates: { lanes: null } });
  const r = reportFor(computeReports!(withNullLanes, [brokenTodo]), "acme");
  assert.ok(r.missing.some((m) => m.entryPath === "teams[acme].workflowStates.todo"), "identity still validated");
  assert.ok(
    !r.missing.some((m) => m.entryPath.includes(".lanes.")),
    "a null map contributes NO lane entries (every lane is off, nothing to check)",
  );
});

test("024 validator: configured lane targets are checked; blocked is checked ONLY when configured (FR-003)", () => {
  const noBlockedWorld = defaultWorkflow("acme", "st-a"); // no state literally named after a blocked mapping
  const implicit = reportFor(computeReports!(acmeOnly(), [noBlockedWorld]), "acme");
  assert.ok(
    !implicit.missing.some((m) => m.entryPath.endsWith(".lanes.blocked")),
    "the default table has no blocked entry — nothing to check",
  );
  const configured = acmeOnly({ workflowStates: { lanes: { blocked: "Blocked State" } } });
  const r = reportFor(computeReports!(configured, [noBlockedWorld]), "acme");
  assert.ok(
    r.missing.some((m) => m.entryPath === "teams[acme].workflowStates.lanes.blocked" && m.intendedName === "Blocked State"),
    "a configured blocked target is a mapped name — checked",
  );
});

// ── disabled teams validate vacuously (US4-AC2 posture) ──────────────────────────────

test("024 validator: mapping-disabled teams pass without checks — globally and per-team (C3, V5 byte-identical posture)", () => {
  const disabledGlobal = reportFor(
    computeReports!(configOver({ stateMappingEnabled: false, teams: { acme: { projects: ["proj-alpha"] } } }), []),
    "acme",
  );
  assert.equal(disabledGlobal.workflowEmpty, false, "an off team's snapshot is not its problem");
  assert.deepEqual(disabledGlobal.missing, []);
  assert.deepEqual(disabledGlobal.missingTypes, []);

  const perTeam = acmeOnly({ workflowStates: { mappingEnabled: false } });
  assert.deepEqual(reportFor(computeReports!(perTeam, []), "acme").missing, []);
});

// ── the grouped error (C4.4) ────────────────────────────────────────────────────────

test("024 validator: assertBootstrapStateMapping passes clean, throws the named error on ANY failing team — reporting every team pass AND fail (FR-009, US2-AS4)", () => {
  const good = defaultWorkflow("globex", "st-g");
  assert.doesNotThrow(() => assertMapping!(configOver({ teams: { globex: { projects: ["p"] } } }), [good]));

  const twoTeams = configOver({
    teams: { acme: { projects: ["p"] }, globex: { projects: ["p"] } },
    defaultTeamKey: "acme",
  });
  assert.throws(
    () => assertMapping!(twoTeams, [defaultWorkflow("globex", "st-g")]), // acme missing from the snapshot
    (error: unknown) => {
      assert.equal((error as Error).name, "StateMappingBootstrapError", "stable error name");
      const message = (error as Error).message;
      assert.ok(message.includes("acme"), "failing team named");
      assert.ok(/globex[\s\S]*PASS|PASS[\s\S]*globex/i.test(message), "passing team's PASS is reported too");
      assert.ok(/FAIL/i.test(message), "failing team marked FAIL");
      return true;
    },
  );
});

test("024 validator: ONE error lists every missing name across every failing team, with available name (type) states, hints, and correction steps (FR-009, SC-002/SC-003)", () => {
  const drifted = defaultWorkflow("acme", "st-a");
  const driftedWorld: TeamMetadataCollections = {
    ...drifted,
    workflowStates: drifted.workflowStates
      .filter((s) => s.name !== "Canceled")
      .map((s) => (s.name === "In Progress" ? { ...s, name: "WIP" } : s)),
  };
  const driftedB = defaultWorkflow("bteam", "st-b");
  const driftedWorldB: TeamMetadataCollections = {
    ...driftedB,
    workflowStates: driftedB.workflowStates.map((s) => (s.name === "Done" ? { ...s, name: "Shipped" } : s)),
  };
  const twoTeams = configOver({
    teams: { acme: { projects: ["p"], workflowStates: { todo: "todo" } }, bteam: { projects: ["p"] } },
    defaultTeamKey: "acme",
  });
  try {
    assertMapping!(twoTeams, [driftedWorld, driftedWorldB]);
    assert.fail("expected StateMappingBootstrapError");
  } catch (error) {
    assert.equal((error as Error).name, "StateMappingBootstrapError");
    const message = (error as Error).message;
    // All missing names across BOTH teams in one pass (SC-002):
    for (const needle of [
      "teams[acme].workflowStates.inProgress",
      "teams[acme].workflowStates.lanes.in_progress",
      "teams[acme].workflowStates.lanes.canceled",
      "teams[acme].workflowStates.todo",
      "teams[bteam].workflowStates.done",
    ]) {
      assert.ok(message.includes(needle), `grouped report names ${needle}`);
    }
    // Available states as `name (type)` — never ids:
    assert.ok(message.includes("WIP (started)"), "available states listed as name (type)");
    // Case-differ hint (SC-003):
    assert.ok(/'todo'.*'Todo'|todo.*case.*Todo/i.test(message), "near-match typo hint present");
    // Missing type categories (acme lost its canceled state):
    assert.ok(/canceled/i.test(message), "missing canceled type category reported");
    // Correction steps (FR-009):
    assert.ok(/workflowStates/i.test(message) && /(Linear|workflow)/i.test(message), "correction steps present");
    assert.ok(/re-?run/i.test(message), "re-run instruction present");
    const payload = (error as { reports?: readonly Report[] }).reports;
    assert.ok(Array.isArray(payload) && payload.length === 2, "structured payload: every team's report");
  }
});

test("024 validator: reports are deterministic — identical inputs produce identical reports (Principle IV)", () => {
  const world = defaultWorkflow("acme", "st-a");
  const configOverAcme = () => configOver({ teams: { acme: { projects: ["p"], workflowStates: { done: "Done!" } } } });
  const first = JSON.stringify(computeReports!(configOverAcme(), [world]));
  const second = JSON.stringify(computeReports!(configOverAcme(), [world]));
  assert.equal(first, second);
});
