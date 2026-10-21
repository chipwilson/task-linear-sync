# Feature Specification: CI/CD Enforcement Layer

**Feature Branch**: `013-ci-enforcement-layer`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group R (CI/CD enforcement layer, source R26).

## Purpose and Scope

A distributable CI integration that gates pull requests on sync hygiene: it wraps the
published read-only check/plan commands, consumes the sanitized plan report JSON as its
sole machine-readable input, and fails the build on any of three independently
configurable violation conditions. Wave-4 feature and the smallest possible slice —
three FRs, no engine logic, no mutations. It realizes the enforcement half of 001's
User Story 4.

**Owns**: the three failure conditions and their toggles/thresholds; pass/fail status
and human-readable failure summary; screened-summary output posture.

**Consumes from 009**: published commands and the plan report JSON (sole input —
constitution Principle V: the CI layer wraps the CLI, it never reimplements).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pre-merge enforcement (Priority: P1)

A team adds the enforcement step to its pull-request pipeline; the build fails only when
an enabled condition triggers — too many high-confidence unmapped tasks, unresolved
conflict blocks on a protected-branch run, or spec-vs-tracker drift beyond threshold —
with a human-readable summary naming each failed condition and its count, and passes
clean syncs with zero false alarms.

**Why this priority**: This whole feature is one story: automated pre-merge hygiene that
team leads can trust enough to make blocking.

**Independent Test**: Run the enforcement layer against fixtures crafted to trigger each
of the three conditions and combinations; confirm per-condition toggles, thresholds,
offending counts in the summary, non-zero failure status, success status when nothing
triggers, and zero mutations/writes performed by the layer itself.

**Acceptance Scenarios**:

1. **Given** a pull request whose plan reports more high-confidence unmapped tasks than
   the configured threshold (default 0), **When** enforcement runs with that condition
   enabled, **Then** the build fails with a human-readable summary naming the failed
   condition and its count.
2. **Given** a protected-branch run (default the pull-request base branch) whose plan
   reports tasks carrying unresolved conflict blocks, **When** enforcement runs with
   condition (b) enabled, **Then** that condition triggers; drift — matched tasks
   classified `spec-changed`/`both-changed` or with pending changed fields or expected
   Markdown changes — beyond threshold (default 0) triggers condition (c).
3. **Given** a disabled condition, **When** enforcement runs, **Then** it never fails
   the build regardless of its underlying signal.
4. **Given** no enabled condition triggered, **When** enforcement finishes, **Then** the
   step passes with a success status; otherwise it fails with non-zero status.
5. **Given** any enforcement run, **When** its output is inspected, **Then** the layer
   performed zero tracker mutations and zero repository writes, consumed only the plan
   report JSON, and emitted only screened summaries (hashes and human-readable names,
   no raw bodies or descriptions).

## Requirements *(mandatory)*

- **FR-001** (001 FR-095): System MUST distribute a CI enforcement integration that
  wraps the published read-only check/plan commands and consumes the sanitized plan
  report JSON as its sole machine-readable input, performing zero tracker mutations,
  zero repository writes, and offering no apply or mutate mode.
- **FR-002** (001 FR-096): The enforcement layer MUST expose three independently
  configurable, independently toggleable failure conditions, each enabled by default:
  (a) unmapped high-confidence tasks exceeding a threshold (default 0); (b) unresolved
  conflict blocks on runs targeting a protected branch (default the pull-request base
  branch); (c) spec-vs-tracker drift — matched tasks classified
  `spec-changed`/`both-changed` or with pending changed fields or expected Markdown
  changes — exceeding a threshold (default 0). Disabled conditions NEVER fail the build.
- **FR-003** (001 FR-097): The enforcement layer MUST pass with a success status when no
  enabled condition triggers, and MUST fail the step with a non-zero status and a
  human-readable summary identifying each failed condition and its offending count
  otherwise, emitting only screened summaries that exclude raw bodies and descriptions
  in favor of hashes and human-readable names.

### Edge Cases

- **Missing/malformed plan report JSON**: fail with a configuration/input error naming
  the artifact — never a silent pass.
- **All three conditions triggered at once**: summary names all three with their
  counts; status non-zero once.
- **Non-protected branch**: condition (b) cannot trigger by branch classification, even
  if conflict blocks exist.

## Key Entities

**Plan Report Artifacts** (consumed): the JSON artifact (009) is the sole machine input.
No new entities; the layer stores nothing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-011): With the three conditions at defaults, the layer fails
  exactly the builds that exhibit the configured violation (0 false negatives) and passes
  all clean-sync builds (0 false positives) in the enforcement fixture set.
- **SC-002**: 0 tracker mutations and 0 repository writes occur during any enforcement
  run across the corpus; no apply/mutate code path is reachable.
- **SC-003**: Every failed-build fixture's summary names each failed condition and its
  offending count; every emitted line is screened (0 raw bodies/descriptions).

## Assumptions

- The layer ships as a distributable integration wrapping the published CLI (source
  R26); pipeline-specific packaging follows the constitution's technology-stack and
  release-gate constraints.
- "Protected branch" identity defaults to the pull-request base branch as reported by
  the CI environment; overridable per configuration.
- All decision inputs are pre-computed in the plan report; the layer performs no
  matching or classification of its own.
