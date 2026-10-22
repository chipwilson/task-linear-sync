# Phase 1 Data Model: Task Parsing and In-Place Line Rendering

**Feature**: `004-task-parsing-line-rendering` | **Date**: 2026-10-22

This document defines **004-local records only**. The entities it references are owned and
frozen by
[`specs/002-core-domain-contracts/data-model.md`](../002-core-domain-contracts/data-model.md)
and are consumed verbatim — **nothing here redefines or amends a frozen shape** (ROADMAP
rule 2):

| Frozen entity | 002 source | Role here |
|---|---|---|
| `Task`, `TaskKind`, `TaskBodyExtent`, `IssueRef`, `FrameworkId` | [002 data-model § 1](../002-core-domain-contracts/data-model.md#1-task), [`contracts/task-model.md`](../002-core-domain-contracts/contracts/task-model.md) | Produced by `parseTaskFile` with 004-owned derivation *behavior* (FR-001…010); field list untouched |
| `TaskFile` | [002 data-model § 2](../002-core-domain-contracts/data-model.md#2-taskfile) | Returned inside `ParseResult`; `tasks` ascending `lineNumber` |
| Framework Adapter interface (§ 3) | [002 data-model § 3](../002-core-domain-contracts/data-model.md#3-framework-adapter-interface) | Consumed through the structural subset `TaskFileAdapter` — see [contracts/adapter-consumption.md](./contracts/adapter-consumption.md); `detect`, `taskFilePatterns`, `titleBehavior`, `agentHooksDirectory` are **not** part of the 004 view |
| `taskStableSeed` (R11 layout) | [002 research R11](../002-core-domain-contracts/research.md#r11-stable_uuid-derivation-shape-contract-004-computes-002-freezes) | Input to `deriveStableUuid` (004 computes the UUID, plan R3) |
| `ResolvedConfig` grammar group | [002 data-model § 17](../002-core-domain-contracts/data-model.md#17-configuration-the-merged-model) | Source of `headingIdGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern`, `flatChecklistMarkers`, `tabWidth`, `confirmationKey`, `titleStripPrefixes` (plan R2 — no new keys) |

Relationship overview (004-local additions in **bold**):

```
TaskFileAdapter ──injected──▶ parseTaskFile(filePath, content, adapter, cfg) ──▶ ParseResult
                                                                                  ├── file: TaskFile 1 ── * Task   (frozen shapes)
                                                                                  ├── exclusions: * ExclusionRecord
                                                                                  ├── conflictBlocks: * ConflictBlock
                                                                                  └── warnings: * ParseWarning
LineAssignment * ──▶ renderTaskLines(filePath, content, assignments, opts?) ──▶ RenderResult
   (derived from a parsed Task)                                                   ├── content: string (rewritten)
                                                                                  ├── changes: * LineChange     (009 material)
                                                                                  └── ⟂ LineRenderError (abort, no output)
```

## 1. ParseResult (004-local)

Complete output of one parse of one task file.

| Field | Type | Rules |
|---|---|---|
| `file` | `TaskFile` (frozen) | `tasks` in file order, ascending `lineNumber`; every task populated per FR-001…010 (kind, 1-based line, nesting, `phase`, raw `title`, `checked` iff checklist, `issueRef?`, `localTaskId?`, `featureName?` via adapter, `stableUuid`, `taskBody`, `unresolvedConflict`) |
| `exclusions` | `ExclusionRecord[]` | Sorted ascending by `lineNumber`; excluded items appear **only** here (FR-004) |
| `conflictBlocks` | `ConflictBlock[]` | Ascending `startLine`; passed to the renderer as the freeze set (FR-009, FR-012; research R7) |
| `warnings` | `ParseWarning[]` | Duplicate-identity warnings (FR-007); deterministic order: by kind, then by shared value |
| `featureName` | `string \| undefined` | Adapter-derived file-level `Feature_Name` (FR-008); mirrored onto `TaskFile.featureName` and each task |

Validation: `conflictBlocks` spans never overlap; no task start line lies inside a block
(block-interior lines are never parsed as tasks — spec edge case); every
`ExclusionRecord.lineNumber` refers to a non-fenced line.

## 2. ExclusionRecord (004-local; FR-004)

| Field | Type | Rules |
|---|---|---|
| `lineNumber` | `integer ≥ 1` | 1-based line of the excluded item |
| `kind` | `"checklist" \| "heading"` | What the excluded line would have been |
| `reason` | `"summary-section" \| "rollup"` | The only two configured-exclusion reasons; fenced pseudo-tasks are silently non-tasks (research R4), **not** exclusions |
| `text` | `string` | Raw line text (diagnostics/report material) |

## 3. ParseWarning (004-local; FR-007)

| Field | Type | Rules |
|---|---|---|
| `kind` | `"duplicate-local-id" \| "duplicate-issue-ref"` | Shared-identity classes |
| `value` | `string` | The shared value itself (the local ID, or `KEY-N` rendering of the shared issue ref) |
| `lineNumbers` | `integer[]` | **Every** 1-based line sharing the value, ascending (spec: "identifying the shared value and all 1-based line numbers") |

## 4. ConflictBlock (004-local; FR-009, FR-012)

| Field | Type | Rules |
|---|---|---|
| `startLine` | `integer ≥ 1` | Line of an opening `^<{7,}` marker (fence-aware scan) |
| `endLine` | `integer ≥ 1` | Line of the closing `^>{7,}` marker; EOF when the block is unterminated (defensive freeze, research R7) |

State semantics: a block is a **freeze region** — never parsed into tasks (lines strictly
inside block interiors are excluded from extraction), never rewritten
(`unresolvedConflict = true` for intersecting tasks; renderer aborts on any assignment
into the region). Writing blocks is a 008 behavior (spec Assumption).

## 5. TaskFileAdapter (004-local **consumer view**; FR-008; not a redefinition)

Structural subset of the frozen 002 § 3 adapter interface — the members 004 reads
(research R1). 003's adapters satisfy it structurally; 004 imports nothing from 003.

| Member | Contract (004's consumption) |
|---|---|
| `id` | `FrameworkId` — recorded on `TaskFile.frameworkId` and every `Task.frameworkId` |
| `featureName(taskFilePath)` | `string \| undefined` — file-level `Feature_Name`; "recording none when none can be derived" (FR-008) |
| `headingGrammar?` | Optional regex source overriding `config.headingIdGrammar` (research R2); must expose named groups `id?` and `title` like the frozen default |
| `phasePattern?` / `summaryPattern?` / `rollupPattern?` | Optional regex sources overriding the config defaults |

`detect`, `taskFilePatterns`, `titleBehavior`, `agentHooksDirectory` remain in 002's § 3
(003/005/010 territory) and MUST NOT be referenced from `src/parsing/`.

## 6. LineAssignment (004-local; FR-011…013 input)

One assigned line to rewrite. Built by 008 from parsed tasks + matches; 004 defines the
shape it consumes.

| Field | Type | Rules |
|---|---|---|
| `task` | `Task` (frozen) | The parsed task this assignment rewrites; supplies expected structure, `localTaskId`, current state |
| `desiredTitle` | `string` | Title to emit **after** `cleanTitle` (redundant refs/local-ID dupes stripped; research R9) |
| `issueRef` | `IssueRef \| undefined` (frozen shape) | Reference to emit as `[<confirmationKey>-<N>]`; absent ⇒ no prefix emitted and any existing visible ref stays inside the cleaned-away title span only as governed by cleaning |
| `checked` | `boolean \| undefined` | Assignment-supplied checkbox state; `undefined` ⇒ retain the line's original state byte (FR-011) |

## 7. RenderResult / LineChange / LineRenderError (004-local; FR-011…013)

| Record | Fields | Rules |
|---|---|---|
| `RenderResult` | `content: string`, `changes: LineChange[]` | `content` differs from the input **only** on assigned lines; `changes` ascending by `lineNumber` |
| `LineChange` | `lineNumber: integer ≥ 1`, `before: string`, `after: string` (with original terminator bytes) | The rendered-diff expectation material 009 consumes as `expectedMarkdownChanges` |
| `LineRenderError` | `filePath: string`, `lineNumber: integer ≥ 1`, `reason: "structure-mismatch" \| "inside-conflict-block" \| "inside-fence" \| "line-out-of-range"` | Raised **before** any output is emitted (validate-all-then-apply): the caller's file is left unmodified trivially (pure function, plan R8); identifies file path and line number (FR-013) |

`RenderOptions { preserveLocalTaskId?: boolean = true }` — the "unless configured
otherwise" switch of FR-011, an API option on the render call (research R2).

## 8. Internal content model (004-local, not exported)

`ContentLine { number, text, terminator, originalIndent, indentWidth, inFence }` — the
terminator-preserving line array shared by parsing and rendering so both agree on line
numbering and bytes (research R4). `indentWidth` drives nesting/extents;
`originalIndent`/`terminator` drive byte-exact rendering.

## State transitions summary

- **Parse**: `(filePath, content, adapter, cfg) → ParseResult` — pure, total (malformed
  Markdown still parses; only *structural surprises at render time* are errors).
- **Render**: `(filePath, content, assignments) → RenderResult` **or**
  `LineRenderError` — never partial: any invalid assignment aborts the whole file with
  zero emitted content (FR-013, SC-003).
- **Round-trip**: parse(render(content)) reproduces titles exactly — no progressive
  prefixing (Principle IV; property test).
