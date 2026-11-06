# Phase 0 Research: AI-Agent Tool Interface

**Feature**: `012-ai-agent-tool-interface` | **Date**: 2026-11-06

Resolves every Technical Context unknown and every dependency/integration question.
No NEEDS CLARIFICATION remains in plan.md; the spec-advisory points (wire format is
unpinned by the spec, "earlier this session" semantics, transport breadth) are each resolved
with a Decision below. Each entry: **Decision / Rationale / Alternatives considered**.

## R1. Zero-dependency MCP-compatible implementation vs the MCP SDK (the dependency-budget decision)

- **Decision**: Hand-roll the MCP-compatible surface with **zero new runtime dependencies**.
  `src/mcp/` speaks JSON-RPC 2.0 with newline-delimited UTF-8 message framing over stdio
  (the MCP stdio-transport shape) and implements exactly the handshake subset
  `initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call`
  (research R2). `tests/contract/tracker-dependency-budget.test.ts` is NOT amended: its
  `SPENT` constant stays `0`, its ceiling stays `1`. The constitution's technology-stack
  clause ("runtime dependencies limited to Node built-ins plus exactly one platform
  transport dependency (the MCP SDK MAY be scoped to the `<pkg>/mcp` subpath)") is a
  permission, not a mandate — unspent is the cleanest pass.
- **Rationale**: The budget test pins runtime deps to exactly zero and calls any addition
  "a deliberate amendment"; the constitution (Governance) forbids silent deviation, so
  adopting the SDK would require a cross-cutting amendment of a frozen-contract test plus a
  transitive dependency tree for a protocol surface that is a *closed, small subset*
  (five methods, three error codes the client ever sees, one framing rule). Node 20
  built-ins cover everything: string parsing (`JSON.parse`), streams (`node:process`),
  `node:http` for the optional transport, `node:crypto` `timingSafeEqual` for the token.
  Zero-dep also keeps the supply-chain and install posture identical to every shipped wave
  feature, and keeps the `<pkg>/mcp` subpath importable with nothing installed alongside.
- **Alternatives considered**: (a) `@modelcontextprotocol/sdk` — rejected: spends the one
  allowance plus its transitive tree, forces the budget-test amendment (SPENT 0→1) and a
  packaging-allowlist update, and its extra protocol surface (resources, prompts, sampling,
  elicitation, roots, subscriptions) is unused here; (b) amend the budget contract while
  still hand-rolling — rejected: no benefit, visible churn on a frozen-contract test;
  (c) WebSocket/SSE-only transport — rejected: MCP stdio is the agent-host default the spec
  pins (FR-004), and `node:http` polling/POST covers the networked option without deps.
- **Revisit trigger**: if a future feature needs SDK-only protocol surface (streamable HTTP
  transport, sampling), that change carries the amendment explicitly.

## R2. Wire protocol: JSON-RPC 2.0 framing + MCP handshake subset

- **Decision**: Messages are single-line, compact JSON-RPC 2.0 objects, `\n`-separated,
  UTF-8; stdout carries protocol bytes ONLY (diagnostics go to stderr). Implemented
  protocol version: `"2025-03-26"`; `initialize` echoes the client's requested version when
  supported (the set is `{"2024-11-05", "2025-03-26"}`), otherwise answers with our latest.
  Server capabilities advertise `tools` only; `serverInfo.name` derives from
  `config.toolId` (`<toolId>-mcp`) — no org literals. Lifecycle: requests before a completed
  `initialize` fail with JSON-RPC error `-32002`; `notifications/initialized` and
  `notifications/cancelled` are accepted no-ops; unknown notifications are dropped silently
  (no response to a notification, per JSON-RPC); unknown requests fail `-32601`; malformed
  lines fail `-32700` (with `null` id); structurally invalid requests fail `-32600`. Tool
  failures are MCP **tool-call results** (`isError: true` + screened text), NOT JSON-RPC
  protocol errors — protocol errors are reserved for framing/unknown-method faults so an
  agent host distinguishes "bad wire" from "refused operation". A single request line is
  capped at 1 MiB (oversized ⇒ `-32700` + line drop, never a silent truncation).
- **Rationale**: This is the MCP stdio transport's normative shape (newline-delimited
  JSON-RPC, no embedded raw newlines in a message), so any MCP-conformant agent host
  interops without the SDK. Pinning refusals as `tools/call` results keeps every gate/error
  text inside the screened output posture (FR-005) instead of raw transport bytes.
- **Rationale for the version set**: both listed versions share the initialize/tools shape
  we implement; echoing avoids needless client-side version churn.
- **Alternatives considered**: (a) LSP-style `Content-Length` headers — rejected: not the
  MCP stdio convention; (b) full MCP surface behind a compatibility shim — rejected (R1);
  (c) returning JSON-RPC errors for refusals — rejected: leaks an unscreened `message`
  channel outside the tool-result posture and confuses hosts that retry transport errors.

## R3. Tool registry, dispatch table, and visibility gating (FR-001/FR-002)

- **Decision**: `src/mcp/tools.ts` owns a static registry mapping tool name → definition
  (`name`, `description`, MCP `inputSchema` as a JSON-Schema object with
  `additionalProperties: false`) + handler id. `tools/list` renders ONLY enabled-visibility
  entries: the three read-only tools always; `task_sync_apply` only when the resolved
  settings say `enabled: true` (research R8). Dispatch checks the SAME visibility function:
  calling `task_sync_apply` while disabled returns `isError: true` with a refusal naming the
  config key (`mcp.enabled`) and the tool — and touches neither the engine nor the port
  (SC-001/SC-003: zero state change). Unknown tool names return `isError: true` (MCP
  convention for bad `tools/call` arguments), never a protocol error. Argument validation
  against the input schema is done by the module's own small validator (the queue-config
  complete-listing posture: all problems in one message).
- **Rationale**: One table, one visibility predicate — the same predicate drives list and
  call, so a listing can never advertise what dispatch refuses (SC-003's 100% both-ways
  rule). Registry definitions are data, unit-testable without any world.
- **Alternatives considered**: (a) `Object` map mutated at runtime per session — rejected,
  visibility is a pure function of settings; (b) JSON-RPC error for disabled calls —
  rejected (R2); (c) hiding the tool but answering "unknown tool" when called disabled —
  rejected: the spec demands "a clear error", so the refusal names the enablement knob.

## R4. Read-only tools reuse the 009 CLI command cores (no forked rendering)

- **Decision**: `task_sync_inventory` and `task_sync_plan` invoke `runCli` from `src/cli`
  with a harness-injectable `CliContext` (the same seam 009 froze) and captured
  stdout/stderr arrays: inventory → `runCli(["inventory", <repo>], ctx)`; plan →
  `runCli(["check", <repo>], ctx)` (the machine-facing sibling: same read-only lane, one
  JSON `CheckSummary` line). `check`'s exit `8` (`CHECK_FINDINGS`) is a SUCCESS outcome for
  the tool — findings are content, not transport errors; any other non-zero exit becomes a
  screened `isError: true` result carrying the captured stderr line. For the plan tool the
  `planId` is taken from the `CheckSummary` payload, and the schema-frozen report JSON is
  then read via `state.readJson("reports/<runId>/report.json")` (path derived from the
  summary itself — the same provenance cross-check 009's `check` performs) and embedded
  under a `report` field: it is already screened, hash-based (`descriptionContentHash`, no
  body/description fields — the frozen 002 schema structurally excludes them), and durable-id
  only, so returning it verbatim mirrors the review report WITHOUT re-rendering anything
  (the Markdown sibling stays the human artifact; it is never returned).
- **Rationale**: `runCli` gives the tools, for free, the frozen read-only lane guard
  (`createReadOnlyGuard`, allowed-write prefixes `reports/`+`plans/` into the state dir —
  never the repo working tree), the screened writers, the exit-code taxonomy, and 013's
  machine-input posture. Re-implementing discovery/parse/report composition inside 012 would
  fork 009's rendering (forbidden by the feature brief and constitution V).
- **Alternatives considered**: (a) calling `engine.buildSyncPlan` directly and reshaping —
  rejected: forks report handling and bypasses the 009 lane guard; (b) returning the
  Markdown report — rejected: humans' artifact, not machine input, and larger; (c) spawning
  the real CLI binary per call — rejected: an agent server embeds the library; process
  churn adds nondeterminism with zero isolation benefit (same package, same guard).

## R5. Plan-reference store: session-scoped, in-memory, empty after restart

- **Decision**: `src/mcp/plan-store.ts` is a process-lifetime `Map<string, { planId;
  storedAt }>` keyed by the frozen 64-hex `planId`. `task_sync_plan` records the reference
  after a successful run (exit 0/8 + report provenance verified). `task_sync_apply` MUST
  find the presented reference in this map BEFORE touching the engine; absence ⇒ refusal
  `PLAN_REFERENCE_UNKNOWN` ("no plan reference produced in this session; run
  task_sync_plan") with zero state change — even when a stored plan for that id exists on
  disk (the session rule is strictly narrower than the engine's stored-plan rule, which is
  exactly the edge case the spec names: "plan references produced before a restart are
  unknown"). The store keeps no plan bodies (the engine reads the stored plan itself), no
  TTL, and no persistence; restart clears it by construction.
- **Rationale**: The spec's "earlier this session" is a session-membership rule, not a time
  rule (spec Assumptions pin freshness to the engine's stability guards, not wall-clock).
  In-memory is the only honest implementation of "empty after restart" — a persisted store
  would resurrect references. Zero fs, so the hygiene scan bans `node:fs` group-wide.
- **Alternatives considered**: (a) persist to the state dir with a boot-time wipe —
  rejected: crash-recovery windows would resurrect references; (b) rely on the engine's
  `readStoredPlan` alone for unknown references — rejected: plans stored by a previous CLI
  session would be applyable without ever being presented this session; (c) LRU/TTL bounds —
  rejected: unnecessary (one map, bounded by plans-per-session; freshness is guard-based).

## R6. Apply posture: the frozen gated entry only (the 010 runner pattern)

- **Decision**: `task_sync_apply` builds ONE `GateRequest` — `{ applyFlag: true,
  confirmationKey: <argument>, acceptLowConfidence: <argument, default false>,
  planReference: <argument> }` — loads the `StoredPlan` via
  `state.readJson("plans/<planId>.json")` (null ⇒ `PLAN_REFERENCE_UNKNOWN`, mirroring the
  CLI apply handler's pre-check), and calls `engine.applySyncPlan(stored.plan, gates)` —
  the identical posture `src/queue/apply-runner.ts` uses. Result mapping: `refused` ⇒
  `isError: true` listing EVERY `GateFailure.code` + `detail` (complete listing, frozen
  vocabulary — no surface-local gate codes are invented); `aborted` ⇒ error naming the run
  id and directing to the run reports; `applied` ⇒ `{ runId, applied/skipped/failed
  counts, reportPaths }`, the same counts the CLI prints. Zero CLI-side gating: the module
  never re-evaluates confirmation keys, low-confidence bands, or stability guards — the
  engine re-runs them (gates → lock → guard re-check → per-issue read-back) and its
  `PLAN_REFERENCE_STALE`/`LOCK_HELD` refusals pass through verbatim.
- **Rationale**: Constitution V: "no surface MAY reimplement a divergent gating". 010
  proved the pass-through shape; the only 012-specific check is session membership (R5),
  which is registration/visibility policy the spec explicitly OWNS here, not gate logic.
  SC-001 (0 mutations on every refusal path) is then inherited from the engine's
  pre-lock, zero-port-call refusal design.
- **Alternatives considered**: (a) re-validating `validatePlanReference` in the module
  before the engine call — rejected: duplicate predicate; the engine runs it against LIVE
  hashes/HEAD, which a pre-check could only race; the session-membership check is not that
  predicate; (b) auto-accepting low confidence when the plan reference is fresh — rejected:
  the argument stays explicit (010's `autoAcceptLowConfidence` never-widened posture);
  (c) forcing bootstrap/sync mode — rejected: mode is engine-selected (CLI precedent).

## R7. `task_sync_status`: read-only last-run + queue state

- **Decision**: The status tool composes three frozen read paths — no CLI process, no
  rendering reuse needed because none exists for this payload shape:
  (1) `readLastRunMarker(state)` from `src/state` (marker shape frozen in 002
  `LastRunMarker`); (2) `readPendingJob(state)` + `readQueueLockRecord(state, ...)` from
  `task-linear-sync/queue` (the barrel's documented "012 reuse" seam — pure state-dir
  reads, zero writes); (3) the session store's reference count (`planReferencesAvailable`).
  Output shape `status` (contracts/tool-definitions.md §3): `{ schemaVersion: 1, lastRun:
  LastRunMarker | null, queue: { pendingJob: {...} | null, workerRunning: boolean },
  session: { planReferencesAvailable: number } }`, all strings screened. The tool
  constructs no `GateRequest` and its result type carries no mutation field (frozen
  engine-gates.md rule 4 asserted by a contract test via an engine spy: read-only calls
  never reach `applySyncPlan`/`rollbackRun`).
- **Rationale**: Spec FR-001 says status = "current status and last-run information"; the
  010 queue barrel already exports exactly the read-only views (pending job, lock record)
  the briefing pins, and both are pure `StateStore` reads. Zero engine mutation surface is
  provable by spy assertions.
- **Alternatives considered**: (a) `runCli(["last-run"])` — rejected: presents for humans
  (single marker) and would need the queue surface's async wiring anyway; (b) reading
  `queue.json`/`lock.json` files directly — rejected: forks the queue's parsing; (c)
  surfacing lock internals (pid, takeover math) — rejected: only the boolean
  `workerRunning` is status-relevant; internals stay the queue's.

## R8. Configuration: the additive `mcp` group on the frozen deep-merge model

- **Decision**: An optional `mcp` group inside the existing config file, validated in
  `src/mcp/config.ts` on the exact `src/queue/config.ts` precedent (module-side defaults +
  pure read of `ResolvedConfig`; the frozen 001 schema is NOT edited). Keys and defaults:
  `enabled: false` (mutating-tool enablement), `transport: "stdio"` (or `"http"`),
  `host: "127.0.0.1"` (absolute loopback default; any host must be explicit),
  `port: 0` (integer 0–65535; 0 = ephemeral, chosen port emitted once to stderr at
  listen — never to a protocol stream), `tokenEnvVarName: <PREFIX>_MCP_TOKEN` derived via
  the frozen `envVarPrefixFor(toolId)`. Unknown keys / out-of-range values ⇒ ONE
  dotted-key line listing ALL problems (complete listing). Defaults carry zero org
  identifiers (defaults-scan additions). `enabled` semantics: settings-level enablement of
  mutating tools; the engine gates in R6 stay mandatory regardless.
- **Rationale**: 002 III demands every value overridable with a sensible built-in default,
  deep-merged; 010 proved a module-local validator is the additive way to add a surface
  group without touching frozen schema (the distributed-defaults scan + packaging tests
  stay untouched). Loopback + ephemeral defaults mean an accidentally-enabled networked
  transport binds the least-exposed socket possible.
- **Alternatives considered**: (a) extending the frozen 001 schema — rejected: amendment of
  a frozen contract for a surface-local group; (b) env-vars-only configuration — rejected:
  the consumer's config file is the established deep-merge layer; env stays reserved for
  the two secret-bearing reads (token, tracker credentials) per constitution; (c) default
  fixed port — rejected: collision-prone and invites accidental exposure; ephemeral +
  stderr line keeps it explicit.

## R9. Optional networked transport: node:http + server-side bearer token, auth before dispatch

- **Decision**: `transport: "http"` serves the same dispatcher over `node:http`:
  `POST <basePath>` (default `/mcp`) with one JSON-RPC message per request; every other
  method/path ⇒ fixed 404/405 constants. A valid `Authorization: Bearer <token>` header is
  required for EVERY request including `initialize`: token compared
  `timingSafeEqual`-style against the env-sourced value (constant-time, length-guarded);
  missing ⇒ fixed 401 envelope + `WWW-Authenticate: Bearer`; wrong ⇒ fixed 403 envelope;
  both bodies are compile-time constants (no echo of the presented or configured value,
  no session material). Authentication runs strictly BEFORE any dispatch (no handler,
  engine, or port call happens pre-auth — asserted from the fake-port call log). The token
  env var must be non-empty at construction when transport is `"http"` (naming the NAME
  only — the 011 construction refusal posture). JSON-RPC *protocol* errors for unauthorized
  requests are impossible by construction: the transport refuses the HTTP request, not the
  message. stdio remains the default transport and needs no token (local pipe IS the trust
  boundary, matching MCP stdio convention).
- **Rationale**: FR-004 pins credentials server-side + valid token before serving any tool
  call; 011 froze the leak-free 401/403 + timing-safe compare + "auth strictly before
  tracker probe" mechanics — reusing that posture (simplified: static bearer, no cookie
  sessions, because a JSON-RPC client resends the header per request anyway) keeps one
  credential story across Wave-4 surfaces. TLS termination stays a deployment concern
  (spec edge case: token posture unchanged; gating never weakens by transport).
- **Alternatives considered**: (a) session cookies / HMAC tokens à la 011 — rejected:
  stateless per-request bearer is the MCP HTTP norm and removes expiry/session math;
  (b) token in the JSON-RPC params — rejected: credential material inside protocol messages
  would leak into logs/outputs; (c) mTLS — rejected: deployment-level, out of scope.

## R10. Output posture: screened, hash-based, credential-free errors

- **Decision**: Every string the server can emit (tool text content, error details,
  JSON-RPC error `message`s, stderr diagnostics) is produced from either (a) compile-time
  constants, or (b) values that already passed the injected `SecurityScreener` (the CLI
  lanes screen `runCli` output; `handlers.ts` screens status/apply summaries through the
  same screener instance the context builds). Raw task bodies/descriptions NEVER enter a
  tool result: the frozen report schema structurally excludes them (hashes only), and the
  status/apply payloads carry ids, counts, paths, and ISO timestamps. A credential-sentinel
  contract test plants a sentinel token env value AND a hostile fixture string and sweeps
  the full corpus (stdio + http × enabled/disabled × success/refusal) for zero occurrences
  — the 011/007 sentinel precedent.
- **Rationale**: FR-005 + constitution "Credential handling" ("MCP outputs" named
  explicitly). Screening at the composition point (not per-field) mirrors `createScreenedWriter`.
- **Alternatives considered**: (a) hash everything client-side — rejected: ids/paths/counts
  must stay readable for agent decisions; (b) trust `GateFailure.detail` unscreened —
  rejected: it is sanitized by the engine but still engine-composed text; a screener pass
  keeps the guarantee surface-local and testable.

## R11. Node 20 API constraints

- **Decision**: Only APIs present in Node 20 LTS: `JSON.parse`/`JSON.stringify`,
  `process.stdin/stdout/stderr` (`readline`-free manual line splitting on `\n` in a
  hand-rolled buffer framer — `node:readline` is avoided because its `crlfDelay` behavior
  complicates deterministic flushing in tests; both transports feed the SAME framer),
  `node:http.createServer`, `node:crypto.createHash`/`timingSafeEqual`, `node:buffer`
  `Buffer.byteLength`. No `crypto.hash` (Node 21+), no `fs.globSync`, no experimental
  flags, no `AbortSignal.timeout`-style additions newer than 20 (`AbortSignal.abort` and
  `AbortController` are 20-safe and used for http socket teardown). A contract-tier grep
  (mcp-hygiene) pins the import allowlist.
- **Rationale**: CI matrix is 20.x/24.x (briefing hard rule 4); the framer removes a
  stream-behavior variable from the framing unit tests.
- **Alternatives considered**: (a) `node:readline` — rejected for determinism control
  (partial-line + close ordering); (b) `stream/promises` composition only — kept available
  but the framer keeps chunk-boundary handling explicit and unit-testable.

## R12. Test tiers and harness plan (Principle VI)

- **Decision**: New `tests/helpers/mcp-harness.ts` builds on `buildCliWorld` (009) —
  (1) `withMcpServer(worldOpts, settingsOverrides, fn)`: constructs the server IN-PROCESS
  over the fake world with an injected `fixedClock` + injected `env` (sentinel token) and a
  `Duplex`-like line pipe so tests write JSON-RPC lines and read responses synchronously;
  (2) `withHttpServer(...)`: same over a REAL `node:http` server on an ephemeral port
  (fetch via loopback only); (3) `writeMcpDriver(...)`: emits the child-process driver for
  e2e (imports `task-linear-sync/mcp` with the `dist/` absolute fallback — the 009
  `writeDriver` pattern), wiring the fake world exactly like the CLI driver so e2e spawns a
  REAL stdio MCP server against the fake tracker. Fixture worlds reuse
  `tests/fixtures/{engine,cli}/worlds/` conventions (placeholder identifiers, synthetic
  UUIDs; a small `tests/fixtures/mcp/README.md` records the conventions). Tier map:
  unit (jsonrpc/framing/tools/plan-store/config) → contract (tool-schema, packaging+budget,
  hygiene, credential-sentinel, defaults-scan) → integration (stdio read-only story with
  repo-tree-hash + call-log zero proofs; apply full story: disabled / wrong key /
  never-produced ref / pre-restart ref / drift / success; http pre-auth matrix) → e2e
  (spawned child: initialize → tools/list × enabled/disabled → plan → apply → status;
  second spawn refuses the first spawn's reference). Coverage: module-local unit density
  per the 80/70/80 gate.
- **Rationale**: One harness mirrors every surface precedent (009 driver, 011 ephemeral
  port), keeps tests hermetic/deterministic, and makes the restart-clears-references edge
  case a two-spawn e2e assertion rather than a mock.
- **Alternatives considered**: (a) socketpair-only integration (no real stdio) — rejected:
  the briefing demands real JSON-RPC over spawned stdio at e2e; (b) recording proxy around
  the real SDK client — rejected (R1, zero-dep).
