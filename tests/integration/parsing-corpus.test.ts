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
import { specKittyConventions } from "../../src/discovery/adapters/spec-kitty.js";

import {
  bmadFixtureAdapter,
  specKitFixtureAdapter,
  openSpecFixtureAdapter,
  kiroFixtureAdapter,
  genericFixtureAdapter,
  specKittyFixtureAdapter,
  readFrameworkFixture,
  readFixture,
  makeTestConfig,
} from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig({ maxTaskIssueDepth: 64 }); // 020: pin pre-feature cap — the shared fixture has nested checklist lines

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

test("parsing corpus — spec-kitty sixth identity (023 corpus): zero roll-up tasks, canonical documents plus promoted subtasks per file (SC-002, C1–C3)", () => {
  // Mirror pin: the helper's literal conventions equal the built-in row's members.
  assert.equal(specKittyFixtureAdapter.headingGrammar, specKittyConventions.headingGrammar);
  assert.deepEqual(specKittyFixtureAdapter.documentTaskRule, specKittyConventions.documentTaskRule);
  const retired = specKittyFixtureAdapter as unknown as Record<string, unknown>;
  assert.equal(retired.checklistIdPattern, undefined, "017 grammar members retired from the row (and its mirror)");
  assert.equal(retired.titleTagPattern, undefined);
  assert.equal(retired.phasePattern, undefined);
  assert.equal(retired.summaryPattern, undefined);

  // The roll-up yields the EMPTY task set: checkbox lines, WP headings, the `## Inputs`
  // illustrative checkbox and front matter are all documentation (FR-005) — zero line
  // scanning means zero exclusion records too.
  const rollUp = parseTaskFile("kitty-specs/001-corpus/tasks.md", readFrameworkFixture("spec-kitty"), specKittyFixtureAdapter, cfg);
  assert.deepEqual(rollUp.file.tasks, [], "the planned task set is EMPTY — the roll-up is documentation (FR-005, C2.3)");
  assert.deepEqual(rollUp.exclusions, []);
  assert.deepEqual(rollUp.warnings, []);
  assert.equal(rollUp.featureName, "001-corpus");

  // Each canonical tasks/WPnn-*.md yields one document task; at this cfg cap (64) its
  // in-region anchors materialize as depth-2 children (023 C0.1) and anchor-less roster
  // ids surface as `subtask-no-anchor` exclusions (C2.5).
  interface ChildPin {
    readonly id: string;
    readonly title: string;
    readonly extent: readonly [number, number];
  }
  interface WpPin {
    readonly name: string;
    readonly localTaskId: string;
    readonly title: string;
    readonly children: readonly ChildPin[];
    readonly misses: readonly (readonly [number, string])[]; // [roster line, token]
  }
  const wpFiles: readonly WpPin[] = [
    {
      name: "WP01-auth.md",
      localTaskId: "WP01",
      title: "Auth",
      children: [
        { id: "T001", title: "Implement validator CLI", extent: [20, 22] },
        { id: "T002", title: "Add pytest coverage", extent: [24, 26] },
      ],
      misses: [[8, "T099"]],
    },
    {
      name: "WP02-flow.md",
      localTaskId: "WP02",
      title: "Flow persistence",
      children: [
        { id: "T003", title: "Open the flow", extent: [14, 14] },
        { id: "T004", title: "Persist state", extent: [15, 15] },
      ],
      misses: [],
    },
    {
      name: "WP03-noanchors.md",
      localTaskId: "WP03",
      title: "Telemetry",
      children: [],
      misses: [
        [5, "T005"],
        [5, "T006"],
      ],
    },
  ];
  for (const pin of wpFiles) {
    const filePath = `kitty-specs/001-corpus/tasks/${pin.name}`;
    const content = readFixture(`parsing/frameworks/spec-kitty/tasks/${pin.name}`);
    const { file, exclusions } = parseTaskFile(filePath, content, specKittyFixtureAdapter, cfg);
    const task = file.tasks[0]!;
    assert.equal(file.tasks.length, pin.children.length + 1, `${pin.name} — parent + ${pin.children.length} children`);
    assert.equal(task.kind, "document", `${pin.name} — document kind`);
    assert.equal(task.localTaskId, pin.localTaskId);
    assert.equal(task.title, pin.title, `${pin.name} — front-matter title wins the cascade (C3.1)`);
    assert.equal(file.featureName, "001-corpus", "the mission names the document (R3)");
    for (const child of pin.children) {
      const sub = file.tasks.find((t) => t.localTaskId === child.id);
      assert.ok(sub, `${pin.name}: ${child.id} derived`);
      assert.equal(sub.parentUuid, task.stableUuid, `${child.id} parented to ${pin.localTaskId}`);
      assert.deepEqual([sub.taskBody.startLine, sub.taskBody.endLine], child.extent);
      assert.equal(sub.title, child.title);
    }
    assert.deepEqual(
      task.taskBody.promotedRanges ?? [],
      pin.children.map((c) => c.extent),
      `${pin.name} — promoted ranges are the child spans, source order`,
    );
    assert.deepEqual(
      exclusions,
      pin.misses.map(([line, token]) => ({ lineNumber: line, kind: "subtask", reason: "subtask-no-anchor", text: token })),
      `${pin.name} — anchor-less roster ids excluded (C2.5)`,
    );
    const body = content.split("\n").slice(task.taskBody.startLine - 1, task.taskBody.endLine).join("\n");
    assert.ok(body.startsWith("#"), "the slice starts at the leading heading (R11)");
    assert.ok(body.includes("## Objectives & Success Criteria"), "Objectives section mirrored verbatim (SC-002)");
    assert.match(body, /T\d{3}/u, "Tnnn subtask ids mirrored verbatim (SC-002)");
    assert.ok(!body.includes("work_package_id:"), "front matter excluded from content (C3.2)");
  }

  // Legacy lane-folder document: canonical under the amended gate, zero children.
  const legacy = parseTaskFile(
    "kitty-specs/001-corpus/tasks/planned/WP04-legacy.md",
    readFixture("parsing/frameworks/spec-kitty/tasks/planned/WP04-legacy.md"),
    specKittyFixtureAdapter,
    cfg,
  );
  assert.equal(legacy.file.tasks.length, 1, "the lane-folder variant stays a canonical document (C1.2')");
  assert.equal(legacy.file.tasks[0]?.localTaskId, "WP04");

  // Per-WP artifact sub-folder with a DUPLICATED front-matter id: zero tasks, claimed
  // inert (C1.2', FR-015) — the collection gate never even reads its front matter.
  const artifact = parseTaskFile(
    "kitty-specs/001-corpus/tasks/WP01-auth/review-cycle-1.md",
    readFixture("parsing/frameworks/spec-kitty/tasks/WP01-auth/review-cycle-1.md"),
    specKittyFixtureAdapter,
    cfg,
  );
  assert.deepEqual(artifact.file.tasks, [], "artifact sub-folders derive ZERO drafts whatever their front matter");
  assert.deepEqual(artifact.exclusions, []);

  // Determinism across repeats (Principle IV).
  const again = parseTaskFile("kitty-specs/001-corpus/tasks.md", readFrameworkFixture("spec-kitty"), specKittyFixtureAdapter, cfg);
  assert.deepEqual(again, rollUp);
});

test("parsing corpus — five-framework shared fixture unchanged by 017; spec-kitty claims none of its paths (SC-005)", () => {
  // The five-member shared-template corpus is unchanged by 017 (SC-005).
  assert.equal(CORPUS.length, 5);
  assert.ok(!CORPUS.some((member) => member.adapter.id === "spec-kitty"));

  // ...and the spec-kitty grammar claims no task-file pattern of its own on the shared
  // five-framework paths (the kit's task roll-ups live only under `kitty-specs/`).
  for (const member of CORPUS) {
    assert.equal(specKittyFixtureAdapter.featureName(member.virtualPath), undefined, `spec-kitty derives no feature for ${member.virtualPath}`);
  }
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
