/**
 * T013 [P] — unit tests for the session-scoped plan-reference store (T020)
 * (FR-003/FR-005 session rule; data-model §5; research R5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlanReferenceStore, isPlanIdShape, PLAN_ID_PATTERN } from "../../src/mcp/plan-store.js";
import { FakeClock } from "../helpers/test-utils.js";

const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);

test("PLAN_ID_PATTERN is the frozen 64-hex shape", () => {
  assert.ok(PLAN_ID_PATTERN.test(ID_A));
  assert.ok(!PLAN_ID_PATTERN.test("A".repeat(64)), "lowercase hex only");
  assert.ok(!PLAN_ID_PATTERN.test("a".repeat(63)));
  assert.ok(!PLAN_ID_PATTERN.test("a".repeat(65)));
  assert.ok(!PLAN_ID_PATTERN.test("run-42"));
  assert.ok(isPlanIdShape(ID_B));
});

test("record accepts ONLY the 64-hex shape; invalid ids are refused and not recorded", () => {
  const store = createPlanReferenceStore(new FakeClock("2026-01-01T00:00:00.000Z"));
  assert.equal(store.record(ID_A), true);
  assert.equal(store.has(ID_A), true);
  assert.equal(store.size, 1);
  for (const bad of ["", "ZZ", ID_A.slice(0, 63), `${ID_A}0`, ID_A.toUpperCase()]) {
    assert.equal(store.record(bad), false, `must refuse ${JSON.stringify(bad)}`);
  }
  assert.equal(store.size, 1, "refused ids add nothing");
});

test("recordedAt comes from the INJECTED clock (no wall-clock reads)", () => {
  const clock = new FakeClock("2026-03-04T05:06:07.000Z");
  const store = createPlanReferenceStore(clock);
  store.record(ID_A);
  const record = store.get(ID_A);
  assert.ok(record);
  assert.equal(record.planId, ID_A);
  assert.equal(record.recordedAt, "2026-03-04T05:06:07.000Z");
  clock.advanceMs(60_000);
  store.record(ID_B);
  assert.equal(store.get(ID_B)?.recordedAt, "2026-03-04T05:07:07.000Z");
});

test("records carry ONLY the reference + timestamp — no plan bodies (keys ARE the references)", () => {
  const store = createPlanReferenceStore(new FakeClock("2026-01-01T00:00:00.000Z"));
  store.record(ID_A);
  const record = store.get(ID_A);
  assert.deepEqual(Object.keys(record ?? {}).sort(), ["planId", "recordedAt"]);
});

test("recording the same planId twice is harmless (size stays 1)", () => {
  const store = createPlanReferenceStore(new FakeClock("2026-01-01T00:00:00.000Z"));
  store.record(ID_A);
  store.record(ID_A);
  assert.equal(store.size, 1);
  assert.equal(store.has(ID_A), true);
});

test("RESTART rule: a NEW store instance sees ZERO references — every previous id unknown", () => {
  const first = createPlanReferenceStore(new FakeClock("2026-01-01T00:00:00.000Z"));
  first.record(ID_A);
  first.record(ID_B);
  const restarted = createPlanReferenceStore(new FakeClock("2026-01-02T00:00:00.000Z"));
  assert.equal(restarted.size, 0);
  assert.equal(restarted.has(ID_A), false);
  assert.equal(restarted.has(ID_B), false);
  assert.equal(restarted.get(ID_A), null);
});

test("multiple references accumulate independently; has() on unknown ids is false", () => {
  const store = createPlanReferenceStore(new FakeClock("2026-01-01T00:00:00.000Z"));
  store.record(ID_A);
  store.record(ID_B);
  assert.equal(store.size, 2);
  assert.equal(store.has(ID_A), true);
  assert.equal(store.has(ID_B), true);
  assert.equal(store.has("c".repeat(64)), false);
});

// ── T026 (feature 014) — TTL + capacity bounds (resource-bounds.md §5, FR-007) ──

test("bounded store: an entry expires after ttlSeconds — has/get report absent (lazy)", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = createPlanReferenceStore(clock, { ttlSeconds: 60, maxEntries: 1000 });
  store.record(ID_A);

  clock.advanceMs(60_000); // age === ttl ⇒ still fresh (expiry is age > ttl)
  assert.equal(store.has(ID_A), true, "at exactly ttl the entry is fresh");
  assert.ok(store.get(ID_A));

  clock.advanceMs(1); // age 61 s > 60 s ttl
  assert.equal(store.has(ID_A), false, "expired ⇒ absent");
  assert.equal(store.get(ID_A), null, "expired ⇒ null");
  assert.equal(store.size, 0, "the expired entry was removed opportunistically");
});

test("bounded store: re-recording does NOT restamp — original expiry stands", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = createPlanReferenceStore(clock, { ttlSeconds: 60, maxEntries: 1000 });
  store.record(ID_A);
  clock.advanceMs(30_000);
  assert.equal(store.record(ID_A), true, "re-recording an existing ref is harmless");
  assert.equal(store.get(ID_A)?.recordedAt, "2026-01-01T00:00:00.000Z", "no restamp");
  clock.advanceMs(30_001); // total 61 s from the ORIGINAL record
  assert.equal(store.has(ID_A), false);
});

test("bounded store: capacity 3 — the fourth record evicts the oldest recordedAt", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = createPlanReferenceStore(clock, { ttlSeconds: 86_400, maxEntries: 3 });
  const ids = [ID_A, ID_B, "c".repeat(64), "d".repeat(64)];
  for (const id of ids) {
    store.record(id);
    clock.advanceMs(1_000); // distinct recordedAt values
  }
  assert.ok(store.size <= 3, `capacity invariant: ${store.size}`);
  assert.equal(store.has(ids[0]!), false, "the oldest recordedAt is gone");
  assert.equal(store.get(ids[0]!), null);
  for (const id of ids.slice(1)) assert.equal(store.has(id), true);
});

test("bounded store: equal recordedAt values evict in insertion order (tie-break)", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z"); // clock never advances
  const store = createPlanReferenceStore(clock, { ttlSeconds: 3_600, maxEntries: 3 });
  const ids = [ID_A, ID_B, "c".repeat(64), "d".repeat(64)];
  for (const id of ids) store.record(id);
  assert.equal(store.size, 3);
  assert.equal(store.has(ids[0]!), false, "first-inserted breaks the tie first");
  assert.equal(store.has(ids[1]!), true);
  assert.equal(store.has(ids[3]!), true);
});

test("bounded store: shape refusal unchanged, and expiry sweep precedes insert", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = createPlanReferenceStore(clock, { ttlSeconds: 60, maxEntries: 3 });
  store.record(ID_A);
  for (const bad of ["", "nope", ID_A.toUpperCase()]) {
    assert.equal(store.record(bad), false);
    assert.equal(store.size, 1, "refusals add nothing");
  }
  clock.advanceMs(61_000);
  store.record(ID_B); // the eager sweep on record drops the expired ID_A first
  assert.equal(store.size, 1, "expired entries are swept, not counted against capacity");
});

test("bounded store: expired ≡ evicted ≡ unknown at the API (fail-closed equivalence)", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const expiredStore = createPlanReferenceStore(clock, { ttlSeconds: 60, maxEntries: 10 });
  expiredStore.record(ID_A);
  clock.advanceMs(61_000);
  const evictedStore = createPlanReferenceStore(clock, { ttlSeconds: 3_600, maxEntries: 1 });
  evictedStore.record(ID_A);
  evictedStore.record(ID_B); // evicts ID_A (oldest recordedAt)
  const fresh = createPlanReferenceStore(clock, { ttlSeconds: 3_600, maxEntries: 10 });

  for (const store of [expiredStore, evictedStore, fresh]) {
    assert.equal(store.has(ID_A), false);
    assert.equal(store.get(ID_A), null);
  }
});

test("default bounds (no second argument): entries never expire and retention is unbounded", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = createPlanReferenceStore(clock);
  const idOf = (i: number): string => (i.toString(16) + "0".repeat(64)).slice(0, 64);
  for (let i = 0; i < 10; i += 1) assert.equal(store.record(idOf(i)), true);
  clock.advanceMs(365 * 24 * 3_600_000); // a full year
  assert.equal(store.size, 10, "unbounded retention at the default");
  for (let i = 0; i < 10; i += 1) assert.equal(store.has(idOf(i)), true, "no expiry at the default");
});
