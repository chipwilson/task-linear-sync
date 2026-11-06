/**
 * T024 — `createQueueSurface`: the 010 implementation behind the frozen 009 seam
 * (contracts/queue-surface-implementation.md). The CLI factory-binds with ZERO args;
 * every member is optional-wiring replaceable for tests (QueueWiring bag). Binding
 * posture: malformed wiring members surface as `{status:"refused"}` — never a throw.
 * Seam types are re-declared structurally here (import direction CLI → queue only).
 */
import { randomBytes } from "node:crypto";
import process from "node:process";

import { createStateStore, systemClock } from "../state/index.js";
import type { LastRunMarker } from "../state/marker.js";
import type { StateStore } from "../state/paths.js";
import type { ResolvedConfig } from "../config/schema.js";
import { installAgentHooks } from "./agent-hooks.js";
import { resolveQueueConfig, validateQueueWiring } from "./config.js";
import { runDrainOnce } from "./drain.js";
import { enqueueJob } from "./enqueue.js";
import { installGitHooks } from "./git-hooks.js";
import { createNotifier, createProductionNotifier, spawnToExit } from "./notify.js";
import { spawnDetachedWorker } from "./spawn.js";
import type { Notifier, QueueClock, QueueOutcomeResult, SpawnWorkerOptions } from "./types.js";
import { runWorkerLoop } from "./worker.js";

/** Optional injection bag (queue-surface-implementation.md §3). */
export interface QueueWiring {
  readonly clock?: QueueClock;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly spawnWorker?: (options: SpawnWorkerOptions) => void;
  readonly notifier?: Notifier;
  readonly which?: (tool: string) => string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly workerEntryPath?: string;
}

// ── Seam input shapes (structural mirrors of src/cli/queue-surface.ts — no CLI import) ──

export interface SurfaceInstallHooksInput {
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
}
export interface SurfaceInstallAgentHookInput extends SurfaceInstallHooksInput {
  readonly frameworkId?: string;
}
export interface SurfaceEnqueueInput extends SurfaceInstallHooksInput {
  readonly mode: "bootstrap" | "sync";
}
export interface SurfaceWorkerInput extends SurfaceInstallHooksInput {
  readonly once: boolean;
}
export interface SurfaceReadLastRunInput {
  readonly state: StateStore;
}

export interface QueueSurfaceImpl {
  installHooks(o: SurfaceInstallHooksInput): Promise<QueueOutcomeResult>;
  installAgentHook(o: SurfaceInstallAgentHookInput): Promise<QueueOutcomeResult>;
  enqueue(o: SurfaceEnqueueInput): Promise<QueueOutcomeResult>;
  runWorker(o: SurfaceWorkerInput): Promise<QueueOutcomeResult>;
  readLastRun(o: SurfaceReadLastRunInput): Promise<{ found: boolean; marker?: LastRunMarker }>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * The five-method queue surface. `createQueueSurface()` with zero arguments is the
 * production binding the frozen CLI seam performs (contracts/queue-surface.md §2).
 */
export function createQueueSurface(wiring: QueueWiring = {}): QueueSurfaceImpl {
  const env = wiring.env ?? process.env;
  const clock = wiring.clock ?? systemClock;
  const surfaceWorkerId = `worker-${process.pid}-${randomBytes(4).toString("hex")}`;

  function wiringRefusal(method: string): QueueOutcomeResult | undefined {
    return validateQueueWiring(wiring as unknown as Record<string, unknown>, method);
  }

  function makeStore(input: SurfaceInstallHooksInput): StateStore {
    return createStateStore({ repositoryRoot: input.repositoryRoot, config: input.config, clock });
  }

  function productionNotifier(): Notifier {
    if (wiring.notifier !== undefined) return wiring.notifier;
    if (wiring.which !== undefined) {
      return createNotifier({ env, which: wiring.which, platform: process.platform, spawn: spawnToExit });
    }
    return createProductionNotifier(env);
  }

  return {
    async installHooks(input) {
      const refusal = wiringRefusal("installHooks");
      if (refusal !== undefined) return refusal;
      const settings = resolveQueueConfig(input.config);
      if (!settings.ok) return { status: "refused", detail: settings.errors.join("; ") };
      return installGitHooks(input.repositoryRoot, {
        toolId: input.config.toolId,
        hookNames: input.config.managedGitHooks,
        hookScriptPrefix: settings.settings.hookScriptPrefix,
        hooksDirectory: settings.settings.hooksDirectory ?? null,
      });
    },

    async installAgentHook(input) {
      const refusal = wiringRefusal("installAgentHook");
      if (refusal !== undefined) return refusal;
      const settings = resolveQueueConfig(input.config);
      if (!settings.ok) return { status: "refused", detail: settings.errors.join("; ") };
      return installAgentHooks(input.repositoryRoot, {
        frameworkId: input.frameworkId,
        binName: input.config.binName,
        agentHooksDirectory: settings.settings.agentHooksDirectory ?? input.config.agentHooksDirectory ?? null,
        taskFilePatterns: input.config.taskFilePatterns,
      });
    },

    async enqueue(input) {
      const refusal = wiringRefusal("enqueue");
      if (refusal !== undefined) return refusal;
      const store = makeStore(input);
      const settings = resolveQueueConfig(store.config);
      return enqueueJob(store, settings.settings, { repositoryRoot: input.repositoryRoot, mode: input.mode, trigger: "manual" }, {
        clock,
        env,
        workerId: surfaceWorkerId,
        spawnWorker: wiring.spawnWorker ?? spawnDetachedWorker,
        ...(wiring.workerEntryPath !== undefined ? { workerEntryPath: wiring.workerEntryPath } : {}),
      });
    },

    async runWorker(input) {
      const refusal = wiringRefusal("runWorker");
      if (refusal !== undefined) return refusal;
      const settings = resolveQueueConfig(input.config);
      if (!settings.ok) return { status: "refused", detail: settings.errors.join("; ") };
      const store = makeStore(input);
      const resolved = settings.settings;
      return runWorkerLoop(store, resolved, {
        once: input.once,
        workerId: surfaceWorkerId,
        pid: process.pid,
        clock,
        sleep: wiring.sleep ?? realSleep,
        drain: () =>
          runDrainOnce(store, resolved, {
            workerId: surfaceWorkerId,
            pid: process.pid,
            clock,
            notifier: productionNotifier(),
            runApply: (job) =>
              import("./apply-runner.js").then(({ runEnginePass }) =>
                runEnginePass(store, resolved, {
                  repositoryRoot: input.repositoryRoot,
                  mode: job?.mode ?? "sync",
                  env,
                }),
              ),
          }),
      });
    },

    async readLastRun(input) {
      const { readLastRunMarker } = await import("../state/marker.js");
      const marker = await readLastRunMarker(input.state);
      return marker === null ? { found: false } : { found: true, marker };
    },
  };
}
