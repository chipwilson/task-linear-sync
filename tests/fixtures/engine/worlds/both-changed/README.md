# both-changed

Sync-mode world (seed `expected/checkpoint-seed.json`): task 1.1's body text and ACME-1's
description each moved away from the shared baseline in *different* directions ⇒
classification `both-changed` ⇒ the built-in sync map answers `report-only` (no writes
either side, a `conflict-detected` history entry, FR-003/FR-005). ACME-1's
`updatedAt` (00:00:05) is strictly later than the checkpoint's `issueUpdatedAt`
(00:00:02) yet `prefer-newer` **still** degrades to report-only — `both-changed` has no
trustworthy spec-side clock (matrix §3 row 4, US1 AC6). Overriding
`syncConflictMap.both-changed` to `overwrite-spec` (T032, quickstart 1.3) must embed both
sides between git-style markers with zero `updateIssue` calls. Task 1.2 is the untouched
control. Placeholders only; fixed clock.
