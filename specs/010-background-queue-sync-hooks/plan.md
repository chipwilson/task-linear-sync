# Implementation Plan: Background Sync Queue, Worker, and Hook Triggers

**Branch**: `010-background-queue-sync-hooks` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-background-queue-sync-hooks/spec.md`

## Summary

Wave-4 feature that lands the background automation layer behind the seam 009 already
shipped: the five `QueueSurface` commands (`install-hooks`, `install-agent-hook`,
`enqueue`, `worker`, `last-run`) currently refuse with exit 7 because the default wiring
lazy-imports a not-yet-existing `src/queue/` module (009 `contracts/queue-surface.md` §2).
010 ships exactly that module — a new disjoint `src/queue/` group behind one additive
`./queue` subpath export — so `createQueueSurface()` satisfies `delegateTo010`'s documented
binding and the CLI's five presentations start working with **zero `src/cli` edits** and the
0–8 exit map untouched. The queue writes a single deduplicated pending job
(`pending-job.json`, the path 002 pre-reserved in `StateStore.paths.queue`, outside the repo
working tree) under an exclusive queue lock, claims jobs atomically with abandoned-claim
reclaim, spawns a detached Node-20 worker (`child_process` spawn `detached: true` +
`unref`, zero cron libraries) that drains immediately plus once more after the configured
worker-delay (no lost wake), and applies claimed jobs **only** through the frozen gated
`SyncEngine` entry — bootstrap/sync is the job's mode hint into `buildSyncPlan`; all gates,
locking, journaling and screening stay inside the engine (constitution I/V: the worker
duplicates zero sync logic). Retries terminate at the configured maximum with sanitized
reports via the frozen `writeRunReports`; the durable last-run marker + stderr outcome +
best-effort notification (undeliverable/suppressed = success) close each drain. Triggers:
marker-bounded, byte-preserving git-hook block install that aborts before any write on
unknown hook names; hook fire always exits zero (including absent credentials — warn, still
enqueue — and enqueue failure — error emitted); the stable shell-invocable entry is the CLI
`enqueue` command; agent-hook scaffolds reuse 003's pure `agentHookScaffold` record with
never-overwrite naming and zero network. Headline decisions: **zero new runtime
dependencies, zero edits to any frozen/Wave-2/Wave-3 module**, and feature-owned queue
settings as an additive `queue` config group deep-merged through the frozen 002 loader
with 010-owned defaults + complete-listing range validation (research R2).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`
per exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). Node 20 API floor is a hard constraint: `child_process.spawn`
(`detached: true`, `stdio: "ignore"`, `child.unref()`), `fs` exclusive-create locking,
`process.kill(pid, 0)` liveness probes — no `fs.globSync`, no unguarded `crypto.hash`, no
`--experimental` flags, no cron/task-scheduler dependency.

**Primary Dependencies**: **None added at runtime — explicit plan decision (research R1),
continuing the 002/007/008/009 zero-spend posture.** 010 imports only Node built-ins plus
`src/{domain,config,state,ports,gates}` (002, frozen), `src/discovery` (003 — pure
`agentHookScaffold`), `src/engine` (008 — `createSyncEngine`,
`createDefaultSecurityScreener`, `envVarKeyProvider` via the `./engine` barrel), and
`src/tracker` (007 — `createLinearPort`). `src/queue` never imports `src/cli` (the binding
runs one way: CLI lazily imports `../queue/index.js`). 010 is the first module group to use
`node:child_process` (worker spawn + best-effort notification spawn); the pure git-context
resolution follows 003's no-`git`-binary precedent (research R10).

**Storage**: Files only, all inside the frozen 002 state directory (outside the repository
working tree, owner-only 0o700/0o600, atomic temp+rename via `StateStore`):
`pending-job.json` (frozen path `paths.queue`; single dedup record, 002 data-model §13
shape extended additively with `schemaVersion`, `jobId`, `mode`, `retryCount`,
`pid` — research R3), `queue-lock.json` (010-local queue lock mirroring the frozen
run-lock record pattern; the frozen `lock.json` stays exclusively the engine's run lock),
`reports/<runId>/` sanitized report pairs (frozen `writeRunReports`), and `last-run.json`
(frozen `LastRunMarker` — written by the engine for applied runs; 010 updates it for
queue-level outcomes and the notification posture). Nothing in the repo working tree
except the marker-bounded git-hook files under the hooks directory and scaffolded
agent-hook files under the framework hooks directory, both explicit install targets.

**Testing**: `node:test` + `node:assert/strict` in the existing tiers via
`scripts/run-tests.mjs`. Pyramid: **unit** (pure pending-job state machine — merge/claim/
reclaim/retry; hook-block splicing byte-preservation incl. CRLF; hook-name validation;
scaffold naming/never-overwrite; queue-config validation ranges) → **contract**
(`./queue` packaging + zero-dependency re-assertion, queue-defaults scan zero-org,
`createQueueSurface` ↔ `QueueSurface` binding conformance incl. 009 exit-map preservation,
`src/queue` import-hygiene scan) → **integration** (queue-lock races with real child
processes à la `tests/integration/state-lock-race.test.ts`; 100-event enqueue storm —
≤1 pending job, exactly 1 live claim; drain lifecycle against the 007 fake via the engine
harness — mode honoring, retry increment, retry-limit termination, marker + notification
posture; hook install byte-preservation) → **e2e** (fixture hook files fired as real hook
scripts with `cwd` = fixture repo against the built CLI child process; the five CLI
commands through the 009 cli-harness with the real surface; always-exit-zero incl. absent
credentials and injected enqueue failure). Timing claims: injected `Clock` + injectable
`sleep` + fast configured values for delay/claim/lock-timeout/retry semantics; the 500 ms
FR-001/SC-001 budget is asserted as a generous wall-clock ceiling (an SLA, not a
race-sensitive flake vector). Hermetic: temp state dirs **outside** the repo tree, fake
`LinearPort`, fake notifier, recorded spawn injector, placeholder identifiers only
(constitution VI).

**Target Platform**: Node.js ≥ 20 library/CLI host (Linux, macOS, Windows); consumed as
`task-linear-sync/queue` (programmatic) and through the published CLI bin (`enqueue`,
`worker`, `install-hooks`, `install-agent-hook`, `last-run`). Detached-worker spawning
works with no daemon, no service manager, and no persistent process.

**Project Type**: Single npm package (existing); this feature owns the disjoint
`src/queue/` module group and its tests/fixtures. No frozen 002 module and no Wave-2/3/4
module is edited (ROADMAP rule 2, constitution V); 010 imports them.

**Performance Goals**: Enqueue writes the pending job and spawns the detached worker each
within 500 ms of the trigger (FR-001/SC-001 — pure file write + non-blocking spawn, no
network, no engine work on the enqueue path); a 100-event storm produces at most one
pending job and exactly one live claim (SC-002); hook fire does zero tracker I/O (the
worker's engine apply owns all network); drain adds only queue-protocol overhead around
the engine's own apply cost.

**Constraints**: Zero new runtime dependencies (R1); zero edits to frozen/Wave-2/3 modules
and **zero `src/cli` edits** — 010 lands behind 009's `QueueSurface` seam exactly as that
contract prescribes (010 "replaces only the default wiring"); 009's exit-code map stays
intact (adapted only the two tests that assert the `src/queue`-absent world — research
R12); every queue write is under the queue lock and atomic; the worker calls
`applySyncPlan` through the frozen enforcement order with zero reimplementation of gates
(research R7); all queue records and reports are sanitized (frozen screener +
`writeRunReports`); every hook invocation exits zero; agent-hook scaffolding performs zero
network; distributed defaults carry zero organization identifiers (defaults-scan contract
tests enforce).

**Scale/Scope**: 9 FRs (001 FR-063…071), 3 SCs, 3 user stories; ~12 source modules in
`src/queue/`; one additive `package.json` exports entry; two new state files; one git-hook
block format + one agent-hook scaffold format; 5 CLI commands activated (not modified);
≈45 tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | The queue never mutates the tracker or the repo on the enqueue path — enqueue is a state-file write + detached spawn. All mutation flows through the one gated engine apply entry with the frozen enforcement order (gates → run lock → stability re-check → journal → screened mutations); the worker supplies `GateRequest` from configuration (exact `Confirmation_Key` match, `applyFlag: true`, `acceptLowConfidence` default **false** — low-confidence runs are refused, not silently accepted) and adds no gate of its own (research R7). Lock-failure/retry-limit/failure reports land via frozen sanitized `writeRunReports` (screener refusal honored); no credential value ever enters a queue record, report, hook block, or scaffold — only env-var NAMES are checked (warn-only). All queue files sit in the state directory outside the working tree, owner-only + atomic; hook install touches only the hooks directory (explicit install target) and nothing else (research R10). | PASS |
| II. Durable Identity | The queue keys nothing on task identity; jobs carry `mode` + trigger metadata only. Claim/reclaim and dedup operate on the single pending-job record; the engine's identity machinery is untouched. No durable identity is written into hooks, scaffolds, or queue records. | PASS |
| III. Intelligent Defaults, Overridable Configuration | Every 010 value ships a generic overridable default through the frozen deep-merge chain (research R2): additive `queue` config group (worker-delay 1–3600 s default 75; queue-lock timeout 1–300 s default 30; retry max 1–100 default 5; notifications enabled default `true`; auto-accept-low-confidence default `false`; hook script prefix default = `binName`; hooks-directory override default = repository git hooks dir) plus reuse of the frozen 002 keys `managedGitHooks` (default `pre-push`, `post-merge`), `agentHooksDirectory` (per-framework adapter default), `worker.claimTimeoutSeconds` (abandoned-claim threshold 1–3600 s default 300). Range validation is complete-listing (no fail-fast), mirroring `MissingIdentityError` posture. Zero org identifiers in any default, hook block, or scaffold (defaults-scan contract test). | PASS |
| IV. Determinism and Idempotency | Dedup is idempotent by construction: merging N enqueues into the one `pending-job.json` record converges to a single pending job regardless of ordering (property test). Claim/reclaim/retry transitions are a pure state machine (unit tier) keyed on injected-`Clock` timestamps — no `Date.now()` inside the logic. Re-install of a hook block is idempotent (marker pair replaced in place, byte-identical outside); scaffold writes are never destructive. A drained-then-drained-again worker converges (empty queue ⇒ clean no-op stop). | PASS |
| V. One Engine, Additive Surfaces | 010 **is** the additive surface behind 009's frozen seam: the worker composes `createSyncEngine` exactly as the CLI does (same `EngineDependencies` wiring) and calls `buildSyncPlan`/`applySyncPlan` — zero sync logic, zero gating reimplementation, no second apply path. `src/queue` is additive (one subpath export, import-only consumption of 002–008); `src/cli` is never edited, and the CLI-side lazy-import binding documented in 009's contract is the only coupling (import-hygiene contract test asserts `src/queue` never imports `src/cli` and reaches the engine only through `./engine`). | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR-001…009 and SC-001…003 maps to at least one automated test (quickstart traceability table). Pyramid + required cross-cutting types delivered: property-based (storm dedup convergence; byte-preservation splice), contract (seam binding + exit-map preservation + zero-deps + defaults scan + import hygiene), security (secret sentinels never appear in queue records/reports/hook files; screener-blocked report content refuses writes). Deterministic and hermetic: injected `Clock` + injectable sleep, fake port, fake notifier, recorded spawn injector, real-child-process lock races, temp dirs outside the repo; timing asserts use fast configured values or generous SLA ceilings, never wall-clock races. | PASS |
| Additional constraints | *Port/adapter*: engine deps receive the injected `LinearPort` only. *Credential handling*: only env-var NAMES inspected; absent ⇒ warning, never failure (FR-007); values never logged. *Resilience*: queue retry is job-level re-queueing, orthogonal to the port's own retry posture; creates are still never replayed (engine-owned). *Locking/integrity*: queue lock is exclusive-create + pid-liveness + stale-record takeover, single-winner by the frozen lock algorithm; the engine's run lock stays untouched. *Technology stack*: one additive `exports` entry, zero dependency changes, Node ≥ 20 APIs only. *No org-specific literals*: hook markers/scaffolds derive from `toolId`/`binName`; fixtures placeholder-only. | PASS |
| Development workflow / quality gates | No pipeline/tooling changes: existing tiers + coverage gate (80/70/80) run the new files. Documentation duty in the same change: `docs/queue-hooks.md` (queue, worker, hook install, config keys, exit behavior) + README status update; every new config key and the `./queue` subpath documented. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/010-background-queue-sync-hooks/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 010-local interfaces only
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # + one exports entry "./queue" (additive; deps unchanged)

src/
├── domain/ config/ state/ urls/ gates/ ports/       # FROZEN (002) — imported, never edited
├── discovery/ parsing/ routing/ titles/ matching/   # 003–006 — imported
├── tracker/                                         # 007 — real port + fake, imported
├── engine/                                          # 008 — imported via ./engine barrel
├── cli/                                             # 009 — NEVER edited; binds to ./queue lazily
└── queue/                                 # ← 010's disjoint module group
    ├── index.ts                         # public surface for ./queue; createQueueSurface factory
    ├── surface.ts                       # QueueSurface implementation (five members, plain-data outcomes)
    ├── config.ts                        # QueueSettings + additive `queue` group resolution + range validation
    ├── pending-job.ts                   # PURE pending-job state machine (merge/claim/reclaim/retry/terminal)
    ├── queue-lock.ts                    # queue-lock.json acquire(timeout)/release (pid liveness, takeover)
    ├── enqueue.ts                       # dedup enqueue (≤500 ms budget) + detached worker spawn + credential warn
    ├── spawn.ts                         # Node-20 detached spawn helper (detached, stdio ignore, unref) + injectable
    ├── drain.ts                         # ONE drain pass: lock → reclaim → claim → engine apply → retry/terminal
    ├── apply-runner.ts                  # engine composition (port/screener/state/engine) — zero sync logic
    ├── worker.ts                        # runWorker loop: immediate + delayed-fallback drain; signal stop; --once
    ├── worker-entry.ts                  # detached entry executable (node dist/queue/worker-entry.js <repo>)
    ├── reports.ts                       # sanitized queue reports + last-run marker updates (frozen primitives)
    ├── notify.ts                        # Notifier seam + best-effort platform delivery (undeliverable = success)
    ├── git-hooks.ts                     # marker-bounded block splice (pure) + install I/O + hooks-dir resolution
    └── agent-hooks.ts                   # scaffold write via 003 agentHookScaffold (enriched event/patterns), never overwrite

tests/
├── unit/                                # queue-config / queue-pending-job / queue-lock / queue-hook-block /
│                                        #   queue-agent-hook / queue-notify
├── contract/                            # queue-packaging, queue-dependency-budget (re-assertion),
│   │                                    #   queue-defaults-scan, queue-surface-binding (009 seam conformance +
│   │                                    #   exit map), queue-hygiene (no src/cli import; engine via ./engine)
├── integration/                         # queue-enqueue (dedup + 500 ms budget + spawn recording),
│   │                                    #   queue-lock-race (+ queue-lock-race-child.ts, state-lock-race pattern),
│   │                                    #   queue-storm (100-event: ≤1 pending, exactly 1 live claim),
│   │                                    #   queue-drain-lifecycle (007 fake via engine-harness: mode honoring,
│   │                                    #   retry, retry-limit, marker, notification), queue-hook-install,
│   │                                    #   queue-cli-surface (five commands through 009 cli-harness + real surface)
├── e2e/                                 # queue-user-stories (US1/US2/US3 walkthroughs),
│   │                                    #   queue-hook-fire (fixture hook files fired as real scripts, exit zero,
│   │                                    #   stderr outcome, absent credentials, injected enqueue failure)
├── helpers/queue-harness.ts             # temp state store + fake port/notifier/spawn/sleep + injected clock,
│   │                                    #   built on tests/helpers/engine-harness.ts worlds
└── fixtures/queue/
    ├── README.md                        # fixture conventions (placeholders only)
    ├── worlds/                          # bootstrap-world/, sync-world/ (reuse engine worlds where possible)
    └── hooks/                           # foreign-content hook fixtures (pre-push, post-merge, shebang-less,
                                         #   CRLF, executable-bit states) + agent-hook occupied-target fixtures
```

**Structure Decision**: Single npm package (constitution "Technology stack"), landing in
the `src/queue` slot 002's contract language pre-reserved (`StateStore.paths.queue`,
002 data-model §13/§14 "behavior 010") and following 007/008/009's disjoint-module
precedent. 010 touches only `src/queue/**`, `tests/**/queue-*`,
`tests/helpers/queue-harness.ts`, `tests/fixtures/queue/**`, one additive `package.json`
exports entry, its own `specs/010-background-queue-sync-hooks/**`, plus — in the test
tier only — the two 009 assertions that documented the `src/queue`-absent world
(research R12). All frozen/Wave-2/3 modules are imported through their declared module
surfaces, never edited (ROADMAP rule 2). The module group name `src/queue/` is not
actually negotiable: 009's `queue-surface.ts` hardcodes the lazy specifier
`"../queue/index.js"` and names `task-linear-sync/queue` in its refusal message, so the
path and the `./queue` subpath are fixed by the frozen 009 seam.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) reusing the frozen `acquireRunLock` (`lock.json`) for the queue lock —
rejected: that lock serializes *applies* inside the engine and its takeover window is the
frozen 60 s stale rule; the queue lock is a distinct, longer-timeout serialization primitive
whose timeout must not collide with the run lock (research R4); (2) a `cron`/scheduler or
`systemd`/Task Scheduler integration for the delayed fallback — rejected, a detached
self-sleeping worker process satisfies "delayed fallback" with zero dependencies and zero
external privileges (research R6); (3) a message broker or SQLite queue — rejected, the
frozen single-file `pending-job.json` dedup record is the shape 002 reserved and the
dedup/lock/claim protocol is fully enforceable on atomic rename + exclusive create
(research R3/R5); (4) wiring the worker through `src/cli`'s `runCli` (spawning
`<bin> worker` as a child of the CLI) — rejected as the *implementation* binding: the
detached entry is `dist/queue/worker-entry.js` so the queue is spawnable by library-only
consumers; the CLI `worker` command runs the same `runWorker` in-process through the seam
(research R6).
