/**
 * T022 — unit tests for the non-authoritative TTL cache (FR-006,
 * data-model §5, contracts/component-api.md §4): freshness math runs on the
 * injected clock, `ttl 0` stores nothing, failures are never cached and never
 * serve stale, and concurrent misses for one taskUuid coalesce to one walk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryCache } from "../../src/history-server/cache.js";
import { makeFixedClock } from "../helpers/history-harness.js";

interface Loader {
  calls: number;
  gate: Promise<unknown> | undefined;
  value: string;
  failWith: Error | undefined;
}

function makeLoader(): Loader {
  return { calls: 0, gate: undefined, value: "v", failWith: undefined };
}

function run(loader: Loader): Promise<string> {
  loader.calls += 1;
  if (loader.gate !== undefined) {
    return loader.gate.then(() => {
      if (loader.failWith !== undefined) throw loader.failWith;
      return loader.value;
    });
  }
  if (loader.failWith !== undefined) return Promise.reject(loader.failWith);
  return Promise.resolve(loader.value);
}

test("history-cache: a read inside the TTL window is a hit; at/after the window is a miss", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, clock });
  const loader = makeLoader();

  const first = await cache.load("task-a", () => run(loader));
  assert.equal(first.cacheState, "miss");
  assert.equal(first.value, "v");
  assert.equal(loader.calls, 1);

  const second = await cache.load("task-a", () => run(loader));
  assert.equal(second.cacheState, "hit");
  assert.equal(second.value, "v");
  assert.equal(loader.calls, 1, "a hit never re-reads the chain");

  clock.advance(9_999);
  const inside = await cache.load("task-a", () => run(loader));
  assert.equal(inside.cacheState, "hit", "elapsed < ttl ⇒ fresh");

  clock.advance(1); // total elapsed = 10_000 ms = ttl
  const atBoundary = await cache.load("task-a", () => run(loader));
  assert.equal(atBoundary.cacheState, "miss", "fresh iff elapsed < ttl·1000");
  assert.equal(loader.calls, 2);
});

test("history-cache: cacheTtlSeconds 0 stores nothing — every read misses", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 0, clock });
  const loader = makeLoader();

  const first = await cache.load("task-a", () => run(loader));
  const second = await cache.load("task-a", () => run(loader));
  assert.equal(first.cacheState, "miss");
  assert.equal(second.cacheState, "miss");
  assert.equal(loader.calls, 2);
  assert.equal(cache.size(), 0, "ttl 0 must not retain entries");
});

test("history-cache: failed reconstructions are never cached and stale never serves on error", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, clock });

  const ok = makeLoader();
  await cache.load("task-a", () => run(ok));
  assert.equal(ok.calls, 1);

  // Expire the entry, then fail the re-read: the error travels, nothing is kept.
  clock.advance(10_000);
  const failing = makeLoader();
  failing.failWith = new Error("upstream exploded");
  await assert.rejects(() => cache.load("task-a", () => run(failing)), /upstream exploded/);
  assert.equal(cache.size(), 0, "a failed re-read must drop the stale entry");

  // The next read walks again — it may not resurrect the pre-error entry.
  const recovered = makeLoader();
  recovered.value = "v2";
  const after = await cache.load("task-a", () => run(recovered));
  assert.equal(after.cacheState, "miss");
  assert.equal(after.value, "v2");
  assert.equal(recovered.calls, 1);

  // A first-attempt failure caches nothing either.
  const cold = makeLoader();
  cold.failWith = new Error("nope");
  await assert.rejects(() => cache.load("task-b", () => run(cold)), /nope/);
  assert.equal(cache.size(), 1, "only the recovered task-a entry exists; task-b cached nothing");
});

test("history-cache: concurrent misses for one taskUuid coalesce to a single walk", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, clock });
  const loader = makeLoader();
  let release: () => void = () => undefined;
  loader.gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const inFlight = Array.from({ length: 5 }, () => cache.load("task-a", () => run(loader)));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const all = await Promise.all(inFlight);

  assert.equal(loader.calls, 1, "five concurrent misses ⇒ one walk");
  for (const outcome of all) {
    assert.equal(outcome.value, "v");
    assert.equal(outcome.cacheState, "miss");
  }

  const after = await cache.load("task-a", () => run(loader));
  assert.equal(after.cacheState, "hit", "the coalesced result is what gets cached");
  assert.equal(loader.calls, 1);
});

test("history-cache: entries are keyed per taskUuid — different tasks never share", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, clock });
  const loader = makeLoader();

  await cache.load("task-a", () => run(loader));
  const other = await cache.load("task-b", () => run(loader));
  assert.equal(other.cacheState, "miss", "a different taskUuid is never a hit");
  assert.equal(loader.calls, 2);
  assert.equal(cache.size(), 2);
});
