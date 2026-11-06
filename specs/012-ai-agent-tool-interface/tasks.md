---

description: "Task list for feature 012 — AI-agent tool interface"

---

# Tasks: AI-Agent Tool Interface

**Input**: Design documents from `specs/012-ai-agent-tool-interface/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/ (jsonrpc-stdio, tool-definitions, apply-gating, transport-auth, component-api), quickstart.md

**Tests**: INCLUDED — constitution VI (Test-First, NON-NEGOTIABLE) and plan.md mandate automated coverage for every FR/SC, including contract and security tiers. Story-phase tests are written FIRST and must FAIL before their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = read-only tools over stdio (P1); US2 = gated `task_sync_apply` through the frozen engine (P2); US3 = transports + token-gated network opt-in (P3)
- All frozen 002 modules and Wave-2/3 modules (003–008) plus sibling Wave-4 groups (010, 011) are **import-only** — never edit them. 012 touches only `src/mcp/**`, `tests/**/mcp-*`, `tests/helpers/mcp-harness.ts`, `tests/fixtures/mcp/**`, one additive `package.json` exports entry, `docs/agent-tools.md`, README status lines, and this specs folder.
- Zero new runtime dependencies and NO amendment to `tests/contract/tracker-dependency-budget.test.ts` (research R1 — the transport allowance stays unspent): hand-rolled newline-delimited JSON-RPC 2.0 (MCP stdio posture) on Node built-ins only. Behavior-bearing built-ins: `node:http` (inbound listener), `node:crypto` (`timingSafeEqual` + optional `createHash`), `node:process` (ONE env-read file). `node:fs` is FORBIDDEN in `src/mcp` (component-api.md §3.1). Node 20 APIs only; no experimental flags.
- All paths are repository-root-relative.

## Path Conventions

Single npm package: `src/mcp/` (012's disjoint module group), `tests/{unit,contract,integration,e2e}/`, `tests/helpers/mcp-harness.ts`, `tests/fixtures/mcp/**`. Tests run via `node scripts/run-tests.mjs` tiers with `node:test` + `node:assert/strict`, the frozen `FakeTracker` (via `task-linear-sync/tracker/testing`) and `buildCliWorld` worlds (`tests/helpers/cli-harness.ts`), spawned stdio children (`writeDriver` pattern), real `node:http` on an **ephemeral loopback port**, and `fixedClock` — zero external network, zero real credentials, deterministic outputs (no wall-clock, no `randomUUID` for decisions). Fixture literals are placeholders only (the credential sentinel and defaults scan fail real org ids/tokens/UUID-looking secrets).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Packaging surface and module skeleton for the mcp module group

- [ ] T001 Add one additive `"./mcp"` subpath export to `package.json` (`types` `./dist/mcp/index.d.ts`, `default` `./dist/mcp/index.js`) — zero dependency changes, zero other manifest edits, no new `bin` (research R1; contracts/component-api.md §4)
- [ ] T002 Create the empty module group skeleton: `src/mcp/index.ts` placeholder barrel + `src/mcp/errors.ts` (re-export placeholder for the §7 taxonomy) so the build has a target; `npm run typecheck` + `npm run build` pass and emit `dist/mcp/index.js` + `dist/mcp/index.d.ts` (build wildcards cover `src/mcp`)

**Checkpoint**: Packaging entry + skeleton compile; nothing functional yet

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives all three stories depend on: JSON-RPC layer, line framer, `mcp` config group, session plan-reference store, tool registry + visibility, refusal taxonomy, composition-root skeleton, test harness

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail)

- [X] T010 [P] Write unit tests for the JSON-RPC layer in `tests/unit/mcp-jsonrpc.test.ts` (contracts/jsonrpc-stdio.md §2–§4; data-model §1): request/notification discrimination and id bookkeeping (notifications NEVER get a response, including on parse failure); the closed emitted-code set `-32700/-32600/-32601/-32602/-32603/-32002` and nothing else; handshake state machine — pre-initialize requests ⇒ `-32002` (notifications dropped), `initialize` echoes a supported version (`2024-11-05`, `2025-03-26`) else answers `2025-03-26` with `capabilities: { tools: {} }` and `serverInfo.name = "<toolId>-mcp"` (toolId-derived, zero org literals), second `initialize` ⇒ `-32602`, `ping` ⇒ `{}` once ready; unknown methods ⇒ `-32601` naming the METHOD TOKEN only; handler rejection ⇒ `-32603` with the fixed text `"internal error"` (never a wrapped exception message); `error.message` values are constants or method tokens (never presented input)
- [X] T011 [P] Write unit tests for the line framer in `tests/unit/mcp-framing.test.ts` (contracts/jsonrpc-stdio.md §1; data-model §2): split on `\n`, trailing `\r` stripped (CRLF hosts), blank lines ignored, chunks split/reassembled across feeds, a complete line over `MAX_LINE_BYTES` (1 MiB) yields the oversize sentinel (caller answers `-32700`, DROPS the line, the connection CONTINUES — never a partial parse, never a truncation-into-success), stream end with a non-empty partial tail decodes it exactly once, no state beyond the tail buffer (zero timers, zero fs)
- [X] T012 [P] Write unit tests for the `mcp` config group in `tests/unit/mcp-config.test.ts` (data-model §3; `src/queue/config.ts` precedent): `resolveMcpConfig(config)` returns `McpConfigResult` — built-in defaults `enabled: false`, `transport: "stdio"`, `host: "127.0.0.1"`, `port: 0`, `tokenEnvVarName` = `${envVarPrefixFor(toolId)}_MCP_TOKEN` derived from frozen 001 defaults at runtime (never a literal); deep-merge precedence (built-ins → config file `mcp` group → programmatic `settings` overrides); unknown keys / out-of-range values collect ALL problems into exactly ONE dotted-key line (complete listing, never fail-fast) with `ok: false` and pure defaults in `settings`; `transport` closed enum `"stdio" | "http"`, `port` integer 0..65535, `host` non-empty string, `tokenEnvVarName` env-var-name pattern; the read is pure over `ResolvedConfig` (the frozen 001 schema is NOT edited; no new 001 keys)
- [X] T013 [P] Write unit tests for the session plan-reference store in `tests/unit/mcp-plan-store.test.ts` (FR-003/FR-005 session rule; data-model §5; research R5): `record(planId)` accepts only the frozen 64-hex shape; `has`/`size`; a NEW store instance (simulated restart) sees ZERO references — every previously recorded id is unknown; recording the same `planId` twice is harmless; records carry `recordedAt` from the INJECTED clock; keys ARE the references (no plan bodies stored); zero persistence/TTL by construction (file-less by the T052 scan)
- [X] T014 [P] Write unit tests for the tool registry in `tests/unit/mcp-tools.test.ts` (FR-002; contracts/tool-definitions.md §1–§2): `TOOL_NAMES` is the closed four-name set; visibility is the PURE predicate `visible = !def.mutating || settings.enabled` driving BOTH `tools/list` rendering AND `tools/call` dispatch (list can never advertise what call refuses); at defaults the listing is EXACTLY the three read-only tools and pure per settings (identical across repeated calls, no dynamic visibility); `tools/call` with an unknown name resolves to the `isError` "unknown tool" posture (never `-32601`); the argument validator reports EVERY problem in one pass (`INVALID_ARGUMENTS` complete listing) — non-64-hex `planReference`, missing `confirmationKey`, unknown keys (`additionalProperties: false`), wrong types
- [X] T015 [P] Write contract test `tests/contract/mcp-tool-schema.test.ts` (FR-002/FR-003/SC-003): the four published `inputSchema` literals are equal to the tool-definitions.md §2 tables (frozen names `task_sync_plan`/`task_sync_status`/`task_sync_inventory`/`task_sync_apply`, `additionalProperties: false`, apply's `required: [planReference, confirmationKey]` + `acceptLowConfidence` default); across repeated sessions at defaults 100% of listings omit `task_sync_apply` (SC-003); with `enabled: true` the listing adds EXACTLY apply — nothing else changes; `description`/titles/examples carry placeholder identifiers only
- [X] T016 [P] Write contract test `tests/contract/mcp-packaging.test.ts` (component-api.md §4): `task-linear-sync/mcp` resolves via the exports entry to built `dist/` files with generated `.d.ts`; the exported names match component-api.md §2 (`createAgentToolServer`, `resolveMcpConfig`, `McpSettings`/`McpConfigResult`/`McpConfigError`, `PlanReferenceStore`, tool constants + `TOOL_NAMES`); the manifest `bin` map is unchanged; `tracker-dependency-budget` still proves SPENT 0

### Implementation for Foundational

- [X] T017 Implement the JSON-RPC 2.0 layer in `src/mcp/jsonrpc.ts`: message union parse/serialize (compact single-line, no raw `\n`), request/notification discrimination, handshake state machine + version negotiation, `Dispatcher` with method table, closed error-code constants (makes T010 pass)
- [X] T018 Implement the line framer in `src/mcp/framing.ts` per data-model §2 (makes T011 pass)
- [X] T019 Implement the `mcp` settings group in `src/mcp/config.ts`: `McpSettings`, built-in defaults, `resolveMcpConfig` complete-listing validation on the queue-config precedent, `McpConfigError` (makes T012 pass)
- [X] T020 Implement the session-scoped plan-reference store in `src/mcp/plan-store.ts`: `PlanReferenceStore` (`record`/`has`/`size`, in-memory Map, injected clock, zero fs) per data-model §5 (makes T013 pass)
- [X] T021 Implement the refusal taxonomy in `src/mcp/errors.ts`: `ToolRefusal` (`{ code: GateFailureCode | SurfaceCode, detail }`) + closed `SurfaceCode` set (`MUTATING_TOOLS_DISABLED`, `INVALID_ARGUMENTS`, `LANE_FAILURE`) reusing the frozen `src/gates` code vocabulary — no gate codes re-implemented (data-model §7)
- [X] T022 Implement the tool registry in `src/mcp/tools.ts`: the four `ToolDefinition`s with schema literals verbatim from tool-definitions.md §2, the visibility predicate (same predicate for list AND call), `TOOL_NAMES`, and the complete-listing argument validator (makes T014/T015 pass)
- [X] T023 Implement the composition-root skeleton `createAgentToolServer(deps)` in `src/mcp/create.ts` + the `src/mcp/index.ts` public surface per component-api.md §1–§2: construction order `resolveMcpConfig ∪ settings` → validate (ALL problems, one line) → transport preflight (http: token env var present — naming NAMES) → frozen factory bag exactly like `src/cli/context.ts` (`createLinearPort` + `createDefaultSecurityScreener` + `createSyncEngine` + `envVarKeyProvider`) → ONE `PlanReferenceStore`; `handleMessage(raw)` transport-agnostic dispatcher serving the lifecycle (`initialize`/`ping`/notifications/unknown-method), `tools/list` from the registry, and `tools/call` dispatching "unknown tool" until story cores register (makes the harness compilable; story wiring in T034/T043/T055)
- [X] T024 Create `tests/helpers/mcp-harness.ts` on the `buildCliWorld` base (research R12; mirroring `cli-harness.ts`): `withMcpServer(worldOpts, settingsOverrides, fn)` — IN-PROCESS server over the fake world with `fixedClock` + injected `env` (sentinel token) behind a `Duplex`-like line pipe (tests write JSON-RPC lines, read responses synchronously); `withHttpServer(...)` — same over a REAL `node:http` server on an ephemeral loopback port; `writeMcpDriver` (e2e child driver importing `task-linear-sync/mcp` with the absolute-`dist/` fallback — the 009 pattern) + a JSONL rpc client (`request`/`notify`/`collectUntilId`) with stderr capture; settings seeding writes ONLY the `mcp` group; plan-artifact/last-run-marker/queue-job fixtures reusing the engine/queue world conventions; `tests/fixtures/mcp/README.md` recording placeholder-identifier conventions; `hashTree` reuse for the SC-001/SC-002 equality proofs

**Checkpoint**: Foundation ready — protocol, framing, config, store, registry, taxonomy proven; story lanes touch disjoint files from here

---

## Phase 3: User Story 1 - Inspect the sync state through the agent tool surface (Priority: P1) 🎯 MVP

**Goal**: Three advertised read-only tools (`task_sync_plan`, `task_sync_status`, `task_sync_inventory`) reuse the 009 `runCli` lanes and frozen reads; `task_sync_apply` invisible by default; host stability under malformed traffic; zero mutations proven.

**Independent Test**: Run `node scripts/run-tests.mjs --tier unit --test-name-pattern mcp-handlers` plus `--tier contract --test-name-pattern mcp-tool-schema` plus `--tier integration --test-name-pattern mcp-stdio` plus `--tier e2e --test-name-pattern mcp-user-stories` (quickstart Scenarios 1 + 4): defaults list exactly three tools; plan output embeds the `PlanReportJson` verbatim at check exit 0 AND 8; SC-002 fake-port call log + repo-tree hash prove zero writes; malformed frames never kill the child.

### Tests for User Story 1 (write first, must fail) ⚠️

- [X] T030 [P] [US1] Write unit tests for the read tool cores in `tests/unit/mcp-handlers.test.ts` (FR-001/FR-005; research R4/R7; tool-definitions.md §3): **plan core** — `runCli` `check` at exit 0 AND exit 8 (`ExitCode.CHECK_FINDINGS`) both SUCCEED producing `{ schemaVersion: 1, planReference, generatedAt, lowConfidencePresent, counts, securityAssertions, report }` with `report` equal to the frozen `PlanReportJson` read through the injected `StateStore` (verbatim, screened/hashed — never re-rendered, Markdown sibling never returned); a non-zero non-8 lane exit ⇒ `LANE_FAILURE` carrying the captured SCREENED stderr line (never a stack/credential); **inventory core** — `{ files: [{ filePath, framework, taskCount }], refusals, warnings }` composed from the lane's output (no body re-parsing); **status core** — `readLastRunMarker` + `readPendingJob` + `readQueueLockRecord` + `store.size` composed into `{ lastRun, queue: { pendingJob, workerRunning }, session: { planReferencesAvailable } }`, absent marker ⇒ `lastRun: null`; an engine spy proves read-only calls NEVER reach `applySyncPlan`/`rollbackRun` (engine-gates rule 4); every successful `task_sync_plan` RECORDS the reference in the injected store (apply-gating.md §2.1) — exit-8 runs record too
- [X] T031 [P] [US1] Write integration test `tests/integration/mcp-stdio.test.ts` (quickstart Scenarios 1 + 4) through the T024 `withMcpServer` in-process line pipe + `FakeTracker` (`serveStdio` over the harness streams): full handshake (pre-init `ping` ⇒ `-32002`; version echo; `notifications/initialized` silent); `tools/list` exactly three at defaults; real `task_sync_plan`/`task_sync_inventory`/`task_sync_status` outputs (embedded report present; status reflects a seeded last-run marker + queue fixtures); malformed line ⇒ `-32700` `null`-id and the session KEEPS serving; 1 MiB+1 line dropped-and-continues; `tools/list` with `cursor` ⇒ `-32602`; unknown tool name ⇒ `isError` "unknown tool"; **SC-002**: fake-port call log has zero mutation calls AND `hashTree(repoRoot)` is byte-equal before/after; stdout stream contains protocol frames only (stderr captured separately)
- [X] T032 [P] [US1] Write e2e test `tests/e2e/mcp-user-stories.test.ts` (US1 walkthrough, 009/010 `writeDriver` child-process pattern): spawn the stdio driver child; initialize → `tools/list` → read plan/inventory/status; plan text block parses as stable-key JSON with the `report` field present; stdout is protocol-only; child exits promptly on stdin close; `tests/fixtures/mcp/**` seed corpus under the harness (placeholder identifiers only)

### Implementation for User Story 1

- [X] T033 [US1] Implement the three read cores in `src/mcp/handlers.ts` per research R4/R7: `createReadHandlers(deps)` wrapping `runCli` through a context exposing ONLY the `check`/`inventory` read-only lanes (no mutation path, frozen `createReadOnlyGuard` inherited), report retrieval via the injected `StateStore`, and the status composition (`readLastRunMarker` + queue barrel reads); every emitted string screened via the injected `SecurityScreener` at composition (research R10); cores return payloads or `ToolRefusal`s — never throw (makes T030 pass)
- [X] T034 [US1] Wire read cores + stdio transport: register the three handlers into the `tools/call` dispatch in `src/mcp/create.ts` (store record path on plan success) and implement `serveStdio(readable, writable, errorSink)` in `src/mcp/stdio.ts` (framer ↔ dispatcher; one `write` per response line; handler rejections ⇒ `-32603`, never a throw into the stream; §5 concurrency = arrival order) (makes T031/T032 pass)

**Checkpoint**: MVP — a coding agent reads plan/inventory/status end-to-end over a spawned stdio session at DEFAULT settings against the fake tracker; apply invisible; zero writes proven; malformed traffic cannot kill the host.

---

## Phase 4: User Story 2 - Apply a reviewed plan through the same gated entry point (Priority: P2)

**Goal**: `task_sync_apply` (advertised only when `mcp.enabled: true`) walks the apply-gating.md §1 ladder — enablement → argument shape → session store → stored-plan read → exactly ONE verbatim `GateRequest` into `engine.applySyncPlan` — with every refusal an `isError` tool result and zero mutations on every refusal path.

**Independent Test**: Run `node scripts/run-tests.mjs --tier unit --test-name-pattern mcp-handlers` (apply block) plus `--tier integration --test-name-pattern mcp-apply` plus the US2 e2e block (quickstart Scenario 2): the injected spy sees one `GateRequest` with exactly the frozen four fields; pre-engine refusals touch nothing (call logs empty + tree hashes equal); restart ⇒ `PLAN_REFERENCE_UNKNOWN`.

### Tests for User Story 2 (write first, must fail) ⚠️

- [X] T040 [P] [US2] Write unit tests for the apply pipeline in `tests/unit/mcp-handlers.test.ts` (extend the T030 file; contracts/apply-gating.md §1–§2, FR-003): ladder order — `enabled: false` ⇒ `MUTATING_TOOLS_DISABLED` naming the key `mcp.enabled` with ZERO calls on the state spy, port spy, and engine spy; bad arguments ⇒ `INVALID_ARGUMENTS` listing ALL issues before the store is consulted; store miss ⇒ `PLAN_REFERENCE_UNKNOWN` ("no plan reference produced in this session; run task_sync_plan") WITHOUT any state read; `state.readJson("plans/<ref>.json")` returning `null` ⇒ `PLAN_REFERENCE_UNKNOWN` with zero port calls; happy path — the injected `applySyncPlan` spy is called ONCE with `(storedPlan, { applyFlag: true, confirmationKey: <verbatim>, acceptLowConfidence: <arg ?? false>, planReference: <verbatim> })` — exactly the frozen `GateRequest` fields, nothing added; `refused` ⇒ `isError` listing EVERY `gateFailures[i].code`+`detail` verbatim (no surface-local gate codes, no echo of the presented confirmationKey); `aborted` ⇒ `isError` naming the runId + run-reports pointer; `applied` ⇒ the apply-gating.md §4 success payload; fresh store instance ⇒ unknown reference (restart rule) — never wall-clock/TTL
- [X] T041 [P] [US2] Write integration test `tests/integration/mcp-apply.test.ts` (quickstart Scenario 2, SC-001) with the REAL engine + `FakeTracker`: enabled session completes plan → apply successfully (`status: "applied"`, counts, `reportPaths`; fake port shows the engine's own sync writes); wrong `confirmationKey` ⇒ `CONFIRMATION_KEY_MISMATCH` with every gate failure listed, ZERO port mutation calls, and `hashTree` equality on state dir + repo tree; low-confidence plan without the flag ⇒ `LOW_CONFIDENCE_NOT_ACCEPTED`; drift the guards (edit the file / move HEAD) ⇒ engine `PLAN_REFERENCE_STALE`, zero mutations; rebuild the app on the same world (fresh store) ⇒ `PLAN_REFERENCE_UNKNOWN` while `plans/<ref>.json` still EXISTS (session rule strictly narrower than the engine's stored-plan rule); re-applying a still-fresh reference follows the engine's own idempotency/lock behavior untouched
- [X] T042 [US2] Implement `createApplyHandler` in `src/mcp/handlers.ts`: the §1 ladder exactly (enablement → argument shape → `store.has` → stored-plan read → ONE `GateRequest` → `engine.applySyncPlan`), result mapping refused/aborted/applied per contracts/apply-gating.md — zero gate re-evaluation, zero `validatePlanReference` import, the module's checks only ever REFUSE (makes T040 pass)
- [X] T043 [US2] Wire apply into `src/mcp/create.ts`: register `task_sync_apply` behind the visibility predicate (advertised AND callable only when `enabled`; disabled calls reach the step-1 refusal), same store instance as the plan handler; then extend `tests/e2e/mcp-user-stories.test.ts` with the US2 walkthrough (quickstart Scenario 2 at the process level: enabled child plans → applies; second fresh child refuses the same reference with a zero-write port log — SC-001) (makes T041 + the e2e block pass)

**Checkpoint**: FR-003 proven — same engine, same gates, no second enforcement point; session-scoped apply works and restarts erase references.

---

## Phase 5: User Story 3 - Transports and network are explicit opt-in with a token gate (Priority: P3)

**Goal**: Default = stdio-only, zero network at startup; `transport: "http"` serves the SAME dispatcher behind a constant-time bearer check that fires strictly before dispatch; the token lives only in the environment (FR-004/FR-005).

**Independent Test**: Run `node scripts/run-tests.mjs --tier integration --test-name-pattern mcp-http` plus `--tier contract --test-name-pattern mcp-credential-sentinel|mcp-hygiene|mcp-defaults-scan` (quickstart Scenarios 3 + 5): 401/403 fire with empty call logs; envelopes are constants; the sentinel appears in zero emitted bytes; defaults bind nothing.

### Tests for User Story 3 (write first, must fail) ⚠️

- [ ] T050 [P] [US3] Write integration test `tests/integration/mcp-http.test.ts` (transport-auth.md §2, FR-004): `listenHttp()` on `127.0.0.1:0` resolves `{ port }` and prints the bound port to STDERR exactly once (never in a protocol message); valid `Authorization: Bearer <token>` POSTs run a full session (`initialize` → `tools/list` → `tools/call task_sync_status`) byte-identical to stdio; auth matrix — missing header ⇒ 401 + `WWW-Authenticate: Bearer`, wrong token ⇒ 403, BOTH with empty fake-port/state call logs (auth strictly before dispatch) and constant bodies `{"error":"UNAUTHORIZED"|"FORBIDDEN"}`; non-POST `/mcp` ⇒ 405; any other path ⇒ 404; body > 1 MiB ⇒ 413 `PAYLOAD_TOO_LARGE`; envelope set closed `{401, 403, 404, 405, 413, 500}`; one message per request; `transport: "stdio"` ⇒ `listenHttp()` throws `McpConfigError`; `transport: "http"` with token env unset/EMPTY ⇒ construction throws naming the env-var NAME only; `close()` stops the listener; settings `host` override honored
- [ ] T051 [P] [US3] Write security contract test `tests/contract/mcp-credential-sentinel.test.ts` (FR-005, SC sweep; precedent `tracker-credential-sentinel.test.ts`): sentinel planted as the token env value AND as hostile fixture text; sweep the full matrix (stdio + http × enabled/disabled × pre/post-init × 401/403/404/405/413/500 × success/refusal) — ZERO emitted bytes (protocol frames, HTTP bodies, stderr lines) contain the sentinel; the presented `confirmationKey` never echoed; blocked findings ship only `[blocked:<category>]` sentinels (transport-auth.md §3)
- [ ] T052 [P] [US3] Write contract test `tests/contract/mcp-hygiene.test.ts` (component-api.md §3): source scan of `src/mcp/**` — ZERO `node:fs`/`node:fs/promises` (the store is in-memory: the group touches NO filesystem — FR-003's structural guarantee); import allowlist = relative `../{config,domain,gates,ports,state,engine,tracker,cli,queue}` barrels + `{node:process,node:http,node:crypto}`, NO `task-linear-sync/*` specifiers, no `tracker/internal|http`/`tracker/testing` reach-ins, no `../history-server` or sibling-surface imports; `node:crypto` used ONLY as `timingSafeEqual` (+ optional `createHash`); `node:http` inbound-only (no `node:https|http2|net|tls|dns|dgram`, no `fetch(`, no `WebSocket`); `process.env` in exactly ONE file (composition root default); no `validatePlanReference` import anywhere (apply-gating §3.2); zero credential-shaped literals / non-placeholder UUIDs in source + `tests/fixtures/mcp/**`
- [ ] T053 [P] [US3] Write contract test `tests/contract/mcp-defaults-scan.test.ts` (defaults-scan extension, Principle III/FR-004): the BUILT-IN `mcp` defaults are inert by inspection — `enabled: false`, `transport: "stdio"`, `host` loopback, `port: 0`, `tokenEnvVarName` env-var-name pattern with no value; a defaults-only `createAgentToolServer` binds NO socket (construction performs zero network — asserted from the absence of any listener/handle) and `listenHttp()` refuses; defaults + `tests/fixtures/mcp/**` contain zero org identifiers/team keys/tokens/UUID-shaped secrets
- [ ] T054 [US3] Implement `src/mcp/auth.ts` (env-seam token read, `timingSafeEqual` length-guarded compare, the fixed envelope constants `{401,403,404,405,413,500}` — compile-time, zero credential material, zero echo) + `src/mcp/http.ts` (`node:http` listener on settings `host`/`port`, `POST /mcp` one-message-per-request with the 1 MiB body cap, auth gate strictly BEFORE any dispatcher touch, stderr port announcement, `close()`) (makes T050 pass)
- [ ] T055 [US3] Finalize `src/mcp/create.ts` + `src/mcp/index.ts`: `listenHttp()` available ONLY when `settings.transport === "http"` (otherwise `McpConfigError`), construction token preflight for http (NAME-only refusal), and the complete §2 public surface (all exported names) — then extend `tests/e2e/mcp-user-stories.test.ts` with the US3 walkthrough: default-settings child serves the read flow with zero sockets; token-configured http child completes the SAME story via `fetch`, unauthenticated probes refused with no world activity (quickstart Scenario 3) (makes T051/T053 pass)

**Checkpoint**: All three stories functional; default posture provably stdio-only and mutating-off; the network is opt-in, token-gated, leak-free.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation duty, quickstart verification, full-suite gate

- [ ] T060 Write `docs/agent-tools.md` (documentation duty, placeholder identifiers only): usage scenario for `createAgentToolServer` (the consumer supplies config/state/port — the packaging story), the four-tool table with the visibility rule, the settings reference (all five keys + defaults table, verbatim from data-model §3), the transport story (stdio default, http opt-in + token env-var setup + stderr port line), the session semantics (plan references die with the process; run `task_sync_plan` first), the apply posture ("same gates as CLI/queue — refusals are tool results"), and the stdio framing rules for host implementers
- [ ] T061 Update `README.md`: Wave-4 status line for 012, the `./mcp` entry in the surface/export table, and a docs link to `docs/agent-tools.md`
- [ ] T062 Run every quickstart.md scenario against the built `dist/` (Scenarios 1–5, including the contract-scan table); fix any drift artifact-first, then code
- [ ] T063 Run `npm test` (full suite, all tiers) GREEN including the coverage gate (lines 80 / branches 70 / functions 80) with `tracker-dependency-budget` still asserting SPENT 0; fix any 012-at-fault regressions; mark completed tasks `[X]` in this file
- [ ] T064 Close coverage gaps in `src/mcp/**` with additional focused unit tests under `tests/unit/` (only if T063 reports shortfalls) and sweep every 012 artifact for `NEEDS CLARIFICATION` (must be zero)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all user stories (protocol + framing + config + store + registry + composition skeleton feed every story)
- **User Stories (Phases 3–5)**: All depend on Foundational. US1 is standalone (MVP). US2 extends US1's `handlers.ts`/`create.ts` (same files — land after T033/T034). US3 touches `auth.ts`/`http.ts` + finalizes `create.ts`/`index.ts` (its tests are story-independent; `create.ts` finalization serializes against T043)
- **Polish (Phase 6)**: Depends on the stories being delivered

### User Story Dependencies

- **US1 (P1)**: Independent after Foundational — the read story ends at T034
- **US2 (P2)**: Requires T033/T034 (same-file extension); its tests (T040/T041) can be authored the moment Foundational lands since the apply-gating.md ladder is frozen
- **US3 (P3)**: Tests (T050–T053) parallel with US1/US2 work; T054 is independent (`auth.ts`/`http.ts` are new files); T055 finalizes after T043 (both edit `create.ts`)

### Within Each User Story

- Tests MUST be written and FAIL before their implementation tasks (constitution VI)
- US1: read cores → stdio + wiring; US2: apply core → wiring + e2e; US3: auth/http → composition finalization → e2e

### Parallel Opportunities

- T010 ∥ T011 ∥ T012 ∥ T013 ∥ T014 ∥ T015 ∥ T016 (all Foundational tests, disjoint files); T017–T022 implementations are disjoint files
- T024 (harness) parallel with any Foundational implementation task
- All US1 tests (T030–T032) parallel; T040/T041 (US2 tests) parallel with US1 implementation; T050–T053 (US3 tests) parallel with everything after Foundational
- T054 parallel with US2 work (disjoint files); T060 ∥ T061 during Polish

---

## Parallel Example: Foundational Tests

```bash
# Launch all Foundational tests together (they must fail first):
Task: "JSON-RPC layer unit tests in tests/unit/mcp-jsonrpc.test.ts"
Task: "Line-framer unit tests in tests/unit/mcp-framing.test.ts"
Task: "Config-group unit tests in tests/unit/mcp-config.test.ts"
Task: "Plan-store unit tests in tests/unit/mcp-plan-store.test.ts"
Task: "Tool-registry unit tests in tests/unit/mcp-tools.test.ts"
Task: "Tool-schema contract test in tests/contract/mcp-tool-schema.test.ts"
Task: "Packaging contract test in tests/contract/mcp-packaging.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (three read-only tools over stdio at default settings)
4. **STOP and VALIDATE**: quickstart Scenarios 1 + 4 (FR-001/FR-002/FR-005, SC-002/SC-003 green at the process level)
5. Ship-able as a read-only agent integration — the spec marks US1 standalone-valuable

### Incremental Delivery

1. Setup + Foundational → protocol/framing/config/store/registry proven
2. US1 → read-only stdio story end-to-end → MVP
3. US2 → gated in-session apply through the frozen engine entry (FR-003, SC-001)
4. US3 → stdio-only default proof + token-gated network opt-in (FR-004, sentinel sweep)
5. Polish → docs duty + full-suite green → 013 (release surface) can build on `task-linear-sync/mcp`

---

## Notes

- [P] tasks = different files, no dependencies
- Verify tests fail before implementing (constitution VI)
- Commit after each task or logical group; `specs/012-ai-agent-tool-interface: ...` / `feat(012): ...` / `test(012): ...` / `docs(012): ...` message style
- NEVER edit frozen 002 / Wave-2/3 / sibling Wave-4 modules or `tracker-dependency-budget.test.ts`; never add a runtime dependency; `src/mcp` imports no `node:fs` — the session store is memory-only by construction
- Two channels, never mixed: JSON-RPC protocol errors are envelope faults; every tool-level refusal is an `isError: true` tool RESULT (jsonrpc-stdio.md §4)
- Defaults SERVE read-only over stdio — they do not refuse construction; "inert" means zero network and zero mutating capability, not a dead server
- Stop at any checkpoint to validate a story independently
