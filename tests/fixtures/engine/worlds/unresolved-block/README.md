# unresolved-block

Task 1.2's section already contains a git-style conflict block written by a previous
`overwrite-spec` run — exactly the research R4 format
(`<<<<<<< task-linear-sync:local specs/sync-demo/tasks.md#L6` / local side / `=======` /
tracker side / `>>>>>>> task-linear-sync:linear ACME-2`, toolId-derived labels, no task
UUID) — so 004 `scanConflictBlocks` intersects the taskBody extent and 004
`parseTaskFile` flags `Task.unresolvedConflict`. Per FR-007/matrix §4 the plan decision
is `skip-unresolved`: nothing read-modified, no markers added (a second overwrite-spec
refuses), exactly one unresolved-conflict report entry, and the checkpoint untouched —
which is why `expected/checkpoint-seed.json` stores the PRE-BLOCK baseline body, so the
post-removal property step (T019) classifies normally again. The block interior line
(`- [ ] Fake checklist…`) must never extract as a task. Tasks 1.1/1.3 are clean controls;
SC-004 asserts the block's bytes survive N intervening runs. Placeholders only; fixed
clock.
