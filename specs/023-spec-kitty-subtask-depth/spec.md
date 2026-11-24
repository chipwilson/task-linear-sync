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
2. **Status authority: the event log, expressed as board state.** Each work package's
   current lane comes solely from its last lane event in the mission's append-only
   `status.events.jsonl`; that lane moves the issue to the mapped Linear workflow state.
   Front-matter `lane` and `status.json` are never state sources; raw front-matter YAML
   stays out of the issue body and status is never copied into the description.
3. **Mission-slug variants are first-class.** Mission directories named with a numeric prefix
   (`042-auth-system`), an identifier suffix (`auth-system-01KQ2VNJ`), or a bare slug all
   attribute correctly.
4. **Non-task mission artifacts stay inert.** `meta.json`, `spec.md`, `plan.md`, the `tasks.md`
   roll-up, `wps.yaml`, `status.events.jsonl`, and `status.json` yield zero tasks in all
   configurations and never fall through to the `generic` identity.
5. **Per-work-package artifacts are never documents.** Files inside per-work-package
   sub-folders (review cycles, reviewer feedback) cannot claim a work-package identity, even
   when stamped with the canonical document's front matter (see FR-015).

**Owns**: subtask extraction from work-package documents, subtask-to-sub-issue promotion under
the depth cap, two-level identity and count parity for `spec-kitty`, current-status
derivation from the mission's append-only event log, and the inertness guarantee for mission
artifacts beyond the event log's status role.

**Consumes unchanged**: the depth-cap folding mechanism and its configuration key
(`maxTaskIssueDepth`, 020); durable-identity matching (002/006, document-kind durable-only
pairing from 022); stale/leftover reporting (008); detection ranking and configuration
layering (003); the teams' workflow-state routing configuration for tracker state names;
the 022 work-package task source, title cascade, and roll-up inertness.

**Out of scope** (unchanged from the 017/022 stance unless noted): consuming `wps.yaml`,
`status.json`, or `meta.json` as sync inputs; mapping dependency front matter to tracker
relations (dependencies remain mirrored content only); copying status text into issue
descriptions; auto-removal of leftover issues; scaffold/agent-hooks for Spec Kitty; other
framework identities. Status capture is IN scope this release: the mission event log drives
each issue's workflow state (delta 2, FR-007).

## Clarifications

### Session 2026-11-24

- Q: How should nested review artifacts that carry a work-package id be treated? → A: Only direct children of the mission's `tasks/` folder can be canonical work-package documents; files inside per-work-package sub-folders (review cycles, reviewer feedback, attachments) are claimed-inert content whatever their front matter, so they can never duplicate a canonical id or inflate the board.
- Q: What board granularity should the reference-scale repository produce? → A: Keep one issue per work package — a large mission tree legitimately yields thousands of level-1 issues; the depth configuration folds nesting only and is never an issue-volume control. Per-line/per-heading splitting remains the only forbidden granularity.
- Q: How should each work package's status appear on its Linear issue? → A: State transitions only — the sync moves the issue to the workflow state mapped from the work package's current lane; the description remains the document body with no synthesized status block.
- Q: Which file is the authoritative source of a work package's current status? → A: `status.events.jsonl` is the SOLE authoritative source — the last lane event per work package wins; `status.json` and the front-matter `lane` field are never state sources.

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

### User Story 3 - Current status lands on the right board column (Priority: P2)

A coordinator glances at Linear and trusts the columns: each work-package issue sits in the
workflow state mapped from that work package's current Kanban lane, and the lane comes from
the mission's append-only status event log — Spec Kitty's canonical record of every lane
transition. As agents move a work package through `planned → claimed → in_progress →
for_review → in_review → approved → done` (or to `blocked`/`canceled`), later syncs move the
issue accordingly. The issue description stays the work-package document's body: status lives
in the board state, never in copied text.

**Why this priority**: the v0.7.0 requirement demands the status of each work item be
captured accurately from the appropriate file — the event log — and board placement is where
that accuracy is visible; it ranks below the depth behavior because the board remains usable
on content sync alone.

**Independent Test**: Sync a fixture whose `status.events.jsonl` carries lane-transition
events for its work packages while `status.json` and the documents' front-matter `lane`
deliberately contradict with older values; assert every issue's state equals the state mapped
from the latest event for its work package — never from the stale sources.

**Acceptance Scenarios**:

1. **Given** a mission whose event log's last event for `WP02` is `in_progress` and a team
   configuration mapping that lane, **When** a sync runs, **Then** the `WP02` issue's state is
   the mapped state.
2. **Given** the same mission with `status.json` and the front-matter `lane` claiming
   `planned`, **When** the sync re-runs, **Then** the event log remains the sole authority and
   the issue stays in the state mapped from its latest event.
3. **Given** a work package with no lane events, or a mission with no event log at all,
   **When** a sync runs, **Then** no state is derived and the issue's state is untouched.
4. **Given** a lane value the team configuration does not map, **When** a sync plan is
   produced, **Then** no state change is proposed for it and the unmapped lane is reported.
5. **Given** descriptions already synced under 0.6.0, **When** the sync re-runs with no
   document change, **Then** descriptions are unchanged — status is never appended to
   mirrored content, and no raw front-matter block ever appears in one.

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
- **Per-work-package artifact sub-folders** (`tasks/WP04-doctor-coordination-check/` holding
  `review-cycle-1.md`, `reviewer-feedback-cycle-2.md`, etc., some of which upstream stamps
  with the owning document's `work_package_id` front matter): never canonical documents and
  never tasks — inert content, whatever front matter they carry; the duplicate-identifier
  collision check still applies between two CANONICAL documents at the same collection level.
- **Event log referencing an unknown work-package identifier** (document deleted or renamed
  id): the event is ignored with a reported finding; the log never conjures an issue or state
  for a document that no longer exists.
- **Many lane events between two syncs**: the issue converges straight to the state mapped
  from the LAST event — intermediate lanes are not replayed as activity on the tracker.
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
- **FR-007**: The mission's `status.events.jsonl` MUST be the SOLE authoritative source of a
  work package's current status: the last lane event for the work-package identifier (in
  append/file order) MUST determine the status, and MUST set the issue's tracker workflow
  state through the teams' lane→state mapping. The front-matter `lane` field and
  `status.json` MUST never act as state sources. A work package with no lane events MUST have
  its issue state untouched; a lane value absent from the mapping MUST leave the state
  untouched and be reported; malformed event lines MUST be skipped with a reported finding
  without poisoning later events. Raw front-matter content MUST NOT appear in any mirrored
  title or content, and status MUST NOT be written into the mirrored description.
- **FR-008**: The mission directory beneath the specs root MUST attribute tasks to the mission
  whatever its naming style: numeric-prefixed (`042-auth-system`), identifier-suffixed
  (`auth-system-01KQ2VNJ`), or bare slug.
- **FR-009**: The mission artifacts `meta.json`, `spec.md`, `plan.md`, the `tasks.md`/`TASKS.md`
  roll-up, `wps.yaml`, `status.events.jsonl`, and `status.json` MUST yield zero tasks at every
  depth setting and MUST remain claimed by the `spec-kitty` identity when inside a mission (no
  fall-through to `generic`). Beyond yielding no tasks they are inert sync content, except
  `status.events.jsonl`, which is consumed solely for the FR-007 status derivation;
  `meta.json`, `wps.yaml`, and `status.json` MUST NOT be consumed as sync inputs in this
  release, and dependency front matter MUST remain mirrored content only — no tracker
  relation mapping.
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
  with document sources and for lane→state mapping, requirements ledger, CHANGELOG) MUST
  describe the two-level model — work packages at level 1, subtasks at level 2 with folding at
  depth 1 — and the event-log status authority, replacing the "subtasks are always content"
  and "lane is content only" descriptions; the documentation-consistency suite's pins MUST be
  satisfied by the corrected text, not relaxed.
- **FR-015**: Canonical work-package documents MUST be recognized only as files directly
  inside the mission's `tasks/` collection (with the legacy lane sub-folder variant retained,
  022). Any file inside a per-work-package artifact sub-folder (a `tasks/` sub-folder named
  after a work package, holding review cycles, reviewer feedback, or attachments) MUST yield
  zero tasks and MUST remain claimed by the `spec-kitty` identity REGARDLESS of front matter
  it carries — including a `work_package_id` duplicating the canonical document's — so such
  artifacts can never add fine-grained issues nor trigger the same-mission duplicate-
  identifier collision abort between a canonical document and its own artifacts.
- **FR-016**: Work-package-per-issue IS the sync's granularity contract: a repository's
  level-1 task count MUST equal its canonical work-package document count at every depth
  setting, and the depth configuration MUST only fold nesting below level 1 — it MUST NEVER
  merge work packages into coarser issues or split them into finer ones, however large the
  resulting board (thousands of level-1 sibling issues on a big mission tree is correct
  behavior, not a defect).

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
  work-package id; content = document body minus promoted sections; tracker state = mapped
  from the work package's latest status event.
- **Sync Task (subtask-sourced)**: the level-2 task seeded from framework + mission +
  work-package id + subtask id; parented to its work-package task; content = the subtask's
  anchored section.
- **Work-Package Artifact**: a file in a per-work-package sub-folder (review cycles, reviewer
  feedback, attachments); carries lifecycle detail about its work package but is never a
  canonical document, never a task, and never a duplicate-identifier collision.
- **Status Event**: one appended line in the mission's `status.events.jsonl` recording a work
  package's lane transition; the SOLE authoritative status source — last event per work
  package wins; malformed lines are skipped-with-report, unknown ids ignored-with-report.
- **Mission Manifest/State Artifacts** (`wps.yaml`, `status.json`, `meta.json`): claimed-inert
  documentation in this release — never task sources, never sync inputs
  (`status.events.jsonl` is consumed, but only for FR-007 status derivation).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a reference fixture reproducing the upstream layout (multiple missions with
  mixed naming styles, full artifact sets), a depth-2 sync produces parent issues equal to the
  WP-document count and child issues equal to the promotable-anchor count per work package,
  with 100% of children parented to the correct work-package issue.
- **SC-002**: At the shipped default configuration, 0 sub-issues are ever created for
  `spec-kitty` files, task counts match the 0.6.0 baseline exactly, and every subtask's text
  is present inside its parent's mirrored content.
- **SC-003**: On a fixture where `status.json` and the front-matter `lane` deliberately
  contradict the event log, 100% of work-package issues carry the state mapped from each work
  package's LATEST event-log entry; work packages without events keep their state untouched in
  100% of runs; 0 mirrored titles or contents ever contain a raw front-matter block or
  appended status text.
- **SC-004**: A re-run after only lifecycle edits (lane flip, history append, review report,
  in-collection rename) produces 0 new issues and 0 identity changes at both depth settings,
  including the children of renamed work packages.
- **SC-005**: Raising then lowering the depth cap leaves the board converged: after lowering,
  every former sub-issue is reported through stale/leftover reporting and none is
  automatically deleted or silently kept.
- **SC-006**: Zero behavior drift for the other six built-in identities — existing discovery,
  parse, depth-folding, and plan fixtures are byte-identical before and after this change.
- **SC-007**: On a fixture reproducing the reference repository's per-work-package artifact
  sub-folders (review cycles carrying duplicated `work_package_id` front matter), a plan
  completes with zero collision refusals and task counts equal to the canonical work-package
  document count — artifact files contribute 0 tasks at every depth.

## Assumptions

- Status capture is scoped exactly as clarified: the event log is the sole lane-state
  authority, and the lane→tracker-state table is resolved through the teams' existing
  workflow-state routing configuration at plan level — no new required configuration ships,
  and lanes with no mapping simply never move issues. Dependency-edge creation and any
  consumption of `wps.yaml`, `status.json`, or `meta.json` remain out of scope, continuing
  the 017/022 stance.
- This feature amends the 022 assumption that subtasks are never separate tracker tasks: at
  depth greater than 1 they are. Contract amendments will be recorded during planning; the 022
  level-1 contracts (task source, title cascade, durable-only pairing, roll-up inertness)
  carry forward unchanged.
- This feature likewise amends the 022 recognition edge case ("a file counts as a
  work-package document if it identifies itself, anywhere in the collection"): measured on
  the upstream reference repository, that rule let per-work-package review artifacts stamped
  with the canonical `work_package_id` create duplicate-identity tasks and refuse every
  plan; FR-015 replaces collection-wide self-identification with canonical = directly inside
  the collection (lane sub-folders retained).
- Subtask promotion requires a body anchor: a front-matter-only roster entry creates no empty
  issue (consistent with the 022 "empty-but-reported, never silent" and no-empty-content
  stance). The default anchor token is `T` + digits, configurable via adapter layering.
- Promoted subtask sections are removed from the parent's mirrored content at depth greater
  than 1 to avoid duplication, mirroring how 020 treats promoted nested tasks for checklist
  sources; folded at depth 1 they return verbatim.
- Upgrade impact: existing issues keep their identities; at the flat default, descriptions
  are unchanged (status arrives as board-state transitions only, and the corrected
  document/artifact recognition merely stops creating spurious issues). No repository files
  are ever rewritten by this feature.
- Work-package documents, roll-ups, and mission artifacts are never written back: no
  confirmation prefix, no landed line, no status markers appended to Spec Kitty files.
- Missions keep the documented flat `tasks/` collection (legacy lane sub-folders accepted);
  `.kittify/` and `.worktrees/` contain no sync-relevant task sources.
- The depth cap remains a single global configuration key (020); no Spec-Kitty-specific depth
  setting is introduced. It is a nesting-fold control, not a board-volume control: the board
  size is the work-package count.
