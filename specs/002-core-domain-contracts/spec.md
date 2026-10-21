# Feature Specification: Core Domain Contracts, Configuration, and Run State

**Feature Branch**: `002-core-domain-contracts`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). This feature owns the shared domain vocabulary, integration contracts, configuration model, and run-state lifecycle that every other feature builds against.

## Purpose and Scope

This is the **foundation feature** of the decomposition. It is the single sequential
prerequisite: every other feature (003–013) depends only on the contracts defined here,
never on each other's internals. It makes parallel development safe by freezing the
seams — shared entity shapes, the tracker port surface, the durable attachment-URL
scheme, the plan/report contract, and the gate vocabulary — before any surface is built.

**Owns**: the canonical Key Entities of 001 (Task, Task File, Framework Adapter, Routing
Entry, Match, Checkpoint, Conflict Resolution Map, Sync State Payload, Attachment Chain,
Sync History Event, Plan, Audit Manifest, Create Intent, Pending Job / Last-Run Marker,
Hook Definition / Hook Block, Plan Report Artifacts, Sync-History Page); the
configuration source model and validation (001 group O); and the run-state lifecycle
(001 group I).

**Contracts frozen here (definitions referenced from 001; no new FR numbers)**:

- **Task model**: heading/checklist kind, 1-based line position, parent/child nesting,
  phase, local task ID, visible issue reference, `Feature_Name`, `Task_Body` extent,
  unresolved-conflict flag, durable `Stable_UUID` (governed by constitution Principle II).
- **Tracker port** (per constitution Principle V): the only route to the issue tracker;
  shaped by feature 007's FRs; consumed by 006, 008, 009, 011, 013 as an injectable
  fake in hermetic tests.
- **Engine apply entry**: one gated apply operation shared by CLI (009), queue worker
  (010), and agent tool (012); gate vocabulary per constitution Principle I (apply flag,
  exact `Confirmation_Key`, accept-low-confidence, fresh `Plan_Reference`).
- **Canonical attachment URL scheme**: deterministic `<base-host>/<toolId>/<task-uuid>`
  page-0 URL plus deterministic continuation-page URLs; sole identity anchor
  (constitution Principle II). Consumed by 007, 008, 011.
- **Plan artifact contract**: plan object with per-task decision/confidence/score/margin/
  reasons/alternatives/content-hash fields, and the paired JSON/Markdown review-report
  schema (field set fixed by 009); sole machine-readable input to CI enforcement (013).
  A `planId` is a plan reference only when produced by an engine run and validated by the
  constitution's stability guards (input content hashes + VCS HEAD).
- **Safety posture (delegated to constitution)**: screening, zero-mutation read-only
  rule, out-of-repo owner-only state, journaled encrypted runs, rollback refuses
  unjournaled. Features cite the constitution; they do not re-author it.

**Out of scope here**: all domain behavior owned by 003–013; framework-specific
conventions (003); sync/conflict semantics (008); any surface UI/CLI text (009–013).

**Dependencies**: none. This feature blocks Wave 2 (003–007).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-surprise configuration (Priority: P1)

A consumer installs the tool and supplies configuration from built-in defaults, a JSON
file, and programmatic overrides. Deep-merge precedence and required-identity validation
make misconfiguration fail fast and completely, naming exactly what is wrong, before any
other subsystem loads.

**Why this priority**: Every other feature consumes merged configuration; ambiguous or
partially applied configuration would corrupt all downstream behavior and all parallel
work built on it.

**Independent Test**: Layer defaults, a JSON file, and programmatic overrides over
fixtures; assert deep-merge precedence, abort-on-invalid-file with the failure category,
and abort-on-missing-required-identity naming every missing value — no subsystem beyond
configuration loading needs to exist.

**Acceptance Scenarios**:

1. **Given** defaults plus a JSON file plus programmatic overrides, **When**
   configuration loads, **Then** the deep-merge precedence of the constitution applies
   and the result is deterministic for identical inputs.
2. **Given** a configured file path that is missing, unreadable, or syntactically
   invalid, **When** configuration loads, **Then** loading aborts naming the file path
   and failure category, and no partial configuration from that file is applied.
3. **Given** merged configuration missing any consumer-required identity (teams,
   per-team projects, per-team workflow states, routing entries, default team/project),
   **When** initialization runs, **Then** it aborts naming each missing value.

### User Story 2 - Isolated, safe run state (Priority: P2)

Run artifacts land in a consumer-configured directory or a per-repository default
beneath the platform application-state location; expired manifests age out; a crashed
run's lock is taken over only under the exact stale rule; create-intent bookkeeping is
available to the apply engine.

**Why this priority**: The repository working tree must stay clean by construction, and
the queue worker (010), apply engine (008), and rollback behavior all rest on this
lifecycle.

**Independent Test**: Run with default and configured state directories against two
repository fixtures; assert placement, naming-by-root-hash, expiry of an aged manifest,
lock takeover only when the pid is dead **and** the age threshold is exceeded, and
create-intent records written before a simulated creation.

**Acceptance Scenarios**:

1. **Given** no configured state directory, **When** state is created, **Then** it lands
   in a per-repository directory beneath the platform application-state location named
   by a hash of the canonical repository root.
2. **Given** a stored audit manifest older than the configured expiry (default 30 days),
   **When** it is consulted, **Then** it is treated as expired whether or not encryption
   is enabled.
3. **Given** an existing run lock, **When** a new run attempts takeover, **Then** it
   succeeds only when the recorded process is not alive **and** the lock age exceeds the
   stale-takeover threshold (default 60 s).
4. **Given** an issue-creation attempt is about to occur, **When** the apply engine
   requests it, **Then** a create-intent record with lifecycle status already exists.

## Requirements *(mandatory)*

Requirement governance (defaults, deep-merge precedence, credential handling, locking
posture, encryption envelope) is stated in the constitution and depended upon, not
re-authored. FR numbers are local to this spec; the parenthetical cites the originating
001 FR for traceability.

### Functional Requirements

- **FR-001** (001 FR-052): System MUST place run state in a consumer-configured
  directory, or by default in a per-repository directory beneath the platform's
  application-state location, named by a hash of the canonical repository root path.
- **FR-002** (001 FR-053): System MUST treat a stored audit manifest as expired when its
  age exceeds the configured expiry duration (default 30 days), regardless of whether
  manifest encryption is enabled.
- **FR-003** (001 FR-054): System MUST take over a stale run lock only when the recorded
  process is no longer alive **and** the lock's age exceeds the configured
  stale-takeover threshold (default 60 seconds).
- **FR-004** (001 FR-055): System MUST persist a create-intent record with its lifecycle
  status before performing an issue-creation attempt.
- **FR-005** (001 FR-056): System MUST write sanitized JSON and Markdown run reports (no
  secret or key material) after a run that produces a report, and update the last-run
  marker to reference the completed run.
- **FR-006** (001 FR-080): System MUST accept configuration from built-in defaults, a
  JSON configuration file, and programmatic overrides (merge semantics governed by the
  constitution), and MUST abort configuration loading with the file path and failure
  category when a configured file is missing, unreadable, or syntactically invalid,
  applying no partial configuration from it.
- **FR-007** (001 FR-081): System MUST abort initialization with an error naming each
  missing required workspace identity when any consumer-required value (teams, per-team
  projects, per-team workflow states, routing entries, default team/project) is absent
  or empty after merging all sources.
- **FR-008**: System MUST expose the contracts enumerated in "Purpose and Scope" (task
  model, tracker port, engine apply entry, attachment URL scheme, plan artifact schema,
  gate vocabulary) to the other feature specs, and any change to a frozen contract MUST
  be treated as a constitution-governed cross-feature amendment, not a private change.

### Edge Cases

- **Unknown or missing configuration** (001 edge case): the config file path is set but
  missing, unreadable, or invalid → loading aborts with the failure category; a required
  workspace identity is absent → initialization aborts naming each missing value.
- **Lock race**: two processes attempt takeover simultaneously → only one acquires per
  the constitution's advisory-locking rule; the loser reports and exits.
- **State directory unwritable / inside repository**: System MUST NOT fall back to
  writing state inside the repository working tree; it aborts with a clear error.

## Key Entities *(defined here for all features)*

Task, Task File, Framework Adapter, Routing Entry, Match, Checkpoint, Conflict
Resolution Map, Sync State Payload, Attachment Chain, Sync History Event, Plan, Audit
Manifest, Create Intent, Pending Job / Last-Run Marker, Hook Definition / Hook Block,
Plan Report Artifacts, Sync-History Page — canonical definitions as written in
`specs/001-extract-functional-requirements/spec.md` § Key Entities, refined only by
additive amendment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For identical layered inputs, configuration loading produces byte-identical
  merged configuration on every run (determinism).
- **SC-002**: 100% of misconfiguration fixtures (missing file, invalid JSON, missing
  required identity) abort with a message naming the file path/failure category or every
  missing identity; 0 runs proceed with partial configuration from an invalid file.
- **SC-003**: 0 files or directories are ever created inside the repository working tree
  by run-state activity across the fixture set (state is out-of-repo by construction).
- **SC-004**: Lock takeover occurs with 0 false takeovers (live process never loses the
  lock) and 0 stuck runs (a dead-process lock older than the threshold is always
  recoverable).

## Assumptions

- The constitution (v1.0.0) governs merge semantics, locking, encryption, screening,
  and credential handling; this spec depends on those principles rather than restating
  them.
- Contract definitions are frozen at ratification of this spec; downstream features may
  propose additive amendments but never silent edits.
- Platform application-state location and process-liveness probing follow the
  technology-stack constraints in the constitution.
