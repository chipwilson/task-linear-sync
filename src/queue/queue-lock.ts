/**
 * T009 — The queue drain mutex (FR-002; queue-protocol.md §3; research R4). Mirrors the
 * frozen src/state/lock.ts precedent: full content to `queue-lock.json.tmp-<pid>-<n>`,
 * published with `link(2)` (EEXIST on contention, readers never see partial bytes).
 * Liveness: `kill(pid,0)` ⇒ ESRCH is dead, EPERM counts ALIVE (frozen fail-safe).
 * The retry loop waits on the INJECTED sleep only — 50 ms + jitter step, capped by the
 * remaining timeout, so virtual-clock tests assert exact totals.
 */
import { constants } from "node:fs";
import { access, link, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StateStore } from "../state/paths.js";
import type { QueueClock, QueueLockRecord, QueueLockToken } from "./types.js";

export type { QueueLockRecord, QueueLockToken };

const BASE_STEP_MS = 50;
const JITTER_MS = 25;

let tmpSeq = 0;

export function queueLockPath(store: StateStore): string {
  // Derived from the frozen paths.queue — never a new resolution rule (§1).
  return join(store.root, "queue-lock.json");
}

async function readRecord(target: string): Promise<QueueLockRecord | null> {
  try {
    const raw = await readFile(target, "utf8");
    if (raw.length === 0) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed["schemaVersion"] === 1 &&
      typeof parsed["workerId"] === "string" &&
      typeof parsed["pid"] === "number" &&
      typeof parsed["acquiredAt"] === "string"
    ) {
      return {
        schemaVersion: 1,
        workerId: parsed["workerId"] as string,
        pid: parsed["pid"] as number,
        acquiredAt: parsed["acquiredAt"] as string,
      };
    }
    return null; // foreign schema ⇒ treated like a stale/corrupt record
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** kill(pid,0): ESRCH ⇒ provably dead; EPERM or success ⇒ ALIVE (frozen fail-safe rule). */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface QueueLockAcquireOptions {
  readonly workerId: string;
  readonly pid: number;
  readonly clock: QueueClock;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rng?: () => number;
  readonly timeoutSeconds: number;
}

export type QueueLockAcquireResult =
  | { readonly acquired: true; readonly token: QueueLockToken }
  | { readonly acquired: false; readonly held: true; readonly heldBy: QueueLockRecord | null; readonly timeoutSeconds: number };

/**
 * Exclusive create via temp + link(2); on contention: take over provably-dead or corrupt
 * holders, re-acquire one's own stale record (same-worker restart), otherwise retry with
 * the injected sleep until `timeoutSeconds`, then report `{acquired:false, held:true}`.
 */
export async function acquireQueueLock(store: StateStore, o: QueueLockAcquireOptions): Promise<QueueLockAcquireResult> {
  const target = queueLockPath(store);
  const sleep = o.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const rng = o.rng ?? Math.random;
  const deadlineMs = o.timeoutSeconds * 1000;
  const startedAt = o.clock.now().getTime();

  for (;;) {
    const record: QueueLockRecord = {
      schemaVersion: 1,
      workerId: o.workerId,
      pid: o.pid,
      acquiredAt: o.clock.now().toISOString(),
    };
    const tmp = `${target}.tmp-${process.pid}-${(tmpSeq += 1)}`;
    let published = false;
    try {
      await store.ensure();
      await writeFile(tmp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        await link(tmp, target); // atomic publish — EEXIST on contention
        published = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } finally {
      await unlink(tmp).catch(() => undefined); // never leave temp residue
    }

    if (published) return { acquired: true, token: record };

    const held = await readRecord(target);
    if (held === null) {
      // vanished between create-fail and read (contention released) ⇒ immediate retry;
      // present but unparsable (corrupt/foreign schema) ⇒ clear it and retry (§1 posture).
      if (await exists(target)) await unlink(target).catch(() => undefined);
      continue;
    }
    if (!isPidAlive(held.pid) || held.workerId === o.workerId) {
      // provably-dead holder (ESRCH) or our own record (same-worker restart) ⇒ take over.
      await unlink(target).catch(() => undefined);
      continue;
    }
    const elapsed = o.clock.now().getTime() - startedAt;
    const remaining = deadlineMs - elapsed;
    if (remaining <= 0) {
      return { acquired: false, held: true, heldBy: held, timeoutSeconds: o.timeoutSeconds };
    }
    await sleep(Math.min(BASE_STEP_MS + Math.floor(rng() * JITTER_MS), remaining));
  }
}

/**
 * Release: unlink iff the record carries one's own token (workerId + acquiredAt — a
 * reclaimed-then-recreated lock is NOT ours); idempotent on ENOENT (§3).
 */
export async function releaseQueueLock(store: StateStore, token: QueueLockToken): Promise<boolean> {
  const target = queueLockPath(store);
  const held = await readRecord(target);
  if (held === null) {
    return !(await exists(target)); // ENOENT ⇒ idempotent success; a corrupt record stays
  }
  if (held.workerId !== token.workerId || held.acquiredAt !== token.acquiredAt) {
    return false; // foreign or stale token — refuse, leave the record
  }
  try {
    await unlink(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** Introspection for diagnostics/tests; never mutates. */
export async function readQueueLockRecord(store: StateStore): Promise<QueueLockRecord | null> {
  return readRecord(queueLockPath(store));
}

/** Touch to keep the lock fresh (unused by the base protocol — export for completeness). */
export async function statQueueLock(store: StateStore): Promise<boolean> {
  try {
    await stat(queueLockPath(store));
    return true;
  } catch {
    return false;
  }
}
