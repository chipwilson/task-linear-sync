---
work_package_id: WP03
title: Post-Release Verification
lane: planned
dependencies:
  - WP02
subtasks:
  - T012
  - T013
---

# WP03 — Post-Release Verification

## Objectives & Success Criteria
- Verify the published artifact is the artifact that was built and tested.
- Success: automated hash comparison plus a clean smoke install from the public index.

## Context & Constraints
- Runs after WP02's publication step; failures file issues, never auto-rollback.

## Subtask Guidance
T012 — Fetch the published artifact metadata via the index API (placeholder).
T013 — Verify the artifact hash matches the locally built artifact byte-for-byte.

## Test Strategy
- Fake the index responses with fixtures; assert the hash comparison matrix.

## Definition of Done
- [ ] Metadata fetch + hash check wired into the release flow
- [ ] Smoke-install probe scripted
