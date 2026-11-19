# depth-folding-two-level

Feature 020 US2 (two-level board) world: `config.maxTaskIssueDepth` is pinned to **2** —
the board shows epics and sub-tasks while implementation detail stays in the issue
description. The single task file holds a THREE-level checklist tree: depth-1 epic `1.1`,
depth-2 sub-task `1.1.1`, and depth-3 detail line `1.1.1.1` carrying its own depth-4 child
`1.1.1.1.1` (a fully folded subtree); a second flat control epic `1.2` has no children. At
cap 2 the two over-cap lines are NOT tasks — each earns a `depth-folded` checklist
exclusion — and the whole folded subtree (both lines plus their body lines, source
indentation included) rides verbatim inside the nearest surviving ancestor's Task_Body,
which the engine mirrors into the created issue description (US2 AC2). The plan carries
exactly three entries (`1.1`, `1.1.1`, `1.2`); `1.1.1` is the only parented task, and its
create reaches the fake `Linear_Port` with `parentId` set to the freshly created `1.1`
issue (parent-before-child ordering). No tracker issues are seeded — bootstrap creates all
three issues and every folded source line stays byte-unchanged with no issue-ref token. All
identities are placeholders (`TEAM-A`, `ACME`, synthetic uuids); the fixed clock starts
`2026-01-01T00:00:00.000Z`. `T028` (`tests/integration/depth-folding-two-level.test.ts`)
drives US2 AC1/AC2 here; the `ci-enforcement-action` e2e re-runs this world through the
fake published-CLI entry at caps 1 and 64.
