# Feature Specification: Default-On Task State Mapping to Linear Default Issue States

**Feature Branch**: `024-default-state-mapping`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "version v0.7.0 added task state mapping for spec-kitty but it defaults to off. Change this to default to on and set the default mapping appropriately for the default set of issue states Linear defines. Check the state mapping logic across all the other SDD frameworks supported and ensure a consistent default setting to on and to the default issue states for Linear. During bootstrap, check that the mapped states are present in the linear team and error out if a mapped state is not present in linear, issuing instructions on how to correct the mapping."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-config state propagation for spec-kitty missions (Priority: P1)

An operator points the tool at a repository whose specs use spec-kitty missions and at their
Linear team, supplying only the team identity — no workflow-state configuration. When a work
package advances through its lanes (claimed, in progress, done), the paired Linear issue moves
with it, landing on Linear's default issue states (Backlog, Todo, In Progress, Done, Canceled).
Today the operator must hand-write a lane-to-state mapping first; without it every lane change
is reported as unmapped and no issue state ever moves.

**Why this priority**: Tracker state that mirrors reality without manual upkeep is the core value
of the sync. The v0.7.0 feature delivered that machinery but hid its value behind an opt-in
default, so a new adopter gets zero state propagation out of the box.

**Independent Test**: Configure only a team key against a team using Linear's default workflow,
with no state-mapping configuration; advance a mission work package's lane; observe the paired
issue's state change accordingly. Delivers value even if nothing else in this feature ships.

**Acceptance Scenarios**:

1. **Given** a spec-kitty mission and a default-workflow Linear team with no mapping configured,
   **When** a work package's lane advances to in_progress, **Then** the paired issue moves to
   "In Progress".
2. **Given** the same zero-configuration setup, **When** a work package's lane advances to done,
   **Then** the paired issue moves to "Done".
3. **Given** the same zero-configuration setup, **When** a lane transition lands on a lane with
   no sensible default counterpart, **Then** the issue state is left untouched and the run
   reports that lane as unmapped.

---

### User Story 2 - Bootstrap refuses states the team does not have, with correction guidance (Priority: P1)

Before any change is made anywhere, bootstrap verifies that every mapped state name — whether
shipped by the new default or set by the operator — actually exists in the corresponding Linear
team's workflow. If it does not (custom workflow, renamed state, typo), bootstrap stops with an
error that names each missing state and its team, lists the states that team does have, and
gives step-by-step instructions to fix the mapping.

**Why this priority**: Default-on mapping is only safe if teams with customized workflows fail
early and actionably instead of silently doing nothing or surfacing surprises mid-run. This is
the safety counterpart to US1 and gates it.

**Independent Test**: Point the tool at a team whose workflow lacks one mapped default (for
example "In Progress" renamed to "WIP"); run bootstrap; expect a clean stop with the described
error content and zero mutations. Valid on its own with any single framework.

**Acceptance Scenarios**:

1. **Given** a configured team whose workflow lacks "Canceled", **When** bootstrap runs,
   **Then** it stops before any tracker or file mutation and the error names the missing state
   and the team.
2. **Given** three mapped names that the team does not have, **When** bootstrap runs, **Then** a
   single error reports all three (grouped per team), lists that team's available states, and
   gives correction steps.
3. **Given** the operator creates the missing state in Linear or edits the mapping, **When**
   bootstrap is re-run, **Then** it succeeds with no other change required.
4. **Given** multiple configured teams where only one has a mismatch, **When** bootstrap runs,
   **Then** the failure still lists every team that passed and every team that failed, and the
   whole run aborts with no partial adoption.

---

### User Story 3 - Consistent defaults across every supported framework (Priority: P2)

The same default-on posture and the same default state names apply to all supported SDD
frameworks. For the checkbox-based frameworks (Kiro, spec-kit, OpenSpec, BMAD, Spec
Superpower, generic), a checked task maps to "Done" and an unchecked task to "Backlog" out of
the box, and the per-team workflow-state identities are pre-populated with Linear's default
state names (Backlog, Todo, In Progress, Done, Canceled where applicable). One shared set of
defaults serves every framework, so the same task state lands on the same Linear state no
matter which framework authored it.

**Why this priority**: Operators who mix frameworks — or migrate between them — must not get
different tracker behavior per framework. Extends US1's mechanism, so it follows rather than
leads.

**Independent Test**: Configure each supported framework's adapter with no state-mapping
configuration against default-workflow teams; check a task in each; observe "Done" every time.
Observe identical outcomes for semantically equal task states across frameworks.

**Acceptance Scenarios**:

1. **Given** a Kiro feature with a checked task and no mapping configured, **When** sync runs
   against a default-workflow team, **Then** the paired issue moves to "Done".
2. **Given** the same feature with the task unchecked, **When** sync runs, **Then** the issue
   state resolves to "Backlog".
3. **Given** two different frameworks expressing the same semantic task state, **When** both
   sync, **Then** both select the identical Linear state from the shared defaults.

---

### User Story 4 - Existing configuration always wins; opting out stays available (Priority: P3)

An operator who already configured state-mapping names keeps exactly the behavior they
configured — defaults only fill gaps. An operator who wants the previous "leave issue state
untouched" behavior can explicitly disable mapping, and the run then behaves exactly as it does
today.

**Why this priority**: Protects existing adopters from a surprising flip in behavior as the
default changes underneath them; essential for a trustworthy default change though not its core
value.

**Independent Test**: Pre-set custom state names and an explicit disable, then run syncs and
compare outcomes against today's behavior; defaults must never override, and explicit disable
must fully restore untouched-state behavior.

**Acceptance Scenarios**:

1. **Given** a team configured with done-state name "Completed", **When** a task is checked and
   syncs, **Then** "Completed" is used and the default "Done" is ignored.
2. **Given** lane mapping explicitly disabled in configuration, **When** lane changes sync,
   **Then** issue states are left untouched and the disable is reported, matching today's
   default behavior.
3. **Given** a partially configured lane map, **When** lane changes sync, **Then** configured
   lanes use the configured names and unconfigured lanes use the defaults, merged
   deterministically.

---

### Edge Cases

- A team's workflow lacks one or more default state names (custom workflow, renamed states) →
  bootstrap aborts with the full per-team report and correction instructions before any
  mutation (US2); re-running after the fix is safe and side-effect-free.
- Two configured teams where only one matches the mapping → bootstrap fails as a whole; the
  report lists every team's pass/fail status so one team's problem never masks another's.
- A state is created or renamed in Linear after bootstrap but before a later run → out of scope
  for re-validation; the existing missing-state conflict finding at plan time still applies.
- A mapped name differs from an available name only by case or spelling → treated as missing
  (exact name matching is unchanged), and the bootstrap error flags the near match as a likely
  typo so operators don't silently configure a wrong state.
- No connection to Linear during bootstrap → availability error distinct from a mapping error,
  after the existing retry policy; nothing is mutated and bootstrap can be retried.
- A mapped value set to blank or whitespace-only, or a mapping entry naming a task state outside
  a framework's vocabulary → rejected as a malformed mapping configuration (as today), before
  any Linear access.
- A team has no workflow states at all → bootstrap fails with a distinct diagnostic rather than
  reporting every mapped name as missing.
- Task states that no framework can express (a lane or checkbox state outside its vocabulary) →
  never mapped by defaults; existing unknown-state reporting is unchanged.
- A default state name happens to exist twice in a team's workflow (duplicate names) → resolved
  by the workflow state's type, preferring the state matching the intended semantic category,
  deterministically.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The task state mapping for spec-kitty MUST be active by default — no mapping
  configuration required — unless the consumer explicitly disables it.
- **FR-002**: The shipped default lane-to-state mapping MUST reference only the default issue
  states Linear defines for a team, using Linear's exact default state names, and MUST define a
  target for every lane whose semantics have a sensible counterpart (for example: planned →
  Backlog; claimed → Todo; in_progress, for_review, in_review, approved → In Progress; done →
  Done; canceled → Canceled).
- **FR-003**: Lanes without a sensible default-workflow counterpart (for example a blocked lane)
  MUST remain unmapped by the defaults, leaving issue state untouched and reporting the lane as
  unmapped, exactly as today.
- **FR-004**: Every supported framework that carries task state (checkbox-based frameworks as
  well as spec-kitty lanes) MUST default to mapping enabled with the same default Linear state
  names: checked → "Done", unchecked → "Backlog", and the per-team backlog/todo/in-progress/done
  workflow-state identities pre-populated with Linear's default state names.
- **FR-005**: All frameworks MUST share one default mapping table; semantically equivalent task
  states MUST map to identical Linear states regardless of framework. A framework's task states
  that the table does not cover MUST never be mapped (no invented names).
- **FR-006**: Every default MUST be overridable through the existing per-team workflow-state
  configuration, merged deterministically so configured entries win and unconfigured entries
  fall back to the defaults; a consumer with a complete custom configuration MUST observe no
  behavior change from this feature.
- **FR-007**: Consumers MUST be able to explicitly disable task state mapping (globally or per
  framework), restoring today's "leave issue state untouched" behavior with clear reporting.
- **FR-008**: During bootstrap, the tool MUST retrieve each configured team's live workflow
  states from Linear and verify that every mapped state name — default or configured — exists in
  that team's workflow; any mismatch MUST abort bootstrap before any tracker or file mutation,
  and the check MUST also confirm the team's workflow exposes the state categories the
  completion posture and ignored-state handling depend on (completed and canceled types).
- **FR-009**: The bootstrap failure MUST report, in one pass and grouped by team, every missing
  mapped state, the states that team actually offers, and step-by-step correction instructions
  (name the configuration entry to edit and the states available to edit it to, and how to
  create or restore the needed state in Linear); near matches to available state names differing
  only by case or spelling MUST be highlighted as likely typos.
- **FR-010**: A bootstrap failure MUST leave no partial configuration or side effects;
  re-running bootstrap after correction MUST succeed with identical inputs.
- **FR-011**: After bootstrap succeeds, later runs MUST continue to handle state drift through
  the existing plan-time conflict reporting; this feature adds no re-validation at each
  mutation.
- **FR-012**: The default mapping MUST contain only Linear's generic, platform-default state
  names — never organization-specific identifiers — and MUST be identical for every consumer;
  documentation and release notes MUST cover the new defaults, the default mapping table, the
  opt-out mechanism, and the bootstrap validation with its correction guidance, in the same
  change.
- **FR-013**: Task state MUST continue to propagate in the existing spec-to-tracker direction
  only — issue states are never mapped back into task state, and mirrored task content is
  unchanged by this feature.

### Key Entities

- **Default State Mapping**: The shared, framework-independent table pairing each supported
  framework task state (spec-kitty lanes; checkbox checked/unchecked) with a Linear default
  issue state name; the single source consulted whenever a consumer leaves mapping
  unconfigured.
- **Task State**: The lifecycle condition a task carries in its source framework — a lane value
  for spec-kitty work packages, a checked/unchecked condition for checkbox-based frameworks.
- **Linear Workflow State**: A state defined in a team's issue workflow, identified to operators
  by its name and categorized by its type (backlog, unstarted, started, completed, canceled,
  duplicate); the target of a mapping.
- **Team Workflow Snapshot**: The set of workflow states a configured Linear team actually
  offers, read during bootstrap; the authority against which mapped names are validated.
- **Bootstrap Validation Result**: The outcome of the existence check — pass, or a structured
  failure listing per team the missing mapped names, the available names, near-match typo
  hints, and correction steps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A consumer who configures only team identities (no state-mapping keys at all) sees
  task state propagate to Linear default states across all 7 supported framework configurations
  with zero additional setup steps.
- **SC-002**: 100% of bootstrap runs against teams whose workflow lacks a mapped state stop
  before any tracker or repository change, and every such stop lists all missing names across
  all configured teams in a single report.
- **SC-003**: 100% of bootstrap failure messages include the affected team, its available
  states, and the exact configuration entry to change, so an operator can correct the mapping
  without consulting source code or opening a support request.
- **SC-004**: Re-running bootstrap after correcting the mapping succeeds without any other
  required change in every scenario tested.
- **SC-005**: Consumers whose configuration already sets every workflow-state identity and lane
  entry show identical sync outcomes before and after this change (zero regressions for
  configured users).
- **SC-006**: For each supported framework, automated coverage demonstrates the default-on
  mapping and the bootstrap existence check exercised end to end (100% of frameworks covered).

## Assumptions

- The "default set of issue states Linear defines" is Linear's standard team workflow: Backlog,
  Todo, In Progress, Done, Canceled. Some teams also ship a "Duplicate" state; it is excluded
  from mapping defaults, and "Triage" (an optional triage state on some teams) likewise —
  completed/canceled-type handling already keys on state type rather than name.
- Name matching stays exact and case-sensitive (today's rule); bootstrap validation only moves
  the discovery of a mismatch earlier and makes it actionable rather than guessing near matches.
- "Bootstrap" covers the tool's first-run/adoption flow that connects to Linear for each
  configured team; the check runs there, while routine later runs keep the existing plan-time
  conflict posture for post-bootstrap drift.
- Lanes with no sensible counterpart in Linear's default workflow (notably blocked, and
  review-approval lanes collapsed onto "In Progress") keep today's unmapped finding; collapsing
  review-adjacent lanes onto "In Progress" is the chosen default because Linear's default
  workflow has no review state, and operators can configure a dedicated review state if the
  team added one.
- Opting out is expressed through the existing per-team workflow-state configuration surface:
  an explicitly disabled mapping disables it; an explicitly set entry overrides the default;
  absence adopts the default.
- This feature intentionally ships defaults for per-team workflow-state identities, which
  Principle III of the constitution currently reserves as consumer-required with no built-in
  default. Because the defaults use only Linear's generic platform-default state names (no
  organization-specific literals), a documented constitution amendment is adopted alongside
  this feature (governance requires explicit, not silent, deviation); the amendment is
  tracked as release-readiness documentation work under FR-012.
- The change ships as a deliberate default-behavior change: release notes must call out that
  consumers who previously relied on "no lanes configured ⇒ no state moves" must now set the
  explicit disable.

## Dependencies

- Linear team workflow discovery (reading a team's live workflow states by name and type) —
  already available and used by inventory and metadata surfaces.
- Existing lane-to-state mapping machinery introduced in v0.7.0 for spec-kitty, and the
  existing per-team workflow-state identity configuration surface shared by all frameworks.
- Existing configuration validation and merge-precedence machinery (built-in defaults, then
  configuration file, then programmatic overrides).
- Existing first-run/bootstrap flow and operator-facing error reporting of the CLI and
  programmatic API surfaces.
- Constitution amendment covering the new built-in workflow-state-name defaults (see
  Assumptions).
