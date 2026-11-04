/**
 * T016 [P] [US1] — Checkbox completion → workflow-state mapping unit tests for
 * `src/engine/completion.ts` (FR-006; research R7; data-model §6;
 * contracts/conflict-resolution-matrix.md §5; implementation lands in T023).
 *
 * RED BY DESIGN: `src/engine/completion.ts` is currently a signature stub, so every
 * test that calls the mapping fails at runtime with `not implemented: completion`.
 * The two structural (export-surface) guards are stub-pass posture pins — they stay
 * green today and must stay green for T023.
 *
 * Pinned behavior:
 * - `checkedChanged ∧ ¬descriptionConflict ⇒ desiredStateType = checked ? configured
 *   done state : configured backlog state` (FR-006). Done/backlog identities are
 *   per-team CONSUMER-CONFIGURED values read through the frozen 002 routing shape
 *   (`ResolvedConfig.teams[teamKey].workflowStates.done` / `.backlog`) — NO built-in
 *   default exists (constitution III): a team with no configured (or blank) done/backlog
 *   name is a plan-time validation failure, never a guessed `"Done"`/`"Backlog"`.
 * - Name→id resolution goes through the 007 `discoverMetadata` workflow-state snapshot
 *   (`TeamMetadataCollections.workflowStates`, exact-name match WITHIN the team). The
 *   snapshots below are built by the real 007 fake (`createFakeLinearPort` →
 *   `discoverMetadata`) so the tests exercise the true snapshot shape.
 * - An unknown configured state name is a plan-time sanitized `EngineError` naming the
 *   bad state name and team — never a runtime surprise at mutation time, and never
 *   echoing raw content (a sentinel config/snapshot value must not leak into errors).
 * - Independence (US1 AC5, matrix §5): the completion seam never consults or populates
 *   `descriptionConflict`. End-to-end independence is integration T033's job; here it is
 *   asserted at the mapping surface: the seam takes no conflict input and exposes no
 *   conflict/description vocabulary.
 * - Tracker-side state moves are recorded into checkpoints (`stateTypeDrift`, owned by
 *   classify.ts/T020) and NEVER pushed back (R7): the forward mapping takes no current
 *   tracker-state input and the module exposes no tracker→spec reverse mapping.
 *
 * Hermetic (constitution VI): zero network/credentials/wall-clock; the snapshot comes
 * from the 007 in-memory fake; all identities are placeholders + `syntheticUuid()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as completionModule from "../../src/engine/completion.js";
import { desiredCompletionStateName, resolveWorkflowStateId } from "../../src/engine/completion.js";
import { EngineError } from "../../src/engine/errors.js";

import { loadConfig, type ResolvedConfig } from "task-linear-sync/config";
import type { TeamMetadataCollections } from "task-linear-sync/ports";
import { createFakeLinearPort, syntheticUuid, type FakeWorldSeed } from "task-linear-sync/tracker/testing";

// ──────────────────────────────────────────────────────── fixture world

/**
 * Sanitized-failure canary: a placeholder value standing in for raw task content.
 * It lives in a config field and a snapshot project name that NO completion
 * validation failure has any reason to echo — its presence in an error message
 * would mean the error dumps config/snapshot material instead of naming only the
 * offending identity.
 */
const SENTINEL_RAW_CONTENT = "PLACEHOLDER-raw-task-body-NEVER-IN-ERRORS-a1b2c3";

/** Deterministic workflow-state ids (`syntheticUuid` corpus scheme, Principle III placeholders). */
const STATE_IDS = {
  acmeBacklog: syntheticUuid(1),
  acmeStarted: syntheticUuid(2),
  acmeDone: syntheticUuid(3),
  geminiBacklog: syntheticUuid(4),
  geminiStarted: syntheticUuid(5),
  geminiCompleted: syntheticUuid(6),
} as const;

/**
 * Consumer-configured teams (frozen 002 `TeamIdentity.workflowStates` shape):
 * - `acme` / `gemini`: fully configured done+backlog, DIFFERENT per-team names
 *   (the mapping must be per-team, never one global identity).
 * - `partial`: 002-valid (≥ 1 workflow-state identity) but configured NEITHER
 *   `done` NOR `backlog` — completion mapping must still refuse (no default).
 * - `blanked`: done/backlog present-but-blank — blank is missing (no trim-guess).
 */
function makeConfig(): ResolvedConfig {
  return loadConfig({
    overrides: {
      teams: {
        acme: { projects: ["core"], workflowStates: { backlog: "Triage", done: "Shipped" } },
        gemini: { projects: ["atlas"], workflowStates: { backlog: "Icebox", done: "Closed — Shipped" } },
        partial: { projects: ["edges"], workflowStates: { todo: "In Flight" } },
        blanked: { projects: ["void"], workflowStates: { backlog: "", done: "   " } },
      },
      defaultTeamKey: "acme",
      defaultProject: SENTINEL_RAW_CONTENT, // sanitized-failure canary (see above)
    },
  });
}

/** Fake-Linear seed mirroring the config teams (007 `discoverMetadata` source of truth). */
function worldSeed(): FakeWorldSeed {
  return {
    teams: [
      {
        key: "acme",
        id: syntheticUuid(10),
        projects: [{ id: syntheticUuid(20), name: "Core" }],
        workflowStates: [
          { id: STATE_IDS.acmeBacklog, name: "Triage", type: "backlog" },
          { id: STATE_IDS.acmeStarted, name: "In Progress", type: "started" },
          { id: STATE_IDS.acmeDone, name: "Shipped", type: "completed" },
        ],
      },
      {
        key: "gemini",
        id: syntheticUuid(11),
        // Snapshot-side canary: unknown-name errors must not dump the snapshot.
        projects: [{ id: syntheticUuid(21), name: SENTINEL_RAW_CONTENT }],
        workflowStates: [
          { id: STATE_IDS.geminiBacklog, name: "Icebox", type: "backlog" },
          { id: STATE_IDS.geminiStarted, name: "In Progress", type: "started" },
          { id: STATE_IDS.geminiCompleted, name: "Closed — Shipped", type: "completed" },
        ],
      },
    ],
    issues: [],
  };
}

/** The plan-time snapshot, produced by the REAL 007 fake's `discoverMetadata` output shape. */
async function discoverSnapshot(teamKeys: readonly string[]): Promise<ReadonlyArray<TeamMetadataCollections>> {
  return createFakeLinearPort(worldSeed()).discoverMetadata(teamKeys);
}

// ──────────────────────────────────────────────────────── helpers

function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

/**
 * A plan-time validation failure: sanitized `EngineError` (the frozen engine taxonomy,
 * errors.ts — NOT a tracker/runtime error surfacing later) that names the offending
 * identity and team but never leaks the raw-content sentinel.
 */
function expectPlanTimeFailure(fn: () => unknown, offendingRe: RegExp, teamRe: RegExp): void {
  const thrown = captureThrown(fn);
  assert.ok(
    thrown instanceof EngineError,
    `expected a plan-time sanitized EngineError validation failure, got ${String(thrown)}`,
  );
  assert.match((thrown as Error).message, offendingRe, "failure must name the offending identity (actionable)");
  assert.match((thrown as Error).message, teamRe, "failure must name the team (per-team configuration)");
  assert.ok(
    !(thrown as Error).message.includes(SENTINEL_RAW_CONTENT),
    "validation failure stays sanitized — never dumps config/snapshot content",
  );
}

// ────────────────────────────── desiredCompletionStateName (FR-006, R7)

test("engine-completion — checked toggle maps to the team's CONFIGURED done-state name (per-team, no global identity)", () => {
  const config = makeConfig();

  assert.equal(desiredCompletionStateName(config, "acme", true), "Shipped");
  assert.equal(desiredCompletionStateName(config, "gemini", true), "Closed — Shipped");
  // Determinism: stable across repeated calls (plan re-checks re-run the same mapping).
  assert.equal(desiredCompletionStateName(config, "acme", true), desiredCompletionStateName(config, "acme", true));
});

test("engine-completion — unchecked toggle maps to the team's CONFIGURED backlog-state name; per-team values never cross-contaminate", () => {
  const config = makeConfig();

  assert.equal(desiredCompletionStateName(config, "acme", false), "Triage");
  assert.equal(desiredCompletionStateName(config, "gemini", false), "Icebox");
  // No borrowing across teams: each team's arm returns ITS OWN configured names.
  assert.notEqual(desiredCompletionStateName(config, "acme", true), desiredCompletionStateName(config, "gemini", true));
  assert.notEqual(desiredCompletionStateName(config, "acme", false), desiredCompletionStateName(config, "gemini", false));
});

test("engine-completion — team with no configured done name ⇒ plan-time EngineError, never a guessed default (constitution III)", () => {
  const config = makeConfig();

  // `partial` is 002-VALID (it configures `todo`, satisfying the ≥1-identity gate) yet
  // completion still fails at plan time: no built-in "Done" fallback may ever appear.
  expectPlanTimeFailure(() => desiredCompletionStateName(config, "partial", true), /done/iu, /partial/u);
});

test("engine-completion — team with no configured backlog name ⇒ plan-time EngineError on the unchecked arm", () => {
  const config = makeConfig();

  expectPlanTimeFailure(() => desiredCompletionStateName(config, "partial", false), /backlog/iu, /partial/u);
});

test("engine-completion — present-but-blank configured names count as missing on both arms (no trim-guess)", () => {
  const config = makeConfig();

  expectPlanTimeFailure(() => desiredCompletionStateName(config, "blanked", true), /done/iu, /blanked/u);
  expectPlanTimeFailure(() => desiredCompletionStateName(config, "blanked", false), /backlog/iu, /blanked/u);
});

test("engine-completion — unknown teamKey fails at plan time; never falls back to defaultTeamKey or a built-in name", () => {
  const config = makeConfig(); // defaultTeamKey: "acme" is configured…

  // …but completion mapping must not silently route an unknown team through it.
  expectPlanTimeFailure(() => desiredCompletionStateName(config, "no-such-team", true), /no-such-team/u, /team/iu);
  expectPlanTimeFailure(() => desiredCompletionStateName(config, "no-such-team", false), /no-such-team/u, /team/iu);
});

// ────────────────────────────── resolveWorkflowStateId (007 snapshot, R7)

test("engine-completion — configured state name resolves to its snapshot id via the 007 discoverMetadata workflow-state snapshot", async () => {
  const snapshot = await discoverSnapshot(["acme", "gemini"]);
  const config = makeConfig();

  // Direct name→id from the snapshot's workflowStates collection.
  assert.equal(resolveWorkflowStateId(snapshot, "acme", "Triage"), STATE_IDS.acmeBacklog);
  assert.equal(resolveWorkflowStateId(snapshot, "acme", "Shipped"), STATE_IDS.acmeDone);
  assert.equal(resolveWorkflowStateId(snapshot, "gemini", "Closed — Shipped"), STATE_IDS.geminiCompleted);

  // Chained plan-time flow (data-model §6): desired NAME → tracker id, as build.ts composes it.
  const doneName = desiredCompletionStateName(config, "acme", true);
  const backlogName = desiredCompletionStateName(config, "acme", false);
  const doneId = resolveWorkflowStateId(snapshot, "acme", doneName);
  const backlogId = resolveWorkflowStateId(snapshot, "acme", backlogName);
  assert.equal(doneId, STATE_IDS.acmeDone);
  assert.equal(backlogId, STATE_IDS.acmeBacklog);
  assert.notEqual(doneId, backlogId, "the two arms must resolve to distinct state ids");
});

test("engine-completion — name match is exact and team-scoped: no case-loosening, no cross-team id borrowing", async () => {
  const snapshot = await discoverSnapshot(["acme", "gemini"]);

  // "Shipped" exists on acme only; gemini's done name is "Closed — Shipped".
  expectPlanTimeFailure(() => resolveWorkflowStateId(snapshot, "gemini", "Shipped"), /Shipped/u, /gemini/u);
  // Case-exact within the owning team.
  expectPlanTimeFailure(() => resolveWorkflowStateId(snapshot, "acme", "shipped"), /shipped/u, /acme/u);
  // Exact match still works inside the owning team (control).
  assert.equal(resolveWorkflowStateId(snapshot, "acme", "Shipped"), STATE_IDS.acmeDone);
});

test("engine-completion — unknown CONFIGURED state name ⇒ plan-time sanitized EngineError naming name + team, not a runtime surprise", async () => {
  const snapshot = await discoverSnapshot(["gemini"]);

  // Stale configuration: team configured with a done-state name the snapshot doesn't
  // carry — the failure lands HERE (plan time, via EngineError), never later as a
  // mutation-time tracker error, and stays sanitized (sentinel canary checked inside).
  const stale = loadConfig({
    overrides: {
      teams: { gemini: { projects: ["atlas"], workflowStates: { done: "Finished", backlog: "Icebox" } } },
      defaultProject: SENTINEL_RAW_CONTENT,
    },
  });
  expectPlanTimeFailure(
    () => resolveWorkflowStateId(snapshot, "gemini", desiredCompletionStateName(stale, "gemini", true)),
    /Finished/u,
    /gemini/u,
  );
  // Same guarantee driven directly at the resolver seam.
  expectPlanTimeFailure(() => resolveWorkflowStateId(snapshot, "gemini", "Finished"), /Finished/u, /gemini/u);

  // A name the snapshot DOES carry must resolve cleanly (no false-positive refusal).
  assert.equal(resolveWorkflowStateId(snapshot, "gemini", "Icebox"), STATE_IDS.geminiBacklog);
});

// ────────────────────────────── independence + direction (AC5, matrix §5, R7)

test("engine-completion — a toggle with unchanged description maps via the completion seam alone: no conflict/description input exists (AC5, mapping level)", () => {
  const config = makeConfig();

  // End-to-end independence is integration T033's job. At the MAPPING surface, independence
  // is structural: the seam takes exactly (config, teamKey, checked) / (snapshot, teamKey,
  // stateName) — no description, no conflict flag — so `checkedChanged ∧ ¬descriptionConflict`
  // is expressible WITHOUT consulting the conflict machinery, and the mapping succeeds
  // recording nothing about descriptions.
  assert.equal(desiredCompletionStateName.length, 3, "seam must take NO description/conflict parameter");
  assert.equal(resolveWorkflowStateId.length, 3, "resolver must take NO description/conflict parameter");

  // Behavior: the checkbox bit alone drives the mapping (unchanged-description toggle).
  assert.equal(desiredCompletionStateName(config, "acme", true), "Shipped");
  assert.equal(desiredCompletionStateName(config, "acme", false), "Triage");
});

test("engine-completion — tracker-side state moves alter nothing: the forward mapping takes no tracker-state input and exposes no reverse mapping (spec→tracker only, R7)", async () => {
  const config = makeConfig();
  const snapshot = await discoverSnapshot(["acme"]);

  // Someone moved the acme issue mid-workflow ("In Progress" — drift from the
  // checkpoint's perspective). The resolver can name THAT state (observability), but
  // the desired mapping stays checkbox-only: checked ⇒ "Shipped", unchecked ⇒ "Triage".
  assert.equal(resolveWorkflowStateId(snapshot, "acme", "In Progress"), STATE_IDS.acmeStarted);
  assert.equal(desiredCompletionStateName(config, "acme", true), "Shipped");
  assert.equal(desiredCompletionStateName(config, "acme", false), "Triage");
  // `desiredCompletionStateName.length === 3` (guarded in the independence test) means
  // no current-state input exists to push back from; drift RECORDING is classify.ts
  // (T020) territory, and the export-surface guard below pins that completion.ts owns
  // none of it.
});

test("engine-completion — export-surface guard: completion.ts speaks neither the conflict vocabulary nor a tracker→spec reverse mapping", () => {
  // Stub-pass posture pin (must stay green through T023). The completion seam is outside
  // the conflict matrix (matrix §5) and one-directional (R7): every export is a forward
  // completion/workflow-state mapping — no conflict/description vocabulary, and nothing
  // that could turn a tracker state into a spec-side value (`stateTypeDrift` recording is
  // classify.ts's, and spec checkboxes are never written back).
  const exports = Object.keys(completionModule);
  assert.ok(exports.length > 0, "completion.ts must expose its mapping surface");
  for (const name of exports) {
    assert.doesNotMatch(name, /conflict|description/u, `${name}: completion is outside the conflict matrix (matrix §5)`);
    assert.doesNotMatch(
      name,
      /checkpoint|drift|reverse|fromTracker|pushback|backToSpec/iu,
      `${name}: state is spec→tracker only (R7) — no reverse mapping on this seam`,
    );
  }
});
