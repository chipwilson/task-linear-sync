# Contract: Task Model

Module: `src/domain/task.ts`, `src/domain/match.ts`, `src/domain/routing.ts`,
`src/domain/state-payload.ts`, `src/domain/checkpoint.ts`. Field semantics and validation
rules: [../data-model.md](../data-model.md) § 1–8.

```ts
/** Canonical framework identifiers (001 Glossary: Supported_Framework). */
export type FrameworkId = "bmad" | "spec-kit" | "open-spec" | "kiro" | "generic";

export type TaskKind = "heading" | "checklist";

/** Inclusive line range of the mirrored task section (001 R2.17). */
export interface TaskBodyExtent {
  readonly startLine: number; // 1-based, the task's own line
  readonly endLine: number;   // inclusive; last line before next task / sibling-or-shallower heading
}

export interface IssueRef {
  readonly key: string;    // equals the configured confirmationKey when parsed from the line
  readonly number: number; // >= 1
}

export interface Task {
  /** Deterministic v5-shaped UUID — identity anchor; never an in-file marker. */
  readonly stableUuid: string;
  readonly kind: TaskKind;
  readonly filePath: string;        // repository-relative POSIX
  readonly lineNumber: number;      // 1-based
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly localTaskId?: string;
  readonly phase?: string;
  readonly title: string;           // raw, pre-derivation
  readonly checked?: boolean;       // present iff kind === "checklist"
  readonly parentUuid?: string;
  readonly childUuids: readonly string[];
  readonly issueRef?: IssueRef;
  readonly taskBody: TaskBodyExtent;
  readonly unresolvedConflict: boolean;
}

export interface TaskFile {
  readonly filePath: string;
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly siblingDocuments: readonly string[];
  readonly tasks: readonly Task[];  // ascending lineNumber
}

/** Machine-readable framework context persisted with sync state (001 Glossary). */
export interface FrameworkMetadata {
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly filePath: string;
  readonly localTaskId?: string;
}

/**
 * Stable positional seed for Stable_UUID derivation (constitution Principle II).
 * 002 freezes the seed *string* layout; 004 computes the UUID.
 * Excluded by construction: visible issue prefix, checkbox state, title text.
 */
export function taskStableSeed(t: Pick<Task, "frameworkId" | "featureName" | "localTaskId">,
                               fallback: { ordinal: number; filePath: string }): string;

export type Confidence = "high" | "medium" | "low" | "unmatched";

export interface MatchAlternative {
  readonly issueId: string;
  readonly score: number;
  readonly mapped: boolean;
}

export interface Match {
  readonly taskUuid: string;
  readonly issueId: string;
  readonly score: number;               // unbounded weighted integer sum
  readonly margin: number;              // distance to nearest competitor
  readonly confidence: Confidence;
  readonly durableIdentity: boolean;    // true => bypass container/framework gating + margin downgrade
  readonly reasons: readonly string[];
  readonly alternatives: readonly MatchAlternative[]; // <= 3, descending score, deterministic tie-break
}

export interface ProjectByPathEntry {
  readonly prefix: string;
  readonly teamKey: string;   // required — project-only shape unsupported
  readonly project: string;   // required
}

export interface RoutingResolution {
  readonly teamKey: string;
  readonly project: string;
  readonly matchedPrefix?: string;      // absent when defaulted/unassigned
  readonly defaulted: boolean;
  readonly tieBreak?: "first-by-map-order";
  readonly unassigned?: true;           // no prefix and no default identities
}

export type DescriptionConflictType = "linear-changed" | "spec-changed" | "both-changed";

export type ConflictAction =
  | "overwrite-linear" | "overwrite-spec" | "report-only"
  | "skip" | "prefer-newer" | "fail";

export type ConflictResolutionMap =
  Record<DescriptionConflictType, ConflictAction>;

export interface Checkpoint {
  readonly taskUuid: string;
  readonly issueId: string;
  readonly checked?: boolean;
  readonly title: string;
  readonly issueUpdatedAt: string;      // ISO-8601
  readonly issueStateType: string;
  readonly descriptionContentHash: string; // sha256 hex of mirrored description
}

export type SyncHistoryEventKind =
  | "discovered" | "issue-created" | "matched" | "title-updated"
  | "description-updated" | "checkbox-changed" | "conflict-detected" | "rollback";

export interface SyncHistoryEvent {
  readonly kind: SyncHistoryEventKind;
  readonly at: string;                  // ISO-8601
  readonly description: string;         // human-readable, screened
  readonly references?: readonly string[]; // e.g. reversed action ids for "rollback"
}

export interface SyncStatePayload {
  readonly taskUuid: string;            // durable identity anchor (page 0 only)
  readonly frameworkMetadata: FrameworkMetadata;
  readonly descriptionContentHash: string;
  readonly cursors: { readonly lastSyncAt: string };
  readonly history: readonly SyncHistoryEvent[]; // append-only page
}

/** Compact, stable-key-order serialization into one Attachment_Metadata string value. */
export function serializeSyncStatePayload(p: SyncStatePayload): string;
export function parseSyncStatePayload(s: string): SyncStatePayload;
```

Invariants enforced by tests in `tests/unit/domain.test.ts` and the contract snapshot:

1. `taskStableSeed` output is independent of `title`, `checked`, and `issueRef`
   (property test: mutate those three, seed bytes unchanged).
2. `kind === "heading"` ⇔ `checked === undefined`.
3. `serializeSyncStatePayload → parseSyncStatePayload` is round-trip exact, and the
   serialized form contains only string/number leaf types (Attachment_Metadata rule).
4. `Match.alternatives.length <= 3`; `durableIdentity === true` implies no container-gating
   exclusion was applied (006 asserts the behavioral side).
