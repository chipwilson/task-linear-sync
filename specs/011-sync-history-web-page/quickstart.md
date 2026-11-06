# Quickstart: Sync-History Web Component (011)

Validation guide for `src/history-server/` — runnable scenarios proving FR-001…FR-008 and
SC-001…SC-004. Details live in [contracts/](./contracts/README.md) and
[data-model.md](./data-model.md); this file only shows how to run and what to expect.

## Prerequisites

- Node.js ≥ 20 (CI matrix 20.x / 24.x), repo root, `npm ci`.
- Zero extra services: every scenario runs against the 007 fake `LinearPort` — zero real
  network, zero real credentials, placeholder identifiers only (Principle III/VI).

## Build + test the feature

```bash
npm run build && npm run compile:tests          # compile src + tests
node scripts/run-tests.mjs --tier unit --test-name-pattern history-
node scripts/run-tests.mjs --tier contract --test-name-pattern history-
node scripts/run-tests.mjs --tier integration --test-name-pattern history-
node scripts/run-tests.mjs --tier e2e --test-name-pattern history-
npm test                                        # full suite green incl. coverage gate
```

Harness: `tests/helpers/history-harness.ts` — `buildChainWorld({ pages, eventsPerPage })`
seeds a placeholder issue + page-0 canonical attachment + continuation page records
(namespace key derived from `builtInDefaults`, synthetic UUIDs);
`withHistoryServer(overrides, fn)` boots a REAL `node:http` server on an ephemeral port
with the fake port, a `fixedClock`, and an injected token env.

## Scenario 1 — US1: open the recorded URL, see the whole story (SC-001, SC-002)

Boot with defaults against the `ten-page-chain` world (page 0 + continuations 1–9,
1000 events each, timestamps interleaved across pages).

| Check | Expect |
|---|---|
| `GET <base-host-derived path /toolId/uuid>` (HTML) | `200`; full chronological list; human-readable `YYYY-MM-DD HH:MM:SS UTC` timestamps; a `rollback` row styled like every other row; inline refresh script present |
| `GET` same path, `Accept: application/json` | `200`; every page-1000th marker event present EXACTLY ONCE; `at` non-decreasing across the whole merged view (exact chronological order) |
| `GET …/toolId/uuid/3` (continuation route) | `200`; same whole-chain view |
| Malformed corpus: template mismatch, wrong tool segment, non-UUID, uuid `/0`, unknown identity | `404` each; response body contains ZERO history bytes (byte-counting assertion) — SC-002 100% |
| Fake-port call log | only `getAttachmentByUrl` entries; zero mutation members |

`node scripts/run-tests.mjs --tier integration --test-name-pattern history-us1`

## Scenario 2 — US1: tiered transport (FR-005)

| Check | Expect |
|---|---|
| `GET` with `Accept: text/event-stream` | immediate `event: history` frame; advance `fixedClock` past `refreshSeconds` and land a new event in the fake world ⇒ next frame carries it; unchanged ticks emit `: ping` only; client abort stops the server loop |
| JSON route (polling payload) | available on the same path; HTML shell embeds `refreshSeconds` (default 15) and the fallback script polls it |
| Config overrides | `web.pollIntervalSeconds` honored at 1 and 3600; `0` / `3601` ⇒ construction refusal listing the violated bounds; `web.realtimeSse: false` ⇒ SSE-accepting requests get the HTML/JSON posture |

`… --tier integration --test-name-pattern history-sse`

## Scenario 3 — US2: private by default, leak-free (FR-008, SC-003)

Private mode (default), token env seeded with a sentinel value.

| Check | Expect |
|---|---|
| `GET` with no credential | `401` + `WWW-Authenticate: Bearer`; zero history bytes; tracker NOT probed (auth precedes reconstruction — call-log assertion); HTML shell shows only the token form |
| `GET` with wrong token / tampered or expired cookie | `403`; zero history bytes |
| `POST` form with correct token | `303` + `Set-Cookie` whose value contains no token substring; subsequent cookie `GET` ⇒ `200` full view |
| Bearer `GET` | `200` full view |
| Public opt-in (`web.accessControlMode: "public"`) | `GET` with no credential ⇒ `200` |
| Sentinel sweep (contract tier) | across the whole status × content-type corpus: the token sentinel appears in zero response bytes (precedent: `tracker-credential-sentinel.test.ts`) |

`… --tier integration --test-name-pattern history-auth` and
`… --tier contract --test-name-pattern history-credential-sentinel`

## Scenario 4 — US2: caching semantics (FR-006)

With `fixedClock`:

| Check | Expect |
|---|---|
| TTL default 10 s: two `GET`s 4 s apart | 2nd from cache; fake-port `getAttachmentByUrl` count identical after the 2nd request; `X-History-Cache: hit` |
| Advance clock 11 s, `GET` | chain re-read (count grows); `miss` |
| `cacheTtlSeconds: 0` | every request re-reads; no hit headers |
| Concurrent misses (parallel `Promise.all` of 5 `GET`s) | exactly one chain walk (single-flight) |

`… --tier integration --test-name-pattern history-cache`

## Scenario 5 — US2: serverless shape + rate-limit posture (FR-004/006/007, SC-004)

| Check | Expect |
|---|---|
| Serverless-shape run: `cacheTtlSeconds: 0`, NO `listen()` — invoke `app.handle` directly with stub req/res, twice | full history both times; no fs access anywhere (hygiene scan proves it structurally); no persistent state between invocations beyond TTL entries (none exist at ttl 0) |
| `rate-limit-exhaustion` world (`scriptedFailures: http-429-retryAfter`, `maxRetries: 0`) | `429` + `RATE_LIMITED`; body names no credential, zero history bytes |
| `network`-failure world | `502` + `TRACKER_UNAVAILABLE`; same leak rules; port `detail` never forwarded |
| `no-canonical` world (deleted/archived edge case) | `404`, zero history bytes |

`… --tier integration --test-name-pattern history-serverless-shape|history-rate-limit`

## Scenario 6 — Hygiene + packaging proofs (contract tier)

- `history-hygiene` — `src/history-server/**` source scan: zero `node:fs`, zero
  state-dir/manifest/checkpoint identifiers, inbound-only transport, no tracker internals
  or fake imports, single `process.env` site, zero credential-shaped literals
  (component-api.md §3).
- `history-route-conformance` — paths from the frozen `canonicalAttachmentUrl` /
  `continuationAttachmentUrl` builders (default AND overridden templates) route exactly;
  near-miss corpora 404.
- `history-packaging` — `task-linear-sync/history-server` resolves via exports and surfaces
  `createSyncHistoryServer`; the dependency-budget test stays green with zero additions.

`… --tier contract --test-name-pattern history-`

## Traceability

| Requirement | Automated evidence |
|---|---|
| FR-001 routing from template | unit `history-route`; contract `history-route-conformance`; integration `history-us1` |
| FR-002 not-found rules | unit `history-route`; integration `history-us1` (404 matrix, byte counts); e2e `history-user-stories` |
| FR-003 live reconstruction | unit `history-reconstruct`/`history-render`; integration `history-us1` (SC-001 corpus) |
| FR-004 zero manifest/state/checkpoints | contract `history-hygiene`; integration `history-serverless-shape` |
| FR-005 tiered transport | unit `history-options` (bounds); integration `history-sse`; e2e US1 |
| FR-006 cache + optional infra | unit `history-cache` (TTL math, fixedClock); integration `history-cache`; integration `history-serverless-shape` (SC-004) |
| FR-007 rate-limit failure | integration `history-rate-limit`; contract `history-credential-sentinel` |
| FR-008 private default + screening | unit `history-auth`/`history-screening`; integration `history-auth`; contract `history-credential-sentinel` (SC-003) |
| SC-001 | integration `history-us1` (10-page corpus) |
| SC-002 | integration `history-us1` + `history-auth` (malformed matrix) |
| SC-003 | integration `history-auth` + contract `history-credential-sentinel` |
| SC-004 | integration `history-serverless-shape` + contract `history-hygiene` |
