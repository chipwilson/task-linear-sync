/**
 * T011 — plan-reference predicate unit tests (quickstart Contract-freeze scenario 4,
 * contracts/engine-gates.md). Fresh guards ⇒ valid; single-byte file-hash drift or HEAD
 * drift ⇒ PLAN_REFERENCE_STALE; unknown id (no stored plan) ⇒ PLAN_REFERENCE_UNKNOWN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePlanReference, type GateFailure } from "task-linear-sync/gates";
import type { StoredPlan } from "task-linear-sync/domain";

const FILE = "specs/001-example/tasks.md";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HEAD = "c".repeat(40);

function storedPlan(overrides: { fileHash?: string; headCommit?: string | null } = {}): StoredPlan {
  return {
    plan: {
      planId: "f".repeat(64),
      generatedAt: "2026-10-21T09:00:00.000Z",
      repositoryRoot: "/fixture/repo-a",
      guards: {
        fileHashes: { [FILE]: overrides.fileHash ?? HASH_A },
        headCommit: overrides.headCommit === undefined ? HEAD : overrides.headCommit,
      },
      lowConfidencePresent: false,
      entries: [],
      unmappedIssues: [],
    },
    storedAt: "2026-10-21T09:00:01.000Z",
  };
}

const currentOk = { fileHashes: { [FILE]: HASH_A }, headCommit: HEAD };

test("matching guards => valid", () => {
  assert.deepEqual(validatePlanReference(storedPlan(), currentOk), { valid: true });
});

test("null / absent stored plan => PLAN_REFERENCE_UNKNOWN (distinct from STALE)", () => {
  const r = validatePlanReference(null, currentOk);
  assert.equal(r.valid, false);
  const f = (r as { valid: false; failure: GateFailure }).failure;
  assert.equal(f.code, "PLAN_REFERENCE_UNKNOWN");
  assert.ok(f.detail.length > 0, "detail names the offending value");
});

test("single-byte file-hash drift => PLAN_REFERENCE_STALE naming the file", () => {
  const drifted = { fileHashes: { [FILE]: HASH_B }, headCommit: HEAD };
  const r = validatePlanReference(storedPlan(), drifted);
  assert.equal(r.valid, false);
  const f = (r as { valid: false; failure: GateFailure }).failure;
  assert.equal(f.code, "PLAN_REFERENCE_STALE");
  assert.match(f.detail, new RegExp(FILE.replace(/[/.]/g, "\\$&")));
});

test("file removed from current inventory => PLAN_REFERENCE_STALE", () => {
  const r = validatePlanReference(storedPlan(), { fileHashes: {}, headCommit: HEAD });
  assert.equal(r.valid, false);
  assert.equal((r as { valid: false; failure: GateFailure }).failure.code, "PLAN_REFERENCE_STALE");
});

test("HEAD drift => PLAN_REFERENCE_STALE; null==null HEAD tolerates missing VCS", () => {
  const r = validatePlanReference(storedPlan(), { fileHashes: { [FILE]: HASH_A }, headCommit: "d".repeat(40) });
  assert.equal(r.valid, false);
  assert.equal((r as { valid: false; failure: GateFailure }).failure.code, "PLAN_REFERENCE_STALE");

  assert.deepEqual(
    validatePlanReference(storedPlan({ headCommit: null }), { fileHashes: { [FILE]: HASH_A }, headCommit: null }),
    { valid: true },
    "001 R1.10 tolerance: HEAD unavailable at plan time and now",
  );
});

test("multiple broken guards are listed together (no fail-fast-on-first)", () => {
  const multi: StoredPlan = {
    ...storedPlan(),
    plan: {
      ...storedPlan().plan,
      guards: {
        fileHashes: { "a.md": HASH_A, "b.md": HASH_A },
        headCommit: HEAD,
      },
    },
  };
  const r = validatePlanReference(multi, { fileHashes: { "a.md": HASH_B, "b.md": HASH_B }, headCommit: "e".repeat(40) });
  assert.equal(r.valid, false);
  const f = (r as { valid: false; failure: GateFailure }).failure;
  assert.equal(f.code, "PLAN_REFERENCE_STALE");
  assert.match(f.detail, /a\.md/);
  assert.match(f.detail, /b\.md/);
  assert.match(f.detail, /HEAD/i);
});
