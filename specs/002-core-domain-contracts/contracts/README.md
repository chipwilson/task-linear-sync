# Frozen Contracts — 002 Core Domain Contracts

These documents are the spec-facing mirror of the frozen TypeScript surface in `src/`
(`domain/`, `config/`, `state/`, `urls/`, `gates/`, `ports/`). They enumerate exactly the
contracts named in `spec.md` § "Contracts frozen here".

**Amendment rule (FR-008 / ROADMAP rule 2)**: any change to a frozen contract is a
constitution-governed cross-feature amendment — it must update the contract doc, the `src/`
module, and the contract-test snapshot together, and be noted against 001. Silent edits fail
the contract test.

| Contract | Document | Implemented here? | Consumers |
|---|---|---|---|
| Task model | [task-model.md](./task-model.md) | Types (004 computes) | 003–009, 012 |
| Configuration model & validation | [configuration.md](./configuration.md) | **Yes — full behavior** | All |
| Tracker port (`Linear_Port`) | [tracker-port.md](./tracker-port.md) | Interface types (007 implements) | 006, 008, 009, 011, 013 |
| Attachment URL scheme | [attachment-url-scheme.md](./attachment-url-scheme.md) | **Yes — builders/parsers** | 007, 008, 011 |
| Engine apply entry & gate vocabulary | [engine-gates.md](./engine-gates.md) | Types + gate codes (008 implements engine) | 009, 010, 012, 013 |
| Plan artifact & review-report schema | [plan-artifact.md](./plan-artifact.md) + [plan-report.schema.json](./plan-report.schema.json) | Types + JSON Schema (008 builds, 009 renders) | 008, 009, 012, 013 |
| Run-state lifecycle | [run-state.md](./run-state.md) | **Yes — full behavior** | 008, 009, 010 |

Entity field tables live in [../data-model.md](../data-model.md); this directory holds the
interface/behavioral contracts.
