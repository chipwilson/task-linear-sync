# Sync-History Web Component (`task-linear-sync/history-server`)

Feature 011: a **read-only** web surface that reconstructs a task's sync-history
timeline from the tracker and serves it as HTML, JSON, or a Server-Sent Events
stream. The component never reads local state (no manifest, no `sync-state.json`,
no checkpoint) and never becomes a tracker client beyond the injected
`LinearPort`; every tracker read goes through that single port (constitution V).

All identifiers in this document are placeholders (Principle III).

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
  form in the HTML shell); a presented-but-invalid credential ⇒ `403`, never
  downgraded to a 401. Authorization runs strictly **before** any tracker
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

## Cache semantics

Per `taskUuid`: a stored view is fresh while `clock.elapsed(builtAt) <
web.cacheTtlSeconds * 1000` (clock injected; `0` disables caching entirely).
Concurrent misses for the same task coalesce into one chain walk
(single-flight). Failed reconstructions are never cached and stale views are
never served on upstream failure. Success responses carry the non-normative
`X-History-Cache: hit|miss` marker (plus `X-History-Age-Ms` on hits); error
responses carry no cache headers and no history bytes.

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
