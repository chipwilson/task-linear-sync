# Agent tool surface (feature 012)

An **AI-agent tool server** exposes the sync core over an MCP-compatible
JSON-RPC 2.0 surface: four tools that let a coding agent dry-run the sync
lane over its repository (`task_sync_plan`), read the run-state snapshot
(`task_sync_status`), list discoverable task files (`task_sync_inventory`),
and — only when the operator turns the lane on — apply a plan through the
gated engine (`task_sync_apply`). The transport is MCP-compatible framing
over **stdio** (the default) or **HTTP**, so any MCP-style client can
drive it. This guide covers embedding `createAgentToolServer` in your own
process or tooling, the settings that shape it, the transport and token
setup, and what happens when things go wrong.

This feature's wire surface is pinned by feature 012's specs and the
frozen surface snapshot — see `## Stability` at the end of this document.

> **Security note:** `task_sync_apply` runs the real engine — the same
> gated `applySyncPlan` entry the CLI and queue use. The apply tool is
> **disabled by default**, and a disabled apply is refused before the
> engine is touched at all, so a session with the default settings can
> never mutate state. Turn it on only where the agent is trusted to
> change repository and tracker state.

## Usage

```ts
import { createAgentToolServer } from "task-linear-sync/mcp";
import { loadConfig } from "task-linear-sync/config";
import { createLinearPort } from "task-linear-sync/tracker";

const config = loadConfig(); // layered config; the `mcp` group feeds the settings

const server = createAgentToolServer({
  config,                                 // frozen merged config (required)
  port: createLinearPort(config),         // the ONLY route to the tracker
  repositoryRoot: "/srv/repos/acme",      // the tree the tools operate on
  settings: { transport: "stdio" },       // programmatic overrides (top layer)
});

// stdio: speak JSON-RPC on stdin/stdout (stderr stays log-only)
await server.serveStdio();
// — or bind a loopback HTTP listener instead (see “HTTP transport”)
const listener = await server.listenHttp();
```

The factory **fails fast** — it throws `McpConfigError` before anything
listens — when settings are invalid or, on the `http` transport, when the
bearer token's environment variable is missing or empty. Dependencies
follow the same injectable shape as the other surfaces: `port` is any
`LinearPort` (defaulting to the real adapter, with zero calls until a
tool uses it), `state` the durable state store, `clock` the injected
clock, `screener` the hygiene screener — all injectable for tests, and
none of them constructs credentials of its own; `loadConfig()` and the
caller own that. Omitting `repositoryRoot` defaults it to the process
CWD — pass it explicitly in production.

## Tools

| Tool | What it does | Mutates anything? |
| --- | --- | --- |
| `task_sync_plan` | Runs the read-only plan/check lane over the configured repository and returns the sanitized, hash-based plan report as stable-key JSON; records a **plan reference** usable by `task_sync_apply` for the rest of the session | No — pure dry-run |
| `task_sync_status` | Frozen run-state snapshot: the last-run marker, the pending queue job, the worker/queue lock, and how many plan references this session may still apply | No — zero tracker calls, zero writes |
| `task_sync_inventory` | Discoverable task files with the matched framework adapter id and task counts, plus parse refusals and warnings — paths and counts only, never file contents | No |
| `task_sync_apply` | Applies a session plan reference through the same gated engine entry the CLI and queue use (requires `planReference` + exact `confirmationKey`; low-confidence plans additionally `acceptLowConfidence`) | **Yes** — only when enabled |

**Visibility rule:** with the default settings the disabled
`task_sync_apply` is invisible — it does not appear in `tools/list`, not
even as a disabled entry — and a call to it is refused at dispatch
**before** any engine or port code runs: `isError: true` with the
constant `MUTATING_TOOLS_DISABLED` refusal
("mutating tools are disabled for this surface — set the config key
`mcp.enabled` to true and restart the server"), the same message any
disabled lane returns. When apply is enabled, the tool appears and
executes the engine for a plan reference produced in this session.

**Apply posture:** enabled apply passes the **same frozen gates as the
CLI and queue** — the explicit apply flag, the exact confirmation key,
and `acceptLowConfidence` for low-confidence plans — and it is the
surface's single `engine.applySyncPlan` call site, with the plan handed
over verbatim. Every gate refusal comes back as a *tool result*
(`isError: true` refusal naming the gate code, with a mismatching
presented confirmation key redacted to `[blocked:credential]`), never as
a protocol error and never echoing the key value.

Every tool result comes back as an MCP `tools/call` result whose text
content is a JSON payload — parse it as data. The payloads are the same
families the CLI's read lanes surface: the plan payload with its
`planReference`, counts and embedded sanitized plan report; the run-state
snapshot with its `lastRun` marker, pending queue job, lock state and
reference count; and the inventory with per-file adapter ids and task
counts keyed by `ACME-####` task identifiers. Unknown tools, unknown parameters, and
missing required parameters never crash the server: they return a
structured tool error (`isError: true`) listing every problem —
unknown parameters and missing required ones are each named in the
`INVALID_ARGUMENTS` issue list.

## Settings

Settings come from the `settings` option of `createAgentToolServer` — the
programmatic layer over the settings file's `mcp` group (see below). Each
row shows the key, what it controls, and its default.

| Setting | What it controls | Default |
| --- | --- | --- |
| `enabled` | Mutating-tool enablement **only**: `false` keeps `task_sync_apply` invisible and refused (the read tools are unaffected); `true` reveals it. The engine's own gates stay mandatory either way | `false` |
| `transport` | `stdio` (the default — an agent integration spawns the server and speaks JSON-RPC on stdin/stdout) or `http` (the server owns a loopback listener) | `"stdio"` |
| `host` | Interface the HTTP listener binds — loopback only (`127.0.0.1` / `::1`); anything else is a configuration error | `"127.0.0.1"` |
| `port` | HTTP bind port — `0` picks any free loopback port and reports the announced bound port once, on STDERR | `0` |
| `tokenEnvVarName` | Name of the environment variable holding the HTTP bearer token; its value is captured at construction. The token **value never appears** in settings files or logs. For the built-in tool identity this is `TASK_LINEAR_SYNC_MCP_TOKEN` | `"TASK_LINEAR_SYNC_MCP_TOKEN"` |

All five values live in the `mcp` group of the settings file (see
[Configuration](configuration.md)):

```toml
[mcp]
transport = "stdio"
port = 0
```

Invalid values (an unknown transport, a non-loopback host, a port outside
0–65535, a bad `tokenEnvVarName`) never fail silently: the configuration
resolver collects them into one problem per line and reports them at
startup — or throws `McpConfigError` at construction when the surface is
being built programmatically.

## stdio transport

The default transport is line-delimited JSON-RPC 2.0 on stdin and stdout:
an agent integration spawns the process, sends one request per line, and
reads one response per line. **stdout is protocol-only** — logs, the bound
port announcement, and anything else the server emits go to **stderr**, so
a client parsing stdout line-by-line sees only JSON-RPC. A client follows
the MCP handshake: `initialize` (the response announces
`task-linear-sync-mcp` at the release version — the same value the CLI prints —
with `capabilities: { tools: {} }`,
protocol version `2024-11-05` or `2025-03-26`), then
`notifications/initialized`, then `tools/list` and `tools/call`. Calling a
method before the handshake completes answers `-32002` (server not
initialized) and the handshake still proceeds.

### Framing rules for host implementers

- **One complete JSON message per line**, no pretty-printing, no embedded
  raw newlines; `\n`-terminated UTF-8 in both directions.
- **One message per frame**: batches (JSON arrays) and envelopes that are
  not valid JSON-RPC requests are answered `-32600` with `id: null`.
- **Notifications never receive a response** — `notifications/initialized`
  is the handshake completion notice; unknown `notifications/*` are
  dropped silently.
- **Lines over 1 MiB are refused, not truncated**: an oversize line
  answers `-32700` and the connection continues (memory stays bounded).
- A **parse fault answers `-32700` and the stream continues** — a bad
  frame never kills the server; unknown methods answer `-32601`.
- Tool failures are **tool results** (`isError: true` payloads), never
  protocol errors, so hosts distinguish transport faults from refusal
  content by checking `isError`.

## HTTP transport

Point the transport at `http` and the surface runs behind a loopback TCP
listener. Setup is three steps:

1. **Export the bearer token** under the configured variable name —
   `TASK_LINEAR_SYNC_MCP_TOKEN` for the built-in identity — before starting
   the server. An unset or empty variable is a configuration error at
   startup (the message names the variable, never a value).
2. **Start the server**; it binds its port and announces it **once on
   STDERR** (`task-linear-sync-mcp: listening on 127.0.0.1:<port>`).
   Use `port = 0` to let the OS pick a free loopback port and read the
   announced value.
3. **POST JSON-RPC messages** to `http://127.0.0.1:<port>/mcp` with an
   `Authorization: Bearer <token>` header. One request carries one message;
   a notification is accepted with `202` and no body.

A wrong, missing, or malformed bearer token is refused with `401`
(`403` for a validly-shaped token that belongs to someone else) — always
with a constant body and **without** the message reaching the tool
surface. Non-tool routes and wrong methods are refused with `404`/`405`
before authentication, so nothing is disclosed about the surface to an
unauthenticated prober. Requests over 1 MiB are rejected outright.

## Error behavior

Errors are structured and machine-readable at both layers, and neither
layer ever echoes secrets, tokens, or file contents back:

- **Transport layer (JSON-RPC):** parse faults (`-32700`), invalid
  requests (`-32600`), unknown methods (`-32601`), malformed envelopes
  (`-32602`), and internal errors (`-32603`) with fixed messages.
- **Tool layer (`isError: true`):** a refusal payload with a fixed code
  per failure class — `MUTATING_TOOLS_DISABLED` when the surface or the
  apply lane is disabled (the call never touched the engine),
  `PLAN_REFERENCE_UNKNOWN` when apply is called with no plan produced in
  this session yet, `INVALID_ARGUMENTS` listing every invalid parameter
  by name, and an unknown-tool refusal naming the tool.

## Session state

Each server session keeps a small **in-memory plan-reference store**:
every successful `task_sync_plan` records its `planReference` (a 64-hex
id) in a `Map` — no plan bodies stored, nothing persisted. It
is what makes `task_sync_apply` execute *a plan this session actually
previewed*: the `planReference` must be one of this session's recorded
ids, and a cold or restarted process answers `PLAN_REFERENCE_UNKNOWN`
for every previously handed-out reference. The store is private to the
session and disappears with the process; it never becomes cross-session
shared state.

Retention is bounded (feature 014): entries expire lazily past
`mcp.planReferenceTtlSeconds` (integer `60..86400`, default 3600) and the
store trims to `mcp.planReferenceMaxEntries` (integer `1..100000`,
default 1000), evicting the oldest recorded reference first. No timers
are involved — expiry and eviction are checked on read and on record.
An **expired or evicted reference is indistinguishable from a
never-known one**: `task_sync_apply` answers the same
`PLAN_REFERENCE_UNKNOWN` refusal, before the engine, any port call, or
any state-directory access, so long-lived sessions cannot accumulate
unbounded references.

## Safety model

Three invariants the surface is built around, each pinned by tests:

- **Disabled apply is inert.** Not in `tools/list`; a call is refused
  before the engine or any injected port runs — an end-to-end test records
  every port method a refused session called and verifies it is the empty
  set, and the state directory stays byte-for-byte unchanged.
- **No credentials, ever.** The surface makes no network calls of its own
  (the CLI constitution scan bans it) and holds no Linear API key; it
  holds only the session's bearer token value, which is never logged or
  echoed. Bearer comparisons are constant-time.
- **No untrusted paths.** Every tool result passes through the feature
  002 path-safety and output-hygiene screeners before it is serialized,
  so raw absolute paths and secret-shaped substrings never reach the
  agent — blocked segments surface as `[blocked:<category>]` markers.

## Stability

- **Status**: Stable · effective 2026-11-06 · promoted by feature 014.

**Guaranteed scope** — pointer list only; the pointers ARE the scope definition:

- `specs/012-ai-agent-tool-interface/contracts/tool-definitions.md`
- `specs/012-ai-agent-tool-interface/contracts/jsonrpc-stdio.md`
- `specs/012-ai-agent-tool-interface/contracts/transport-auth.md`
- `specs/012-ai-agent-tool-interface/contracts/apply-gating.md`
- `specs/012-ai-agent-tool-interface/contracts/component-api.md`
- `tests/contract/snapshots/mcp-surface.json` — the machine-readable frozen inventory

**Not guaranteed**: behavior outside the frozen inventory (internal refactors,
formatting, diagnostics) may change without notice.

**Explicit non-goals** (one bullet per deferred decision record — populated
before promotion by feature 014 US2/US4, per
`specs/014-preview-to-stable-hardening/data-model.md` §4):

- `mcp-sdk-protocol-surface` — **re-deferred** (012 R1/R2, reaffirmed by
  014 research R7/R9). Rationale: the hand-rolled JSON-RPC/MCP subset keeps
  the zero-dependency budget contract at `SPENT 0`; adopting the MCP SDK
  would spend the one allowance plus its transitive tree and force a
  frozen-contract amendment, while the SDK-only surface — streamable HTTP
  transport, resources, prompts, sampling, elicitation, roots,
  subscriptions — is used by nothing here and expands the frozen
  inventory for zero benefit. The published surface stays
  `initialize`/`tools/list`/`tools/call` over stdio and loopback HTTP.
  Revisit trigger: a future feature needs SDK-only protocol surface
  (streamable HTTP transport, sampling) — that change carries the budget
  amendment explicitly — or MCP event-id/streamable-HTTP infrastructure
  is adopted anyway (which also retires the history surface's
  `sse-last-event-id-resume` deferral).
- `mcp-tls-remote-exposure` — **re-deferred** (012 R9, mirroring 014
  research R4). Rationale: TLS termination is a deployment concern — the
  loopback bearer-token design is deliberately credential-light and
  honest about what it can see; the server terminates no TLS of its own,
  never reads forwarded headers to guess the scheme, and never exposes a
  public socket by itself. Gating and the 401/403 posture never weaken by
  transport, so adding in-component TLS would widen the frozen surface
  (cert lifecycle, SNI, reload semantics) without closing a gap in the
  documented shape. Revisit trigger: a demanded deployment where the
  component itself must terminate TLS (no front door available), or a
  trusted-proxy convention the component could verify honestly.

**Deployment assumptions**: stdio is the default transport; the HTTP transport
is loopback-only — put any TLS termination in front, the server never exposes a
public socket by itself.
