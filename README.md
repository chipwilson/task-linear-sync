# task-linear-sync

A reusable npm library + CLI that keeps spec-driven-development task files in a repository bidirectionally synced with **Linear** issues — maintaining a "golden thread" of traceability between the specs you plan with and the issues you track work in.

> **Status: Wave 2 in flight.** The foundation (feature 002) is implemented, tested, and frozen; all five Wave-2 features (003–007) have approved plans and task breakdowns, and Wave-2 implementation is underway on parallel branches — feature 004 (task parsing & in-place line rendering) is merged, 003/005/006/007 are in progress. The sync engine (008) and user-facing surfaces (CLI, queue, web, MCP, CI — 009–013) follow in later waves. See [Current Status](#current-status).

## Proposed Purpose

- **Discover** task files (`tasks.md` / `TASKS.md`) produced by spec frameworks such as **BMAD, GitHub Spec Kit, open-spec, Kiro, and generic Markdown** via pluggable framework adapters.
- **Parse** heading/checklist tasks, derive deterministic stable identities (UUIDs), and **match** them to Linear issues using weighted scoring with globally optimal one-to-one assignment.
- **Sync** both directions: mirror task content into issue descriptions, and write visible issue-key prefixes (e.g. `[KEY-123]`) back into the Markdown, with git-style conflict markers when both sides changed.
- **Persist sync state durably** in a Linear attachment (deterministic URL scheme), outside the repo, encrypted (AES-256-GCM) and journaled — never in descriptions or in-file.
- **Operate safely**: a single sync engine (`buildSyncPlan` / `applySyncPlan`) behind read-only plan surfaces, confirmation-gated apply, rollback of journaled runs, secret/PII screening, and idempotent byte-identical reruns.

Planned surfaces, all layered on the same engine:

| Surface | Description | Feature spec |
|---|---|---|
| Core library | Domain, contracts, discovery, parsing, matching, tracker port, engine | 002–008 |
| Operator CLI | `plan` / `apply` / `rollback` with review reports and gates | 009 |
| Background queue & hooks | Git hooks and agent hooks that enqueue syncs | 010 |
| Sync History web page | Optional Next.js/React viewer of sync runs | 011 |
| MCP server | AI-agent tool interface at `<pkg>/mcp` subpath | 012 |
| CI enforcement | GitHub Action (`task-linear-sync-action`) | 013 |

**Tech stack** (per the ratified constitution; in use since feature 002): TypeScript 5.x in strict mode, ESM with generated `.d.ts`, Node.js ≥ 20, runtime dependencies limited to Node built-ins plus at most one platform transport dependency — still **zero**: feature 007's Linear transport runs on Node ≥ 20's built-in `fetch`, leaving the one-transport allowance unspent; `node:test` for testing.

## Repository Layout

This repo follows [GitHub Spec Kit](https://github.com/github/spec-kit) spec-driven development (`/speckit.*` workflow):

```
task-linear-sync/
├── .opencode/commands/       # /speckit.* slash commands (specify, plan, tasks, implement, …)
├── .specify/
│   ├── memory/constitution.md # Ratified project constitution (v1.0.0)
│   ├── scripts/              # Spec Kit bash helpers (feature/plan/tasks scaffolding)
│   ├── templates/            # Spec/plan/tasks/checklist templates
│   └── workflows/            # Workflow registry and definitions
├── src/                      # Implemented by feature 002: contracts, config, run-state
├── tests/                    # unit / contract / integration / e2e (hermetic, zero-network)
├── docs/                     # Config reference, amendment rule, validation record
├── package.json              # ESM package (zero runtime deps), npm scripts, engines ≥ 20
└── specs/
    ├── requirements.md       # Master requirements (R1–R29) + glossary
    ├── ROADMAP.md            # Feature decomposition into waves
    ├── 001-extract-functional-requirements/
    │   └── spec.md           # FR-001…FR-097 traceability catalog
    ├── 002-core-domain-contracts/   # Feature 002 — implemented; contracts frozen
    │   ├── spec.md
    │   ├── plan.md           # src/ layout, stack, constitution gates
    │   ├── research.md       # Resolved design decisions (R1–R16)
    │   ├── data-model.md     # ~20 canonical entities
    │   ├── quickstart.md     # npm scripts and validation scenarios
    │   └── contracts/        # Frozen contracts: task model, config, state,
    │                         # URLs, gates, tracker port, plan-report schema
    ├── 003…007-*/            # Wave-2 specs — fully planned (plan, research, data-model,
    │                         #   contracts, quickstart, tasks); implementing on wave-2 branches
    └── 008…013-*/            # Draft feature specs (one per capability)
```

The **source** layout from `specs/002-core-domain-contracts/plan.md`, created by feature 002:

```
src/
├── domain/    # canonical entities: task, match, routing, state, plan, records
├── config/    # schema, defaults, merge, load, validate
├── state/     # paths, fs, locking, manifest, intent, clock
├── urls/      # attachment URL builders
├── gates/     # confirmation-gate vocabulary
└── ports/     # Linear_Port interface, buildSyncPlan / applySyncPlan signatures
tests/
└── unit | contract | integration | e2e (+ fixtures, helpers, negative-type tests)
```

Wave 2 adds `discovery`, `parsing`, `routing`, `matching`, and `tracker` modules — `parsing` has landed with feature 004; later waves add `engine` and `cli`.

## Current Status

_Last updated: 2026-10-23 · branch `main` (Wave-2 implementation in flight)_

- ✅ **Constitution ratified** — `.specify/memory/constitution.md` v1.0.0 (2026-10-20): safety-first, durable identity, overridable defaults, determinism/idempotency, one engine with additive surfaces, test-first quality gates.
- ✅ **Requirements complete** — `specs/requirements.md` (29 requirements) and the 97-item FR traceability catalog (feature 001) reviewed and checklist-passed.
- ✅ **Roadmap defined** — 12 build features (002–013) in 4 waves: contracts first (002), then discovery/parse/route/match/tracker in parallel (003–007), engine integration (008), then CLI/queue/web/MCP/CI (009–013).
- ✅ **Feature 002 (core domain contracts) implemented** — all 54 tasks delivered: canonical entities, the config model with a secret-free provenanced baseline, the run-state lifecycle (manifests, durable intents, advisory locking, atomic state filesystem), the attachment URL scheme, the gate vocabulary, and the frozen `Linear_Port` / `buildSyncPlan` / `applySyncPlan` boundaries. Backed by 111 hermetic zero-network tests across four tiers, an enforced coverage threshold gate (80/70/80 lines/branches/functions), and CI on the Node 20–24 range. The frozen export surface is guarded by a checked-in snapshot; changes follow `docs/contract-amendments.md`. Usage and configuration docs: `docs/configuration.md`, `docs/validation-002.md`.
- ✅ **Wave-2 planning complete** — features 003–007 each have a full design package (plan, research, data-model, contracts, quickstart, tasks) reviewed and merged to `main` (PRs #2–#6): 003 discovery & framework adapters (38 tasks), 004 task parsing & line rendering (34), 005 routing & title derivation (31), 006 task↔issue matching & confidence (40), 007 issue-tracker integration port (51).
- 🔄 **Wave-2 implementation in flight** — five features built concurrently on dedicated branches/worktrees atop the frozen 002 contracts, one PR each. **Feature 004 is merged** (PR #7): the `./parsing` subpath — strict CommonMark task-list parsing with heading/checklist/deny signals, stable task identities, and byte-exact in-place line rendering — landed with 72 new tests (repo suite: 183, CI green on the Node 20 + 24 matrix). Features 003, 005, 006, and 007 are implementing now on `00X-…-impl` branches; their PRs are pending.
- 📝 **Features 008–013 remain draft specs** — the sync engine (008) will compose the Wave-2 modules into the single gated engine; surfaces 009–013 layer on the frozen engine/report contracts.
- ✅ **The repo builds and tests** — `npm ci && npm test` (also `lint`, `typecheck`, `build`, and per-tier `test:unit|contract|integration|e2e` scripts). Note the scope: contracts, configuration, run-state, and task parsing are real — discovery/routing/matching/tracker land with the remaining Wave-2 PRs; the engine arrives with feature 008.

**Next steps:** merge the remaining Wave-2 PRs as they land (003, 005, 006, 007), then run Wave 3 — feature 008 (sync engine: conflicts, state, apply, rollback) composes 003–007 into the single gated engine — followed by Wave 4's parallel surfaces (009 operator CLI, 010 background queue & hooks, 011 sync-history web page, 012 AI-agent tool interface, 013 CI enforcement), each via `/speckit.tasks` and `/speckit.implement` on top of the frozen contracts.
