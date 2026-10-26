# Implementation Plan: Sync Engine — Conflict Resolution, State Persistence, Apply, and Rollback

**Branch**: `008-sync-engine-apply-rollback` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-sync-engine-apply-rollback/spec.md`

## Summary

This is the Wave-3 integration feature that implements the frozen `SyncEngine` contract
(`specs/002-core-domain-contracts/contracts/engine-gates.md`, `src/ports/engine.ts`) behind
`buildSyncPlan` / `applySyncPlan` / `rollbackRun`, composing 003–007 into the single gated
engine: bootstrap-vs-sync mode selection from checkpoint presence; three-way description
conflict classification (`linear-changed` / `spec-changed` / `both-changed`) against the
per-task Checkpoint; the six resolution actions with frozen default maps; git-style
conflict-marker blocks with the frozen-block rule; checkbox→workflow completion mapping;
authoritative page-0 sync-state payload rewriting with append-only, rolling history
continuation pages; parent-before-child create ordering with reverse sibling emission;
create-intent-before-attempt with indeterminate reconciliation (never auto-replayed); and
the journaled, resumable apply→rollback lifecycle that restores files, issue fields, and
checkpoints while never rewinding sync history or durable identity. Headline plan
decision: **zero new runtime dependencies and zero edits to any frozen 002 module** — the
engine is a new disjoint `src/engine/` module group behind one additive `./engine` subpath
export (research R1), consuming 003 discovery, 004 parsing/rendering, 005 routing/titles,
006 matching, and the 007 real port + behaviorally identical fake exactly as frozen.
Rollback step-guard material the frozen `Audit_Manifest` shape does not carry (per-step
before/result snapshots) is journaled in an 008-local encrypted step journal using the same
AES-256-GCM envelope and expiry posture, documented as a deferred amendment candidate
exactly as 007 R11 did for its local option (research R9).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per
exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). No toolchain changes.

**Primary Dependencies**: **None added at runtime — explicit plan decision (research R1),
continuing the 002/007 posture.** The engine imports only Node built-ins and the existing
frozen/local modules: `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`,
`src/ports` (002), `src/discovery` (003), `src/parsing` (004), `src/routing` + `src/titles`
(005), `src/matching` (006), `src/tracker` + `src/tracker/testing` (007). The MCP SDK
remains 012's separately scoped concern.

**Storage**: Two stores, both already shaped in 002. (a) **Local run-state**: the
platform-default state directory *outside* the repository working tree (owner-only, atomic
writes via `src/state`): `sync-state.json` checkpoint store (008 read/write per 002
data-model §6), encrypted `Audit_Manifest` journal, 008-local encrypted step journal
(research R9), create intents (`src/state/intent.ts`), stored plans, run reports,
`last-run.json`. (b) **Tracker-side durable state**: the page-0 canonical
`Sync_Attachment` (identity anchor + non-history `SyncStatePayload`, rewritten
authoritatively each apply after screening) and deterministic continuation attachment
pages carrying the append-only `Sync_History_Log`. No database; the tracker plus the state
directory are the totality of persistence.

**Testing**: `node:test` + `node:assert/strict`, existing tiers (`unit`, `contract`,
`integration`, `e2e`) via `scripts/run-tests.mjs`; tests exercise the engine through the
frozen `SyncEngine` interface with the 007 fake `LinearPort` injected (`./tracker/testing`)
and a temp-directory state store — zero real network, zero real credentials, wall-clock
nondeterminism eliminated by the injected `Clock` (constitution VI). Cross-cutting types
required and delivered: **property-based** (apply-twice convergence SC-001; frozen conflict
blocks survive arbitrary intervening runs byte-for-byte SC-004; rollback total-restoration
SC-003; normalized-hash classification never fires on formatting-only noise SC-002),
**contract** (gate-failure vocabulary matches `src/gates` frozen codes; plan-report JSON
matches 002 `plan-report.schema.json`; rollback refuses `MANIFEST_UNJOURNALED`/
`MANIFEST_EXPIRED`), and **security** (screener-blocking aborts propagation with zero
transmitted content — assert on fake-port call log; secret sentinels never appear in
reports/logs/manifests; no-direct-tracker-import scan on `src/engine`). Full
6 actions × 3 conflict types × 2 modes fixture matrix per SC-004.

**Target Platform**: Node.js ≥ 20 library host (Linux, macOS, Windows); consumed as
`task-linear-sync/engine` by 009 (CLI), 010 (worker), 012 (agent tool) — all callers of the
same engine per constitution V, none a parallel implementation.

**Project Type**: Single npm package (existing); this feature owns the disjoint
`src/engine/` module group and its tests/fixtures. No frozen 002 module and no other Wave-2
module is edited (ROADMAP rule 2); 008 imports them.

**Performance Goals**: Plan/apply over spec-scale repositories (thousands of tasks) with
per-issue tracker reads batched by the 007 port's pagination; one attachment upsert per
task per apply at steady state (zero writes when converged — SC-001); history pages capped
at `historyLogMaxEntries` (default 50) / `historyLogMaxBytes` so per-issue metadata stays
within platform limits; rollback cost linear in journaled steps.

**Constraints**: Zero new runtime dependencies (R1); `buildSyncPlan` performs zero tracker
mutations and zero repository writes (constitution I); `applySyncPlan` is THE single
mutating entry enforcing the frozen order gates → lock → plan-stability re-check →
manifest-complete-before-first-mutation → screened journaled mutations; every propagated
string passes the `SecurityScreener` before transmission and a blocking finding aborts that
content only; created issues are never auto-retried/replayed (create intent +
reconciliation per constitution Resilience); sync history is append-only — rollback
appends a `rollback` event, never rewinds (Principle IV); distributed defaults carry zero
real organization identifiers; frozen modules are import-only.

**Scale/Scope**: 16 FRs (001 FR-036…042, 049…051, 057…062), 4 SCs, 2 user stories; the
frozen `SyncEngine` 3-method contract implemented once; ~13 engine source modules; 6
resolution actions × 3 conflict types × 2 modes = 36 fixture cells (SC-004); rollback
interrupt-at-each-step matrix over the journal step kinds.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | `buildSyncPlan` is read-only end-to-end (zero mutations, zero repo writes — frozen contract + plan-guards capture only). `applySyncPlan` enforces the frozen order verbatim: exact `Confirmation_Key` match, apply flag, low-confidence acceptance, fresh `Plan_Reference` with re-evaluated guards **plus per-issue snapshot re-fetch**; advisory lock via frozen `src/state/lock.ts`; journal complete before first mutation; rollback **refuses** (`MANIFEST_UNJOURNALED` / `MANIFEST_EXPIRED`) rather than proceeding unjournaled. Every transmitted description/attachment payload/history string passes the injected `SecurityScreener` first; a blocking finding aborts propagation of the affected content only (no partial transmission). All state writes land in the state directory outside the working tree, owner-only + atomic. | PASS |
| II. Durable Identity | Checkpoints, payloads, and journal steps key on the frozen `stableUuid`; the identity anchor is rewritten only into the page-0 canonical attachment at the deterministic idempotent URL — never into an issue description, never as an in-file marker (conflict markers carry labels only, no UUIDs — research R4). Indeterminate-create reconciliation counts issues via `findIssuesByAttachmentUrl` only (no description search). More than one issue carrying one task UUID is handled as the hard integrity failure the constitution demands: create aborted, task further-creation aborted, surfaced — never silently adopted (research R8). | PASS |
| III. Intelligent Defaults, Overridable Configuration | Built-in default conflict maps land exactly on FR-004 (bootstrap: all three → `overwrite-linear`; sync: `spec-changed`→`overwrite-linear`, `linear-changed`→`overwrite-spec`, `both-changed`→`report-only`), overridable via the frozen `bootstrapConflictMap` / `syncConflictMap` config keys through the frozen deep-merge chain. History thresholds, normalization profile, marker labels (toolId-derived), and screener rules all ship as overridable defaults; workflow done/backlog identities are consumer-required per-team values with **no** built-in default, consistent with the frozen config model. Zero organization literals in defaults, markers, or fixtures. | PASS |
| IV. Determinism and Idempotency | Mode selected deterministically from checkpoint presence (FR-001); apply emits creates parent-before-child with siblings in reverse working order (FR-011, deterministic by construction); attachment upserts are URL-idempotent (FR-015, no duplicates on resume/repeat); second apply over unchanged inputs yields zero pending changes and zero writes (SC-001); normalized-content-hash classification makes formatting-only drift a permanent no-op (SC-002, constitution "Conflict-free sync"); `Sync_History_Log` is append-only including rollback-as-append (FR-009/016); opIds and journal step identities derive deterministically from `(planId, taskUuid, kind)` — clock-only timestamps from the injected `Clock`. | PASS |
| V. One Engine, Additive Surfaces | This feature **is** the engine: it implements the frozen `SyncEngine` interface exactly once behind one additive `./engine` export; 009/010/012 receive `applySyncPlan`/`rollbackRun` by injection and gain no parallel path. All tracker access flows through the injected `Linear_Port` (no HTTP, no port bypass inside `src/engine` — enforced by a no-direct-tracker-import source scan test). The engine adds no port methods and edits no frozen gating vocabulary. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR and SC maps to at least one automated test (quickstart traceability table). Pyramid: unit (pure classification, action resolution, marker synthesis, history rollover, op ordering, screening) → contract (frozen gate vocabulary, plan-report schema conformance, engine-gates enforcement order) → integration (fake `LinearPort` worlds for every US1/US2 acceptance scenario, incl. interruption matrix) → thin e2e story walkthroughs. Property-based, contract, and security tests are delivered, not deferred. Hermetic: fake port, temp state dirs, injected clock; coverage threshold inherited from the `npm test` gate. | PASS |
| Additional constraints | *Port/adapter*: engine consumes `LinearPort` by injection only; fake conforms to the 007 conformance suite it already passes. *Credential handling*: engine never reads credentials — the port owns that; screener strips secrets from all propagated text. *Resilience*: create is attempted once per plan (intent persisted before attempt), failures reconcile via identity lookup, never replayed (FR-012); non-create retry posture is the port's, untouched. *Locking/integrity*: frozen lock semantics; journal and step journal both AES-256-GCM versioned envelopes via `src/state/manifest.ts`; tag-check failure rejects with no plaintext. *Technology stack*: runtime dependencies stay at Node built-ins (budget unspent); one additive exports entry. *No organization-specific literals*: marker labels derive from `toolId`; fixtures use placeholders only. | PASS |
| Development workflow / quality gates | No pipeline or tooling changes: existing tiers and the coverage gate run the new files. The step-journal extension is written through the same atomic, private-permission, encrypted path as the manifest, so the "run state outside the working tree / owner-only / atomic" constraint extends to it unchanged. Documentation duty: engine usage scenarios land in `docs/` alongside the plan-report contract references in this spec folder. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/008-sync-engine-apply-rollback/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 008-local interfaces only
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # + one exports entry "./engine" (additive; deps unchanged)

src/
├── domain/ config/ state/ urls/ gates/ ports/   # FROZEN (002) — imported, never edited
├── discovery/ parsing/ routing/ titles/         # 003–005 — imported via package modules
├── matching/                                    # 006 — imported
├── tracker/                                     # 007 — real port + fake, imported
└── engine/                            # ← 008's disjoint module group
    ├── index.ts                       # public surface for the ./engine subpath
    ├── create.ts                      # createSyncEngine(deps, options): SyncEngine — composition root
    ├── options.ts                     # EngineOptions (keyProvider, screener override, profile registry)
    ├── build.ts                       # buildSyncPlan: discover→parse→route→derive→match→classify→Plan
    ├── mode.ts                        # R2: mode selection + CheckpointStore (sync-state.json) read/write
    ├── classify.ts                    # R3: normalized-hash change detection → DescriptionConflictType
    ├── normalize.ts                   # R5: Description_Normalization_Profile registry (built-in default)
    ├── actions.ts                     # R6: action resolution (map + defaults) and effect application
    ├── markers.ts                     # R4: git-style conflict-marker synthesis + nested-block refusal
    ├── completion.ts                  # R7: checkbox→workflow-state mapping (done/backlog)
    ├── payload.ts                     # R8: SyncStatePayload rewrite + history append + rollover pages
    ├── history-page.ts                # R8: continuation-page payload shape + deterministic addressing
    ├── apply.ts                       # R9/R10: mutation pipeline (gates→lock→guards→journal→mutations)
    ├── ops.ts                         # R10: op taxonomy, deterministic opIds, inverse material
    ├── journal.ts                     # R9: manifest + step-journal write/seal/resume, step-state guard
    ├── rollback.ts                    # R11: resumable guarded rollback, history-preservation rules
    ├── screening.ts                   # R12: default SecurityScreener implementation
    ├── report.ts                      # R13: plan/run report artifacts (JSON per frozen schema + MD)
    └── errors.ts                      # R14: EngineError taxonomy (deterministic refusals reuse GateFailure)

tests/
├── unit/                            # engine-classify / engine-actions / engine-markers /
│                                    #   engine-completion / engine-history-rollover /
│                                    #   engine-ops-order / engine-screening / engine-mode
├── contract/                        # engine-gate-order (frozen refusal vocabulary + complete
│   │                                #   listing), engine-plan-report-schema (002 schema conformance),
│   │                                #   engine-no-direct-tracker (import scan), engine-packaging
│   │                                #   (./engine resolves), engine-hygiene (zero-org-literals)
├── integration/                     # engine-bootstrap, engine-conflict-matrix (36-cell SC-004),
│   │                                #   engine-completion-states, engine-apply-creates
│   │                                #   (parent-before-child + reverse siblings + indeterminate),
│   │                                #   engine-attachment-state (payload rewrite + rollover),
│   │                                #   engine-rollback (restore matrix + interrupt/resume per step),
│   │                                #   engine-fail-abort (fail action mid-run), engine-lock-contention
├── e2e/                             # engine-user-stories (US1 drift-reconciliation + US2
│   │                                #   apply→rollback walkthroughs over the fake, zero network)
├── helpers/engine-harness.ts        # fake-world builder, temp state store, fixture repo builder,
│   │                                #   scripted create-failure + rollback-interruption injectors
└── fixtures/engine/
    ├── README.md                    # fixture conventions (placeholders only)
    └── worlds/                      # first-run-bootstrap/, linear-changed/, spec-changed/,
        │                            #   both-changed/, unresolved-block/, completion-toggle/,
        │                            #   indeterminate-create/, history-rollover/,
        │                            #   formatting-noise/, rollback-full/, rollback-interrupted/
```

**Structure Decision**: Single npm package (constitution "Technology stack"), continuing
002's pre-reserved `src/engine` slot (002 plan Structure Decision reserved it for exactly
this feature) and following 007's disjoint-module precedent. 008 touches only
`src/engine/**`, `tests/**/engine-*` + `tests/fixtures/engine/**`,
`tests/helpers/engine-harness.ts`, one additive `package.json` exports entry, and its own
`specs/008-sync-engine-apply-rollback/**`. All frozen 002 modules and all Wave-2 modules
(003–007) are imported through their declared module surfaces, never edited (ROADMAP rule
2). Consumers (009/010/012) reach the engine only through `./engine`; tests inject the 007
fake through `./tracker/testing`. The engine implements `SyncEngine` and nowhere else —
there is no second apply path to diverge (constitution V).

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) an `AuditOperation` amendment to the frozen manifest shape to carry
per-step before/result snapshots — deferred as an amendment candidate in favor of the
same-envelope 008-local step journal (research R9, mirrors 007 R11 precedent); (2) a
database or SQLite run-state store — the frozen `StateStore` JSON + attachment-chain design
meets every 008 requirement; (3) a generic saga framework for rollback — the frozen
`AuditOperation.stepState` four-state guard plus deterministic per-kind guards is
sufficient and stays inside the frozen shape.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design adds no runtime dependency, no edits to any frozen
002 module or contract (the step journal is 008-local storage in the same encrypted
envelope, with the deferred amendment documented in research R9), no repository-tree
writes outside planned render updates, no description-search identity path (the engine
calls only the frozen port members), and the constitution-mandated property/contract/
security tiers are specified in quickstart.md with per-FR traceability. No Complexity
Tracking entries were created by the design.
