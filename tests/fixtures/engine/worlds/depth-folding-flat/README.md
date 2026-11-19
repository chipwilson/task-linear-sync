# depth-folding-flat

Feature 020 US1 (flat board) world: `config.maxTaskIssueDepth` is pinned to **1** — the
built-in default (Maintainer Ruling 2026-11-18), stated explicitly so the world documents
its own posture. The single task file holds checklist task `1.1` with a two-level nested
checklist subtree (depths 2 and 3), a second top-level task `1.2`, and grammar-matching
heading task `9.0` with a checklist line orphaned directly under it (depth 2). At cap 1 the
three nested lines are NOT tasks — each earns a `depth-folded` checklist exclusion — and
their indented text survives verbatim inside the nearest surviving ancestor's Task_Body,
which the engine mirrors into the created issue description (SC-002). The plan therefore
carries exactly three entries (`1.1`, `1.2`, `9.0`), none parented, and every `createIssue`
reaching the fake `Linear_Port` carries no `parentId`. `T027`
(`tests/integration/depth-folding-flat.test.ts`) drives US1 AC1/AC3 here. No tracker issues
are seeded — bootstrap creates all three issues. All identities are placeholders (`TEAM-A`,
`ACME`, synthetic uuids); the fixed clock starts `2026-01-01T00:00:00.000Z`.
