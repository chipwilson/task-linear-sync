/**
 * T007 — The single-slot pending-job record over the frozen StateStore (data-model.md §2,
 * queue-protocol.md §2): atomic temp+rename writes at the frozen `paths.queue`, merge
 * discipline (keep jobId/enqueuedAt, latest mode, retryCount 0, claim NEVER touched) and
 * the self-healing read posture.
 */
import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

import type { StateStore } from "../state/paths.js";
import type { PendingJob, SyncMode } from "./types.js";

export type { PendingJob };

/** Fresh 16-hex job id (crypto entropy — deterministic tests assert format, not value). */
export function newJobId(): string {
  return randomBytes(8).toString("hex");
}

export interface PendingJobRead {
  readonly job: PendingJob | null;
  /** True when bytes exist but no valid record parses (self-healing posture). */
  readonly corrupt: boolean;
}

function isValidRecord(value: unknown): value is PendingJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (r["schemaVersion"] !== 1) return false;
  if (typeof r["jobId"] !== "string" || !/^[0-9a-z]{16}$/.test(r["jobId"])) return false;
  if (r["mode"] !== "bootstrap" && r["mode"] !== "sync") return false;
  if (typeof r["trigger"] !== "string") return false;
  if (typeof r["enqueuedAt"] !== "string" || Number.isNaN(Date.parse(r["enqueuedAt"]))) return false;
  if (typeof r["updatedAt"] !== "string" || Number.isNaN(Date.parse(r["updatedAt"]))) return false;
  if (typeof r["retryCount"] !== "number" || !Number.isFinite(r["retryCount"]) || r["retryCount"] < 0) return false;
  const claim = r["claim"];
  if (claim !== null) {
    if (typeof claim !== "object" || claim === null) return false;
    const c = claim as Record<string, unknown>;
    if (typeof c["workerId"] !== "string" || typeof c["pid"] !== "number" || typeof c["claimedAt"] !== "string") {
      return false;
    }
  }
  return true;
}

/** Read the slot. Absent / zero-length ⇒ {job:null, corrupt:false}; unparsable ⇒ corrupt. */
export async function readPendingJob(store: StateStore): Promise<PendingJobRead> {
  const target = store.paths.queue; // already absolute (root-relative name used for writeJson)
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { job: null, corrupt: false };
    throw error; // EACCES/ENOTDIR etc. — caller maps (protocol §2.5)
  }
  if (text.length === 0) return { job: null, corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { job: null, corrupt: true };
  }
  if (!isValidRecord(parsed)) return { job: null, corrupt: true };
  return { job: Object.freeze({ ...parsed, claim: parsed.claim === null ? null : Object.freeze({ ...parsed.claim }) }) as PendingJob, corrupt: false };
}

/** Atomic owner-only write through the frozen store (throws fs errors for the caller). */
export async function writePendingJob(store: StateStore, job: PendingJob): Promise<void> {
  await store.writeJson("pending-job.json", {
    schemaVersion: 1,
    jobId: job.jobId,
    mode: job.mode,
    trigger: job.trigger,
    enqueuedAt: job.enqueuedAt,
    updatedAt: job.updatedAt,
    retryCount: job.retryCount,
    claim: job.claim,
  });
}

/** Remove the slot; absent-clear is a no-op (queue-protocol §4 terminal consumption). */
export async function clearPendingJob(store: StateStore): Promise<void> {
  const target = store.paths.queue;
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export interface MergeInput {
  readonly mode: SyncMode;
  readonly trigger: string;
}

/**
 * Merge-write (queue-protocol §2 step 3): an existing record keeps `jobId`/`enqueuedAt`,
 * takes the latest `mode`, restarts `retryCount` at 0 and NEVER has its `claim` touched —
 * a live claim survives (FR-003). Absent or corrupt bytes create a fresh record
 * (self-healing: durability applies only to records we wrote).
 */
export async function mergePendingJob(store: StateStore, input: MergeInput): Promise<PendingJob> {
  const existing = await readPendingJob(store);
  const now = store.clock.now().toISOString();
  const merged: PendingJob =
    existing.job === null
      ? {
          schemaVersion: 1,
          jobId: newJobId(),
          mode: input.mode,
          trigger: input.trigger,
          enqueuedAt: now,
          updatedAt: now,
          retryCount: 0,
          claim: null,
        }
      : {
          schemaVersion: 1,
          jobId: existing.job.jobId,
          mode: input.mode,
          trigger: input.trigger,
          enqueuedAt: existing.job.enqueuedAt,
          updatedAt: now,
          retryCount: 0,
          claim: existing.job.claim,
        };
  await writePendingJob(store, merged);
  return merged;
}

/** Re-queue after a retryable drain outcome: retryCount+1, claim cleared (queue-protocol §4). */
export async function requeuePendingJob(store: StateStore, job: PendingJob, retryCount: number): Promise<PendingJob> {
  const updated: PendingJob = {
    ...job,
    updatedAt: store.clock.now().toISOString(),
    retryCount,
    claim: null,
  };
  await writePendingJob(store, updated);
  return updated;
}

/** Claim: one atomic rewrite embedding the claim token into the single record (§4 step 3). */
export async function claimPendingJob(
  store: StateStore,
  job: PendingJob,
  claim: { workerId: string; pid: number },
): Promise<PendingJob> {
  const now = store.clock.now().toISOString();
  const updated: PendingJob = {
    ...job,
    updatedAt: now,
    claim: { workerId: claim.workerId, pid: claim.pid, claimedAt: now },
  };
  await writePendingJob(store, updated);
  return updated;
}
