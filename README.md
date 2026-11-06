# task-linear-sync

A reusable npm library + CLI that keeps spec-driven-development task files in a repository bidirectionally synced with **Linear** issues — maintaining a "golden thread" of traceability between the specs you plan with and the issues you track work in.

> **Status: all four delivery waves are merged on `main`.** The frozen foundation (002), the Wave-2 library modules (003–007), the sync engine (008) and every Wave-4 operator surface — the **operator CLI (009)**, the **background queue & git/agent hooks (010)**, the read-only **Sync-History web component (011)**, the **AI-agent tool interface (012)**, and the **CI enforcement GitHub Action (013)** — are implemented, tested and merged (Wave 4 via PR #17). The full `plan → review report → gated apply → rollback` lifecycle runs end-to-end through every surface: library (`task-linear-sync/engine`), CLI (`task-linear-sync`), queue worker, HTTP history, MCP tools, and the CI gate. **1520 tests green**, zero runtime dependencies, CI green on Node 20.x and 24.x. See [Current Status](#current-status).

## Proposed Purpose

- **Discover** task files (`tasks.md` / `TASKS.md`) produced by spec frameworks such as **BMAD, GitHub Spec Kit, open-spec, Kiro, and generic Markdown** via pluggable framework adapters.
- **Parse** heading/checklist tasks, derive deterministic stable identities (UUIDs), and **match** them to Linear issues using weighted scoring with globally optimal one-to-one assignment.
- **Sync** both directions: mirror task content into issue descriptions, and write visible issue-key prefixes (e.g. `[KEY-123]`) back into the Markdown, with git-style conflict markers when both sides changed.
- **Persist sync state durably** in a Linear attachment (deterministic URL scheme), outside the repo, encrypted (AES-256-GCM) and journaled — never in descriptions or in-file.
- **Operate safely**: a single sync engine (`buildSyncPlan` / `applySyncPlan`) behind read-only plan surfaces, confirmation-gated apply, rollback of journaled runs, secret/PII screening, and idempotent byte-identical reruns.

Every surface is layered on the same engine and is now shipped:

| Surface | Status | Description | Feature spec |
|---|---|---|---|
| Core library | ✅ merged | Domain, contracts, discovery, parsing, matching, tracker port, engine | 002–008 |
| Operator CLI | ✅ merged | `plan` / `bootstrap` / `sync` / `check` / `rollback` + queue commands, review reports, frozen exit map | 009 |
| Background queue & hooks | ✅ merged | Git hooks and agent hooks that enqueue syncs; detached worker drives the engine | 010 |
| Sync History web page | ✅ merged | Read-only HTML/JSON/SSE history served from the tracker | 011 |
| MCP server | ✅ merged (preview) | AI-agent tool interface at `task-linear-sync/mcp` | 012 |
| CI enforcement | ✅ merged | GitHub Action (`action.yml`) + read-only wrapper at `task-linear-sync/ci` | 013 |

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
├── action.yml                # 013: the CI enforcement composite GitHub Action
├── src/                      # 002 contracts/config/run-state; Wave-2 modules
│                             #   (discovery, parsing, routing, titles, matching, tracker);
│                             #   engine (008); cli (009); queue (010);
│                             #   history-server (011); mcp (012); ci (013)
├── tests/                    # unit / contract / integration / e2e (hermetic, zero-network)
├── docs/                     # Config reference, amendment rule, per-feature usage guides
│                             #   (discovery, parsing, routing & titles, matching, tracker,
│                             #    engine, cli, queue & hooks, history-server,
│                             #    agent-tools, ci enforcement)
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
    └── 003…013-*/            # Wave-2, Wave-3 and Wave-4 specs — all implemented and merged
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

Wave 2 added the `discovery`, `parsing`, `routing`, `titles`, `matching`, and `tracker` modules; Wave 3 added `engine` (008); Wave 4 added `cli` (009), `queue` (010), `history-server` (011), `mcp` (012) and `ci` (013). The published subpath exports: `.`, `./domain`, `./config`, `./state`, `./urls`, `./gates`, `./ports`, `./tracker`, `./tracker/testing`, `./parsing`, `./matching`, `./discovery`, `./engine`, `./cli`, `./queue`, `./history-server`, `./mcp`, `./ci` (`./routing`/`./titles` are consumed internally per 005's plan; the `./cli` entry point is `runCli(argv, context)`, the `./history-server` entry point is `createSyncHistoryServer(deps)`, the `./mcp` entry point is `createAgentToolServer(deps)`, the `./ci` entry point is `runEnforcement(settings, deps)`, and the package installs the `task-linear-sync` bin).

## Current Status

_Last updated: 2026-11-06 · all features merged on `main` (Wave 4 via PR #17)_

- ✅ **Constitution ratified** — `.specify/memory/constitution.md` v1.0.0 (2026-10-20): safety-first, durable identity, overridable defaults, determinism/idempotency, one engine with additive surfaces, test-first quality gates.
- ✅ **Requirements complete** — `specs/requirements.md` (29 requirements) and the 97-item FR traceability catalog (feature 001) reviewed and checklist-passed.
- ✅ **Roadmap complete** — all 12 build features (002–013) across 4 waves delivered: contracts first (002), then discovery/parse/route/match/tracker in parallel (003–007), engine integration (008), then CLI/queue/web/MCP/CI (009–013).
- ✅ **Feature 002 (core domain contracts)** — all 54 tasks delivered: canonical entities, the config model with a secret-free provenanced baseline, the run-state lifecycle (manifests, durable intents, advisory locking, atomic state filesystem), the attachment URL scheme, the gate vocabulary, and the frozen `Linear_Port` / `buildSyncPlan` / `applySyncPlan` boundaries. The frozen export surface is guarded by a checked-in snapshot; changes follow `docs/contract-amendments.md`. Usage: `docs/configuration.md`, `docs/validation-002.md`.
- ✅ **Wave 2 complete (003–007)** — discovery & framework adapters (`./discovery`), task parsing & line rendering (`./parsing`), routing & title derivation, task↔issue matching (`./matching`), and the issue-tracker integration port with real + fake `Linear_Port` adapters (`./tracker`, `./tracker/testing`). Per-feature usage guides in `docs/`.
- ✅ **Feature 008 (sync engine, PR #15)** — bootstrap-vs-sync mode selection, three-way conflict classification with git-style markers, the frozen enforcement order (`gates → lock → plan-stability re-check → journal-before-first-mutation → screened mutations`), resumable guarded `rollbackRun`, sanitized reports and `last-run.json` markers — behind the `./engine` subpath. Reference: [`docs/engine.md`](docs/engine.md).
- ✅ **Feature 009 (operator CLI)** — the `task-linear-sync` bin and `./cli` export, twelve commands, the frozen 0–8 exit-code map, review reports surfaced from the engine's own artifact pair, and a runtime `ReadOnlyGuard` on read-only lanes. Usage: [`docs/cli.md`](docs/cli.md).
- ✅ **Feature 010 (background queue & hooks)** — single-slot dedup pending job, queue lock + claim protocol with abandoned-claim reclaim, a detached worker that drives the gated engine apply entry (zero sync logic of its own), retry policy, best-effort completion notification, marker-bounded git-hook installation (byte-preserving, always exit 0 on hook fire), and agent-hook scaffolds. `task-linear-sync install-hooks` and the queue commands work through the CLI's `QueueSurface` seam. Usage: [`docs/queue-hooks.md`](docs/queue-hooks.md).
- ✅ **Feature 011 (Sync-History web component)** — `./history-server`: read-only HTML/JSON/SSE history reconstructed live from the tracker (never from local state), private-by-default token auth with leak-free 401/403/404, TTL cache with single-flight, serverless deployment shape. Usage: [`docs/history-server.md`](docs/history-server.md).
- ✅ **Feature 012 (AI-agent tool interface, preview)** — `./mcp`: MCP-compatible JSON-RPC 2.0 surface with three read-only tools and a gated `task_sync_apply`, over stdio (default) or loopback HTTP with constant-time bearer auth; apply **disabled by default** and refused before any engine or port code runs; `node:fs` is never touched by `src/mcp`. Usage: [`docs/agent-tools.md`](docs/agent-tools.md).
- ✅ **Feature 013 (CI enforcement layer)** — `action.yml` + `./ci`: the composite action wraps the published read-only CLI (`check` / `plan`), consumes only the plan-report JSON artifact, and gates on three independently toggleable conditions; structurally cannot write or apply. Usage: [`docs/ci-enforcement.md`](docs/ci-enforcement.md).
- ✅ **The repo builds and tests** — `npm ci && npm test` (also `lint`, `typecheck`, `build`, per-tier `test:unit|contract|integration|e2e`, `test:cli`): **1520/1520 tests green** across the four tiers, coverage 81.3% lines / 80.4% branches / 80.8% functions against the 80/70/80 gate, CI green on the Node 20 + 24 matrix. Zero runtime dependencies held across all twelve features; the frozen 002 surface never drifted (snapshot-enforced).

**Next steps:** harden the preview surfaces (012 MCP, 011 history server) toward stable-1.0, package publish tooling, and real-project dogfooding beyond the hermetic fake tracker.

## Using the library (engine)

`task-linear-sync/engine` composes everything into the single engine behind the frozen `SyncEngine` contract: a read-only `buildSyncPlan`, the one mutating entry `applySyncPlan`, and a resumable, guarded `rollbackRun`. Full reference: [`docs/engine.md`](docs/engine.md).

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

Other library lanes keep their own guides: matching ([`docs/matching.md`](docs/matching.md)), tracker port ([`docs/tracker-integration.md`](docs/tracker-integration.md)), discovery and framework adapters ([`docs/framework-adapters.md`](docs/framework-adapters.md)), parsing ([`docs/parsing.md`](docs/parsing.md)), routing & titles ([`docs/routing-and-titles.md`](docs/routing-and-titles.md)).

### Matching (feature 006)

`task-linear-sync/matching` is a pure task ↔ issue matching brain: it turns fetched
tracker views into scored, banded, one-to-one matches — deterministic, explainable,
durable-identity aware.

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

## Using the Operator CLI (feature 009)

`task-linear-sync` is the operator surface over the engine: one bin, twelve commands, the frozen 0–8 exit-code map, and the review-report flow. The same logic is importable as `runCli(argv, context)` from `task-linear-sync/cli`. Full reference: [`docs/cli.md`](docs/cli.md).

```sh
task-linear-sync inventory                                   # read-only spec inventory (zero tracker calls)
task-linear-sync discover-metadata                           # teams/projects/states/milestones readout
task-linear-sync plan                                        # build a plan + review-report pair; prints planId
task-linear-sync check                                       # same lane; prints ONE machine-readable JSON summary
task-linear-sync bootstrap --plan <planId> --apply --confirm <KEY> [--accept-low-confidence]
task-linear-sync sync      --plan <planId> --apply --confirm <KEY> [--accept-low-confidence]
task-linear-sync rollback <runId>                            # reverse a journaled run
task-linear-sync install-hooks                               # managed git-hook blocks (see feature 010)
task-linear-sync install-agent-hook --framework kiro         # agent-hook scaffold (see feature 010)
task-linear-sync enqueue [--mode bootstrap|sync]             # queue one background sync
task-linear-sync worker [--once]                             # drain the queue (detached or foreground)
task-linear-sync last-run [--json]                           # last outcome from the last-run.json marker
```

- `[repo]` (first positional) selects the repository root (default cwd); `--config <path>` overrides the config file (default `<repo>/<toolId>.json`).
- `plan` and `check` are read-only by contract: apply flags on them exit 2 naming every offending flag, with zero effects.
- `bootstrap` / `sync` require the frozen gate trio (`--plan` + `--apply` + `--confirm <KEY>` matching the configured confirmation key; plus `--accept-low-confidence` when the plan carries low-confidence entries); refusals exit 4 naming the gate code.
- `check` prints exactly one JSON object (`CheckSummary`) on stdout and exits 0 (no findings) or 8 (findings present) — the input contract consumed by the CI layer (013).
- The review report is the engine's own artifact pair (`reports/<runId>/report.{json,md}` under the configured state directory) — the CLI renders and points at it, never re-renders it, and every output line passes the security screener.

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected error (sanitized) |
| 2 | usage error (unknown command/flag, arity, apply flags on read-only commands) |
| 3 | configuration error (names only, never values) |
| 4 | gate refusal (`CONFIRMATION_KEY_MISMATCH`, `PLAN_REFERENCE_UNKNOWN`, queue-surface `refused`, …) |
| 5 | run aborted (integrity, read-only violation, blocked output line, missing/stale report) |
| 6 | lock held by another sync — never waited on, never stolen |
| 7 | queue command while `task-linear-sync/queue` is unavailable |
| 8 | `check` only: findings present in the report |

## Using the background queue & hooks (feature 010)

The queue turns sync from a manual command into a background process: `enqueue` durably records a single pending job (`pending-job.json` in the state dir, ≤ 500 ms), silently spawns a detached worker, and the worker runs the full engine cycle and leaves the frozen `last-run.json` marker with its report pair. Repeated enqueues coalesce into the single slot — a 100-event storm leaves exactly one job. Full reference: [`docs/queue-hooks.md`](docs/queue-hooks.md).

```sh
task-linear-sync enqueue                 # queue a sync (mode: sync) — always safe to re-run
task-linear-sync enqueue --mode bootstrap
task-linear-sync worker --once           # one drain cycle in the foreground
task-linear-sync last-run --json         # machine-readable last outcome
task-linear-sync install-hooks           # install the managed git-hook blocks
```

`install-hooks` appends a marker-bounded block to each hook in `managedGitHooks` (top-level config key; default `pre-push`, `post-merge`):

```sh
# >>> task-linear-sync managed hooks v1 >>>
"task-linear-sync" last-run 1>&2 || true
"task-linear-sync" enqueue 1>&2 || true
# <<< task-linear-sync managed hooks v1 <<<
```

After installation every matching git operation prints the last run outcome on stderr and enqueues a sync — **always exiting 0**, even without credentials (a warning then). The block is idempotent (byte-identical re-install), preserves your bytes outside the markers, never touches a hook file without a shebang, and aborts with zero writes when `managedGitHooks` names an unknown hook. Uninstall = delete the marked range.

Queue configuration (all optional, in the config file; defaults shown):

| Key | Range | Default | Meaning |
|---|---|---|---|
| `queue.workerDelaySeconds` | 1–3600 | 75 | delay before the worker's second (late) drain cycle |
| `queue.lockTimeoutSeconds` | 1–300 | 30 | drain-lock wait; on expiry the worker exits `stopped` with code 0 |
| `queue.maxRetries` | 1–100 | 5 | retry limit before the terminal `RETRY_LIMIT` report |
| `queue.notificationsEnabled` | boolean | true | best-effort completion notification |
| `worker.claimTimeoutSeconds` | — | 300 | abandoned-claim reclaim threshold |

## Installing agent hooks (feature 010, per IDE / framework)

`install-agent-hook` persists a scaffold that makes your agent tooling enqueue a sync automatically. It performs **zero issue-tracker network**, never overwrites an existing file (free name suffix `-2`, `-3`, …), and refuses unknown or template-less framework ids with zero writes. The scaffold's `command` action always runs `task-linear-sync enqueue`, so it inherits the queue's dedup + safety posture regardless of host.

| IDE / framework | Repo layout detected by | Install command | Result |
|---|---|---|---|
| **Kiro** | `.kiro/specs/` | `task-linear-sync install-agent-hook` (kiro is the default) | `.kiro/hooks/task-linear-sync-sync.json` (`kiro-json` template, fires `task-linear-sync enqueue` on post-file-save under `specs/**/*.md`) |
| **Generic / any other tooling** | any repo (fallback adapter) | `task-linear-sync install-agent-hook --framework generic` | `.task-linear-sync/hooks/task-linear-sync-sync.json` (`command-json` template) |
| **GitHub Spec Kit** | `specs/` + sibling `spec.md`/`plan.md` | `task-linear-sync install-agent-hook --framework generic` | no spec-kit-specific hook template exists — the generic scaffold (or an override directory) is the supported integration |
| **open-spec** | `openspec/` / `open-spec/` | `task-linear-sync install-agent-hook --framework generic` | same as above |
| **BMAD** | `bmad/`, `bmad-method/`, `docs/` | `task-linear-sync install-agent-hook --framework generic` | same as above |

Generated scaffold (Kiro shape):

```json
{
  "name": "task-linear-sync-sync",
  "action": "command",
  "command": "task-linear-sync enqueue",
  "event": "post-file-save",
  "pathPatterns": ["specs/**/*.md"]
}
```

Notes:

- The `agentHooksDirectory` config key (or `queue.agentHooksDirectory`) overrides the destination directory for hosts whose agent-hook location differs from the built-in default.
- Hosts with their own hook systems (editors with file-save triggers, CI on push, etc.) integrate the same way: point their trigger at `task-linear-sync enqueue`. Enqueue is non-blocking and idempotent, so a misfired or duplicate trigger is always safe.
- Combine with `install-hooks` for git-event coverage and the CI enforcement action for PR coverage; each layer enqueues or reports only — none mutates outside the gated engine.

## Using the Sync-History web page (feature 011)

`task-linear-sync/history-server` is a **read-only** web surface: it reconstructs a task's sync timeline purely from the tracker (through the injected `LinearPort` — never from local manifests or state files) and serves it as a self-contained HTML page, a JSON view, or a Server-Sent Events stream, with an automatic polling fallback. Full reference: [`docs/history-server.md`](docs/history-server.md).

```ts
import { createSyncHistoryServer } from "task-linear-sync/history-server";
import { createLinearPort } from "task-linear-sync/tracker";
import { loadConfig } from "task-linear-sync/config";

const config = loadConfig();
const app = createSyncHistoryServer({
  port: createLinearPort(config), // the ONLY route to the tracker
  config,                         // the frozen `web` config group drives the surface
});

// Long-lived process:
const server = await app.listen(8790, "127.0.0.1");

// Or deploy the handler directly (any (req, res) host, incl. serverless):
// export default app.handle;
```

- A history is addressed through the frozen attachment-URL scheme — the task's canonical sync-state attachment URL, its continuation-page URLs, or the plain `/history/<taskUuid>` path form. Anything else is 404; every error response carries zero history bytes.
- **Private by default**: the token in the env var named by `web.authEnvVarName` (or a stateless signed session cookie bootstrapped from a token form) is required server-side **before** any tracker read; missing/invalid credentials → 401/403 with zero history leakage. Public serving is an explicit `web.accessControlMode: "public"` opt-in.
- SSE push where supported (`web.realtimeSse`, default true) with a polling fallback every `web.pollIntervalSeconds` (default 15); an optional server-side cache with `web.cacheTtlSeconds` (default 10, `0` disables) de-duplicates reconstruction. All browser-visible text is re-screened; credentials never appear in any response body.

## Using the AI-agent tool interface (feature 012, preview)

`task-linear-sync/mcp` is an MCP-compatible JSON-RPC 2.0 server exposing four tools — `task_sync_plan`, `task_sync_status`, `task_sync_inventory` (read-only) and the gated `task_sync_apply` — over line-delimited stdio (default) or a loopback HTTP listener behind constant-time bearer auth. Full reference: [`docs/agent-tools.md`](docs/agent-tools.md).

```ts
import { createAgentToolServer } from "task-linear-sync/mcp";
import { loadConfig } from "task-linear-sync/config";
import { createLinearPort } from "task-linear-sync/tracker";

const config = loadConfig();
const server = createAgentToolServer({
  config,
  port: createLinearPort(config), // the ONLY route to the tracker
  repositoryRoot: "/srv/repos/acme",
});
await server.serveStdio();  // or: await server.listenHttp()
```

- **Apply is opt-in and inert by default.** With default settings (`mcp.enabled: false`) `task_sync_apply` is invisible in `tools/list` and a call is refused before any engine or port code runs; when enabled it makes exactly one `engine.applySyncPlan` call with the same frozen GateRequest the CLI uses.
- **Session-scoped plan references:** `task_sync_plan` records a 64-hex plan reference in memory only; `task_sync_apply` accepts a reference from the current session (a restarted server answers `PLAN_REFERENCE_UNKNOWN`). No plan bodies are stored, nothing persists.
- **stdio:** one JSON message per line on stdin/stdout; stdout is protocol-only (logs on stderr); handshake `initialize` → `notifications/initialized` → `tools/list` / `tools/call`. Tool failures come back as `isError: true` results, never protocol errors.
- **HTTP:** set the bearer token in the env var named by `mcp.tokenEnvVarName` before start; POST JSON-RPC to `http://127.0.0.1:<port>/mcp` with `Authorization: Bearer <token>`; wrong/missing tokens get constant 401/403 bodies without the message ever reaching the tools.
- Every tool result passes the hygiene screeners; no credential value ever appears in an output, and `src/mcp` never touches `node:fs`.

## Using the CI enforcement action (feature 013)

`action.yml` + `task-linear-sync/ci` gate a pull request on the report the published CLI already produces. The wrapper never re-derives findings and structurally cannot write or apply. Full reference: [`docs/ci-enforcement.md`](docs/ci-enforcement.md).

```yaml
jobs:
  enforcement:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: ./                       # the composite action from this repo
        id: enforce
        with:
          command: check               # or: plan
          drift-threshold: "0"
          protected-branches: "main"
        env:
          TASK_LINEAR_SYNC_TOKEN: ${{ secrets.LINEAR_READ_TOKEN }}   # read-scoped
      - run: echo "unmapped ${{ steps.enforce.outputs.unmapped-count }}"
```

Three independently toggleable conditions, evaluated from the plan-report JSON (counts are always computed and exported as outputs — `unmapped-count`, `conflict-count`, `drift-count`, `status`, `summary`, `report-json`):

| Condition | Toggle (default) | Trigger |
|---|---|---|
| `unmapped-high-confidence` | `fail-on-unmapped` (true) | count exceeds `unmapped-threshold` (0) |
| `unresolved-conflict-block` | `fail-on-conflicts` (true) | any conflict-marker entry targeting the protected branch |
| `spec-drift` | `fail-on-drift` (true) | count exceeds `drift-threshold` (0) |

A disabled condition never fails the step; a skipped conflict check (unresolvable target branch) warns but passes. Failure exits non-zero with one screened, count-only summary line naming each triggered condition (e.g. `task-linear-sync enforcement failed — unmapped-high-confidence: 1; spec-drift: 3`). A missing or malformed report artifact fails with exit 2 naming the artifact — never a silent pass. Outside GitHub Actions the same wrapper runs standalone (`node dist/ci/main.js --workspace <repo> --command check`, or `--report <file.json>` to evaluate a pre-generated artifact without spawning anything); wrapper exits: 0 pass · 1 violations · 2 missing/malformed artifact · 3 CLI failure.

## Running the project

The package is a library plus the `task-linear-sync` operator CLI, and everything below is hermetic and offline — no Linear credentials, no network, no wall-clock:

```sh
npm ci                      # zero runtime dependencies — Node ≥ 20 is the only requirement
npm test                    # build + compile tests + the full four-tier suite + coverage gate
npm run test:unit           # …or per-tier: test:contract / test:integration / test:e2e
npm run test:cli            # every test whose name matches "cli" (all four tiers)
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

- The 80/70/80 (lines/branches/functions) coverage gate is enforced on runtimes whose test runner supports threshold flags; the Node 20 engines-floor leg runs the suite without instrumentation (CI matrix: Node 20.x + 24.x, both required).
- To drive the engine against real Linear: point the port at the real adapter (`task-linear-sync/tracker`; token via the configured credential env var, default `LINEAR_ACCESS_TOKEN`), set the `stateDirectory` config field to a directory **outside** the repo working tree (a compliant default is derived automatically), and provide a manifest-key provider — see [`docs/configuration.md`](docs/configuration.md).
- The `queue` config block (worker delay, retry limit, lock timeout, hook prefix and directories) is documented with defaults and ranges in [`docs/queue-hooks.md`](docs/queue-hooks.md); the related frozen key is `worker.claimTimeoutSeconds`.
- Every plan/run leaves a sanitized report at `reports/<runId>/` plus a `last-run.json` marker in the state dir.
