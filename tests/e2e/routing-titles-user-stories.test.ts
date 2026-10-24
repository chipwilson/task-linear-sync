/**
 * T028 [Polish] — scripted e2e walkthrough of both user stories over a fixture task set.
 * Zero network, zero dependency on 004: tasks are hand-built fixtures; the walkthrough
 * exercises the two 005 module BARRLES (`src/routing`, `src/titles`) end to end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRouting } from "../../src/routing/index.js";
import { deriveTitle, stripTitleForRender } from "../../src/titles/index.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";
import { defaultSlice, nestedSlice, tieSlice } from "../fixtures/routing-titles/routing-maps.js";
import {
  areaRuleSet,
  areaStripPrefixes,
  makeTitleSlice,
} from "../fixtures/routing-titles/title-fixtures.js";
import type { Task } from "../../src/domain/task.js";
import type { RoutingConfigSlice } from "../../src/routing/types.js";
import type { TitleConfigSlice } from "../../src/titles/types.js";

const TITLE_CFG: TitleConfigSlice = makeTitleSlice({ titleRules: areaRuleSet, titleStripPrefixes: areaStripPrefixes });

/** One walkthrough row: a task, the routing slice it uses, the destination it must land in. */
interface WalkRow {
  readonly task: Task;
  readonly slice: RoutingConfigSlice;
  readonly expect: Readonly<Record<string, unknown>>;
}

const walkRows: readonly WalkRow[] = [
  {
    // Deepest prefix selects BOTH team and project (US1 AC1).
    task: makeTask({ stableUuid: "e2e-1", filePath: "specs/api/auth/spec.md", featureName: "user-authentication", localTaskId: "Task 1.2", title: "Add login flow" }),
    slice: nestedSlice,
    expect: { teamKey: "acme-team", project: "proj-gamma", matchedPrefix: "specs/api/auth/", defaulted: false },
  },
  {
    // Equal-length tie → first-by-map-order with the indication (US1 AC2).
    task: makeTask({ stableUuid: "e2e-2", filePath: "specs/both/tasks.md", featureName: "user-authentication", title: "Balance the queue" }),
    slice: tieSlice,
    expect: { teamKey: "acme-team", project: "proj-alpha", matchedPrefix: "specs/both/", defaulted: false, tieBreak: "first-by-map-order" },
  },
  {
    // Unmatched path → configured defaults apply (US1 AC3).
    task: makeTask({ stableUuid: "e2e-3", filePath: "docs/runbook.md", title: "Document the rotation" }),
    slice: defaultSlice,
    expect: { teamKey: "acme-team", project: "proj-default", defaulted: true },
  },
  {
    // No match, no defaults → visibly unassigned; processing CONTINUES for the rest (US1 AC4).
    task: makeTask({ stableUuid: "e2e-4", filePath: "vendor/third-party.md", title: "Unrouted task" }),
    slice: nestedSlice,
    expect: { teamKey: "", project: "", defaulted: false, unassigned: true },
  },
];

test("e2e US1 — routing walkthrough: selections, tie indication, defaults, unassigned-with-continuation", () => {
  const results = walkRows.map((row) => resolveRouting(row.task.filePath, row.slice));
  assert.equal(results.length, walkRows.length, "processing never aborted on the unassigned row");
  walkRows.forEach((row, i) => {
    const res = results[i]! as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(row.expect)) {
      assert.equal(res[key], value, `row ${i} (${row.task.filePath}) field '${key}'`);
    }
    // Determinism (SC-001): identical on immediate re-run.
    assert.deepEqual(resolveRouting(row.task.filePath, row.slice), results[i]);
  });
});

test("e2e US2 — title walkthrough: derive, decorate exactly once, render-back strip, re-derive unchanged", () => {
  const task = makeTask({
    stableUuid: "e2e-title",
    filePath: "specs/infra/auth/spec.md",
    featureName: "user-authentication",
    localTaskId: "Task 1.2",
    title: "Add login flow",
  });

  const first = deriveTitle(task, TITLE_CFG);
  assert.equal(first.matchedRuleIndex, 0, "infrastructure-area rule applied");
  assert.equal(first.finalTitle, "user-authentication: <areaPrefixA> Task 1.2: Add login flow");

  // 004 render-back: strip produces the clean Markdown title…
  const rendered = stripTitleForRender(first.finalTitle, task, TITLE_CFG);
  assert.equal(rendered, "Add login flow");

  // …and a later parse + derivation over the rendered title reproduces the SAME final title.
  const reparsed: Task = { ...task, title: rendered };
  const second = deriveTitle(reparsed, TITLE_CFG);
  assert.equal(second.finalTitle, first.finalTitle, "no progressive prefixing across the round trip");

  // The tracker-side mirror re-derives to itself (001 R6.10 idempotence).
  assert.equal(deriveTitle({ ...task, title: first.finalTitle }, makeTitleSlice()).finalTitle, first.finalTitle);

  // A task with no Feature_Name round-trips unprefixed (FR-005).
  const plain = { ...task, stableUuid: "e2e-plain", featureName: undefined };
  const derived = deriveTitle(plain, TITLE_CFG);
  assert.equal(derived.decorated, false);
  const clean = stripTitleForRender(derived.finalTitle, plain, TITLE_CFG);
  assert.equal(clean, "Add login flow");
  assert.equal(deriveTitle({ ...plain, title: clean }, TITLE_CFG).finalTitle, derived.finalTitle);
});

test("e2e — combined story: routed corpus every task gets destination + stable title in one pass", () => {
  walkRows.forEach((row, i) => {
    const destination = resolveRouting(row.task.filePath, row.slice);
    const derived = deriveTitle(row.task, TITLE_CFG);
    // Every task yields exactly one final title and one destination; none abort the pass.
    assert.ok(derived.finalTitle.length > 0, `row ${i} produced no title`);
    assert.ok("defaulted" in destination);
    let current: Task = { ...row.task, title: stripTitleForRender(derived.finalTitle, row.task, TITLE_CFG) };
    for (let cycleNumber = 1; cycleNumber <= 10; cycleNumber++) {
      const again = deriveTitle(current, TITLE_CFG);
      assert.equal(again.finalTitle, derived.finalTitle, `row ${i} title drifted at cycle ${cycleNumber}`);
      current = { ...current, title: stripTitleForRender(again.finalTitle, current, TITLE_CFG) };
    }
  });
});
