# Contract: JSON-RPC / MCP stdio wire posture

Module: `src/mcp/jsonrpc.ts` + `src/mcp/framing.ts` + `src/mcp/stdio.ts`
(research R2/R11). The spec pins tool sets and guarantees, not wire format; this contract
pins the wire format the module implements — the MCP stdio-transport shape:
**newline-delimited JSON-RPC 2.0** over the process streams.

## 1. Framing

1. Messages are compact single-line UTF-8 JSON-RPC 2.0 objects terminated by `\n`.
   A message never contains a raw `\n`; a leading `\r` before the terminator is stripped
   (CRLF hosts tolerated).
2. **stdout carries protocol bytes only.** Diagnostics (listening port line, startup notes)
   go to stderr exclusively.
3. Blank lines are ignored. A complete line exceeding `MAX_LINE_BYTES` (1 MiB) is answered
   `-32700` and dropped — the connection continues; the message is NEVER partially parsed
   or truncated into a success.
4. On stream end, a non-empty partial tail is decoded once as a final message; then the
   session ends and the store (contracts/apply-gating.md §2) dies with the process.

## 2. Lifecycle / handshake

1. `initialize` (request) — `params.protocolVersion` echoed when in the supported set
   `{ "2024-11-05", "2025-03-26", "2025-06-18" }` (014 amendment: `2025-06-18` joins — it adds no
   stdio-layer semantics this server does not already implement), else the server answers
   `"2025-06-18"` (our latest).
   Result: `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version } }`
   with `name = "<toolId>-mcp"` (toolId-derived, zero org literals) and `version` from the
   package version.
2. `notifications/initialized` and `notifications/cancelled` — accepted no-ops; unknown
   `notifications/*` are dropped silently. A notification never receives a response
   (JSON-RPC), including on parse failure.
3. Requests arriving BEFORE a completed `initialize` answer `-32002` (server not
   initialized). A second `initialize` on the same connection answers `-32602`.
4. `ping` (request) answers `result: {}` once `ready` (and `-32002` before).
5. There is no `shutdown` method: closing stdin (or the HTTP socket) ends the session.

## 3. Method table

| Method | Kind | Server behavior |
|---|---|---|
| `initialize` | request | §2.1 handshake |
| `notifications/initialized` | notification | no-op |
| `notifications/cancelled` | notification | no-op (in-flight calls are never preempted; refusal paths finish immediately anyway) |
| `ping` | request | `{}` |
| `tools/list` | request | tool-definitions.md §1 (visibility-filtered; `cursor` params unsupported ⇒ `-32602` if present) |
| `tools/call` | request | tool-definitions.md §2; refusals are `isError: true` RESULTS, never protocol errors |

Unknown methods ⇒ `-32601` method not found (message names the METHOD TOKEN only).

## 4. Error codes (closed set)

`-32700` parse error · `-32600` invalid request · `-32601` method not found ·
`-32602` invalid params (structural shape faults only) · `-32603` internal error (fixed
text `"internal error"`, never a wrapped exception message) · `-32002` server not
initialized. `error.message` values are compile-time constants or method tokens —
NEVER presented argument values, credential material, or engine internals (FR-005; the
credential-sentinel sweep includes protocol error bytes).

## 5. stdio transport (`stdio.ts`)

`serveStdio(readable = process.stdin, writable = process.stdout, errorSink =
process.stderr)` attaches the framer (§1) to the streams and feeds the shared dispatcher
(component-api.md §2). Concurrency: requests are dispatched in arrival order; responses are
written as complete single lines, one `write` per message. Handler rejections are converted
to `-32603` — the server never throws into the stream and never crashes the host on a bad
line.
