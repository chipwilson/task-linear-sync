---
mission: 002-lightweight-pypi-release
created: 2026-11-10
---

# 002-lightweight-pypi-release — Tasks (roll-up index)

## Inputs
- Source spec: `spec.md`

## Organization
Work-package prompt files live in `tasks/` — one document per work package. Every
checkbox line in this roll-up is an index fragment; the real detail lives in the
work-package documents.

## Work Package WP01: Release Validation Tooling
- [ ] T001 Add the version-consistency check
- [ ] T002 Add the changelog-coverage check
- [ ] T003 Wire checks into one validate command
- [ ] T004 Unit-test each check with fixtures
- [ ] T005 Document the validate command

## Work Package WP02: Publication Runbook
- [ ] T006 Draft the pre-publish checklist
- [ ] T007 Draft the publish step sequence
- [ ] T008 Draft the rollback procedure
- [ ] T009 Dry-run the runbook against the staging index
- [ ] T010 Review the runbook with a second maintainer
- [ ] T011 Add the tag-after-publish guard

## Work Package WP03: Post-Release Verification
- [ ] T012 Fetch the published artifact metadata
- [ ] T013 Verify the artifact hash matches the build
- [ ] T014 Smoke-install from the public index
- [ ] T015 Announce completion in the activity log
- [ ] T016 File follow-up issues for deferred items

## Dependencies
T006 depends on T003. T012 depends on T007.

## Risks & Mitigations
- Index fragments must never be synced as tasks: the work-package document is the unit.
