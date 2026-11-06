# Phase 0 Research: Sync-History Web Component

**Feature**: `011-sync-history-web-page` | **Date**: 2026-11-06

Resolves every Technical Context unknown and every dependency/integration question.
No NEEDS CLARIFICATION remains in plan.md; the spec-advisory points (token-vs-session
mechanism, push-host detection, continuation-route policy, stale-on-error) are each
resolved with a Decision below. Each entry: **Decision / Rationale / Alternatives
considered**.

## R1. Module placement and dependency budget

- **Decision**: New disjoint `src/history-server/` module group (the constitution's
  `Sync_History_Server`), exposed through one additive `./history-server` subpath export
  (types `./dist/history-server/index.d.ts`, default `./dist/history-server/index.js`).
  Zero new runtime dependencies; source imports restricted to Node built-ins `node:http`
  (inbound listener only) and `node:crypto` (constant-time compare, HMAC), plus relative
  imports of `../domain`, `../config`, `../urls`, `../gates`, `../ports`, `../tracker`
  (barrel only — chain walk, `attachmentUrlConfigFrom`, `TrackerError`) and
  `../engine/screening.js` (`createDefaultSecurityScreener` default). No `src/state` import,
  no `node:fs` import anywhere in the group (enforced by the R9 hygiene scan).
- **Rationale**: ROADMAP rule 2 and constitution V demand an additive, disjoint group;
  the name matches the constitution's surface vocabulary. Zero-dependency continues the
  002/007/008/010 posture — `node:http` fully covers HTTP/1.1 serving (the deployment
  story: direct, behind a proxy, or as a handler inside any host's listener), and the
  one platform-transport allowance is 012's scoped concern.
- **Alternatives considered**: (a) a web framework (Fastify/Express) — rejected, a runtime
  dependency the constitution budget discourages and `node:http` suffices; (b) placing the
  server inside `src/engine/` — rejected, the engine is the frozen gated core and this
  surface has no apply path; (c) `node:https`/TLS termination in-process — rejected,
  TLS is a deployment/proxy concern; the component serves plain HTTP behind whatever
  terminator the host provides.

## R2. Route parsing derived solely from the configured URL template

- **Decision**: The router (FR-001) does not implement its own matcher. It (1) strips the
  query string and fragment from `req.url` (the origin-form path the HTTP host delivers),
  (2) rebuilds the absolute URL as `cfg.attachmentBaseHost` (trimmed, trailing `/` dropped
  — the parser normalizes the same way; its private `normalizeBaseHost` is not re-implemented)
  + `/` + the sanitized path, and (3) calls the frozen `parseAttachmentUrl(cfg, url)` from
  `src/urls` — the same inverse-of-builders parser the 007 chain walk uses. `cfg` comes from
  `attachmentUrlConfigFrom(config)` (exported by `src/tracker`), so host, tool segment, and
  both templates derive **solely** from the 002 configuration.
  A `null` parse, a tool-segment mismatch (the parser anchors `{toolId}` literally), or a
  non-UUID identifier all yield the not-found posture (FR-002); a `UrlSchemeError` throw from
  the parser can only mean config drift (the config is probed once at construction, so a
  mid-request throw maps to `500 INTERNAL`, never a silent accept — http-surface §1.3);
  the request `Host` header
  is never consulted (the configured base host is authoritative, satisfying "derived solely
  from that configuration"). With the frozen default templates the routed paths are
  `/<toolId>/<uuid>` (canonical) and `/<toolId>/<uuid>/<n>` (continuation) — derived from
  the templates, never hardcoded segments.
- **Rationale**: One parser, zero drift — a contract test feeds paths produced by
  `canonicalAttachmentUrl`/`continuationAttachmentUrl` under default AND overridden
  templates and asserts the router accepts exactly those. Re-implementing a matcher would
  fork the frozen scheme semantics (behavior rule 4: overridden templates must parse
  consistently with the builders).
- **Alternatives considered**: (a) regex built locally from the template — rejected, a
  second implementation of the frozen parse; (b) matching on `Host` — rejected, hosts
  behind proxies differ from the recorded base host, and trusting `Host` would let a
  differently-hosted vhost claim routes.

## R3. Live per-request reconstruction (canonical payload + continuation chain)

- **Decision**: For a routed `taskUuid`, run a serving page-walk `walkHistoryChain`
  (`reconstruct.ts`) with the same deterministic-URL probe semantics as the 007 chain walk
  — `getAttachmentByUrl(canonicalAttachmentUrl(cfg, uuid))`, then
  `getAttachmentByUrl(continuationAttachmentUrl(cfg, uuid, n))` for `n = 1..` until the first
  absent index, hard-bounded at 1000 pages (local constant mirroring 007's internal
  `MAX_CHAIN_PAGES`) — but WITHOUT 007's orphan-probe window: orphan detection is a
  diagnostic affordance and per-request serving reads stay minimal
  (`enumerateAttachmentChain` is not called). Page 0: read
  `attachment.metadata[config.metadataNamespaceKey]`, `parseSyncStatePayload`, take
  `.history`. Pages n ≥ 1: parse with the real 008 module —
  `parseHistoryPageRecord(view, config.metadataNamespaceKey)` from
  `src/engine/history-page.ts` (record `{ taskUuid, page, history }`, canonical-serialized
  under the same namespace key); a `null` parse mid-chain or a record whose `taskUuid` or
  `page` contradicts its addressed URL is an integrity error → 502 sanitized (never silently
  skipped). Concatenate page 0 then pages
  1..N ascending, then apply a **stable sort by `at`** (ISO-8601 — ties keep chain order).
  Render every event identically regardless of `kind` — rollback included (FR-003):
  human-readable timestamp `YYYY-MM-DD HH:MM:SS UTC` derived from `at` (UTC, no locale),
  kind label, screened description, optional references joined ` · `. Absent canonical
  attachment (first probe `null`, e.g. deleted/archived issue) ⇒ 404 with no
  history data (FR-002 + edge case). Pages beyond a gap are unreachable by the URL scheme's
  first-absence semantics — the same posture the engine itself takes.
- **Rationale**: Addressing through the frozen builders guarantees the reader sees the
  same chain the writer wrote; the engine's own append order is chain order, so the stable
  sort is a belt-and-braces chronological view that also handles cross-page clock skew.
- **Alternatives considered**: (a) walking `listAttachments(issueId)` cursor pages —
  rejected: continuation pages are "addressed purely by URL (scheme contract)" per the
  frozen port doc, and the URL walk is already the established 007 semantics;
  (b) trusting raw chain order without the sort — rejected, SC-001 demands exact
  chronological order and the fixture deliberately interleaves page timestamps; (c) capping
  displayed events — rejected, "history that misses pages is worse than no view" (spec US1);
  (d) calling 007's `enumerateAttachmentChain` directly — rejected for serving: its
  orphan-probe window costs extra tracker reads on every request (and on every cache miss)
  for a diagnostic the view does not need.

## R4. Tiered transport: SSE push + periodic-refresh fallback

- **Decision**: Content negotiation on the single routed path — no extra routes, template
  stays pure: `Accept: text/event-stream` ⇒ SSE (`200`, `Content-Type: text/event-stream`,
  flush headers immediately, emit `event: history\ndata: <json>\n\n` now, then re-read on
  the injected clock's `refreshSeconds` cadence emitting only when the serialized view
  changed, plus `: ping` keepalive comments; close when the request closes). Otherwise
  `Accept: application/json` ⇒ JSON view; default ⇒ server-rendered HTML shell containing
  the full history (works with JavaScript disabled) + a small inline vanilla-JS script that
  first attempts SSE via **fetch streaming** (which can send the `Authorization` header,
  unlike `EventSource`) and on failure/downlevel falls back to periodic `fetch` of the
  JSON view every `refreshSeconds` (rendered into the same DOM). `refreshSeconds` default
  15 s, range 1–3600 s (FR-005); "host supports long-lived responses" is operationalized
  as: the SSE attempt either streams or fails/closes — the client falls back automatically.
  Server-side push cadence equals `refreshSeconds` ("refreshing server-side on that
  cadence").
- **Rationale**: Accept-header negotiation keeps the served route byte-identical to the
  recorded attachment URL; fetch-streaming removes the classic EventSource-can't-send-
  headers problem without a ticket handshake; the HTML page is independently useful
  (auditors, JS-disabled, link unfurling).
- **Alternatives considered**: (a) `EventSource` + one-time SSE tickets in the query string
  — rejected, extra mechanism/state and URL-logged secrets posture; (b) long-polling —
  rejected as primary, the spec names push-where-supported + fixed-interval fallback;
  (c) WebSockets — rejected, protocol upgrade machinery the tiered spec doesn't require;
  (d) `Last-Event-ID` resume semantics — deferred, cadence re-read is idempotent and
  stateless (the client simply re-renders).

## R5. Access control: token server-side only, optional stateless cookie session

- **Decision** (resolves the spec Assumption "static token vs session"): both, minimal and
  stateless. Private mode (default) accepts, in order: (1) `Authorization: Bearer <token>`
  — compared with `crypto.timingSafeEqual` against the token read server-side from the env
  var named by `web.authEnvVarName` (001 derivation: `${envVarPrefixFor(toolId)}_WEB_TOKEN`,
  env injected in tests); (2) a **stateless session cookie** `<toolId>-history=<payload>.<tag>`
  where `payload = base64url(<expiry-iso>)` and `tag = HMAC-SHA256(K, payload)` with
  `K = HKDF-SHA256(ikm = token, salt = toolId, info = "history-session-v1")` — the token
  itself is NEVER in the cookie, only a key-derived tag; validated with the injected clock
  (`SESSION_TTL_SECONDS` module constant, 3600 — the frozen 001 `web` schema has no key for
  it, so it is deliberately not config). Bootstrap for browser navigation:
  a 401 HTML shell contains a token-entry form that `POST`s to the same route
  (`application/x-www-form-urlencoded`, body cap 8 KB) → success sets the cookie and
  `303`-redirects to the route; failure ⇒ 403 zero-history. No credential present ⇒
  `401` + `WWW-Authenticate: Bearer`; present-but-invalid/expired ⇒ `403`. Public mode is
  explicit opt-in (`web.accessControlMode: "public"`) and ignores credentials entirely (FR-008). The
  env lookup happens at most once per server instance and the token value never enters any
  response, error, redirect, log, or cookie.
- **Rationale**: Token covers API/machine/proxy-header injection; the HMAC cookie covers
  human browser navigation (which cannot set `Authorization`), while remaining serverless-
  safe: zero session storage, verifiable by any instance holding the token, invalidated by
  expiry or token rotation. Constant-time compare + HKDF derivation are `node:crypto` only.
- **Alternatives considered**: (a) session store in memory — rejected, long-lived
  in-process state must stay optional (FR-006/SC-004); (b) token via query parameter —
  rejected, URL values leak through referrer/access logs/browser history; (c) delegating
  auth entirely to a reverse proxy — rejected as the only mechanism, FR-008 makes the
  component itself responsible for the private default; operators may still layer a proxy.

## R6. Optional server-side cache (TTL, non-authoritative, serverless-safe)

- **Decision**: In-process `Map<taskUuid, { builtAtMs, view }>` keyed by task UUID; on hit
  with `clock.elapsed(builtAtIso) < cacheTtlSeconds * 1000` serve the cached reconstruction
  (headers `X-History-Cache: hit`, `X-History-Age-Ms`); otherwise re-walk and store
  (`X-History-Cache: miss`). `cacheTtlSeconds` default 10, range 0–3600; **0 disables the
  cache entirely** (every request walks). Concurrent misses for the same task coalesce via
  a single-flight `Map<taskUuid, Promise>` (cache-stampede mitigation); failed reconstructions
  are never cached, and a **stale entry is never served on error** — the error surfaces per
  R7 ("never serves stale data as authoritative", spec edge case). No `Map` entry outlives
  its TTL by design; nothing is persisted, so a cold instance is indistinguishable from a
  warm one minus cache hits.
- **Rationale**: The spec pins cache semantics (serve cached until TTL, then re-read;
  optional; non-authoritative). All timing decisions go through the injected `Clock`, so
  TTL math is unit-testable with `fixedClock` with zero wall-clock flake.
- **Alternatives considered**: (a) HTTP `Cache-Control` public caching instead of a
  server cache — rejected, responses are `no-store` (sensitive operational detail; private
  mode), and FR-006 asks for a server-side cache; (b) LRU size-capping — deferred, chain
  counts are bounded per task and TTL eviction is sufficient; documented as a tuning knob
  if a pathological fan-out appears; (c) stale-while-revalidate — rejected for the same
  reason as stale-on-error: the view must not pretend a stale chain is current.

## R7. Failure mapping and leak-proofing

- **Decision**: Closed status vocabulary — `200` (view), `303` (session bootstrap),
  `401`/`403` (auth, zero history), `404` (route/identity not-found, zero history),
  `429` (port `TrackerError` category `rate-limit` after the port's own retry posture —
  including `Retry-After` when the error carries a status-derived hint), `502` (all other
  ultimate port failures: `server`/`network`/`timeout`/`auth`/`graphql`/`client` — and
  chain integrity errors), `500` (unexpected internal). Bodies are rendered from **fixed
  sanitized strings + machine codes** (`NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`,
  `RATE_LIMITED`, `TRACKER_UNAVAILABLE`, `INTERNAL`) per content type — the port error's
  `detail` is NEVER forwarded to the browser (hostile-server echo posture per the
  credential-sentinel precedent). Every body additionally passes the screener + HTML
  escaping (defense in depth). All responses carry `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, and
  `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src
  'unsafe-inline'`. Leak-proofing is asserted two ways: by construction (history rendering
  and error rendering are disjoint code paths) and by byte-counting tests that fail on any
  non-error-shaped byte in 401/403/404 bodies plus a sentinel sweep across the corpus.
- **Rationale**: FR-007/SC-003 demand errors that name no credential and reveal no
  history; fixed-string rendering makes that provable. Reusing the port's resilience
  posture (no 011-side retries) keeps constitution V honest.
- **Alternatives considered**: (a) forwarding `TrackerError.detail` — rejected, the
  sentinel sweep exists precisely because server-side text can echo hostile content;
  (b) `503` instead of `502` for upstream failure — kept `502` as the more accurate
  bad-upstream signal, with `429` distinguished because it is retry-tunable by clients.

## R8. Node 20 compatibility

- **Decision**: APIs used — `node:http.createServer`/`req`/`res` basics,
  `res.writeHead`/`write`/`end`, `crypto.createHmac`, `crypto.hkdfSync`,
  `crypto.timingSafeEqual`, `crypto.createHash('sha256')`, `buffer.Buffer` helpers,
  `AbortController`, `setTimeout`/`clearInterval` (SSE cadence via `setInterval`, cleared
  on close). All present in Node 20 LTS. Explicitly avoided: `crypto.hash` (21+),
  `fs.globSync`, `Response`-based handlers, any `--experimental` flag. CI matrix 20.x/24.x
  exercises the full suite unchanged.
- **Rationale**: Hard requirement from the wave briefing / CI matrix.
- **Alternatives considered**: using `crypto.hash` for the page-record hash-free design —
  moot; only HMAC/sha256 update-style hashing is needed.

## R9. Hygiene contract scans (provability of the stateless posture)

- **Decision**: `tests/contract/history-hygiene.test.ts` — a source scan over
  `src/history-server/**/*.ts` mirroring the `engine-no-direct-tracker.test.ts` /
  `cli-hygiene.test.ts` posture, asserting: (1) ZERO `node:fs` / `node:fs/promises`
  imports (⇒ the component cannot read the manifest, state directory, or checkpoints, and
  cannot write files — FR-004/SC-004 proven at the import level); (2) ZERO `../state/`
  imports and ZERO occurrences of `StateStore`, `sync-state.json`, `manifest`,
  `last-run`, `checkpoint`, `keyProvider`, `manifestKey` identifiers; (3) inbound-only
  transport: `node:http` import allowed, `node:https|http2|net|tls|dns|dgram`, `fetch(`,
  `undici`, `WebSocket`, `XMLHttpRequest` banned; (4) no `tracker/internal|http` or
  `tracker/testing` reach-ins and no `task-linear-sync/*` package specifiers inside `src/`
  (relative-import convention); (5) zero credential-shaped literals (`lin_api_…`,
  `Authorization` VALUE literals, PEM blocks), zero non-placeholder UUIDs/hosts
  (distributed-defaults posture); (6) `process.env` appears in exactly one sanctioned file
  (the deps default in `create.ts`), everywhere else env is injected. Packaging: the
  existing `tracker-dependency-budget.test.ts` (zero runtime deps in `package.json`) stays
  the budget guard; a new `history-packaging.test.ts` proves the subpath resolves and
  surfaces `createSyncHistoryServer`.
- **Rationale**: The briefing mandates provability; import-level scans are cheap, CI-stable,
  and precedent-backed.
- **Alternatives considered**: runtime sandboxes / permission wrappers — rejected, no
  precedent in this repo and a framework burden; static scans match the established
  contract-test pattern.

## R10. Testing strategy and fixtures

- **Decision**: `tests/helpers/history-harness.ts` provides: (a) a **chain world builder**
  that seeds a `FakeWorldSeed` with one placeholder issue + page-0 canonical attachment
  (`SyncStatePayload` under the namespace key derived from `builtInDefaults` at runtime) +
  N continuation attachments (page records) with configurable `eventsPerPage` (SC-001
  corpus: page 0 + continuations 1–9 = 10 pages × 1000 events, timestamps interleaved
  across pages so naive page-order ≠ chronological order, every page-1000th event
  carrying a detectable marker description); (b) `withHistoryServer(overrides, fn)` booting
  a real `node:http` server on an **ephemeral port** with the fake port + `fixedClock` +
  injected env, yielding a fetch-ready base URL; (c) token/session fixtures (sentinel
  values only). Fixture worlds under `tests/fixtures/history/worlds/` follow the
  engine-world conventions (world.json + README, placeholder identifiers, synthetic UUIDs).
  Rate-limit eventual failure uses the fake's `scriptedFailures`
  (`http-429-retryAfter` with `maxRetries: 0` seed) so the port's retry exhaustion is
  exercised, not re-implemented. Serverless-shape run: cache TTL 0, handler invoked without
  `listen()`, filesystem already proven absent by the hygiene scan — full-function
  assertions on two sequential handler invocations (SC-004).
- **Rationale**: Real `node:http` + ephemeral ports test the actual contract (headers,
  status codes, SSE framing, streaming) without any network outside localhost; the fake
  port's multi-page attachment support (`getAttachmentByUrl` over seeded URLs + scripted
  failures) already covers everything the chain walk needs — verified against
  `tests/integration/tracker-chain-walk.test.ts` and the engine `history-rollover` world,
  which seed exactly this shape.
- **Alternatives considered**: (a) injecting a fake req/res pair instead of real HTTP —
  rejected as primary, framing/backpressure/close semantics would go untested (kept only
  for the serverless-shape handler test, where it is the point); (b) recording real-world
  SSE transcripts — rejected, `node:http` is both sides of our test surface.

## Resolved spec-advisory items (no NEEDS CLARIFICATION remains)

| Item | Resolution | Where |
|---|---|---|
| Token vs session mechanism (spec Assumption) | Both: bearer token (primary, machine/API) + stateless HMAC cookie session (browser), token server-side only | R5 |
| "Host supports long-lived responses" detection | Operationalized client-side: SSE attempt via fetch streaming; failure ⇒ periodic refresh | R4 |
| Continuation-page routes (`.../<uuid>/<n>`) requested directly | Served the same whole-chain view (path matches the configured continuation template, tool + UUID rules pass, identity known ⇒ not a not-found case); the canonical page remains the only view the writer records | R2/R3 |
| Stale cache on upstream failure | Never served; error surfaces sanitized | R6/R7 |
| Cache stampede | Single-flight coalescing + port resilience posture | R6 |
