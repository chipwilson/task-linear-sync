# unresolved-block

Task 1.2's section already contains a git-style conflict block written by a previous
`overwrite-spec` run — exactly the research R4 format
(`<<<<<<< task-linear-sync:local specs/sync-demo/tasks.md#L6` / local side / `=======` /
tracker side / `>>>>>>> task-linear-sync:linear ACME-2`, toolId-derived labels, no task
UUID) — so 004 `scanConflictBlocks` intersects the taskBody extent and 004
`parseTaskFile` flags `Task.unresolvedConflict`. Per FR-007/matrix §4 the plan decision
is `skip-unresolved`: nothing read-modified, no markers added (a second overwrite-spec
refuses), exactly one unresolved-conflict report entry, and the checkpoint untouched.
The world is side-coherent: the block's LOCAL side is verbatim the PRE-BLOCK baseline
body — the section body `expected/checkpoint-seed.json` hashes for 1.2 — while the
tracker side preserves the historical divergent snapshot and the live ACME-2 issue
description has been restored to the same baseline body. Removing the markers keeping
the local side therefore re-hashes equal to the baseline and to the tracker side ⇒ the
post-removal step (T019) classifies `no-change` per matrix §4. The interior line
(`  - [ ] Fake checklist sub-item…`) is a nested checklist child of 1.2: while the block
stands it is frozen interior and never extracts (plan entries stay 3); after removal it
re-extracts as 1.2's sub-item, inside 1.2's mirrored body. Tasks 1.1/1.3 are clean
controls; SC-004 asserts the block's bytes survive N intervening runs. Placeholders
only; fixed clock.
