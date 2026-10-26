/**
 * Checkbox completion → workflow-state mapping (research R7; data-model §6; FR-006;
 * task T023 implements; unit tests T016; integration T033).
 * `checkedChanged ∧ ¬descriptionConflict ⇒ desiredStateType = checked ? configured done
 * state : configured backlog state`. Workflow identities are per-team CONSUMER-CONFIGURED
 * values (`ResolvedConfig.teams[teamKey].workflowStates.done` / `.backlog`, frozen 002
 * routing shapes) — NO built-in default (constitution III). Name→id resolution uses the
 * 007 `discoverMetadata` workflow-state snapshot captured at plan time and re-fetched
 * before mutation; an unknown configured state name is a plan-time validation failure
 * (sanitized `EngineError`), not a runtime surprise. Independent of the description-
 * conflict machinery (US1 AC5); produced as an `update-issue(stateTypeId)` op +
 * `checkbox-changed` history event. State is spec→tracker only (R7).
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { TeamMetadataCollections } from "../ports/linear-port.js";

/**
 * The configured completion state NAME for a checkbox transition:
 * `checked ⇒ teams[teamKey].workflowStates.done`, unchecked ⇒ `.backlog` (FR-006).
 * Missing/blank configuration is a plan-time validation failure — throws a sanitized
 * `EngineError` naming the team and the missing identity (no built-in default exists;
 * constitution III). T023 implements (T016).
 */
export function desiredCompletionStateName(
  config: ResolvedConfig,
  teamKey: string,
  checked: boolean,
): string {
  void [config, teamKey, checked]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: completion");
}

/**
 * Resolve a workflow state NAME to its tracker id from the 007 `discoverMetadata`
 * snapshot (`TeamMetadataCollections.workflowStates`, exact-name match within the
 * team). Unknown name ⇒ sanitized `EngineError` (plan-time validation failure, R7).
 * The snapshot is captured at plan time and RE-FETCHED before mutation (data-model §6).
 * T023 implements (T016).
 */
export function resolveWorkflowStateId(
  snapshot: ReadonlyArray<TeamMetadataCollections>,
  teamKey: string,
  stateName: string,
): string {
  void [snapshot, teamKey, stateName]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: completion");
}
