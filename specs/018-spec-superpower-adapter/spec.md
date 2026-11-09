# Feature Specification: Full Adapter Support — Spec Superpowers

**Feature Branch**: `018-spec-superpower-adapter`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "implement full adapter support for spec-superpower"

## Purpose and Scope

"Spec Superpowers" names the plan-document convention popularized by the Superpowers
skills framework and reused by its fusion packs: an implementation plan saved under a
dedicated plans directory with a date-prefixed filename (canonically
`docs/superpowers/plans/YYYY-MM-DD-<feature>.md`), a shared preamble (Goal, Architecture,
Tech Stack, Spec reference, Global Constraints, Review Focus), one heading per unit of
work (`### Task N: <Component Name>`), and, inside each task, test-driven step checkboxes
(`- [ ] **Step 1: Write the failing test**`) with exact files, interfaces, commands, and
code blocks between them.

Measured current behavior (investigation, 2026-11-09): such plans are invisible to
default discovery — the filename never matches — and when the files are forced into scope
through the generic fallback, every step checkbox becomes its own task, preamble sections
become tasks with first-word "ids" (`"Global"`), task headings collapse to id `"Task"`
with the number stranded in the title, and no feature name is derived. "Full adapter
support" means a seventh built-in identity that understands this document's own shape:
tasks are tasks, steps are content, and the filename names the feature.

**Owns**: the `spec-superpower` framework identity — plan-file discovery, date-stripped
feature naming, task-heading grammar, step containment, preamble exclusion, body
fidelity — plus the README / requirements / docs updates and framework-consistency pins
that must name the new identity.

**Consumes from 003/004/008**: the adapter registry and configuration layering; the parse
model (heading tasks, extents, exclusions, round-trip rendering); the engine's identity,
gating, and reconciliation guarantees — unchanged except for carrying one more identity.

**Out of scope**: the skill/runtime machinery of any specific community pack (this
feature targets the plan-document format itself, whatever pack writes it); agent-hook
scaffold for the framework; machine-readable dependency edges (the format carries
interfaces prose, which stays mirrored as body content); Superpowers artifacts other than
plans (brainstorm docs, reviews).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plan tasks become clean issues, nothing else does (Priority: P1)

A team keeps Superpowers-style implementation plans in the canonical plans directory.
With no configuration, each plan file is discovered; every `Task N:` heading becomes
exactly one task with that identifier as its local id and the component name as its title;
no step checkbox, preamble section, or document title ever becomes a task.

**Why this priority**: the unit of value — a plan's real tasks as real issues, without the
step-level and preamble noise that makes the generic fallback unusable for this format.

**Independent Test**: a reference plan fixture (preamble with all standard sections,
three tasks, seven steps total, code blocks) plans exactly three tasks with ids `Task 1`
– `Task 3`; counts prove zero noise.

**Acceptance Scenarios**:

1. **Given** `docs/superpowers/plans/2026-11-09-auth.md` containing `### Task 1: Scaffold
   module` and two more task headings, **When** discovery runs with default
   configuration, **Then** the file is claimed by `spec-superpower` and the plan yields
   exactly three tasks — not seven-plus.
2. **Given** the same file, **When** tasks are derived, **Then** local ids are `Task 1`,
   `Task 2`, `Task 3`, and titles are the component names without the "Task N:" span.
3. **Given** the preamble sections (Goal, Architecture, Tech Stack, Spec, Global
   Constraints, Review Focus), **When** the file parses, **Then** none becomes a task and
   none contributes its text to any single task's title.
4. **Given** a plan file placed anywhere else in the repository (not under a configured
   plans root), **When** discovery runs, **Then** it is not claimed, keeping unrelated
   Markdown out of the sync.

---

### User Story 2 - Steps are mirrored content, and progress travels (Priority: P2)

Each task's steps — checkboxes, exact file lists, interfaces, commands, expected output,
and code fences — are part of that task's body. The mirrored issue description shows them
verbatim, and when an executing agent checks steps off in the plan, the next sync refreshes
the issue body so progress is visible in the tracker without manual copy.

**Why this priority**: the plan's value is its precision; a mirrored issue that lost the
steps would be a stub. This story makes the sync genuinely useful during execution.

**Independent Test**: sync the fixture, edit one plan file to check a step, re-run, and
assert only that task's issue body changed, reproducing the plan text byte-for-byte aside
from the visible reference prefix.

**Acceptance Scenarios**:

1. **Given** a synced plan task, **When** its issue description is inspected, **Then** it
   contains the task's steps, files, and code blocks exactly as written in the plan.
2. **Given** a checked step (`- [x] **Step 2: ...**`) after execution, **When** the sync
   re-runs, **Then** that task's issue body reflects the change and 0 other issues receive
   any write.
3. **Given** a synced plan, **When** the file is re-parsed after write-back, **Then**
   rendering reproduces the plan byte-for-byte apart from the visible reference prefix
   (steps unharmed, no progressive prefixing).
4. **Given** a task body whose content would be blocked by the security screening,
   **When** propagation is attempted, **Then** that content is screened before transmission
   exactly as on every other framework.

---

### User Story 3 - Filename-named features at plan-registry scale (Priority: P3)

Teams accumulate one plan per feature. Each plan file is its own feature named by its
filename with the date prefix stripped, routes independently through path rules, and stays
identity-stable across in-place edits; two plans that share a feature name across dates
never collide identities.

**Why this priority**: multi-plan repositories are the norm for this format, but the
capability refines P1/P2 rather than enabling it.

**Independent Test**: a fixture with three dated plans (one name repeated on two dates)
plans with three feature names (date stripped), the repeated name resolving to distinct,
deterministic identities per file; editing a plan's task text changes no identities.

**Acceptance Scenarios**:

1. **Given** `2026-11-09-auth.md`, **When** tasks are derived, **Then** the feature name
   is `auth` — no date, no extension.
2. **Given** two plans `2026-11-01-sync.md` and `2026-11-09-sync.md`, **When** the plan
   builds, **Then** every task keeps a distinct stable identity and no task from one file
   can match an issue created for the other.
3. **Given** a synced plan, **When** a task's description text is edited in place,
   **When** the sync re-runs, **Then** the identity and match are unchanged and only the
   body re-mirrors.
4. **Given** path rules for the plans directory, **When** the plan builds, **Then** each
   plan file's tasks route per the rules like any other framework.

---

### Edge Cases

- **Plan without task headings** (only a preamble): zero tasks, no error, an informational
  diagnostic at most.
- **Heading-level variance**: task headings at levels two through four all capture; a
  repository using level-four task headings still works.
- **Steps before any task heading** (stray pre-task checklist): contained by the nearest
  preceding task or excluded — never silently a task of its own; the choice is recorded in
  the parse exclusions.
- **Two plans, same filename date and name** (rename races in the plans directory):
  identities remain deterministic and distinct; duplicate local ids within one file are
  reported as a parse warning rather than silently accepted.
- **Renamed or re-dated plan file**: treated as a new feature per the filename rule; the
  spec documents this consequence rather than tracking renames.
- **Empty task section** (heading with no steps): still a valid task with an empty body.
- **Non-canonical locations**: teams that keep plans elsewhere override the plans-root and
  filename-pattern configuration keys; no source change required.
- **Disabled built-in**: disabling the identity returns these files to today's behavior
  (undiscovered by default patterns) — opt-out is exact.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The System MUST provide a built-in `spec-superpower` framework identity,
  enabled by default, selectable in automatic detection, and accepted by the full sync
  surface (discover → parse → match → create → mirror → reconcile → write-back → rollback)
  with the same safety gates as every current built-in.
- **FR-002**: The System MUST discover plan documents under the configured plans root
  (default `docs/superpowers/plans/`) whose filenames follow the date-prefixed convention,
  MUST NOT claim Markdown outside the configured plans root by this rule, and MUST keep
  both the root and the filename convention configuration-overridable.
- **FR-003**: The System MUST derive the feature name from the plan filename with the date
  prefix and extension removed.
- **FR-004**: The System MUST treat each task heading (the "Task N:" convention, robust to
  heading levels two through four) as one task, capturing its identifier as the local id
  and its component name as the title, with the identifier span excluded from the title.
- **FR-005**: The System MUST NOT create tasks from step checkboxes belonging to a task;
  steps belong to their task's body extent and are excluded from the task list.
- **FR-006**: The System MUST NOT create tasks from the shared preamble sections (document
  title, Goal, Architecture, Tech Stack, Spec reference, Global Constraints, Review Focus)
  and MUST keep preamble text out of individual task bodies by default.
- **FR-007**: The System MUST mirror task bodies — including step checkboxes, file lists,
  interface blocks, commands, and fenced code — verbatim into the issue description,
  subject to the same security screening as all other content.
- **FR-008**: Editing step checkboxes or task prose in a synced plan MUST be detected as
  content drift and re-mirrored on the next run to the affected tasks only, preserving
  repository-file round-trip fidelity.
- **FR-009**: Workflow completion for this format's tasks MUST be managed on the tracker
  side, consistent with how heading-shaped tasks behave on every current framework; step
  checkboxes are mirrored content, not completion inputs, and the README MUST state this
  difference plainly.
- **FR-010**: Tasks from different plan files sharing a feature name MUST keep distinct,
  deterministic stable identities; duplicate task identifiers within one plan file MUST be
  reported as a parse warning and MUST NOT silently collide.
- **FR-011**: Every new default (plans root, filename pattern, task/step grammars,
  preamble exclusion list) MUST be overridable through the existing configuration layering
  and MUST contain no organization-specific literals.
- **FR-012**: This feature MUST introduce no agent-hook scaffold template for
  `spec-superpower`; requesting one keeps refusing with zero writes.
- **FR-013**: Documentation MUST be updated in the same change: README behavior subsection
  and overview-table/precedence entries; `specs/requirements.md` Requirement 7 and
  `Supported_Framework` glossary extended to the new identity; framework-adapters doc and
  CHANGELOG updated; the framework-consistency contract suite (016) extended —
  written test-first — so registry, frozen identity union, requirements, and README agree.

### Key Entities

- **Implementation plan**: one dated plan document; a feature in the tool's sense —
  named by its filename, routed as a unit.
- **Plan task**: a `Task N:` heading with a component name; the sync unit — one task, one
  issue.
- **Step**: a checkboxed execution instruction inside a task; mirrored content, never a
  task, never a completion input.
- **Preamble**: the plan's shared context sections (constraints, architecture, review
  focus); excluded from tasks and from individual bodies.
- **Plans registry**: the directory of dated plans that collectively map a repository's
  planned features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a reference fixture (canonical plans directory, three dated plans with
  full preamble, tasks, steps, and code fences) zero configuration discovers 100% of plan
  files and 0 unrelated Markdown files.
- **SC-002**: Planned tasks equal exactly the task headings on every plan (count and id
  match 100%); 0 tasks originate from steps, preamble sections, or the document title.
- **SC-003**: 100% of derived feature names equal the date-stripped plan filename.
- **SC-004**: After checking one step in a synced plan, one re-run updates exactly that
  task's issue body (1 issue written, 0 unrelated writes) and reproduces the plan text
  verbatim.
- **SC-005**: The full test suite passes with no behavior change for the other built-in
  identities, and every suite that parameterizes frameworks covers this one.

## Assumptions

- "Spec-superpower" denotes the Superpowers-style plan-document format (canonical plans
  directory, dated filenames, task headings, step checkboxes), not any single community
  pack; packs that emit the same document shape are supported automatically.
- Completion for heading-shaped tasks is tracker-managed everywhere in the tool today;
  deriving completion from "all steps checked" would be a new cross-framework rule and is
  deliberately not introduced here — it can be a separate feature if demand shows.
- Shared preamble is not prepended to every mirrored body: it would duplicate the same
  text across all of a plan's issues; teams wanting it on an issue can paste it once.
- Date-prefixed filenames are the upstream convention; teams using another naming scheme
  keep the plans-root rule and override the filename pattern.
- Sequencing: this feature and 017 both extend the framework-consistency suite and README
  section; landing 019 (doc-truthfulness audit) first is preferable, and whichever of 017
  and 018 lands second rebases on the first.
