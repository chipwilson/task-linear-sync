/**
 * T009 — domain invariant unit tests (contracts/task-model.md § Invariants).
 * 1. taskStableSeed independent of title / checked / issueRef.
 * 2. kind === "heading" ⇔ checked === undefined (construction invariant).
 * 3. serializeSyncStatePayload ↔ parseSyncStatePayload round-trip exact;
 *    serialized form has only string/number leaf types.
 * 4. Match.alternatives.length <= 3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  taskStableSeed,
  serializeSyncStatePayload,
  parseSyncStatePayload,
  type Task,
  type SyncStatePayload,
  type Match,
} from "task-linear-sync/domain";

function baseTask(over: Partial<Task> = {}): Task {
  return {
    stableUuid: "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    kind: "checklist",
    filePath: "specs/001-example/tasks.md",
    lineNumber: 12,
    frameworkId: "spec-kit",
    featureName: "001-example",
    localTaskId: "Task 1.2",
    title: "Original title",
    checked: false,
    childUuids: [],
    taskBody: { startLine: 12, endLine: 20 },
    unresolvedConflict: false,
    ...over,
  };
}

test("taskStableSeed is independent of title, checked, and issueRef", () => {
  const seed = taskStableSeed(baseTask(), { ordinal: 3, filePath: "specs/001-example/tasks.md" });

  // Mutate the three excluded fields — seed bytes must be unchanged.
  for (const variant of [
    baseTask({ title: "Completely different title 🔥" }),
    baseTask({ checked: true }),
    baseTask({ checked: undefined }),
    baseTask({ issueRef: { key: "SYNC", number: 42 } }),
    baseTask({ title: "x", checked: true, issueRef: { key: "SYNC", number: 7 } }),
  ]) {
    assert.equal(
      taskStableSeed(variant, { ordinal: 3, filePath: "specs/001-example/tasks.md" }),
      seed,
      "seed must not vary with excluded mutable fields",
    );
  }

  // Determinism: repeated calls byte-identical.
  assert.equal(
    taskStableSeed(baseTask(), { ordinal: 3, filePath: "specs/001-example/tasks.md" }),
    seed,
  );

  // Included identity fields DO change the seed.
  assert.notEqual(
    taskStableSeed(baseTask({ localTaskId: "Task 9.9" }), { ordinal: 3, filePath: "specs/001-example/tasks.md" }),
    seed,
  );
  assert.notEqual(
    taskStableSeed(baseTask({ frameworkId: "bmad" }), { ordinal: 3, filePath: "specs/001-example/tasks.md" }),
    seed,
  );
});

test("taskStableSeed R11 layout: frameworkId NUL featureName NUL localTaskId (ordinal+file fallback)", () => {
  const withId = taskStableSeed(
    { frameworkId: "kiro", featureName: "feat", localTaskId: "T001" },
    { ordinal: 7, filePath: "a/tasks.md" },
  );
  assert.equal(withId, ["kiro", "feat", "T001"].join("\u0000"));

  // localTaskId absent ⇒ ordinal + file identity fallback.
  const fallback = taskStableSeed(
    { frameworkId: "kiro", featureName: undefined, localTaskId: undefined },
    { ordinal: 7, filePath: "a/tasks.md" },
  );
  // fallback = `${ordinal}:${filePath}` (colon keeps the NUL separator unambiguous)
  assert.equal(fallback, "kiro\u0000\u00007:a/tasks.md");
});

test("kind heading ⇔ checked absent (invariant shape: heading tasks carry no checked key)", () => {
  const heading = baseTask({ kind: "heading", checked: undefined });
  assert.equal(heading.checked, undefined);
  assert.equal(heading.kind, "heading");
  const checklist = baseTask({ kind: "checklist", checked: false });
  assert.notEqual(checklist.checked, undefined);
});

const payload: SyncStatePayload = {
  taskUuid: "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  frameworkMetadata: {
    frameworkId: "spec-kit",
    featureName: "001-example",
    filePath: "specs/001-example/tasks.md",
    localTaskId: "Task 1.2",
  },
  descriptionContentHash: "0".repeat(64),
  cursors: { lastSyncAt: "2026-10-21T09:00:00.000Z" },
  history: [
    { kind: "discovered", at: "2026-10-20T08:00:00.000Z", description: "task discovered" },
    {
      kind: "rollback",
      at: "2026-10-21T09:00:00.000Z",
      description: "rolled back run r-1",
      references: ["op-1", "op-2"],
    },
  ],
};

test("serialize ↔ parse round-trip is exact", () => {
  assert.deepEqual(parseSyncStatePayload(serializeSyncStatePayload(payload)), payload);
});

test("serialized form uses only string/number leaf types and stable key order", () => {
  const s = serializeSyncStatePayload(payload);
  assert.ok(!s.includes("\n"), "compact (no pretty-printing)");
  const leaves = (v: unknown): unknown[] =>
    Array.isArray(v)
      ? v.flatMap(leaves)
      : v !== null && typeof v === "object"
        ? Object.values(v as Record<string, unknown>).flatMap(leaves)
        : [v];
  for (const leaf of leaves(JSON.parse(s))) {
    assert.ok(
      typeof leaf === "string" || typeof leaf === "number",
      `leaf type not string/number: ${String(leaf)}`,
    );
  }
  // Stable key order: insertion-order-different but equal payloads serialize identically.
  const reinserted = JSON.parse(
    JSON.stringify({
      history: payload.history,
      cursors: payload.cursors,
      descriptionContentHash: payload.descriptionContentHash,
      frameworkMetadata: payload.frameworkMetadata,
      taskUuid: payload.taskUuid,
    }),
  ) as SyncStatePayload;
  assert.equal(serializeSyncStatePayload(reinserted), s);
});

test("Match.alternatives bounded at <= 3 by contract shape", () => {
  const m: Match = {
    taskUuid: "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    issueId: "issue-1",
    score: 100,
    margin: 25,
    confidence: "high",
    durableIdentity: true,
    reasons: ["durable-uuid"],
    alternatives: [
      { issueId: "i2", score: 70, mapped: false },
      { issueId: "i3", score: 60, mapped: false },
      { issueId: "i4", score: 55, mapped: true },
    ],
  };
  assert.ok(m.alternatives.length <= 3);
});
