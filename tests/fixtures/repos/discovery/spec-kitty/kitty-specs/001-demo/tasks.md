---
mission: 001-demo
created: 2026-11-02
---

# 001-demo — Tasks (roll-up index)

## Inputs
- Source spec: `spec.md`
- [ ] this illustrative checkbox must NOT become a task

## Organization
Work-package prompt files live in `tasks/`: one document per work package. This roll-up
is the mission index; every checkbox line below is an index fragment, not a task.

## Work Package WP01: Scaffold
- [ ] T001 Create the scaffold
- [ ] T002 Implement charging
- [ ] T003 Wire the entry point
- [ ] T004 Add the placeholder module
- [ ] T005 Document the scaffold

## Work Package WP02: Payments
- [ ] T006 Add payouts
- [ ] T007 List transactions
- [ ] T008 Reconcile ledger entries
- [ ] T009 Add refund handling
- [ ] T010 Emit payment events
- [ ] T011 Harden retry policy
- [ ] T012 Verify idempotency keys

## Work Package WP03: Invoicing
- [ ] T013 Draft invoice model
- [ ] T014 Render invoice PDFs
- [ ] T015 Schedule invoice delivery
- [ ] T016 Track delivery status
- [ ] T017 Archive delivered invoices
- [ ] T018 Expose invoice queries
- [ ] T019 Add invoice totals

## Work Package WP04: Billing
- [ ] T020 Model billing periods
- [ ] T021 Compute usage totals
- [ ] T022 Apply plan discounts
- [ ] T023 Generate billing runs
- [ ] T024 Reconcile billing totals
- [ ] T025 Emit billing statements
- [ ] T026 Freeze closed periods

## Dependencies
T006 depends on T001. T020 depends on T013.

## Risks & Mitigations
- Tag rendering stays stable: `[P]` belongs to this file, not to any issue title.
