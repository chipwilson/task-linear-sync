# task-linear-sync

A reusable npm library + CLI that keeps spec-driven-development task files in a repository bidirectionally synced with **Linear** issues — maintaining a "golden thread" of traceability between the specs you plan with and the issues you track work in.

> **Status: pre-implementation.** This repository currently contains specifications and plans only — no source code yet. See [Current Status](#current-status).

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

**Planned tech stack** (per the ratified constitution): TypeScript 5.x in strict mode, ESM with generated `.d.ts`, Node.js ≥ 20, runtime dependencies limited to Node built-ins plus exactly one platform transport dependency; `node:test` for testing.

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
└── specs/
    ├── requirements.md       # Master requirements (R1–R29) + glossary
    ├── ROADMAP.md            # Feature decomposition into waves
    ├── 001-extract-functional-requirements/
    │   └── spec.md           # FR-001…FR-097 traceability catalog
    ├── 002-core-domain-contracts/   # Active feature: domain contracts
    │   ├── spec.md
    │   ├── plan.md           # Planned src/ layout, stack, constitution gates
    │   ├── research.md       # Resolved design decisions (R1–R16)
    │   ├── data-model.md     # ~20 canonical entities
    │   ├── quickstart.md     # Planned npm scripts and validation scenarios
    │   └── contracts/        # Frozen contracts: task model, config, state,
    │                         # URLs, gates, tracker port, plan-report schema
    └── 003…013-*/            # Draft feature specs (one per capability)
```

The planned **source** layout (from `specs/002-core-domain-contracts/plan.md`, not yet created):

```
src/
├── domain/    # canonical entities: task, match, routing, state, plan, records
├── config/    # schema, defaults, merge, load, validate
├── state/     # paths, fs, locking, manifest, intent, clock
├── urls/      # attachment URL builders
├── gates/     # confirmation-gate vocabulary
└── ports/     # Linear_Port interface, buildSyncPlan / applySyncPlan signatures
tests/
└── unit | contract | integration | e2e
```

Later waves add `discovery`, `parsing`, `routing`, `matching`, `tracker`, `engine`, and `cli` modules.

## Current Status

_Last updated: 2026-10-21 · branch `main`_

- ✅ **Constitution ratified** — `.specify/memory/constitution.md` v1.0.0 (2026-10-20): safety-first, durable identity, overridable defaults, determinism/idempotency, one engine with additive surfaces, test-first quality gates.
- ✅ **Requirements complete** — `specs/requirements.md` (29 requirements) and the 97-item FR traceability catalog (feature 001) reviewed and checklist-passed.
- ✅ **Roadmap defined** — 12 build features (002–013) in 4 waves: contracts first (002), then discovery/parse/route/match/tracker in parallel (003–007), engine integration (008), then CLI/queue/web/MCP/CI (009–013).
- 🚧 **Feature 002 (core domain contracts) planned** — plan, research, data model, quickstart, and 8 frozen contracts (including the plan-report JSON Schema) are done; contracts may now change only by amendment.
- 📝 **Features 003–013 are draft specs only** — no tasks or plans yet.
- ❌ **No implementation** — no `package.json`, source, or tests exist yet; nothing can be built or run.

**Next steps:** generate tasks for feature 002 (`/speckit.tasks`), implement it (`/speckit.implement`) to freeze the contracts, which unblocks the Wave-2 parallel build of features 003–007.
