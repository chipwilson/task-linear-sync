/**
 * Advisory run lock (research R8, FR-003). Acquisition: exclusive create wins; on EEXIST
 * takeover ONLY when the recorded process is provably dead (kill(pid,0) → ESRCH; EPERM
 * counts as ALIVE — fail-safe) AND age > staleLockTakeoverSeconds — both required, exactly.
 * Compare-runId-before-unlink + retry exclusive create makes simultaneous contenders
 * single-winner (edge case "lock race": the loser reports and exits; SC-004).
 */
import { chmodSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import type { RunLockRecord } from "../domain/run-records.js";
import type { StateStore } from "./paths.js";

export type { RunLockRecord } from "../domain/run-records.js";

export type LockAcquisition =
  | { readonly acquired: true; readonly record: RunLockRecord; readonly tookOverStale: boolean }
  | {
      readonly acquired: false;
      readonly heldBy: RunLockRecord;
      readonly reason: "live-process" | "within-stale-window";
    };

const MAX_ATTEMPTS = 5;

function isProcessDead(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true; // non-positive/garbage pid cannot be alive
  try {
    process.kill(pid, 0);
    return false; // signal 0 succeeded ⇒ alive
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return true; // no such process ⇒ provably dead
    // EPERM (and anything else): cannot PROVE death ⇒ counts as alive (fail-safe, SC-004).
    return false;
  }
}

function readLock(lockPath: string): RunLockRecord | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    const parsed = JSON.parse(text) as RunLockRecord;
    if (typeof parsed.runId !== "string" || typeof parsed.acquiredAt !== "string") return null;
    return { runId: parsed.runId, pid: Number(parsed.pid), acquiredAt: parsed.acquiredAt };
  } catch {
    return null; // corrupt lock file: treated below as an aged dead lock's stand-in
  }
}

/**
 * Exclusive create with NO partial-write window: content lands complete in a temp file,
 * then link(2) publishes it atomically — link fails EEXIST when the target exists and
 * readers can never observe an empty/partial lock file.
 */
function exclusiveCreate(lockPath: string, record: RunLockRecord): boolean {
  const tmp = `${lockPath}.tmp-${process.pid}-${attemptNonce++}`;
  try {
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600); // umask-independent
    } catch {
      /* Windows: ignore */
    }
    linkSync(tmp, lockPath); // atomic exclusive publish
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    try {
      unlinkSync(tmp); // harmless when link succeeded (name still referenced via target)
    } catch {
      /* temp already gone */
    }
  }
}

let attemptNonce = 0;

/**
 * Acquire the advisory run lock (lock.json). Returns acquired:true on success (including
 * via stale takeover, `tookOverStale: true`); on contention returns the holding record
 * with the refusal reason — the CALLER reports and exits; it never silently proceeds.
 */
export async function acquireRunLock(store: StateStore, runId: string): Promise<LockAcquisition> {
  const lockPath = store.paths.lock;
  let tookOverStale = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const record: RunLockRecord = {
      runId,
      pid: process.pid,
      acquiredAt: store.clock.now().toISOString(),
    };
    if (exclusiveCreate(lockPath, record)) {
      return { acquired: true, record, tookOverStale };
    }

    // Contention: evaluate the exact stale rule.
    const held = readLock(lockPath);
    if (held === null) {
      // Corrupt or vanished between the failed create and the read: retry the loop
      // (create again next iteration; a vanished lock becomes acquirable).
      continue;
    }
    const dead = isProcessDead(held.pid);
    const ageMs = store.clock.elapsed(held.acquiredAt);
    const thresholdMs = store.config.staleLockTakeoverSeconds * 1000;

    if (!dead) return { acquired: false, heldBy: held, reason: "live-process" };
    if (!(ageMs > thresholdMs)) return { acquired: false, heldBy: held, reason: "within-stale-window" };

    // Stale by BOTH conditions: compare recorded runId before removing, then retry the
    // exclusive create — a simultaneous contender that re-created the lock first wins.
    const current = readLock(lockPath);
    if (current !== null && current.runId === held.runId) {
      try {
        unlinkSync(lockPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    tookOverStale = true;
  }
  // Sustained contention across attempts: report-and-exit semantics for the loser.
  const held = readLock(lockPath);
  if (held !== null) {
    return {
      acquired: false,
      heldBy: held,
      reason: isProcessDead(held.pid) ? "within-stale-window" : "live-process",
    };
  }
  throw new Error("run lock could not be acquired: lock.json vanished under sustained contention");
}

/** Release the lock ONLY when the recorded runId matches (never release another run's lock). */
export async function releaseRunLock(store: StateStore, record: RunLockRecord): Promise<void> {
  const held = readLock(store.paths.lock);
  if (held === null || held.runId !== record.runId) return; // not ours (or already gone): no-op
  try {
    unlinkSync(store.paths.lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
