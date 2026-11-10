/**
 * T020 [US3] — identity behavior for `spec-superpower` at plan-registry scale
 * (FR-010, data-model §3 rules 4/8, contract Rule 6): two dated plans sharing a
 * date-stripped name keep pairwise-DISTINCT `stableUuid`s (the A-018-2 `identityFileScope`
 * seed composition), parses are deterministic, in-place description edits shift no uuid,
 * and duplicate local ids warn exactly once while both tasks are retained. Closes with
 * the SC-005 regression pin: kiro/generic seeds recompute through the PRE-feature
 * composition untouched (`identityFileScope` absent ⇒ bare local-id seed input).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { builtInAdapters } from "task-linear-sync/discovery";
import { deriveStableUuid, type TaskFileAdapter, parseTaskFile } from "task-linear-sync/parsing";
import { taskStableSeed } from "task-linear-sync/domain";

import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();

/** 004 consumer view (adapter-consumption boundary rule 2), as in parsing-spec-superpower.test.ts. */
function consumerView(id: "spec-superpower" | "kiro" | "generic"): TaskFileAdapter {
  const row = builtInAdapters[id];
  return {
    id,
    featureName: (filePath: string) => row.featureName(filePath),
    headingGrammar: row.headingGrammar,
    phasePattern: row.phasePattern,
    summaryPattern: row.summaryPattern,
    rollupPattern: row.rollupPattern,
    identityFileScope: row.identityFileScope,
  };
}

const superpower = consumerView("spec-superpower");
const PLANS = join(fixtureRepoPath("spec-superpower"), "docs", "superpowers", "plans");

function parsePlan(name: string, content: string) {
  return parseTaskFile(`docs/superpowers/plans/${name}`, content, superpower, cfg);
}

const sync01 = readFileSync(join(PLANS, "2026-11-01-sync.md"), "utf8");
const sync09 = readFileSync(join(PLANS, "2026-11-09-sync.md"), "utf8");

test("spec-superpower identity — same date-stripped feature name on two dates yields pairwise-DISTINCT stableUuids (contract Rule 6, US3-AC2)", () => {
  const a = parsePlan("2026-11-01-sync.md", sync01);
  const b = parsePlan("2026-11-09-sync.md", sync09);
  // The whole premise of Rule 6: without the file scope these two files collide —
  // same frameworkId, same derived featureName ("sync"), same local ids Task 1–3.
  assert.equal(a.featureName, "sync");
  assert.equal(b.featureName, "sync");
  assert.deepEqual(
    a.file.tasks.map((t) => t.localTaskId),
    b.file.tasks.map((t) => t.localTaskId),
  );
  const uuidsA = new Set(a.file.tasks.map((t) => t.stableUuid));
  const uuidsB = b.file.tasks.map((t) => t.stableUuid);
  for (const uuid of uuidsB) assert.ok(!uuidsA.has(uuid), `stableUuid ${uuid} must not appear in both files`);
  assert.equal(uuidsA.size, 3);
  assert.equal(new Set(uuidsB).size, 3);
});

test("spec-superpower identity — repeated parses are byte-identical (determinism, FR-010)", () => {
  const serialize = (t: ReturnType<typeof parsePlan>) =>
    JSON.stringify(t.file.tasks.map((x) => [x.stableUuid, x.localTaskId, x.title]));
  assert.equal(serialize(parsePlan("2026-11-09-sync.md", sync09)), serialize(parsePlan("2026-11-09-sync.md", sync09)));
});

test("spec-superpower identity — an in-place description edit under Task 2 leaves every uuid unchanged (US3-AC3)", () => {
  const edited = sync01.replace(
    "Hash each task body span and report only the spans that changed.",
    "Hash each task body span and report only the spans that changed since the last run.",
  );
  assert.notEqual(edited, sync01, "the edit must actually land on the description line");
  const before = parsePlan("2026-11-01-sync.md", sync01).file.tasks.map((t) => t.stableUuid);
  const after = parsePlan("2026-11-01-sync.md", edited).file.tasks.map((t) => t.stableUuid);
  assert.deepEqual(after, before, "matching must survive in-place plan edits untouched");
});

test("spec-superpower identity — two `Task 1:` headings in one plan: exactly one duplicate-local-id warning, both tasks retained (data-model §3 rule 8)", () => {
  const dup = sync09.replace("### Task 2: LedgerWalk", "### Task 1: LedgerWalk");
  const result = parsePlan("2026-11-09-sync.md", dup);
  assert.equal(result.file.tasks.length, 3, "both duplicate tasks are retained (warning, never refusal)");
  const duplicates = result.warnings.filter((w) => w.kind === "duplicate-local-id");
  assert.equal(duplicates.length, 1, "exactly one duplicate-local-id warning");
  assert.deepEqual(
    result.file.tasks.map((t) => t.localTaskId),
    ["Task 1", "Task 1", "Task 3"],
  );
});

test("spec-superpower identity — SC-005 regression: kiro/generic seeds recompute through the PRE-feature composition, byte-identical (A-018-2 scoping)", () => {
  const cases: readonly (readonly [ReturnType<typeof consumerView>, string, string])[] = [
    [consumerView("kiro"), ".kiro/specs/auth/tasks.md", fixtureRepoPath("../../parsing/frameworks/kiro/tasks.md")],
    [consumerView("generic"), "specs/pay/tasks.md", fixtureRepoPath("../../parsing/frameworks/generic/tasks.md")],
  ];
  for (const [adapter, filePath, fixture] of cases) {
    assert.equal(adapter.identityFileScope, undefined, "the row must NOT opt into file scope");
    const content = readFileSync(fixture, "utf8");
    const result = parseTaskFile(filePath, content, adapter, cfg);
    const featureName = adapter.featureName(filePath);
    result.file.tasks.forEach((task, ordinal) => {
      // Pre-018 composition verbatim: the seed input is the BARE local id (or the
      // `ordinal:filePath` fallback) — no basename is ever composed for these rows.
      const seed = taskStableSeed(
        { frameworkId: adapter.id, featureName, localTaskId: task.localTaskId },
        { ordinal, filePath },
      );
      assert.equal(task.stableUuid, deriveStableUuid(seed, cfg.toolId), `${adapter.id} task at line ${task.lineNumber}`);
    });
    assert.ok(result.file.tasks.length > 0);
  }
});
