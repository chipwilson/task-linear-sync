/**
 * T028 [P] [US2] — Op-ordering + deterministic-id unit tests (`src/engine/ops.ts`;
 * FR-011; research R10/R14; data-model §5; contracts/engine-pipeline.md apply stage:
 * "mutations, per op in order: parents-before-children, same-parent siblings reversed").
 *
 * Pins three surfaces of the op-taxonomy module:
 *  1. `deriveOpId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` — ALREADY implemented by
 *     the build lane (T024); this file pins the byte contract so T040 must preserve it:
 *     segments joined by exactly one NUL (`\u0000`), ordinal rendered as `String(ordinal)`
 *     (decimal), lowercase-hex sha256 digest — re-derived independently via `node:crypto`
 *     here, never by re-calling the module under test.
 *  2. `deriveRunId = sha256(planId ‖ clock.now().iso ‖ seq)` — ALREADY implemented; pinned
 *     under an injected `fixedClock` for seq 0/1/2 (plan report / apply / rollback, stub
 *     JSDoc), including same-instant-same-seq determinism across distinct clock objects.
 *  3. `emissionOrder(tasks)` — T040 stub (`not implemented: ops`). RED until T040 lands.
 *
 * Pinning choices T040 MUST honor for `emissionOrder` (derived from stub JSDoc + R10/FR-011):
 *  A. Working order W is `filePath` ascending then `lineNumber` ascending, computed from
 *     the task SET — the output is identical for any permutation of the input array
 *     ("stable across files"), and the input array is never mutated (pure function).
 *  B. Every present parent precedes every descendant (transitive on `parentUuid`).
 *  C. Siblings sharing one `parentUuid` are pairwise emitted in REVERSE of W (001 R12
 *     compensation); this includes groups whose `parentUuid` names a task ABSENT from the
 *     input — they are still one sibling group by value, and a dangling parent is never
 *     awaited (the group is emitted as a root-equivalent, entries are never dropped).
 *  D. Chains (single-child groups) are order-fully-determined by B alone — tested as such.
 *  E. Cross-tree interleaving of independent sibling GROUPS is deliberately NOT pinned
 *     (both stable-topological and DFS-from-roots satisfy B+C); tests assert within-group
 *     relative order via subsequences plus the fully-determined single-tree golden.
 *  F. Output is an exact permutation of the input set (same members, no dupes/drops).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  deriveOpId,
  deriveRunId,
  emissionOrder,
} from "../../src/engine/ops.js";
import type { EngineOpKind } from "../../src/engine/ops.js";

import type { Task } from "task-linear-sync/domain";
import { fixedClock } from "task-linear-sync/state";
import { syntheticUuid } from "task-linear-sync/tracker/testing";

// ── Fixtures (hermetic: syntheticUuid seeds, placeholder paths, zero real ids) ──────

const KINDS: readonly EngineOpKind[] = [
  "create-issue",
  "update-issue",
  "upsert-attachment",
  "render-file",
  "write-checkpoint",
];

/** Independent reference for the R14 byte contract (NUL-join + sha256 hex). */
function sha256Nul(segments: readonly string[]): string {
  return createHash("sha256").update(segments.join("\u0000"), "utf8").digest("hex");
}

const HEX64 = /^[0-9a-f]{64}$/;

let taskSeed = 0;
function makeTask(filePath: string, lineNumber: number, parentUuid?: string): Task {
  const uuid = syntheticUuid(taskSeed++);
  return {
    stableUuid: uuid,
    kind: "heading",
    filePath,
    lineNumber,
    frameworkId: "generic",
    title: `task-${uuid.slice(0, 8)}`,
    ...(parentUuid === undefined ? {} : { parentUuid }),
    childUuids: [],
    taskBody: { startLine: lineNumber, endLine: lineNumber },
    unresolvedConflict: false,
  };
}

function uuidsOf(tasks: readonly Task[]): readonly string[] {
  return tasks.map((t) => t.stableUuid);
}

/** Deterministic input permutations: identity, reverse, and a rotation. */
function permutations<T>(items: readonly T[]): readonly (readonly T[])[] {
  const n = items.length;
  return [
    items,
    [...items].reverse(),
    [...items.slice(Math.floor(n / 2)), ...items.slice(0, Math.floor(n / 2))],
  ];
}

/** Filtered subsequence of `seq` restricted to `ids` (cross-tree order stays unpinned). */
function restricted(seq: readonly string[], ids: readonly string[]): readonly string[] {
  const wanted = new Set(ids);
  return seq.filter((u) => wanted.has(u));
}

// ── 1. deriveOpId (implemented by T024 — green; byte contract pinned for T040) ─────

test("engine-ops-order — deriveOpId equals sha256(planId‖taskUuid‖kind‖String(ordinal)) with single-NUL joins", () => {
  const planId = sha256Nul(["plan-fixture"]);
  const taskUuid = syntheticUuid(0);
  for (const kind of KINDS) {
    for (const ordinal of [0, 1, 2, 9, 10, 36]) {
      const expected = sha256Nul([planId, taskUuid, kind, String(ordinal)]);
      assert.match(deriveOpId(planId, taskUuid, kind, ordinal), HEX64, "lowercase hex digest");
      assert.equal(
        deriveOpId(planId, taskUuid, kind, ordinal),
        expected,
        `opId bytes pinned: NUL-joined "${kind}" ordinal ${ordinal} via String()`,
      );
    }
  }
});

test("engine-ops-order — deriveOpId is call-stable and varies with each input segment", () => {
  const p = "f".repeat(64);
  const a = syntheticUuid(1);
  const b = syntheticUuid(2);
  assert.equal(deriveOpId(p, a, "create-issue", 0), deriveOpId(p, a, "create-issue", 0));

  const seen = new Set<string>();
  seen.add(deriveOpId(p, a, "create-issue", 0));
  for (const variant of [
    deriveOpId("e".repeat(64), a, "create-issue", 0), // planId differs
    deriveOpId(p, b, "create-issue", 0), // taskUuid differs
    ...KINDS.filter((k) => k !== "create-issue").map((k) => deriveOpId(p, a, k, 0)), // kind differs
    deriveOpId(p, a, "create-issue", 1), // ordinal differs
  ]) {
    assert.ok(!seen.has(variant), "every segment/ordinal change yields a fresh opId");
    seen.add(variant);
  }
});

test("engine-ops-order — deriveOpId ordinals render as String(ordinal) decimals (36 ≠ base-36 letter)", () => {
  const p = "a".repeat(64);
  const u = syntheticUuid(3);
  // Pins the stub-JSDoc `String(ordinal)` rendering against a base-36 reading:
  assert.notEqual(deriveOpId(p, u, "update-issue", 36), sha256Nul([p, u, "update-issue", "z"]));
  assert.equal(deriveOpId(p, u, "update-issue", 36), sha256Nul([p, u, "update-issue", "36"]));
});

test("engine-ops-order — NUL separator prevents segment-boundary collisions", () => {
  // ("ab"‖"c") and ("a"‖"bc") must not collide without the separator.
  const left = deriveOpId("ab", "c", "render-file", 0);
  const right = deriveOpId("a", "bc", "render-file", 0);
  assert.notEqual(left, right);
});

// ── 2. deriveRunId (implemented by T024 — green; seq 0/1/2 pinned for T040) ────────

test("engine-ops-order — deriveRunId equals sha256(planId‖clock.now().iso‖String(seq)) under the injected clock", () => {
  const planId = sha256Nul(["run-fixture"]);
  const iso = "2026-02-02T02:02:02.000Z";
  const clock = fixedClock(new Date(iso));
  for (const seq of [0, 1, 2]) {
    assert.equal(
      deriveRunId(planId, clock, seq),
      sha256Nul([planId, new Date(iso).toISOString(), String(seq)]),
      `runId bytes pinned for seq ${seq} (report=0 / apply=1 / rollback=2)`,
    );
  }
});

test("engine-ops-order — deriveRunId separates seqs and instants but ignores clock identity", () => {
  const planId = "c".repeat(64);
  const iso = "2026-03-03T03:03:03.000Z";
  const bySeq = [0, 1, 2].map((seq) => deriveRunId(planId, fixedClock(new Date(iso)), seq));
  assert.equal(new Set(bySeq).size, 3, "seq 0/1/2 never collide in one instant");
  assert.equal(deriveRunId(planId, fixedClock(new Date(iso)), 1), bySeq[1]);
  assert.notEqual(deriveRunId(planId, fixedClock(new Date("2026-03-03T03:03:04.000Z")), 1), bySeq[1]);
  assert.notEqual(deriveRunId("d".repeat(64), fixedClock(new Date(iso)), 1), bySeq[1]);
});

// ── 3. emissionOrder (T040 stub — every test below RED: not implemented: ops) ──────

test("engine-ops-order — single tree emits parent first with same-parent siblings in reverse working order", () => {
  const file = "specs/demo/tasks.md";
  const root = makeTask(file, 1);
  const c1 = makeTask(file, 2, root.stableUuid);
  const c2 = makeTask(file, 3, root.stableUuid);
  const c3 = makeTask(file, 4, root.stableUuid);
  // Fully determined golden (pinning choice E): root, then [c3,c2,c1] reversed.
  assert.deepEqual(
    uuidsOf(emissionOrder([root, c1, c2, c3])),
    [root.stableUuid, c3.stableUuid, c2.stableUuid, c1.stableUuid],
  );
});

test("engine-ops-order — emission is an exact permutation of the task set and never mutates the input", () => {
  const a = makeTask("specs/a/tasks.md", 1);
  const a1 = makeTask("specs/a/tasks.md", 2, a.stableUuid);
  const a2 = makeTask("specs/a/tasks.md", 3, a.stableUuid);
  const b = makeTask("specs/b/tasks.md", 1);
  const input = [a1, b, a, a2];
  const snapshot = [...input];
  const out = emissionOrder(input);
  assert.equal(out.length, input.length, "no ops dropped or duplicated");
  assert.deepEqual([...uuidsOf(out)].sort(), [...uuidsOf(input)].sort(), "same member set");
  assert.deepEqual(input, snapshot, "input array untouched (pure function)");
});

test("engine-ops-order — every present ancestor precedes every descendant, transitively (chain golden)", () => {
  const file = "specs/chain/tasks.md";
  const g = makeTask(file, 1);
  const p = makeTask(file, 5, g.stableUuid);
  const c = makeTask(file, 9, p.stableUuid);
  const d = makeTask(file, 13, c.stableUuid);
  // Chains are order-determined by the parent-before-child rule alone (pinning D).
  const seq = uuidsOf(emissionOrder([d, c, p, g]));
  assert.deepEqual(seq, [g.stableUuid, p.stableUuid, c.stableUuid, d.stableUuid]);
});

test("engine-ops-order — same-parent siblings reverse pairwise across independent trees", () => {
  const file = "specs/twins/tasks.md";
  const t1 = makeTask(file, 1);
  const t1a = makeTask(file, 2, t1.stableUuid);
  const t1b = makeTask(file, 3, t1.stableUuid);
  const t2 = makeTask(file, 10);
  const t2a = makeTask(file, 11, t2.stableUuid);
  const t2b = makeTask(file, 12, t2.stableUuid);
  const seq = uuidsOf(emissionOrder([t2b, t1a, t2, t1b, t1, t2a]));
  // Within-group order is pinned (reverse); cross-group interleaving is not (pinning E).
  assert.deepEqual(restricted(seq, [t1.stableUuid, t1a.stableUuid, t1b.stableUuid]), [
    t1.stableUuid,
    t1b.stableUuid,
    t1a.stableUuid,
  ]);
  assert.deepEqual(restricted(seq, [t2.stableUuid, t2a.stableUuid, t2b.stableUuid]), [
    t2.stableUuid,
    t2b.stableUuid,
    t2a.stableUuid,
  ]);
});

test("engine-ops-order — output is stable across files and independent of input permutation", () => {
  const tree: Task[] = [];
  for (const file of ["specs/x/tasks.md", "specs/y/tasks.md", "specs/z/tasks.md"]) {
    const root = makeTask(file, 1);
    tree.push(root, makeTask(file, 2, root.stableUuid), makeTask(file, 3, root.stableUuid));
  }
  const outputs = permutations(tree).map((input) => uuidsOf(emissionOrder(input)));
  for (const seq of outputs) {
    assert.deepEqual(seq, outputs[0], "identical emission order for every input permutation");
  }
  assert.deepEqual(
    uuidsOf(emissionOrder([...tree])),
    outputs[0],
    "deterministic across separate invocations",
  );
});

test("engine-ops-order — dangling parentUuid groups by value, reverses as siblings, and is never awaited or dropped", () => {
  const file = "specs/orphans/tasks.md";
  const missing = syntheticUuid(900); // parent outside the task set
  const o1 = makeTask(file, 1, missing);
  const o2 = makeTask(file, 2, missing);
  const o3 = makeTask(file, 3, missing);
  const seq = uuidsOf(emissionOrder([o1, o2, o3]));
  assert.deepEqual(seq, [o3.stableUuid, o2.stableUuid, o1.stableUuid], "dangling group still reverses (pinning C)");
});
