# Feature Specification: Task Parsing and In-Place Line Rendering

**Feature Branch**: `004-task-parsing-line-rendering`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group B (Task parsing and in-place rendering, source R2, R3).

## Purpose and Scope

Extracts actionable tasks (headings and checklists) from a discovered task file with
faithful structure — line numbers, nesting, phases, section extents, local IDs, visible
issue references, conflict flags — and renders assigned task lines back into the file
byte-respectfully. This is a Wave-2 feature: a pure function over file content plus the
adapter conventions from 003, buildable in parallel with 005–007 against the 002
contracts.

**Owns**: parsing/extraction rules; exclusion recording; conflict-marker detection;
`Task_Body` extent derivation; in-place line rewriting and byte-preservation rules.

**Consumes from 002**: Task entity shape. **Consumes from 003** (interface only):
adapter-supplied grammars and patterns — the parser codes against the adapter contract,
so both features proceed in parallel using the built-in `generic` adapter as the
development fixture.

**Provides to**: 005 (feature-name/task attributes for titles), 008 (task sections for
mirroring; frozen conflict blocks), 009 (rendered diff expectations for plan reports).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Faithful task extraction (Priority: P1)

Given a discovered task file and its framework adapter's conventions, every heading
task and checklist task is extracted with 1-based line numbers, parent/child nesting,
phase labels, derived `Task_Body` extents, parsed local task IDs and visible issue
references, and a derived `Feature_Name` — while fenced code, summary sections, and
rollup checklists are excluded with recorded reasons, and duplicate identities are
warned about with every affected line.

**Why this priority**: Task extraction fidelity determines everything downstream; a
wrong extent or nesting silently corrupts mirroring and conflict detection.

**Independent Test**: Parse fixtures with nested checklists, fenced blocks containing
checkbox syntax, summary/rollup sections, flat documents, duplicate IDs, and conflict
marker blocks; assert the full per-task field set, exclusion records, warnings, and
extent boundaries — file content in, task objects out, no tracker.

**Acceptance Scenarios**:

1. **Given** a task file, **When** parsing runs, **Then** heading tasks (grammar
   matches) and checklist tasks are extracted with 1-based line numbers, fenced
   code-block interiors treated as non-task text.
2. **Given** mixed tab/space indentation, **When** nesting is established, **Then**
   tabs normalize to the configured width, parent/child nesting follows an indent
   stack, and orphans attach to the enclosing heading task.
3. **Given** a document with phase headings, summary sections, and rollup checklists,
   **When** parsing runs, **Then** the current phase tracks the most recent
   phase-pattern heading, summary/rollup items are excluded per configured patterns,
   and each exclusion is recorded with line number and reason.
4. **Given** a flat document (no grammar-matching headings, or matching configured flat
   markers), **When** parsing runs, **Then** top-level checkboxes are valid tasks.
5. **Given** tasks sharing a local task ID or an issue reference within one file,
   **When** parsing completes, **Then** a warning identifies the shared value and every
   1-based line number.
6. **Given** a task whose section contains conflict markers, **When** parsing runs,
   **Then** the task is flagged as carrying an unresolved conflict block for
   reconciliation to skip.

### User Story 2 - Byte-respectful line rendering (Priority: P2)

When an assigned task line is rewritten with its issue reference and title, the file's
bytes outside the touched lines are preserved exactly, order and newline style are
honored, and structural surprises abort rather than corrupt.

**Why this priority**: The write-back is the only place this feature mutates user
files; the constitution's determinism and freeze rules bite hardest here.

**Independent Test**: Rewrite fixtures bottom-to-top; diff against golden files
asserting byte identity of untouched lines, preserved trailing-newline style, preserved
indentation/heading level/local ID, untouched conflict blocks; corrupt one expected line
structure and assert a file-path + line-number error with the file left unmodified.

**Acceptance Scenarios**:

1. **Given** an assigned line, **When** rendering emits it, **Then** the configured
   issue-reference prefix precedes the cleaned desired title, with original indentation,
   heading level, and a present local task ID preserved unless configured otherwise,
   and checkbox state set from the assignment or retained.
2. **Given** multiple assigned lines in one file, **When** the file is rewritten,
   **Then** edits are applied bottom-to-top, unassigned lines are byte-identical, the
   original trailing-newline style is reproduced exactly, and unresolved conflict
   blocks are untouched byte-for-byte.
3. **Given** an assigned line no longer matching its expected heading/checklist
   structure, **When** rendering runs, **Then** rendering of that file halts, the file
   is left unmodified, and an error identifies file path and line number.

## Requirements *(mandatory)*

- **FR-001** (001 FR-007): System MUST extract heading tasks (lines whose text matches
  the configured task-heading grammar) and checklist tasks (checkbox lines), treating
  fenced code-block interiors as non-task text, and record 1-based line numbers.
- **FR-002** (001 FR-008): System MUST normalize checkbox indentation (tabs mapped to
  the configured tab width) and establish parent/child nesting via an indent stack,
  attaching orphans to the enclosing heading task.
- **FR-003** (001 FR-009): System MUST track the current phase as the most recent
  heading matching the configured phase pattern.
- **FR-004** (001 FR-010): System MUST exclude summary-section items and rollup
  checklist items from task extraction per configured patterns, recording each excluded
  item with its line number and an exclusion reason.
- **FR-005** (001 FR-011): System MUST treat top-level checkboxes in flat documents
  (those without grammar-matching headings, or matching configured flat markers) as
  valid tasks.
- **FR-006** (001 FR-012): System MUST parse a visible issue reference of the configured
  `[<KEY>-<N>]` form and a leading local task identifier when the configured grammar
  matches, recording both on the task.
- **FR-007** (001 FR-013): System MUST warn, identifying the shared value and all 1-based
  line numbers, when tasks within one file share a local task ID or share an issue
  reference.
- **FR-008** (001 FR-014): System MUST derive the file's `Feature_Name` using the active
  framework adapter, recording none when none can be derived.
- **FR-009** (001 FR-015): System MUST flag any task whose section contains conflict
  markers as carrying an unresolved conflict block, and downstream reconciliation MUST
  skip such tasks (feature 008).
- **FR-010** (001 FR-016): System MUST record each task's `Task_Body` extent as the task
  line plus all content beneath it up to the next task or next equal-or-shallower
  heading, including nested checklist children.
- **FR-011** (001 FR-017): When rewriting an assigned task line, System MUST emit the
  configured issue-reference prefix followed by the desired title, preserving original
  indentation, heading level, and a present local task ID unless configured otherwise;
  titles are cleaned of configured strip prefixes, redundant issue prefixes, and
  duplicate leading local-ID prefixes; checkbox state is set from the assignment or
  retained when none is provided.
- **FR-012** (001 FR-018): System MUST rewrite assigned lines bottom-to-top, reproduce
  the original trailing-newline style exactly, leave unassigned lines byte-identical,
  and leave unresolved conflict blocks byte-for-byte untouched.
- **FR-013** (001 FR-019): If an assigned line no longer matches its expected
  heading/checklist structure, System MUST halt rendering of that file, leave it
  unmodified, and return an error identifying the file path and line number.

### Edge Cases

- **Duplicate identities in one file** (001 edge case): two tasks share a local task ID
  or the same issue reference → a warning identifies the shared value and every line
  number.
- **Fenced pseudo-tasks**: checkbox syntax inside fenced code blocks is never a task.
- **Conflict block interior edits**: content inside an unresolved conflict-marker block
  is never parsed into tasks or rewritten; the block stays frozen (FR-009, FR-012).

## Key Entities

**Task** (behavior owner; shape defined in 002): extraction, extent derivation, and
rendering semantics owned here. **Task File** content model shared with 003.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (part of 001 SC-002): 100% of tasks in the five-framework fixture corpus
  are extracted with correct kind, nesting, line numbers, section extent, and derived
  feature name.
- **SC-002**: Across the golden-file rewrite corpus, 0 bytes differ outside explicitly
  assigned lines, and trailing-newline style is preserved in 100% of fixtures.
- **SC-003**: Rendering against a structurally-broken fixture halts with a
  file-and-line error and leaves the file byte-identical in 100% of cases.

## Assumptions

- The adapter contract (grammars, patterns, strip prefixes) from 003/002 is the only
  framework hook; adding a framework never changes parser code.
- Writing conflict-marker blocks (git-style) into a section is a 008 behavior; this
  spec only detects existing markers and refuses to touch them.
- Stable-UUID assignment follows constitution Principle II using the parsed attributes;
  the derivation itself is contract-governed in 002.
