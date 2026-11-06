# Contract: Transports and networked-transport auth

Modules: `src/mcp/stdio.ts` + `src/mcp/http.ts` + `src/mcp/auth.ts` (research R9).
FR-004: stdio is the DEFAULT transport; the optional networked transport keeps credentials
and the interface's auth token server-side and demands a valid token BEFORE serving any
tool call. Transport choice NEVER weakens gating (spec edge case): the dispatcher, tool
visibility, and apply pipeline are byte-identical across transports.

## 1. stdio (default)

`transport: "stdio"` (data-model §3 default) — the process streams; no token
(the local pipe IS the trust boundary, MCP stdio convention). Startup performs zero
network; `process.env` is read only through the injected env seam (component-api.md §1;
production default `process.env` in exactly ONE file — hygiene scan).

## 2. http transport

1. Shape: `node:http` server bound to `settings.host`/`settings.port` (defaults
   `127.0.0.1` / `0` = ephemeral; the chosen port is printed to STDERR once at listen —
   never in a protocol message). Route: `POST /mcp` with exactly one JSON-RPC message per
   request (same framing rules minus newlines: the body is the single message, 1 MiB cap —
   oversized body ⇒ fixed 413-style constant refusal `PAYLOAD_TOO_LARGE`… **closed set**:
   reuse `FORBIDDEN`? No — the envelope set is `{401 UNAUTHORIZED, 403 FORBIDDEN,
   404 NOT_FOUND, 405 METHOD_NOT_ALLOWED, 413 PAYLOAD_TOO_LARGE, 500 INTERNAL}` of
   compile-time constants; bodies are `{"error":"<CODE>"}` strings only).
2. **Auth gate strictly before dispatch** (FR-004): `Authorization: Bearer <token>`
   compared constant-time (`timingSafeEqual`, length-guarded) against the env value of
   `settings.tokenEnvVarName`. Missing header/credential ⇒ 401 + `WWW-Authenticate:
   Bearer`; wrong token ⇒ 403. BOTH fire before ANY handler, engine, port, or state-dir
   access (asserted from the fake-port call log — zero requests).
3. Construction refusal: with `transport: "http"` and the token env var unset/empty,
   `createAgentToolServer` throws `McpConfigError` naming the env-var NAME only (011
   posture — never a value).
4. Every non-`POST /mcp` request ⇒ fixed 404/405 constants. No CORS, no HTML, no
   session cookies (a JSON-RPC client re-sends the bearer header per request).
5. Response bodies: JSON-RPC responses for authenticated requests; fixed envelopes for
   refusals. NOTHING server-side ever transmits the token or tracker credential — not in
   headers, bodies, or stderr (credential-sentinel sweep across the full matrix:
   401/403/404/405/413/500 × pre-init/post-init × enabled/disabled).

## 3. Leak rules (both transports — FR-005, constitution "Credential handling")

1. Token values, tracker credentials, and confirmation-key values NEVER appear in tool
   results, JSON-RPC error messages, HTTP envelopes, or stderr diagnostics. Errors name
   env-var NAMES and config KEYS only.
2. The presented `confirmationKey` argument is never echoed (the engine's
   `CONFIRMATION_KEY_MISMATCH` detail already refrains; the module adds no echo of its own).
3. All propagated text passes the injected `SecurityScreener` (research R10); a blocked
   finding ships the `[blocked:<category>]` sentinel output, never the source text.
