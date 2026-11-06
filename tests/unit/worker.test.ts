/**
 * T014 — FAILING unit tests for the worker main loop (spec 010, FR-006/FR-007,
 * queue-protocol.md exit-code contract). Module under test: `src/queue/worker.ts` —
 * runWorkerLoop. The drain pass is injected so the loop itself is what is measured:
 * single-pass mode, the interval wait, and graceful SIGINT/SIGTERM handling.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveQueueConfig } from "../../src/queue/config.js";
import type { DrainResult } from "../../src/queue/drain.js";
import { runWorkerLoop } from "../../src/queue/worker.js";
import type { QueueSettings } from "../../src/queue/types.js";
import { makeQueueHarness, type QueueHarness } from "../helpers/queue-harness.js";

const applied: DrainResult = { status: "applied", detail: "applied" };

interface SignalHandlers {
  SIGINT: () => void;
  SIGTERM: () => void;
}

function settingsOk(h: QueueHarness): QueueSettings {
  const r = resolveQueueConfig(h.config);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.settings;
}

async function withHarness(
  fn: (h: QueueHarness, settings: QueueSettings) => Promise<void>,
  options: Parameters<typeof makeQueueHarness>[0] = {},
): Promise<void> {
  const h = await makeQueueHarness(options);
  try {
    await fn(h, settingsOk(h));
  } finally {
    h.dispose();
  }
}

test("worker: once mode performs exactly one drain pass and stops", async () => {
  await withHarness(async (h, settings) => {
    const drains: number[] = [];
    const result = await runWorkerLoop(h.store, settings, {
      once: true,
      workerId: h.workerId,
      pid: process.pid,
      clock: h.clock,
      sleep: h.sleep,
      installHandlers: () => () => undefined,
      drain: async () => {
        drains.push(1);
        return applied;
      },
    });
    assert.equal(drains.length, 1);
    assert.equal(result.status, "stopped");
    assert.deepEqual(h.sleeps, [], "once mode never waits for the next interval");
  });
});

test("worker: resident mode drains, waits workerDelaySeconds, drains again, stops on signal", async () => {
  await withHarness(
    async (h, settings) => {
      const drains: number[] = [];
      let fireSignal: (() => void) | null = null;

      const result = await runWorkerLoop(h.store, settings, {
        once: false,
        workerId: h.workerId,
        pid: process.pid,
        clock: h.clock,
        sleep: h.sleep,
        installHandlers: (handlers: SignalHandlers) => {
          fireSignal = () => handlers.SIGTERM();
          return () => undefined;
        },
        drain: async () => {
          drains.push(1);
          if (drains.length === 2) fireSignal?.();
          return applied;
        },
      });

      assert.equal(drains.length, 2, "the signal is observed between passes, never mid-pass");
      assert.deepEqual(h.sleeps, [30_000], "one interval wait between the two drains");
      assert.equal(result.status, "stopped");
      assert.match(result.detail ?? "", /SIGTERM/);
    },
    { queue: { workerDelaySeconds: 30 } },
  );
});

test("worker: SIGINT and SIGTERM handlers are installed before the first pass and released after", async () => {
  await withHarness(async (h, settings) => {
    const installed: string[] = [];
    let released = false;
    let handlersInstalledBeforeDrain = 0;

    await runWorkerLoop(h.store, settings, {
      once: true,
      workerId: h.workerId,
      pid: process.pid,
      clock: h.clock,
      sleep: h.sleep,
      installHandlers: (handlers: SignalHandlers) => {
        installed.push(...Object.keys(handlers).sort());
        handlersInstalledBeforeDrain = 1;
        return () => {
          released = true;
        };
      },
      drain: async () => {
        assert.equal(handlersInstalledBeforeDrain, 1, "handlers are installed before the first pass runs");
        return applied;
      },
    });

    assert.deepEqual(installed, ["SIGINT", "SIGTERM"]);
    assert.equal(released, true, "handlers are removed on exit so the process can drain naturally");
  });
});

test("worker: a signal during the interval wait ends the loop without another pass", async () => {
  await withHarness(async (h, settings) => {
    const drains: number[] = [];
    let fireSignal: (() => void) | null = null;

    const result = await runWorkerLoop(h.store, settings, {
      once: false,
      workerId: h.workerId,
      pid: process.pid,
      clock: h.clock,
      // The wait itself delivers the signal (simulates SIGTERM during the sleep).
      sleep: async (ms: number) => {
        h.sleeps.push(ms);
        h.clock.advanceMs(ms);
        fireSignal?.();
      },
      installHandlers: (handlers: SignalHandlers) => {
        fireSignal = () => handlers.SIGINT();
        return () => undefined;
      },
      drain: async () => {
        drains.push(1);
        return applied;
      },
    });

    assert.equal(drains.length, 1);
    assert.equal(result.status, "stopped");
    assert.match(result.detail ?? "", /SIGINT/);
  });
});

test("worker: an unexpected drain exception surfaces as a rejection (worker exits non-zero)", async () => {
  await withHarness(async (h, settings) => {
    await assert.rejects(
      runWorkerLoop(h.store, settings, {
        once: true,
        workerId: h.workerId,
        pid: process.pid,
        clock: h.clock,
        sleep: h.sleep,
        installHandlers: () => () => undefined,
        drain: async () => {
          throw new Error("internal explosion");
        },
      }),
      /internal explosion/,
    );
  });
});
