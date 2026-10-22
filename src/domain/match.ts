/**
 * Match shapes (frozen — 006 owns the assignment solver; 002 owns the shape).
 * Mirror: contracts/task-model.md, data-model.md §5.
 */

/** Band per config floors; margin-downgrade rule with durable-identity bypass (006). */
export type Confidence = "high" | "medium" | "low" | "unmatched";

export interface MatchAlternative {
  readonly issueId: string;
  readonly score: number;
  readonly mapped: boolean;
}

/** One-to-one task↔issue assignment (computed by 006; shape frozen here). */
export interface Match {
  /** One-to-one enforced globally by 006's assignment solver. */
  readonly taskUuid: string;
  readonly issueId: string;
  /** Unbounded weighted integer sum (weights in config); >= 0. */
  readonly score: number;
  /** Score distance to nearest competitor; >= 0. */
  readonly margin: number;
  readonly confidence: Confidence;
  /** true ⇒ bypass team/project/framework gating and margin downgrade (constitution II). */
  readonly durableIdentity: boolean;
  /** Machine-readable signal labels. */
  readonly reasons: readonly string[];
  /** <= 3, descending score, deterministic tie-break, each with mapped/unmapped status. */
  readonly alternatives: readonly MatchAlternative[];
}
