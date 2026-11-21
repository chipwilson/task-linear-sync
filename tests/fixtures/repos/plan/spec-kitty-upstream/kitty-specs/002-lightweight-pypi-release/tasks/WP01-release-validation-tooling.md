---
work_package_id: WP01
title: Release Validation Tooling
lane: in_review
lane_history:
  - planned
  - claimed
  - in_progress
  - for_review
dependencies: []
subtasks:
  - T001
  - T002
  - T003
phase: "Phase 1 — Validation"
---

# WP01 — Release Validation Tooling

## Objectives & Success Criteria
- Build the validation tooling a maintainer runs BEFORE any publication.
- Success: one `validate` command checks version consistency and changelog coverage and
  exits non-zero on any failure, with actionable messages.
- Success: later work packages (publication, verification) can rely on the validator.

## Context & Constraints
- The package is a zero-dependency CLI; the validator stays inside the same module tree.
- No new runtime dependencies; the checks are pure functions over the working tree.
- Placeholder identifiers only — never encode registry or organization specifics here.

## Subtask Guidance
T001 — Add the version-consistency check: read the single version source, compare it
against the manifest field and the changelog's newest heading; report every mismatch
with its file and line.

T002 — Add the changelog-coverage check: every commit since the last release tag must be
represented under the unreleased heading; list the missing subjects deterministically.

T003 — Wire checks into one `validate` command: run every check, collect findings, print
them sorted by file, exit 1 when any finding exists, exit 0 otherwise.

## Test Strategy
- Unit-test each check against hermetic fixture trees (match, mismatch, missing entry).
- Integration-test the command end-to-end in a temp tree; zero network, zero credentials.

## Risks & Mitigations
- Risk: checks drift from the release flow. Mitigation: the runbook (WP02) invokes this
  validator as its first step; the docs name the same command.
- Risk: flaky findings. Mitigation: every report is sorted and byte-deterministic.

## Definition of Done
- [x] All three checks implemented and wired
- [x] Unit + integration tests green with coverage at the repo threshold
- [ ] A maintainer outside the author team runs the command successfully once

## Activity Log
- 2026-11-10 — package opened from the mission roll-up index.
- 2026-11-12 — T001 and T002 landed on the branch.
- 2026-11-14 — T003 landed; moved to `for_review` after self-review.

## Review Report
- Reviewer: placeholder-maintainer (2026-11-15).
- Findings: none blocking. Suggested a clearer message when the changelog heading is
  missing entirely — folded into T003 wording.
- Verdict: approved for merge once the external run (Definition of Done item 3) lands.
