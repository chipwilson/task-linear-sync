# rollback-full

Sync-mode apply → total-restoration rollback world (SC-003; quickstart 2.1/2.3/2.6; drives
T034 creates, T036 rollback, T037 fail-abort, T030/T038 gates). Task 1.1 `[ACME-1]` is matched
and drifted spec-side only (one added paragraph ⇒ `spec-changed`, built-in sync action
`overwrite-linear`); its two unmatched checklist children `1.1.1` Beta and `1.1.2` Gamma carry
`parentUuid` = 1.1 (004 nesting includes descendants in the parent's mirror region, so the
seeded ACME-1 description is the *pre-drift* section body **including** the child task lines —
pinned cross-lane decision 1), and `1.2` `[ACME-2]` Zeta is the untouched control (`no-change`).
Apply must therefore create GAMMA before BETA (FR-011: parents first — trivial here as the
parent is matched — same-parent siblings in REVERSED working order), rewrite the assigned task
lines with their issue refs, and finish with the checkpoint write; `expected/plan.json` pins the
per-task table and the call-log order assertions. Seed `expected/checkpoint-seed.json` before
`buildSyncPlan`; Beta/Gamma are intentionally absent from the seed so the rollback (T036) must
REMOVE their checkpoint entries (FR-013 restore-or-remove) while archiving their created issues
and appending exactly one `rollback` event per task.
