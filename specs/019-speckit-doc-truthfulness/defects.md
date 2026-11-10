# Follow-up Entries (defect log)

Entries are append-only except `Status` (contract:
[contracts/audit-record-format.md](./contracts/audit-record-format.md)). Category
`defect` is permitted only for claims whose audit entry carries
`Requirements check: requirements-mandate-code-lacks` (FR-005; unimplemented mandates
are never deleted from `specs/requirements.md` to make docs match).

### FU-001 — separator-free checklist identifier capture

- **Category**: enhancement
- **Source claim**: C-002
- **Expectation**: reader-facing expectation that Spec Kit `- [ ] T001 …` checkbox
  ids sync as `Local_Task_ID`s.
- **As built**: `LOCAL_ID_SPAN_RE` (src/parsing/content.ts) requires separator
  punctuation + whitespace after the id; Spec Kit prints a plain space, so checkbox
  tasks sync without local ids (ordinal fallback).
- **Suggested home**: a future feature amending requirements R2.12 grammar +
  `docs/parsing.md`.
- **Status**: open
