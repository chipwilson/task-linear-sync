# rollback-interrupted

Interrupted-rollback world (quickstart 2.4, FR-014, US2 AC4): the task tree, seeds, and
checkpoint baseline are byte-identical to `rollback-full/` — this is a deliberate separate
copy, the two worlds share no files — so T036 can parametrize one expectation table over both.
The scenario difference is the harness interruption injector: after a full gated apply,
`armInterrupt(w, { phase: "rollbackRun", atCall: N })` (from `tests/helpers/engine-harness.ts`)
crashes the rollback when the Nth port call of that `rollbackRun` invocation is attempted
(`HarnessInterruptError`, once-armed, so the NEXT `rollbackRun` behaves normally — "crash at
step N, then resume"). Iterate `atCall` from 1 to the number of mutating rollback steps:
arm → `rollbackRun` (throws) → assert journal step states + `fired === 1` → fresh engine via
`attachEngine` → resume ⇒ `rolled-back` steps never repeat (zero replayed mutations after a
`callsMark`), the interrupted step re-evaluates, and the final state equals `rollback-full`'s.
The corrupted-state cell (`corruptRunStepState` ⇒ `conflict-halted`, status `partial`) runs on
this world too; see `expected/plan.json` for the per-task table.
