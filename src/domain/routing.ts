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
 * The nine Spec Kitty lane names — the key space of the optional per-team `lanes` map
 * below (feature 023, amendment A-023-0; `spec-kitty` is the only identity with lanes).
 */
export const LANE_VOCABULARY = [
  "planned",
  "claimed",
  "in_progress",
  "for_review",
  "in_review",
  "approved",
  "done",
  "blocked",
  "canceled",
] as const;

export type LaneName = (typeof LANE_VOCABULARY)[number];

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
  /**
   * 023 A-023-0 (additive): per-team lane → workflow-state NAME map (`spec-kitty`
   * status authority). Keys restricted to the nine-lane vocabulary, values non-empty
   * state names; validated at config load. NO built-in default ships (consumer-required
   * class, like `workflowStates` itself): absent or unmapped lane ⇒ tracker state
   * untouched + reported finding — never a silent guess.
   */
  readonly lanes?: Readonly<Partial<Record<LaneName, string>>>;
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
