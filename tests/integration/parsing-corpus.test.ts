/**
 * T019 [US1] — five-framework corpus integration test (SC-001 verbatim: "100% of tasks in
 * the five-framework fixture corpus are extracted with correct kind, nesting, line
 * numbers, section extent, and derived feature name"; research R10).
 *
 * ONE shared assertion helper runs over `tests/fixtures/parsing/frameworks/*` with only
 * the injected fixture adapter differing; content is parsed under a representative
 * VIRTUAL repository path (`parseTaskFile` takes `filePath` as a parameter, so no
 * on-disk placement is needed), exercising each framework's `featureName` shape.
 * Zero 003 code: the fixture adapters are the sanctioned oracle (adapter-consumption.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTaskFile } from "task-linear-sync/parsing";
import type { ParseResult, TaskFileAdapter } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";

import {
  bmadFixtureAdapter,
  specKitFixtureAdapter,
  openSpecFixtureAdapter,
  kiroFixtureAdapter,
  genericFixtureAdapter,
  readFrameworkFixture,
  makeTestConfig,
} from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();

/** The shared expectation: the same tasks.md template is parsed by every framework. */
interface ExpectedTask {
  line: number;
  kind: "heading" | "checklist";
  id?: string;
  title: string;
  checked?: boolean;
  parent?: number;
  extent: [number, number];
  ref?: { key: string; number: number };
}

const CORPUS_TASKS: readonly ExpectedTask[] = [
  { line: 1, kind: "heading", title: "Tasks", extent: [1, 3] },
  { line: 5, kind: "heading", id: "1.1", title: "Create auth module", extent: [5, 10] },
  { line: 9, kind: "checklist", id: "1.1.1", title: "Define interface", checked: false, parent: 5, extent: [9, 10] },
  { line: 10, kind: "checklist", id: "1.1.2", title: "Add placeholder types", checked: false, parent: 9, extent: [10, 10] },
  { line: 12, kind: "heading", id: "1.2", title: "Wire session store", extent: [12, 16], ref: { key: "SYNC", number: 100 } },
  { line: 16, kind: "checklist", title: "Implement store", checked: true, parent: 12, extent: [16, 16] },
];

function lineOf(tasks: readonly Task[], uuid: string | undefined): number | undefined {
  return tasks.find((task) => task.stableUuid === uuid)?.lineNumber;
}

/** The one shared assertion helper — only the injected adapter/path/featureName differ. */
function assertCorpusExtraction(adapter: TaskFileAdapter, virtualPath: string, expectedFeature: string | undefined): ParseResult {
  const content = readFrameworkFixture(adapter.id);
  const result = parseTaskFile(virtualPath, content, adapter, cfg);
  const { tasks } = result.file;

  assert.deepEqual(tasks.map((task) => task.lineNumber), CORPUS_TASKS.map((task) => task.line), `lines for ${adapter.id}`);
  const lineIndex = new Map(tasks.map((task) => [task.lineNumber, task]));
  for (const expected of CORPUS_TASKS) {
    const task = lineIndex.get(expected.line);
    assert.ok(task, `task at line ${expected.line} (${adapter.id})`);
    assert.equal(task.kind, expected.kind);
    assert.equal(task.title, expected.title);
    assert.equal(task.localTaskId, expected.id, `localTaskId at ${expected.line}`);
    assert.equal(task.checked, expected.checked, `checked at ${expected.line}`);
    assert.deepEqual(task.issueRef, expected.ref, `issueRef at ${expected.line}`);
    assert.deepEqual(task.taskBody, { startLine: expected.extent[0], endLine: expected.extent[1] }, `extent at ${expected.line}`);
    assert.equal(lineOf(tasks, task.parentUuid), expected.parent, `parent at ${expected.line}`);
    assert.equal(task.frameworkId, adapter.id);
    assert.equal(task.phase, expected.line >= 5 ? "Foundation" : undefined); // FR-003 threading
    assert.equal(task.unresolvedConflict, false);
    assert.match(task.stableUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    if (expectedFeature === undefined) assert.ok(!("featureName" in task), "featureName MUST be absent when underivable (FR-008)");
    else assert.equal(task.featureName, expectedFeature);
  }

  assert.deepEqual(result.file.tasks.map((task) => task.lineNumber), tasks.map((task) => task.lineNumber)); // ascending
  assert.equal(result.file.filePath, virtualPath); // recorded verbatim
  assert.equal(result.file.frameworkId, adapter.id);
  assert.deepEqual(result.exclusions, []);
  assert.deepEqual(result.conflictBlocks, []);
  assert.deepEqual(result.warnings, []);
  return result;
}

const CORPUS: readonly { adapter: TaskFileAdapter; virtualPath: string; feature: string }[] = [
  { adapter: bmadFixtureAdapter, virtualPath: "bmad/auth/tasks.md", feature: "auth" },
  { adapter: specKitFixtureAdapter, virtualPath: "specs/auth/tasks.md", feature: "auth" },
  { adapter: openSpecFixtureAdapter, virtualPath: "openspec/auth/tasks.md", feature: "auth" },
  { adapter: kiroFixtureAdapter, virtualPath: ".kiro/specs/auth/tasks.md", feature: "auth" },
  { adapter: genericFixtureAdapter, virtualPath: "docs/auth/tasks.md", feature: "auth" },
];

test("parsing corpus — 100% extraction fidelity across the five framework fixtures (SC-001)", (t) => {
  for (const { adapter, virtualPath, feature } of CORPUS) {
    t.diagnostic(`corpus member ${adapter.id} @ ${virtualPath}`);
    const result = assertCorpusExtraction(adapter, virtualPath, feature);
    assert.equal(result.featureName, feature);
    assert.equal(result.file.featureName, feature); // FR-008 on TaskFile AND ParseResult
  }
});

test("parsing corpus — kiro grammar override parses the shared fixture identically (interface-visible conventions only)", () => {
  const viaKiro = assertCorpusExtraction(kiroFixtureAdapter, ".kiro/specs/auth/tasks.md", "auth");
  const viaGeneric = assertCorpusExtraction(genericFixtureAdapter, ".kiro/specs/auth/tasks.md", "auth");
  assert.deepEqual(
    viaKiro.file.tasks.map((task) => [task.lineNumber, task.localTaskId ?? null, task.title]),
    viaGeneric.file.tasks.map((task) => [task.lineNumber, task.localTaskId ?? null, task.title]),
  );
});

test("parsing corpus — featureName 'recording none when none can be derived' (FR-008 verbatim)", () => {
  const result = assertCorpusExtraction(genericFixtureAdapter, "tasks.md", undefined);
  assert.equal(result.featureName, undefined);
  assert.ok(!("featureName" in result.file));
});

test("parsing corpus — repeat-parse deep-equality determinism (Principle IV)", () => {
  const first = parseTaskFile("specs/auth/tasks.md", readFrameworkFixture("spec-kit"), specKitFixtureAdapter, cfg);
  const second = parseTaskFile("specs/auth/tasks.md", readFrameworkFixture("spec-kit"), specKitFixtureAdapter, cfg);
  assert.deepEqual(first, second);
});

test("parsing corpus — conflict-flagging through the corpus pipeline (FR-009)", () => {
  const content = [
    "## 1.1: Sync change", // 1
    "", // 2
    "- [ ] Safe item", // 3
    "", // 4
    "<<<<<<< HEAD", // 5
    "- [ ] Frozen never a task", // 6
    "=======", // 7
    "- [ ] Frozen other side", // 8
    ">>>>>>> upstream", // 9
    "", // 10
    "## 1.2: Clean tail", // 11
    "", // 12
    "- [x] Clean item", // 13
    "",
  ].join("\n");
  const result = parseTaskFile("specs/auth/tasks.md", content, genericFixtureAdapter, cfg);
  const flags = new Map(result.file.tasks.map((task) => [task.lineNumber, task.unresolvedConflict]));
  assert.deepEqual([...flags.entries()], [
    [1, true], // section extent 1..9 intersects the block
    [3, true],
    [11, false],
    [13, false],
  ]);
  assert.deepEqual(
    result.file.tasks.map((task) => task.lineNumber),
    [1, 3, 11, 13],
    "block-interior lines are never tasks",
  );
  assert.deepEqual(result.conflictBlocks, [{ startLine: 5, endLine: 9 }]);
});
