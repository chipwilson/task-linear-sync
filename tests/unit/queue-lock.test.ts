/**
 * T008 [P] — FAILING unit tests for the queue drain mutex (FR-002, research R4;
 * contracts/queue-protocol.md §3). Module under test: `src/queue/queue-lock.ts` —
 * acquireQueueLock / releaseQueueLock over `queue-lock.json` via temp + link(2),
 * mirroring the frozen src/state/lock.ts precedent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { acquireQueueLock, releaseQueueLock, type QueueLockToken } from "../../src/queue/queue-lock.js";
import { makeQueueHarness, type QueueHarness } from "../helpers/queue-harness.js";

async function withHarness(fn: (h: QueueHarness) => Promise<void>): Promise<void> {
  const h = await makeQueueHarness();
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}

function lockPath(h: QueueHarness): string {
  return join(h.stateDir, "queue-lock.json");
}

function readRawLock(h: QueueHarness): string {
  return readFileSync(lockPath(h), "utf8");
}

/** A pid that is provably dead (ESRCH) once its child has been reaped. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  for (let i = 0; i < 100; i += 1) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("could not obtain a dead pid");
}

test("first acquire creates the lock with the exact record format {schemaVersion, workerId, pid, acquiredAt}", async () => {
  await withHarness(async (h) => {
    const res = await acquireQueueLock(h.store, {
      workerId: "w-one",
      pid: 4242,
      clock: h.clock,
      sleep: h.sleep,
      rng: () => 0.5,
      timeoutSeconds: 5,
    });
    assert.equal(res.acquired, true);
    const raw = readRawLock(h);
    assert.deepEqual(JSON.parse(raw), {
      schemaVersion: 1,
      workerId: "w-one",
      pid: 4242,
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    // exact key ORDER (byte format) — the serialized form pins it:
    assert.equal(raw.trim(), '{"schemaVersion":1,"workerId":"w-one","pid":4242,"acquiredAt":"2026-01-01T00:00:00.000Z"}');
    assert.equal(readdirSync(h.stateDir).filter((f) => f.includes(".tmp")).length, 0); // no temp residue
  });
});

test("concurrency 10 over one state dir ⇒ exactly one holder", async () => {
  await withHarness(async (h) => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, i) =>
        acquireQueueLock(h.store, {
          workerId: `contender-${i}`,
          pid: process.pid,
          clock: h.clock,
          sleep: h.sleep,
          rng: () => 0.5,
          timeoutSeconds: 0.25,
        }),
      ),
    );
    const won = results.filter((r) => r.acquired);
    assert.equal(won.length, 1);
    for (const r of results.filter((x) => !x.acquired)) {
      assert.equal(r.held, true);
      assert.ok(r.heldBy);
    }
  });
});

test("re-acquire by the holder's own workerId succeeds (same-worker restart posture)", async () => {
  await withHarness(async (h) => {
    const first = await acquireQueueLock(h.store, { workerId: "same-w", pid: 111, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 1 });
    assert.equal(first.acquired, true);
    h.clock.advanceMs(1000);
    const again = await acquireQueueLock(h.store, { workerId: "same-w", pid: 222, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 1 });
    assert.equal(again.acquired, true);
    const raw = JSON.parse(readRawLock(h)) as { pid: number; acquiredAt: string };
    assert.equal(raw.pid, 222); // refreshed record
  });
});

test("foreign LIVE holder ⇒ held:true with the virtual timeout after exactly the configured seconds", async () => {
  await withHarness(async (h) => {
    // seed a foreign holder carrying OUR live pid ⇒ provably alive, never stolen
    writeFileSync(lockPath(h), JSON.stringify({
      schemaVersion: 1,
      workerId: "keeper",
      pid: process.pid,
      acquiredAt: "2026-01-01T00:00:00.000Z",
    }));
    const res = await acquireQueueLock(h.store, {
      workerId: "intruder",
      pid: process.pid, // our own live pid ⇒ provably alive
      clock: h.clock,
      sleep: h.sleep,
      rng: () => 0.5,
      timeoutSeconds: 7,
    });
    assert.equal(res.acquired, false);
    if (res.acquired) return;
    assert.equal(res.held, true);
    assert.equal(res.timeoutSeconds, 7);
    // virtual horizon: the injected sleeps advanced the clock by exactly 7000 ms (50 ms + jitter, capped by remaining)
    assert.equal(h.clock.elapsed("2026-01-01T00:00:00.000Z"), 7000);
    assert.ok(h.sleeps.every((s) => s >= 50 && s <= 75), `unexpected cadence: ${h.sleeps.join(",")}`);
  });
});

test("dead recorded pid ⇒ takeover (reclaim); EPERM-protected pid counts as ALIVE and is kept", async () => {
  await withHarness(async (h) => {
    // (a) dead pid → reclaim
    const dead = await deadPid();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      lockPath(h),
      JSON.stringify({ schemaVersion: 1, workerId: "ghost", pid: dead, acquiredAt: "2025-12-31T00:00:00.000Z" }),
      "utf8",
    );
    const res = await acquireQueueLock(h.store, { workerId: "reclaimer", pid: process.pid, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 1 });
    assert.equal(res.acquired, true);
    assert.equal(((JSON.parse(readRawLock(h)) as { workerId: string }).workerId), "reclaimer");

    // (b) pid 1 — signalling it yields EPERM for unprivileged callers (and succeeds for
    // root): ALIVE under both readings ⇒ never taken over.
    await releaseQueueLock(h.store, { workerId: "reclaimer", pid: process.pid, acquiredAt: h.clock.now().toISOString(), schemaVersion: 1 });
    writeFileSync(
      lockPath(h),
      JSON.stringify({ schemaVersion: 1, workerId: "root-holder", pid: 1, acquiredAt: "2025-12-31T00:00:00.000Z" }),
      "utf8",
    );
    const probe = await acquireQueueLock(h.store, { workerId: "intruder-2", pid: process.pid, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 0.2 });
    assert.equal(probe.acquired, false);
    if (!probe.acquired) assert.equal(probe.heldBy?.workerId, "root-holder");
  });
});

test("release: own workerId unlinks (idempotent), foreign/stale token refused leaving the record", async () => {
  await withHarness(async (h) => {
    const token: QueueLockToken = { schemaVersion: 1, workerId: "w-a", pid: 5, acquiredAt: "2026-01-01T00:00:00.000Z" };
    const acq = await acquireQueueLock(h.store, { workerId: "w-a", pid: 5, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 1 });
    assert.equal(acq.acquired, true);

    const foreign = await releaseQueueLock(h.store, { ...token, workerId: "w-b" });
    assert.equal(foreign, false); // stale-token unlock refusal
    assert.equal(JSON.parse(readRawLock(h)).workerId, "w-a"); // record intact

    assert.equal(await releaseQueueLock(h.store, token), true);
    assert.throws(() => readRawLock(h)); // gone
    assert.equal(await releaseQueueLock(h.store, token), true); // ENOENT ⇒ idempotent success
  });
});

test("contention releases mid-wait ⇒ the waiter takes the lock (retry loop, injected sleep only)", async () => {
  await withHarness(async (h) => {
    const acq = await acquireQueueLock(h.store, { workerId: "holder", pid: process.pid, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 10 });
    assert.equal(acq.acquired, true);
    const waiter = acquireQueueLock(h.store, {
      workerId: "waiter",
      pid: process.pid,
      clock: h.clock,
      rng: () => 0.5,
      // release the holder after the third poll
      sleep: async (ms: number) => {
        h.sleeps.push(ms);
        h.clock.advanceMs(ms);
        if (h.sleeps.length === 3) {
          await releaseQueueLock(h.store, { schemaVersion: 1, workerId: "holder", pid: process.pid, acquiredAt: "2026-01-01T00:00:00.000Z" });
        }
      },
      timeoutSeconds: 10,
    });
    const res = await waiter;
    assert.equal(res.acquired, true);
    assert.equal(JSON.parse(readRawLock(h)).workerId, "waiter");
  });
});

test("spawned child contends the same lock file — single winner across processes (002 race precedent)", async () => {
  await withHarness(async (h) => {
    const acq = await acquireQueueLock(h.store, { workerId: "parent", pid: process.pid, clock: h.clock, sleep: h.sleep, rng: () => 0.5, timeoutSeconds: 2 });
    assert.equal(acq.acquired, true);
    const child = spawnSync(
      process.execPath,
      ["-e", `
        const fs = require("node:fs");
        const p = ${JSON.stringify(lockPath(h))};
        let ok = false;
        try {
          const tmp = p + ".tmp-" + process.pid;
          fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, workerId: "child", pid: process.pid, acquiredAt: "x" }));
          fs.linkSync(tmp, p);
          fs.unlinkSync(tmp);
          ok = true;
        } catch { ok = false; }
        process.stdout.write(ok ? "acquired" : "held");
      `],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(child.stdout.trim(), "held");
    assert.equal(JSON.parse(readRawLock(h)).workerId, "parent"); // parent record untouched
    void spawnSync;
  });
});
