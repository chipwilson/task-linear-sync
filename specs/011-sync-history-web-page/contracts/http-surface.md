# Contract: HTTP Surface (routes, negotiation, statuses, shapes)

Normative behavior behind `src/history-server/routes.ts`, `render.ts`, `sse.ts`,
`errors.ts`. The served route set is EXACTLY the configured attachment URL scheme —
the component owns no other paths (FR-001).

## 1. Routing (FR-001/FR-002)

1. Take `req.url`, split off `?query` / `#fragment`, require the remaining path to start
   with `/`.
2. Rebuild the absolute URL as `cfg.attachmentBaseHost` (trimmed, trailing `/` dropped) +
   the path and call the frozen
   `parseAttachmentUrl(cfg, url)` where `cfg = attachmentUrlConfigFrom(config)` — under the
   frozen default templates the routed paths are `/<toolId>/<uuid>` (canonical) and
   `/<toolId>/<uuid>/<n>` (continuation); overridden templates route exactly as they build.
3. Accept `kind: "canonical"` and `kind: "continuation"` (a continuation route renders the
   same whole-chain view — research R2/R3). Every other outcome — including parser `null`,
   tool-segment mismatch, non-lowercase-UUID identifier, and the page-`0` continuation
   segment — is **404 `NOT_FOUND` with zero history bytes** (SC-002: 100% of malformed
   requests). A parser THROW (`UrlSchemeError`) can only mean a misconfigured host/template:
   the config is probed once at construction (fail-fast there), and any later throw maps to
   `500 INTERNAL`, never a silent accept.
4. The request `Host` header never participates in routing.

## 2. Methods

| Method | Route | Behavior |
|---|---|---|
| `GET` | routed path | view per content negotiation (§3) |
| `POST` | routed path | private-mode session bootstrap only (§3 of access-control.md); in public mode ⇒ `405` |
| other | any | `405` with error envelope (no `Allow` leakage of anything secret) |

## 3. Content negotiation (single routed path — research R4)

| `Accept` | Status | Response |
|---|---|---|
| `text/event-stream` | `200` | SSE (only when `web.realtimeSse` is `true`; when `false` this row degrades to the HTML/JSON posture): headers flushed immediately; `event: history\ndata: <json>\n\n` now; then on every `refreshSeconds` tick (injected clock) a frame ONLY when the serialized view changed; `: ping` comment otherwise; `event: error` + close on upstream failure; server stops writing when the socket closes |
| `application/json` | `200` | `HistoryPageView` (§ data-model 2), stable key order |
| anything else / `*/*` / `text/html` | `200` | server-rendered HTML: full chronological list (works without JS) + inline script attempting fetch-stream SSE, falling back to JSON polling every `refreshSeconds` |

JSON view is the polling payload; the HTML embeds `refreshSeconds` and `taskUuid` (both
benign) in a bootstrap block. HTML escapes every string field; all strings pass the
screener first (FR-008).

## 4. Status codes and error envelopes (FR-002/FR-007; research R7)

| Trigger | Status | Code | History bytes |
|---|---|---|---|
| route/identity not-found (incl. absent canonical attachment, deleted/archived issue) | `404` | `NOT_FOUND` | 0 |
| private, no credential | `401` (+ `WWW-Authenticate: Bearer`) | `UNAUTHORIZED` | 0 |
| private, invalid/expired credential | `403` | `FORBIDDEN` | 0 |
| port ultimate failure, category `rate-limit` | `429` | `RATE_LIMITED` | 0 |
| port ultimate failure (other categories), chain integrity error | `502` | `TRACKER_UNAVAILABLE` | 0 |
| unexpected internal error | `500` | `INTERNAL` | 0 |

Error bodies render from fixed constants per negotiated type (JSON `{ error: { code,
message } }`, HTML shell, SSE `event: error`); `TrackerError.detail` is never forwarded;
bodies additionally pass screener + escaping. **No credential value may appear in any
response or error body, header, or redirect target** (SC-003; sentinel sweep).

## 5. Response headers (every response)

- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src
  'unsafe-inline'`
- Cache views only: `X-History-Cache: hit|miss`, `X-History-Age-Ms: <n>` on hits
- SSE only: `Content-Type: text/event-stream`, `Connection: keep-alive` (HTTP/1.1),
  chunked writes, no `Content-Length`

## 6. Negative invariants

- The component serves ZERO routes outside the attachment scheme (no `/health`, no index
  page, no static assets — favicon etc. falls through to 404).
- Zero tracker mutation calls per any response (asserted from the fake-port call log).
- The same (chain state, config, clock) ⇒ byte-identical JSON view body (determinism).
