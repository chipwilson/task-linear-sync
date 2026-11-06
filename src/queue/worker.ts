/**
 * T014 — The worker main loop (spec 010 FR-006/FR-007; queue-protocol.md exit contract).
 * `--once` performs exactly one drain pass and stops; resident mode drains, waits
 * `workerDelaySeconds`, and re-checks the stop signal BETWEEN passes (never mid-pass).
 * SIGINT/SIGTERM handlers are installed before the first pass and released on every
 * exit path (including a drain rejection — the worker then exits non-zero). A bounded
 * `maxPasses` run (protocol §5, the detached worker-entry) exits cleanly after the
 * final pass — the post-pass drain is the lost-wake guard for jobs enqueued mid-flight.
 */
import process from "node:process";

import type { StateStore } from "../state/paths.js";
import type { DrainResult } from "./drain.js";
import type { QueueClock, QueueOutcomeResult, QueueSettings } from "./types.js";

export interface WorkerSignalHandlers {
  SIGINT: () => void;
  SIGTERM: () => void;
}

export interface WorkerDeps {
  readonly once?: boolean;
  readonly workerId: string;
  readonly pid: number;
  readonly clock: QueueClock;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Install SIGINT/SIGTERM handlers; the returned function releases them (default: process). */
  readonly installHandlers?: (handlers: WorkerSignalHandlers) => () => void;
  readonly drain: () => Promise<DrainResult>;
  /** Bound the resident loop (detached worker-entry = 2 passes, protocol §5). */
  readonly maxPasses?: number;
}

function defaultInstallHandlers(handlers: WorkerSignalHandlers): () => void {
  const onSigint = (): void => handlers.SIGINT();
  const onSigterm = (): void => handlers.SIGTERM();
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

/** Run the drain loop until `--once` completes, the bound is hit, or a signal arrives. */
export async function runWorkerLoop(
  store: StateStore,
  settings: QueueSettings,
  deps: WorkerDeps,
): Promise<QueueOutcomeResult> {
  void store;
  let signalName: string | null = null;
  const currentSignal = (): string | null => signalName;
  const install = deps.installHandlers ?? defaultInstallHandlers;
  const release = install({
    SIGINT: () => {
      if (signalName === null) signalName = "SIGINT";
    },
    SIGTERM: () => {
      if (signalName === null) signalName = "SIGTERM";
    },
  });
  try {
    const sleep =
      deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
    const limit = deps.once === true ? 1 : deps.maxPasses ?? Number.POSITIVE_INFINITY;
    let passes = 0;
    for (;;) {
      const result = await deps.drain();
      passes += 1;
      const stop1 = currentSignal();
      if (stop1 !== null) {
        return { status: "stopped", detail: `stopped on ${stop1} after ${passes} pass(es)` };
      }
      if (passes >= limit) {
        return {
          status: "stopped",
          detail:
            limit === 1
              ? `once pass complete (${result.status})`
              : `bounded worker finished ${passes} passes (last: ${result.status})`,
        };
      }
      await sleep(settings.workerDelaySeconds * 1000);
      const stop2 = currentSignal();
      if (stop2 !== null) {
        return { status: "stopped", detail: `stopped on ${stop2} during the interval wait` };
      }
    }
  } finally {
    release(); // handlers always removed — the process may then exit naturally
  }
}
