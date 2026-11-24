---
mission: 001-corpus
created: 2026-11-04
---

# 001-corpus — Tasks (roll-up index)

## Inputs
- Source spec: `spec.md`
- [ ] T099 Illustrative checkbox inside the Inputs section

## Subtask Format
- [ ] Txxx Short imperative title, optional [P] or [USn] tag

## Work Package WP01: Auth
- [ ] T001 [P] Implement validator CLI
- [ ] T002 Add pytest coverage

## Work Package WP02: Flow persistence
- [ ] T003 [US1] Open the flow
- [ ] T004 Persist state

## Dependencies
T002 depends on T001.

## Risks & Mitigations
- Under the corrected model this roll-up is documentation: every checkbox line above is
  an index fragment and yields ZERO tasks. The work packages are the `tasks/` documents;
  `tasks/WP01-auth/review-cycle-1.md` is a per-WP review artifact, also zero tasks.
