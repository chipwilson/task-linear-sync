/**
 * T005 — Shared record types for the background queue (spec 010; data-model.md §1–§5,
 * contracts/queue-protocol.md). Structural mirrors of the on-disk formats; the queue
 * group never imports `src/cli` (import direction CLI → queue only), so the seam types
 * are re-declared structurally here / in surface.ts.
 */

/** Job mode hint carried by every enqueue (data-model §2). */
export type SyncMode = "bootstrap" | "sync";

/** Trigger vocabulary recorded on the pending job (hook name, "manual", "agent"). */
export type JobTrigger = string;

export interface PendingJobClaim {
  readonly workerId: string;
  readonly pid: number;
  readonly claimedAt: string;
}

/** `pending-job.json` — the single deduplicated slot (queue-protocol §2). */
export interface PendingJob {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly mode: SyncMode;
  readonly trigger: JobTrigger;
  readonly enqueuedAt: string;
  readonly updatedAt: string;
  readonly retryCount: number;
  readonly claim: PendingJobClaim | null;
}

/** `queue-lock.json` — the drain-attempt mutex record (queue-protocol §3). */
export interface QueueLockRecord {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

/** Token proving ownership for release; the exact record bytes (queue-lock §3). */
export type QueueLockToken = QueueLockRecord;

/**
 * The validated, defaults-filled `queue` config group (data-model §4, research R2).
 * `claimTimeoutSeconds` is NOT here — it stays on the frozen `config.worker` group.
 */
export interface QueueSettings {
  readonly workerDelaySeconds: number; // 1..3600, default 75
  readonly lockTimeoutSeconds: number; // 1..300, default 30
  readonly maxRetries: number; // 1..100, default 5
  readonly notificationsEnabled: boolean; // default true
  readonly autoAcceptLowConfidence: boolean; // default false (never widened implicitly)
  readonly hookScriptPrefix: string; // default config.binName
  readonly hooksDirectory: string | undefined; // absolute override, default absent
  readonly agentHooksDirectory: string | undefined; // override for agent scaffolds
}

/** Queue result shape — structurally identical to the frozen 009 `QueueOutcome`. */
export interface QueueOutcomeResult {
  readonly status: "installed" | "skipped" | "enqueued" | "stopped" | "refused";
  readonly detail?: string;
  readonly installed?: readonly string[];
  readonly path?: string;
  readonly jobId?: string;
}

/** Outcome of one notification attempt (Notifier seam, queue-protocol §6). */
export type NotifyOutcome = "delivered" | "undeliverable" | "suppressed";

/** The Notifier seam shape (harness fake implements the same member). */
export interface Notifier {
  notify(o: { title: string; body: string }): Promise<NotifyOutcome>;
}

/** Spawn hand-off options recorded for the detached worker (queue-protocol §5). */
export interface SpawnWorkerOptions {
  readonly entry: string;
  readonly repositoryRoot: string;
  readonly detached?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Result of one engine pass over the frozen lane (queue-protocol §4 step 4–5). */
export interface EnginePassResult {
  readonly status: "applied" | "refused" | "failed";
  /** Correlation id for reports (engine runId when the engine got that far). */
  readonly runId: string;
  /** When status === "refused": the first gate failure code (complete listing in detail). */
  readonly failureCode?: string;
  readonly detail?: string;
  /** When status === "failed": sanitized exception summary. */
  readonly error?: string;
  /** Engine-written report paths when the engine produced its own report. */
  readonly reportPaths?: { readonly json: string; readonly markdown: string };
}

/** Injectable clock (frozen state Clock shape). */
export interface QueueClock {
  now(): Date;
  elapsed(sinceIso: string): number;
}
