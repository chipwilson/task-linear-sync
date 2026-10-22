/**
 * Checkpoint & Conflict Resolution Map shapes (frozen — behavior 008; shape here).
 * Mirror: data-model.md §6–7 (built-in maps from 001 R17.4, overridable).
 */

/** Local per-task record in sync-state.json inside the state directory (read/write 008). */
export interface Checkpoint {
  /** Key. */
  readonly taskUuid: string;
  /** Paired issue. */
  readonly issueId: string;
  /** Last known. */
  readonly checked?: boolean;
  /** Last known derived title. */
  readonly title: string;
  /** ISO-8601 tracker-side update time at last sync. */
  readonly issueUpdatedAt: string;
  /** Workflow state type at last sync. */
  readonly issueStateType: string;
  /** sha256 hex of mirrored description at last sync. */
  readonly descriptionContentHash: string;
}

export type DescriptionConflictType = "linear-changed" | "spec-changed" | "both-changed";

export type ConflictAction =
  | "overwrite-linear"
  | "overwrite-spec"
  | "report-only"
  | "skip"
  | "prefer-newer"
  | "fail";

/** Independently configured per mode (bootstrap / sync). */
export type ConflictResolutionMap = Record<DescriptionConflictType, ConflictAction>;
