# first-run-bootstrap

No checkpoint store exists, so `buildSyncPlan` must select **bootstrap** mode (data-model
§2). Task 1.1 is durably anchored (page-0 canonical attachment) to issue ACME-1 whose
description is normalized-identical to the task body — FR-002 says that is *no* conflict.
Task 1.2 is anchored to ACME-2 but the bodies differ meaningfully — bootstrap classifies
that `both-changed`, and the built-in `bootstrapConflictMap` maps every type to
`overwrite-linear` (conflict-resolution-matrix.md §1). Task 1.3 has no tracker issue at
all, exercising the bootstrap `create` decision that seeds the tracker. T018
(`tests/integration/engine-bootstrap.test.ts`) drives US1 AC1 here and asserts the
SC-001 second-plan convergence after a full apply. Issue descriptions carry the mirrored
*body portion* of each section (the text region the description-conflict hashes cover per
research R3/R5 — the checkbox/title line stays spec-side, FR-006). All identities are
placeholders (`TEAM-A`, `ACME-*`, synthetic uuids); the fixed clock starts
`2026-01-01T00:00:00.000Z`.
