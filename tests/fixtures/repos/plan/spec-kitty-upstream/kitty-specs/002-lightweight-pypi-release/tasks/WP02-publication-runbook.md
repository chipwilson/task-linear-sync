---
work_package_id: WP02
title: Publication Runbook
lane: claimed
dependencies:
  - WP01
subtasks:
  - T006
  - T007
  - T008
---

# WP02 — Publication Runbook

## Objectives & Success Criteria
- Document the exact publication sequence a maintainer follows, from validator green to
  published artifact.
- Success: a dry-run of the runbook against the staging index completes with zero edits.

## Context & Constraints
- The runbook references the validator from WP01 as step one — it must stay runnable.
- Placeholder registry names only; the runbook never embeds credentials.

## Subtask Guidance
T006 — Draft the pre-publish checklist: validator green, tree clean, tag absent.
T007 — Draft the publish step sequence: build, inspect artifact, publish, tag.
T008 — Draft the rollback procedure: unlist, yank note, incident log entry.

## Test Strategy
- Dry-run the runbook against a staging placeholder; diff the transcript for drift.

## Definition of Done
- [ ] Runbook reviewed by a second maintainer
- [x] Dry-run transcript attached to the activity log

## Activity Log
- 2026-11-11 — package opened.
- 2026-11-13 — dry-run transcript attached.
