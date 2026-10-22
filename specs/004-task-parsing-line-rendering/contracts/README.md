# Contracts: Task Parsing and In-Place Line Rendering (004-local)

Feature-local behavioral contracts for `src/parsing/`. These define **only** 004-owned
behavior — parsing/extraction, in-place line rendering, and the boundary at which the
feature consumes 003's adapter *interface*. Everything frozen by Wave 1 (entity shapes,
`taskStableSeed`/R11, config keys) is cited from
[`specs/002-core-domain-contracts/contracts/`](../../002-core-domain-contracts/contracts/README.md)
and referenced here, never restated as definition (ROADMAP rule 2: amendments only).

| Contract | Covers | Spec FRs |
|---|---|---|
| [parsing-api.md](./parsing-api.md) | `parseTaskFile` extraction semantics | FR-001…FR-010 |
| [line-rendering.md](./line-rendering.md) | `renderTaskLines` rewrite semantics | FR-011…FR-013 |
| [adapter-consumption.md](./adapter-consumption.md) | The adapter-interface consumption boundary + `generic` fixture rule | Assumptions, FR-008 |

Record field tables: [../data-model.md](../data-model.md). Validation scenarios:
[../quickstart.md](../quickstart.md).
