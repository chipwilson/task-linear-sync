/**
 * T023 [P] [US1] — Checkbox completion → workflow-state mapping (research R7; data-model §6;
 * FR-006; unit tests T016; integration T033).
 * `checkedChanged ∧ ¬descriptionConflict ⇒ desiredStateType = checked ? configured done
 * state : configured backlog state`. Workflow identities are per-team CONSUMER-CONFIGURED
 * values (`ResolvedConfig.teams[teamKey].workflowStates.done` / `.backlog`, frozen 002
 * routing shapes) — NO built-in default (constitution III). Name→id resolution uses the
 * 007 `discoverMetadata` workflow-state snapshot captured at plan time and re-fetched
 * before mutation; an unknown configured state name is a plan-time validation failure
 * (sanitized `EngineError`), not a runtime surprise. Independent of the description-
 * conflict machinery (US1 AC5); produced downstream as an `update-issue(stateTypeId)` op +
 * `checkbox-changed` history event. State is spec→tracker only (R7): this module takes no
 * current tracker-state input and exposes no tracker→spec reverse mapping.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { TeamMetadataCollections } from "../ports/linear-port.js";
import { EngineError } from "./errors.js";

/** The completion arm's identity token: which `workflowStates` field the checkbox drives. */
function armIdentity(checked: boolean): "done" | "backlog" {
  return checked ? "done" : "backlog";
}

/**
 * The configured completion state NAME for a checkbox transition:
 * `checked ⇒ teams[teamKey].workflowStates.done`, unchecked ⇒ `.backlog` (FR-006).
 * Missing/blank configuration is a plan-time validation failure — throws a sanitized
 * `EngineError` naming the team and the missing identity (no built-in default exists;
 * constitution III). An unknown teamKey likewise fails at plan time: `defaultTeamKey`
 * is a ROUTING fallback (005) and completion mapping never silently re-routes an
 * unmapped team through it — the failing team must be the team the task routes to.
 * Messages name only the offending identity (`teams[<key>].workflowStates.<arm>`) and
 * the team key — never config or snapshot content (sanitized-failure posture).
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

  const stateName = checked ? team.workflowStates?.done : team.workflowStates?.backlog;
  if (stateName === undefined || stateName.trim().length === 0) {
    // Present-but-blank counts as missing — no trim-guess, and never a built-in "Done"/"Backlog".
    throw new EngineError(
      `completion mapping: team '${teamKey}' has no configured ${identity} workflow-state name — ` +
        `teams[${teamKey}].workflowStates.${identity} is missing or blank and no built-in default exists; ` +
        `configure the ${identity} state name for team '${teamKey}'`,
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
