# linear-changed

Sync-mode world (seed `expected/checkpoint-seed.json` via the harness `seedCheckpoints`
helper — `world.json` itself cannot carry checkpoints). The spec sections still equal
their checkpoint baselines while ACME-1 and ACME-2 descriptions moved ⇒ classification
`linear-changed` (FR-002), whose built-in sync action is `overwrite-spec` (marker block
into the section, issue untouched, matrix §1–2). The two drifted tasks differ only in
recency: ACME-1's `updatedAt` (00:00:04) is strictly later than its checkpoint's
`issueUpdatedAt` (00:00:02) so an overridden `prefer-newer` resolves overwrite-spec,
while ACME-2's non-advancing `updatedAt` (equal instants) forces the US1 AC6 degradation
to `report-only` with `degraded: true` (matrix §3). Task 1.3 is the untouched control
(`null` conflict). Issue descriptions hold the mirrored body portion; all identities are
placeholders and the clock is fixed at `2026-01-01T00:00:00.000Z`.
