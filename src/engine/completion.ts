/**
 * T023 [P] [US1] — Checkbox completion → workflow-state mapping (research R7; data-model §6;
 * FR-006; unit tests T016; integration T033).
 * `checkedChanged ∧ ¬descriptionConflict ⇒ desiredStateType = checked ? configured done
 * state : configured backlog state`. Workflow identities are per-team CONFIGURED values
 * (`ResolvedConfig.teams[teamKey].workflowStates.done` / `.backlog`, frozen 002 routing
 * shapes); since feature 024 (amendment A-024-0, constitution v1.1.0 platform-default
 * exception) the absent entries materialize from `DEFAULT_WORKFLOW_STATE_NAMES` through
 * the load-time resolution pass — the resolvers below see ordinary configured values and
 * need NO mapping-logic change (research R1). Name→id resolution uses the 007
 * `discoverMetadata` workflow-state snapshot captured at plan time and re-fetched
 * before mutation; an unknown configured state name is a plan-time validation failure
 * (sanitized `EngineError`), not a runtime surprise. Independent of the description-
 * conflict machinery (US1 AC5); produced downstream as an `update-issue(stateTypeId)` op +
 * `checkbox-changed` history event. State is spec→tracker only (R7): this module takes no
 * current tracker-state input and exposes no tracker→spec reverse mapping.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { TeamMetadataCollections } from "../ports/linear-port.js";
import { EngineError } from "./errors.js";

/**
 * 024 A-024-1 / contract C3.1 — is task state mapping ACTIVE for a routed team?
 * The root `stateMappingEnabled` (built-in default `true`) governs globally; a
 * per-team `workflowStates.mappingEnabled: false` wins over it; an absent per-team
 * value inherits the global. Inactive ⇒ the engine derives NO state change from a
 * checkbox change or lane event and affected units carry `state-mapping-disabled`
 * (data-model §3/§7). An unknown teamKey reads as "no per-team value" — the
 * resolvers below still fail it through their existing identity gates.
 */
export function stateMappingActive(config: ResolvedConfig, teamKey: string): boolean {
  return (
    config.stateMappingEnabled !== false &&
    config.teams?.[teamKey]?.workflowStates?.mappingEnabled !== false
  );
}

/** The completion arm's identity token: which `workflowStates` field the checkbox drives. */
function armIdentity(checked: boolean): "done" | "backlog" {
  return checked ? "done" : "backlog";
}

/**
 * The configured completion state NAME for a checkbox transition:
 * `checked ⇒ teams[teamKey].workflowStates.done`, unchecked ⇒ `.backlog` (FR-006).
 * Since 024, an ABSENT entry arrives already filled from the built-in default
 * table by the load-time resolution pass; a BLANK or explicit-`null` value is the
 * operator overriding with nothing usable — a plan-time validation failure that
 * throws a sanitized `EngineError` naming the team and the missing identity
 * (null-tolerant per research R7 — never a crash at `.trim()`, never a guessed
 * name). An unknown teamKey likewise fails at plan time: `defaultTeamKey` is a
 * ROUTING fallback (005) and completion mapping never silently re-routes an
 * unmapped team through it — the failing team must be the team the task routes to.
 * Messages name only the offending identity (`teams[<key>].workflowStates.<arm>`)
 * and the team key — never config or snapshot content (sanitized-failure posture).
 */
export function desiredCompletionStateName(
  config: ResolvedConfig,
  teamKey: string,
  checked: boolean,
): string {
  const identity = armIdentity(checked);
  const team = config.teams?.[teamKey];
  if (team === undefined) {
    // No `defaultTeamKey` fallback on this seam (pinned by T016): the configured team
    // whose checkbox changed is the only team whose workflowStates may answer.
    throw new EngineError(
      `completion mapping: unknown team '${teamKey}' — configuration.teams carries no such team, ` +
        `so its ${identity} workflow-state name cannot be resolved (no default-team fallback applies to completion mapping)`,
    );
  }

  const stateName = (checked ? team.workflowStates?.done : team.workflowStates?.backlog) as string | null | undefined;
  if (stateName === undefined || stateName === null || stateName.trim().length === 0) {
    // Present-but-blank/null counts as missing — no trim-guess, never a guessed name
    // (C5.1). The built-in default table applies only to ABSENT entries (C2.1).
    throw new EngineError(
      `completion mapping: team '${teamKey}' has no usable ${identity} workflow-state name — ` +
        `teams[${teamKey}].workflowStates.${identity} is blank or null (the built-in default table of ` +
        `Linear default state names fills ABSENT entries only) — set ${identity} to the team's state ` +
        `name, remove the entry to adopt the default, or disable mapping via stateMappingEnabled / ` +
        `per-team workflowStates.mappingEnabled`,
    );
  }
  return stateName;
}

/**
 * Resolve a workflow state NAME to its tracker id from the 007 `discoverMetadata`
 * snapshot (`TeamMetadataCollections.workflowStates`, exact-name match WITHIN the team —
 * no case-loosening, no cross-team id borrowing). Unknown name (or a team the snapshot
 * does not carry) ⇒ sanitized `EngineError` (plan-time validation failure, R7), naming
 * only the state name and team — never snapshot content. The snapshot is captured at
 * plan time and RE-FETCHED before mutation (data-model §6).
 */
export function resolveWorkflowStateId(
  snapshot: ReadonlyArray<TeamMetadataCollections>,
  teamKey: string,
  stateName: string,
): string {
  const team = snapshot.find((collections) => collections.teamKey === teamKey);
  if (team === undefined) {
    throw new EngineError(
      `completion mapping: the workflow-state snapshot carries no team '${teamKey}' — ` +
        `configured state '${stateName}' cannot be resolved to an id (plan-time validation failure)`,
    );
  }

  const state = team.workflowStates.find((candidate) => candidate.name === stateName);
  if (state === undefined) {
    throw new EngineError(
      `completion mapping: configured workflow-state name '${stateName}' does not exist in team ` +
        `'${teamKey}' (exact, case-sensitive match required) — plan-time validation failure, ` +
        `not a mutation-time surprise (R7)`,
    );
  }
  return state.id;
}

// ─────────────────────────── 023 A-023-0/A-023-3: lane → workflow-state resolution

/** A resolved lane state: id (patch material), name (config value), type (live no-op check
 *  and create input — `IssueView.stateType` carries the state TYPE). */
export interface LaneState {
  readonly stateId: string;
  readonly stateName: string;
  readonly stateType: string;
}

/**
 * Resolve a work-package lane to the ROUTED team's workflow state (feature 023 contract
 * C6.2; amendments A-023-0, A-024-0/A-024-2). Since 024 the lane map arrives
 * default-FILLED by the load-time resolution pass (configured entries win); an
 * unmapped lane (`blocked` — no default counterpart, an out-of-vocabulary event token,
 * a blank/null entry, or a `null` map = lane-mapping OFF, research R3) resolves to
 * `null`: the caller leaves the state UNTOUCHED and reports `lane-state-unmapped`
 * (never a silent guess — null-tolerant reads per C5.1, no `defaultTeamKey` fallback
 * on this seam — the completion-path rule). A MAPPED name resolves through the same
 * snapshot path as the completion lane; an unresolvable name throws the sanitized
 * `EngineError` (conflict posture of the completion path). Messages name only
 * identities — never map or snapshot content.
 */
export function resolveLaneState(
  config: ResolvedConfig,
  snapshot: ReadonlyArray<TeamMetadataCollections>,
  teamKey: string,
  lane: string,
): LaneState | null {
  const team = config.teams?.[teamKey];
  if (team === undefined) {
    throw new EngineError(
      `lane-state mapping: unknown team '${teamKey}' — configuration.teams carries no such team, ` +
        `so lane '${lane}' cannot be resolved (no default-team fallback applies to lane mapping)`,
    );
  }
  // The config schema keys lanes by the nine-lane vocabulary; the event log may carry ANY
  // token (bootstrap `genesis`, custom names) — an out-of-vocabulary key reads undefined,
  // i.e. unmapped, which is exactly the C6.2 posture. A `null` map (explicit lane-off)
  // and blank/null entries take the same missing branch — never a crash at `.trim()`.
  const lanes = team.workflowStates?.lanes as Readonly<Record<string, string | null>> | null | undefined;
  const mapped = lanes?.[lane];
  if (mapped === undefined || mapped === null || mapped.trim().length === 0) return null; // untouched + reported (C6.2/C3.3)
  const snapTeam = snapshot.find((collections) => collections.teamKey === teamKey);
  const state = snapTeam?.workflowStates.find((candidate) => candidate.name === mapped);
  if (state === undefined) {
    throw new EngineError(
      `lane-state mapping: configured lane state name '${mapped}' does not exist in team ` +
        `'${teamKey}' (exact, case-sensitive match required) — plan-time validation failure, ` +
        `not a mutation-time surprise (C6.2, R7 posture) — map the lane to one of the team's ` +
        `workflow states, set lanes to null to leave every lane untouched, or disable mapping ` +
        `via stateMappingEnabled / per-team workflowStates.mappingEnabled`,
    );
  }
  return { stateId: state.id, stateName: state.name, stateType: state.type };
}
