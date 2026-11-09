# Feature Specification: Full Adapter Support — Spec Kitty

**Feature Branch**: `017-spec-kitty-adapter`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "implement full adapter support for spec-kitty"

## Purpose and Scope

Spec Kitty is a widely used governance-focused fork of GitHub Spec Kit. Its mission
artifacts live under a dedicated specs root (default `kitty-specs/<NNN-slug>/`), and its
task file is a *work-package roll-up*: checkbox subtasks numbered `Txxx`, optional `[P]`
parallel-capability tags, `## Work Package WPxx: <title>` grouping sections, prose
subsections (Goal, Independent Test, Implementation Notes, Parallel Opportunities,
Dependencies, Risks & Mitigations), YAML front matter, and per-work-package agent prompt
files under the mission's `tasks/` subdirectory.

Today a Spec Kitty repository falls through to the `generic` adapter. The current-behavior
investigation (2026-11-09) measured what that costs: the mission name is not derived;
`Txxx` ids are not captured from checkbox lines (identity degrades to line position);
work-package and prose headings become spurious tasks whose "ids" are the first word of
the heading (`"Work"`, `"Included"`, colliding across the file); `[P]` tags pollute mirrored
issue titles; and prompt files are not understood at all. "Full adapter support" means a
sixth built-in framework identity that a Spec Kitty user never has to configure and that
treats the format's own concepts as first-class.

**Owns**: the `spec-kitty` framework identity — detection, layout defaults, feature naming,
task selection, work-package grouping, tag handling, exclusion rules — plus the README /
requirements / docs updates and the framework-consistency pins that must name the new
identity.

**Consumes from 003/004/008**: the adapter registry, selection ranking, and configuration
layering; the parse model (heading/checklist tasks, extents, exclusions, round-trip
rendering); the engine's identity, gating, and reconciliation guarantees — all unchanged
except for carrying one more built-in identity.

**Consumes from 016**: the framework-consistency contract suite that pins README ⇄
requirements ⇄ registry agreement; this feature extends those pins rather than relaxing
them.

**Out of scope**: dependency edges (no framework syncs machine-readable dependency
relations today; Spec Kitty dependency prose stays inside mirrored task bodies); agent-hook
scaffold for Spec Kitty; the `spec-superpower` format (feature 018); hosted Spec Kitty
services, which the upstream project removed from open-core.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-configuration Spec Kitty mission sync (Priority: P1)

A team runs Spec Kitty with its default layout. Without editing any configuration, they
run a sync: each mission's work-package roll-up is discovered as `spec-kitty`, every
checkbox subtask becomes exactly one task whose local id is the printed `Txxx` identifier,
and the mission directory is the feature name used for routing and title derivation.

**Why this priority**: this is the whole promise — a Spec Kitty repository working out of
the box like GitHub Spec Kit does today. Everything else refines it.

**Independent Test**: a reference Spec Kitty fixture (two or more missions in the canonical
layout) is discovered and planned with default configuration; ids, titles, and feature
names are asserted against the fixture's printed values.

**Acceptance Scenarios**:

1. **Given** a repository with `kitty-specs/001-demo/tasks.md` containing `- [ ] T001
   Create the scaffold` and `- [ ] T002 Implement charging`, **When** discovery runs with
   default configuration, **Then** the file is claimed by `spec-kitty` and yields exactly
   two tasks with local ids `T001` and `T002` and titles without the id span.
2. **Given** the same repository, **When** the plan is built, **Then** every task carries
   feature name `001-demo` and no configuration keys were required.
3. **Given** a subtask line `- [ ] T003 [P] Add payouts`, **When** its issue is created,
   **Then** the issue title contains neither `T003` nor the `[P]` tag.
4. **Given** the mission is fully synced, **When** a second identical run plans again,
   **Then** zero create/update actions result (idempotent, as for every built-in).

---

### User Story 2 - Work-package structure fidelity (Priority: P2)

Work packages are how Spec Kitty organizes delivery, but they are not tasks. The sync
records the work-package title as the grouping (phase) of its member subtasks, never
creates tasks from work-package headings, template-prose sections, or YAML front matter,
and keeps the repository file byte-identical across parse → render → parse apart from the
visible issue-reference prefix.

**Why this priority**: without it, each mission pollutes the Linear workspace with five or
more spurious issues per work package ("Included", "Dependencies", "Risks &
Mitigations"), which undermines the value of story 1.

**Independent Test**: the reference fixture plans exactly one task per checkbox subtask —
asserted by count — and every front-matter line, template section heading, and prose
subsection appears nowhere in the task list.

**Acceptance Scenarios**:

1. **Given** a mission file with two `## Work Package WPnn:` sections, **When** the file
   parses, **Then** zero tasks have kind heading for those sections, and each subtask
   beneath a work package records that package's title as its grouping.
2. **Given** the standard template sections (Inputs, Prerequisites, Organization, Subtask
   Format, Path Conventions, Implementation Notes, Parallel Opportunities, Dependencies,
   Risks & Mitigations), **When** the file parses, **Then** none produces a task.
3. **Given** a mission file with YAML front matter, **When** the file parses, **Then** no
   front-matter line becomes a task or appears in any task title.
4. **Given** a synced mission, **When** the file is re-parsed after the write-back,
   **Then** titles round-trip identically and re-rendering reproduces the file byte-for
   byte apart from the visible reference prefix (no progressive prefixing, no tag loss).

---

### User Story 3 - Multi-mission routing and durable identity (Priority: P3)

Repositories hold many missions. Each mission names its own feature, routes independently
through path-based team/project rules, and — because subtask ids are now captured —
existing tasks keep their durable identity when subtasks are inserted or reordered, in
line with the constitution's durable-identity principle.

**Why this priority**: valuable at real repository scale, but a refinement of P1/P2; the
tool is already useful for one mission without it.

**Independent Test**: a two-mission fixture routed to two different configured projects
plans with the correct split; inserting a subtask mid-list and swapping two work packages
changes no other task's stable identity or match.

**Acceptance Scenarios**:

1. **Given** two missions and a path rule mapping `kitty-specs/002-*` to a second project,
   **When** the plan builds, **Then** each mission's tasks route per the rule.
2. **Given** a synced mission, **When** a new subtask is inserted between `T002` and
   `T003`, **When** the sync re-plans, **Then** only the new task is a create and every
   previously synced task keeps its identity and match.
3. **Given** the same mission, **When** two work-package sections are reordered, **Then**
   the run reports grouping changes only — zero identity changes.

---

### Edge Cases

- **Mission without a task file**: a mission directory with `spec.md`/`plan.md` but no
  task file contributes nothing and produces no diagnostic worse than an informational
  one — never an error.
- **Prompt files**: the mission's `tasks/WP01-*.md` agent-prompt files restate the roll-up
  and carry YAML execution history; they are never discovered as task files, so content is
  never double-synced.
- **Both frameworks in one repository**: a legacy Spec Kit `specs/` tree beside
  `kitty-specs/` resolves disjointly — existing Spec Kit detection is unchanged, and
  selection stays deterministic where both could theoretically match.
- **Non-canonical layouts**: teams that renamed the specs root or task filenames keep a
  working path by overriding the feature's configuration keys; no source change is needed.
- **Subtask id variants**: ids printed without the canonical `T` prefix, or with a trailing
  separator, still capture their identifier span.
- **A work package with no subtasks**: contributes grouping context only; zero tasks.
- **Disabled built-ins**: an operator who disables `spec-kitty` in configuration returns
  Spec Kitty files to the generic fallback exactly as before this feature — opt-out
  preserves today's behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The System MUST provide a built-in `spec-kitty` framework identity that is
  enabled by default, selectable in automatic framework detection, and accepted by the full
  sync surface (discover → parse → match → create → mirror → reconcile → write-back →
  rollback) with the same safety gates as every current built-in — it is a syncable
  identity, not a discovery-only convention.
- **FR-002**: The System MUST detect `spec-kitty` from the repository layout — paths
  beneath the configured Spec Kitty specs root (default `kitty-specs/`) — without requiring
  sibling markers, and MUST resolve competing matches with the same deterministic
  precedence and ranking used today.
- **FR-003**: The System MUST derive the feature name for a Spec Kitty task file from its
  mission directory (the directory immediately beneath the specs root).
- **FR-004**: The System MUST treat the mission's roll-up task file (default names
  `tasks.md` / `TASKS.md`) as the sole task source for the mission and MUST NOT discover
  per-work-package agent-prompt files beneath the mission's task subdirectory as task
  files.
- **FR-005**: For each checkbox subtask line the System MUST capture the printed task
  identifier (for example `T001`) as the task's local id regardless of whether a separator
  follows it, and MUST exclude the id span from the derived title.
- **FR-006**: The System MUST recognize the parallel-capability tag (`[P]`) and any
  user-story tags of the same shape, keep them out of the derived and mirrored issue
  title, preserve them inside the mirrored task body, and preserve the repository file
  byte-for-byte across parse → render → parse.
- **FR-007**: The System MUST NOT create tasks from work-package section headings,
  standard template or prose subsections (Inputs, Prerequisites, Organization, Subtask
  Format, Path Conventions, Goal, Independent Test, Implementation Notes, Parallel
  Opportunities, Dependencies, Risks & Mitigations), or YAML front matter; instead each
  subtask records its enclosing work-package title as its grouping (phase) value.
- **FR-008**: Dependency information expressed in the mission file (dependency sections or
  work-package front matter) MUST be preserved as content inside task bodies that mirror
  it and MUST NOT be reported as machine-readable dependency edges; edge semantics remain
  out of scope for every framework.
- **FR-009**: Every new default introduced by this feature (specs root, task-file names,
  detection markers, exclusion lists, grammar) MUST be overridable through the existing
  configuration layering (built-in defaults → config file → programmatic overrides) and
  MUST contain no organization-specific literals.
- **FR-010**: Because subtask local ids are captured, the System MUST derive durable task
  identity from the local id wherever present, so inserting, removing, or reordering other
  tasks does not change an existing task's identity.
- **FR-011**: The System MUST keep existing behavior unchanged when `spec-kitty` is
  disabled in configuration (files fall back exactly as they do today).
- **FR-012**: This feature MUST introduce no agent-hook scaffold template for
  `spec-kitty`; requesting one keeps refusing with zero writes, as for the other
  template-less built-ins.
- **FR-013**: Documentation MUST be updated in the same change: README gains a Spec Kitty
  behavior subsection and its overview table/precedence row; `specs/requirements.md`
  Requirement 7 and the `Supported_Framework` glossary gain the sixth identity; the
  framework-adapters doc and CHANGELOG are updated; the framework-consistency contract
  suite (016) is extended so registry, frozen identity union, requirements glossary, and
  README all enumerate the new identity — written test-first.

### Key Entities

- **Mission**: a Spec Kitty delivery unit — the directory beneath the specs root; becomes
  the Feature_Name for everything inside it.
- **Work Package**: a titled grouping section inside the mission roll-up (`WPxx`); not a
  task itself, but the grouping (phase) its subtasks belong to.
- **Subtask**: a checkbox line with a printed `Txxx` identifier and optional capability
  tags; the sync unit — one task, one issue.
- **Agent-prompt file**: per-work-package prompt document under the mission task
  subdirectory; deliberately never synced.
- **Mission roll-up task file**: the single per-mission Markdown file that carries the
  work packages and subtasks; the only discovered task source.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a reference Spec Kitty fixture (canonical layout, at least two missions,
  work packages with and without `[P]` tags), zero configuration is needed: 100% of mission
  roll-ups are discovered as `spec-kitty` and 0 non-mission Markdown files are claimed.
- **SC-002**: The planned task set equals exactly the checkbox-subtask set — 100% id
  capture (every task's local id equals its printed `Txxx`), and 0 tasks produced from
  work-package headings, template/prose sections, front matter, or prompt files.
- **SC-003**: 0 mirrored issue titles contain a `[P]` tag or a raw task-id prefix, while
  100% of mirrored bodies preserve the tag and dependency prose for checked-in content.
- **SC-004**: Reorder/insertion probe: after inserting one subtask and swapping two work
  packages, a re-run performs exactly one create and 0 identity or match changes for all
  other tasks.
- **SC-005**: End-to-end parity: every operation that currently accepts the five built-in
  identities accepts `spec-kitty` in the same parameterized suites (plan, apply, rollback,
  check, CI gate), and the full test suite passes with no behavior change for the existing
  five.

## Assumptions

- The canonical Spec Kitty layout is `kitty-specs/<NNN-slug>/` with the roll-up at
  `tasks.md` and prompt files under `tasks/`; the tool-runtime directory (`.kittify/`) is
  configuration and templates only and holds no synced task files.
- Excluding prompt files is correct because the roll-up is authoritative — syncing both
  would create duplicate issues for the same work.
- `[P]` and user-story tags are capability metadata, not title content; other frameworks'
  handling of similar tags is unchanged by this feature.
- Spec Kit detection (feature 003) keeps its current conjunctive rule; this feature
  changes no existing adapter's detection, only adds one.
- Where to insert `spec-kitty` in selection precedence is a planning decision; because
  detection sets are disjoint from the other built-ins, the choice does not affect
  outcomes on canonical layouts.
- Sequencing: landing feature 019 (doc-truthfulness audit) first is preferable so this
  feature's README additions are written against already-corrected prose; both touch the
  same consistency suite, so whichever lands second rebases.
