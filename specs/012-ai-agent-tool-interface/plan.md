# Implementation Plan: AI-Agent Tool Interface

**Branch**: `012-ai-agent-tool-interface` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-ai-agent-tool-interface/spec.md`

## Summary

This Wave-4 feature ships the constitution's `MCP_Server`: an embedded tool interface that
lets AI coding agents drive the SAME engine through an MCP-compatible (Model Context
Protocol) JSON-RPC surface instead of shelling out. Three read-only tools —
`task_sync_plan`, `task_sync_status`, `task_sync_inventory` — are the entire default
surface; the mutating `task_sync_apply` tool is invisible in `tools/list` and refused on
invocation unless the consumer explicitly enables mutating tools, and even then it demands
the exact confirmation key, the accept-low-confidence argument when required, and a FRESH,
session-scoped plan reference produced earlier by `task_sync_plan` (unknown/stale
references refuse with zero state changes). Headline plan decision: **zero new runtime
dependencies** — a hand-rolled, MCP-compatible JSON-RPC 2.0 implementation over
newline-delimited stdio framing plus an optional `node:http` bearer-token transport
(research R1: the MCP SDK would force a deliberate amendment of
`tests/contract/tracker-dependency-budget.test.ts`, which currently pins runtime deps to
exactly zero; the constitutional one-dependency allowance stays unspent). The feature is a
new disjoint `src/mcp/` module group behind ONE additive `./mcp` subpath export; it owns
tool registration/visibility, the session-scoped plan-reference store (in-memory — empty
after restart, zero filesystem access), and the transport/auth posture, while ALL gating,
stability-guard, locking, journaling, and screening behavior stays inside the frozen
engine: `task_sync_apply` calls `applySyncPlan` with a verbatim `GateRequest` exactly like
`src/queue/apply-runner.ts` does, and the read-only tools reuse the 009 CLI command cores
through `runCli` with captured writers — never a forked report rendering (research R4/R6).
Distributed defaults carry zero organization identifiers; all tool text is screened and
hash-based; errors name no credential (research R8/R10).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`
per exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). No toolchain changes. Node 20 APIs only: `node:process` streams,
`node:http` `createServer`, `node:crypto` `timingSafeEqual`/`createHash` — no
`crypto.hash`, no `fs.globSync`, no `--experimental` flags (research R11).

**Primary Dependencies**: **None added at runtime** — the central research decision
(research R1). The module group imports only Node built-ins (`node:process`, `node:http`,
`node:crypto`) plus local modules: `src/config` (frozen `ResolvedConfig` +
`envVarPrefixFor`), `src/ports` (`LinearPort`/`SecurityScreener`/`GateRequest` types via
`src/gates`), `src/gates` (frozen vocabulary only), `src/engine`
(`createSyncEngine`/`createDefaultSecurityScreener` factories), `src/state` (frozen
`StateStore` — read-only reads), `src/tracker` (`createLinearPort`), `src/cli` (`runCli`,
`createProductionContext`, `createDefaultQueueSurface` — command-core reuse), and
`task-linear-sync/queue` reads (`readPendingJob`, `readQueueLockRecord`) for status.
`package.json` gains exactly one additive `exports` entry `"./mcp"`.

**Storage**: **None.** The plan-reference store is a process-lifetime in-memory map
(session-scoped by construction: restart ⇒ empty ⇒ `PLAN_REFERENCE_UNKNOWN` refusals); the
module group imports ZERO `node:fs`/`node:fs/promises` (hygiene contract) — every state
read (stored plans, report artifacts, last-run marker) goes through the injected frozen
`StateStore`. No new config file; an optional `mcp` group rides the frozen deep-merge
config model, validated in `src/mcp/config.ts` like `src/queue/config.ts` (research R5/R8).

**Testing**: `node:test` + `node:assert/strict`, existing tiers (`unit`, `contract`,
`integration`, `e2e`) via `scripts/run-tests.mjs`; tests-first per constitution VI. Unit:
JSON-RPC parsing/framing, dispatch table + visibility gating, plan-reference store, config
validation. Contract: tool-schema shapes, `./mcp` export + dependency-budget proof (still
zero), defaults-scan (zero org ids), credential sentinel, hygiene scan (zero `node:fs`,
single `process.env` read, import allowlist). Integration: in-process line streams against
the 007 fake over the 009 harness worlds; full gated apply story; HTTP transport refusal
matrix. E2e: spawned child process speaking REAL JSON-RPC over stdio against the fake
tracker (plan → reference → gated apply → status; disabled-apply invisibility; restart
clears references). Deterministic, injected `Clock`, hermetic temp state dirs outside the
repo working tree.

**Target Platform**: Node.js ≥ 20 agent host embedding the server over stdio (the default)
or reaching it over the optional loopback HTTP transport; consumed as
`task-linear-sync/mcp` (constitution names this surface `MCP_Server`). No new `bin` entry:
agent hosts import the barrel or spawn a small driver (`node` + the stdio lane), mirroring
009's e2e driver pattern.

**Project Type**: Single npm package (existing); this feature owns the disjoint
`src/mcp/` module group and its tests/fixtures. No frozen 002 module and no Wave-2/3 module
is edited (ROADMAP rule 2); 012 imports them.

**Performance Goals**: Tool calls are engine-bound (planning is the expensive step and is
owned by 008); the protocol layer adds O(JSON size) parsing and one screening pass per
propagated string. Stdio framing handles line-delimited messages up to a 1 MiB request cap
(rejecting oversized lines, never truncating).

**Constraints**: Zero new runtime dependencies (R1); Node 20 APIs only (R11); read-only
tools perform zero tracker mutations and zero repository writes (constitution I — asserted
from the fake-port call log and repo-tree hashing); `task_sync_apply` refuses while
disabled with NO state change and is absent from `tools/list` (FR-002); the module owns
zero gate/sync logic — one `GateRequest`, one `applySyncPlan` call, engine re-runs every
guard (constitution V); outputs screened, hashes not bodies (FR-005); errors and logs name
no credential/token value (constitution "Credential handling"); HTTP transport authenticates
BEFORE any tool dispatch (FR-004); defaults carry zero org identifiers (Principle III).

**Scale/Scope**: 5 FRs (001 FR-090…094), 3 SCs, 3 user stories; ~12 source modules behind
one subpath export; 4 tools (3 visible + 1 gated); 2 transports; ~45 tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Read-only tools reuse the 009 `runCli` read-only lanes (`createReadOnlyGuard`) — structurally zero mutations/writes (SC-002 asserts repo-tree hash + fake-port call log). `task_sync_apply` reaches ONLY `engine.applySyncPlan` with a verbatim `GateRequest` (exact confirmation key, accept-low-confidence, plan reference); the session-store membership check adds the spec's session-scoping rule on TOP of the frozen gates, never replacing one. Disabled-state invocations refuse before any engine/port touch. Screening: every tool-output string passes the injected `SecurityScreener` (the CLI lanes' screened writers do the plan/inventory paths). | PASS |
| II. Durable Identity | No identity logic of its own: plan entries/UUIDs come from the frozen engine plan/report artifacts verbatim; the plan reference is the frozen sha256 `planId`. The store keys on `planId` only. | PASS |
| III. Intelligent Defaults, Overridable Configuration | New optional `mcp` config group resolved in `src/mcp/config.ts` (the `src/queue/config.ts` precedent): `enabled` default `false`, `transport` default `"stdio"`, `host` default `"127.0.0.1"`, `port` default `0` (ephemeral, printed to stderr), `tokenEnvVarName` default toolId-derived `<PREFIX>_MCP_TOKEN`. Deep-merge: built-in defaults then the raw group from `ResolvedConfig`; complete-listing validation. Zero org identifiers/tokens/UUIDs in defaults, docs, or fixtures. | PASS |
| IV. Determinism and Idempotency | All time math on the injected `Clock`; protocol dispatch is a pure function of (state, message); the session store's only nondeterminism is its lifetime, which the spec pins as session-scoped. Re-applying with a drifted reference deterministically refuses (`PLAN_REFERENCE_STALE` from the engine). No wall-clock, no random ids in outputs. | PASS |
| V. One Engine, Additive Surfaces | The module implements ZERO gating/locking/journaling/sync logic: read-only tools route through `runCli` (009 command cores — no forked report rendering), status through the frozen `readLastRunMarker`/queue read functions, apply through the same frozen composition and `applySyncPlan` posture as `src/queue/apply-runner.ts`. Strictly additive: one new subpath export, no removed capability, all Linear access through the injected `Linear_Port` (via CLI/engine composition). | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR/SC maps to ≥1 automated test (quickstart traceability table). Pyramid: unit (framing, dispatch/visibility, store, config) → contract (tool schemas, `./mcp` packaging + zero-dep budget, defaults scan, credential sentinel, hygiene/source scan) → integration (in-process stdio over fake worlds, full gated apply, HTTP refusal matrix) → thin e2e (spawned real-JSON-RPC child, restart-clears-references). Story-phase tests written first, red before implementation. | PASS |
| Additional constraints | *Port/adapter*: injected `LinearPort` only (through frozen factories). *Credential handling*: tracker + MCP auth tokens read server-side from env-var NAMES; never in tool results, errors, logs, or JSON-RPC messages (sentinel contract test); constant-time compare. *Resilience*: port retry posture untouched. *Technology stack*: zero runtime deps (budget test stays `0`); one additive `exports` entry; Node ≥ 20. *No org-specific literals*: fixtures use synthetic UUIDs + placeholder keys. | PASS |
| Development workflow / quality gates | No pipeline changes: existing tiers + coverage gate run the new files. Documentation duty (same change): `docs/agent-tools.md` (agent usage scenario, tool table, enablement + token setup, transport options, safety posture) + README export/status lines, placeholder identifiers only. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/012-ai-agent-tool-interface/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 012-local interfaces only
│   ├── jsonrpc-stdio.md     # framing, handshake/lifecycle, method table, JSON-RPC error codes
│   ├── tool-definitions.md  # the four tools: input schemas, output shapes, visibility rules
│   ├── apply-gating.md      # apply pipeline: enablement → session store → engine GateRequest
│   ├── transport-auth.md    # stdio default, http bearer gate, pre-auth refusal, leak rules
│   └── component-api.md     # createAgentToolServer(deps), settings view, hygiene invariants
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                    # + one exports entry "./mcp" (additive; deps unchanged)

src/
├── domain/ config/ state/ urls/ gates/ ports/       # FROZEN (002) — imported, never edited
├── tracker/ engine/ discovery/ parsing/ ...         # Wave-2/3 — imported, never edited
├── cli/                                            # 009 — runCli + context + queue seam REUSED
├── queue/                                          # 010 — readPendingJob/readQueueLockRecord REUSED
└── mcp/                             # ← 012's disjoint module group (MCP_Server)
    ├── index.ts                     # public surface for the ./mcp subpath
    ├── create.ts                    # composition root: createAgentToolServer(deps)
    ├── config.ts                    # `mcp` group defaults + complete-listing validation
    ├── jsonrpc.ts                   # JSON-RPC 2.0 types, parse/serialize, closed error codes
    ├── framing.ts                   # newline-delimited line framing (1 MiB cap, never truncates)
    ├── stdio.ts                     # stdio transport glue (process streams; stderr diagnostics)
    ├── http.ts                      # optional node:http transport (bearer gate BEFORE dispatch)
    ├── auth.ts                      # server-side token read + timingSafeEqual + fixed envelopes
    ├── tools.ts                     # dispatch table: definitions + visibility gating (FR-002)
    ├── handlers.ts                  # the four tool cores (CLI-command reuse; engine pass)
    ├── plan-store.ts                # session-scoped plan-reference store (in-memory)
    └── errors.ts                    # refusal taxonomy reusing frozen GateFailureCode vocabulary

tests/
├── unit/                            # mcp-jsonrpc / mcp-framing / mcp-tools / mcp-plan-store /
│                                    #   mcp-config / mcp-handlers
├── contract/                        # mcp-tool-schema, mcp-packaging (+ budget proof),
│                                    #   mcp-hygiene, mcp-credential-sentinel, defaults-scan mcp lines
├── integration/                     # mcp-stdio (read-only story, SC-002), mcp-apply (US2 full
│                                    #   gated story + refusals), mcp-http (pre-auth matrix)
├── e2e/                             # mcp-user-stories (spawned stdio child, restart-clears)
├── helpers/mcp-harness.ts           # in-process line pipe over 009/008 fake worlds, child driver
│                                    #   emitter, JSON-RPC client helper, token/env fixtures
└── fixtures/mcp/                    # world reuse of tests/fixtures/{engine,cli}/worlds conventions
```

**Structure Decision**: Single npm package (constitution "Technology stack"), continuing
the 007/008/009/010/011 disjoint-module precedent with the new `src/mcp/` group behind one
additive subpath export. 012 touches only `src/mcp/**`, `tests/**/mcp-*` +
`tests/fixtures/mcp/**`, `tests/helpers/mcp-harness.ts`, one additive `package.json`
exports entry, `docs/agent-tools.md`, the README status lines, and its own
`specs/012-ai-agent-tool-interface/**`. All frozen 002 modules and Wave-2/3 modules are
imported through their declared surfaces, never edited (ROADMAP rule 2). Import direction:
mcp → {cli, queue, engine, tracker, state, config, gates, ports}; nothing imports `src/mcp`
— it stays the leaf surface parallel to 011.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) the MCP SDK — rejected (research R1): forces a deliberate zero-to-one
amendment of the dependency-budget contract plus a transitive dep tree, while the required
protocol surface (initialize, tools/list, tools/call, notifications) is a small closed
subset; (2) persisting the plan-reference store in the state directory — rejected: the spec
defines references as session-scoped ("restart clears"), and persistence would weaken the
unique stale-reference guarantee the agent path adds; (3) implementing gate evaluation
(short-circuiting the engine) for disabled/stale refusals — rejected: constitution V; the
module checks only what it OWNS (enablement flag, session membership) and lets the frozen
engine report every `GateFailure` together.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design adds no runtime dependency (budget test stays `0`),
edits no frozen 002 module or contract (gate vocabulary, `GateRequest`, plan/report schema,
`StateStore`, and screener are consumed verbatim), opens no filesystem handle anywhere in
`src/mcp/**` (the store is in-memory; state reads go through the injected `StateStore` —
proven by `tests/contract/mcp-hygiene.test.ts`), implements no parallel gating/locking path
(apply is one `GateRequest` + one `applySyncPlan` call, the `src/queue/apply-runner.ts`
posture), and the FR/SC → test traceability is fixed in quickstart.md. No Complexity
Tracking entries were created by the design.
