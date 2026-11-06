# Phase 1 Data Model: AI-Agent Tool Interface

**Feature**: `012-ai-agent-tool-interface` | Entities owned by `src/mcp/` only. Consumed
shapes (frozen, never restated or mutated): `Plan`/`StoredPlan`/`PlanGuards`
(`src/domain/plan.ts`), `GateRequest`/`GateFailure`/`GateFailureCode` (`src/gates`),
`ApplyResult` (`src/ports/engine.ts`), `LastRunMarker` (`src/domain/run-records.ts`),
`PendingJob`/`QueueLockRecord` (`src/queue/types.ts` via `task-linear-sync/queue`),
`PlanReportJson`/`CheckSummary` (frozen plan-report schema / 009 `check`),
`ResolvedConfig`, `StateStore`, `SecurityScreener`, `Clock`.

## 1. JSON-RPC 2.0 message layer (`jsonrpc.ts`)

Discriminated union `JsonRpcMessage`, parsed from ONE line (research R2):

| Entity | Fields (wire) | Validation rules |
|---|---|---|
| `Request` | `jsonrpc: "2.0"`, `id: string \| number`, `method: string`, `params?` | `id` required; `method` non-empty string; `params` object or array when present |
| `Notification` | `jsonrpc: "2.0"`, `method`, `params?` | NO `id` (an `id` on `notifications/*` is invalid → `-32600`) |
| `Response` (out) | `jsonrpc: "2.0"`, `id`, `result` XOR `error` | exactly one of result/error |
| `Error` | `code: number`, `message: string`, `data?` | `message` is a compile-time constant or screened text (never presented input) |

Closed server-emitted error codes: `-32700` parse error, `-32600` invalid request,
`-32601` method not found, `-32602` invalid params (reserved for structural shape faults —
business refusals are tool results, research R2), `-32603` internal error (fixed text),
`-32002` server not initialized. No other codes are ever emitted.

**State transition (per connection)**: `uninitialized ──initialize──▶ initializing
─notifications/initialized─▶ ready`. While `uninitialized`, every request except
`initialize` answers `-32002`; notifications are dropped. A second `initialize` on the same
connection answers `-32602` (single handshake). `shutdown` is not implemented (the host
closes the transport — stdio EOF / HTTP socket close ends the session).

## 2. Line framer (`framing.ts`)

Pure incremental decoder: `feed(chunk: Buffer|string): string[]` yielding complete lines;
retains at most one partial tail. Rules: split on `\n`; a trailing `\r` before `\n` is
stripped (CRLF hosts); blank lines ignored; a complete line longer than **1 MiB**
(`MAX_LINE_BYTES`, module constant) yields the sentinel `{ oversize: true }` (caller
answers `-32700`, drops the line, connection continues — never a silent truncation); on
stream end a non-empty partial tail is decoded as a final line. No state beyond the tail
buffer; zero timers, zero fs.

## 3. Resolved settings (`config.ts`) — the additive `mcp` group

| Key | Default (built-in, then config file, then programmatic overrides — deep-merge 002 model) | Validation |
|---|---|---|
| `enabled` | `false` | boolean. Mutating-tool enablement ONLY (research R8); engine gates stay mandatory |
| `transport` | `"stdio"` | `"stdio"` \| `"http"` |
| `host` | `"127.0.0.1"` | non-empty string (bind host; http only) |
| `port` | `0` | integer 0..65535; `0` = ephemeral, emitted once to stderr at listen |
| `tokenEnvVarName` | ``${envVarPrefixFor(toolId)}_MCP_TOKEN`` | non-empty string; NAMES only, values live in env (never in config, outputs, or errors) |

Validation posture (`resolveMcpConfig(config): McpConfigResult`, the
`src/queue/config.ts` precedent): pure read of `ResolvedConfig` (never mutated); unknown
keys and out-of-range values collect ALL problems into exactly ONE dotted-key line
(complete listing, never fail-fast); on failure `settings` carries the pure defaults and
`ok: false` (callers MUST check). Distributed defaults contain zero org identifiers/team
keys/tokens/UUIDs (defaults-scan).

## 4. Tool registry (`tools.ts`)

| Entity | Fields | Rules |
|---|---|---|
| `ToolDefinition` | `name`, `description`, `inputSchema` (JSON-Schema object, `additionalProperties: false`), `mutating: boolean` | definitions are static data; `description`/titles carry placeholder identifiers only |
| `Visibility` | `visibleFor(settings): boolean` = `!def.mutating \|\| settings.enabled` | the SAME predicate drives `tools/list` rendering AND `tools/call` dispatch — list can never advertise what call refuses (SC-003) |
| `ToolCallResult` | `content: [{ type: "text", text: string }]`, `isError?: true` | failures are tool results, never JSON-RPC protocol errors (research R2); every `text` screened (research R10) |

Tool set (contracts/tool-definitions.md): `task_sync_plan`, `task_sync_status`,
`task_sync_inventory` (always visible, `mutating: false`), `task_sync_apply`
(`mutating: true` — invisible + refused unless `enabled`).

## 5. Plan-reference store (`plan-store.ts`)

| Entity | Fields | Rules |
|---|---|---|
| `PlanReferenceRecord` | `planId` (frozen `^[0-9a-f]{64}$`), `recordedAt` (ISO-8601, injected `Clock`) | keys ARE the references; no plan bodies stored |
| `PlanReferenceStore` | in-memory `Map<planId, PlanReferenceRecord>`; methods `record(planId)`, `has(planId)`, `size` | process-lifetime; **restart ⇒ empty ⇒ every presented reference is unknown** (spec edge case); zero persistence, zero fs, zero TTL (freshness is the engine's guard job, research R5) |

**Transitions**: `unknown ──task_sync_plan success──▶ recorded` (only path in);
`recorded ──process exit──▶ gone`. A `recorded` reference can still be refused downstream
(`PLAN_REFERENCE_UNKNOWN` when no stored plan resolves, `PLAN_REFERENCE_STALE` on guard
drift — engine codes, contracts/apply-gating.md §3).

## 6. Tool payloads (input `arguments` → typed input; validated before dispatch)

| Tool | Input | Output payload (single JSON text block) |
|---|---|---|
| `task_sync_plan` | `{}` | `{ schemaVersion: 1, planReference, generatedAt, lowConfidencePresent, counts: { entries, unmapped, unresolvedConflicts, lowConfidence }, securityAssertions, report }` — `report` is the frozen `PlanReportJson` verbatim (hash-based, screened; research R4) |
| `task_sync_inventory` | `{}` | `{ schemaVersion: 1, files: [{ filePath, framework, taskCount }], refusals: [...], warnings: [...] }` — composed from the captured `inventory` lane output lines (no re-parsing of bodies; paths + counts only) |
| `task_sync_status` | `{}` | `{ schemaVersion: 1, lastRun: LastRunMarker \| null, queue: { pendingJob: { frameworkId?, mode, trigger, queuedAt } \| null, workerRunning: boolean }, session: { planReferencesAvailable } }` (research R7; no mutation fields — engine-gates rule 4) |
| `task_sync_apply` | `{ planReference: 64-hex, confirmationKey: non-empty string, acceptLowConfidence?: boolean = false }` | success: `{ schemaVersion: 1, runId, status: "applied", counts: { applied, skipped, failed }, reportPaths \| null }`; refusal: `isError` text listing every `{ code, detail }` gate failure (verbatim engine vocabulary) |

Shape rule: outputs are stable-key JSON (`schemaVersion` first) so agent hosts can parse
deterministically; no raw body/description field can exist anywhere in them.

## 7. Error taxonomy (`errors.ts`)

| Entity | Kind | Rendering |
|---|---|---|
| `ToolRefusal` | `{ code: GateFailureCode \| SurfaceCode, detail }` | JSON text block, `isError: true`, complete listing |
| `SurfaceCode` | `"MUTATING_TOOLS_DISABLED"`, `"INVALID_ARGUMENTS"`, `"LANE_FAILURE"` | module-owned codes (registration/argument policy only — no gate codes are re-implemented; frozen gate codes come verbatim from the engine) |
| Transport envelope (`auth.ts`) | fixed `UNAUTHORIZED` (401 + `WWW-Authenticate: Bearer`) / `FORBIDDEN` (403) / `NOT_FOUND` (404) / `METHOD_NOT_ALLOWED` (405) constants | compile-time constants, zero credential material, zero echo (contracts/transport-auth.md) |

`LANE_FAILURE` carries the captured screened stderr line from a non-zero `runCli` outcome
(research R4) — never a stack, never a credential.

## 8. Relationships

- `createAgentToolServer(deps)` (create.ts) owns exactly one `PlanReferenceStore`,
  one dispatch state (§1), and one resolved `McpSettings` (§3).
- `tools.ts` (registry/dispatch) → `handlers.ts` (four tool cores) → reused cores:
  `runCli` (009) for plan/inventory, frozen state/queue reads for status, and the single
  `engine.applySyncPlan` pass for apply (§6).
- Transports (`stdio.ts`, `http.ts`) are thin byte-boundary adapters into the SAME
  dispatcher; `http.ts` additionally owns the §7 transport envelopes behind its auth gate
  (contracts/transport-auth.md §2). One server instance serves ONE transport (settings pick
  it; the dispatcher is transport-agnostic and unit-tested without any stream).
