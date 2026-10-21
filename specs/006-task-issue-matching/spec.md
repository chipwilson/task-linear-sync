# Feature Specification: Task-to-Issue Matching and Confidence

**Feature Branch**: `006-task-issue-matching`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs the matching portion of 001 group E (001 FR-027–FR-032, source R5).

## Purpose and Scope

The scoring brain of the sync: given tasks and candidate issues, produce a globally
optimal, deterministic, one-to-one assignment with confidence bands, scores, margins,
reasons, and ranked alternatives. A pure function over the 002 entity shapes — no
tracker calls, no file writes — so it is the most parallelizable Wave-2 feature and the
easiest to property-test.

**Owns**: weighted signal scoring; confidence bands from floor thresholds; container
gating of non-durable candidates; maximum-weight one-to-one assignment with
deterministic tie-breaks; margin-based ambiguity downgrade; alternative retention.

**Consumes from 002**: Task, Match, Checkpoint shapes; durable-identity rule (identity
match outranks everything; durable pairs bypass gating/downgrade per constitution
Principle II). **Consumes from 005** (contract): routed team/project for container
gating.

**Provides to**: 008 (the assignment to apply), 009 (per-task decision fields for the
review report), 013 (drift/unmapped classification inputs).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Optimal, explainable one-to-one matching (Priority: P1)

Every task is scored against every usable candidate issue with a configurable weighted
sum over known signals; a globally optimal one-to-one assignment is selected
deterministically; each match carries a confidence band, numeric score and margin,
reasons, and up to three ranked alternatives — and identical inputs reproduce identical
matches byte-for-byte.

**Why this priority**: Wrong pairings are the highest-cost error the tool can make;
explainability (scores, margins, alternatives) is what makes review possible at all.

**Independent Test**: Property-based suite over generated task/issue corpora: assert
one-to-one validity, global optimality against brute force on small cases, deterministic
tie-break stability across permutations, gate correctness, band thresholds, and
alternative ordering — pure function, no I/O.

**Acceptance Scenarios**:

1. **Given** tasks and candidate issues, **When** scoring runs, **Then** each pair
   receives an unbounded weighted integer sum over configurable signals: durable
   identity match, existing issue reference, local task ID match, exact normalized
   title, contained normalized title, fuzzy title similarity (scaled token overlap),
   same-project alignment, and same-framework alignment.
2. **Given** scores, **When** bands are assigned, **Then** exactly one band from
   {high, medium, low, unmatched} applies from the configured floor thresholds, and
   selectable candidates are restricted to at least the plausible-match floor.
3. **Given** a non-durable candidate whose team, project, or (when both known)
   framework differs from the task's, **When** selection runs, **Then** that candidate
   is excluded entirely.
4. **Given** scored pairs, **When** assignment runs, **Then** a maximum-weight one-to-one
   assignment is solved (each task ≤ one issue, each issue ≤ one task), selecting
   deterministically among equally optimal solutions so unchanged inputs reproduce
   matches byte-for-byte.
5. **Given** a high-confidence non-durable match whose margin to the next usable
   candidate is below the configured minimum, **When** banding finalizes, **Then** it
   downgrades to medium with a recorded ambiguity reason.
6. **Given** any match, **When** output is built, **Then** up to three alternative
   candidates are retained, ordered by descending score with deterministic tie-breaks,
   each annotated mapped or unmapped.

### User Story 2 - Durable identity wins (Priority: P2)

An issue carrying the task's durable identity is matched regardless of container moves
or renames: durable matches bypass gating and margin downgrade so a moved issue is never
orphaned.

**Why this priority**: Constitution Principle II; the survival guarantee behind the
project's headline claim on renames/moves.

**Independent Test**: Fixture set of issues relocated across teams/projects/frameworks
and renamed, carrying canonical attachment identity; assert 100% pairing survival and
zero gating exclusions for durable candidates.

**Acceptance Scenarios**:

1. **Given** a candidate whose attachment metadata carries the task's durable identity,
   **When** gating and banding run, **Then** team/project/framework gating and the
   margin downgrade do not apply to it.
2. **Given** more than one issue carrying the same task UUID, **When** matching runs,
   **Then** the run aborts with a hard integrity failure and no changes (per
   constitution).

## Requirements *(mandatory)*

- **FR-001** (001 FR-027): System MUST score each task against each candidate issue as
  an unbounded weighted integer sum over configurable signals: durable identity match,
  existing issue reference, local task ID match, exact normalized title, contained
  normalized title, fuzzy title similarity (scaled token overlap), same-project
  alignment, and same-framework alignment.
- **FR-002** (001 FR-028): System MUST assign exactly one confidence band per match
  from {high, medium, low, unmatched} from the configured floor thresholds, restricting
  selectable candidates to at least the plausible-match floor.
- **FR-003** (001 FR-029): System MUST exclude non-durable candidates whose team,
  project, or (when both known) framework differ from the task's.
- **FR-004** (001 FR-030): System MUST solve a maximum-weight one-to-one assignment
  (each task at most one issue, each issue at most one task), selecting deterministically
  among equally optimal solutions so unchanged inputs reproduce matches byte-for-byte.
- **FR-005** (001 FR-031): System MUST downgrade a high-confidence non-durable match to
  medium, with a recorded ambiguity reason, when its margin to the next usable candidate
  is below the configured minimum.
- **FR-006** (001 FR-032): System MUST retain up to three alternative candidates per
  match, ordered by descending score with deterministic tie-breaks, each annotated
  mapped or unmapped.

### Edge Cases

- **Ambiguous matching** (001 edge case): high-confidence match with sub-minimum margin
  → downgrade to medium with recorded ambiguity reason; multiple optimal assignments →
  deterministic tie-break so re-runs are identical.
- **Cross-container candidates** (001 edge case): non-durable candidate with differing
  team/project/framework → excluded from selection entirely.
- **Duplicate UUIDs across issues**: hard integrity failure; abort, no changes
  (constitution Principle II).
- **Empty candidate pool**: every task bands `unmatched`; output remains deterministic.

## Key Entities

**Match** (owned): one-to-one task↔issue assignment with score, margin, confidence
band, reasons, and up to three ranked alternatives. Shape defined in 002.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-003): In a 100-task fixture with renames, moves, and checkbox
  flips, ≥95% of tasks retain their correct issue pairing across re-runs, and 100% of
  durable-identity pairs survive title or container changes without orphaning.
- **SC-002**: Two consecutive matching runs over identical inputs produce byte-for-byte
  identical assignment output (determinism), across 100 randomized fixtures.
- **SC-003**: On exhaustive small-case fixtures (≤8 tasks × ≤8 issues), the assignment
  weight equals brute-force optimum in 100% of cases.

## Assumptions

- Signal weights, floor thresholds, and the ambiguity margin are configuration with
  built-in defaults (constitution Principle III).
- Candidate issues arrive already scoped by the tracker port (007); matching never
  fetches.
- Durable identity is detected from attachment metadata supplied on the candidate
  (identity lookup itself is 007's attachment query; durable rule from constitution
  Principle II).
