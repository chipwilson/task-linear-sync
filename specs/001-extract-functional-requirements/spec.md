# Feature Specification: Task-Linear Sync Functional Requirements

**Feature Branch**: `001-extract-functional-requirements`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "the file specs/requirements.md contains a mixture of project principals and functional requirements. Extract just the functional requirements and ignore anything already represented in the constitution.md to create a new set of functional requirements specs from specs/requirements.md"

## Purpose and Scope of This Specification

This specification is the **functional-requirements-only view** of the monolithic
`specs/requirements.md` document. Project principles, governance constraints, and
quality-gate policy that are already ratified in the project constitution
(`.specify/memory/constitution.md`, v1.0.0) are **deliberately excluded here** —
they remain governed by the constitution and are listed non-normatively in
"Constitution-Covered Aspects (Excluded)" below so nothing is silently dropped.

The functional requirements below describe **what the system does** for its users:
discovering and parsing specification tasks, matching them to issue-tracker issues,
reconciling changes and conflicts, running safely in the background, reporting for
review, and serving the optional history web page, AI-agent tools, and CI
enforcement layer. Terminology follows the glossary in `specs/requirements.md`
(`Task`, `Task_Body`, `Stable_UUID`, `Sync_Attachment`, `Checkpoint`,
`Framework_Adapter`, `Conflict_Action`, etc.).

For traceability, each functional-requirement group cites its source requirement(s)
from `specs/requirements.md` as `(source R<n>)`.

**Traceability-catalog role (as of 2026-10-21)**: per the clarification session below,
the functional requirements cataloged here were redistributed as normative behavior into
independent feature specs `specs/002-…`–`specs/013-…` (see
`specs/ROADMAP.md` for dependency waves). This document is retained unchanged as the
**single traceability catalog** — `specs/requirements.md` → this catalog → owning
feature spec — and is not itself a build target. Where the text of an owning feature
spec and this catalog ever diverge, the owning feature spec governs behavior and this
catalog must be corrected to match.

**Feature Decomposition Traceability** (2026-10-21; full per-FR mapping is inline in
each feature spec as `(001 FR-0xx)` citations):

| 001 FR group (source) | Owning feature spec |
|---|---|
| A. Repository task discovery, FR-001–006 (R1) | [003](../003-task-discovery-framework-adapters/spec.md) |
| B. Task parsing and in-place rendering, FR-007–019 (R2, R3) | [004](../004-task-parsing-line-rendering/spec.md) |
| C. Path-to-team-and-project routing, FR-020–021 (R4) | [005](../005-routing-title-derivation/spec.md) |
| D. Framework adapters, FR-022–026 (R7) | [003](../003-task-discovery-framework-adapters/spec.md) |
| E. Matching, confidence, FR-027–032 (R5) | [006](../006-task-issue-matching/spec.md) |
| E. Title derivation, FR-033–035 (R6) | [005](../005-routing-title-derivation/spec.md) |
| F. Sync modes, conflict resolution, completion states, FR-036–042 (R9) | [008](../008-sync-engine-apply-rollback/spec.md) |
| G. Issue-tracker integration surface, FR-043–048 (R8) | [007](../007-issue-tracker-integration/spec.md) |
| H. Sync-state persistence and sync history, FR-049–051 (R9 c17–20) | [008](../008-sync-engine-apply-rollback/spec.md) |
| I. Run-state specifics, FR-052–056 (R11) | [002](../002-core-domain-contracts/spec.md) |
| J. Plan, apply, and rollback engine, FR-057–062 (R12) | [008](../008-sync-engine-apply-rollback/spec.md) |
| K. Queue and background worker, FR-063–067 (R13) | [010](../010-background-queue-sync-hooks/spec.md) |
| L. Git-hook and agent-hook triggers, FR-068–071 (R14, R19) | [010](../010-background-queue-sync-hooks/spec.md) |
| M. Operator command surface, FR-072–075 (R15) | [009](../009-operator-cli-plan-report/spec.md) |
| N. Plan review report, FR-076–079 (R16) | [009](../009-operator-cli-plan-report/spec.md) |
| O. Configuration validation specifics, FR-080–081 (R17) | [002](../002-core-domain-contracts/spec.md) |
| P. Sync-history web component, FR-082–089 (R20–R24) | [011](../011-sync-history-web-page/spec.md) |
| Q. AI-agent tool interface, FR-090–094 (R25) | [012](../012-ai-agent-tool-interface/spec.md) |
| R. CI/CD enforcement layer, FR-095–097 (R26) | [013](../013-ci-enforcement-layer/spec.md) |

### Out of Scope Here (Governed Elsewhere)

- **Constitution-governed principles** — see the exclusion list below.
- **Packaging/distribution mechanics** (source R18) — governed by the constitution's
  technology-stack constraint.
- **Documentation content** (source R27) — governed by the constitution's
  documentation duty.
- **Test strategy and coverage gates** (source R28) — governed by constitution
  Principle VI.
- **The project's own build/test/release automation** (source R29) — governed by the
  constitution's development-workflow gates.

## Clarifications

### Session 2026-10-21

- Q: How should the split of spec 001 into parallel-developable features be materialized? → A: Create new independent feature specs now; keep 001 only for traceability.

Integration summary: the 97 functional requirements were redistributed verbatim-in-
substance into independent feature specs `specs/002-…`–`specs/013-…` (one FR, one
owner; each relocated FR carries its origin as a `(001 FR-0xx)` citation), organized
contract-first for maximal parallelism (see `specs/ROADMAP.md`): 002 freezes the shared
domain contracts, configuration, and run state as the sole sequential prerequisite;
five features (003–007) then proceed fully in parallel; 008 integrates the engine; five
more (009–013) proceed fully in parallel as additive surfaces. The section
"Feature Decomposition Traceability" above maps every FR group to its owning spec;
this catalog otherwise retains its original text unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Traceable sync of spec tasks to the issue tracker (Priority: P1)

A developer working in a repository that uses a spec-driven development framework
(BMAD, GitHub SpecKit, open-spec, Kiro, or plain Markdown task files) invokes the
tool. The tool finds every task file inside the repository, extracts actionable
tasks (headings and checklists) with stable identities and full task sections,
routes each task to the right issue-tracker team and project by its file path,
matches tasks to existing issues with a confidence band, derives issue titles by
configurable rules, and — once the developer approves a gated apply — creates or
updates the issues, mirrors each task's content into the issue description,
persists machine-readable sync state on the issue, records an append-only sync
history, and writes a visible issue reference back into the task line.

**Why this priority**: This is the core "golden thread" value proposition; without
discovery → parsing → routing → matching → applied sync, no other surface has
anything to offer.

**Independent Test**: Point the tool at a fixture repository containing one task
file per supported framework and a fake issue tracker; run inventory and plan
(read-only), then a gated apply, and verify issue creation/update, description
mirroring, written-back issue prefixes, and persisted sync state — all without
touching any other surface.

**Acceptance Scenarios**:

1. **Given** a repository with task files under framework-typical directories,
   **When** discovery runs, **Then** every matching regular task file beneath the
   repository root is found (skipping excluded directories and symlinked
   entries), returned as root-relative POSIX paths in a deterministic order, and
   each is associated with a framework identity and its sibling specification
   documents where present.
2. **Given** an empty repository or one with no matching task files, **When**
   discovery runs, **Then** an empty result is returned without error.
3. **Given** a discovered task file, **When** parsing runs, **Then** heading tasks
   and checklist tasks are extracted with line numbers, parent/child nesting,
   phase labels, derived task-section (`Task_Body`) extents, parsed local task
   IDs, parsed visible issue references, and a derived `Feature_Name`, while fenced
   code blocks, summary sections, and rollup checklists are excluded with recorded
   exclusion reasons.
4. **Given** tasks and existing tracker issues in the configured teams and
   projects, **When** matching runs, **Then** each task is assigned at most one
   issue and each issue at most one task via a globally optimal one-to-one
   assignment, with a confidence band, a numeric score and margin, and up to three
   ranked alternative candidates recorded per match.
5. **Given** an approved plan, **When** apply runs, **Then** missing issues are
   created parent-before-child, matched issues are updated, each task's section is
   mirrored into the issue description after screening, sync state is persisted to
   the issue's tool attachment, one history event is appended per affecting action,
   and assigned task lines are rewritten with the issue reference and title.
6. **Given** a task whose file path matches a configured routing prefix, **When**
   routing resolves, **Then** the longest matching prefix selects both the team and
   the project; otherwise the configured default team/project apply; otherwise the
   task is left unassigned with an indication, and processing continues.

---

### User Story 2 - Conflict-aware reconciliation on later runs (Priority: P2)

On a first run (no prior checkpoint) the tool seeds the tracker from the
repository. On later runs it compares each matched task's repository section and
the issue description against the recorded checkpoint, classifies the conflict type
(`linear-changed`, `spec-changed`, `both-changed`), and applies the configured
resolution action per mode — overwrite either side, write git-style conflict
markers into the spec file, report only, skip, prefer the newer side, or fail the
run. Checkbox completion drives the issue's workflow state, and blocks a human has
not yet resolved are left untouched and reported.

**Why this priority**: Bidirectional sync is only trustworthy if drift on either
side is handled by explicit, configurable rules instead of silent clobbering; this
is the second thing users need after the basic loop works.

**Independent Test**: With a checkpoint in place, mutate (a) only the issue
description, (b) only the task section, and (c) both, then run sync with each
configured action and verify the exact effects, including conflict-marker blocks,
report-only entries, and abort-on-fail behavior.

**Acceptance Scenarios**:

1. **Given** no checkpoint exists for the repository, **When** a run begins,
   **Then** bootstrap mode applies with its own conflict-action map.
2. **Given** a checkpoint exists and only the issue description changed since it,
   **When** sync reconciles that task under the default sync-mode map, **Then** the
   conflict is classified `linear-changed` and the mapped action (default: write
   conflict markers into the task's section in the spec file) is applied.
3. **Given** a conflict resolves to `overwrite-spec`, **When** the action is
   applied, **Then** the local content and the tracker content are embedded between
   git-style start/separator/end markers in the task's section, the issue
   description is left unchanged, and nothing is pushed to the tracker.
4. **Given** a task's section still contains conflict markers, **When** any later
   run touches it, **Then** the task is skipped for reconciliation, reported as an
   unresolved conflict, and neither its markers nor the issue description are
   modified.
5. **Given** a checklist task newly checked in the repository while its issue is
   otherwise unchanged, **When** sync applies, **Then** the issue moves to the
   configured done state (unchecked → backlog state), independently of the
   description conflict machinery.
6. **Given** a resolved `prefer-newer` action with indeterminable recency, **When**
   the action runs, **Then** it degrades to report-only rather than guessing.

---

### User Story 3 - Unattended background sync after git and agent events (Priority: P3)

Managed, non-blocking git hooks (`pre-push`, `post-merge` by default) and IDE/agent
hooks enqueue a sync job after the developer's action completes. A single deduplicated
pending job is drained by a background worker with retry and notification behavior,
so syncing never blocks git operations or the editor.

**Why this priority**: Automation is what keeps traceability fresh without
discipline; it depends only on the core engine but is not needed for first value.

**Independent Test**: Trigger the enqueue entry point from a hook fixture and from
an agent-hook definition; verify one pending job, worker pickup, outcome reporting
and notification suppression, and that every hook invocation exits successfully even
on enqueue failure.

**Acceptance Scenarios**:

1. **Given** no pending job exists, **When** an event enqueues a job, **Then** a
   single pending job is written and a detached worker is spawned within 500 ms,
   plus a delayed fallback worker is scheduled.
2. **Given** a pending job already exists, **When** another event enqueues,
   **Then** the new job merges into the existing pending job (at most one pending
   job at any time).
3. **Given** a managed hook fires, **When** the previous run's outcome is known,
   **Then** it is printed to standard error before enqueuing, and the hook always
   exits with status zero — even when the enqueue itself fails.
4. **Given** a queued run fails repeatedly, **When** the configured retry maximum is
   reached, **Then** retries stop and a sanitized report records the retry-limit
   outcome.
5. **Given** an agent-hook scaffold is requested, **When** the target file name
   already exists, **Then** the existing file is never overwritten.

---

### User Story 4 - Reviewable plans and CI enforcement before merge (Priority: P4)

A reviewer inspects a plan report — one human-readable and one machine-readable
artifact — that shows decisions, confidence, scores, margins, reasons, alternatives,
expected changes, and unmapped issues **without exposing raw task bodies or
descriptions** (content hashes only). Enterprise teams run the CI enforcement layer
on pull requests; it consumes only sanitized read-only output and fails the build on
any of three independently configurable violation conditions.

**Why this priority**: Adoption at team scale depends on safe review and
automated pre-merge enforcement, but both wrap the already-working core.

**Independent Test**: Generate a plan report against fixtures and assert the full
per-task field set, grouping, unmapped section, and body-exclusion guarantees; run
the enforcement layer against fixtures crafted to trigger each of the three
conditions and confirm per-condition toggles and offending counts.

**Acceptance Scenarios**:

1. **Given** a built plan, **When** the review report is generated, **Then** a JSON
   and a Markdown artifact are produced with zero mutations, each task entry
   carrying decision, framework, feature, file path, confidence, score, margin,
   reasons, up to three alternatives, changed fields, content hash, expected
   Markdown changes, and low-confidence gate status.
2. **Given** entries grouped by project then milestone, **When** the report renders,
   **Then** unmapped issues appear in a separate section and a parent counts as
   mapped when any descendant is mapped.
3. **Given** a pull request whose plan reports more high-confidence unmapped tasks
   than the configured threshold, **When** CI enforcement runs with that condition
   enabled, **Then** the build fails with a human-readable summary naming each
   failed condition and its count.
4. **Given** a protected-branch run where tasks carry unresolved conflict blocks or
   spec-vs-tracker drift exceeds the threshold, **When** enforcement runs, **Then**
   the corresponding conditions trigger; disabled conditions never fail the build.

---

### User Story 5 - Human-readable sync history at the recorded URL (Priority: P5)

An optional web component serves exactly the URL scheme the sync engine records on
each issue's attachment. Opening that address shows the task's complete, ordered,
screened sync history, read live from the issue tracker's attachment metadata and
refreshed near-realtime, private by default with an opt-in public mode.

**Why this priority**: High-value for readers and auditors, but strictly additive
to the sync loop.

**Independent Test**: Serve a task UUID whose history spans multiple attachment
pages; verify chronological rendering across the full chain, not-found responses for
malformed paths or unknown UUIDs, access-control behavior in both modes, and graceful
fallback from push updates to periodic refresh.

**Acceptance Scenarios**:

1. **Given** a request path that matches the configured URL scheme with a well-formed
   task identifier, **When** the page renders, **Then** the full history is
   reconstructed from the canonical attachment page and all continuation pages and
   shown chronologically with human-readable timestamps and descriptions.
2. **Given** a path that mismatches the scheme, the tool identifier segment, or the
   UUID shape, **When** requested, **Then** a not-found response is returned with no
   history data.
3. **Given** access mode `private` (the default), **When** a request presents no or
   an invalid credential, **Then** an unauthorized/forbidden response reveals no
   history data; in `public` mode, valid requests need no credential.
4. **Given** an open history page, **When** new events land in the tracker,
   **Then** the page updates near-realtime where the host supports it and otherwise
   falls back to periodic refresh, with no separate history datastore maintained.

---

### User Story 6 - AI-agent-driven sync through tools with the same guarantees (Priority: P6)

AI coding agents drive the same sync engine through an embedded tool interface
instead of shelling out: three read-only tools mirror inventory, planning, and
status, while a mutating apply tool exists only when explicitly enabled and
requires a fresh, valid plan reference on top of the standard gates.

**Why this priority**: Agent ergonomics broaden usage but duplicate no capability —
it is the last additive surface.

**Independent Test**: Exercise the read-only tools against fixtures and assert zero
mutations/writes; attempt the apply tool while disabled, with a wrong confirmation,
with a stale plan reference, and with the full gate set satisfied, verifying refusal
and success respectively.

**Acceptance Scenarios**:

1. **Given** the tool interface is running with defaults, **When** the client lists
   available tools, **Then** only the three read-only tools are advertised; the apply
   tool appears only after the consumer enables mutating tools.
2. **Given** mutating tools enabled and a plan produced earlier this session,
   **When** apply is called with the correct confirmation, the accept-low-confidence
   argument where needed, and a fresh plan reference, **Then** the same engine apply
   runs as for the CLI.
3. **Given** a plan reference whose inputs changed or that was never produced,
   **When** apply is called, **Then** it refuses with an unknown/stale-reference
   error and no state changes.

---

### Edge Cases

- **Invalid repository root**: root missing, not a directory, or unreadable →
  discovery aborts with no file reads and an error naming the failing condition.
- **Sandbox escape**: a discovered or addressed path resolves outside the canonical
  repository root → the path is excluded/refused, reported, and discovery continues
  for the remaining files.
- **Duplicate identities in one file**: two tasks share a local task ID or the same
  issue reference → a warning identifies the shared value and every line number.
- **Ambiguous matching**: a high-confidence match whose margin to the next candidate
  is below the configured minimum → downgraded to medium with a recorded ambiguity
  reason; multiple optimal assignments → deterministic tie-break so re-runs are
  identical.
- **Cross-container candidates**: a non-durable candidate whose team, project, or
  framework differs from the task's → excluded from selection entirely.
- **Formatting-only drift**: round-trip formatting differences between the mirrored
  description and the task section are never treated as conflicts and never cause
  repeated rewrites (per the constitution's conflict-free-sync rule).
- **History volume**: a history page reaching its configured entry/size threshold →
  rollover to the next continuation attachment page with no entry lost.
- **Interrupted background drain**: a claim older than the configured abandoned-claim
  threshold is reclaimed before a new claim; queue-lock timeout ends the drain without
  touching the pending job.
- **Unrecognized hook names**: the managed git-hook set contains a name that is not a
  valid client-side git hook → installation aborts before writing any hook and
  reports every bad name.
- **Unknown or missing configuration**: the config file path is set but missing,
  unreadable, or invalid → configuration loading aborts with the failure category;
  a required workspace identity is absent → initialization aborts naming each
  missing value.

## Requirements *(mandatory)*

### Functional Requirements

Groups cite their source requirement numbers from `specs/requirements.md`.
Requirement-level governance (safety gates, durable identity design, defaults/
override model, determinism, one-engine routing, credential handling, resilience,
locking posture, encryption envelope) is stated in the constitution and is not
restated here; FRs below depend on those principles rather than re-authoring them.

#### A. Repository task discovery (source R1)

- **FR-001**: System MUST canonicalize a supplied repository root to an absolute,
  link-resolved path and recursively locate every regular file whose name matches
  the configured task-file patterns, to unlimited depth.
- **FR-002**: System MUST abort discovery with no file reads and a specific error
  when the root does not exist, is not a directory, or is not readable.
- **FR-003**: System MUST skip configured skip-directories, MUST NOT traverse or
  report symlinked directories or files, and MUST verify before every file read that
  the resolved path is inside the canonical root, refusing and reporting escapes.
- **FR-004**: System MUST return results as root-relative POSIX paths in a
  deterministic lexicographic order, and MUST return an empty (not error) result
  when no task files exist.
- **FR-005**: System MUST associate each discovered file with a framework identity
  (per group D) and locate configured sibling specification documents in the same
  directory, omitting absent siblings without error.
- **FR-006**: System MUST report available version-control context (HEAD commit
  identifier, current branch, origin remote URL), individually omitting unavailable
  values without failing.

#### B. Task parsing and in-place rendering (source R2, R3)

- **FR-007**: System MUST extract heading tasks (lines whose text matches the
  configured task-heading grammar) and checklist tasks (checkbox lines), treating
  fenced code-block interiors as non-task text, and record 1-based line numbers.
- **FR-008**: System MUST normalize checkbox indentation (tabs mapped to the
  configured tab width) and establish parent/child nesting via an indent stack,
  attaching orphans to the enclosing heading task.
- **FR-009**: System MUST track the current phase as the most recent heading matching
  the configured phase pattern.
- **FR-010**: System MUST exclude summary-section items and rollup checklist items
  from task extraction per configured patterns, recording each excluded item with
  its line number and an exclusion reason.
- **FR-011**: System MUST treat top-level checkboxes in flat documents (those without
  grammar-matching headings, or matching configured flat markers) as valid tasks.
- **FR-012**: System MUST parse a visible issue reference of the configured
  `[<KEY>-<N>]` form and a leading local task identifier when the configured grammar
  matches, recording both on the task.
- **FR-013**: System MUST warn, identifying the shared value and all 1-based line
  numbers, when tasks within one file share a local task ID or share an issue
  reference.
- **FR-014**: System MUST derive the file's `Feature_Name` using the active framework
  adapter, recording none when none can be derived.
- **FR-015**: System MUST flag any task whose section contains conflict markers as
  carrying an unresolved conflict block, and downstream reconciliation MUST skip such
  tasks (see group F).
- **FR-016**: System MUST record each task's `Task_Body` extent as the task line plus
  all content beneath it up to the next task or next equal-or-shallower heading,
  including nested checklist children.
- **FR-017**: When rewriting an assigned task line, System MUST emit the configured
  issue-reference prefix followed by the desired title, preserving original
  indentation, heading level, and a present local task ID unless configured
  otherwise; titles are cleaned of configured strip prefixes, redundant issue
  prefixes, and duplicate leading local-ID prefixes; checkbox state is set from the
  assignment or retained when none is provided.
- **FR-018**: System MUST rewrite assigned lines bottom-to-top, reproduce the
  original trailing-newline style exactly, leave unassigned lines byte-identical,
  and leave unresolved conflict blocks byte-for-byte untouched.
- **FR-019**: If an assigned line no longer matches its expected heading/checklist
  structure, System MUST halt rendering of that file, leave it unmodified, and return
  an error identifying the file path and line number.

#### C. Path-to-team-and-project routing (source R4)

- **FR-020**: System MUST route each task to both a team and a project using the
  consumer-supplied path-prefix map, selecting the longest matching prefix, and
  breaking equal-length ties deterministically by configured map order with a
  recorded tie-break indication.
- **FR-021**: System MUST fall back to the configured default team and project for
  unmatched paths; when no defaults are configured, System MUST leave the task
  unassigned, produce an indication, and continue processing remaining tasks; an
  absent or empty routing map applies the default path to every task.

#### D. Framework adapters (source R7)

- **FR-022**: System MUST ship built-in adapters for `bmad`, `spec-kit`, `open-spec`,
  `kiro`, and `generic`, each supplying task-file patterns, base directories,
  detection rules, `Feature_Name` extraction, heading/checklist grammar,
  phase/summary/rollup patterns, sibling-document names, default title strip
  prefixes, and optional agent-hook template behavior.
- **FR-023**: Under automatic selection, System MUST infer the framework from path
  and sibling-document markers with deterministic precedence (kiro markers →
  open-spec markers → spec-kit markers → bmad markers → generic fallback), and when
  multiple adapters match, MUST select by longest matching path/base-directory
  pattern, then configured precedence, then alphabetical tie-break.
- **FR-024**: System MUST record the framework identity and framework metadata on
  every discovered task and persist them in the synced state payload.
- **FR-025**: System MUST apply no framework-specific exclusions beyond the global
  summary/rollup defaults when the generic adapter is selected, and MUST preserve
  Kiro compatibility (`.kiro/specs/*/tasks.md` discovery, feature directory as
  `Feature_Name`, `.kiro/hooks/` scaffold support).
- **FR-026**: Consumers MUST be able to override framework selection, adapter
  precedence, and every adapter convention above, and to supply a custom adapter
  configuration providing at least an id, path/base-directory patterns, and heading
  grammar.

#### E. Matching, confidence, and title derivation (source R5, R6)

- **FR-027**: System MUST score each task against each candidate issue as an
  unbounded weighted integer sum over configurable signals: durable identity match,
  existing issue reference, local task ID match, exact normalized title, contained
  normalized title, fuzzy title similarity (scaled token overlap), same-project
  alignment, and same-framework alignment.
- **FR-028**: System MUST assign exactly one confidence band per match from
  {high, medium, low, unmatched} from the configured floor thresholds, restricting
  selectable candidates to at least the plausible-match floor.
- **FR-029**: System MUST exclude non-durable candidates whose team, project, or
  (when both known) framework differ from the task's.
- **FR-030**: System MUST solve a maximum-weight one-to-one assignment (each task at
  most one issue, each issue at most one task), selecting deterministically among
  equally optimal solutions so unchanged inputs reproduce matches byte-for-byte.
- **FR-031**: System MUST downgrade a high-confidence non-durable match to medium,
  with a recorded ambiguity reason, when its margin to the next usable candidate is
  below the configured minimum.
- **FR-032**: System MUST retain up to three alternative candidates per match,
  ordered by descending score with deterministic tie-breaks, each annotated mapped
  or unmapped.
- **FR-033**: System MUST derive issue titles by evaluating configured ordered rules
  (first match wins; template placeholders substituted from task attributes;
  unresolved placeholders replaced with empty strings plus an indicator), falling
  back to the built-in pass-through default when no rule matches or none are
  configured.
- **FR-034**: System MUST decorate every derived title for a task with a
  `Feature_Name` by prepending `<Feature_Name>: ` exactly once — before consumer
  rules, unmatched rules, or the pass-through default alike — producing an identical
  final title on repeated derivations, and MUST strip that same prefix (plus
  configured strip prefixes, redundant issue prefixes, and duplicate local-ID
  prefixes) when the title is rendered back into Markdown so titles never
  progressively prefix across runs.
- **FR-035**: System MUST leave a task without a `Feature_Name` unprefixed.

#### F. Sync modes, conflict resolution, and completion states (source R9)

- **FR-036**: System MUST select bootstrap mode when no checkpoint exists and sync
  mode when one exists, each mode using its own independently configured
  conflict-action map.
- **FR-037**: In sync mode, System MUST classify each matched task's description
  conflict as `linear-changed`, `spec-changed`, or `both-changed` by comparing
  change since the checkpoint on each side; in bootstrap mode, System MUST treat
  any meaningful difference as `both-changed` and identical-after-normalization
  content as no conflict.
- **FR-038**: System MUST apply the mapped resolution action to the whole
  tool-managed issue description only — never to the synced state payload — and MUST
  support the six actions with these effects: `overwrite-linear` (push task section
  to the issue), `overwrite-spec` (write tracker content into the task's section as
  a git-style conflict-marker block, leaving the issue unchanged and pushing
  nothing), `report-only` (no changes, surfaced as a conflict), `skip` (no changes,
  recorded internally only), `prefer-newer` (newer side wins via the
  overwrite-linear/overwrite-spec effects; report-only when recency is
  indeterminable), and `fail` (abort before any further mutation and report).
- **FR-039**: System MUST provide overridable built-in default action maps:
  bootstrap mode — all three conflict types resolve to `overwrite-linear`; sync
  mode — `spec-changed` → `overwrite-linear`, `linear-changed` → `overwrite-spec`,
  `both-changed` → `report-only`.
- **FR-040**: System MUST report every reason for an applied action identifying the
  conflict type and the action taken.
- **FR-041**: When a checklist task's checked state changed in the repository since
  the checkpoint and its issue is otherwise unchanged, System MUST set the issue's
  desired workflow state to the configured done state (when checked) or backlog
  state (when unchecked), independently of the description conflict machinery.
- **FR-042**: System MUST treat an unresolved conflict block as frozen: no change to
  the task's section or the issue description, nothing pushed, no additional or
  nested markers, and a surfaced unresolved-conflict report entry, until a human
  removes the markers.

#### G. Issue-tracker integration surface (source R8)

- **FR-043**: System MUST list issues with configured page-size pagination until all
  pages are retrieved, across all configured teams, including only issues that
  belong to a configured team AND one of that team's configured projects AND are not
  in an ignored state type (default: canceled, duplicate), preserving per-team
  scoping.
- **FR-044**: System MUST discover, per configured team, the team key, its projects,
  and its workflow states, returning all three collections per team.
- **FR-045**: System MUST provide operations to get an issue by identifier, create
  an issue, update an issue, and archive an issue.
- **FR-046**: System MUST locate an issue by a task's durable identity **only** via
  the tool attachment metadata (query by the task's deterministic attachment URL or
  scan the issue's attachments) and MUST NOT search issue descriptions for identity.
- **FR-047**: System MUST provide attachment operations to create-or-update the
  canonical attachment by its deterministic URL (updating in place rather than
  duplicating, without storing the attachment identifier), update an attachment,
  query attachments for a given URL, and list an issue's attachments with
  cursor-based pagination.
- **FR-048**: System MUST provide attachment operations for continuation (history)
  pages addressed by their deterministic paged URLs and MUST enumerate a task's
  attachment chain by walking page indices upward until no further page exists;
  identity matching keys solely off the page-0 canonical attachment.

#### H. Sync-state persistence and sync history (source R9 criteria 17–20)

- **FR-049**: On every applied run for a matched task, System MUST write the
  non-history sync-state payload (durable identity, framework metadata, mirrored
  content hash, cursors/timestamps) into the page-0 canonical attachment as
  tool-owned state, rewriting it authoritatively each apply after screening.
- **FR-050**: System MUST append exactly one screened, human-readable, timestamped
  history event to the task's append-only history per sync-affecting action (create,
  match, title update, description update, checkbox/workflow change, conflict
  detection, rollback), and MUST record a rollback by appending a `rollback` event
  referencing the reversed actions rather than removing or editing any earlier entry.
- **FR-051**: System MUST roll appended history over to the next deterministic
  continuation attachment page when the configured per-page entry threshold or a
  practical metadata size limit would be exceeded, preserving every prior entry.

#### I. Run-state specifics (source R11)

- **FR-052**: System MUST place run state in a consumer-configured directory, or by
  default in a per-repository directory beneath the platform's application-state
  location, named by a hash of the canonical repository root path.
- **FR-053**: System MUST treat a stored audit manifest as expired when its age
  exceeds the configured expiry duration (default 30 days), regardless of whether
  manifest encryption is enabled.
- **FR-054**: System MUST take over a stale run lock only when the recorded process
  is no longer alive **and** the lock's age exceeds the configured stale-takeover
  threshold (default 60 seconds).
- **FR-055**: System MUST persist a create-intent record with its lifecycle status
  before performing an issue-creation attempt.
- **FR-056**: System MUST write sanitized JSON and Markdown run reports (no secret
  or key material) after a run that produces a report, and update the last-run
  marker to reference the completed run.

#### J. Plan, apply, and rollback engine specifics (source R12)

- **FR-057**: System MUST create issues parent-before-child, emitting sibling issues
  within the same parent in reverse of their working order.
- **FR-058**: When an issue-creation attempt errors and reconciliation finds the
  count of issues carrying the task's durable identity is not exactly one, System
  MUST record the create as indeterminate, abort further creation for that task, and
  never automatically replay the create.
- **FR-059**: For a journaled run, rollback MUST restore each modified file to its
  before content, restore each updated issue field to its before value, archive each
  issue created during the run, and restore or remove the checkpoint to match its
  prior state.
- **FR-060**: Rollback MUST be resumable: each step guarded so an interrupted
  rollback can resume without repeating completed steps, and a step whose state
  matches neither its before nor its result state MUST be reported as a conflict and
  halted.
- **FR-061**: System MUST include every planned attachment create-or-update (canonical
  and continuation pages) as planned operations, journal each with the target issue,
  addressed URL, and prior attachment metadata where one existed, and rely on URL
  idempotency so repeated or resumed applies never duplicate attachments.
- **FR-062**: Rollback MUST preserve the sync history and the durable identity:
  attachment history is never rewound, continuation pages and prior events are never
  removed, and a page-0 canonical attachment created during the run is retained;
  the non-history managed state MAY be adjusted to mirror the restored issue state.

#### K. Queue and background worker (source R13)

- **FR-063**: System MUST write a single pending job within 500 ms of an enqueue when
  none is pending, merge subsequent enqueues into the existing pending job, spawn a
  detached worker within 500 ms of enqueue, and schedule a delayed fallback worker
  after the configured worker-delay interval (valid range 1–3600 s, default 75 s).
- **FR-064**: System MUST acquire the queue lock before reading or modifying the
  pending job; if the lock cannot be acquired within the configured timeout (1–300 s,
  default 30 s), the drain attempt MUST end without modifying the pending job and a
  sanitized lock-failure report MUST be recorded.
- **FR-065**: While holding the queue lock, System MUST reclaim claims older than the
  configured abandoned-claim threshold (1–3600 s, default 300 s) before claiming the
  pending job atomically so only one worker can hold the claim.
- **FR-066**: System MUST apply a claimed job in the mode it specifies; on failure,
  rewrite the pending job for retry with an incremented count and a sanitized
  failure report; when the configured retry maximum (1–100, default 5) is reached,
  stop rewriting for retry and record the retry-limit report.
- **FR-067**: On queued-run completion, System MUST update a durable last-run marker
  with outcome and completion timestamp, write the outcome to standard error when
  attached to a terminal, and attempt a best-effort platform notification —
  continuing without error when notification is undeliverable or suppressed by
  configuration.

#### L. Git-hook and agent-hook triggers (source R14, R19)

- **FR-068**: System MUST install its managed, marker-bounded hook block into each
  git hook event in the configured managed set (default `pre-push`, `post-merge`) at
  the configured or repository-default hooks directory, preserving all content
  outside its markers byte-for-byte and appending the block when no marker pair
  exists; unrecognized hook names MUST abort installation before any write and
  report every bad name.
- **FR-069**: When a managed hook fires, System MUST print the previous recorded
  run's outcome to standard error, enqueue via the shell-invocable enqueue entry
  point under the configurable script prefix, and exit with status zero — including
  when the credential environment variables are absent (warning emitted, enqueue
  still performed) and when the enqueue itself fails (error emitted).
- **FR-070**: System MUST expose a stable, shell-invocable enqueue entry point that
  performs the deduplicated non-blocking enqueue and exits zero, usable by git
  hooks, agent hooks, CI steps, or manual invocation.
- **FR-071**: On agent-hook installation, System MUST scaffold a valid hook
  definition invoking the enqueue entry point for a default post-file-save event
  matched against the configured task-file patterns, writing it under the
  framework-specific default directory (`.kiro/hooks/` for Kiro,
  `.task-linear-sync/hooks/` for generic) or its configured override, performing no
  tracker mutation or network call, and never overwriting an existing target file
  (writing a non-conflicting name or refusing with a conflict report instead).

#### M. Operator command surface (source R15)

- **FR-072**: System MUST provide the twelve commands — inventory,
  discover-metadata, plan, bootstrap, sync, check, install-hooks,
  install-agent-hook, enqueue, worker, last-run, rollback — each returning exit
  status zero on success and non-zero on refusal, abort, or failure.
- **FR-073**: System MUST reject an attempt to combine the plan command with an
  apply flag, performing nothing and returning non-zero with an error identifying
  the disallowed flag.
- **FR-074**: System MUST complete the agent-hook install command with no
  issue-tracker network call at all, writing only the local template file.
- **FR-075**: System MUST refuse the rollback command with a non-zero exit and a
  clear indication when run journaling is disabled or no journal exists for the
  target run, performing no mutation or write.

#### N. Plan review report (source R16)

- **FR-076**: System MUST generate the plan review report as one JSON and one
  Markdown artifact with zero writes/updates/deletes against task sources, the
  tracker, or persisted state, aborting with a read-only violation error if any such
  operation is attempted.
- **FR-077**: Each report task entry MUST include: decision, framework identifier,
  feature name, task file path, confidence, numeric score, numeric margin, reasons,
  up to three alternatives, changed fields, description content hash, expected
  Markdown changes, and low-confidence gate status (passed/failed).
- **FR-078**: System MUST group task entries by project then milestone, list
  unmapped issues in a separate section, mark a parent mapped when any descendant
  is mapped, and surface every unresolved-conflict task as awaiting human marker
  resolution in both artifacts.
- **FR-079**: System MUST include a security-assertions block enumerating each
  read-only and content-exclusion guarantee as a discrete pass/fail assertion; MUST
  exclude raw task bodies and raw issue descriptions from both artifacts, using
  content hashes instead; and MUST identify entities by human-readable names in
  Markdown and durable identifiers in JSON.

#### O. Configuration validation specifics (source R17)

- **FR-080**: System MUST accept configuration from built-in defaults, a JSON
  configuration file, and programmatic overrides (merge semantics governed by the
  constitution), and MUST abort configuration loading with the file path and failure
  category when a configured file is missing, unreadable, or syntactically invalid,
  applying no partial configuration from it.
- **FR-081**: System MUST abort initialization with an error naming each missing
  required workspace identity when any consumer-required value (teams, per-team
  projects, per-team workflow states, routing entries, default team/project) is
  absent or empty after merging all sources.

#### P. Sync-history web component (source R20–R24)

- **FR-082**: The web component MUST serve routes matching the same configured URL
  template the sync engine records on attachments (`<base-host>/<toolId>/<task-uuid>`),
  deriving host, tool segment, and template solely from that configuration, parsing
  each request path against the template to extract the tool segment and task UUID.
- **FR-083**: The web component MUST respond with a not-found status and no history
  data when the path mismatches the template, the tool segment mismatches the
  configured tool identity, the task identifier is not a well-formed UUID, or no
  canonical attachment carries that identity.
- **FR-084**: The web component MUST resolve history live per request by reading the
  state payload from the canonical attachment's metadata via the tracker and walking
  the deterministic continuation pages upward until none remain, concatenating pages
  in ascending order, and presenting every event chronologically with a
  human-readable timestamp and description (rollback events rendered like any other).
- **FR-085**: The web component MUST NOT read the local audit manifest, state
  directory, or checkpoints, MUST NOT require the manifest encryption key, and MUST
  NOT maintain a separate authoritative history datastore (an optional
  non-authoritative cache only).
- **FR-086**: The web component MUST deliver near-realtime updates with a tiered
  transport that prefers push-based streaming where the host supports long-lived
  responses and MUST always offer periodic refresh as a fallback (configurable
  interval, default 15 s, range 1–3600 s), refreshing server-side on that cadence.
- **FR-087**: Where server-side caching is enabled, the web component MUST serve the
  cached reconstructed history for a task identifier until the configured TTL
  (default 10 s, range 0–3600 s; 0 disables) elapses, then re-read the attachment
  chain; caching, filesystem writes, databases, and long-lived in-process state MUST
  all be optional so the component runs on serverless, edge, and shared-host
  environments.
- **FR-088**: The web component MUST respect tracker rate limits using the
  constitution-mandated resilience behavior and MUST respond with an error that
  names no credential and reveals no history data when the tracker read ultimately
  fails.
- **FR-089**: The web component MUST default to private access (valid token or
  session required; missing/invalid credentials yield unauthorized/forbidden with no
  history data) with public read-by-URL access as an explicit opt-in, reading the
  access token server-side only, and MUST expose to browsers only security-screened,
  human-readable history data (re-screening rendered values per the constitution's
  screening mandate).

#### Q. AI-agent tool interface (source R25)

- **FR-090**: System MUST expose read-only agent tools mirroring existing read-only
  commands: `task_sync_plan` (plan with match confidence, mirroring the plan command
  and review report), `task_sync_status` (current status and last-run information),
  and `task_sync_inventory` (discovered task inventory) — each completing with zero
  tracker mutations and zero repository writes.
- **FR-091**: System MUST NOT register or advertise the mutating `task_sync_apply`
  tool unless the consumer enables mutating tools (default disabled), and MUST refuse
  invocations with no state changes and a clear error while disabled.
- **FR-092**: When enabled, `task_sync_apply` MUST accept a request only with the
  constitution-mandated gates satisfied — exact confirmation value,
  accept-low-confidence argument when any match is below high, and a fresh, valid,
  previously-produced plan reference (unknown or drifted references refused with no
  state changes) — and MUST then run the same engine apply path as the CLI.
- **FR-093**: The agent interface MUST default to a stdio transport and MUST support
  an optional networked transport in which credentials and the interface's auth
  token stay server-side and a valid token is required before serving any tool call.
- **FR-094**: The agent interface MUST return tool outputs consistent with the
  review-report posture — screened content, content hashes instead of raw bodies and
  descriptions, and errors that name no credential or token value.

#### R. CI/CD enforcement layer (source R26)

- **FR-095**: System MUST distribute a CI enforcement integration that wraps the
  published read-only check/plan commands and consumes the sanitized plan report
  JSON as its sole machine-readable input, performing zero tracker mutations, zero
  repository writes, and offering no apply or mutate mode.
- **FR-096**: The enforcement layer MUST expose three independently configurable,
  independently toggleable failure conditions, each enabled by default:
  (a) unmapped high-confidence tasks exceeding a threshold (default 0);
  (b) unresolved conflict blocks on runs targeting a protected branch (default the
  pull-request base branch); (c) spec-vs-tracker drift — matched tasks classified
  `spec-changed`/`both-changed` or with pending changed fields or expected Markdown
  changes — exceeding a threshold (default 0). Disabled conditions NEVER fail the
  build.
- **FR-097**: The enforcement layer MUST pass with a success status when no enabled
  condition triggers, and MUST fail the step with a non-zero status and a
  human-readable summary identifying each failed condition and its offending count
  otherwise, emitting only screened summaries that exclude raw bodies and
  descriptions in favor of hashes and human-readable names.

### Constitution-Covered Aspects (Excluded from This Spec)

The following are represented in `.specify/memory/constitution.md` and are
intentionally **not** re-authored as FRs; where an FR above depends on one, the
constitution governs:

| Aspect | Constitution location | Source requirement(s) |
|---|---|---|
| Read-only surfaces perform zero mutations; mutation gates (apply flag + confirmation key, accept-low-confidence, fresh plan reference); screening of all propagated content; out-of-repo owner-only state; journaled encrypted runs; rollback refuses unjournaled | Principle I (Safety First) | R10, R11, R12, R15 (gates), R25, R26 |
| Deterministic `Stable_UUID` from stable positional seed; identity anchor in the page-0 canonical attachment, never in descriptions or in-file markers; durable matches bypass gating/margin downgrade; duplicate-UUID issues abort the run | Principle II (Durable Identity) | R2 (c11/c12 signal source), R5 (c3/c9/c11), R8 (c5), R9 (c17), R12 |
| Defaults for every defaultable value; universal overridability; deep-merge precedence; only workspace-tied values required; zero organization-specific literals in distributed artifacts | Principle III (Intelligent Defaults) | R4 (c6), R6 (defaults), R7 (c8), R17, R18 (c7–c8), R20 (c5), R24 (c6), R25 (c16), R26 (c14) |
| Byte-identical repeated runs; deterministic tie-breaks; attachment upserts never duplicate; plan stability guards and re-fetch-before-mutation; append-only history and rollback-as-appended-event | Principle IV (Determinism & Idempotency) | R1 (c6), R2 (c11), R3, R5 (c7), R9 (c21–c22), R12 (c2–c4, c11), R28 (c5) |
| All surfaces route through one engine and enforce identical guarantees; additive surfaces; CI layer wraps the published CLI; all tracker access through the injectable port | Principle V (One Engine, Additive Surfaces) | R8 (c1), R15, R20–R26 |
| Test pyramid, property-based/contract/security test types, hermetic deterministic tests, coverage gates | Principle VI (Test-First) | R28 |
| Credential sourcing from configured environment variables with pre-flight naming diagnostics; no credential values in any output; server-side-only web/network-transport credentials | Additional Constraints (credential handling) | R8 (c12–c14), R23 (c5), R24 (c1–c3), R25 (c12–c13, c15) |
| Retry with exponential backoff, jitter, and `Retry-After` for non-create requests; creates never automatically retried | Additional Constraints (resilience) | R8 (c9–c11), R22 (c6) |
| Advisory locking with pid/timestamp and live-process rule; AES-256-GCM versioned envelope, key separation, tamper rejection | Additional Constraints (locking & integrity) | R11 (c5–c12, c14–c15) |
| Package/technology stack constraints (standalone library, runtime floor, dependency limits, entry points) | Additional Constraints (technology stack) | R18 |
| Formatting-only differences never trigger conflicts, marker writes, or repeated rewrites | Development Workflow (conflict-free sync) | R9 (c21–c22) |
| Documentation coverage across all surfaces with placeholder-only examples and same-change updates | Development Workflow (documentation duty) | R27 |
| Project build/test/release automation, hermetic pipelines, distributed-defaults release scan, locked-manifest installs | Development Workflow (merge-blocking, hermetic pipelines, release gates) | R29 |

### Conformance Note

Every functional requirement above remains subject to the constitution; per its
Governance section, where a requirement here conflicts with a principle, the
constitution governs and the requirement must be corrected or amended.

### Key Entities

- **Task**: Actionable unit extracted from a task file — heading or checklist kind —
  with a stable identity, line position, nesting, phase, local task ID, visible
  issue reference, `Feature_Name`, task section (`Task_Body`) extent, confidence of
  any match, and unresolved-conflict state.
- **Task File**: Repository Markdown file matching configured name patterns,
  associated with a framework identity and sibling specification documents.
- **Framework Adapter**: Per-framework convention bundle (patterns, grammars,
  extraction rules, defaults) governing discovery, parsing, rendering, and naming.
- **Routing Entry**: Path-prefix → `{team, project}` pair, plus default team and
  default project, deciding each task's destination.
- **Match**: One-to-one task↔issue assignment with score, margin, confidence band,
  reasons, and up to three ranked alternatives.
- **Checkpoint**: Per-task local record of last-known checkbox state, title, issue
  update time, issue state, and mirrored-description content hash; basis for change
  classification and mode selection.
- **Conflict Resolution Map**: Per-mode mapping from conflict type
  (`linear-changed` / `spec-changed` / `both-changed`) to a resolution action.
- **Sync State Payload**: Machine-readable state persisted on the issue's tool
  attachment: durable identity, framework metadata, content hash, cursors/timestamps,
  and the sync history log.
- **Attachment Chain**: Canonical (page-0) attachment serving as the sole identity
  anchor, plus ordered continuation pages extending the append-only history.
- **Sync History Event**: Immutable, screened, timestamped record of one sync-affecting
  action, including rollback events that reference the actions they reverse.
- **Plan**: Read-only, guarded proposal of all intended operations with per-task
  decisions, used by review, apply, CI enforcement, and agent tools alike.
- **Audit Manifest**: Optional journaled record of an applied run enabling resumable
  rollback; carries before-state backups and one record per operation.
- **Create Intent**: Lifecycle record for a single issue-creation attempt, enabling
  indeterminate-outcome reconciliation.
- **Pending Job / Last-Run Marker**: The single deduplicated queued sync request and
  the durable record of the most recent completed run's outcome and time.
- **Hook Definition / Hook Block**: Scaffolded agent-hook file and the marker-bounded
  managed region installed into git hook scripts.
- **Plan Report Artifacts**: Paired JSON (durable identifiers) and Markdown
  (human-readable names) sanitized review documents.
- **Sync-History Page**: Public/private web view of one task's complete chronological
  history, addressed by the recorded attachment URL scheme.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the tool twice in a row over an unchanged repository and
  unchanged tracker reports zero pending changes on the second run (converged
  sync), with repeated read-only runs producing byte-for-byte identical output.
- **SC-002**: 100% of tasks discovered in a fixture repository containing all five
  supported framework layouts are extracted with correct kind, nesting, line
  numbers, section extent, and derived feature name.
- **SC-003**: In a 100-task fixture with renames, moves, and checkbox flips, ≥95%
  of tasks retain their correct issue pairing across re-runs, and 100% of
  durable-identity pairs survive title or container changes without orphaning.
- **SC-004**: Across a full apply-and-plan round trip over formatting-only tracker
  round-trip noise, zero conflicts are raised and zero description rewrites occur.
- **SC-005**: A reviewer can approve any plan using the report alone: 0 raw task
  bodies or issue descriptions appear in either report artifact, while every task
  entry carries the complete required field set.
- **SC-006**: 0 secrets or personal-identifier values appear in any propagated
  description, attachment payload, history event, report, log, web response, or
  agent-tool output in the screening test corpus.
- **SC-007**: Developers experience no blocked git operations from the managed
  hooks: 100% of hook invocations exit successfully, and enqueue completes within
  500 ms of the trigger.
- **SC-008**: A rollback of any journaled run restores every modified file, issue
  field, and checkpoint to its prior state and archives every issue created by that
  run, with 0 sync-history events lost or altered.
- **SC-009**: First-run configuration burden is bounded to workspace-tied values
  only: a consumer with a supported framework layout can go from install to a
  reviewed plan supplying nothing but team, project, and workflow-state identities.
- **SC-010**: A sync-history page displays the complete event history for tasks
  whose history spans up to 10 attachment pages, with events in exact chronological
  order and every page-1000th event present exactly once.
- **SC-011**: With the CI enforcement layer's three conditions at defaults, it fails
  exactly the builds that exhibit the configured violation (0 false negatives) and
  passes all clean-sync builds (0 false positives) in the enforcement fixture set.
- **SC-012**: No state-mutating operation ever executes without passing the required
  gates: 0 mutations occur in any test exercising refusal paths (missing flag, wrong
  confirmation, low-confidence match, stale or missing plan reference, disabled
  mutating tools).

## Assumptions

- This specification **extracts and reorganizes** functional content from
  `specs/requirements.md`; it introduces no new capability. Numeric defaults,
  grammars, and thresholds quoted from the source remain authoritative there and
  all remain overridable per the constitution.
- The constitution (v1.0.0) remains the governing source for principles; items in
  the exclusion table are validated against the constitution, not re-specified here.
- The issue tracker is Linear (per the source document); FRs phrase it generically
  where the behavior is tracker-agnostic, but attachment-metadata identity,
  URL-idempotent attachments, workflow state types, and pagination follow Linear
  capabilities as specified in the source.
- Terminology (`Task_Body`, `Stable_UUID`, `Sync_Attachment`, `Checkpoint`,
  `Conflict_Action`, `Framework_Adapter`, `ProjectByPath`, etc.) is defined by the
  glossary of `specs/requirements.md` and used here unchanged.
- Single-user local CLI operation is the primary interaction model; the web
  component, agent interface, and CI layer serve additional reader/operator/agent
  audiences as described in the user stories.
- Where the source document left illustrative placeholders (e.g., example title-rule
  presets), those remain non-normative examples, not requirements.
- No clarification markers were required: the source document is explicit to
  criterion level for every extracted behavior.
