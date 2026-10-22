/**
 * Canonical task-model shapes (frozen — 002 owns the shape; 004 owns derivation/computation).
 * Mirror: specs/002-core-domain-contracts/contracts/task-model.md, data-model.md §1–2.
 * Amendment rule (FR-008): changes here are constitution-governed cross-feature amendments.
 */

/** Canonical framework identifiers (001 Glossary: Supported_Framework). */
export type FrameworkId = "bmad" | "spec-kit" | "open-spec" | "kiro" | "generic";

export type TaskKind = "heading" | "checklist";

/** Inclusive line range of the mirrored task section (001 R2.17). */
export interface TaskBodyExtent {
  /** 1-based, the task's own line. */
  readonly startLine: number;
  /** Inclusive; last line before next task / sibling-or-shallower heading. */
  readonly endLine: number;
}

export interface IssueRef {
  /** Equals the configured confirmationKey when parsed from the line. */
  readonly key: string;
  /** >= 1 */
  readonly number: number;
}

/**
 * Stable positional identity, line-accurate location, nesting, and sync-relevant state of
 * one actionable unit (data-model §1).
 */
export interface Task {
  /** Deterministic v5-shaped UUID — identity anchor; never an in-file marker (R11). */
  readonly stableUuid: string;
  readonly kind: TaskKind;
  /** Repository-relative POSIX path of the TaskFile. */
  readonly filePath: string;
  /** 1-based line position; integer >= 1. */
  readonly lineNumber: number;
  readonly frameworkId: FrameworkId;
  /** Adapter-derived; absent when underivable. */
  readonly featureName?: string;
  /** Parsed identifier (e.g. `Task 1.2`, `T001`) when grammar matched. */
  readonly localTaskId?: string;
  /** Text of most recent phase-pattern heading. */
  readonly phase?: string;
  /** Raw title as parsed (pre-derivation). */
  readonly title: string;
  /** Present iff kind === "checklist". */
  readonly checked?: boolean;
  /** Nearest enclosing checklist/heading task (indent-stack result). */
  readonly parentUuid?: string;
  /** Ordered nested checklist children; entries reference tasks in the same filePath. */
  readonly childUuids: readonly string[];
  /** Visible `[<KEY>-<N>]` reference where key equals the configured Confirmation_Key. */
  readonly issueRef?: IssueRef;
  /** Inclusive line range of the mirrored section. */
  readonly taskBody: TaskBodyExtent;
  /** true iff taskBody region contains Conflict_Markers; freezes the task for reconciliation (008). */
  readonly unresolvedConflict: boolean;
}

export interface TaskFile {
  /** Repo-relative POSIX; sorted deterministically within results. */
  readonly filePath: string;
  /** Selected by adapter detection (003). */
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  /** Repo-relative paths of existing configured sibling spec docs; absent siblings omitted without error. */
  readonly siblingDocuments: readonly string[];
  /** In file order (ascending lineNumber). */
  readonly tasks: readonly Task[];
}

/** Machine-readable framework context persisted with sync state (001 Glossary). */
export interface FrameworkMetadata {
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly filePath: string;
  readonly localTaskId?: string;
}

/**
 * Stable positional seed for Stable_UUID derivation (constitution Principle II, research R11).
 * 002 freezes the seed *string* layout; 004 computes the UUID.
 *
 * Frozen layout:
 *   frameworkId + "\u0000" + (featureName ?? "") + "\u0000" + (localTaskId ?? `${ordinal}:${filePath}`)
 *
 * The ordinal+file fallback uses a colon so the NUL separator never becomes ambiguous.
 * Excluded by construction: visible issue prefix, checkbox state, title text.
 */
export function taskStableSeed(
  t: Pick<Task, "frameworkId" | "featureName" | "localTaskId">,
  fallback: { ordinal: number; filePath: string },
): string {
  const stableIdentity = t.localTaskId ?? `${fallback.ordinal}:${fallback.filePath}`;
  return [t.frameworkId, t.featureName ?? "", stableIdentity].join("\u0000");
}
