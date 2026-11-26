/**
 * T007 [P] [US1] — quickstart V1: zero-config resolution of the 024 default-on task
 * state mapping (feature 024; contracts/state-mapping-defaults.md C1.1/C1.2/C2.1/C2.2/C2.3;
 * amendments A-024-0/A-024-1). A team row carrying ONLY `projects` resolves the four
 * workflow-state identities to Linear's default state names and adopts the full default
 * lane map (NO `blocked` key); `stateMappingEnabled` defaults to true; the resolution
 * pass is deterministic (byte-identical `canonicalizeConfig` across repeated loads).
 *
 * T021 [US4] extends this file with the V2 precedence cases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults, canonicalizeConfig, loadConfig, validateWorkspaceIdentity } from "task-linear-sync/config";
import type { ConfigOverrides, ResolvedConfig } from "task-linear-sync/config";

/** Zero-config team row: identity ONLY (SC-001's "no state-mapping keys at all"). */
const ZERO_CONFIG: ConfigOverrides = {
  teams: { acme: { projects: ["proj-alpha"] } },
  defaultTeamKey: "acme",
  defaultProject: "proj-alpha",
};

function zeroConfig(): ResolvedConfig {
  return loadConfig({ overrides: structuredClone(ZERO_CONFIG) });
}

// ── C1.1 — the shipped tables are exact ────────────────────────────────────────────

test("024 tables: DEFAULT_WORKFLOW_STATE_NAMES is exactly the four Linear default names (C1.1)", async () => {
  const { DEFAULT_WORKFLOW_STATE_NAMES } = await import("task-linear-sync/config");
  assert.deepEqual(DEFAULT_WORKFLOW_STATE_NAMES, {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    done: "Done",
  });
});

test("024 tables: DEFAULT_LANE_STATE_MAP is exactly the C1.1 lane table with NO blocked entry (C1.1, FR-002/FR-003)", async () => {
  const { DEFAULT_LANE_STATE_MAP } = await import("task-linear-sync/config");
  assert.deepEqual(DEFAULT_LANE_STATE_MAP, {
    planned: "Backlog",
    claimed: "Todo",
    in_progress: "In Progress",
    for_review: "In Progress",
    in_review: "In Progress",
    approved: "In Progress",
    done: "Done",
    canceled: "Canceled",
  });
  assert.ok(!("blocked" in DEFAULT_LANE_STATE_MAP), "blocked has NO default entry — stays lane-state-unmapped");
});

test("024 tables: values are platform-generic names only — zero team keys/project names/tokens/UUIDs (C1.2)", async () => {
  const { DEFAULT_LANE_STATE_MAP, DEFAULT_WORKFLOW_STATE_NAMES } = await import("task-linear-sync/config");
  const values = [...Object.values(DEFAULT_WORKFLOW_STATE_NAMES), ...Object.values(DEFAULT_LANE_STATE_MAP)];
  assert.ok(values.length > 0);
  for (const v of values) {
    assert.ok(typeof v === "string" && v.trim().length > 0, `non-empty state name, got ${JSON.stringify(v)}`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v), `uuid-shaped value: ${v}`);
    assert.ok(!/lin_api_|^[A-Za-z0-9+/]{40,}={0,2}$/.test(v), `credential-shaped value: ${v}`);
  }
});

// ── V1 — zero-config resolution ────────────────────────────────────────────────────

test("024 V1: a team row with only projects resolves the four identities to the Linear default names (C2.1, SC-001)", () => {
  const ws = zeroConfig().teams.acme!.workflowStates;
  assert.equal(ws.backlog, "Backlog");
  assert.equal(ws.todo, "Todo");
  assert.equal(ws.inProgress, "In Progress");
  assert.equal(ws.done, "Done");
});

test("024 V1: a zero-config team adopts the FULL default lane map — materialized, with no blocked key (C2.2, FR-001/FR-003)", () => {
  const lanes = zeroConfig().teams.acme!.workflowStates.lanes as Record<string, string>;
  assert.deepEqual(Object.keys(lanes).sort(), [
    "approved",
    "canceled",
    "claimed",
    "done",
    "for_review",
    "in_progress",
    "in_review",
    "planned",
  ]);
  assert.equal(lanes.in_progress, "In Progress");
  assert.equal(lanes.for_review, "In Progress");
  assert.equal(lanes.in_review, "In Progress");
  assert.equal(lanes.approved, "In Progress");
  assert.equal(lanes.planned, "Backlog");
  assert.equal(lanes.claimed, "Todo");
  assert.equal(lanes.done, "Done");
  assert.equal(lanes.canceled, "Canceled");
  assert.equal(lanes.blocked, undefined, "blocked stays unmapped (C6.2 posture, FR-003)");
});

test("024 V1: stateMappingEnabled defaults to true — built-in and resolved (A-024-1, FR-001/FR-004)", () => {
  assert.equal(builtInDefaults.stateMappingEnabled, true);
  assert.equal(zeroConfig().stateMappingEnabled, true);
});

test("024: the defaults document never carries per-team rows — team keys stay dynamic (research R1)", () => {
  assert.deepEqual(builtInDefaults.teams, {}, "no team rows ship in builtInDefaults");
});

test("024: absent lanes is a FRESH per-team copy — mutating one team's resolved map never leaks into another (C2.2)", () => {
  const resolved = loadConfig({
    overrides: {
      teams: { "team-a": { projects: ["p1"] }, "team-b": { projects: ["p2"] } },
      defaultTeamKey: "team-a",
      defaultProject: "p1",
    },
  });
  const a = resolved.teams["team-a"]!.workflowStates.lanes as Record<string, string>;
  const b = resolved.teams["team-b"]!.workflowStates.lanes as Record<string, string>;
  assert.deepEqual(a, b, "same content initially");
  assert.notEqual(a, b, "distinct objects — no shared mutation");
});

test("024: the pass fills teams PRESENT in the config only — a config with no teams resolves none (C2.1)", () => {
  const resolved = loadConfig({});
  assert.deepEqual(Object.keys(resolved.teams), [], "no team is conjured");
});

// ── C2.3 — determinism (property posture; the engine-properties cross-cutter repeats it) ──

test("024 C2.3: canonicalizeConfig of the resolved config is byte-identical across repeated loadConfig calls (Principle IV)", () => {  const first = canonicalizeConfig(zeroConfig());
  const second = canonicalizeConfig(zeroConfig());
  assert.equal(first, second, "identical inputs ⇒ byte-identical canonical config");
  const third = canonicalizeConfig(loadConfig({ overrides: structuredClone(ZERO_CONFIG) }));
  assert.equal(first, third);
});

// ── V2 / T021 [US4] — precedence: configured wins, partial merges, null disables ───

test("024 V2: a configured done: \"Completed\" wins over the default — and survives verbatim (C2.1, US4-AC1, SC-005)", () => {
  const resolved = loadConfig({
    overrides: {
      teams: { acme: { projects: ["proj-alpha"], workflowStates: { done: "Completed" } } },
      defaultTeamKey: "acme",
      defaultProject: "proj-alpha",
    },
  });
  const ws = resolved.teams.acme.workflowStates as Record<string, unknown>;
  assert.equal(ws.done, "Completed", "configured entry wins");
  assert.equal(ws.backlog, "Backlog", "absent entries still fall back to the default table (FR-006)");
});

test("024 V2: a partial lane map merges PER LANE — configured lanes win, absent lanes fill, deterministic (US4-AC3, FR-006)", () => {
  const partial = () =>
    loadConfig({
      overrides: {
        teams: {
          acme: { projects: ["proj-alpha"], workflowStates: { lanes: { in_progress: "Doing", done: "Shipped" } } },
        },
        defaultTeamKey: "acme",
        defaultProject: "proj-alpha",
      },
    });
  const first = partial().teams.acme.workflowStates as { lanes: Record<string, string> };
  const second = partial().teams.acme.workflowStates as { lanes: Record<string, string> };
  assert.equal(first.lanes.in_progress, "Doing", "configured lane wins");
  assert.equal(first.lanes.done, "Shipped", "configured lane wins");
  assert.equal(first.lanes.planned, "Backlog", "absent lane adopts the default");
  assert.equal(first.lanes.canceled, "Canceled", "absent lane adopts the default");
  assert.ok(!("blocked" in first.lanes), "blocked still has no default entry (FR-003)");
  assert.deepEqual(first.lanes, second.lanes, "deterministic across repeated loads (Principle IV)");
});

test("024 V2: an operator-authored BLANK lane value still raises LaneMapError — authored content keeps A-023-0(b) (C2.4)", () => {
  // The blank value is preserved verbatim by the pass (never re-filled); validation
  // (validateWorkspaceIdentity) is what refuses it — exactly as pre-024.
  const resolved = loadConfig({
    overrides: {
      teams: { acme: { projects: ["proj-alpha"], workflowStates: { lanes: { done: "  " } } } },
      defaultTeamKey: "acme",
      defaultProject: "proj-alpha",
    },
  });
  const lanes = (resolved.teams.acme.workflowStates as { lanes: Record<string, string | null> }).lanes;
  assert.equal(lanes.done, "  ", "blank survives verbatim — the default pass never overwrites authored values (C1.4/A-024-0(b))");
  assert.throws(() => validateWorkspaceIdentity(resolved), (e: unknown) => (e as Error).name === "LaneMapError" && /lanes\.done/u.test((e as Error).message));
});

test("024 V2: lanes null survives the resolution pass as null — `{}` is NOT the same thing (R3, C2.2, C3.3)", () => {
  const nulled = loadConfig({
    overrides: {
      teams: { acme: { projects: ["proj-alpha"], workflowStates: { lanes: null } } },
      defaultTeamKey: "acme",
      defaultProject: "proj-alpha",
    },
  });
  assert.equal((nulled.teams.acme.workflowStates as { lanes: unknown }).lanes, null, "null is the documented lane-mapping-OFF (R3)");

  const empty = loadConfig({
    overrides: {
      teams: { acme: { projects: ["proj-alpha"], workflowStates: { lanes: {} } } },
      defaultTeamKey: "acme",
      defaultProject: "proj-alpha",
    },
  });
  const lanes = (empty.teams.acme.workflowStates as { lanes: Record<string, string> }).lanes;
  assert.equal(lanes.done, "Done", "an empty object deep-merges into ALL-DEFAULTS — explicitly NOT a disable (R3)");
});

test("024 V2: a FULL pre-024 explicit config resolves byte-identical to what it always carried (SC-005)", () => {
  const legacy = {
    teams: {
      acme: {
        projects: ["proj-alpha"],
        workflowStates: {
          backlog: "Triage",
          todo: "Funnel",
          inProgress: "Building",
          done: "Shipped",
          lanes: {
            planned: "Triage",
            claimed: "Funnel",
            in_progress: "Building",
            for_review: "Building",
            in_review: "Building",
            approved: "Building",
            done: "Shipped",
            blocked: "Building",
            canceled: "Shipped",
          },
        },
      },
    },
    defaultTeamKey: "acme",
    defaultProject: "proj-alpha",
  } as ConfigOverrides;
  const resolved = loadConfig({ overrides: structuredClone(legacy) });
  assert.deepEqual(
    resolved.teams.acme.workflowStates,
    (legacy.teams as never as { acme: { workflowStates: unknown } }).acme.workflowStates,
    "every configured key survives verbatim and NOTHING is added — no behavior change for complete configs (FR-006)",
  );
});
