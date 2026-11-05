# task-linear-sync

A reusable npm library + CLI that keeps spec-driven-development task files in a repository bidirectionally synced with **Linear** issues — maintaining a "golden thread" of traceability between the specs you plan with and the issues you track work in.

> **Status: Wave 3 complete.** The frozen foundation (002), the Wave-2 library modules (003–007) and the sync engine (008) are merged on `main` — 949 tests green behind CI. The full `plan → apply → rollback` lifecycle runs today through `task-linear-sync/engine`. User-facing surfaces (CLI, queue, web, MCP, CI — 009–013) follow in Wave 4. See [Current Status](#current-status).

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
│                             #   + engine (008: the composed sync engine)
├── tests/                    # unit / contract / integration / e2e (hermetic, zero-network)
├── docs/                     # Config reference, amendment rule, per-feature usage guides
│                             #   (discovery, parsing, routing & titles, matching, tracker, engine)
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
    ├── 008-*/                # sync engine spec — implemented and merged (PR #15)
    └── 009…013-*/            # draft feature specs (one per capability)
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

Wave 2 added the `discovery`, `parsing`, `routing`, `titles`, `matching`, and `tracker` modules; Wave 3 added `engine` (008). The published subpath exports today: `.`, `./domain`, `./config`, `./state`, `./urls`, `./gates`, `./ports`, `./tracker`, `./tracker/testing`, `./parsing`, `./matching`, `./discovery`, `./engine` (`./routing`/`./titles` are consumed internally per 005's plan; the `cli` module arrives with 009).

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

_Last updated: 2026-11-05 · branch `main` (Wave 3 complete)_

- ✅ **Constitution ratified** — `.specify/memory/constitution.md` v1.0.0 (2026-10-20): safety-first, durable identity, overridable defaults, determinism/idempotency, one engine with additive surfaces, test-first quality gates.
- ✅ **Requirements complete** — `specs/requirements.md` (29 requirements) and the 97-item FR traceability catalog (feature 001) reviewed and checklist-passed.
- ✅ **Roadmap defined** — 12 build features (002–013) in 4 waves: contracts first (002), then discovery/parse/route/match/tracker in parallel (003–007), engine integration (008), then CLI/queue/web/MCP/CI (009–013).
- ✅ **Feature 002 (core domain contracts) implemented** — all 54 tasks delivered: canonical entities, the config model with a secret-free provenanced baseline, the run-state lifecycle (manifests, durable intents, advisory locking, atomic state filesystem), the attachment URL scheme, the gate vocabulary, and the frozen `Linear_Port` / `buildSyncPlan` / `applySyncPlan` boundaries. Backed by 111 hermetic zero-network tests across four tiers, an enforced coverage threshold gate (80/70/80 lines/branches/functions), and CI on the Node 20–24 range. The frozen export surface is guarded by a checked-in snapshot; changes follow `docs/contract-amendments.md`. Usage and configuration docs: `docs/configuration.md`, `docs/validation-002.md`.
- ✅ **Wave 2 complete — features 003–007 all merged** (planning PRs #2–#6; implementation PRs #7, #9, #11, #12, #13), each built on its own branch/worktree in parallel atop the frozen 002 contracts and delivered TDD-first with its full task list: **003** discovery & framework adapters (38 tasks; safe deterministic traversal, five built-in adapters behind the snapshot-frozen `FrameworkAdapter` interface, git-context capture — `./discovery`); **004** task parsing & line rendering (34 tasks; strict CommonMark task lists, stable identities, byte-exact rendering — `./parsing`); **005** routing & title derivation (31 tasks; frozen `RoutingResolution`, prefix-stable titles); **006** task↔issue matching (40 tasks; eight-signal scoring, globally optimal JV/Hungarian assignment verified against a brute-force oracle, durable-identity survival — `./matching`); **007** issue-tracker integration port (51 tasks; real + fake `Linear_Port` with byte-identical conformance parity, retry/backoff with create-never-retried, credential screening, attachment chain walk — `./tracker` + `./tracker/testing`). Per-feature usage guides live in `docs/`. Zero runtime dependencies held throughout; the frozen 002 surface never drifted (snapshot-enforced).
- ✅ **Feature 008 (sync engine) implemented and merged (PR #15)** — all 53 tasks delivered test-first across parallel worktree lanes (every story test authored red before its implementation): bootstrap-vs-sync mode selection from checkpoint presence; three-way normalized-hash conflict classification with the FR-004 default action maps; git-style conflict markers with the frozen-block rule; checkbox→workflow completion mapping; the frozen enforcement order `gates → lock → plan-stability re-check → journal-complete-before-first-mutation → screened journaled mutations`; create-intent-before-attempt with indeterminate reconciliation (terminal intents are never replayed); page-0 canonical payload with append-only rolling history pages; resumable guarded `rollbackRun` preserving all history and identity (SC-003); sanitized plan/run reports plus `last-run.json` markers. Ships behind the new `./engine` subpath export; zero runtime dependencies held; the frozen 002 surface never drifted (snapshot-enforced). Reference: [`docs/engine.md`](docs/engine.md); normative behavior in `specs/008-sync-engine-apply-rollback/contracts/`.
- 📝 **Features 009–013 remain draft specs** — operator CLI (009), background queue & hooks (010), sync-history web page (011), MCP server (012), and CI enforcement (013) now layer on the shipped, frozen engine surface.
- ✅ **The repo builds and tests** — `npm ci && npm test` (also `lint`, `typecheck`, `build`, and per-tier `test:unit|contract|integration|e2e` scripts): **949/949 tests green** across the four tiers, coverage 87.2% lines / 78.9% branches / 88.4% functions against the 80/70/80 gate, CI green on the Node 20 + 24 matrix. Scope: the complete brain *and* engine now exist — discovery, parsing, routing/titles, matching, the tracker port with real + fake adapters, and the composed engine with gated apply and rollback. What remains is user-facing surface: the CLI, queue, web viewer, MCP server, and CI action (009–013).

**Next steps:** run Wave 4's parallel surfaces on top of the shipped engine — start with 009 (operator CLI: `plan` / `apply` / `rollback` with exit codes and gate mapping), then 010–013, each via the same `/speckit.*` pipeline (`/speckit.plan`, `/speckit.tasks`, `/speckit.implement`).

## Tracker integration port (feature 007)

The Linear adapter implementing the frozen `Linear_Port` contract now ships at the
`task-linear-sync/tracker` and `task-linear-sync/tracker/testing` subpath exports — the
complete GraphQL surface with the built-in-retry posture, the attachment-URL identity
machinery (canonical/continuation chain walk), the credential pre-flight, and the
fake-port + recorded-replay testing harness that drives both under one conformance suite.
Usage, configuration, resilience posture, and fixture-corpus guide:
[`docs/tracker-integration.md`](docs/tracker-integration.md).

## Sync engine (feature 008)

`task-linear-sync/engine` composes everything above into the single engine behind the
frozen `SyncEngine` contract: a read-only `buildSyncPlan`, the one mutating entry
`applySyncPlan`, and a resumable, guarded `rollbackRun` — with git-style conflict
markers, append-only history pages, durable checkpoints, secret/PII screening of every
outbound string, and sanitized reports throughout. Full reference:
[`docs/engine.md`](docs/engine.md).

```ts
import { createSyncEngine } from "task-linear-sync/engine";
import type { SyncEngine } from "task-linear-sync/ports";

const engine: SyncEngine = createSyncEngine(
  { port, config, state, clock, screener }, // the frozen injectable five — the engine never touches transport
  { keyProvider },                          // encryption-key provider for sealed journals/manifests
);

// 1. Plan — read-only (constitution I): classifies conflicts, resolves actions,
//    persists the plan + a sanitized report under the state dir.
const plan = await engine.buildSyncPlan({ repositoryRoot });

// 2. Apply — THE single mutating entry, behind the frozen gates:
const result = await engine.applySyncPlan(plan, {
  applyFlag: true,                            // explicit surface flag (else APPLY_FLAG_MISSING)
  confirmationKey: config.confirmationKey,    // must match exactly (else CONFIRMATION_KEY_MISMATCH)
  acceptLowConfidence: false,                 // required when plan.lowConfidencePresent
});
// result.status: "applied" | "aborted" | "refused" — refusals happen before any
// lock is taken and with zero tracker calls; each run leaves reports/<runId>/ +
// a last-run.json marker. A converged re-apply performs ZERO tracker writes (SC-001).

// 3. Roll back a journaled run — guarded, resumable, history-preserving (SC-003):
if (result.status === "applied") {
  await engine.rollbackRun(result.runId); // files byte-restored, fields + checkpoints
}                                          // reverted, created issues archived (never
                                           // deleted), zero history events lost
```

## Running what works today

The package is a library (the operator CLI is feature 009), and everything below is
hermetic and offline — no Linear credentials, no network, no wall-clock:

```sh
npm ci                      # zero runtime dependencies — Node ≥ 20 is the only requirement
npm test                    # build + compile tests + the full four-tier suite + coverage gate
npm run test:unit           # …or per-tier: test:contract / test:integration / test:e2e
npm run lint                # eslint
npm run typecheck           # tsc --noEmit across src + tests
npm run build               # emit dist/ + .d.ts (the published surface)
```

Hands-on with the engine specifically:

```sh
# Engine-scoped sweeps across the tiers:
node scripts/run-tests.mjs --tier unit         --test-name-pattern "engine-"
node scripts/run-tests.mjs --tier integration  --test-name-pattern "engine-"

# The full user story as an executable demo (bootstrap apply → conflict cells →
# gated apply → rollback → marker resolution) on the hermetic fake tracker:
npm run pretest
node --test build/tests/e2e/engine-user-stories.test.js
```

Notes:

- The 80/70/80 (lines/branches/functions) coverage gate is enforced on runtimes whose
  test runner supports threshold flags; the Node 20 engines-floor leg runs the suite
  without instrumentation (CI matrix: Node 20.x + 24.x, both required).
- To drive the engine against real Linear once wired up: point the port at the real
  adapter (`task-linear-sync/tracker`; token via the configured credential env var,
  default `LINEAR_ACCESS_TOKEN`), set the `stateDirectory` config field to a directory
  **outside** the repo working tree (a compliant default is derived automatically), and
  provide a manifest-key provider — see [`docs/configuration.md`](docs/configuration.md).
- Every plan/run leaves a sanitized report at `reports/<runId>/` plus a
  `last-run.json` marker in the state dir.
