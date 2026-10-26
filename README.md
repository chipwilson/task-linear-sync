# task-linear-sync

A reusable npm library + CLI that keeps spec-driven-development task files in a repository bidirectionally synced with **Linear** issues — maintaining a "golden thread" of traceability between the specs you plan with and the issues you track work in.

> **Status: Wave 2 complete.** All six library features shipped so far are merged on `main`: the frozen foundation (002) plus discovery & framework adapters (003), task parsing & line rendering (004), routing & title derivation (005), task↔issue matching (006), and the issue-tracker integration port (007) — 645 tests green behind CI. The Wave-3 sync engine (008) is next; user-facing surfaces (CLI, queue, web, MCP, CI — 009–013) follow in Wave 4. See [Current Status](#current-status).

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
├── src/                      # 002 contracts/config/run-state + Wave-2 modules
│                             #   (discovery, parsing, routing, titles, matching, tracker)
├── tests/                    # unit / contract / integration / e2e (hermetic, zero-network)
├── docs/                     # Config reference, amendment rule, per-feature usage guides
│                             #   (discovery, parsing, routing & titles, matching, tracker)
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
    ├── 003…007-*/            # Wave-2 specs — implemented and merged (all tasks delivered)
    └── 008…013-*/            # Draft feature specs (one per capability; 008 is next)
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

Wave 2 added the `discovery`, `parsing`, `routing`, `titles`, `matching`, and `tracker` modules — all merged; later waves add `engine` (008) and `cli` (009). The published subpath exports today: `.`, `./domain`, `./config`, `./state`, `./urls`, `./gates`, `./ports`, `./tracker`, `./tracker/testing`, `./parsing`, `./matching`, `./discovery` (`./routing`/`./titles` are consumed internally per 005's plan and surface with the 008 integration).

## Matching usage (feature 006)

`task-linear-sync/matching` is a pure task ↔ issue matching brain: it turns fetched
tracker views into scored, banded, one-to-one matches — deterministic, explainable,
durable-identity aware. Full reference: [`docs/matching.md`](docs/matching.md).

```ts
import { loadConfig } from "task-linear-sync/config";
import {
  projectCandidates,
  matchAllTasks,
  serializeMatchingResult,
} from "task-linear-sync/matching";

const config = loadConfig({});
const candidates = projectCandidates({ issues, attachmentsByIssue, config }); // identity from canonical page-0 attachments only
const result = matchAllTasks([{ task }], candidates, config); // tasks + candidate issue views
console.log(serializeMatchingResult(result)); // stable-key-sorted JSON (byte-identical re-runs)
```

Every match carries `score`, `margin`, `confidence` (`high`/`medium`/`low`),
`durableIdentity`, machine-readable `reasons`, and up to three ranked `alternatives`.
An issue carrying a task's durable identity matches across team/project/framework moves
and renames; two issues claiming one task UUID abort the run with
`DurableIdentityCollisionError` and no changes.

## Current Status

_Last updated: 2026-10-26 · branch `main` (Wave 2 complete)_

- ✅ **Constitution ratified** — `.specify/memory/constitution.md` v1.0.0 (2026-10-20): safety-first, durable identity, overridable defaults, determinism/idempotency, one engine with additive surfaces, test-first quality gates.
- ✅ **Requirements complete** — `specs/requirements.md` (29 requirements) and the 97-item FR traceability catalog (feature 001) reviewed and checklist-passed.
- ✅ **Roadmap defined** — 12 build features (002–013) in 4 waves: contracts first (002), then discovery/parse/route/match/tracker in parallel (003–007), engine integration (008), then CLI/queue/web/MCP/CI (009–013).
- ✅ **Feature 002 (core domain contracts) implemented** — all 54 tasks delivered: canonical entities, the config model with a secret-free provenanced baseline, the run-state lifecycle (manifests, durable intents, advisory locking, atomic state filesystem), the attachment URL scheme, the gate vocabulary, and the frozen `Linear_Port` / `buildSyncPlan` / `applySyncPlan` boundaries. Backed by 111 hermetic zero-network tests across four tiers, an enforced coverage threshold gate (80/70/80 lines/branches/functions), and CI on the Node 20–24 range. The frozen export surface is guarded by a checked-in snapshot; changes follow `docs/contract-amendments.md`. Usage and configuration docs: `docs/configuration.md`, `docs/validation-002.md`.
- ✅ **Wave 2 complete — features 003–007 all merged** (planning PRs #2–#6; implementation PRs #7, #9, #11, #12, #13), each built on its own branch/worktree in parallel atop the frozen 002 contracts and delivered TDD-first with its full task list: **003** discovery & framework adapters (38 tasks; safe deterministic traversal, five built-in adapters behind the snapshot-frozen `FrameworkAdapter` interface, git-context capture — `./discovery`); **004** task parsing & line rendering (34 tasks; strict CommonMark task lists, stable identities, byte-exact rendering — `./parsing`); **005** routing & title derivation (31 tasks; frozen `RoutingResolution`, prefix-stable titles); **006** task↔issue matching (40 tasks; eight-signal scoring, globally optimal JV/Hungarian assignment verified against a brute-force oracle, durable-identity survival — `./matching`); **007** issue-tracker integration port (51 tasks; real + fake `Linear_Port` with byte-identical conformance parity, retry/backoff with create-never-retried, credential screening, attachment chain walk — `./tracker` + `./tracker/testing`). Per-feature usage guides live in `docs/`. Zero runtime dependencies held throughout; the frozen 002 surface never drifted (snapshot-enforced).
- 📝 **Features 008–013 remain draft specs** — the sync engine (008) composes the Wave-2 modules into the single gated engine; surfaces 009–013 layer on the frozen engine/report contracts.
- ✅ **The repo builds and tests** — `npm ci && npm test` (also `lint`, `typecheck`, `build`, and per-tier `test:unit|contract|integration|e2e` scripts): **645/645 tests green** across the four tiers, coverage 96.3% lines / 90.7% branches / 97.8% functions against the 80/70/80 gate, CI green on the Node 20 + 24 matrix. Note the scope: the full library brain exists — discovery, parsing, routing/titles, matching, and the tracker port with real + fake adapters — but there is still no composed engine; that arrives with 008.

**Next steps:** run Wave 3 — feature 008 (sync engine: conflicts, state, apply, rollback) — via `/speckit.plan`, `/speckit.tasks`, and `/speckit.implement` on top of the frozen contracts and merged Wave-2 modules; then Wave 4's parallel surfaces (009 operator CLI, 010 background queue & hooks, 011 sync-history web page, 012 AI-agent tool interface, 013 CI enforcement), each via the same `/speckit.*` pipeline.

## Tracker integration port (feature 007)

The Linear adapter implementing the frozen `Linear_Port` contract now ships at the
`task-linear-sync/tracker` and `task-linear-sync/tracker/testing` subpath exports — the
complete GraphQL surface with the built-in-retry posture, the attachment-URL identity
machinery (canonical/continuation chain walk), the credential pre-flight, and the
fake-port + recorded-replay testing harness that drives both under one conformance suite.
Usage, configuration, resilience posture, and fixture-corpus guide:
[`docs/tracker-integration.md`](docs/tracker-integration.md).
