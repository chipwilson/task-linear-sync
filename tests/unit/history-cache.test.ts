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

/** Pre-014 observable behavior: an effectively unbounded retention bound. */
const UNBOUNDED = 1_000_000;

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
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: UNBOUNDED, clock });
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
  const cache = createHistoryCache({ ttlSeconds: 0, maxEntries: UNBOUNDED, clock });
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
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: UNBOUNDED, clock });

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
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: UNBOUNDED, clock });
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
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: UNBOUNDED, clock });
  const loader = makeLoader();

  await cache.load("task-a", () => run(loader));
  const other = await cache.load("task-b", () => run(loader));
  assert.equal(other.cacheState, "miss", "a different taskUuid is never a hit");
  assert.equal(loader.calls, 2);
  assert.equal(cache.size(), 2);
});

// ── T016 (feature 014) — LRU bound enforcement (resource-bounds.md §2, FR-005)

test("history-cache: maxEntries 4 keeps size ≤ 4 and evicts from the front", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: 4, clock });
  const calls = new Map<string, number>();
  const load = (key: string) => {
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return cache.load(key, async () => `v-${key}`);
  };

  for (const key of ["a", "b", "c", "d", "e", "f"]) {
    await load(key);
    assert.ok(cache.size() <= 4, `size invariant after inserting ${key}: ${cache.size()}`);
  }
  assert.equal(cache.size(), 4);

  // The four newest insertions are fresh hits (hits change no retention order);
  // the two oldest insertions were evicted from the front. Miss-checks come
  // LAST because a miss re-walks and re-stores (which itself evicts one).
  assert.equal((await load("c")).cacheState, "hit");
  assert.equal((await load("d")).cacheState, "hit");
  assert.equal((await load("e")).cacheState, "hit");
  assert.equal((await load("f")).cacheState, "hit");
  assert.equal((await load("a")).cacheState, "miss", "a was the first eviction");
  assert.equal((await load("b")).cacheState, "miss", "b was evicted next from the front");
});

test("history-cache: touching a FRESH entry moves it to the most-recent slot", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: 4, clock });
  const load = (key: string) => cache.load(key, async () => `v-${key}`);

  for (const key of ["a", "b", "c", "d"]) await load(key);
  assert.equal((await load("a")).cacheState, "hit", "a is a fresh hit — the touch re-orders it");
  await load("e"); // must evict b (front), not a (touched to most-recent)

  assert.equal((await load("a")).cacheState, "hit", "a survived eviction thanks to the touch");
  assert.equal((await load("c")).cacheState, "hit");
  assert.equal((await load("d")).cacheState, "hit");
  assert.equal((await load("e")).cacheState, "hit");
  assert.equal((await load("b")).cacheState, "miss", "b was the front slot");
});

test("history-cache: untouched entries evict in pure insertion order (tie-break)", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: 3, clock });
  const load = (key: string) => cache.load(key, async () => `v-${key}`);

  for (const key of ["a", "b", "c", "d"]) await load(key); // retained: b, c, d
  assert.equal((await load("b")).cacheState, "hit");
  assert.equal((await load("c")).cacheState, "hit");
  assert.equal((await load("d")).cacheState, "hit");
  assert.equal((await load("a")).cacheState, "miss", "a was the front slot"); // its re-store evicts b
  assert.equal((await load("b")).cacheState, "miss", "insertion order breaks ties"); // re-store evicts c
  assert.equal((await load("e")).cacheState, "miss"); // evicts d
  assert.equal((await load("a")).cacheState, "hit", "the re-stored a is retained normally");
});

test("history-cache: TTL stays lazy with a bound — expiry needs no timer", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: 2, clock });
  const load = (key: string) => cache.load(key, async () => `v-${key}`);

  await load("a");
  await load("b");
  clock.advance(10_000); // both expired; nothing was evicted (no timers ran)
  assert.equal(cache.size(), 2, "expiry is lazy — retention is not timer-driven");
  assert.equal((await load("a")).cacheState, "miss", "expired ⇒ a fresh walk");
  assert.equal(cache.size(), 2, "the rebuilt entry stays inside the bound");
});

test("history-cache: flights stay unbounded — maxEntries 1 coalesces and completes all keys", async () => {
  const clock = makeFixedClock();
  const cache = createHistoryCache({ ttlSeconds: 10, maxEntries: 1, clock });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const loadGated = (key: string) => {
    calls += 1;
    return cache.load(key, () => gate.then(() => `v-${key}`));
  };

  // Three DIFFERENT keys fly concurrently — the bound is on retention only,
  // never on in-flight work (admission is capped by create.ts, §3).
  const inFlight = ["a", "b", "c"].map(loadGated);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const all = await Promise.all(inFlight);
  assert.equal(calls, 3, "the bound must never queue or refuse distinct-key flights");
  assert.deepEqual(all.map((o) => o.value), ["v-a", "v-b", "v-c"]);
  assert.equal(cache.size(), 1, "retention still trims to the bound");
});

test("history-cache: eviction never alters response bytes (SC-002 rule)", async () => {
  const clock = makeFixedClock();
  const bounded = createHistoryCache({ ttlSeconds: 10, maxEntries: 1, clock });
  const control = createHistoryCache({ ttlSeconds: 10, maxEntries: UNBOUNDED, clock });
  const value = JSON.stringify({ events: [{ at: "2026-02-01T10:00:00.000Z", kind: "applied" }] });
  const loader = () => Promise.resolve(value);

  const first = await bounded.load("task-a", loader);
  await bounded.load("task-b", loader); // evicts task-a
  const again = await bounded.load("task-a", loader);

  assert.equal(again.cacheState, "miss", "bounded run re-reads after eviction");
  assert.equal(again.value, first.value, "same loader ⇒ byte-identical payload");
  const controlRun = await control.load("task-a", loader);
  assert.equal(controlRun.value, again.value, "bounded and control runs serve identical bytes");
});
