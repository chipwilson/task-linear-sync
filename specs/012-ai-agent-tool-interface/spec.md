# Feature Specification: AI-Agent Tool Interface

**Feature Branch**: `012-ai-agent-tool-interface`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group Q (AI-agent tool interface, source R25).

## Purpose and Scope

Lets AI coding agents drive the same sync engine through an embedded tool interface
instead of shelling out: three read-only tools mirror the CLI's inventory, planning, and
status, while a mutating apply tool exists only when explicitly enabled and requires a
fresh, valid plan reference on top of the standard gates. Wave-4 feature; realizes 001's
User Story 6. It duplicates no capability — every tool is the engine behind a different
handle.

**Owns**: tool registration/visibility rules; apply gating including plan-reference
freshness; stdio default and optional networked transport with server-side credentials;
screened output posture.

**Consumes from 002**: gate vocabulary; plan artifact contract; plan-reference stability
guards (input content hashes + VCS HEAD). **Consumes from 008**: the identical engine
apply path the CLI uses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read-only tools, zero side effects (Priority: P1)

An agent connects over stdio with defaults and sees exactly three tools —
`task_sync_plan`, `task_sync_status`, `task_sync_inventory` — each completing with zero
tracker mutations and zero repository writes, returning screened, hash-based output with
no credential values in errors.

**Why this priority**: Safe observability is the whole default surface; an agent must be
able to look without ever being able to touch.

**Independent Test**: Exercise the read-only tools against fixtures and assert zero
mutations/writes; assert output content posture (hashes, not bodies; no credential
names/values); assert tool listing shows exactly three tools at defaults.

**Acceptance Scenarios**:

1. **Given** the tool interface running with defaults, **When** the client lists
   available tools, **Then** only `task_sync_plan`, `task_sync_status`, and
   `task_sync_inventory` are advertised.
2. **Given** any read-only tool call, **When** it completes, **Then** zero tracker
   mutations and zero repository writes occurred, and outputs carry screened content with
   content hashes instead of raw bodies and descriptions.
3. **Given** any tool error, **When** it renders, **Then** it names no credential or
   token value.

### User Story 2 - Gated apply tool (Priority: P2)

The mutating `task_sync_apply` tool is invisible and refused by default; when the
consumer enables mutating tools, apply still requires the exact confirmation value, the
accept-low-confidence argument where any match is below high, and a fresh, valid,
previously-produced plan reference — then runs the identical engine apply path as the
CLI.

**Why this priority**: The one foot-gun surface; its gating is constitution-level, and
the stale-reference rule is unique to the agent path.

**Independent Test**: Attempt apply while disabled, with a wrong confirmation, with a
stale/never-produced plan reference, and with the full gate set satisfied — verifying
refusal (no state changes) and success respectively; assert plan-reference drift detection
when inputs change after planning.

**Acceptance Scenarios**:

1. **Given** mutating tools disabled (default), **When** the client lists tools or
   invokes `task_sync_apply`, **Then** the tool is not advertised and invocation refuses
   with no state changes and a clear error.
2. **Given** mutating tools enabled and a plan produced earlier this session, **When**
   apply is called with the correct confirmation, the accept-low-confidence argument
   where needed, and a fresh plan reference, **Then** the same engine apply runs as for
   the CLI.
3. **Given** a plan reference whose inputs changed or that was never produced, **When**
   apply is called, **Then** it refuses with an unknown/stale-reference error and no
   state changes.

### User Story 3 - Transport options (Priority: P3)

The interface defaults to stdio; an optional networked transport keeps credentials and
the interface's auth token server-side and demands a valid token before serving any tool
call.

**Why this priority**: Transport breadth serves more agent hosts but changes no
guarantee.

**Independent Test**: Boot over each transport; assert pre-auth requests on the
networked transport are refused before any tool call is served, and that no credential
material appears in client-visible surface.

**Acceptance Scenarios**:

1. **Given** default configuration, **When** the interface starts, **Then** stdio is the
   transport.
2. **Given** the optional networked transport, **When** a client without a valid token
   calls any tool, **Then** the call is refused before execution; credentials and the
   auth token remain server-side.

## Requirements *(mandatory)*

- **FR-001** (001 FR-090): System MUST expose read-only agent tools mirroring existing
  read-only commands: `task_sync_plan` (plan with match confidence, mirroring the plan
  command and review report), `task_sync_status` (current status and last-run
  information), and `task_sync_inventory` (discovered task inventory) — each completing
  with zero tracker mutations and zero repository writes.
- **FR-002** (001 FR-091): System MUST NOT register or advertise the mutating
  `task_sync_apply` tool unless the consumer enables mutating tools (default disabled),
  and MUST refuse invocations with no state changes and a clear error while disabled.
- **FR-003** (001 FR-092): When enabled, `task_sync_apply` MUST accept a request only
  with the constitution-mandated gates satisfied — exact confirmation value,
  accept-low-confidence argument when any match is below high, and a fresh, valid,
  previously-produced plan reference (unknown or drifted references refused with no
  state changes) — and MUST then run the same engine apply path as the CLI.
- **FR-004** (001 FR-093): The agent interface MUST default to a stdio transport and
  MUST support an optional networked transport in which credentials and the interface's
  auth token stay server-side and a valid token is required before serving any tool
  call.
- **FR-005** (001 FR-094): The agent interface MUST return tool outputs consistent with
  the review-report posture — screened content, content hashes instead of raw bodies and
  descriptions, and errors that name no credential or token value.

### Edge Cases

- **Session restart**: plan references produced before a restart are unknown references;
  apply refuses.
- **Input drift after planning** (file edited or HEAD moved): stability guards fail →
  stale-reference refusal, no state changes.
- **Networked transport without TLS termination guidance**: token posture unchanged;
  transport choice never weakens gating.

## Key Entities

**Plan** (consumed per 002 contract; plan-reference semantics defined there). Tools
mirror **Plan Report Artifacts** (009) posture without owning that schema.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-012): 0 state-mutating operations execute in any test exercising
  refusal paths (disabled mutating tools, missing flag, wrong confirmation,
  low-confidence match, stale or missing plan reference).
- **SC-002**: Read-only tool exercises record 0 tracker mutations and 0 repository
  writes across the full corpus.
- **SC-003**: With mutating tools disabled, 100% of tool listings omit
  `task_sync_apply`, and 100% of direct invocations refuse without state change.

## Assumptions

- "Earlier this session" for plan references follows the constitution's plan-stability
  rule (content hashes + HEAD), not wall-clock expiry.
- The tool-protocol shape (e.g., MCP) follows the constitution's technology-stack
  constraints; this spec pins the tool set and guarantees, not wire format.
- Screening is the constitution's mandate; tool outputs reuse the same screeners as
  reports (009) and the engine (008).
