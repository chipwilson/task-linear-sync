# Feature Specification: Operator CLI and Plan Review Report

**Feature Branch**: `009-operator-cli-plan-report`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group M (Operator command surface, source R15) and group N (Plan review report, source R16).

## Purpose and Scope

The human-facing control plane: the twelve operator commands with a strict exit-status
contract, and the sanitized plan review report (paired JSON + Markdown) that lets a
reviewer approve any plan without ever seeing a raw task body or issue description.
Wave-4 feature; realizes the review half of 001's User Story 4.

**Owns**: command set and exit statuses; plan+apply flag rejection; zero-network
agent-hook install; rollback refusal on unjournaled runs; the full report field set,
grouping rules, unmapped section, security-assertions block, and content-exclusion
guarantees.

**Consumes from 002**: gate vocabulary, run reports/last-run marker. **Consumes from
008**: the one engine (every command routes through it — constitution Principle V).

**Provides to**: 013 (the published check/plan commands and the report JSON are its
sole input), 012 (agent tools mirror these command semantics), humans (approval gate).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Predictable command surface (Priority: P1)

An operator runs `inventory`, `discover-metadata`, `plan`, `bootstrap`, `sync`, `check`,
`install-hooks`, `install-agent-hook`, `enqueue`, `worker`, `last-run`, `rollback`;
each exits zero on success and non-zero on refusal/abort/failure, dangerous flag
combinations are refused before doing anything, and agent-hook install performs no
network call at all.

**Why this priority**: The CLI is how every other feature is actually operated and how
CI (013) and scripts invoke the tool; the exit-status contract is a machine interface.

**Independent Test**: Drive all twelve commands against the hermetic fixture workspace;
assert exit codes for success/refusal/abort paths, the plan+apply-flag rejection naming
the disallowed flag, zero network calls during `install-agent-hook`, and `rollback`
refusal (non-zero, no mutation) when journaling is off or the journal is absent.

**Acceptance Scenarios**:

1. **Given** a configured workspace, **When** each of the twelve commands completes
   successfully, **Then** it exits zero; refusals, aborts, and failures exit non-zero.
2. **Given** `plan` combined with an apply flag, **When** the CLI parses, **Then** it
   performs nothing and returns non-zero with an error identifying the disallowed flag.
3. **Given** the agent-hook install command, **When** it runs, **Then** it completes
   with no issue-tracker network call at all, writing only the local template file.
4. **Given** run journaling disabled or no journal for the target run, **When**
   `rollback` runs, **Then** it refuses with non-zero exit and a clear indication,
   performing no mutation or write.

### User Story 2 - Approvable plan review report (Priority: P2)

A reviewer inspects one JSON and one Markdown artifact carrying every decision,
confidence, score, margin, reason, alternative, expected change, and unmapped issue —
with content hashes instead of bodies — grouped by project then milestone, plus a
security-assertions block that proves the read-only and exclusion guarantees.

**Why this priority**: Adoption at team scale depends on safe review; the report is the
approval artifact and the CI input.

**Independent Test**: Generate reports against fixtures; assert the complete per-task
field set, grouping and unmapped-parent rules, conflict-task surfacing, the
security-assertions block, and zero raw bodies/descriptions; attempt a mutation inside
report generation and assert the read-only violation error aborts.

**Acceptance Scenarios**:

1. **Given** a built plan, **When** the review report is generated, **Then** a JSON and
   a Markdown artifact are produced with zero mutations, each task entry carrying
   decision, framework, feature, file path, confidence, score, margin, reasons, up to
   three alternatives, changed fields, content hash, expected Markdown changes, and
   low-confidence gate status.
2. **Given** entries grouped by project then milestone, **When** the report renders,
   **Then** unmapped issues appear in a separate section and a parent counts as mapped
   when any descendant is mapped.
3. **Given** any unresolved-conflict task, **When** either artifact renders, **Then** it
   is surfaced as awaiting human marker resolution.
4. **Given** report generation, **When** any write/update/delete against task sources,
   the tracker, or persisted state is attempted, **Then** it aborts with a read-only
   violation error.
5. **Given** both artifacts, **When** content is checked, **Then** raw task bodies and
   raw issue descriptions are absent (content hashes instead), Markdown names entities
   human-readably, and JSON carries durable identifiers.

## Requirements *(mandatory)*

- **FR-001** (001 FR-072): System MUST provide the twelve commands — inventory,
  discover-metadata, plan, bootstrap, sync, check, install-hooks, install-agent-hook,
  enqueue, worker, last-run, rollback — each returning exit status zero on success and
  non-zero on refusal, abort, or failure.
- **FR-002** (001 FR-073): System MUST reject an attempt to combine the plan command
  with an apply flag, performing nothing and returning non-zero with an error
  identifying the disallowed flag.
- **FR-003** (001 FR-074): System MUST complete the agent-hook install command with no
  issue-tracker network call at all, writing only the local template file.
- **FR-004** (001 FR-075): System MUST refuse the rollback command with a non-zero exit
  and a clear indication when run journaling is disabled or no journal exists for the
  target run, performing no mutation or write.
- **FR-005** (001 FR-076): System MUST generate the plan review report as one JSON and
  one Markdown artifact with zero writes/updates/deletes against task sources, the
  tracker, or persisted state, aborting with a read-only violation error if any such
  operation is attempted.
- **FR-006** (001 FR-077): Each report task entry MUST include: decision, framework
  identifier, feature name, task file path, confidence, numeric score, numeric margin,
  reasons, up to three alternatives, changed fields, description content hash, expected
  Markdown changes, and low-confidence gate status (passed/failed).
- **FR-007** (001 FR-078): System MUST group task entries by project then milestone,
  list unmapped issues in a separate section, mark a parent mapped when any descendant
  is mapped, and surface every unresolved-conflict task as awaiting human marker
  resolution in both artifacts.
- **FR-008** (001 FR-079): System MUST include a security-assertions block enumerating
  each read-only and content-exclusion guarantee as a discrete pass/fail assertion; MUST
  exclude raw task bodies and raw issue descriptions from both artifacts, using content
  hashes instead; and MUST identify entities by human-readable names in Markdown and
  durable identifiers in JSON.

### Edge Cases

- **Zero-task plan**: both artifacts still render with empty task sections and a passing
  security-assertions block.
- **Parent with no mapped descendant but mapped sibling**: only actual descendant
  mapping counts toward "parent mapped".
- **Report name collision**: report writing is part of run state (002), never into the
  repository working tree.

## Key Entities

**Plan Report Artifacts** (owned): paired JSON (durable identifiers) and Markdown
(human-readable names) sanitized review documents. **Plan** surfaced per 002's contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-005): A reviewer can approve any plan using the report alone: 0 raw
  task bodies or issue descriptions appear in either report artifact, while every task
  entry carries the complete required field set.
- **SC-002**: All twelve commands exhibit the exit-status contract in 100% of
  success/refusal/failure fixtures.
- **SC-003**: Report generation performs 0 mutations and 0 repository writes across the
  corpus; an injected write attempt aborts generation with a read-only violation error.

## Assumptions

- Commands are thin wrappers over the single engine (constitution Principle V); no
  command implements sync logic of its own.
- The report JSON schema is frozen in the 002 plan-artifact contract; 013 consumes it
  without re-deriving any decision.
- `install-hooks`, `install-agent-hook`, `enqueue`, `worker`, and `last-run` delegate to
  010's behaviors; this spec owns only their command-surface presentation and exit
  semantics.
