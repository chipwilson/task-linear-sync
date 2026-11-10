---
mission: 002-billing
created: 2026-11-03
---

# 002-billing — Tasks

## Inputs
- Source spec: `spec.md`
- [ ] this illustrative checkbox must NOT become a task

## Subtask Format
- [ ] Txxx Short imperative title, optional [P] or [USn] tag

## Work Package WP01: Invoices
- [ ] T001 [P] Generate invoice PDFs
- [ ] T002 Email the invoice on issuance

## Work Package WP02: Webhooks
- [ ] T003 [US1] Verify webhook signatures
- [x] T004 Record the processed-event watermark

## Dependencies
T002 depends on T001.

## Risks & Mitigations
- Replay protection is a checklist concern, never an issue title.
