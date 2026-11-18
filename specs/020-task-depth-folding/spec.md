# Feature Specification: Task-Depth Folding (sub-issue depth cap)

**Feature Branch**: `020-task-depth-folding`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Configurable depth cap for Linear task creation (`maxTaskIssueDepth`): tasks nested deeper than the configured depth are folded verbatim into the parent issue's mirrored Task_Body instead of becoming their own Linear sub-issues"

> **Maintainer Ruling 2026-11-18**: the intelligent default for
> `maxTaskIssueDepth` is **1** — a built-in default carried by
> `builtInDefaults`; an absent key resolves to it, so the default posture is
> a flat board (zero Linear sub-issues). The pre-feature, effectively
> unlimited behavior is reached by explicitly configuring **`64`** (range
> stays 1..64). Pre-feature byte fidelity (SC-001) is asserted at explicit
> `64`, never at absence. This ruling reverses research R1; every 020
> artifact is amended to match (see the *Design History* note in plan.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Flat board: no sub-issues at all (Priority: P1)

As a developer who uses one-level task lists with nested detail checklists, I
want Linear to receive exactly one issue per top-level task, with every nested
checklist item living inside the parent issue's description — not as its own
sub-issue — so the board mirrors how I actually work.

**Why this priority**: This is the motivating gap — today every nested task
becomes a Linear sub-issue (fixed behavior), and there is no supported way to
turn that off. Delivers standalone value: one config line changes the shape of
the whole board.

**Independent Test**: A fixture task file containing a top-level task with
nested checklist children, synced with `maxTaskIssueDepth: 1`, yields a plan
with no parented entries, a create step carrying no parent link, and a parent
issue description containing the nested lines verbatim.

**Acceptance Scenarios**:

1. **Given** a task file with top-level tasks each having nested checklist
   children, **When** the configuration sets `maxTaskIssueDepth: 1`, **Then**
   only depth-1 tasks (top-level checklists and all heading tasks) are synced,
   no planned issue carries a parent link, and every folded line appears
   verbatim inside the nearest surviving ancestor task's mirrored body.
2. **Given** the same repository, **When** the key is absent, **Then** it
   resolves to the built-in default 1 and the board is flat (no nested task
   becomes its own issue); **When** the configuration instead sets
   `maxTaskIssueDepth: 64` explicitly, **Then** behavior is byte-for-byte
   identical to today (nested tasks become parented issues).
3. **Given** a depth-2 checklist line, **When** it is folded, **Then** it is
   recorded as a recognized-but-excluded line with a distinct "folded" reason,
   and its file line is never rewritten with an issue reference token.

---

### User Story 2 - Two-level board with folded detail checklists (Priority: P2)

As a tech lead whose `tasks.md` groups work into epics (level 1) with
sub-tasks (level 2) and deeper implementation detail (level 3+), I want
issues created to a configurable depth so my board shows epics and sub-tasks
while implementation detail stays in the issue description.

**Why this priority**: Generalizes US1 to the depth-2 boards many teams
already want; exercises the depth counting rules that US1's special case
alone would not.

**Independent Test**: The same fixture at `maxTaskIssueDepth: 2` yields issues
for depths 1 and 2 (with parent links preserved at depth 2) and folds every
depth-3 line into its depth-2 parent's mirrored body.

**Acceptance Scenarios**:

1. **Given** a three-level nested task tree, **When** the cap is 2, **Then**
   depth-1 and depth-2 tasks are issues (depth-2 issues linked to their
   depth-1 parents) and depth-3+ tasks are folded with exclusion records.
2. **Given** a folded task whose own descendants are also folded, **When**
   the plan is built, **Then** the entire folded subtree rides in the nearest
   surviving ancestor's body, in source order, verbatim.

---

### User Story 3 - Safe toggling and honest reporting (Priority: P3)

As a maintainer adopting the cap on a repository that already has sub-issues,
I want toggling the cap to be safe and observable: previously created child
issues must never be silently deleted or archived, they must surface in the
plan's unmapped-issue reporting, and the identity consequences must be
documented.

**Why this priority**: Without it, the feature is usable only on fresh
repositories; with it, adoption on existing ones is safe-by-report.

**Independent Test**: A state world where a depth-2 task already has a
checkpoint/issue, re-planned at cap 1, produces a plan that touches neither
the child issue nor its file line, and lists the child issue under unmapped
issues with zero archive operations.

**Acceptance Scenarios**:

1. **Given** a previously synced child issue now excluded by a tightened cap,
   **When** `plan` runs, **Then** the issue appears in the unmapped-issue
   report section and no mutation targets it (never auto-archived).
2. **Given** the cap introduced after earlier syncs, **When** tasks without a
   local id are re-parsed, **Then** any resulting identity shift is limited to
   ordinal-seeded tasks and the documented guidance (set the cap before first
   sync; prefer local ids) applies; tasks carrying a visible issue reference
   token still re-match at high confidence.
3. **Given** an invalid cap value (0, negative, fractional, or above the
   documented maximum), **When** any lane parses a task file, **Then** the run
   refuses with a named diagnostic identifying the key and the offending
   value, and zero mutations or writes occur (CLI exit 3).

---

### Edge Cases

- A heading task can never be folded (headings are always depth 1); the cap
  can only ever fold checklist tasks nested under another task.
- A checklist task sitting directly beneath a *heading task* is depth 2 (the
  heading is its parent by the orphan rule) — folding it at cap 1 is intended
  behavior, matching "no sub-issues".
- Folded lines inside fenced blocks or unresolved conflict blocks keep their
  existing precedence: fence interior is body text anyway, and frozen conflict
  regions are never treated as tasks before the cap is considered.
- Adapters whose conventions already exclude checkboxes (e.g. the
  `spec-superpower` rollup pattern) produce no checklist tasks, so the cap has
  no observable effect there.
- Every enabled framework adapter honors the cap uniformly; it is a global
  parsing semantics, not a per-adapter override (per-adapter suppression
  remains the existing `rollupPattern` mechanism).
- Cap 1 on a file of only top-level checklists changes nothing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose an optional configuration key
  `maxTaskIssueDepth` (integer, range 1..64) with a **built-in default of 1**
  that caps the task-tree depth at which tasks become their own Linear
  issues; when the key is absent it MUST resolve to the built-in default 1
  (the flat board is the default posture), and the pre-feature, effectively
  unlimited behavior MUST be reachable by explicitly configuring `64`.
- **FR-002**: System MUST compute each task's depth as 1 + the depth of its
  nearest task ancestor (heading tasks are always depth 1; a checklist task's
  parent is the indent-stack parent or the enclosing heading task, per the
  existing frozen indent/orphan rules), and MUST fold (not create as tasks)
  every task whose depth exceeds the configured cap.
- **FR-003**: Folded lines MUST remain verbatim body content of the nearest
  surviving ancestor task's `Task_Body` (and therefore of its mirrored issue
  description), in source order, with no rewriting of the folded line itself
  and no issue reference token written to it.
- **FR-004**: System MUST record every folded task line in the parsing
  exclusions with a dedicated reason distinct from `summary-section` and
  `rollup`, and MUST NOT count folded lines as tasks in any downstream lane
  (matching, plan, report, gates, CI conditions).
- **FR-005**: System MUST refuse an out-of-range or malformed
  `maxTaskIssueDepth` at parse entry with a typed diagnostic naming the key
  and value; all lanes (CLI, engine, worker, MCP, CI action) share that
  refusal point; the CLI MUST exit with the configuration-failure code.
- **FR-006**: Toggling the cap MUST NOT cause deletion or archival of
  previously created issues; issues that stop corresponding to a task surface
  through the existing unmapped-issue reporting, unchanged.
- **FR-007**: System MUST preserve determinism: identical inputs and cap
  produce byte-identical parse results and plans; the absent key MUST
  resolve to the built-in default 1, and the effective cap `64` MUST
  produce byte-identical results to the pre-feature build for every
  existing fixture.
- **FR-008**: Documentation MUST be updated in the same change (constitution
  Documentation duty): the configuration reference (new key row with default
  1, plus a pointer note that the key is NOT in the absent-by-default list
  because it ships a built-in default), the configuration model doc, the
  parsing doc (fold semantics
  + new exclusion reason), the README (one pointer sentence), the changelog,
  and the contract-amendment record; all examples use placeholder identifiers.
- **FR-009**: Every acceptance criterion in this spec MUST be enforced by at
  least one automated test across the tiers (constitution Principle VI),
  including updated parsing-surface/type snapshots and at least one
  engine-integration scenario over the fake tracker port per story.

### Key Entities

- **Task Depth Cap (`maxTaskIssueDepth`)**: optional config value; 1..64;
  built-in default **1** (flat board; explicit `64` is the practically-
  unlimited escape hatch); governs how deep in the task tree tasks receive
  their own issues.
- **Task Depth**: derived per task from the parent chain; heading tasks are 1;
  checklist tasks are 1 + nearest task ancestor's depth.
- **Folded Task**: a task whose depth exceeds the cap; demoted to body content
  of its nearest surviving ancestor; recorded as an exclusion with reason
  `depth-folded`.
- **Exclusion Record (extended)**: existing recognized-but-excluded line
  record, whose reason union gains the new `depth-folded` value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With `maxTaskIssueDepth: 64` configured explicitly (never at
  absence — Maintainer Ruling 2026-11-18), every existing test suite and
  fixture produces identical output to the pre-feature build (zero
  behavioral drift).
- **SC-002**: With `maxTaskIssueDepth: 1`, a plan built over a nested-fixture
  repository contains zero parented plan entries, and 100% of folded lines are
  present verbatim in their nearest surviving ancestor's mirrored body.
- **SC-003**: With the cap tightened on a repository with pre-existing child
  issues, the plan executes zero archive or delete operations and lists each
  orphaned child issue exactly once in the unmapped-issue section.
- **SC-004**: Every invalid cap value produces a refusal naming
  `maxTaskIssueDepth` and the offending value, with zero mutations, across
  all lanes tested (unit + at least one CLI e2e).
- **SC-005**: Documentation duty met: the configuration reference lists the
  key with its default posture, and CI (lint, typecheck, build, full test
  tiers) is green on the feature PR.

## Assumptions

- The existing indent-stack parentage and orphan rules (004) are the single
  source of task depth; this feature adds no new parser grammar.
- `Task_Body` extents already include descendant subtree lines, so folding
  changes which lines are tasks, not which content the parent's body covers.
- Identity churn from toggling (ordinal-seeded tasks) is accepted for 0.x and
  documented rather than migrated; no migration tooling ships in this feature.
- Per-adapter depth overrides, automatic archival of orphaned child issues,
  and CLI flags for the cap are out of scope for this feature.
- The tracker port's parent-link behavior for surviving (non-folded) parented
  tasks is unchanged, including the parent-before-child creation order.
