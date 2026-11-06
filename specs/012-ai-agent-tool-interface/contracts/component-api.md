# Contract: Component API — `createAgentToolServer(deps)`

Module: `src/mcp/create.ts` + `src/mcp/index.ts` (the `task-linear-sync/mcp` subpath).
Composition-root posture mirrors `createSyncHistoryServer` (011): validate everything at
construction, fail fast, never silent.

## 1. Dependencies (everything injectable — hermetic, Principle VI)

```ts
export interface AgentToolServerDeps {
  readonly config: ResolvedConfig;                    // frozen deep-merge result
  readonly env?: Readonly<Record<string, string | undefined>>; // default process.env (ONE read site)
  readonly clock?: Clock;                             // default systemClock (injected in tests)
  readonly state?: StateStore;                        // default createStateStore({ repositoryRoot: config-derived, ... })
  readonly port?: LinearPort;                         // default createLinearPort({ config, options: { env } })
  readonly screener?: SecurityScreener;               // default createDefaultSecurityScreener(config)
  readonly repositoryRoot?: string;                   // canonical repo root the tools operate on (default process.cwd())
  readonly settings?: Partial<McpSettings>;           // programmatic overrides (top precedence layer)
}
```

Construction order: `resolveMcpConfig(config)` ∪ `settings` overrides → validate (ALL
problems, one line) → transport preflight (http: token env var present, naming NAMES) →
compose the frozen factory bag exactly like `src/cli/context.ts`
(`createLinearPort` + `createDefaultSecurityScreener` + `createSyncEngine` +
`envVarKeyProvider`) → build dispatcher + ONE session store. Throws `McpConfigError` on
invalid group/token setup.

## 2. Public surface (`index.ts`)

| Export | Kind | Purpose |
|---|---|---|
| `createAgentToolServer(deps)` | fn | returns `AgentToolServerApp` |
| `AgentToolServerApp` | type | `{ handleMessage(msg): Promise<JsonRpcResponse|null>; serveStdio(overrides?): { close() }; listenHttp(): Promise<{ port, close() }>; settings; store }` |
| `resolveMcpConfig`, `McpSettings`, `McpConfigResult`, `McpConfigError` | fn/types | config group (data-model §3) |
| `PlanReferenceStore` | type | session store surface (data-model §5) |
| tool definition constants + `TOOL_NAMES` | data | registry introspection for hosts/tests |

`handleMessage(raw: unknown)` is the transport-agnostic dispatcher (unit-test entry —
accepts an already-parsed message; returns `null` for notifications). `serveStdio` wires
framer + streams (jsonrpc-stdio.md §5); `listenHttp` is available ONLY when
`settings.transport === "http"` (stdio default ⇒ calling it throws `McpConfigError` —
transport is a decision, not a juggling act).

## 3. Hygiene invariants (contract-tier source scan, `tests/contract/mcp-hygiene.test.ts`)

Inside `src/mcp/**`:

1. ZERO `node:fs` / `node:fs/promises` imports — the module cannot read or write ANY file
   directly; all state access goes through the injected `StateStore` (the plan-reference
   store is in-memory, so the group touches NO filesystem at all — stricter than "only the
   store may", which the brief allows).
2. Import allowlist: Node built-ins `{node:process, node:http, node:crypto}` + relative
   `../{config,domain,gates,ports,state,engine,tracker,cli,queue}` barrels; NO
   `task-linear-sync/*` package specifiers; no `tracker/internal|http` or `tracker/testing`
   reach-ins; no `../history-server` or sibling-surface imports.
3. `process.env` appears in exactly ONE file (the composition root default, research R11).
4. `node:crypto` usage limited to `timingSafeEqual` (+ optional `createHash` for stable
   payload digests); no outbound sockets: `node:https|http2|net|tls|dns|dgram`, `fetch(`,
   `WebSocket`, `XMLHttpRequest` banned (the one `node:http` use is the INBOUND listener).
5. Zero credential-shaped literals, zero non-placeholder UUIDs/org ids in source and
   `tests/fixtures/mcp/**` (defaults-scan extension, Principle III).

## 4. Packaging (additive only)

`package.json` gains exactly one entry:

```jsonc
"./mcp": { "types": "./dist/mcp/index.d.ts", "default": "./dist/mcp/index.js" }
```

Zero dependency changes (`tests/contract/tracker-dependency-budget.test.ts` must still pass
with `SPENT = 0` — research R1); no new `bin`; `tests/contract/mcp-packaging.test.ts`
asserts resolution, generated `.d.ts`, and the exported names of §2.
