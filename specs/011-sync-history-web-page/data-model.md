# Phase 1 Data Model: Sync-History Web Component

**Feature**: `011-sync-history-web-page` | **Date**: 2026-11-06

All shapes owned by 011 are view-layer only: entities read from the tracker stay in their
frozen 002/008 shapes (`SyncStatePayload`, `SyncHistoryEvent`, continuation page record)
and are NEVER mutated — 011 projects them into browser views. Local module:
`src/history-server/`.

## 1. `RouteMatch` (owned; `routes.ts`)

Result of parsing one request against the configured scheme (research R2).

| Field | Type | Rule |
|---|---|---|
| `kind` | `"canonical" \| "continuation"` | from frozen `parseAttachmentUrl`; `continuation` additionally carries `page ≥ 1` |
| `taskUuid` | string | MUST match the frozen UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (lowercase; enforced by the parser — FR-002) |
| `page` | number (continuation only) | integer ≥ 1; `page 0` is not a URL of the scheme (frozen rule) — 404 |

`parse` returns `null` (⇒ 404 `NOT_FOUND`, zero history bytes) for: template mismatch,
tool-segment mismatch, non-UUID identifier, page-0 continuation segment, query/fragment
left in the matched string (stripped before matching). Never throws on hostile input —
`UrlSchemeError` from the parser is caught and mapped to the same 404.

## 2. `HistoryPageView` (owned; `reconstruct.ts` → `render.ts`)

The per-task reconstructed view — the sole authoritative-in-shape object the browser sees.

| Field | Type | Source / rule |
|---|---|---|
| `taskUuid` | string | from `RouteMatch`; equals page-0 payload `taskUuid` (mismatch ⇒ integrity error 502) |
| `events[]` | `HistoryEventView[]` | page-0 `history` ++ pages 1..N `history` (ascending chain order), then **stable sort by `at`** (ties keep chain order) — FR-003 |
| `pages` | `{ index: number; eventCount: number }[]` | one entry per chain page 0..N, ascending |
| `lastSyncAt` | string (ISO) | page-0 payload `cursors.lastSyncAt` (display metadata only) |
| `generatedAt` | string (ISO) | injected `Clock.now()` at reconstruction time |

`HistoryEventView` (per event; all strings screened + HTML-escaped at render — FR-008):

| Field | Type | Rule |
|---|---|---|
| `at` | ISO-8601 string | verbatim from the frozen event (never reformatted in JSON) |
| `atHuman` | string | `YYYY-MM-DD HH:MM:SS UTC` derived from `at` in UTC (no locale, deterministic) |
| `kind` | frozen `SyncHistoryEventKind` | one of the eight frozen kinds; **`rollback` is rendered exactly like any other kind** (FR-003) |
| `description` | string | event `description` after `screener.screen()` + escaping; blocked findings ship the `[blocked:<category>]` sentinel only |
| `references` | `string[] \| null` | screened, joined ` · ` in HTML |

## 3. `ChainReconstruction` (intermediate; `reconstruct.ts`)

Internal pipeline result before view shaping:

- `walk: { canonical: AttachmentView; pages: AttachmentView[] }` — result of the serving
  page-walk `walkHistoryChain` (`reconstruct.ts`): `getAttachmentByUrl(canonicalAttachmentUrl)`
  then `getAttachmentByUrl(continuationAttachmentUrl(cfg, uuid, n))` for `n = 1..` until the
  first absence, hard-capped at 1000 pages (local constant mirroring 007's internal
  `MAX_CHAIN_PAGES`). No orphan probing — orphan detection is a diagnostic affordance, and
  per-request serving reads stay minimal (same first-absence chain semantics as 007).
- `pages: Array<{ index: number; events: readonly SyncHistoryEvent[] }>` — parsed page
  payloads: page 0 via `parseSyncStatePayload(metadata[nsKey]).history`; pages n ≥ 1 via the
  real 008 module `parseHistoryPageRecord(view, nsKey)` (`src/engine/history-page.ts`,
  record `{ taskUuid, page, history }`). A page record whose `taskUuid`/`page` contradicts
  its addressed URL, malformed JSON, or a non-array
  `history` ⇒ `HistoryIntegrityError` → 502 sanitized (never a partial view, never a skip).

Validation rules: canonical absent ⇒ `NotFound` (404, no history) — includes the
deleted/archived-issue edge case; zero events across the chain is a VALID empty history
(200 with `events: []`).

## 4. `ResolvedHistoryServerSettings` (owned; `options.ts`)

Read-only validated view of the **existing frozen `web` surface group** (`ResolvedConfig.web`,
001 schema — `WebSurfaceConfig`: `accessControlMode`, `realtimeSse`, `pollIntervalSeconds`,
`cacheTtlSeconds`, `authEnvVarName`; built-in defaults exactly match this feature's spec
defaults). Pure read of the merged `ResolvedConfig`, never a mutation, and **no new config
keys** (001's schema is frozen):

| Setting | Config source | Frozen default | Surface startup guard | Rule (verbatim constraints) |
|---|---|---|---|---|
| `accessMode` | `web.accessControlMode` | `"private"` | enum (schema-typed) | "default to private access … with public read-by-URL access as an explicit opt-in" (FR-008) |
| `tokenEnvVarName` | `web.authEnvVarName` | `${envVarPrefixFor(toolId)}_WEB_TOKEN` (001 derivation table) | non-empty | env-var NAME only; the value is read server-side, never shipped (FR-008) |
| `refreshSeconds` | `web.pollIntervalSeconds` | `15` | integer `1..3600` | "configurable interval, default 15 s, range 1–3600 s" (FR-005) |
| `sseEnabled` | `web.realtimeSse` | `true` | — | SSE upgrade only when true; otherwise content negotiation degrades to HTML/JSON |
| `cacheTtlSeconds` | `web.cacheTtlSeconds` | `10` | integer `0..3600` | "default 10 s, range 0–3600 s; 0 disables" (FR-006) |

001 validates types but bounds no numeric ranges on the `web` group, so the range guards
above run at surface construction: out-of-range ⇒ construction-time refusal with a
dotted-key problem listing (queue-group posture, `src/queue/config.ts` precedent —
read-only validation, no new keys). Values not in the frozen schema (session lifetime 3600 s,
SSE heartbeat cadence, queue/limit constants) are **module constants**, not config keys.
Private mode + unset/empty token env var ⇒ construction-time refusal naming the
env-var NAME only (constitution "Credential handling": naming diagnostic before any
request, value never shown).

## 5. `CacheEntry` (owned; `cache.ts`)

`{ builtAtIso: string; view: HistoryPageView }` keyed by `taskUuid`, evicted when
`clock.elapsed(builtAtIso) ≥ cacheTtlSeconds * 1000`; `cacheTtlSeconds === 0` ⇒ the cache
object never stores. Single-flight map: `taskUuid → Promise<HistoryPageView>` for
concurrent misses. Non-authoritative: never consulted for correctness, never served after
TTL, never served on upstream error (R6). No other process state exists anywhere in the
group (SC-004/FR-004).

## 6. `SessionGrant` (owned; `auth.ts`)

Stateless cookie `<toolId>-history=<payload>.<tag>`:

| Part | Rule |
|---|---|
| `payload` | `base64url(JSON { exp: <expiry ISO per injected clock> })` |
| `tag` | `base64url(HMAC-SHA256(K, payload))`, `K = hkdfSync(sha256, ikm = token, salt = toolId, info = "history-session-v1", 32)` |
| Validation | re-derive `K` server-side, constant-time recompute tag, check `exp` on injected clock; ANY failure ⇒ 403 zero-history |
| Leak rule | the cookie, its parts, and `K` contain no token material; token appears in no `Set-Cookie` value (SC-003) |

## 7. `ErrorEnvelope` (owned; `errors.ts` + `render.ts`)

Closed code set with fixed sanitized messages (R7): `NOT_FOUND`→404, `UNAUTHORIZED`→401
(+`WWW-Authenticate: Bearer`), `FORBIDDEN`→403, `RATE_LIMITED`→429,
`TRACKER_UNAVAILABLE`→502, `INTERNAL`→500. Shape:
`{ error: { code, message } }` (JSON) / minimal shell (HTML) / `event: error` (SSE before
close). Message strings are compile-time constants — port `detail` is never interpolated;
envelope output additionally passes screener + escaping. **Zero history bytes by
construction**: error rendering never touches `HistoryPageView`.

## 8. `SyncHistoryServerDeps` / `SyncHistoryServerApp` (owned; `create.ts`)

| Member | Rule |
|---|---|
| `deps.port: LinearPort` | injected; the only route to the tracker (constitution V) |
| `deps.config: ResolvedConfig` | frozen merged config; source of URL scheme, namespace key, `web` surface group (`ResolvedConfig.web`) |
| `deps.clock?: Clock` | defaults `systemClock`; TTL/cadence/expiry all clock-driven |
| `deps.screener?: SecurityScreener` | defaults `createDefaultSecurityScreener(config)` |
| `deps.env?` | defaults `process.env` (the group's single sanctioned `process.env` site — R9 scan) |
| `app.handle(req, res)` | the deployable unit: an `(req,res)` listener usable with or without `listen()` (serverless shape — SC-004) |
| `app.listen(port?, host?)` | optional convenience over `node:http.createServer(app.handle)`; returns bound port + `close()` |

## 9. Request lifecycle (state transitions)

```text
request ── route(R1) ──∕⇏ 404 NOT_FOUND (0 history bytes)
        ── auth(R5) ───⇏ 401/403 (0 history bytes)  │ public ⇒ pass
        ── cache(R6) hit ──────────────── view ── content-negotiate(R4) ── respond
        ── single-flight reconstruct(R3) ⇏ 404 / 429 / 502 / 500 (0 history bytes)
        ── view ── store in cache (if ttl > 0) ── respond:
              Accept: text/event-stream ⇒ SSE loop if web.realtimeSse (cadence re-read,
            changed-only frames); else HTML/JSON posture
              Accept: application/json  ⇒ JSON view
              else                      ⇒ HTML (+ inline upgrade script)
POST (same route, private bootstrap) ── token form ⇏ 403 │ ⇒ Set-Cookie + 303
```

No transition writes anything outside the response socket; the process is inert between
requests except TTL-bounded cache entries (R1/R6/R9).
