# Sync-History Web Component (`task-linear-sync/history-server`)

Feature 011: a **read-only** web surface that reconstructs a task's sync-history
timeline from the tracker and serves it as HTML, JSON, or a Server-Sent Events
stream. The component never reads local state (no manifest, no `sync-state.json`,
no checkpoint) and never becomes a tracker client beyond the injected
`LinearPort`; every tracker read goes through that single port (constitution V).

All identifiers in this document are placeholders (Principle III).

This feature's wire surface is pinned by feature 011's specs and the
frozen surface snapshot — see `## Stability` at the end of this document.

## Usage

```ts
import { createSyncHistoryServer } from "task-linear-sync/history-server";
import { createLinearPort } from "task-linear-sync/tracker";
import { loadConfig } from "task-linear-sync/config";

const config = loadConfig();
const app = createSyncHistoryServer({
  port: createLinearPort(config), // the ONLY route to the tracker
  config,                         // frozen merged config (web group drives the surface)
});

// Long-lived process:
const server = await app.listen(8790, "127.0.0.1");
console.log(`history: http://localhost:${server.port}`);

// Or deploy the handler directly (any (req, res) host, incl. serverless):
// export default app.handle;
```

A history is addressed through the frozen attachment-URL scheme: the canonical
sync-state attachment URL of the task (`https://history.example.invalid/…`,
routed by the frozen `parseAttachmentUrl`), continuation-page URLs of the same
task, or the plain `/history/<taskUuid>` path form. Anything else is 404, every
error response carries zero history bytes.

## Settings

`resolveHistoryServerConfig(config)` is pure validation over the existing
`ResolvedConfig.web` group (001 frozen schema) plus construction-time range
guards. No new configuration keys exist; out-of-range values fail fast at
construction listing **all** problems, one dotted-key line each.

| Setting | Source (frozen 001 default) | Surface guard |
|---|---|---|
| `accessMode` | `web.accessControlMode` (`"private"`) | enum (schema-typed) |
| `tokenEnvVarName` | `web.authEnvVarName` (`${envVarPrefixFor(toolId)}_WEB_TOKEN`) | non-empty |
| `sseEnabled` | `web.realtimeSse` (`true`) | — |
| `refreshSeconds` | `web.pollIntervalSeconds` (`15`) | integer `1..3600` |
| `cacheTtlSeconds` | `web.cacheTtlSeconds` (`10`) | integer `0..3600` (0 disables) |

Session lifetime (3600 s) and the chain-walk bound (reject beyond 1000
pages, mirroring the tracker's own cap) are module constants, not config;
SSE heartbeats are `: ping` comments emitted on
unchanged refresh ticks. In `private` mode a non-empty
token **must** exist in the environment before construction succeeds; the
error names only the variable NAME, never a value.

## Deployment shapes

1. **Long-lived behind a proxy** — run `app.listen()` on a loopback address
   and let the reverse proxy terminate TLS. Responses ship `Cache-Control:
   no-store` and a restrictive `Content-Security-Policy`, so intermediaries
   must not (and per the headers, cannot legitimately) cache them.
2. **Direct** — `app.listen(port, host)` is a thin convenience over
   `node:http`; nothing else about the shape changes.
3. **Serverless / function** — export `app.handle` as the request handler and
   never call `listen()`. With `web.cacheTtlSeconds = 0` the cache stores
   nothing, each invocation re-walks the chain, and no state persists between
   invocations (the component is stateless by construction: zero `node:fs`,
   enforced by the hygiene release scan).

## Access modes

- **`private` (default).** Requests need either `Authorization: Bearer <token>`
  or a session cookie. The token lives ONLY server-side, in the environment
  variable named by `web.authEnvVarName` (by default
  `TASK_LINEAR_SYNC_WEB_TOKEN`):

  ```sh
  export TASK_LINEAR_SYNC_WEB_TOKEN="$(openssl rand -hex 32)"
  ```

  Browsers bootstrap a session by POSTing the token to the history URL as a
  form body (`token=…`, capped at 8 KB): a valid submission answers `303` with
  a `Set-Cookie` for a stateless, HttpOnly, SameSite=Strict session cookie
  (`HMAC` under an HKDF-derived key, expiry 3600 s, verified against the
  injected clock; the cookie value never contains a substring of the token).
  No credential at all ⇒ `401` (+ `WWW-Authenticate: Bearer`, with a token
  form in the HTML shell); a credential that parses but fails to verify ⇒
  `403`, never downgraded to a 401. The `Authorization` scheme is matched
  like RFC 7235 defines it: case-insensitive and whitespace-tolerant
  (`bearer`, `BEARER`, `  Bearer  <token>` all present the token), and a
  value that is not a well-formed Bearer credential — bare `Bearer`, an
  empty token, `Basic …` — counts as **no credential** (401), not as a
  failed one. This is the same parser the MCP HTTP transport uses; the
  parity is pinned by a cross-surface test, not by a shared module.
  Authorization runs strictly **before** any tracker
  probe.
- **`public` (explicit opt-in via `web.accessControlMode`).** Any credential
  is ignored; every request serves. Intended for private networks / sidecars
  where the operator has already enforced access.

## Live updates: SSE vs polling

Content negotiation on `Accept`: `text/event-stream` streams (an `event:
history` frame with the full view, refreshed every `web.pollIntervalSeconds`,
with a `: ping` comment heartbeat on unchanged ticks),
`application/json` serves the view
document, otherwise a self-contained HTML page. The HTML page works without
JavaScript and carries an inline upgrade script: it attempts an `EventSource`
connection and additionally re-fetches the JSON view every
`web.pollIntervalSeconds` as a fallback, so live updates keep arriving
without a manual reload. SSE refreshes re-walk the chain (they must not be
frozen by the cache); JSON/HTML reads go through the TTL cache.
`web.realtimeSse = false` turns SSE negotiation off (405-set unaffected).
A reconnect that names `Last-Event-ID` is accepted and the header is
**ignored**: every stream starts fresh with the full current chain (the
history is append-only and re-derivable, so a full re-render IS the resume
semantics — see the Stability non-goal `sse-last-event-id-resume`).

## Cache semantics

Per `taskUuid`: a stored view is fresh while `clock.elapsed(builtAt) <
web.cacheTtlSeconds * 1000` (clock injected; `0` disables caching entirely).
Concurrent misses for the same task coalesce into one chain walk
(single-flight). Failed reconstructions are never cached and stale views are
never served on upstream failure. Success responses carry the non-normative
`X-History-Cache: hit|miss` marker (plus `X-History-Age-Ms` on hits); error
responses carry no cache headers and no history bytes.

Retention is LRU-bounded by `web.maxCacheEntries` (integer `1..100000`,
default 500): a read of a fresh entry moves it to the most-recent slot, and a
`set` past the bound evicts from the front (insertion order breaks ties).
Expiry stays lazy — no timers. Eviction never changes response bytes: every
miss rebuilds from the tracker, so a bounded run and an unbounded run serve
byte-identical responses for the same world.

## Backpressure

Two independent inbound counters answer over-limit requests with the existing
`429 RATE_LIMITED` envelope (fixed body, zero history bytes) plus a
`Retry-After: 1` header — no queueing, no in-component retries:

- `web.maxConcurrentWalks` (integer `1..64`, default 8) counts chain-walk
  leaders; a cache hit or a single-flight follower is never refused.
- `web.maxConcurrentSseStreams` (integer `1..1000`, default 16) counts open
  streams; an over-limit join is answered before the stream opens and is
  therefore never counted — closing a stream frees its slot immediately.

This self-protective 429 is the *same* envelope the tracker-originated rate
limit maps to; clients treat both identically (retry later). The header-only
delta is recorded in `docs/contract-amendments.md`.

## Security posture

- Credentials exist only server-side (env) or as signed, token-free session
  cookies; no response ever contains the token — a sentinel release scan
  sweeps the whole error corpus (401/403/404/429/502/500 × HTML/JSON/SSE ×
  private/public) for zero sentinel bytes.
- Every event description/reference passes the engine security screener
  before rendering; blocked content ships only as `[blocked:<category>]`
  markers, and browser text is additionally HTML-escaped.
- All error bodies render from fixed constants — they name no credential, no
  path, and no upstream `detail`; tracker transport failures map to `502
  TRACKER_UNAVAILABLE` (or `429 RATE_LIMITED` when the tracker rate-limits
  past its own retries), never leaking the cause string.
- Responses are `no-store` with `X-Content-Type-Options: nosniff` and a
  default-deny CSP; `node:http` is the only transport (inbound only — the
  component never acts as a client).
- Production exposure goes through a TLS-terminating front door; behind one,
  set `web.secureCookies: true` so the session cookie appends `; Secure`
  (the base attribute set `Path=/; HttpOnly; SameSite=Strict` is unchanged).
  The default `false` fits plain loopback or same-origin hosting; the
  component never auto-detects TLS from forwarded headers (014 research R4).

## Stability

- **Status**: Stable · effective 2026-11-06 · promoted by feature 014.

**Guaranteed scope** — pointer list only; the pointers ARE the scope definition:

- `specs/011-sync-history-web-page/contracts/http-surface.md`
- `specs/011-sync-history-web-page/contracts/access-control.md`
- `specs/011-sync-history-web-page/contracts/history-reconstruction.md`
- `specs/011-sync-history-web-page/contracts/component-api.md`
- `tests/contract/snapshots/history-surface.json` — the machine-readable frozen inventory

**Not guaranteed**: behavior outside the frozen inventory (internal refactors,
formatting, diagnostics) may change without notice.

**Explicit non-goals** (one bullet per deferred decision record — populated
before promotion by feature 014 US2/US4, per
`specs/014-preview-to-stable-hardening/data-model.md` §4):

- `sse-last-event-id-resume` — **re-deferred** (011 research R4, reaffirmed
  014 research R9). Rationale: the chain is append-only and re-derivable from
  the tracker; a resume cursor would cache chain state the component
  deliberately does not own (011 FR-004: nothing reconstructed from local
  state), and per-stream cursor state interacts badly with the R3 stream
  bound for a problem no deployment has shown. `Last-Event-ID` is therefore
  ignored and every stream ships the full current chain. Revisit trigger:
  adoption by a TLS-fronted real deployment showing repeated proxy-side
  stream drops, or MCP streamable-HTTP adoption (which would introduce
  event-id infrastructure anyway).
- `history-inbound-identity-limiting` — **re-deferred** (014 research R3).
  Rationale: the surface is deliberately credential-light (private/public
  modes only); per-client token buckets would invent an identity model, and
  random shedding is nondeterministic — so admission stays aggregate
  (walk/stream counters, `Retry-After: 1`) and never per-client. Revisit
  trigger: a shared multi-tenant deployment where aggregate bounds demonstrably
  let one client starve others, or an access mode that introduces per-user
  credentials.

**Deployment assumptions**: production exposure puts a TLS-terminating front
door in front of the component; set `web.secureCookies: true` behind it so the
session cookie carries `Secure`. Plain loopback or same-origin hosting works
with the default (`false`).
