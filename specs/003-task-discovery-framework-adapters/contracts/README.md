# Contracts — 003 Task Discovery & Framework Adapters

These documents define the **003-local** public surface: the framework-adapter interface (the
seam 004 codes against) and the discovery behavior contract (FR-001–FR-006). They are the
spec-facing mirror of `src/discovery/` — the contract test
`tests/contract/discovery-surface.test.ts` snapshots the exact exported-name set and fails on
drift.

**Scope guard**: these are NOT 002 contracts. Everything frozen by
[`specs/002-core-domain-contracts/contracts/`](../../002-core-domain-contracts/contracts/README.md)
— `FrameworkId`, `TaskFile`, `Task`, `FrameworkMetadata`, `ResolvedConfig`, `deepMerge` — is
consumed read-only and never redefined here (ROADMAP rule 2: amendments only, and none is
needed). Where 003 extends 002 vocabulary (custom-adapter identity), the extension is local and
recorded as an amendment candidate in [research.md](../research.md) R5.

**Amendment rule (mirrors 002 FR-008)**: any change to the surface below updates the contract
doc, the `src/discovery/` module, and the `discovery-surface` snapshot together, noted against
001. Silent edits fail the contract test. Because 004 compiles against
`task-linear-sync/discovery`, a drift here is a Wave-2 build break by design.

| Contract | Document | Implemented here? | Consumers |
|---|---|---|---|
| Framework adapter interface & conventions | [framework-adapter.md](./framework-adapter.md) | **Yes — interface + built-in table + registry + overrides** | 004 (interface + `generic` fixture), 005 (`titleBehavior`), 006 (framework metadata), 008 (identity persistence inputs), 010 (agent-hook template) |
| Discovery API (`discoverTaskFiles`) | [discovery-api.md](./discovery-api.md) | **Yes — full behavior** | 004, 008, 009 (via engine), 010 |

Entity field tables: [../data-model.md](../data-model.md); decisions:
[../research.md](../research.md); validation scenarios: [../quickstart.md](../quickstart.md).
