# Feature Specification: Background Sync Queue, Worker, and Hook Triggers

**Feature Branch**: `010-background-queue-sync-hooks`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group K (Queue and background worker, source R13) and group L (Git-hook and agent-hook triggers, source R14, R19).

## Purpose and Scope

Keeps traceability fresh without developer discipline: managed git hooks and agent-hook
scaffolds enqueue a single deduplicated job; a detached background worker drains it with
locking, claims, retries, and notifications — never blocking git or the editor. Wave-4
feature; realizes 001's User Story 3. The worker invokes the same gated engine apply
entry as the CLI — it duplicates no sync logic.

**Owns**: pending-job dedup and timing; queue lock and claim protocol; retry policy and
retry-limit reporting; last-run marker update and notifications; git-hook block
installation (marker-bounded, byte-preserving); hook fire behavior (always exit zero);
the stable shell-invocable enqueue entry point; agent-hook scaffolding with
never-overwrite semantics.

**Consumes from 002**: run-state placement, sanitized reports, last-run marker,
notification posture. **Consumes from 008**: the gated engine apply (the job's mode
selects bootstrap/sync). **Consumes from 003**: adapter agent-hook template behavior
(Kiro/generic defaults).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Non-blocking enqueue and drain (Priority: P1)

A managed git hook (`pre-push`, `post-merge` by default) or an agent hook fires; the
previous run's outcome prints to stderr; one deduplicated pending job is written within
500 ms; a detached worker spawns immediately plus a delayed fallback; repeated events
merge into the single pending job; every hook invocation exits zero even when enqueue
fails.

**Why this priority**: Automation is what keeps traceability fresh; the always-exit-zero
and dedup guarantees are what make it acceptable to install at all.

**Independent Test**: Trigger the enqueue entry point from a hook fixture and an
agent-hook definition; verify one pending job, worker pickup, outcome reporting,
notification suppression, retry-limit termination, and that every hook invocation exits
successfully even on enqueue failure.

**Acceptance Scenarios**:

1. **Given** no pending job exists, **When** an event enqueues a job, **Then** the
   pending job is written within 500 ms and a detached worker is spawned within 500 ms,
   plus a delayed fallback worker scheduled after the configured worker-delay (range
   1–3600 s, default 75 s).
2. **Given** a pending job already exists, **When** another event enqueues, **Then** the
   new job merges into it — at most one pending job at any time.
3. **Given** a managed hook fires, **When** the previous run's outcome is known,
   **Then** it is printed to standard error before enqueuing, and the hook always exits
   zero — including when credential environment variables are absent (warning emitted,
   enqueue still performed) and when the enqueue itself fails (error emitted).
4. **Given** a queued run fails repeatedly, **When** the configured retry maximum (range
   1–100, default 5) is reached, **Then** retries stop and a sanitized report records
   the retry-limit outcome.
5. **Given** a queued run completes, **When** it finishes, **Then** a durable last-run
   marker records outcome and completion timestamp, the outcome writes to stderr when
   attached to a terminal, and notification is attempted best-effort (suppressed or
   undeliverable continues without error).

### User Story 2 - Safe queue concurrency and claim recovery (Priority: P2)

Queue reads/writes happen only under the queue lock; a lock that cannot be acquired in
time ends the drain without touching the pending job; abandoned claims are reclaimed
before re-claiming; exactly one worker ever holds a claim.

**Why this priority**: Without the lock/claim protocol, parallel hook storms produce
double applies — the one failure mode background sync cannot have.

**Independent Test**: Storm the enqueue entry point concurrently; assert single pending
job, single live claim, lock-timeout drain exits untouched, a claim older than the
abandoned-claim threshold (range 1–3600 s, default 300 s) is reclaimed, and the applied
job honors the mode it specifies.

**Acceptance Scenarios**:

1. **Given** the queue lock is held, **When** a drain attempt cannot acquire within the
   configured timeout (range 1–300 s, default 30 s), **Then** the attempt ends without
   modifying the pending job and a sanitized lock-failure report is recorded.
2. **Given** a claim older than the abandoned-claim threshold, **When** a worker holds
   the queue lock, **Then** the claim is reclaimed before the pending job is claimed
   atomically so only one worker can hold it.
3. **Given** a claimed job specifying its mode, **When** the worker applies it, **Then**
   the engine apply runs in that mode; on failure, the pending job is rewritten for
   retry with incremented count plus a sanitized failure report.

### User Story 3 - Managed hook installation and scaffolds (Priority: P3)

The tool installs marker-bounded blocks into configured git hooks preserving all other
content byte-for-byte, aborts cleanly on unrecognized hook names, and scaffolds
agent-hook definitions invoking the enqueue entry point — never overwriting an existing
target file, with zero network calls.

**Why this priority**: Installation ergonomics; correctness here protects the
developer's existing hooks.

**Independent Test**: Install into hook files with foreign content; diff byte-preservation
outside markers; append when no marker pair exists; feed invalid hook names and assert
pre-write abort listing every bad name; scaffold to an occupied path and assert a
non-conflicting name or a conflict report — no file overwritten, no network.

**Acceptance Scenarios**:

1. **Given** the configured managed set (default `pre-push`, `post-merge`), **When**
   installation runs, **Then** the marker-bounded block is written into each hook at the
   configured or repository-default hooks directory, content outside markers preserved
   byte-for-byte, block appended when no marker pair exists.
2. **Given** an unrecognized hook name in the managed set, **When** installation starts,
   **Then** it aborts before writing any hook and reports every bad name.
3. **Given** an agent-hook scaffold request, **When** it runs, **Then** a valid hook
   definition invoking the enqueue entry point for a default post-file-save event
   matched against the configured task-file patterns is written under the
   framework-specific default directory (`.kiro/hooks/` for Kiro,
   `.task-linear-sync/hooks/` for generic) or its configured override, performing no
   tracker mutation or network call.
4. **Given** the scaffold target file already exists, **When** scaffolding runs, **Then**
   the existing file is never overwritten (a non-conflicting name is written or a
   conflict is reported).

## Requirements *(mandatory)*

- **FR-001** (001 FR-063): System MUST write a single pending job within 500 ms of an
  enqueue when none is pending, merge subsequent enqueues into the existing pending job,
  spawn a detached worker within 500 ms of enqueue, and schedule a delayed fallback
  worker after the configured worker-delay interval (valid range 1–3600 s, default 75 s).
- **FR-002** (001 FR-064): System MUST acquire the queue lock before reading or
  modifying the pending job; if the lock cannot be acquired within the configured
  timeout (1–300 s, default 30 s), the drain attempt MUST end without modifying the
  pending job and a sanitized lock-failure report MUST be recorded.
- **FR-003** (001 FR-065): While holding the queue lock, System MUST reclaim claims
  older than the configured abandoned-claim threshold (1–3600 s, default 300 s) before
  claiming the pending job atomically so only one worker can hold the claim.
- **FR-004** (001 FR-066): System MUST apply a claimed job in the mode it specifies; on
  failure, rewrite the pending job for retry with an incremented count and a sanitized
  failure report; when the configured retry maximum (1–100, default 5) is reached, stop
  rewriting for retry and record the retry-limit report.
- **FR-005** (001 FR-067): On queued-run completion, System MUST update a durable
  last-run marker with outcome and completion timestamp, write the outcome to standard
  error when attached to a terminal, and attempt a best-effort platform notification —
  continuing without error when notification is undeliverable or suppressed by
  configuration.
- **FR-006** (001 FR-068): System MUST install its managed, marker-bounded hook block
  into each git hook event in the configured managed set (default `pre-push`,
  `post-merge`) at the configured or repository-default hooks directory, preserving all
  content outside its markers byte-for-byte and appending the block when no marker pair
  exists; unrecognized hook names MUST abort installation before any write and report
  every bad name.
- **FR-007** (001 FR-069): When a managed hook fires, System MUST print the previous
  recorded run's outcome to standard error, enqueue via the shell-invocable enqueue
  entry point under the configurable script prefix, and exit with status zero —
  including when the credential environment variables are absent (warning emitted,
  enqueue still performed) and when the enqueue itself fails (error emitted).
- **FR-008** (001 FR-070): System MUST expose a stable, shell-invocable enqueue entry
  point that performs the deduplicated non-blocking enqueue and exits zero, usable by
  git hooks, agent hooks, CI steps, or manual invocation.
- **FR-009** (001 FR-071): On agent-hook installation, System MUST scaffold a valid hook
  definition invoking the enqueue entry point for a default post-file-save event matched
  against the configured task-file patterns, writing it under the framework-specific
  default directory (`.kiro/hooks/` for Kiro, `.task-linear-sync/hooks/` for generic) or
  its configured override, performing no tracker mutation or network call, and never
  overwriting an existing target file (writing a non-conflicting name or refusing with a
  conflict report instead).

### Edge Cases

- **Interrupted background drain** (001 edge case): a claim older than the
  abandoned-claim threshold is reclaimed before a new claim; queue-lock timeout ends the
  drain without touching the pending job.
- **Unrecognized hook names** (001 edge case): installation aborts before writing any
  hook and reports every bad name.
- **Enqueue during drain**: merge semantics keep exactly one pending job; no lost wake
  (the delayed fallback worker guarantees eventual drain).

## Key Entities

**Pending Job / Last-Run Marker** (owned): the single deduplicated queued sync request
and the durable record of the most recent completed run's outcome and time. **Hook
Definition / Hook Block** (owned): scaffolded agent-hook file and marker-bounded managed
region in git hook scripts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-007): 100% of hook invocations exit successfully across the fixture
  set (including absent credentials and injected enqueue failures), and enqueue completes
  within 500 ms of the trigger.
- **SC-002**: Under a 100-event enqueue storm, at most one pending job ever exists and
  exactly one worker ever holds a live claim.
- **SC-003**: Hook files with foreign content round-trip with 0 bytes changed outside the
  managed marker blocks across install/re-install fixtures.

## Assumptions

- The worker calls the engine apply entry with the job's mode; all safety gates apply
  inside the engine, unchanged (constitution Principle I/V).
- Notification delivery mechanisms follow platform capability; undeliverable is a
  success path, not an error.
- Hook installation targets stay within the repository's git configuration (hooks
  directory); nothing outside it is modified.
