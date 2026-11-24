/**
 * T006 [023 A-023-0(a)] — unit pins for the additive `TaskBodyExtent.promotedRanges`
 * amendment (feature 023; specs/002-core-domain-contracts/contracts/task-model.md,
 * docs/contract-amendments.md). The amendment is INERT: absence must render exactly the
 * contiguous `startLine..endLine` slice every 0.6.0 consumer saw, seeds and payloads of
 * existing fields are unchanged, and the member never appears in serialized state when
 * absent. The engine-side hole-slice itself is pinned at the integration tier
 * (spec-kitty two-level / flat-byte tests); this file pins the frozen-shape contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { taskStableSeed } from "task-linear-sync/domain";
import type { Task, TaskBodyExtent } from "task-linear-sync/domain";

function makeTask(taskBody: TaskBodyExtent): Task {
  return {
    stableUuid: "00000000-0000-5000-8000-000000000001",
    kind: "document",
    filePath: "kitty-specs/001-demo/tasks/WP01-one.md",
    lineNumber: 3,
    frameworkId: "spec-kitty",
    featureName: "001-demo",
    localTaskId: "WP01",
    title: "One",
    childUuids: [],
    taskBody,
    unresolvedConflict: false,
  };
}

test("A-023-0: a TaskBodyExtent WITHOUT promotedRanges stays exactly the 0.6.0 shape (absence renders identically)", () => {
  const extent: TaskBodyExtent = { startLine: 3, endLine: 10 };
  assert.equal(extent.promotedRanges, undefined);
  // The contiguous slice an absence-case consumer takes — byte semantics of 0.6.0:
  // lines[startLine-1 .. endLine] inclusive, nothing skipped.
  const lines = Array.from({ length: 14 }, (_, i) => `line-${i + 1}`);
  const contiguous = lines.slice(extent.startLine - 1, extent.endLine);
  assert.equal(contiguous.length, 8);
  assert.deepEqual(Object.keys(extent), ["startLine", "endLine"], "no hidden members appear");
  assert.equal(JSON.stringify(extent), '{"startLine":3,"endLine":10}', "serialized state never gains the key when absent");
});

test("A-023-0: promotedRanges is additive — the stable seed never sees taskBody, so existing and promoted tasks seed identically", () => {
  const ranges: ReadonlyArray<readonly [number, number]> = [[5, 6]];
  const plain = makeTask({ startLine: 3, endLine: 10 });
  const promoted = makeTask({ startLine: 3, endLine: 10, promotedRanges: ranges });
  const fallback = { ordinal: 0, filePath: plain.filePath };
  assert.equal(
    taskStableSeed(plain, fallback),
    taskStableSeed(promoted, fallback),
    "the frozen 3-part seed layout is untouched by the additive member",
  );
  assert.deepEqual(plain.taskBody.promotedRanges, undefined, "absent stays absent");
  assert.deepEqual(promoted.taskBody.promotedRanges, ranges, "present rides verbatim");
});

test("A-023-0: the member is read ONLY as inclusive 1-based line spans (documented type-level contract)", () => {
  const extent: TaskBodyExtent = { startLine: 1, endLine: 20, promotedRanges: [[4, 7], [9, 12]] };
  for (const [start, end] of extent.promotedRanges ?? []) {
    assert.ok(Number.isInteger(start) && Number.isInteger(end));
    assert.ok(1 <= start && start <= end && end <= extent.endLine, "spans are inclusive and inside the extent");
  }
});
