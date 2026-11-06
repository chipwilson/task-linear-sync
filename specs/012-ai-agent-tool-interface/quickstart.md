# Quickstart: 012 — AI-agent tool interface

**Date**: 2026-11-06 | **Journey**: from the published `task-linear-sync/mcp`
subpath to a coding agent driving the sync product through three read-only
tools over stdio, an opt-in gated apply, and a token-guarded network
transport — with the frozen engine as the only mutating path.

Every check below runs against the built `dist/` exactly as a consumer sees
it: spawned `node` children, the `FakeTracker` port, `fixedClock`, and local
HTTP. Verification mirrors the test tiers
(unit → contract → integration → e2e, contracts/README.md enforcement map).

## Prerequisites

```bash
npm run build    # dist/, including dist/mcp/index.js + dist/mcp/index.d.ts
```

- `createAgentToolServer(deps)` with the fake world: `buildCliWorld`-derived
  `config`, injected `state` (`InMemoryStateStore`), fake `port`, injected
  `clock`/`env` — everything injectable per contracts/component-api.md §1.
- `tests/helpers/mcp-harness.ts` builds worlds, settings files (the `mcp`
  config group only), plan artifacts, and spawned stdio drivers
  (`writeMcpDriver`, the 009 `writeDriver` pattern).
- A `FakeTracker` for engine-backed checks and applies; a `fixedClock`.
- For the network scenarios: a token in the env var named by
  `mcp.tokenEnvVarName` and `fetch` against `http://127.0.0.1:<announced>/mcp`.

## Scenario 1 — stdio session, read-only tools at DEFAULT settings (US1, FR-001)

Defaults are **not** an inert-configuration refusal: the server constructs and
serves the three read-only tools over stdio — with NO network, NO mutating
tool, and NO token (FR-002/FR-004 by default).

```js
// driver.mjs (stdio child): constructs createAgentToolServer({ config, state, port, clock, env })
const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

send({ jsonrpc: "2.0", id: 0, method: "ping" });                    // BEFORE initialize
send({ jsonrpc: "2.0", id: 1, method: "initialize",
       params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });       // silent
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "task_sync_plan", arguments: {} } });
```

**Expected**

- `ping` before the handshake: error `-32002` (server not initialized).
- `initialize` echoes `2025-03-26` (supported set `{2024-11-05, 2025-03-26}`);
  result `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "<toolId>-mcp", version } }`.
- `notifications/initialized` gets NO response (jsonrpc-stdio.md §2.2).
- `tools/list` returns **exactly** `task_sync_plan`, `task_sync_status`,
  `task_sync_inventory` — each `{ name, description, inputSchema }` with
  `additionalProperties: false` and no `outputSchema` claims — and **no**
  `task_sync_apply` (FR-002, SC-003).
- `tools/call task_sync_plan` → `isError: false`, one `text` JSON block:
  `{ schemaVersion: 1, planReference, generatedAt, lowConfidencePresent,
  counts, securityAssertions, report }` where `report` is the frozen
  `PlanReportJson` **verbatim** (hash-based, screened, never re-rendered;
  research R4). Check exit 0 AND exit 8 (`CHECK_FINDINGS`) both succeed.
- `task_sync_inventory` → `{ files: [{ filePath, framework, taskCount }],
  refusals, warnings }`; `task_sync_status` → `{ lastRun,
  queue: { pendingJob, workerRunning }, session: { planReferencesAvailable } }`.
- **SC-002**: the fake-port call log contains zero mutation calls and the repo
  working-tree hash (`hashTree`) is unchanged after the whole session.
- stdout carries protocol bytes only — diagnostics go to stderr (§1.2).

## Scenario 2 — enable mutating tools, plan → apply through the frozen engine (US2, FR-003)

`mcp.enabled: true` (settings override — mutating-tool enablement, research
R8) flips `tools/list` to ALSO advertise `task_sync_apply` (visibility is a
pure function of settings, tool-definitions.md §1). The refusal ladder is
apply-gating.md §1, in order:

```text
1. enabled:false           ⇒ isError "MUTATING_TOOLS_DISABLED"        [zero engine/port/state touch]
2. bad arguments           ⇒ isError "INVALID_ARGUMENTS" (ALL issues) [non-64-hex planReference, missing confirmationKey, unknown keys]
3. store.has === false     ⇒ isError "PLAN_REFERENCE_UNKNOWN"         [zero engine/port/state touch — "run task_sync_plan"]
4. plans/<ref>.json absent ⇒ isError "PLAN_REFERENCE_UNKNOWN"         [zero port calls]
5. engine.applySyncPlan(stored.plan, { applyFlag: true, confirmationKey, acceptLowConfidence ?? false, planReference })
```

**Expected**

- ONE `GateRequest` object reaches the engine — exactly the frozen
  `src/gates/gates.ts` shape, verbatim values, no additions (FR-001/FR-005
  posture of the 010 `apply-runner`; asserted with an injected spy).
- Wrong `confirmationKey` → `refused` with EVERY `gateFailures[i].code` +
  detail (`CONFIRMATION_KEY_MISMATCH`, …) as `isError` tool results — never
  JSON-RPC protocol errors; the presented key is never echoed
  (transport-auth.md §3.2).
- Low-confidence plan without `acceptLowConfidence` →
  `LOW_CONFIDENCE_NOT_ACCEPTED` passthrough verbatim.
- Drift between plan and apply (edit the file / move HEAD) → engine
  `PLAN_REFERENCE_STALE`, ZERO mutations (engine pre-lock design — asserted,
  never re-implemented).
- Success → `{ schemaVersion: 1, runId, status: "applied", counts:
  { applied, skipped, failed }, reportPaths }` (apply-gating.md §4).
- **Restart rule (spec edge case)**: a brand-new `createAgentToolServer` (fresh
  in-memory store) asked to apply the same `planReference` → step-3
  `PLAN_REFERENCE_UNKNOWN` even though `plans/<ref>.json` still exists — the
  engine is never reached.
- **SC-001**: across every refusal path, fake-port mutation-call assertions
  AND state-dir/repo-tree before/after equality hold: 0 mutations, 0 writes.

## Scenario 3 — transports: default is stdio-only; http is token-gated opt-in (US3, FR-004)

```bash
# (a) defaults: construction succeeds over stdio and performs ZERO network;
#     calling listenHttp() on a stdio-transport server throws McpConfigError.
# (b) transport:"http" with the token env var unset/empty ⇒ createAgentToolServer
#     throws McpConfigError naming the env-var NAME only — never a value.
# (c) token set, port 0 ⇒ listenHttp() resolves { port }; one line on STDERR
#     announces the bound port (never in a protocol message).
fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: msg })                        # no header  → 401 + WWW-Authenticate: Bearer
fetch(url, { headers: { authorization: "Bearer wrong" }, method: "POST", body: msg })       # wrong      → 403
fetch(url, { headers: { authorization: `Bearer ${token}` }, method: "POST", body: msg })    # valid      → the JSON-RPC response
fetch(url, { method: "GET" })                                                               #            → 405
fetch(new URL("/other", url), { method: "POST", body: msg })                                #            → 404
# body > 1 MiB → 413 PAYLOAD_TOO_LARGE; every refusal body is the constant {"error":"<CODE>"}
```

**Expected**

- Auth fires **strictly before dispatch**: on 401/403 the fake-port/state call
  logs are EMPTY (asserted, not assumed) — no handler, engine, or state-dir
  access happened (FR-004; transport-auth.md §2.2).
- Transport never weakens gating: `tools/list` and the apply pipeline produce
  byte-identical results over http as over stdio (§ intro).
- Token values, tracker credentials, and the presented `confirmationKey`
  appear in NO response, NO error message, NO stderr line (FR-005;
  credential-sentinel sweep across 401/403/404/405/413/500 × pre/post-init ×
  enabled/disabled — SC and sentinel contract test).

## Scenario 4 — protocol hygiene and refusal mapping (FR-005, host stability)

```text
"not-json\n"                      → {"code":-32700} error, id null; session CONTINUES
a 1 MiB+1 line                    → {"code":-32700} ... and dropped; never partially parsed; continues
{ method: "tools/x" }             → {"code":-32601} (message names the method token only)
{ method: "tools/list", params: { cursor: "1" } } → {"code":-32602}
second initialize on one session  → {"code":-32602}
tools/call { name: "bogus" }      → isError:true result "unknown tool" (NOT -32601)
notifications/* (any)             → silence, including on parse failure
stream end mid-line               → partial tail decoded once, session ends (store dies)
```

**Expected**: the two channels never mix — JSON-RPC *protocol* errors are for
envelope faults; every tool-level refusal (disabled, invalid arguments,
unknown reference, gate refusal) is an `isError: true` tool RESULT
(jsonrpc-stdio.md §4; tool-definitions.md §2). The host process never
crashes on malformed traffic.

## Scenario 5 — contract scans (SC-001…SC-003)

| Check | Command (as tests) | Expected |
|---|---|---|
| Frozen tool surface | `npm test -- mcp-tool-schema` | exactly 4 definitions; three advertised at defaults, `task_sync_apply` advertised ONLY when `enabled`; schemas byte-equal to the contract tables |
| Dependency budget holds | `npm test -- tracker-dependency-budget` | runtime deps stay 0 (research R1, `SPENT 0`) |
| Module hygiene | `npm test -- mcp-hygiene` | zero `node:fs` anywhere in `src/mcp`; no `validatePlanReference`/`src/gates` logic imports; crypto only `timingSafeEqual`/`createHash`; no outbound sockets; `process.env` in exactly ONE file (component-api.md §3) |
| Defaults scan | `npm test -- mcp-defaults-scan` | built-in `mcp` defaults inert (`enabled:false`, `transport:"stdio"`, loopback, `port:0`); zero org ids/credential literals in defaults + fixtures |
| Credential sentinel | `npm test -- mcp-credential-sentinel` | sentinel token env value + hostile fixture text appear in ZERO response bytes across the full matrix |
| Packaging duty | `npm test -- mcp-packaging` | `task-linear-sync/mcp` resolves, `.d.ts` present, exported names per component-api.md §2, no new `bin` |

## FR / SC → test traceability

| Requirement | Verifying checks |
|---|---|
| FR-001 (read-only tools mirror existing capabilities) | Scenario 1; `tests/unit/mcp-handlers.test.ts`; `tests/integration/mcp-stdio.test.ts`; engine-spy: read tools never reach `applySyncPlan`/`rollbackRun` (research R7) |
| FR-002 (mutating tool unregistered/unadvertised unless enabled) | Scenario 1 (`tools/list` = 3); `tests/unit/mcp-tools.test.ts` + `tests/contract/mcp-tool-schema.test.ts`; `MUTATING_TOOLS_DISABLED` refusal (Scenario 2 step 1) |
| FR-003 (apply requires exact confirmation + session plan reference) | Scenario 2 ladder steps 1–5; `tests/unit/mcp-handlers.test.ts` (spy: one verbatim `GateRequest`); `tests/integration/mcp-apply.test.ts` |
| FR-004 (stdio default; network opt-in with server-side token, valid token before any tool call) | Scenario 3a–3c; `tests/integration/mcp-http.test.ts`; `tests/contract/mcp-defaults-scan.test.ts` |
| FR-005 (outputs consistent with existing machine posture; no secrets) | Scenario 1 (`report` verbatim); Scenario 3 sentinel sweep; `tests/contract/mcp-credential-sentinel.test.ts`; jsonrpc-stdio.md §4 constant messages |
| SC-001 (0 mutations on every refusal path) | Scenario 2 harness rule; `tests/integration/mcp-apply.test.ts` (call log + tree-hash equality) |
| SC-002 (read-only exercises: 0 tracker mutations, 0 repo writes) | Scenario 1 SC-002 assertion; `tests/integration/mcp-stdio.test.ts` |
| SC-003 (disabled ⇒ 100% listings omit apply) | `tests/contract/mcp-tool-schema.test.ts`; Scenario 5 frozen-surface scan |

## Cleanup

```bash
rm -rf "$(cliWorldDir)"/mcp-*   # temp worlds; tokens were env-only, stores in-memory
```

## Verification note

Running these flows end-to-end is itself the design review: if Scenario 2
needs anything beyond `tools/list` → `tools/call`, or if any byte of Scenario
3 prints a token value, or if a refusal ever arrives as a JSON-RPC protocol
error, the artifacts have drifted from the spec — fix the artifacts before
code (Phase Dependence).
