# Feature Specification: Spec Kitty Task Source — Work-Package Documents

**Feature Branch**: `022-spec-kitty-wp-tasks`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "While running integration tests in a separate repo, the spec kitty adapter seems really broken. The tests based on this repo https://github.com/spec-kitty/spec-kitty/ create thousands of one-line tasks with no descriptions. In reality the tasks specified in this repo are highly detailed. For example, this file should count as one linear task https://github.com/spec-kitty/spec-kitty/blob/main/kitty-specs/002-lightweight-pypi-release/tasks/WP01-release-validation-tooling.md — In this repo the 'tasks' collection is a folder named 'tasks' within each feature folder, rather than being a file named 'tasks.md' within each feature folder. Please research the spec kitty docs to confirm this, then specify a refactor of the spec kitty adapter to accommodate the implications of this."

## Purpose and Scope

### Upstream reality (researched and confirmed 2026-11-21)

Spec Kitty's own documentation confirms the task model the user describes:

- **Mission system** (`docs/architecture/mission-system.md`): a mission lives at
  `kitty-specs/<NNN-slug>/` and contains `meta.json`, `spec.md`, `plan.md`, a `tasks.md`
  roll-up ("WP breakdown" — an index), **and a `tasks/` folder holding one markdown
  "work package prompt" file per work package** (`tasks/WP01.md`, `tasks/WP02.md`, …).
  Quote: "Each WP has its own markdown prompt file (`tasks/WP01.md`), its own status on the
  kanban board, and its own dependencies on other WPs."
- **Kanban workflow** (`docs/architecture/kanban-workflow.md`): a work package's lifecycle
  lane (`planned → claimed → in_progress → for_review → in_review → approved → done`, plus
  `blocked`/`canceled`) is a **front matter field, not a directory** ("Not Directories, Just
  a Field"): the WP file stays at `tasks/WPnn-<slug>.md` while `lane:`, the Activity Log, and
  later a Review Report section change underneath it.
- **A real work-package document** (e.g.
  `kitty-specs/002-lightweight-pypi-release/tasks/WP01-release-validation-tooling.md` in the
  upstream repo) is one richly detailed document: YAML front matter (`work_package_id`,
  `title`, `dependencies`, `subtasks`, `phase`, lane history), then Objectives & Success
  Criteria, Context & Constraints, per-subtask step-by-step guidance (`T001`, `T002`),
  Test Strategy, Risks & Mitigations, a Definition-of-Done checklist, Review Guidance, an
  Activity Log, and a Review Report. This document — the whole thing — is **one unit of
  work**, i.e. exactly one Linear issue.

### The defect

Feature 017 built the `spec-kitty` adapter on the roll-up as the task source: every checkbox
line in `kitty-specs/<mission>/tasks.md` becomes its own task, and the whole `tasks/` folder
is excluded from discovery for every identity (017 C2.4/C2.5). Integration tests against the
upstream spec-kitty repository show this is the wrong unit of work. The roll-up's checkbox
lines are index fragments of work already fully described elsewhere, so a repository with a
dozen missions yields **thousands of one-line tasks with empty descriptions**, while the
hundreds of lines of curated detail inside each work-package document are never synced at
all.

### What this feature changes

Re-base the `spec-kitty` adapter on Spec Kitty's real unit of tasking: **one work-package
document inside a mission's `tasks/` collection = exactly one task**, carrying the document's
detail as its content, and **the mission roll-up yields no tasks**. This is a correction of
the 017 parsing model (an amendment, not an extension of, the `spec-kitty` contract); the
detection identity, mission-based feature naming, and the engine guarantees 017 relies on
are retained.

**Owns**: which files in a Spec Kitty mission are the task source (the work-package
collection vs the roll-up), one-document-one-task task selection, work-package title and
content derivation, work-package identity stability across the kanban lifecycle, and the
disposition of roll-up-derived issues left behind by the previous behavior.

**Consumes unchanged**: adapter registry, detection ranking and three-layer configuration
layering (003); parse/render model and exclusion records (004); identity, gating, matching
and reconciliation (002/006/008); documentation-consistency suite (016).

**Out of scope**: mapping work-package lanes to tracker states (lane status remains mirrored
content only); machine-readable dependency edges between work packages (dependency front
matter stays document content, continuing the 017 stance); the mission roll-up gaining any
new role; scaffold/agent-hooks for Spec Kitty (still none); other framework identities.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One work package, one fully detailed task (Priority: P1)

A team runs Spec Kitty with the default layout. They sync the repository: every work-package
document under a mission's `tasks/` folder appears as exactly one task attributed to that
mission, and the task carries the document's curated detail — objectives, constraints,
subtask guidance, test strategy, and Definition-of-Done — so a person reading the task has
what an executing agent would need. The upstream example document
`WP01-release-validation-tooling.md` becomes a single task titled "Release Validation
Tooling" whose content includes the T001/T002 step-by-step guidance.

**Why this priority**: this is the reported breakage and the core correction — without it the
board shows fragments of an index instead of the actual work. Everything else refines it.

**Independent Test**: Sync the upstream reference repository (or a fixture reproducing its
layout) with zero configuration; assert per mission that the task count equals the number of
work-package documents and that each task's content contains the document's
"Objectives & Success Criteria" section and its subtask guidance, and that front matter is
not part of the title.

**Acceptance Scenarios**:

1. **Given** a mission with 5 work-package documents under `kitty-specs/002-…/tasks/` and a
   roll-up listing dozens of checkbox lines, **When** a sync plan is produced, **Then** the
   mission contributes exactly 5 tasks, each with non-empty detailed content.
2. **Given** `tasks/WP01-release-validation-tooling.md` with front matter
   `title: Release Validation Tooling`, **When** its task is presented, **Then** the title is
   "Release Validation Tooling" and its content includes the objectives, context &
   constraints, subtask steps, and Definition-of-Done sections.
3. **Given** the same mission, **When** tasks are presented, **Then** none of them is a bare
   roll-up checkbox line and none has an empty description.

---

### User Story 2 - The roll-up stops generating one-line tasks; the board converges (Priority: P2)

Operators who previously synced a Spec Kitty repository (under the roll-up-based behavior)
re-run the sync: the plan no longer proposes any task from the roll-up file; the board
converges on work-package tasks, and the roll-up-derived leftovers from the old behavior are
surfaced so they can be cleaned up rather than silently duplicated or abandoned.

**Why this priority**: it is the half of the fix that makes the reported symptom ("thousands
of one-line tasks") actually disappear, including for repositories already synced under the
old model.

**Independent Test**: Seed a tracker with issues matching the roll-up-line tasks of a
fixture mission; run the sync under the corrected model; assert the plan contains no
roll-up-line tasks, proposes each work-package task, and reports the seeded roll-up issues as
stale/unmatched for cleanup rather than matching them onto work-package tasks.

**Acceptance Scenarios**:

1. **Given** a mission whose `tasks.md` exists next to a populated `tasks/` folder, **When**
   a sync plan is produced, **Then** zero tasks originate from `tasks.md`.
2. **Given** previously-created issues whose recorded identity is the old roll-up-line
   identity, **When** the corrected sync runs, **Then** none of them is matched to a
   work-package task, and they are reported so an operator can remove them.
3. **Given** a mission that has a roll-up but no `tasks/` folder at all (e.g. a mission type
   that runs without work-package iteration), **When** a sync plan is produced, **Then** the
   mission contributes zero tasks and the run is not an error.

---

### User Story 3 - Work-package tasks survive the kanban lifecycle (Priority: P3)

Spec Kitty agents and reviewers keep editing a work-package document as it moves through its
lifecycle: the `lane` front matter field flips, Activity Log entries accumulate, a Review
Report section is appended, and occasionally the file is renamed (slug tidy-up or a legacy
layout move). None of that is a new unit of work: re-syncing updates the same task instead of
creating a second one, and the work-package keeps its attribution to its mission and its
distinctness from same-numbered work packages in other missions.

**Why this priority**: identity churn would re-introduce duplicates over time even after
US1/US2 are correct; it depends on the corrected task source existing first.

**Independent Test**: Sync a fixture, then in the repository flip `lane:`, append Activity
Log lines and a Review Report, rename the file within the mission's `tasks/` folder, and
re-sync; assert zero new tasks are created, the existing task is updated, and two missions
each containing `WP01` remain two distinct tasks.

**Acceptance Scenarios**:

1. **Given** a synced work-package task, **When** the document's `lane` front matter and
   Activity Log change and the sync re-runs, **Then** the same task is updated — no second
   task is created for the same work package.
2. **Given** a synced work-package task, **When** the document file is renamed within its
   mission's `tasks/` collection, **Then** the task identity is unchanged and its new
   content is mirrored.
3. **Given** missions `002-alpha` and `003-beta` each containing a `WP01` document, **When**
   a sync plan is produced, **Then** there are exactly two distinct WP01 tasks, each
   attributed to its own mission.

---

### Edge Cases

- **Mission without a `tasks/` collection** (e.g. the upstream `plan` mission type has no
  work-package iteration, and a mission may exist before `/spec-kitty.tasks` has run): the
  mission yields zero tasks; there is no fallback to parsing roll-up checkbox lines, because
  that is precisely the behavior being removed.
- **Non-work-package files inside `tasks/`** (review feedback artifacts, notes, attachments,
  or, in older/legacy layouts, lane sub-folders such as `tasks/planned/`): a file counts as a
  work-package document only if it identifies itself as one (work-package front matter, or a
  `WPnn` file-name identifier inside the `tasks/` collection); everything else inside the
  collection is skipped content, and lane sub-folders are accepted as a legacy variant of the
  same collection.
- **Work-package document with no front-matter title**: the title falls back to the document's
  leading heading, then to the file-name slug (e.g. `WP01-release-validation-tooling` →
  "release validation tooling"-style readable text); it never falls back to a raw front-matter
  dump.
- **Work-package document that is front matter only** (no prose body): still exactly one
  task; its content is empty-but-reported (a visible "no content" state in the plan), not
  silently dropped.
- **Duplicate work-package identifiers within one mission's collection** (two documents both
  claiming `WP01`): a hard integrity finding — the plan reports the collision and does not
  guess which document wins.
- **Roll-up checkbox ids colliding with work-package numbering** (`T001` subtask ids vs `WP01`
  ids): different identifier spaces; a work-package task must never adopt, match, or inherit
  a roll-up-line or subtask identity.
- **A repository containing both `specs/` (Spec Kit) and `kitty-specs/` trees**: match sets
  stay disjoint (017 C2.2 behavior preserved); nothing in this refactor lets one adapter
  claim the other's files.
- **Disabling the `spec-kitty` adapter**: files behave as if the identity did not exist
  (fall-through to `generic`), exactly as before feature 017 — the corrected collection
  handling is part of the identity and switches off with it.
- **Very large work-package documents** (long review reports and activity history): mirrored
  verbatim as content; size is not a reason to split or truncate the unit of work.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A Spec Kitty mission's work-package collection — the `tasks` folder beneath the
  mission directory (default `kitty-specs/<mission>/tasks/`, including legacy lane
  sub-folders) — MUST be the task source for the `spec-kitty` identity, and its
  work-package documents MUST be attributed to that identity (never left to fall through to
  another identity).
- **FR-002**: Each work-package document MUST yield exactly one task — the work package is
  the unit of sync — regardless of how many headings, subtasks, or checklist items appear
  inside the document.
- **FR-003**: A work-package task's title MUST be the document's human-readable title, taken
  in order from: front-matter title, leading document heading, file-name slug. Front-matter
  content MUST NOT appear in the title.
- **FR-004**: A work-package task's content MUST carry the document's substantive detail
  (objectives, constraints, subtask guidance, test strategy, Definition-of-Done and later
  sections) so the mirrored task reproduces the document minus its front matter; internal
  subtask identifiers and Definition-of-Done checkboxes MUST remain content, never become
  separate tasks.
- **FR-005**: The mission roll-up file (`tasks.md` / `TASKS.md`) MUST yield zero tasks in all
  cases (including missions with no work-package collection), while remaining claimed by the
  `spec-kitty` identity when it sits inside a mission (no fall-through to `generic`).
- **FR-006**: Work-package tasks MUST be attributed to their mission directory beneath the
  specs root as feature name, even though the document itself sits inside the mission's
  `tasks` folder (the mission, not the folder, is the feature).
- **FR-007**: Work-package task identity MUST be anchored to the mission plus the
  work-package identifier (front matter `work_package_id`, falling back to the file-name
  `WPnn` token), and MUST be stable across lane front-matter changes, Activity Log / Review
  Report additions, other body edits, and renames or lane-style moves within the mission's
  collection.
- **FR-008**: The work-package identifier space MUST be distinct from subtask/checklist
  identifier spaces; identical work-package identifiers in different missions MUST yield
  distinct tasks, and a duplicate work-package identifier within one mission MUST be reported
  as a collision without guessing.
- **FR-009**: For any mission, the number of tasks proposed by a sync plan MUST equal the
  number of work-package documents in that mission's collection (count parity), and zero
  proposed tasks may originate from roll-up checkbox lines.
- **FR-010**: Repeated syncs with no repository change MUST remain no-ops; lifecycle edits
  (lane, activity log, review report, file rename within the collection) MUST update the
  existing task and MUST NOT create a second task for the same work package.
- **FR-011**: Issues whose recorded identity comes from the superseded roll-up-line model MUST
  never be matched to work-package tasks, and MUST be surfaced through the sync run's normal
  stale/leftover reporting so operators can remove them.
- **FR-012**: All of the above defaults (collection location and document recognition,
  roll-up treatment, title order, identity anchor) MUST be overridable through the existing
  per-adapter configuration layering with zero new required configuration, and MUST work out
  of the box on the standard Spec Kitty layout.
- **FR-013**: The refactor MUST NOT change discovery, parsing, or plan output for any other
  built-in framework identity, and disabling `spec-kitty` MUST restore pre-017 fall-through
  behavior for `kitty-specs/` files (byte-identical to today's fixtures for the other six
  identities).
- **FR-014**: Documentation that describes the `spec-kitty` adapter (README adapter table and
  subsection, framework-adapters doc, requirements/CHANGELOG) MUST describe the
  work-package-document task source and the no-tasks roll-up, replacing the roll-up-as-task-
  source description (the 017 consistency suite's pins MUST be satisfied by the corrected
  text, not relaxed).

### Key Entities

- **Mission**: a Spec Kitty tracked item — the directory beneath the specs root (default
  `kitty-specs/<NNN-slug>/`) holding the mission's spec, plan, roll-up, and work-package
  collection; the unit of feature attribution.
- **Work-Package Document**: one markdown prompt file inside a mission's `tasks` collection
  describing a single parallelizable slice of work; identified by work-package id
  (`WPnn`); mutable lifecycle content (lane field, activity log, review report).
- **Mission Roll-Up (`tasks.md`)**: the mission-level index of work packages and their
  checkbox subtask lines; retained as claimed, content-bearing documentation that is no
  longer a task source.
- **Subtask** (`Tnnn`): a step inside a work-package document; content of the owning task,
  never its own task.
- **Sync Task (work-package-sourced)**: the single task derived from a work-package document;
  seeded identity = framework + mission + work-package id; title and content derived from the
  document per FR-003/FR-004.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a repository reproducing the upstream spec-kitty layout (multiple missions,
  each with a roll-up and a `tasks/` collection), the sync plan proposes exactly one task per
  work-package document and zero tasks per roll-up line — the plan's task count for a mission
  equals its work-package document count (e.g. the `002-lightweight-pypi-release` mission
  yields a handful of work-package tasks, not hundreds of roll-up fragments).
- **SC-002**: 100% of synced work-package tasks have a non-empty title and non-empty content
  containing the document's Objectives section and subtask guidance — zero "one-line task, no
  description" issues remain in the plan for `spec-kitty` files.
- **SC-003**: A second sync after only lifecycle edits (lane flip, activity-log append,
  review-report append, or in-collection rename) creates zero new tasks and issues zero
  identity changes — every affected task matches its existing issue.
- **SC-004**: Roll-up-era leftovers: in a tracker seeded with roll-up-line issues, the
  corrected sync reports every seeded issue as stale/leftover and matches zero of them onto
  work-package tasks.
- **SC-005**: Zero behavior drift for the other six built-in identities: existing discovery,
  parse, and plan fixtures for them are byte-identical before and after this change.

## Assumptions

- The researched upstream documentation is authoritative: current Spec Kitty keeps work-package
  files flat in the mission's `tasks/` folder with the lane tracked as a front-matter field
  ("Not Directories, Just a Field"); older missions that use `tasks/planned/`-style lane
  sub-folders are accepted as a legacy variant of the same collection (upstream's own
  `WP01` example file references such a path in its history).
- One document = one task (the user's explicit example); internal `Tnnn` subtasks are not
  separate tracker tasks even on deeper board settings — they are the task's content. This
  also matches the product's flat-board intelligent default.
- Work-package lifecycle status is mirrored as content only; mapping `lane` values to tracker
  states is a possible future feature, not this one.
- Whole-document fidelity: the mirrored content includes late-appended Activity Log and
  Review Report sections; trimming them is a future content-shaping concern, not part of the
  unit-of-work correction.
- Work-package dependency front matter stays document content; no machine-readable dependency
  edges (unchanged from the 017 stance).
- A mission whose `tasks/` collection is absent yields zero tasks — deliberately no fallback
  to roll-up parsing, since roll-up-line tasks are the defect being removed.
- This feature supersedes the 017 roll-up-parsing model (017 C2.4/C2.5/C3 for task
  selection); the corrected model will be recorded as contract amendments during planning,
  with 017's detection, naming, and layering contracts retained.
