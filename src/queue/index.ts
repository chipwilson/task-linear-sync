/**
 * `task-linear-sync/queue` — the single public barrel for the 010 background-queue
 * module group (spec 010 plan module map; research R5: one additive `./queue` subpath).
 * `createQueueSurface` is THE composition entry the frozen 009 CLI seam lazy-binds with
 * zero arguments (contracts/queue-surface.md §2 / queue-surface-implementation.md §2);
 * the remaining named exports are the module's own seams for tests and 012 reuse.
 * Import direction: CLI → queue only — nothing here imports `src/cli`.
 */

// ── Composition root (T024) ─────────────────────────────────────────────────────────
export { createQueueSurface } from "./surface.js";
export type {
  QueueWiring,
  QueueSurfaceImpl,
  SurfaceInstallHooksInput,
  SurfaceInstallAgentHookInput,
  SurfaceEnqueueInput,
  SurfaceWorkerInput,
  SurfaceReadLastRunInput,
} from "./surface.js";

// ── Config + wiring validation (T005/T007) ──────────────────────────────────────────
export { resolveQueueConfig, validateQueueWiring } from "./config.js";
export type { QueueConfigResult } from "./config.js";

// ── Shared records (data-model §1–§5) ───────────────────────────────────────────────
export type {
  EnginePassResult,
  JobTrigger,
  NotifyOutcome,
  Notifier,
  PendingJob,
  PendingJobClaim,
  QueueClock,
  QueueLockRecord,
  QueueLockToken,
  QueueOutcomeResult,
  QueueSettings,
  SpawnWorkerOptions,
  SyncMode,
} from "./types.js";

// ── Pending-job single slot (T007) ──────────────────────────────────────────────────
export {
  claimPendingJob,
  clearPendingJob,
  mergePendingJob,
  newJobId,
  readPendingJob,
  requeuePendingJob,
  writePendingJob,
} from "./pending-job.js";
export type { MergeInput, PendingJobRead } from "./pending-job.js";

// ── Queue mutex (T009) ──────────────────────────────────────────────────────────────
export { acquireQueueLock, queueLockPath, readQueueLockRecord, releaseQueueLock } from "./queue-lock.js";
export type { QueueLockAcquireOptions, QueueLockAcquireResult } from "./queue-lock.js";

// ── Enqueue fast path (T011) ────────────────────────────────────────────────────────
export { enqueueJob } from "./enqueue.js";
export type { EnqueueDeps, EnqueueInput, EnqueueResult } from "./enqueue.js";

// ── Drain cycle + heartbeat (T012/T013) ─────────────────────────────────────────────
export { patchLastRunMarker, runDrainOnce, startClaimHeartbeat } from "./drain.js";
export type { ClaimHeartbeatHandle, DrainDeps, DrainResult } from "./drain.js";

// ── Worker loop + detached entry (T014/T025) ────────────────────────────────────────
export { runWorkerLoop } from "./worker.js";
export type { WorkerDeps, WorkerSignalHandlers } from "./worker.js";

// ── Engine pass over the frozen lane (T013) ─────────────────────────────────────────
export { runEnginePass } from "./apply-runner.js";
export type { EnginePassInput } from "./apply-runner.js";

// ── Queue-side reports (T019) ───────────────────────────────────────────────────────
export {
  newCorrelationRunId,
  writeDeferredRunReport,
  writeLockFailureRunReport,
  writeTerminalRunReport,
} from "./reports.js";
export type { DeferredReportInput, LockFailureReportInput, TerminalReportInput } from "./reports.js";

// ── Notifications (T017) ────────────────────────────────────────────────────────────
export {
  NOTIFY_SINK_ENV,
  buildNotificationContent,
  createNotifier,
  createProductionNotifier,
  makePathScanner,
  maybeNotify,
} from "./notify.js";
export type { NotifierDeps, NotifyContent } from "./notify.js";

// ── Hook installation (T021/T023) ───────────────────────────────────────────────────
export { MANAGED_HOOK_NAMES, installGitHooks } from "./git-hooks.js";
export type { GitHookSettings } from "./git-hooks.js";
export { installAgentHooks } from "./agent-hooks.js";
export type { AgentHookSettings } from "./agent-hooks.js";

// ── Detached-worker spawn lane (T015) ───────────────────────────────────────────────
export { spawnDetachedWorker } from "./spawn.js";
