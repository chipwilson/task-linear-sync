/**
 * T025 — The detached worker entry point (queue-protocol.md §5). Spawned as
 * `node worker-entry.js <repositoryRoot>` with stdio ignored: it loads the repository
 * config itself (no CLI imports, protocol §7), runs a BOUNDED two-pass loop
 * (drain → delay → drain) and exits 0 — the second pass is the lost-wake guard for
 * jobs enqueued while the first pass applied. A resident worker is `task-linear-sync
 * worker` without `--once`; the detached lane must never linger.
 *
 * Failure posture: never throws, never exits non-zero — a background helper nobody
 * watches; the durable state (pending job / reports / marker) tells the whole story.
 */
import process from "node:process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { loadConfig, validateWorkspaceIdentity } from "../config/index.js";
import { createStateStore, systemClock } from "../state/index.js";
import { runEnginePass } from "./apply-runner.js";
import { resolveQueueConfig } from "./config.js";
import { runDrainOnce } from "./drain.js";
import { createProductionNotifier } from "./notify.js";
import { runWorkerLoop } from "./worker.js";

async function main(): Promise<void> {
  const repositoryRoot = process.argv[2] ?? process.cwd();
  const defaults = loadConfig({});
  const config = loadConfig({
    configFile: join(repositoryRoot, defaults.configFileName),
    env: process.env,
    clock: systemClock,
  });
  validateWorkspaceIdentity(config);
  const resolved = resolveQueueConfig(config);
  if (!resolved.ok) return; // invalid queue config: nothing a detached helper should do

  const store = createStateStore({ repositoryRoot, config, clock: systemClock });
  const settings = resolved.settings;
  const workerId = `worker-${process.pid}-${randomBytes(4).toString("hex")}`;
  const notifier = createProductionNotifier(process.env);

  await runWorkerLoop(store, settings, {
    once: false,
    maxPasses: 2, // bounded two-pass loop with lost-wake guard (protocol §5)
    workerId,
    pid: process.pid,
    clock: systemClock,
    drain: () =>
      runDrainOnce(store, settings, {
        workerId,
        pid: process.pid,
        clock: systemClock,
        notifier,
        runApply: (job) =>
          runEnginePass(store, settings, {
            repositoryRoot,
            mode: job?.mode ?? "sync",
            env: process.env,
          }),
      }),
  });
}

// Exit 0 unconditionally — see the failure posture note above (spec 010 FR-005/FR-013).
void main().then(
  () => {
    process.exitCode = 0;
  },
  () => {
    process.exitCode = 0;
  },
);
