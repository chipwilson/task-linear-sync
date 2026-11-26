# Implementation Plan: Default-On Task State Mapping to Linear Default Issue States

**Branch**: `024-default-state-mapping` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-default-state-mapping/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Flip task state mapping from opt-in to **default-on** across every supported SDD framework
and back it with a **bootstrap existence check**. At config load, a new post-merge resolution
pass fills each configured team's absent workflow-state identities (`Backlog`/`Todo`/`In
Progress`/`Done`) and lane map (default table per research R2) from platform-generic Linear
default state names — so `resolveLaneState`/`desiredCompletionStateName` need no mapping
change (defaults arrive as ordinary configured values). New switches
(`stateMappingEnabled`, per-team `workflowStates.mappingEnabled`, `lanes: null`) restore the
today's untouched posture on demand. A new engine validator, run in bootstrap mode at plan
build (reusing the already-fetched `discoverMetadata` snapshot — zero extra Linear calls) and
again in apply before the first mutation, verifies every mapped name (identities + lane
targets) and the `completed`/`canceled` type categories against each team's live workflow and
aborts with `StateMappingBootstrapError` (exit 3) carrying a per-team grouped report: missing
names with config entry paths, available `name (type)` states, case-insensitive near-match
hints, and step-by-step correction instructions. Sync-mode runs keep today's plan-time
conflict posture. Governance: constitution v1.1.0 amendment (Principle III platform-default
exception) + contract amendments A-024-0/1/2.

## Technical Context

**Language/Version**: TypeScript (strict ESM), Node.js ≥ 20.0.0

**Primary Dependencies**: none added — Node built-ins + the existing single platform
transport; `Linear_Port` interface unchanged (consumes existing `discoverMetadata`)

**Storage**: files only (existing layered JSON config, atomic `StateStore`); no new state
files

**Testing**: built-in `node:test` via `scripts/run-tests.mjs` (tiers unit/contract/
integration/e2e + property/contract/security cross-cutters); fake `Linear_Port` for all
tracker behavior

**Target Platform**: standalone npm package (library + CLI + server surfaces), Linux/macOS/
Windows Node hosts

**Project Type**: library + CLI (single package; surfaces share the one engine)

**Performance Goals**: bootstrap validation adds **zero** additional Linear requests in plan
(reuses the stage-3 snapshot; apply reuses its re-fetch) and O(teams × states) pure work

**Constraints**: zero org-specific literals in shipped defaults (release scan); read-only
surfaces stay mutation-free; diagnostics never carry credentials or state ids; deterministic
`canonicalizeConfig` preserved across the resolution pass

**Scale/Scope**: config-layer table + one resolution pass, one engine validator + error
class, three engine gate call-sites, resolver null-guards, exit-code registration, docs +
governance records, tests per quickstart V1–V10

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict (pre-Phase-0 → post-Phase-1) | Basis |
|---|---|---|
| I. Safety First | PASS → PASS | Validator is read-only (`discoverMetadata`), aborts bootstrap before any mutation; new error text screened, names+types only, no ids/credentials; plan surfaces remain mutation-free |
| II. Durable Identity | N/A → N/A | No identity/attachment changes (C5.3) |
| III. Intelligent Defaults, Overridable Configuration | **CONDITIONAL PASS — documented amendment** → PASS (with amendment) | Feature ships defaults for per-team workflow-state identities, which III currently reserves as consumer-required; amendment v1.1.0 adds a platform-default exception (generic Linear names only; org-literal ban and full overridability retained verbatim). Governance requires the amendment in-branch, not silent deviation (research R8) |
| IV. Determinism & Idempotency | PASS → PASS | Pure deterministic fill (C2.3 property test); corrected re-run converges (C4.5); sync-mode byte-identical (C6) |
| V. One Engine, Additive Surfaces | PASS → PASS | Validation + switches live in the engine/config core; every surface inherits; no new command; all Linear access via `Linear_Port` |
| VI. Test-First & Quality Gates | PASS → PASS | Every FR/SC maps to quickstart V1–V10 automated coverage incl. property/contract/security |

**Gate decision: PROCEED** — the sole violation is Principle III, justified, user-directed,
and routed through the constitution's own amendment procedure (see Complexity Tracking).
No NEEDS CLARIFICATION items remain (all resolved in research R1–R9).

## Project Structure

### Documentation (this feature)

```text
specs/024-default-state-mapping/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — R1–R9, no open unknowns
├── data-model.md        # Phase 1 output — tables, resolution rules, report shapes
├── quickstart.md        # Phase 1 output — validation scenarios V1–V10
├── contracts/
│   └── state-mapping-defaults.md   # Phase 1 output — C1–C7 behavioral contract
├── checklists/
│   └── requirements.md  # spec-phase quality checklist (passed)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── defaults.ts        # + DEFAULT_WORKFLOW_STATE_NAMES, DEFAULT_LANE_STATE_MAP,
│   │                      #   stateMappingEnabled: true   (release-scan clean)
│   ├── load.ts            # + applyStateMappingDefaults(merged) resolution pass (C2)
│   ├── schema.ts          # ResolvedConfig/ConfigOverrides additive: stateMappingEnabled
│   └── validate.ts        # unchanged (C2.4 — authored blanks still LaneMapError)
├── domain/
│   └── routing.ts         # WorkflowStateIdentities += mappingEnabled? (A-024-1)
├── engine/
│   ├── state-validation.ts  # NEW — BootstrapMappingReport + StateMappingBootstrapError (C4)
│   ├── completion.ts      # + stateMappingActive(); null-tolerant reads (C3/C5)
│   ├── build.ts           # gate completion+lane paths; validator call in bootstrap mode
│   └── apply.ts           # bootstrap re-check pre-mutation; disable posture on create path
├── cli/
│   └── exit-codes.ts      # register StateMappingBootstrapError + LaneMapError → exit 3
└── (ports, tracker, discovery, parsing: untouched)

tests/
├── unit/            config-state-mapping-defaults · state-validation · exit-codes
├── integration/     state-mapping-defaults (framework matrix) · state-mapping-lanes-default
│                    · bootstrap-mapping-validation (failure/zero-mutation/re-run/sync-skip)
├── contract/        frozen-surface.json regeneration · defaults-scan · exit-code table pin
├── e2e/             CLI bootstrap refusal (exit 3 + message content) · happy zero-config
└── (property/security cross-cutters: canonicalize determinism, diagnostics screening)

docs/ + governance (implementation-time, FR-012/C7):
├── README.md · docs/configuration.md · docs/configuration-reference.md
├── docs/cli.md · CHANGELOG.md
└── docs/contract-amendments.md (A-024-0/1/2) · .specify/memory/constitution.md (v1.1.0)
```

**Structure Decision**: No new top-level layout — the single-package library/CLI structure is
extended in place. Config-layer owns the defaults and resolution pass; the engine owns the
gates and the validator (so all surfaces inherit per Principle V); CLI owns only the
exit-code registration.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle III (pre-amendment): per-team workflow-state identities must have **no** built-in default; this feature ships default names + lane map | User-directed core of the feature (default-on requires a default mapping); values are Linear's own platform-generic default state names — zero org-specific literals; every entry remains overridable with unchanged precedence; resolved through the Governance amendment procedure (v1.1.0, MINOR) rather than silent deviation | *Engine-time fallback without a config default* — rejected (research R1): forks resolution truth between config and engine, breaking canonical-config determinism and honest validation/reporting; *keeping consumer-required validation* — rejected: directly contradicts spec FR-001/004/SC-001 |
