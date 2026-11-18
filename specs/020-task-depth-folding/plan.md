# Implementation Plan: Task-Depth Folding (sub-issue depth cap)

**Branch**: `020-task-depth-folding` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-task-depth-folding/spec.md`

## Summary

Add an optional configuration key `maxTaskIssueDepth` (1..64; absent =
unlimited) that caps how deep in the task tree tasks become their own Linear
issues. Tasks below the cap are **folded**: they stop being tasks and stay as
verbatim body content of the nearest surviving ancestor — which their
`Task_Body` already contains — recorded in parsing exclusions with a new
`depth-folded` reason. The change lands in the pure parsing lane plus the
frozen configuration schema (contract amendment); matching, engine, plan,
report, gates, and CI are untouched because folded lines simply never reach
them. Docs, tests across all tiers, the requirements amendment, and the
contract-amendment record ship in the same change (Documentation duty).

## Technical Context

**Language/Version**: TypeScript (strict ESM), Node.js ≥ 20.0.0

**Primary Dependencies**: Node built-ins only (zero runtime dependencies; MCP SDK stays scoped to `<pkg>/mcp` and is untouched here)

**Storage**: N/A for this feature (pure parse lane; run-state directory untouched)

**Testing**: `node:test` tiers — unit / contract / integration / e2e / performance (`scripts/run-tests.mjs`), plus type-boundary tests (`tests/types/`)

**Target Platform**: npm package `task-linear-sync` consumed through its CLI, library API, worker, MCP server, and CI action

**Project Type**: library + CLI (single npm package)

**Performance Goals**: parse-lane depth computation is O(tasks) per file (parent chains are already built); no measurable change to the existing parsing performance tier

**Constraints**: parsing purity (no I/O/clock/network); determinism byte-for-byte (Principle IV); frozen 002 contract surface extended only via dated amendment; absent default must reproduce pre-feature bytes exactly on every fixture (SC-001)

**Scale/Scope**: 1 optional config key, 1 depth computation in `src/parsing`, 1 new exclusion-reason value, 1 typed config-validation error; ~7 documentation files; ~5–7 test files updated/added

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Basis |
|---|---|---|
| I. Safety First | PASS | Folding only *removes* mutations (fewer issues created). Read-only lanes stay read-only; refusal path for invalid values mutates nothing; no new write path. |
| II. Durable Identity | PASS (with documented risk) | No seed layout change. Ordinal-seeded tasks may shift identity when the cap is toggled on a previously synced file — accepted, documented (R6), and softened because visible reference tokens keep re-matching at high confidence; durable-identity storage mechanism unchanged. |
| III. Intelligent Defaults, Overridable Configuration | PASS | New value ships a sensible default posture (absent = unlimited = today's frozen behavior, following the `stateDirectory` / `historyLogMaxBytes` absent-default precedent), fully overridable in every layer; zero org literals introduced. |
| IV. Determinism and Idempotency | PASS | Pure function of (content, conventions, cap); SC-001 requires byte-identical default behavior; SC-005 scenarios re-run twice for byte equality. |
| V. One Engine, Additive Surfaces | PASS | Validation lives at the parsing entry all surfaces share (`parseTaskFile`), so CLI/engine/worker/MCP/CI refuse identically; no surface-specific path. |
| VI. Test-First and Quality Gates | PASS | FR-009 + contracts/test-matrix define per-story tests across unit/integration/e2e incl. snapshot amendments; no real network/credentials. |
| Additional constraints | PASS | No Linear-port change (no parent-order change for surviving tasks), no credential surface, no new dependencies, no org literals. |

**Gate result: PASS — no violations; Complexity Tracking not needed.**

Amendment obligation (Governance, not a violation): the frozen 002
configuration contract and the parsing exclusion-reason union are extended —
delivered as a dated amendment (014's six-key precedent): amendment entry in
`specs/002-core-domain-contracts/contracts/configuration.md`, an inline
amendment to `specs/requirements.md` (018 A-018-x precedent), and a
`docs/contract-amendments.md` record.

**Post-design re-check (after Phase 0/1): PASS.** The design kept the
fold in the pure parsing lane (Principles I/IV/V), introduced no defaults
carrying literals and no required-from-consumer values beyond governance
allowance (III), and every contract rule C1–C10 names its test gate (VI).
No complexity-tracking entries were needed.

## Project Structure

### Documentation (this feature)

```text
specs/020-task-depth-folding/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── depth-folding.md          # parsing semantics + validation contract
│   └── configuration-amendment.md # frozen-model + requirements amendment record
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── config/            # schema.ts: + optional maxTaskIssueDepth on ResolvedConfig (+ ConfigOverrides twin)
├── parsing/           # extract.ts: depth fold + exclusion reason; taskfile.ts: depth-aware uuid/index maps;
│                      # depth.ts (new): pure depth computation + typed config validation error
├── engine/            # untouched (folded tasks never reach the pipeline)
└── cli/               # untouched if the typed parse-entry error maps to exit 3 through existing
                       # error-mapping; else one mapping line (verified during implementation)

tests/
├── unit/              # + parsing-depth-fold.test.ts, + config-depth-key round-trip cases
├── contract/          # snapshots amended (parsing surface), doc/contract-amendment record guards
├── integration/       # + engine plan-over-fixture scenarios (fake port; per-story matrix)
├── e2e/               # + CLI plan/check scenarios incl. invalid-value exit 3
└── types/             # parsing.test-d.ts / config type pins extended to the new field + reason union

docs/                  # configuration-reference.md, configuration.md, parsing.md, README.md,
                       # contract-amendments.md, CHANGELOG.md (Documentation duty, FR-008)
specs/requirements.md  # inline amendment(s), tagged (020 amendment A-020-x)
specs/002-core-domain-contracts/contracts/configuration.md  # dated amendment: new optional key
```

**Structure Decision**: No new top-level layout — the feature extends the
existing pure parsing lane (`src/parsing`), the frozen config model
(`src/config`), and the established test tiers. One new pure module
(`src/parsing/depth.ts`) keeps fold/depth logic unit-testable in isolation and
keeps `extract.ts`'s scan focused on grammar.

## Complexity Tracking

> No constitution violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| — | — | — |
