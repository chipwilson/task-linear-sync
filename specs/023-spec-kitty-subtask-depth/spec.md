# Feature Specification: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Feature Branch**: `023-spec-kitty-subtask-depth`

**Created**: 2026-11-24

**Status**: Draft

**Target Release**: v0.7.0

**Input**: User description (condensed; full text in the triggering request):

> We need to work on the spec-kitty adapter again. This will be release v0.7.0.
> In Spec Kitty, tasks are organized as Work Packages (WPs) under `kitty-specs/<mission-slug>/`
> (e.g. `042-auth-system/` or `auth-system-01KQ2VNJ/`), alongside `meta.json`, `spec.md`,
> `plan.md`, `tasks.md`, `wps.yaml`, `status.events.jsonl`, `status.json`, and a flat `tasks/`
> directory of individual Work Package prompt files. `/spec-kitty.tasks` decomposes a plan into
> subtasks (T001, T002, …) and groups 3–10 related subtasks into Work Packages (WP01–WPnn).
> Work packages are depth level 1 and each corresponds to exactly one issue in Linear; the
> contents of each work package file are what we want in the body of the Linear issue. Subtasks
> are depth level 2: folded into the work package when the maximum depth is 1, or created as
> sub-tasks of the Linear issue associated with the work package when the maximum depth is
> greater than 1. `tasks.md` and other overview files should be ignored — no Linear issues from
> them. Work-package frontmatter (`work_package_id`, `title`, `lane`, `dependencies`,
> `subtasks`, `agent`, `assignee`, `shell_pid`, `review_status`, `reviewed_by`, `history`) drives
> the Kanban dashboard, dependency sequencing, and CLI orchestration. `wps.yaml` is the
> machine-readable manifest/dependency graph; `status.events.jsonl` / `status.json` are the
> event-sourced state log and materialized snapshot.

## Purpose and Scope

### Baseline: what shipped in v0.6.0 (feature 022)

The 0.6.0 `spec-kitty` adapter already models Spec Kitty's unit of work correctly at level 1:

- one work-package document under `kitty-specs/<mission>/tasks/` = exactly one task;
- the mirrored issue content is the document verbatim minus its leading front matter;
- the mission roll-up `tasks.md` yields zero tasks while staying claimed by the identity;
- work-package identity is mission + work-package id, durable across lifecycle edits.

That baseline also fixed one assumption this feature **amends**: 022 assumed internal `Tnnn`
subtasks are *never* separate tracker tasks, "even on deeper board settings" — they are always
just content. The v0.7.0 requirements below replace that stance.

### What this feature changes

Four deltas against the v0.6.0 implementation, per the feature description:

1. **Subtasks become depth level 2.** Work packages stay depth level 1 (exactly one Linear
   issue per work package). Subtasks (`Txxx`) are folded into the work package's issue body
   when the configured maximum task-issue depth is 1 (the built-in default, 020), and are
   created as sub-issues of the work package's Linear issue when the depth is greater than 1.
2. **Front-matter metadata reaches the board readably.** Raw front-matter YAML stays out of
   the issue body (0.6.0 behavior), but the lifecycle metadata it carries (lane, dependencies,
   subtask roster, agent/assignee, review state) must be presented in human-readable form in
   the mirrored content instead of being dropped.
3. **Mission-slug variants are first-class.** Mission directories named with a numeric prefix
   (`042-auth-system`), an identifier suffix (`auth-system-01KQ2VNJ`), or a bare slug all
   attribute correctly.
4. **Non-task mission artifacts stay inert.** `meta.json`, `spec.md`, `plan.md`, the `tasks.md`
   roll-up, `wps.yaml`, `status.events.jsonl`, and `status.json` yield zero tasks in all
   configurations and never fall through to the `generic` identity.

**Owns**: subtask extraction from work-package documents, subtask-to-sub-issue promotion under
the depth cap, two-level identity and count parity for `spec-kitty`, readable rendering of
work-package front-matter metadata in mirrored content, and the inertness guarantee for mission
artifacts beyond `tasks/`.

**Consumes unchanged**: the depth-cap folding mechanism and its configuration key
(`maxTaskIssueDepth`, 020); durable-identity matching (002/006, document-kind durable-only
pairing from 022); stale/leftover reporting (008); detection ranking and configuration
layering (003); the 022 work-package task source, title cascade, and roll-up inertness.

**Out of scope** (unchanged from the 017/022 stance unless noted): mapping `lane` values to
Linear workflow states; consuming `wps.yaml`, `status.events.jsonl`, or `status.json` as sync
inputs (dependency edges and lane state remain mirrored content only); auto-removal of
leftover issues; scaffold/agent-hooks for Spec Kitty; other framework identities.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subtasks become Linear sub-issues on a two-level board (Priority: P1)

A team configures a two-level board (maximum task-issue depth greater than 1). They sync a
Spec Kitty repository: each work-package document still produces exactly one issue, and each
subtask inside that document additionally appears as a sub-issue of that work-package issue.
The sub-issue titled from its subtask carries that subtask's detailed guidance (objectives,
step-by-step instructions, definition-of-done items scoped to the subtask). Reading the
work-package issue and its children gives the same picture as reading the WP file top-down.

**Why this priority**: this is the headline behavior change of v0.7.0 — the description
explicitly defines subtasks as "depth level 2" with promotion at depth > 1, amending the 022
assumption that subtasks are permanently content-only.

**Independent Test**: Sync a fixture mission (e.g. `WP02-oauth-providers` with subtasks
`T004`–`T007` declared in front matter `subtasks:` and anchored as sections/steps in the body)
with `maxTaskIssueDepth: 2`; assert one parent issue per WP file, one child per anchored
subtask, correct parent links, and child content matching each subtask's section.

**Acceptance Scenarios**:

1. **Given** a mission with 3 work-package documents whose subtask anchors number 4, 3, and 5,
   **When** a sync plan is produced at depth 2, **Then** there are exactly 3 work-package tasks
   and 12 sub-tasks, each child parented to its own work package's task.
2. **Given** the same sync at depth 2, **When** the plan is inspected, **Then** each
   sub-task's title derives from its subtask anchor (heading/checklist text for e.g. `T004`)
   and its content includes that subtask's step-by-step guidance, while the parent's content
   holds the rest of the document without duplicating promoted subtask sections.
3. **Given** missions `042-alpha` and `auth-system-01KQ2VNJ` each containing `WP01` with
   subtask `T001`, **When** a plan is produced at depth 2, **Then** there are four distinct
   issues (two parents, two children), each child parented to its own mission's `WP01`.

---

### User Story 2 - The flat-board default keeps subtasks folded, byte-stable (Priority: P1)

Operators who use the shipped intelligent default (maximum depth 1, flat board) see no shape
change: every work package is one issue, every subtask remains folded verbatim inside that
issue's content, `[P]` parallel-execution markers are plain content, and zero sub-issues are
ever created for `spec-kitty` files.

**Why this priority**: this is the compatibility contract — v0.7.0 must not silently turn
every existing user's board into a two-level board. Equal priority to US1 because the two
behaviors are two sides of one depth-cap rule.

**Independent Test**: Sync the same fixture at `maxTaskIssueDepth: 1` (and with the key
absent); assert zero planned sub-issues, task count equal to the WP document count, and every
subtask anchor's text present inside its parent's mirrored content.

**Acceptance Scenarios**:

1. **Given** the fixture mission from US1, **When** a plan is produced at depth 1 or with no
   configuration, **Then** no planned entry carries a parent link and subtask guidance lines
   appear verbatim inside their work package's mirrored content.
2. **Given** a synced two-level board, **When** the operator lowers the depth back to 1 and
   re-plans, **Then** sub-tasks stop being maintained, their content is folded back into the
   parents, and the previously created sub-issues are surfaced through the normal
   stale/leftover reporting — nothing is auto-deleted.
3. **Given** a folded subtask line at depth 1, **When** apply runs, **Then** the source file
   line is never rewritten with an issue-reference marker (020 folding contract).

---

### User Story 3 - Work-package metadata is readable on the board (Priority: P2)

A developer opens a synced work-package issue in Linear. Raw YAML front matter is nowhere in
the description, but the front matter's operational state is legible: the current Kanban lane,
prerequisite work packages, the bundled subtask roster, the acting agent/assignee, and the
review state (status and reviewer) appear as a readable metadata region ahead of the document
body, updated as the repository evolves.

**Why this priority**: the description lists the frontmatter schema as state that "drives the
Kanban dashboard" — a board reader should not lose it just because raw YAML must not be
mirrored. It refines, not enables, the level-1 sync, so it ranks below the depth behavior.

**Independent Test**: Sync a fixture whose WP front matter sets `lane: in_progress`,
`dependencies: ["WP01"]`, `subtasks: ["T004","T005"]`, `assignee`, and `review_status`; assert
the mirrored content contains those five values in human-readable form and contains no raw
front-matter block (`---`-delimited YAML).

**Acceptance Scenarios**:

1. **Given** a work-package document with the full front-matter schema, **When** its task is
   presented, **Then** lane, dependencies, subtask roster, agent/assignee, and review state
   each appear in readable text and no raw YAML block appears in the title or content.
2. **Given** a synced work package whose `lane` flips and `reviewed_by` populates, **When**
   the sync re-runs, **Then** the same task's content is updated to the new values — no second
   task is created.
3. **Given** a document with no front matter at all, **When** its task is presented, **Then**
   it syncs with body content only and no empty or placeholder metadata region.

---

### User Story 4 - Mission naming and artifact hygiene (Priority: P3)

A team's missions use either naming style (`042-auth-system`, `auth-system-01KQ2VNJ`, or a
bare slug) and contain the full artifact set. The sync attributes every work package to its
mission, treats `meta.json`, `spec.md`, `plan.md`, `tasks.md`, `wps.yaml`,
`status.events.jsonl`, and `status.json` as claimed-but-inert (zero tasks, no fall-through to
the generic identity), and treats `.kittify/` and `.worktrees/` as out-of-scope directories.

**Why this priority**: largely a re-affirmation and hardening of 022 guarantees under the
newly documented mission-layout details (ULID-style slugs, the state/manifest files); its
value is regression safety, so it ranks below the behavior changes.

**Independent Test**: Build a fixture with three missions (numeric-prefixed, identifier-
suffixed, bare-slug), each fully populated including `wps.yaml` and both status artifacts;
plan at depth 1 and depth 2; assert task counts equal WP-document counts at depth 1, artifact
files contribute zero tasks at any depth, and mission attribution names match directory names.

**Acceptance Scenarios**:

1. **Given** a mission whose directory is `auth-system-01KQ2VNJ`, **When** a plan is produced,
   **Then** its work-package tasks are attributed to feature `auth-system-01KQ2VNJ` exactly as
   a `042-auth-system` mission would be.
2. **Given** a mission with `wps.yaml`, `status.json`, and `status.events.jsonl` populated,
   **When** a plan is produced at any allowed depth, **Then** none of these files contributes
   a task and none is claimed by the `generic` identity.
3. **Given** a `tasks.md` roll-up whose checkbox ids (`T001`…) mirror real subtask ids,
   **When** a plan is produced at depth 2, **Then** the roll-up yields zero tasks and no
   sub-task ever adopts a roll-up-line identity.

---

### Edge Cases

- **Subtask id in front matter with no body anchor** (`subtasks:` lists `T007` but the body has
  no `T007` section or step): at depth 2 it is *not* promoted into an empty issue — it is
  recognized-but-excluded with a "no content" reason and remains folded in the parent; at
  depth 1 it is simply folded. No issue is ever created with no substantive content.
- **Duplicate subtask anchors inside one work package** (two `T004` sections): a hard
  integrity finding at depth 2 — the plan reports the collision rather than guessing which
  section wins or creating two identically-seeded children.
- **Duplicate work-package ids within one mission**: unchanged 022 behavior — collision
  reported, no guessing.
- **Subtask id outside the default `Tnnn` shape**: the anchor token is a per-adapter
  configurable convention (layering of 003); the built-in default recognizes `T` + digits.
- **Work-package document with no front matter or no `subtasks` key**: body-anchored subtasks
  still promote at depth 2; with no anchors at all the WP simply has zero children.
- **Sub-tasks are leaves**: Spec Kitty has no third level; content inside a subtask section
  (checklists, code blocks) stays as that sub-issue's content at every depth setting.
- **Work-package file renamed within the `tasks/` collection while at depth 2**: the parent
  task's identity is unchanged (022) and its children re-parent to it — no orphaned or
  duplicated sub-issues.
- **Legacy lane sub-folder layouts** (`tasks/planned/WPnn-*.md`): accepted as the same
  collection (022 assumption retained); subtask handling applies identically.
- **Depth configured above 2** (e.g. 64): behaves exactly like 2 for this framework — there is
  no deeper level to fold.
- **Missions without a `tasks/` folder, or WP files that are front matter only**: zero tasks /
  one empty-but-reported task respectively (022 behavior retained).
- **Repository mixing `specs/` (Spec Kit) and `kitty-specs/` trees**: match sets stay
  disjoint; the Spec Kit framework's own depth folding is untouched by this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A work-package document MUST remain exactly one task at depth level 1 in every
  configuration; a work-package task MUST never be parented to another synced task, regardless
  of the configured maximum task-issue depth.
- **FR-002**: Subtasks declared inside a work-package document MUST be modeled as depth level
  2: at `maxTaskIssueDepth` 1 (the built-in default) they MUST fold verbatim into the work
  package task's content with zero sub-issues; at `maxTaskIssueDepth` greater than 1 each
  promotable subtask MUST become exactly one sub-task of that work package's task, reusing the
  existing depth-cap folding mechanism (020) rather than a parallel one.
- **FR-003**: The subtask roster of a work package MUST be the union of the front-matter
  `subtasks` identifiers and the subtask anchors found in the document body (heading or
  checklist step led by the subtask identifier). A roster entry with no body anchor MUST NOT
  be promoted at depth greater than 1; it MUST be recorded as recognized-but-excluded with a
  distinct reason and remain folded in the parent.
- **FR-004**: A sub-task's title MUST derive from its body anchor's human-readable text
  (heading or checklist text), falling back to a readable form of the subtask identifier when
  the anchor carries no text; raw front matter MUST NOT appear in any title.
- **FR-005**: A sub-task's content MUST carry its anchored section's detail (objectives, step
  guidance, scoped definition-of-done); the parent work-package task's content MUST then mirror
  the rest of the document — promoted subtask sections MUST NOT be duplicated between parent
  content and child content at depth greater than 1.
- **FR-006**: A sub-task's identity MUST be anchored to mission + work-package identifier +
  subtask identifier; it MUST be distinct from the work-package identifier space and from any
  roll-up-line identifier, and MUST be stable across lane flips, history/Activity Log appends,
  Review Report additions, other body edits, and renames or lane-style moves of the owning
  document within its mission's collection.
- **FR-007**: The mirrored content of a work-package task MUST present the document's
  front-matter state in human-readable form — at minimum the current lane, dependency work
  packages, subtask roster, acting agent/assignee, and review state — and MUST NOT mirror raw
  front-matter YAML blocks in title or content. Documents without front matter MUST mirror body
  content only, with no placeholder metadata region.
- **FR-008**: The mission directory beneath the specs root MUST attribute tasks to the mission
  whatever its naming style: numeric-prefixed (`042-auth-system`), identifier-suffixed
  (`auth-system-01KQ2VNJ`), or bare slug.
- **FR-009**: The mission artifacts `meta.json`, `spec.md`, `plan.md`, the `tasks.md`/`TASKS.md`
  roll-up, `wps.yaml`, `status.events.jsonl`, and `status.json` MUST yield zero tasks at every
  depth setting, MUST remain claimed by the `spec-kitty` identity when inside a mission (no
  fall-through to `generic`), and MUST NOT be consumed as sync inputs: dependency edges, lane
  state, and manifest data remain mirrored content only, with no mapping to tracker states or
  tracker relations in this release.
- **FR-010**: Changing the depth configuration MUST converge the board: raising the cap from 1
  to 2 or more creates the sub-tasks; lowering it back folds subtask content into the parents,
  stops maintaining the sub-issues, and reports the previously created sub-issues through the
  normal stale/leftover reporting with no automatic deletion.
- **FR-011**: Count parity MUST hold and be verifiable per mission per run: work-package tasks
  = work-package documents; at depth greater than 1, sub-tasks per work package = promotable
  subtask anchors; at depth 1, parented entries = 0; a re-run with no repository change MUST be
  a no-op.
- **FR-012**: All new behavior (subtask recognition tokens, promotion defaults, metadata
  rendering) MUST ship with zero new required configuration, MUST work out of the box on the
  standard Spec Kitty layout, and MUST be overridable through the existing per-adapter
  configuration layering (003).
- **FR-013**: Disabling the `spec-kitty` adapter MUST keep restoring pre-017 fall-through
  behavior for `kitty-specs/` files, and this feature MUST NOT change discovery, parsing, depth
  folding, or plan output for any other built-in framework identity (byte-identical fixtures).
- **FR-014**: Documentation that describes the `spec-kitty` adapter (README adapter table and
  subsection, framework-adapters doc, configuration reference for the depth key's interaction
  with document sources, requirements ledger, CHANGELOG) MUST describe the two-level model —
  work packages at level 1, subtasks at level 2 with folding at depth 1 — replacing the
  "subtasks are always content" description; the documentation-consistency suite's pins MUST be
  satisfied by the corrected text, not relaxed.

### Key Entities

- **Mission**: a Spec Kitty tracked item — the directory beneath the specs root (naming styles:
  numeric-prefixed, identifier-suffixed, or bare slug) holding the mission's spec, plan,
  roll-up, manifest, status artifacts, and work-package collection; the unit of feature
  attribution.
- **Work-Package Document** (depth level 1): one markdown prompt file inside a mission's
  `tasks/` collection; front-matter identity (`work_package_id`, `title`, `lane`,
  `dependencies`, `subtasks`, `agent`, `assignee`, `shell_pid`, `review_status`, `reviewed_by`,
  `history`); the unit of level-1 sync; never parented to another task.
- **Subtask** (`Tnnn`, depth level 2): a granular step declared in the work package's
  `subtasks` front matter and anchored in its body; promotable to a sub-issue of the owning
  work package's task when the depth cap allows, otherwise folded content; `[P]` markers are
  plain content.
- **Sync Task (work-package-sourced)**: the level-1 task seeded from framework + mission +
  work-package id; content = readable metadata region + document body minus promoted sections.
- **Sync Task (subtask-sourced)**: the level-2 task seeded from framework + mission +
  work-package id + subtask id; parented to its work-package task; content = the subtask's
  anchored section.
- **Mission Manifest/State Artifacts** (`wps.yaml`, `status.events.jsonl`, `status.json`):
  claimed-inert documentation in this release — never task sources, never sync inputs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a reference fixture reproducing the upstream layout (multiple missions with
  mixed naming styles, full artifact sets), a depth-2 sync produces parent issues equal to the
  WP-document count and child issues equal to the promotable-anchor count per work package,
  with 100% of children parented to the correct work-package issue.
- **SC-002**: At the shipped default configuration, 0 sub-issues are ever created for
  `spec-kitty` files, task counts match the 0.6.0 baseline exactly, and every subtask's text
  is present inside its parent's mirrored content.
- **SC-003**: 100% of mirrored work-package contents expose lane, dependencies, subtask roster,
  agent/assignee, and review state in readable text, and 0 mirrored titles or contents contain
  a raw front-matter block.
- **SC-004**: A re-run after only lifecycle edits (lane flip, history append, review report,
  in-collection rename) produces 0 new issues and 0 identity changes at both depth settings,
  including the children of renamed work packages.
- **SC-005**: Raising then lowering the depth cap leaves the board converged: after lowering,
  every former sub-issue is reported through stale/leftover reporting and none is
  automatically deleted or silently kept.
- **SC-006**: Zero behavior drift for the other six built-in identities — existing discovery,
  parse, depth-folding, and plan fixtures are byte-identical before and after this change.

## Assumptions

- Lane-to-tracker-state mapping, dependency-edge creation, and consumption of `wps.yaml` /
  `status.events.jsonl` / `status.json` remain out of scope, continuing the 017/022 stance;
  the description documents these artifacts but requests no sync role for them, so this
  release guarantees only their inertness and the readability of the metadata the WP files
  themselves carry.
- This feature amends the 022 assumption that subtasks are never separate tracker tasks: at
  depth greater than 1 they are. Contract amendments will be recorded during planning; the 022
  level-1 contracts (task source, title cascade, durable-only pairing, roll-up inertness)
  carry forward unchanged.
- Subtask promotion requires a body anchor: a front-matter-only roster entry creates no empty
  issue (consistent with the 022 "empty-but-reported, never silent" and no-empty-content
  stance). The default anchor token is `T` + digits, configurable via adapter layering.
- Promoted subtask sections are removed from the parent's mirrored content at depth greater
  than 1 to avoid duplication, mirroring how 020 treats promoted nested tasks for checklist
  sources; folded at depth 1 they return verbatim.
- The readable metadata region is a one-time content change on upgrade: existing work-package
  issues keep their identities but receive updated descriptions on the next sync. No
  repository files are ever rewritten by this feature.
- Work-package documents, roll-ups, and mission artifacts are never written back: no
  confirmation prefix, no landed line, no status markers appended to Spec Kitty files.
- Missions keep the documented flat `tasks/` collection (legacy lane sub-folders accepted);
  `.kittify/` and `.worktrees/` contain no sync-relevant task sources.
- The depth cap remains a single global configuration key (020); no Spec-Kitty-specific depth
  setting is introduced.
