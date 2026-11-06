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
