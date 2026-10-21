# Feature Specification: Sync Engine — Conflict Resolution, State Persistence, Apply, and Rollback

**Feature Branch**: `008-sync-engine-apply-rollback`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group F (Sync modes, conflict resolution, and completion states, source R9), group H (Sync-state persistence and sync history, source R9 criteria 17–20), and group J (Plan, apply, and rollback engine specifics, source R12).

## Purpose and Scope

The engine core where both sides of the sync meet: checkpoint-based change
classification, conflict resolution actions, completion-state mapping, authoritative
sync-state persistence with append-only history, and the journaled, resumable apply →
rollback lifecycle. This is the Wave-3 integration feature — the first that composes
003–007 — and it realizes 001's User Stories 1 (apply half) and 2.

**Owns**: bootstrap vs sync mode selection; conflict classification and the six
resolution actions; frozen conflict blocks; checkbox→workflow mapping; sync-state
payload rewriting; history event appending and page rollover; parent-before-child
creation; indeterminate-create reconciliation; rollback journal semantics and history
preservation.

**Consumes from 002**: contracts and gates. **Consumes from**: 003/004 (parsed tasks),
005 (routing/titles), 006 (matches), 007 (tracker operations).

**Provides to**: 009 (plan/apply/check commands and reports), 010 (worker invokes the
same apply entry), 012 (agent apply tool runs this engine path), 013 (drift and conflict
signals appear in plan output).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conflict-aware reconciliation on later runs (Priority: P1)

On a first run (no prior checkpoint) the tool seeds the tracker from the repository. On
later runs it compares each matched task's repository section and the issue description
against the recorded checkpoint, classifies the conflict type (`linear-changed`,
`spec-changed`, `both-changed`), and applies the configured resolution action per mode —
overwrite either side, write git-style conflict markers into the spec file, report only,
skip, prefer the newer side, or fail the run. Checkbox completion drives the issue's
workflow state, and blocks a human has not yet resolved are left untouched and reported.

**Why this priority**: Bidirectional sync is only trustworthy if drift on either side is
handled by explicit, configurable rules instead of silent clobbering.

**Independent Test**: With a checkpoint in place, mutate (a) only the issue description,
(b) only the task section, and (c) both, then run sync with each configured action and
verify the exact effects, including conflict-marker blocks, report-only entries, and
abort-on-fail behavior — against the hermetic tracker fake.

**Acceptance Scenarios**:

1. **Given** no checkpoint exists for the repository, **When** a run begins, **Then**
   bootstrap mode applies with its own conflict-action map, any meaningful difference
   classifies `both-changed`, and identical-after-normalization content is no conflict.
2. **Given** a checkpoint exists and only the issue description changed since it,
   **When** sync reconciles that task under the default sync-mode map, **Then** the
   conflict is classified `linear-changed` and the mapped action (default: write
   conflict markers into the task's section in the spec file) is applied.
3. **Given** a conflict resolves to `overwrite-spec`, **When** the action is applied,
   **Then** the local content and the tracker content are embedded between git-style
   start/separator/end markers in the task's section, the issue description is left
   unchanged, and nothing is pushed to the tracker.
4. **Given** a task's section still contains conflict markers, **When** any later run
   touches it, **Then** the task is skipped for reconciliation, reported as an
   unresolved conflict, and neither its markers nor the issue description are modified.
5. **Given** a checklist task newly checked in the repository while its issue is
   otherwise unchanged, **When** sync applies, **Then** the issue moves to the
   configured done state (unchecked → backlog state), independently of the description
   conflict machinery.
6. **Given** a resolved `prefer-newer` action with indeterminable recency, **When** the
   action runs, **Then** it degrades to report-only rather than guessing.

### User Story 2 - Gated apply with durable state, history, and resumable rollback (Priority: P2)

An approved plan applies parent-before-child, mirrors screened task sections into issue
descriptions, rewrites the canonical attachment's managed state, appends exactly one
history event per affecting action, journals every mutation, and can be rolled back —
files, issue fields, checkpoints restored; created issues archived; history and durable
identity never rewound; an interrupted rollback resumable without repeating steps.

**Why this priority**: Apply is the only mutating path; journaling and rollback are what
make trying it safe, but they ride on top of the reconciliation machinery.

**Independent Test**: Full apply against the fake tracker, then rollback; assert
restore of every file/field/checkpoint, archive of created issues, zero history loss;
interrupt the rollback at each step and resume; corrupt one step's state and assert
conflict-halt; fail one create and assert indeterminate handling with no auto-replay.

**Acceptance Scenarios**:

1. **Given** an approved plan, **When** apply runs, **Then** missing issues are created
   parent-before-child with sibling issues within the same parent emitted in reverse of
   their working order, matched issues are updated, each task's section is mirrored into
   the issue description after screening, sync state is persisted to the issue's tool
   attachment, one history event is appended per affecting action, and assigned task
   lines are rewritten (via 004) with the issue reference and title.
2. **Given** an issue-creation attempt that errors, **When** reconciliation finds the
   count of issues carrying the task's durable identity is not exactly one, **Then** the
   create is recorded indeterminate, further creation for that task aborts, and the
   create is never automatically replayed.
3. **Given** a journaled run, **When** rollback executes, **Then** each modified file is
   restored to before content, each updated issue field to its before value, each issue
   created during the run is archived, and the checkpoint is restored or removed to match
   its prior state.
4. **Given** an interrupted rollback, **When** it resumes, **Then** completed steps are
   not repeated and any step whose state matches neither its before nor its result state
   is reported as a conflict and halted.
5. **Given** any rollback, **When** it completes, **Then** sync history and durable
   identity are preserved: no continuation page or prior event removed, the page-0
   canonical attachment created during the run retained, non-history managed state only
   adjusted to mirror the restored issue state.
6. **Given** history growth past the per-page entry threshold or size limit, **When**
   appending, **Then** the log rolls to the next deterministic continuation attachment
   page preserving every prior entry.

## Requirements *(mandatory)*

- **FR-001** (001 FR-036): System MUST select bootstrap mode when no checkpoint exists
  and sync mode when one exists, each mode using its own independently configured
  conflict-action map.
- **FR-002** (001 FR-037): In sync mode, System MUST classify each matched task's
  description conflict as `linear-changed`, `spec-changed`, or `both-changed` by
  comparing change since the checkpoint on each side; in bootstrap mode, System MUST
  treat any meaningful difference as `both-changed` and identical-after-normalization
  content as no conflict.
- **FR-003** (001 FR-038): System MUST apply the mapped resolution action to the whole
  tool-managed issue description only — never to the synced state payload — and MUST
  support the six actions with these effects: `overwrite-linear` (push task section to
  the issue), `overwrite-spec` (write tracker content into the task's section as a
  git-style conflict-marker block, leaving the issue unchanged and pushing nothing),
  `report-only` (no changes, surfaced as a conflict), `skip` (no changes, recorded
  internally only), `prefer-newer` (newer side wins via the overwrite-linear /
  overwrite-spec effects; report-only when recency is indeterminable), and `fail` (abort
  before any further mutation and report).
- **FR-004** (001 FR-039): System MUST provide overridable built-in default action
  maps: bootstrap mode — all three conflict types resolve to `overwrite-linear`; sync
  mode — `spec-changed` → `overwrite-linear`, `linear-changed` → `overwrite-spec`,
  `both-changed` → `report-only`.
- **FR-005** (001 FR-040): System MUST report every reason for an applied action
  identifying the conflict type and the action taken.
- **FR-006** (001 FR-041): When a checklist task's checked state changed in the
  repository since the checkpoint and its issue is otherwise unchanged, System MUST set
  the issue's desired workflow state to the configured done state (when checked) or
  backlog state (when unchecked), independently of the description conflict machinery.
- **FR-007** (001 FR-042): System MUST treat an unresolved conflict block as frozen: no
  change to the task's section or the issue description, nothing pushed, no additional
  or nested markers, and a surfaced unresolved-conflict report entry, until a human
  removes the markers.
- **FR-008** (001 FR-049): On every applied run for a matched task, System MUST write
  the non-history sync-state payload (durable identity, framework metadata, mirrored
  content hash, cursors/timestamps) into the page-0 canonical attachment as tool-owned
  state, rewriting it authoritatively each apply after screening.
- **FR-009** (001 FR-050): System MUST append exactly one screened, human-readable,
  timestamped history event to the task's append-only history per sync-affecting action
  (create, match, title update, description update, checkbox/workflow change, conflict
  detection, rollback), and MUST record a rollback by appending a `rollback` event
  referencing the reversed actions rather than removing or editing any earlier entry.
- **FR-010** (001 FR-051): System MUST roll appended history over to the next
  deterministic continuation attachment page when the configured per-page entry
  threshold or a practical metadata size limit would be exceeded, preserving every prior
  entry.
- **FR-011** (001 FR-057): System MUST create issues parent-before-child, emitting
  sibling issues within the same parent in reverse of their working order.
- **FR-012** (001 FR-058): When an issue-creation attempt errors and reconciliation finds
  the count of issues carrying the task's durable identity is not exactly one, System
  MUST record the create as indeterminate, abort further creation for that task, and
  never automatically replay the create.
- **FR-013** (001 FR-059): For a journaled run, rollback MUST restore each modified file
  to its before content, restore each updated issue field to its before value, archive
  each issue created during the run, and restore or remove the checkpoint to match its
  prior state.
- **FR-014** (001 FR-060): Rollback MUST be resumable: each step guarded so an
  interrupted rollback can resume without repeating completed steps, and a step whose
  state matches neither its before nor its result state MUST be reported as a conflict
  and halted.
- **FR-015** (001 FR-061): System MUST include every planned attachment create-or-update
  (canonical and continuation pages) as planned operations, journal each with the target
  issue, addressed URL, and prior attachment metadata where one existed, and rely on URL
  idempotency so repeated or resumed applies never duplicate attachments.
- **FR-016** (001 FR-062): Rollback MUST preserve the sync history and the durable
  identity: attachment history is never rewound, continuation pages and prior events are
  never removed, and a page-0 canonical attachment created during the run is retained;
  the non-history managed state MAY be adjusted to mirror the restored issue state.

### Edge Cases

- **Formatting-only drift** (001 edge case): round-trip formatting differences between
  the mirrored description and the task section are never treated as conflicts and never
  cause repeated rewrites (constitution conflict-free-sync rule).
- **History volume** (001 edge case): a history page reaching its configured entry/size
  threshold → rollover to the next continuation attachment page with no entry lost.
- **`fail` action mid-run**: aborts before any further mutation; already-applied journal
  steps remain rollback-able.
- **Nested markers**: an attempt to write markers into a section that already has them
  is refused (frozen-block rule).

## Key Entities

**Checkpoint** (owned): per-task local record of last-known checkbox state, title, issue
update time, issue state, and mirrored-description content hash; basis for change
classification and mode selection. **Conflict Resolution Map** (owned). **Sync State
Payload** and **Sync History Event** (write semantics owned here; shapes per 002).
**Audit Manifest** and **Create Intent** (lifecycle records from 002; journaling rules
owned here).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-001): Running apply twice over an unchanged repository and tracker
  reports zero pending changes on the second run (converged sync).
- **SC-002** (001 SC-004): Across a full apply-and-plan round trip over formatting-only
  tracker round-trip noise, zero conflicts are raised and zero description rewrites
  occur.
- **SC-003** (001 SC-008): Rollback of any journaled run restores every modified file,
  issue field, and checkpoint to its prior state and archives every issue created by
  that run, with 0 sync-history events lost or altered.
- **SC-004**: Each of the six resolution actions × three conflict types × two modes is
  exercised by at least one passing fixture; conflict blocks survive any number of
  intervening runs byte-for-byte until a human removes them.

## Assumptions

- All mutation flows through the single gated engine apply entry (constitution
  Principle I); CLI (009), worker (010), and agent tool (012) are callers, not
  parallel implementations.
- The tracker's update-time and state metadata provide recency signals for
  `prefer-newer`; indeterminacy degrades to report-only by design.
- Screening of all propagated text is the constitution's mandate; engine pipelines every
  description, attachment payload, and history event through it before transmission.
