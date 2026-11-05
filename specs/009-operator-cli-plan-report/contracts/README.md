# 009 Contracts — CLI Surface, Queue-Delegate Seam, Review-Report Lane

Phase 1 contracts for `009-operator-cli-plan-report`. **Scope rule**: everything frozen
by 002 — `SyncEngine`, `EngineDependencies`, `GateRequest`/`GateFailure`, `StateStore`,
`LastRunMarker`, the plan/report shapes, and `plan-report.schema.json` — stays where it
is (`specs/002-core-domain-contracts/contracts/`, mirrored in `src/`). This folder
documents only what **009 owns**: the twelve-command surface with its exit-status map,
the `QueueSurface` seam 010 will bind, and the report-lane consumption/enforcement
rules (including the read-only guard).

| Contract | What it pins |
|---|---|
| [command-surface.md](./command-surface.md) | Twelve commands: syntax, flags, engine route, stdout/stderr shape, exit-code map, FR-002 flag-rejection rule, `check`'s machine contract for 013 |
| [queue-surface.md](./queue-surface.md) | `QueueSurface` interface (the 010 binding contract), default wiring, refusal semantics, `install-agent-hook` zero-network guarantee |
| [plan-review-report.md](./plan-review-report.md) | Report lane: engine-side writers as the single renderer, artifact placement, FR-006/007/008 enforcement checklist, `ReadOnlyGuard` rules, zero-task edge case |

Consumers: 013 wraps the published `check`/`plan` commands and parses the report JSON;
012 mirrors these command semantics through the same engine; 010 replaces the default
`QueueSurface` wiring. None of them may need a 009 code change to do so. Nothing here
creates a new mutation path (constitution V).
