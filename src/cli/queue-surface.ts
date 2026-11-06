/**
 * T012 — `QueueSurface` seam + default wiring (contracts/queue-surface.md; research R5).
 * The five 010-delegated commands are presentations of 010 behaviors over this seam.
 * Default wiring: `readLastRun` is served immediately by the frozen
 * `readLastRunMarker` (the marker is written by the engine since 008); the other four
 * members attempt a lazy dynamic `import("../queue/index.js")` per invocation. While
 * `src/queue/` does not exist, the `ERR_MODULE_NOT_FOUND` is translated into
 * `QueueSurfaceUnavailableError` ⇒ exit 7 with zero mutation and zero network. 010's
 * arrival flips these to the real implementation with no CLI change.
 */
import { readLastRunMarker } from "../state/marker.js";
import type { LastRunMarker } from "../state/marker.js";
import type { StateStore } from "../state/paths.js";
import type { ResolvedConfig } from "../config/schema.js";
import { QueueSurfaceUnavailableError } from "./errors.js";

/** The module 010 ships; absent in the 009-only world (exit-7 posture). */
export const QUEUE_MODULE = "task-linear-sync/queue";

export interface InstallHooksInput {
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
}
export interface InstallAgentHookInput extends InstallHooksInput {
  readonly frameworkId?: string;
}
export interface EnqueueInput extends InstallHooksInput {
  readonly mode: "bootstrap" | "sync";
}
export interface WorkerInput extends InstallHooksInput {
  readonly once: boolean;
}
export interface ReadLastRunInput {
  readonly state: StateStore;
}

export interface QueueOutcome {
  readonly status: "installed" | "skipped" | "enqueued" | "stopped" | "refused";
  /** Sanitized, screened before printing. */
  readonly detail?: string;
  /** Hook names (installHooks). */
  readonly installed?: readonly string[];
  /** Template file written (installAgentHook). */
  readonly path?: string;
  /** Enqueue dedup target. */
  readonly jobId?: string;
}

export interface LastRunOutcome {
  readonly found: boolean;
  readonly marker?: LastRunMarker;
}

/** The binding seam (contracts/queue-surface.md §1) — plain data in/out, no callbacks. */
export interface QueueSurface {
  installHooks(o: InstallHooksInput): Promise<QueueOutcome>;
  installAgentHook(o: InstallAgentHookInput): Promise<QueueOutcome>;
  enqueue(o: EnqueueInput): Promise<QueueOutcome>;
  /** Resolves on clean stop (`--once` single pass, or a signalled shutdown). */
  runWorker(o: WorkerInput): Promise<QueueOutcome>;
  readLastRun(o: ReadLastRunInput): Promise<LastRunOutcome>;
}

type QueueMember = "installHooks" | "installAgentHook" | "enqueue" | "runWorker";

const COMMAND_FOR_MEMBER: Record<QueueMember, string> = {
  installHooks: "install-hooks",
  installAgentHook: "install-agent-hook",
  enqueue: "enqueue",
  runWorker: "worker",
};

function isModuleNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || /Cannot find module/.test(error.message);
}

/**
 * Lazy dynamic import of 010's module. The specifier is a computed value so this file
 * compiles while `src/queue/` is absent; the runtime resolution failure is translated
 * into `QueueSurfaceUnavailableError` (exit 7, zero side effects).
 */
async function importQueueModule(command: string): Promise<Record<string, unknown>> {
  const specifier = "../queue/index.js";
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new QueueSurfaceUnavailableError(command, QUEUE_MODULE);
    }
    throw error;
  }
}

/** Delegate to 010's `QueueSurface` once its module exists (factory or module-level members). */
async function delegateTo010(
  member: QueueMember,
  input: InstallHooksInput | EnqueueInput | WorkerInput | InstallAgentHookInput,
): Promise<QueueOutcome> {
  const command = COMMAND_FOR_MEMBER[member];
  const mod = await importQueueModule(command);
  const factory = mod["createQueueSurface"];
  const surface = (
    typeof factory === "function"
      ? (factory as () => Record<string, unknown>)()
      : (mod["queueSurface"] as Record<string, unknown> | undefined) ?? mod
  ) as Record<string, unknown>;
  const impl = surface[member];
  if (typeof impl !== "function") {
    throw new TypeError(`${QUEUE_MODULE} does not provide QueueSurface.${member}`);
  }
  return (await (impl as (o: unknown) => Promise<QueueOutcome>)(input)) as QueueOutcome;
}

/** Default wiring (contracts/queue-surface.md §2): frozen marker + lazy-010 refusals. */
export function createDefaultQueueSurface(): QueueSurface {
  return {
    installHooks: (o) => delegateTo010("installHooks", o),
    installAgentHook: (o) => delegateTo010("installAgentHook", o),
    enqueue: (o) => delegateTo010("enqueue", o),
    runWorker: (o) => delegateTo010("runWorker", o),
    readLastRun: async (o) => {
      const marker = await readLastRunMarker(o.state);
      return marker === null ? { found: false } : { found: true, marker };
    },
  };
}
