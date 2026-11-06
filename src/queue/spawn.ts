/**
 * T015 — The detached-worker spawn lane (queue-protocol.md §5; the ONLY `child_process`
 * consumer on the enqueue side together with `notify.ts`). Fire-and-forget by contract:
 * a spawn failure must NEVER fail the enqueue — the durable pending job stays for the
 * next trigger and the caller reports the degradation ("worker did not start").
 */
import { spawn as nodeSpawn } from "node:child_process";

import type { SpawnWorkerOptions } from "./types.js";

/**
 * Spawn `node <entry> <repositoryRoot>` detached + unref'd (stdio ignored — the worker
 * is invisible to the hook). Errors surface asynchronously; both the synchronous throw
 * and the async `error` event are swallowed here (protocol §5: the enqueue outcome is
 * decided by durability, not by the spawn).
 */
export function spawnDetachedWorker(options: SpawnWorkerOptions): void {
  try {
    const child = nodeSpawn(process.execPath, [options.entry, options.repositoryRoot], {
      detached: options.detached !== false,
      stdio: "ignore",
    });
    child.on("error", () => undefined); // async spawn failure — degrade silently
    child.unref();
  } catch {
    /* synchronous spawn refusal — the caller adds the "worker did not start" warning */
  }
}
