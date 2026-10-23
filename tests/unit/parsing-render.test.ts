/**
 * T025 [US2] — render unit tests (contracts/line-rendering.md; FR-011…FR-013).
 * Emitted line shape: `` `[${config.confirmationKey}-${issueRef.number}] ` +
 * cleanTitle(desiredTitle) `` after the byte-preserved structural prefix; "preserved
 * **structural prefix** (exact original bytes from line start through the heading hashes
 * `#{1,6}`, the present local task ID span — unless `preserveLocalTaskId === false` — and
 * the checkbox marker plus following whitespace)"; checkbox "set `[ ]`/`[x]`/`[X]` from
 * `assignment.checked` when provided; when `undefined` the original state byte is retained
 * byte-for-byte"; abort matrix (FR-013, SC-003). US2 tests hand-build Task fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderTaskLines, cleanTitle, LineRenderError } from "task-linear-sync/parsing";
import type { LineAssignment } from "task-linear-sync/parsing";
import type { Task, TaskKind } from "task-linear-sync/domain";

import { makeTestConfig, readFixture } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "specs/auth/tasks.md";

function taskFixture(over: Partial<Task> & { lineNumber: number; kind: TaskKind }): Task {
  return {
    stableUuid: `00000000-0000-5000-8000-${String(over.lineNumber).padStart(12, "0")}`,
    filePath: PATH,
    frameworkId: "generic",
    title: "Original title",
    childUuids: [],
    taskBody: { startLine: over.lineNumber, endLine: over.lineNumber },
    unresolvedConflict: false,
    ...over,
  };
}

function assignment(over: Partial<Task> & { lineNumber: number; kind: TaskKind }, extra: Partial<Omit<LineAssignment, "task">> = {}): LineAssignment {
  return { task: taskFixture(over), desiredTitle: "Assigned title", ...extra };
}

// ── Emitted line shape (FR-011) ─────────────────────────────────────────────────────

test("render line shape — prefix bytes preserved; '[SYNC-N] ' + cleaned title emitted", () => {
  const content = "  ## 1.1: Draft notes\n";
  const result = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "heading", localTaskId: "1.1", title: "Draft notes" }, {
      desiredTitle: "[SYNC-99] Draft notes", // stale redundant reference is cleaned first
      issueRef: { key: "SYNC", number: 300 },
    }),
  ], cfg);
  assert.equal(result.content, "  ## 1.1: [SYNC-300] Draft notes\n"); // indent + level + local ID + space preserved byte-for-byte
  assert.deepEqual(result.changes, [
    {
      lineNumber: 1,
      before: "  ## 1.1: Draft notes\n",
      after: "  ## 1.1: [SYNC-300] Draft notes\n",
    },
  ]); // before/after carry original terminator bytes (009 material, ascending)
});

test("render line shape — tab indentation preserved; checkbox set from assignment", () => {
  const content = "\t- [ ] Wire metrics\n";
  const result = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "checklist", checked: false, title: "Wire metrics" }, {
      desiredTitle: "Wire metrics",
      issueRef: { key: "SYNC", number: 301 },
      checked: true,
    }),
  ], cfg);
  assert.equal(result.content, "\t- [x] [SYNC-301] Wire metrics\n");
});

test("render line shape — checkbox state retained byte-for-byte when assignment supplies none ([X] stays [X])", () => {
  const content = "- [X] Shipped earlier\n";
  const result = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "checklist", checked: true, title: "Shipped earlier" }, {
      desiredTitle: "Shipped earlier",
      issueRef: { key: "SYNC", number: 302 },
    }),
  ], cfg);
  assert.equal(result.content, "- [X] [SYNC-302] Shipped earlier\n"); // capital X byte retained

  const lowered = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "checklist", checked: true, title: "Shipped earlier" }, {
      desiredTitle: "Shipped earlier",
      checked: false,
    }),
  ], cfg);
  assert.equal(lowered.content, "- [ ] Shipped earlier\n"); // explicit false SETS the space state
});

test("render line shape — present local ID kept by default, dropped with preserveLocalTaskId: false", () => {
  const content = "## 1.2: Ship release\n";
  const kept = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "heading", localTaskId: "1.2", title: "Ship release" }, {
      desiredTitle: "Ship release",
      issueRef: { key: "SYNC", number: 310 },
    }),
  ], cfg);
  assert.equal(kept.content, "## 1.2: [SYNC-310] Ship release\n");

  const dropped = renderTaskLines(
    PATH,
    content,
    [
      assignment({ lineNumber: 1, kind: "heading", localTaskId: "1.2", title: "Ship release" }, {
        desiredTitle: "Ship release",
        issueRef: { key: "SYNC", number: 310 },
      }),
    ],
    cfg,
    { preserveLocalTaskId: false },
  );
  assert.equal(dropped.content, "## [SYNC-310] Ship release\n"); // local ID span replaced away, indent/level still preserved
});

test("render line shape — assignment without issueRef emits ONLY the cleaned title (no prefix invented)", () => {
  const content = "- [ ] Plain restatement\n";
  const result = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "checklist", checked: false, title: "Plain restatement" }, {
      desiredTitle: "Plain restatement",
    }),
  ], cfg);
  assert.equal(result.content, "- [ ] Plain restatement\n");
});

test("render line shape — checklist leading local ID is a preserved prefix span too", () => {
  const content = "- [ ] Task 2.1: Create login endpoint\n";
  const result = renderTaskLines(PATH, content, [
    assignment({ lineNumber: 1, kind: "checklist", checked: false, localTaskId: "Task 2.1", title: "Create login endpoint" }, {
      desiredTitle: "Task 2.1: Create login endpoint v2", // duplicate leading local-ID prefix is stripped
      issueRef: { key: "SYNC", number: 320 },
    }),
  ], cfg);
  assert.equal(result.content, "- [ ] Task 2.1: [SYNC-320] Create login endpoint v2\n");
});

// ── cleanTitle (FR-011 cleaning scope; exported for 005 reuse) ───────────────────────

test("render cleaning — strip prefixes, redundant refs (bracketed and bare), duplicate local-ID prefixes; fixpoint", () => {
  const opts = { confirmationKey: "SYNC", localTaskId: "Task 1.2", titleStripPrefixes: ["Draft: ", "WIP: "] };
  assert.equal(cleanTitle("Draft: WIP: Ship the thing", opts), "Ship the thing"); // configured strip prefixes
  assert.equal(cleanTitle("[SYNC-12] Ship the thing", opts), "Ship the thing"); // redundant bracketed reference
  assert.equal(cleanTitle("SYNC-12 Ship the thing", opts), "Ship the thing"); // bare reference form
  assert.equal(cleanTitle("Ship the thing [SYNC-12]", opts), "Ship the thing"); // trailing bracketed reference
  assert.equal(cleanTitle("Task 1.2: Ship the thing", opts), "Ship the thing"); // duplicate leading local-ID prefix
  assert.equal(cleanTitle("T001 — Ship the thing", { ...opts, localTaskId: "T001" }), "Ship the thing"); // em-dash form
  // Compound stale prefixes from past drift iterate to a fixpoint (research R9):
  assert.equal(cleanTitle("[SYNC-1] [SYNC-2] Draft: Task 1.2: Task 1.2: Final title", opts), "Final title");
  // Fixpoint-stable (idempotent):
  const once = cleanTitle("[SYNC-1] Draft: Task 1.2: Final title", opts);
  assert.equal(cleanTitle(once, opts), once);
  // Other-key references and unrelated local IDs are NEVER stripped:
  assert.equal(cleanTitle("[ACME-5] [SYNC-1] Task 9.9: keep", { confirmationKey: "SYNC", titleStripPrefixes: [] }), "[ACME-5] Task 9.9: keep");
});

// ── Structural surprise abort matrix (FR-013, SC-003) ───────────────────────────────

function expectError(
  content: string,
  assignments: readonly LineAssignment[],
  expected: { filePath: string; lineNumber: number; reason: LineRenderError["reason"] },
  options?: Parameters<typeof renderTaskLines>[4],
): void {
  const before = content;
  assert.throws(
    () => renderTaskLines(expected.filePath, content, assignments, cfg, options),
    (err: unknown) => {
      assert.ok(err instanceof LineRenderError, `expected LineRenderError, got ${String(err)}`);
      assert.equal(err.filePath, expected.filePath);
      assert.equal(err.lineNumber, expected.lineNumber);
      assert.equal(err.reason, expected.reason);
      return true;
    },
  );
  assert.equal(content, before, "input string is untouched (pure function — nothing emitted, no writer to roll back)");
}

test("render abort — corrupted heading structure ⇒ LineRenderError structure-mismatch (SC-003)", () => {
  const content = readFixture("parsing/broken-render.md"); // line 3 is '## 1.1: Prepare notes'
  const corrupted = content.replace("## 1.1: Prepare notes", "Prepare notes"); // heading marker removed
  expectError(corrupted, [assignment({ lineNumber: 3, kind: "heading", localTaskId: "1.1" }, { desiredTitle: "x", issueRef: { key: "SYNC", number: 1 } })], {
    filePath: PATH,
    lineNumber: 3,
    reason: "structure-mismatch",
  });
});

test("render abort — heading level mangled beyond grammar (`#######` 7 hashes) ⇒ structure-mismatch", () => {
  const content = "####### 1.1: Beyond heading level\n";
  expectError(content, [assignment({ lineNumber: 1, kind: "heading", localTaskId: "1.1" }, { desiredTitle: "x", issueRef: { key: "SYNC", number: 1 } })], {
    filePath: PATH,
    lineNumber: 1,
    reason: "structure-mismatch",
  });
});

test("render abort — removed checkbox marker ⇒ structure-mismatch", () => {
  const content = "# T\n\n- Draft only (marker stripped)\n";
  expectError(content, [assignment({ lineNumber: 3, kind: "checklist", checked: false }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 3,
    reason: "structure-mismatch",
  });
});

test("render abort — kind disagreement (heading task on a checkbox line and vice versa) ⇒ structure-mismatch", () => {
  expectError("- [ ] I am a checklist\n", [assignment({ lineNumber: 1, kind: "heading" }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 1,
    reason: "structure-mismatch",
  });
  expectError("## I am a heading\n", [assignment({ lineNumber: 1, kind: "checklist", checked: false }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 1,
    reason: "structure-mismatch",
  });
});

test("render abort — assignment inside a fenced region ⇒ inside-fence", () => {
  const content = "# T\n\n```\n- [ ] fenced pseudo\n```\n";
  expectError(content, [assignment({ lineNumber: 4, kind: "checklist", checked: false }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 4,
    reason: "inside-fence",
  });
});

test("render abort — assignment inside a ConflictBlock ⇒ inside-conflict-block (conflict.md line 12)", () => {
  const content = readFixture("parsing/conflict.md"); // block 11..15
  expectError(content, [assignment({ lineNumber: 12, kind: "checklist", checked: false }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 12,
    reason: "inside-conflict-block",
  });
});

test("render abort — lineNumber past EOF ⇒ line-out-of-range", () => {
  const content = "## 1.1: Only line\n";
  expectError(content, [assignment({ lineNumber: 999, kind: "heading", localTaskId: "1.1" }, { desiredTitle: "x" })], {
    filePath: PATH,
    lineNumber: 999,
    reason: "line-out-of-range",
  });
});

test("render abort — validate-ALL first: a bad assignment aborts every good one (no partial rewrite)", () => {
  const content = "## 1.1: Good\n\n- [ ] Also good\n\nbroken line 5 target\n";
  const before = content;
  const assignments = [
    assignment({ lineNumber: 1, kind: "heading", localTaskId: "1.1" }, { desiredTitle: "ok", issueRef: { key: "SYNC", number: 1 } }),
    assignment({ lineNumber: 3, kind: "checklist", checked: false }, { desiredTitle: "ok" }),
    assignment({ lineNumber: 5, kind: "heading", localTaskId: "1.3" }, { desiredTitle: "aborts" }), // line 5 is NOT a heading
  ];
  assert.throws(() => renderTaskLines(PATH, content, assignments, cfg), LineRenderError);
  assert.equal(content, before);
});
