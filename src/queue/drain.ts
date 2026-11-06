/**
 * T012/T013 — The drain cycle (spec 010 FR-011..FR-014; data-model.md §5 DrainClass;
 * queue-protocol.md §3–§4). One cycle: queue-lock acquisition (timeout ⇒ report-only
 * stop) → claim re-check (live foreign claim is left alone; abandoned claims are
 * reclaimed) → claim + heartbeat → the injected engine pass → ownership re-verification
 * BEFORE any terminal mutation (a lost claim abandons the mutation, never the rival's
 * job) → classification per the protocol table. Notifications (FR-020/FR-021) fire
 * after markered outcomes and rewrite the marker's `notificationSuppressed` to truth.
 */
import { readLastRunMarker } from "../state/marker.js";
import type { StateStore } from "../state/paths.js";
import {
  buildNotificationContent,
  maybeNotify,
} from "./notify.js";
import { claimPendingJob, clearPendingJob, readPendingJob, requeuePendingJob } from "./pending-job.js";
import { newCorrelationRunId, writeDeferredRunReport, writeLockFailureRunReport, writeTerminalRunReport } from "./reports.js";
import { acquireQueueLock, releaseQueueLock } from "./queue-lock.js";
import type { EnginePassResult, Notifier, PendingJob, QueueClock, QueueSettings } from "./types.js";

export type { EnginePassResult } from "./types.js";

/** Result of one drain cycle (data-model §5 DrainClass + detail). */
export interface DrainResult {
  readonly status: "applied" | "empty" | "deferred" | "retried" | "retry-limit" | "terminal-refused" | "stopped";
  readonly detail?: string;
  readonly runId?: string;
}

export interface DrainDeps {
  readonly workerId: string;
  readonly pid: number;
  readonly clock: QueueClock;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rng?: () => number;
  /** The engine-pass port: production wires `runEnginePass`; tests inject fakes. */
  readonly runApply: (job?: PendingJob) => Promise<EnginePassResult>;
  /** Present ⇒ markered outcomes notify (FR-020); absent ⇒ notifications off. */
  readonly notifier?: Notifier;
}

/**
 * Heartbeat (protocol §4): refresh OUR claim every claimTimeout/3 so a long apply pass
 * is never mistaken for an abandoned claim. Never touches another worker's claim; the
 * loop is fire-and-forget and `stop()` ends it after the pending wait.
 */
export interface ClaimHeartbeatHandle {
  stop(): void;
}

export function startClaimHeartbeat(
  store: StateStore,
  _settings: QueueSettings,
  o: {
    workerId: string;
    pid: number;
    clock: QueueClock;
    /** Test seam ONLY — production waits on its own cancellable, unref'd timer. */
    sleep?: (ms: number) => Promise<void>;
    isStopped?: () => boolean;
  },
): ClaimHeartbeatHandle {
  let stopped = false;
  let wake: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Default wait: an unref'd timer `stop()` cancels — a synchronously resolving sleep
  // must never be used inside the drain (it would interleave claim writes mid-pass).
  const wait =
    o.sleep ??
    ((ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
        timer.unref?.();
      }));
  const loop = (async (): Promise<void> => {
    while (!stopped && o.isStopped?.() !== true) {
      await wait(intervalOf(store));
      if (stopped || o.isStopped?.() === true) break;
      try {
        const { job } = await readPendingJob(store);
        if (job?.claim?.workerId === o.workerId) {
          await claimPendingJob(store, job, { workerId: o.workerId, pid: o.pid });
        }
      } catch {
        /* best effort — the next beat retries */
      }
    }
  })();
  void loop.catch(() => undefined);
  return {
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
    },
  };
}

function intervalOf(store: StateStore): number {
  return Math.max(1, Math.floor((store.config.worker.claimTimeoutSeconds * 1000) / 3));
}

export interface LastRunPatch {
  readonly notificationSuppressed: boolean;
}

/** Rewrite one marker field (notification truth) without touching the frozen rest. */
export async function patchLastRunMarker(store: StateStore, patch: LastRunPatch): Promise<void> {
  try {
    const marker = await readLastRunMarker(store);
    if (marker === null) return; // no report written — nothing to patch
    await store.writeJson("last-run.json", { ...marker, notificationSuppressed: patch.notificationSuppressed });
  } catch {
    /* best effort */
  }
}

async function notifyOutcome(
  store: StateStore,
  settings: QueueSettings,
  deps: DrainDeps,
  outcome: "completed" | "failed",
  detail: string,
): Promise<void> {
  if (deps.notifier === undefined) return;
  const content = buildNotificationContent({ toolId: store.config.toolId, outcome, detail });
  const delivery = await maybeNotify(deps.notifier, { enabled: settings.notificationsEnabled, content });
  await patchLastRunMarker(store, { notificationSuppressed: delivery !== "delivered" });
}

/** One drain cycle. Never throws for protocol-level outcomes; job mutations are owned-checked. */
export async function runDrainOnce(store: StateStore, settings: QueueSettings, deps: DrainDeps): Promise<DrainResult> {
  // 1. Queue lock — the drain-attempt mutex (enqueue never takes it; workers contend).
  const lock = await acquireQueueLock(store, {
    workerId: deps.workerId,
    pid: deps.pid,
    clock: deps.clock,
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.rng !== undefined ? { rng: deps.rng } : {}),
    timeoutSeconds: settings.lockTimeoutSeconds,
  });
  if (!lock.acquired) {
    const heldBy = lock.heldBy?.workerId ?? "another worker";
    const jobId = (await readPendingJob(store).catch(() => null))?.job?.jobId;
    await writeLockFailureRunReport(store, {
      reason: "lock-held",
      message: `queue lock held by ${heldBy} past the ${settings.lockTimeoutSeconds}s timeout — this drain cycle stops`,
      ...(jobId !== undefined ? { jobId } : {}),
    });
    return { status: "stopped", detail: `queue lock still held after ${settings.lockTimeoutSeconds}s (by ${heldBy}) — stopped this drain cycle` };
  }

  try {
    // 2. Single-slot read.
    const read = await readPendingJob(store);
    const job = read.job;
    if (job === null) {
      return {
        status: "empty",
        detail: read.corrupt
          ? "pending-job record is corrupt — waiting for the next enqueue to replace it"
          : "no pending job — nothing to drain",
      };
    }

    // 3. Claim discipline: a LIVE foreign claim is left alone; abandoned claims reclaim.
    if (job.claim !== null && job.claim.workerId !== deps.workerId) {
      const ageMs = deps.clock.now().getTime() - Date.parse(job.claim.claimedAt);
      if (ageMs <= store.config.worker.claimTimeoutSeconds * 1000) {
        return {
          status: "stopped",
          detail: `job ${job.jobId} carries a live claim by worker ${job.claim.workerId} — no second worker applies it`,
        };
      }
    }

    // 4. Claim + heartbeat, then THE engine pass.
    const claimed = await claimPendingJob(store, job, { workerId: deps.workerId, pid: deps.pid });
    const heartbeat = startClaimHeartbeat(store, settings, { workerId: deps.workerId, pid: deps.pid, clock: deps.clock });
    let pass: EnginePassResult;
    try {
      pass = await deps.runApply(claimed);
    } finally {
      heartbeat.stop();
    }

    // 5. Ownership re-verification BEFORE any terminal mutation (protocol §4 step 6).
    const current = await readPendingJob(store);
    if (current.job === null) {
      return { status: "stopped", detail: `pending job ${claimed.jobId} vanished during the pass — the mutation is abandoned` };
    }
    if (current.job.jobId !== claimed.jobId || current.job.claim?.workerId !== deps.workerId) {
      return {
        status: "stopped",
        detail: `claim for job ${claimed.jobId} was lost to another worker during the pass — the mutation is abandoned`,
      };
    }

    // 6. Classification table (data-model §5; queue-protocol §4).
    switch (pass.status) {
      case "applied": {
        await clearPendingJob(store);
        await notifyOutcome(store, settings, deps, "completed", pass.detail ?? "sync completed");
        return { status: "applied", detail: pass.detail ?? "sync applied", ...(pass.runId !== undefined ? { runId: pass.runId } : {}) };
      }
      case "refused": {
        const code = pass.failureCode ?? "REFUSED";
        if (code === "LOCK_HELD") {
          // Transient engine-lock contention: report-only deferral, NO retry increment.
          await writeDeferredRunReport(store, {
            runId: pass.runId,
            job: current.job,
            reason: "lock-held",
            message: pass.detail ?? "sync state lock held by another process",
          });
          await requeuePendingJob(store, current.job, current.job.retryCount);
          return { status: "deferred", detail: `deferred (${code}) — the job stays queued without a retry increment`, runId: pass.runId };
        }
        // A retry would hit the identical gate: terminal consumption.
        await writeTerminalRunReport(store, {
          runId: pass.runId,
          job: current.job,
          errorCode: code,
          message: pass.detail ?? `sync refused (${code})`,
        });
        await clearPendingJob(store);
        await notifyOutcome(store, settings, deps, "failed", `sync refused: ${code}`);
        return { status: "terminal-refused", detail: `refused (${code}) — the job is consumed, retrying would fail identically`, runId: pass.runId };
      }
      case "failed": {
        const attempts = current.job.retryCount + 1;
        if (attempts > settings.maxRetries) {
          await writeTerminalRunReport(store, {
            runId: pass.runId,
            job: current.job,
            errorCode: "RETRY_LIMIT",
            message: `giving up after ${attempts} attempts — last error: ${pass.error ?? "unknown error"}`,
          });
          await clearPendingJob(store);
          await notifyOutcome(store, settings, deps, "failed", `sync failed: giving up after ${attempts} attempts`);
          return { status: "retry-limit", detail: `giving up after ${attempts} attempts (RETRY_LIMIT)`, runId: pass.runId };
        }
        await requeuePendingJob(store, current.job, attempts);
        return {
          status: "retried",
          detail: `pass failed (${pass.error ?? "error"}) — re-queued with retryCount ${attempts}`,
          runId: pass.runId,
        };
      }
    }
  } finally {
    await releaseQueueLock(store, lock.token);
  }
}

/** Correlation id helper for callers that report without an engine run (protocol §6). */
export { newCorrelationRunId };
