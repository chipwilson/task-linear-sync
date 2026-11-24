---
work_package_id: WP01
title: Auth
lane: in_progress
subtasks:
  - T001
  - T002
  - T099
dependencies: [WP00]
assignee: ops-placeholder
review_status: pending
---

# WP01 — Auth

## Objectives & Success Criteria
- Deliver the auth module behind the placeholder interface.
- Success: login round-trip passes against the fake port.

### Subtask T001 – Implement validator CLI
- Open the CLI at `validate` and parse arguments.
- Exit non-zero when any check fails.

### Subtask T002 – Add pytest coverage
- Cover the validator matrix with hermetic fixtures.
- Keep the suite network-free and credential-free.

## Activity Log
- 2026-11-04 — package opened; roster seeded.

#### Subtask T001: Auth ✅
- 2026-11-20 — restated under the Activity Log: content, never an anchor.

## Review Report
- Round 1 approved with nits; the duplicated `#### Subtask` heading above lives
  after the region stop line and never derives a child.
