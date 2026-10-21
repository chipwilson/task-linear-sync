# Implementation Plan: Core Domain Contracts, Configuration, and Run State

**Branch**: `002-core-domain-contracts` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-core-domain-contracts/spec.md`

## Summary

This is the foundation feature (Wave 1) of the `task-linear-sync` decomposition. It freezes
the seams every other feature (003–013) builds against — the canonical entity shapes, the
`Linear_Port` tracker-port surface, the single gated engine-apply entry and gate vocabulary,
the deterministic attachment-URL scheme, and the plan/review-report artifact schema — and it
delivers two fully behavioral components: the layered configuration model (defaults → JSON
file → programmatic overrides, deep-merged, fail-fast and complete on misconfiguration) and
the out-of-repo run-state lifecycle (state directory placement, manifest expiry, advisory
run lock with stale takeover, create-intent bookkeeping, sanitized reports, last-run
marker). Delivered as the pure core of the publishable npm package: TypeScript, ESM,
Node ≥ 20, zero runtime dependencies for this feature, and a hermetic `node:test` suite
that makes the frozen contract surface itself test-enforced.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per exported module; Node.js ≥ 20.0.0 engine constraint (constitution "Technology stack")

**Primary Dependencies**: None at runtime for this feature — Node built-ins only (`node:crypto`, `node:fs`, `node:path`, `node:os`, `node:test`). The single platform-transport dependency (Linear GraphQL) and the MCP SDK subpath arrive with features 007/012, behind contracts frozen here.

**Storage**: Local filesystem only — JSON state files under the out-of-repo `State_Directory`, written with temp-file + atomic-rename and owner-only permissions. Audit-manifest encryption envelope (AES-256-GCM, versioned) is defined as a contract here; 008 exercises journaling behavior.

**Testing**: `node:test` (built-in runner) + `node:assert/strict`; unit tests over the pure core, contract tests that snapshot the frozen exported type surface, integration tests over config/state fixtures. Zero network, zero wall-clock nondeterminism (clock injected).

**Target Platform**: Node.js ≥ 20 CLI/library host (Linux, macOS, Windows); consumed as an npm package by features 003–013 in the same repository.

**Project Type**: Single npm package (library + shared core); this feature owns `src/config`, `src/state`, and the frozen contract modules under `src/domain`, `src/ports`, `src/urls`, `src/gates`.

**Performance Goals**: Config load + validation and state-directory resolution are local-only operations; deterministic merge + validation in < 100 ms for realistic configs. No network paths exist in this feature.

**Constraints**: Zero runtime dependencies (constitution); zero real organization identifiers/tokens/UUIDs in shipped defaults (release-gate scan); repository working tree must receive zero state files (SC-003); constitution v1.0.0 governs merge semantics, locking, encryption, screening, credential handling — cited, not re-authored.

**Scale/Scope**: 13 feature specs consume these contracts; ~20 canonical entities; 1 config model; 8 frozen contract documents. Wave-1: blocks Wave 2 (003–007).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Contracts freeze the gate vocabulary (apply flag, exact `Confirmation_Key`, accept-low-confidence, fresh `Plan_Reference`) and the zero-mutation read-only rule; run-state lifecycle is out-of-repo, owner-only, atomic-write, journaled/encrypted by contract; rollback refuses unjournaled. This feature performs no mutations at all. | PASS |
| II. Durable Identity | `Stable_UUID` derivation contract and the deterministic `Attachment_URL` / continuation-page scheme are frozen here exactly as the constitution mandates (page-0 anchor, never description, never in-file marker). | PASS |
| III. Intelligent Defaults, Overridable Configuration | Config model implements defaults → file → programmatic deep-merge precedence; required workspace identities have no defaults; abort names every missing value; shipped defaults contain only generic `toolId`/`Confirmation_Key` placeholders and a benign placeholder base host. | PASS |
| IV. Determinism and Idempotency | Byte-identical merged config for identical inputs (SC-001); deterministic state-dir naming by hash of canonical repo root; deterministic URL and UUID schemes; injected clock for expiry/lock-age tests. | PASS |
| V. One Engine, Additive Surfaces | The single gated engine-apply entry (`applySyncPlan`) and the injectable `Linear_Port` are defined here as the only seams; 009/010/012 are typed as callers. No parallel gates or ports are introduced. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR/SC maps to at least one automated test (see quickstart.md mapping); contract tests freeze the exported surface; hermetic by construction (pure core, no transport dependency in this feature). | PASS |
| Additional constraints | Node built-ins only; advisory lock records pid + timestamp with the exact stale rule; AES-256-GCM versioned envelope contract with key-not-stored-with-ciphertext rule; no organization-specific literals; ESM + declarations + `exports`/`types` fields. | PASS |
| Development workflow / quality gates | `tsc` type-check, lint, build, and full `node:test` suite wired for the project pipeline; no pipeline secret needs here (no network). | PASS |

**Pre-research gate result: PASS — no violations; Complexity Tracking unused.**

## Project Structure

### Documentation (this feature)

```text
specs/002-core-domain-contracts/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # name task-linear-sync; ESM; exports + types; engines >=20
tsconfig.json                    # strict, NodeNext module resolution, declaration: true

src/
├── index.ts                     # public entry — re-exports frozen contract modules
├── domain/                      # canonical entity types (Task, Match, Checkpoint, Plan, …)
│   ├── task.ts                  # Task, TaskFile, TaskBodyExtent, FrameworkId, TaskKind
│   ├── match.ts                 # Match, Confidence, MatchMargin, alternatives
│   ├── routing.ts               # RoutingEntry / ProjectByPath, team identity shapes
│   ├── state-payload.ts         # SyncStatePayload, SyncHistoryEvent, AttachmentChain
│   ├── checkpoint.ts            # Checkpoint, ConflictResolutionMap, ConflictAction,
│   │                            #   DescriptionConflictType
│   ├── plan.ts                  # Plan, PlanTaskEntry, PlanGuards, PlanReference validity
│   └── run-records.ts           # AuditManifest(+envelope), CreateIntent(+lifecycle),
│                                #   PendingJob, LastRunMarker, RunLock, HookDefinition/Block
├── config/
│   ├── schema.ts                # ResolvedConfig / Overrides partial types, required-identity keys
│   ├── defaults.ts              # built-in defaults (zero org literals — release-scan target)
│   ├── merge.ts                 # deep-merge (objects recursive; arrays/scalars replace)
│   ├── load.ts                  # file load with failure categories; layering
│   └── validate.ts              # complete-listing required-identity validation
├── state/
│   ├── paths.ts                 # state-dir resolution: configured | platform default by
│   │                            #   sha256(canonical repo root); inside-repo refusal
│   ├── fs.ts                    # owner-only dirs/files, temp+rename atomic write, JSON codecs
│   ├── lock.ts                  # advisory lock acquire/stale-takeover (dead pid AND aged)
│   ├── manifest.ts              # envelope codec (AES-256-GCM contract), expiry rule
│   ├── intent.ts                # create-intent write-before-attempt store
│   ├── marker.ts                # last-run marker; sanitized report writers (002 lifecycle half)
│   └── clock.ts                 # injectable clock (test determinism, Principle IV/VI)
├── urls/
│   └── attachment-url.ts        # canonical + continuation URL builders from templates
├── gates/
│   └── gates.ts                 # gate vocabulary: GateRequest, GateFailure codes
└── ports/
    ├── linear-port.ts           # Linear_Port interface (types only; no transport here)
    └── engine.ts                # buildSyncPlan / applySyncPlan signatures (008 implements)

tests/
├── unit/                        # config merge/load/validate, urls, paths, lock, expiry,
│                                #   intent/marker lifecycle, uuid seed (config/state pure core)
├── contract/                    # frozen-surface snapshots of exported types + config defaults
│                                #   scan asserting zero org literals
├── integration/                 # layered config fixtures; state-dir placement across two repo
│                                #   fixtures; lock takeover races; aged-manifest expiry
└── e2e/                         # scripted end-to-end of config load → state lifecycle per spec
                                 #   user stories (still zero network — no port exists yet)
```

**Structure Decision**: Single npm package (constitution "Technology stack"). Wave-2+ features
add sibling modules (`src/discovery`, `src/parsing`, `src/routing`, `src/matching`,
`src/tracker`, `src/engine`, `src/cli`, …) against these modules and import them only through
this package's declared subpath exports; no other feature edits files under `src/domain`,
`src/config`, `src/state`, `src/urls`, `src/gates`, or `src/ports` except by constitution-
governed cross-feature amendment (FR-008). Contract documents in `specs/002-core-domain-
contracts/contracts/` are the spec-facing mirror of `src/` signatures; the contract test keeps
them honest.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/)**: All gates above
still PASS. The design adds no dependencies, no mutation paths, no repository-tree writes,
and the contract set matches the "Contracts frozen here" enumeration in the spec without
adding capability. Re-check result: **PASS**.
