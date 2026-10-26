# 008 Contracts — Engine-Local Interfaces

Phase 1 contracts for `008-sync-engine-apply-rollback`. **Scope rule**: every interface
frozen by 002 — `SyncEngine`, `EngineDependencies`, `GateRequest`/`GateFailure`, the entity
shapes, the attachment URL scheme, the plan-report JSON schema — stays where it is
(`specs/002-core-domain-contracts/contracts/`, mirrored in `src/`). This folder documents
only what **008 owns**: the engine wiring built on the frozen contract, the normative
conflict-resolution matrix, the sync-history log write protocol, and the
journal/rollback-lifecycle semantics.

| Contract | What it pins |
|---|---|
| [engine-pipeline.md](./engine-pipeline.md) | `createSyncEngine` wiring over the frozen `SyncEngine`; build/apply/rollback pipeline order, screening enforcement points, plan stability re-check |
| [conflict-resolution-matrix.md](./conflict-resolution-matrix.md) | Normative effects for 6 actions × 3 conflict types × 2 modes, default maps, recency rule, freeze rule |
| [history-log.md](./history-log.md) | Attachment-chain state write protocol: payload rewrite, exactly-one append, rollover, preservation invariants |
| [journal-rollback.md](./journal-rollback.md) | Journal artifacts (frozen manifest + 008 step journal), step-state machine, rollback guards, refusal mapping |

Consumers (009/010/012) depend only on the frozen `SyncEngine` surface; nothing here is a
new public mutation path (constitution V).
