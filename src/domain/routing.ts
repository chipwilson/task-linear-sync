/**
 * Routing entry / workspace identity shapes (frozen). Consumer-required; no defaults
 * (constitution III). Mirror: data-model.md §4, contracts/task-model.md.
 */

/** ProjectByPath map entry: both teamKey and project required (project-only shape unsupported). */
export interface ProjectByPathEntry {
  readonly prefix: string;
  readonly teamKey: string;
  readonly project: string;
}

/**
 * Per-team workflow-state identities (consumer-required, no defaults).
 * Validation (config init, FR-007): at least one non-empty state identity per team.
 */
export interface WorkflowStateIdentities {
  readonly backlog?: string;
  readonly todo?: string;
  readonly inProgress?: string;
  readonly done?: string;
  readonly completedTypes?: readonly string[];
  readonly ignoredTypes?: readonly string[];
}

/** teamKey → { projects, workflowStates } identity (consumer-required, no defaults). */
export interface TeamIdentity {
  /** >= 1 project identity required (FR-007). */
  readonly projects: readonly string[];
  readonly workflowStates: WorkflowStateIdentities;
}

/**
 * Result of routing resolution (behavior 005; shape frozen here): longest-character-length
 * match wins; deterministic first-by-map-order tie-break; unmatched paths fall back to
 * default team/project; both-absent ⇒ task left unassigned with indication.
 */
export interface RoutingResolution {
  readonly teamKey: string;
  readonly project: string;
  /** Absent when defaulted/unassigned. */
  readonly matchedPrefix?: string;
  readonly defaulted: boolean;
  readonly tieBreak?: "first-by-map-order";
  /** No prefix and no default identities. */
  readonly unassigned?: true;
}
