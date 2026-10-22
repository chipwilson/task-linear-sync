/**
 * Run-record shapes (frozen — behavior 008/010; shape here).
 * Mirror: data-model.md §10–14, contracts/run-state.md.
 */
import type { Checkpoint } from "./checkpoint.js";

/** Per-step resumability state (008). */
export type AuditStepState = "pending" | "applied" | "rolled-back" | "conflict-halted";

/** One per planned op incl. attachment upserts (target issue, URL, prior metadata). */
export interface AuditOperation {
  readonly opId: string;
  readonly kind: string;
  /** Target issue of the operation. */
  readonly targetIssueId: string;
  /** Deterministic attachment URL touched (canonical or continuation). */
  readonly attachmentUrl?: string;
  /** Attachment metadata prior to the operation (rollback material). */
  readonly priorMetadata?: Readonly<Record<string, string | number>>;
  readonly stepState: AuditStepState;
}

/**
 * Audit manifest (data-model §10). Encryption envelope + expiry rules in state/manifest.ts;
 * a manifest-disabled run has no journal and rollback MUST refuse (gate MANIFEST_UNJOURNALED).
 */
export interface AuditManifest {
  readonly runId: string;
  /** ISO-8601. Drives expiry; duplicated in the unencrypted envelope header (R9). */
  readonly createdAt: string;
  readonly repoRoot: string;
  readonly planId: string;
  /** Rollback material. */
  readonly fileBackups: ReadonlyArray<{
    readonly path: string;
    readonly beforeContentHash: string;
    readonly beforeContent: string;
  }>;
  readonly checkpointBefore: readonly Checkpoint[];
  readonly operations: readonly AuditOperation[];
}

export type CreateIntentStatus = "pending" | "confirmed-created" | "indeterminate" | "reconciled";

/**
 * Create-intent bookkeeping (FR-004, R10). `pending` persisted durably BEFORE the create
 * attempt; `reconciled` written by 008; indeterminate creates are never auto-replayed.
 */
export interface CreateIntent {
  /** Unique per attempt. */
  readonly intentId: string;
  readonly runId: string;
  /** Indexed for reconciliation (008). */
  readonly taskUuid: string;
  readonly targetTeamKey: string;
  readonly targetProject: string;
  readonly status: CreateIntentStatus;
  /** ISO-8601, injected clock. */
  readonly createdAt: string;
  /** ISO-8601, injected clock. */
  readonly updatedAt: string;
}

/** Dedup-queue record (behavior 010; single deduplicated record, 001 R13 thresholds). */
export interface PendingJob {
  /** ISO-8601, injected clock. */
  readonly enqueuedAt: string;
  readonly trigger: string;
  readonly claim: { readonly workerId: string; readonly claimedAt: string } | null;
}

/** last-run.json — updated whenever a run produces a report (FR-005) / queued run completes (010). */
export interface LastRunMarker {
  readonly runId: string;
  readonly outcome: "completed" | "failed" | "aborted";
  /** ISO-8601, injected clock. */
  readonly completedAt: string;
  readonly reportPaths: { readonly json: string; readonly markdown: string } | null;
  readonly notificationSuppressed: boolean;
}

/** Advisory run lock record at lock.json (acquisition/takeover rules R8 in state/lock.ts). */
export interface RunLockRecord {
  readonly runId: string;
  readonly pid: number;
  /** ISO-8601 UTC, injected clock. */
  readonly acquiredAt: string;
}

/** Hook Definition: scaffolded agent-hook file (framework-specific dir, `command` action). */
export interface HookDefinition {
  readonly action: "command";
  /** Enqueue entry point invoked by the hook. */
  readonly command: string;
  /** Framework-specific directory the definition is scaffolded into. */
  readonly directory: string;
}

/**
 * Hook Block: marker-bounded managed region inside a git hook script — managed start/end
 * marker lines plus enclosed enqueue invocation; content outside markers preserved
 * byte-for-byte (behavior 010; shape frozen here).
 */
export interface HookBlock {
  readonly startMarker: string;
  readonly endMarker: string;
  readonly enclosedCommand: string;
}
