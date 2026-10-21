# Feature Specification: Path Routing and Title Derivation

**Feature Branch**: `005-routing-title-derivation`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group C (Path-to-team-and-project routing, source R4) and the title-derivation portion of group E (001 FR-033–FR-035, source R6).

## Purpose and Scope

Two small, pure, rule-driven decisions made together because they are the same kind of
thing — deterministic consumer-rule evaluation over task attributes — and together they
form an independently testable Wave-2 feature with zero dependencies beyond 002:
(a) which team and project each task belongs to, and (b) what its issue title is,
including the idempotent `Feature_Name` decoration that must never compound across runs.

**Owns**: longest-prefix routing with defaults and unassigned handling; ordered
first-match-wins title rules with template substitution; the exactly-once
`Feature_Name` prefix discipline (apply on derivation, strip on render-back).

**Consumes from 002**: Task, Routing Entry shapes; configuration model.

**Provides to**: 006 (container gating inputs), 008 (title applied on create/update),
004 (strip contract honored when rendering titles back), 009 (routing indications in
reports).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deterministic destination routing (Priority: P1)

Each task's file path selects a team **and** project via the consumer-supplied
path-prefix map — longest prefix wins, equal-length ties broken deterministically by
configured map order — falling back to configured defaults, and when neither exists,
leaving the task visibly unassigned while processing continues.

**Why this priority**: Routing decides which container every issue lands in; a wrong
guess creates cleanup work in the system of record.

**Independent Test**: Evaluate routing over a fixture path corpus against maps with
nested prefixes, equal-length ties, empty maps, and missing defaults; assert selection,
tie-break indications, default application, and unassigned-with-indication behavior —
pure function, no tracker.

**Acceptance Scenarios**:

1. **Given** a task path matching a configured prefix, **When** routing resolves,
   **Then** the longest matching prefix selects both team and project.
2. **Given** two prefixes of equal length matching, **When** routing resolves, **Then**
   configured map order breaks the tie deterministically with a recorded tie-break
   indication.
3. **Given** an unmatched path with configured defaults, **When** routing resolves,
   **Then** the default team and project apply; an absent or empty routing map applies
   the default path to every task.
4. **Given** no match and no defaults, **When** routing resolves, **Then** the task is
   left unassigned with an indication and remaining tasks continue processing.

### User Story 2 - Idempotent title derivation (Priority: P2)

Issue titles come from ordered, first-match-wins rules with template placeholders
substituted from task attributes; a task with a `Feature_Name` always carries the
`<Feature_Name>: ` prefix exactly once in the tracker title, and the same prefix (plus
strip/redundant/duplicate prefixes) is removed when the title is rendered back into
Markdown — so repeated runs never stack prefixes.

**Why this priority**: Titles are the most visible field; prefix compounding across
runs is the classic idempotency bug this feature exists to make impossible.

**Independent Test**: Run derivation → mirror → render-back → re-derivation for ten
cycles over tasks with and without `Feature_Name`, with matching/non-matching rules,
unresolvable placeholders, and preset titles already carrying prefixes; assert the final
title is stable byte-for-byte from cycle 1 onward and strip-on-render removes exactly
the decorated prefix set.

**Acceptance Scenarios**:

1. **Given** configured ordered title rules, **When** derivation runs, **Then** the
   first matching rule wins, template placeholders are substituted from task
   attributes, and unresolved placeholders become empty strings plus an indicator.
2. **Given** no rule matches or none are configured, **When** derivation runs, **Then**
   the built-in pass-through default applies.
3. **Given** a task with a `Feature_Name`, **When** any rule path produces a title
   (consumer rule, unmatched rule, or pass-through), **Then** `<Feature_Name>: ` is
   prepended exactly once and repeated derivations produce an identical final title.
4. **Given** a decorated title rendered back into Markdown, **When** 004 renders the
   line, **Then** the feature prefix, configured strip prefixes, redundant issue
   prefixes, and duplicate leading local-ID prefixes are removed.
5. **Given** a task without a `Feature_Name`, **When** derivation runs, **Then** the
   title is left unprefixed.

## Requirements *(mandatory)*

- **FR-001** (001 FR-020): System MUST route each task to both a team and a project
  using the consumer-supplied path-prefix map, selecting the longest matching prefix,
  and breaking equal-length ties deterministically by configured map order with a
  recorded tie-break indication.
- **FR-002** (001 FR-021): System MUST fall back to the configured default team and
  project for unmatched paths; when no defaults are configured, System MUST leave the
  task unassigned, produce an indication, and continue processing remaining tasks; an
  absent or empty routing map applies the default path to every task.
- **FR-003** (001 FR-033): System MUST derive issue titles by evaluating configured
  ordered rules (first match wins; template placeholders substituted from task
  attributes; unresolved placeholders replaced with empty strings plus an indicator),
  falling back to the built-in pass-through default when no rule matches or none are
  configured.
- **FR-004** (001 FR-034): System MUST decorate every derived title for a task with a
  `Feature_Name` by prepending `<Feature_Name>: ` exactly once — before consumer rules,
  unmatched rules, or the pass-through default alike — producing an identical final
  title on repeated derivations, and MUST strip that same prefix (plus configured strip
  prefixes, redundant issue prefixes, and duplicate local-ID prefixes) when the title is
  rendered back into Markdown so titles never progressively prefix across runs.
- **FR-005** (001 FR-035): System MUST leave a task without a `Feature_Name`
  unprefixed.

### Edge Cases

- **Empty routing map**: applies the default path to every task (FR-002).
- **Placeholder referencing an absent attribute**: replaced with empty string plus an
  indicator, never left literal.
- **Title already containing the feature prefix**: never double-prefixed; derivation
  detects and normalizes (FR-004).

## Key Entities

**Routing Entry** (owned): path-prefix → `{team, project}` pair, plus default team and
default project, deciding each task's destination. Title-rule model (ordered rules with
templates) owned here per 002's contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Routing over the fixture corpus resolves 100% of paths to the designed
  team/project or a correct unassigned-with-indication, with identical results on every
  re-run.
- **SC-002**: Over a 10-cycle derive→mirror→render round trip, 0 titles gain a
  duplicated or compounding prefix (idempotent decoration/strip in 100% of fixtures).

## Assumptions

- Routing consumes only the path and configured map; it never consults the tracker.
- Title rules are pure over task attributes; the tracker round-trip (who writes the
  title field) is owned by 008, which calls these rules.
- Default title strip prefixes come from the active framework adapter (003).
