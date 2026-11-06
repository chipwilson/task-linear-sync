/**
 * T011 — The lock-free enqueue fast path (spec 010 FR-001/FR-007/FR-008;
 * queue-protocol.md §2; research R4/R6). Order is contractual: validate the `queue`
 * group against the RAW config (refusal writes nothing) → merge the single-slot pending
 * record durably → spawn the detached worker only AFTER durability. Enqueue NEVER
 * touches the queue lock (FR-002 scope). Concurrent in-process enqueues serialize on a
 * per-state-root mutex so a hook storm coalesces into ONE job id (SC-002); cross-process
 * durability comes from the atomic single-slot write.
 */
import { join } from "node:path";

import type { StateStore } from "../state/paths.js";
import { resolveQueueConfig } from "./config.js";
import { mergePendingJob, readPendingJob } from "./pending-job.js";
import type { QueueClock, QueueOutcomeResult, QueueSettings, SpawnWorkerOptions, SyncMode } from "./types.js";

/** Result of the enqueue lane: the seam outcome plus sanitized warnings. */
export type EnqueueResult = QueueOutcomeResult & { readonly warnings?: readonly string[] };

export interface EnqueueInput {
  readonly repositoryRoot: string;
  readonly mode: SyncMode;
  readonly trigger: string;
}

export interface EnqueueDeps {
  readonly clock?: QueueClock;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly workerId: string;
  readonly spawnWorker: (options: SpawnWorkerOptions) => void;
  readonly rng?: () => number;
  /** worker-entry hand-off target (default: sibling worker-entry.js of this module). */
  readonly workerEntryPath?: string;
}

function defaultWorkerEntry(): string {
  return new URL("./worker-entry.js", import.meta.url).pathname;
}

/**
 * In-process coalescing mutex keyed by state root (protocol §2 step 2 — concurrent
 * triggers read-merge-write as one). Cross-process storms stay safe through the atomic
 * single-slot write: the worst case is a lost update on `updatedAt`, never two slots.
 */
const inFlight = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous: Promise<unknown> = inFlight.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  inFlight.set(key, next);
  void next.then(
    () => undefined,
    () => undefined,
  ).then(() => {
    if (inFlight.get(key) === next) inFlight.delete(key);
  });
  return next;
}

/**
 * Enqueue one background sync request. Never throws for expected failure channels:
 * refused (bad `queue` config), skipped (fs failure writing the record), enqueued
 * (with warnings for missing credentials / failed spawn). `settings` is the caller's
 * resolved group; the RAW `store.config` is re-validated here so no lane can bypass
 * validation (protocol §2 step 1).
 */
export async function enqueueJob(
  store: StateStore,
  settings: QueueSettings,
  input: EnqueueInput,
  deps: EnqueueDeps,
): Promise<EnqueueResult> {
  void settings; // the authoritative validation below re-reads store.config raw
  const resolved = resolveQueueConfig(store.config);
  if (!resolved.ok) {
    return { status: "refused", detail: resolved.errors.join("; ") };
  }

  // Credential pre-check (FR-007): NAME presence only — warning, never a refusal.
  const warnings: string[] = [];
  const names = store.config.credentialEnvVarNames;
  const hasCredential = deps.env[names.token] !== undefined || deps.env[names.apiKey] !== undefined;
  if (!hasCredential) {
    warnings.push(`credential env '${names.token}' is not set — background runs will report an error until it is`);
  }

  // Durable merge under the coalescing mutex, then the detached spawn (protocol §2 3–5).
  return serialized(join(store.root), async (): Promise<EnqueueResult> => {
    let corruptExisting = false;
    try {
      corruptExisting = (await readPendingJob(store)).corrupt;
    } catch {
      corruptExisting = false; // unreadable directory surfaces on the write below
    }
    if (corruptExisting) {
      warnings.push("corrupt pending-job record was replaced with a fresh job");
    }

    let jobId: string;
    try {
      const merged = await mergePendingJob(store, { mode: input.mode, trigger: input.trigger });
      jobId = merged.jobId;
    } catch {
      // protocol §2.5: unexpected fs failure ⇒ skipped (the hook stays silent-green).
      return { status: "skipped", detail: "could not write the pending-job record in the state directory" };
    }

    // Spawn AFTER durability; a failed spawn degrades loudly but the enqueue stands.
    try {
      deps.spawnWorker({
        entry: deps.workerEntryPath ?? defaultWorkerEntry(),
        repositoryRoot: input.repositoryRoot,
        detached: true,
      });
    } catch {
      warnings.push("worker did not start — the job stays queued for the next trigger");
    }

    const detail = [`enqueued job ${jobId} (${input.mode}, trigger ${input.trigger})`, ...warnings].join("; ");
    return { status: "enqueued", jobId, detail, warnings };
  });
}
