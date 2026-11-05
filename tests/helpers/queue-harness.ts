/**
 * T003 [P] — shared hermetic harness for all 010 queue tests
 * (`specs/010-background-queue-sync-hooks`), pattern of `cli-harness.ts`.
 *
 * IMPORTANT WIRING SEAM: this file COMPILES WITHOUT `src/queue` existing — it never
 * imports `src/queue/**`. The record shapes are re-declared structurally here (the
 * queue-harness is the test-side mirror of contracts/queue-protocol.md §2–§3) and the
 * wiring bag is handed to tests as a plain object; test files cast it to `QueueWiring`
 * when calling `createQueueSurface(...)`.
 *
 * Public API
 * - `makeQueueHarness(options?)` — temp root with `repo/` (a fake `.git/hooks` tree —
 *   no git binary) + harness-owned `state/` state dir, resolved config through the
 *   FROZEN `loadConfig` (env cleared first — tests opt members back in), a `FakeClock`
 *   (start 2026-01-01T00:00:00.000Z unless overridden), the frozen `StateStore` over
 *   that dir, and injectable seams with recorders: `sleep` (advances the clock
 *   synchronously — zero wall-clock waits, research R13), `spawnWorker`, `notifier`,
 *   `which`. `harness.wiring(overrides?)` merges the recorder defaults with per-test
 *   overrides for `createQueueSurface(wiring)`. ALWAYS `await h.dispose()` in `finally`.
 * - Filesystem helpers for raw pre/post-condition assertions (never a queue-module
 *   import): `writePendingJob(dir, job)`, `readPendingJob(dir)`, `readQueueLock(dir)`,
 *   `stripHookBlock(text, markers)`, plus `harness.readonlyStateDir(on)` for the
 *   unwritable-state-dir refusal fixtures.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, type ConfigOverrides, type ResolvedConfig } from "task-linear-sync/config";
import { createStateStore, type StateStore, type StateStorePaths } from "task-linear-sync/state";

import { FakeClock } from "./test-utils.js";

const HARNESS_START_ISO = "2026-01-01T00:00:00.000Z";

// ──────────────────────────────────────────────────────────── structural record shapes

/** Test-side mirror of contracts/queue-protocol.md §2 (single-slot pending record). */
export interface PendingJobRecord {
  schemaVersion: 1;
  jobId: string;
  mode: "bootstrap" | "sync";
  trigger: string;
  enqueuedAt: string;
  updatedAt: string;
  retryCount: number;
  claim: { workerId: string; pid: number; claimedAt: string } | null;
}

/** Test-side mirror of contracts/queue-protocol.md §3 (drain-attempt mutex record). */
export interface QueueLockRecord {
  schemaVersion: 1;
  workerId: string;
  pid: number;
  acquiredAt: string;
}

/** Spawn invocation recorded by the fake `spawnWorker` (queue-protocol §5 shape). */
export interface SpawnCall {
  entry: string;
  repositoryRoot: string;
  configFile?: string;
  detached?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Notification attempt recorded by the fake `Notifier`. */
export interface NotifyCall {
  title: string;
  body: string;
}

// ──────────────────────────────────────────────────────────── filesystem helpers

export function pendingJobPath(stateDir: string): string {
  return join(stateDir, "pending-job.json");
}

/** Raw (non-atomic) pending-job write for corrupt/seed fixtures. */
export function writePendingJob(stateDir: string, job: PendingJobRecord | string | null): void {
  const target = pendingJobPath(stateDir);
  mkdirSync(stateDir, { recursive: true });
  if (job === null) {
    rmSync(target, { force: true });
    return;
  }
  writeFileSync(target, typeof job === "string" ? job : JSON.stringify(job), "utf8");
}

/** `job: null` for absent/zero-length/unparsable records; `corrupt: true` when bytes exist but no record parses (queue-protocol §2 self-healing posture). */
export function readPendingJob(stateDir: string): { job: PendingJobRecord | null; corrupt: boolean } {
  let text: string;
  try {
    text = readFileSync(pendingJobPath(stateDir), "utf8");
  } catch {
    return { job: null, corrupt: false };
  }
  if (text.length === 0) return { job: null, corrupt: false };
  try {
    const parsed = JSON.parse(text) as PendingJobRecord;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.schemaVersion === 1 &&
      typeof parsed.jobId === "string" &&
      (parsed.mode === "bootstrap" || parsed.mode === "sync") &&
      typeof parsed.enqueuedAt === "string" &&
      (parsed.claim === null || typeof parsed.claim === "object")
    ) {
      return { job: parsed, corrupt: false };
    }
  } catch {
    /* fall through: corrupt */
  }
  return { job: null, corrupt: true };
}

export function readQueueLock(stateDir: string): QueueLockRecord | null {
  try {
    return JSON.parse(readFileSync(join(stateDir, "queue-lock.json"), "utf8")) as QueueLockRecord;
  } catch {
    return null;
  }
}

/** Default marker pair (hook-installation.md §1.1 for the default toolId). */
export const DEFAULT_HOOK_MARKERS: readonly [string, string] = [
  "# >>> task-linear-sync managed hooks v1 >>>",
  "# <<< task-linear-sync managed hooks v1 <<<",
];

/** Remove the marker-delimited region (inclusive) from `text` — golden-bytes assertions. */
export function stripHookBlock(text: string, markers: readonly [string, string] = DEFAULT_HOOK_MARKERS): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const start = lines.indexOf(markers[0]);
  const end = lines.indexOf(markers[1]);
  if (start === -1 || end === -1 || end < start) return text;
  const out = [...lines.slice(0, start), ...lines.slice(end + 1)];
  // Collapse the blank line the splice contract inserts before the block.
  if (start > 0 && out[start] === "" && out[start + 1] === "") out.splice(start, 1);
  return out.join(eol);
}

// ──────────────────────────────────────────────────────────── makeQueueHarness

export interface QueueHarnessOptions {
  /**
   * Additive config overrides (frozen `loadConfig` programmatic layer). Typed loosely so
   * the 010-owned `queue` group passes through the frozen key-agnostic deep-merge
   * (research R2) without a cast at every call site.
   */
  readonly config?: Record<string, unknown>;
  /** Fake-clock start (default HARNESS_START_ISO). */
  readonly start?: string;
  /** Extra env members for the wiring `env` bag (credential pre-checks etc.). */
  readonly env?: Record<string, string | undefined>;
  /** When false, no `.git` tree is pre-created (default true). */
  readonly gitDir?: boolean;
}

export interface QueueHarness {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly stateDir: string;
  readonly config: ResolvedConfig;
  readonly store: StateStore;
  readonly paths: StateStorePaths;
  readonly clock: FakeClock;
  /** `sleep(ms)` invocations recorded (protocol timing assertions never wait on wall clock). */
  readonly sleeps: number[];
  readonly sleep: (ms: number) => Promise<void>;
  readonly spawns: SpawnCall[];
  readonly spawnWorker: (call: SpawnCall) => void;
  /** Throw-instead recorder: when set, `spawnWorker` throws (spawn-failure fixtures). */
  spawnFailure: Error | null;
  readonly notifications: NotifyCall[];
  readonly notifier: { notify(o: NotifyCall): Promise<"delivered" | "undeliverable" | "suppressed"> };
  /** Injection: notification delivery outcome of the fake notifier. */
  notifyOutcome: "delivered" | "undeliverable" | "suppressed";
  readonly whichMap: Record<string, string | null>;
  readonly which: (tool: string) => string | null;
  /** Wiring env bag (starts cleared; `env` option + notify sink re-added). */
  readonly env: Record<string, string | undefined>;
  /** File sink honored by the DEFAULT production notifier (quickstart §7 lane). */
  readonly notifySinkPath: string;
  /** Merged wiring bag: recorder defaults, then per-test `overrides` (cast at the seam). */
  wiring(overrides?: Record<string, unknown>): Record<string, unknown>;
  /** chmod 0o500/0o700 on the state dir — unwritable-enqueue fixtures. */
  readonly readonlyStateDir: (on: boolean) => void;
  dispose(): void;
}

export async function makeQueueHarness(options: QueueHarnessOptions = {}): Promise<QueueHarness> {
  const root = mkdtempSync(join(tmpdir(), "tls-010-h-"));
  const repositoryRoot = join(root, "repo");
  const stateDir = join(root, "state");
  mkdirSync(repositoryRoot, { recursive: true });
  if (options.gitDir !== false) {
    mkdirSync(join(repositoryRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  }

  // env cleared first (T003): only harness-owned members are visible to the surface.
  const env: Record<string, string | undefined> = { ...options.env };
  const notifySinkPath = join(root, "notify-sink.log");
  env.TASK_LINEAR_SYNC_TEST_NOTIFY = notifySinkPath;

  const config = loadConfig({
    overrides: { stateDirectory: stateDir, ...(options.config as ConfigOverrides | undefined) },
    env: {},
  });
  const clock = new FakeClock(options.start ?? HARNESS_START_ISO);
  const store = createStateStore({ repositoryRoot, config, clock });
  await store.ensure();

  const sleeps: number[] = [];
  function sleep(ms: number): Promise<void> {
    sleeps.push(ms);
    clock.advanceMs(ms); // synchronous virtual advance (research R13)
    return Promise.resolve();
  }

  const spawns: SpawnCall[] = [];
  const harness: Omit<QueueHarness, "dispose" | "wiring" | "notifySinkPath"> = {
    root,
    repositoryRoot,
    stateDir,
    config,
    store,
    paths: store.paths,
    clock,
    sleeps,
    sleep,
    spawns,
    spawnWorker(call: SpawnCall): void {
      if (harnessRef.spawnFailure !== null) throw harnessRef.spawnFailure;
      spawns.push(call);
    },
    spawnFailure: null,
    notifications: [],
    notifier: {
      async notify(o: NotifyCall) {
        harnessRef.notifications.push(o);
        return harnessRef.notifyOutcome;
      },
    },
    notifyOutcome: "delivered",
    whichMap: {},
    which(tool: string): string | null {
      return harnessRef.whichMap[tool] ?? null;
    },
    env,
    readonlyStateDir(on: boolean): void {
      chmodSync(stateDir, on ? 0o500 : 0o700);
    },
  };
  const harnessRef: QueueHarness = {
    ...harness,
    notifySinkPath,
    wiring(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        clock,
        sleep,
        spawnWorker: harnessRef.spawnWorker,
        notifier: harnessRef.notifier,
        which: harnessRef.which,
        env: harnessRef.env,
        ...overrides,
      };
    },
    dispose(): void {
      try {
        harnessRef.readonlyStateDir(false);
      } catch {
        /* already gone */
      }
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  return harnessRef;
}

/** True when the state dir currently rejects writes (used around readonly fixtures). */
export function dirWritable(dir: string): boolean {
  try {
    const probe = join(dir, `.probe-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(probe, "", "utf8");
    rmSync(probe, { force: true });
    return existsSync(dir);
  } catch {
    return false;
  }
}
