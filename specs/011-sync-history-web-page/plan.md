# Implementation Plan: Sync-History Web Component

**Branch**: `011-sync-history-web-page` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-sync-history-web-page/spec.md`

## Summary

This Wave-4 feature ships the constitution's `Sync_History_Server`: an optional, strictly
stateless HTTP component that serves exactly the URL scheme the engine records on
attachments (`<base-host>/<toolId>/<task-uuid>`, frozen 002 scheme), so anyone with access
opens a task's complete, ordered, security-screened sync history **live reconstructed**
from the page-0 canonical attachment and every deterministic continuation page — via the
injected `Linear_Port` only, with no separate history datastore anywhere. Headline plan
decision: **zero new runtime dependencies and zero edits to any frozen or other-wave
module** — the component is a new disjoint `src/history-server/` module group behind one
additive `./history-server` subpath export, importing only Node built-ins (`node:http` +
`node:crypto` exclusively) plus `src/{domain,config,urls,gates,ports,tracker,engine}` for
frozen types, 008's `parseHistoryPageRecord` / `historyPageAddress` page-record module, and
the default screener (research
R1). Route parsing is delegated to the frozen `parseAttachmentUrl` against the configured
templates (research R2); history reconstruction reuses the 007 URL-addressed walk semantics
(minimal serving variant, no orphan probes) and the frozen
`SyncStatePayload` / continuation-page-record shapes, concatenated ascending and sorted
chronologically with human-readable timestamps, rollback events rendered like any other
(research R3). Transport is tiered — SSE push selected by `Accept: text/event-stream` on
the same route where the host supports long-lived responses, always with periodic-refresh
fallback (default 15 s, range 1–3600 s) — and an optional in-memory, clock-injected,
non-authoritative cache TTL (default 10 s; 0 disables) (research R4/R6). Access defaults to
private with a server-side-only bearer token plus an optional stateless HMAC cookie
session; public read-by-URL is explicit opt-in (research R5). The stateless posture — zero
filesystem access, zero state-dir/manifest/checkpoint reads, zero encryption keys — is
proven by contract-tier source scans mirroring `engine-no-direct-tracker.test.ts`, and an
e2e serverless-shape fixture (caching, filesystem, long-lived process all disabled) still
serves the full 10-page chain per SC-001 (research R9/R10).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per
exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). No toolchain changes. All Node APIs used exist in Node 20 LTS:
`node:http` `createServer`, `node:crypto` `createHmac`/`timingSafeEqual`/`createHash`
(no `crypto.hash`, no `--experimental` flags — research R8).

**Primary Dependencies**: **None added at runtime** — explicit plan decision (research R1),
continuing the 002/007/008/010 posture. The component imports Node built-ins (`node:http`
for the server listener, `node:crypto` for constant-time compare and the stateless session
HMAC — nothing else) plus local modules: `src/domain` (frozen `SyncHistoryEvent` shapes),
`src/config` (frozen `ResolvedConfig` types + `envVarPrefixFor`), `src/urls` (frozen
`parseAttachmentUrl`), `src/gates` (frozen vocabulary, unused for gating — this surface has
no apply path), `src/ports` (`LinearPort`, `SecurityScreener` types), `src/tracker`
(`attachmentUrlConfigFrom`, `TrackerError` taxonomy), and
`src/engine` (`createDefaultSecurityScreener` as the default screener; `parseHistoryPageRecord`
+ `historyPageAddress` from `history-page.ts` for continuation-page parsing/addressing).
The MCP SDK
remains 012's separately scoped concern.

**Storage**: **None.** The component reads and writes zero files, opens no database, and
keeps no authoritative state (FR-004, SC-004): the sole permitted process state is an
optional in-memory, TTL-bounded, non-authoritative reconstruction cache (default 10 s) that
is safe to lose at any instant. It MUST NOT read the local audit manifest, state directory,
checkpoints, or the manifest encryption key — enforced by a contract-tier source scan
forbidding `node:fs`/`node:fs/promises` imports and any `src/state` reach-in inside
`src/history-server/**` (research R9). The tracker attachment chain is the single source of
truth.

**Testing**: `node:test` + `node:assert/strict`, existing tiers (`unit`, `contract`,
`integration`, `e2e`) via `scripts/run-tests.mjs`; tests boot a **real `node:http` server
on ephemeral ports** against the 007 fake `LinearPort` (`./tracker/testing`) seeded with
multi-page chain fixtures — zero real network to a tracker, zero real credentials, all
timing decisions behind the injected `Clock` (constitution VI). Delivered cross-cutting
types (Principle VI): **contract** (route conformance against 002's frozen builders,
hygiene scans, packaging/dependency budget, credential sentinel sweep), **security**
(401/403/404 leak scans with response-byte counting; re-screening posture; sentinel-free
corpus), and a thin **e2e** user-story layer incl. the serverless-shape run (research R10).

**Target Platform**: Node.js ≥ 20 HTTP host — long-lived server, serverless function, edge,
or shared host; consumed as `task-linear-sync/history-server` by deployers (constitution
names this surface `Sync_History_Server`). The deployable unit is an exported
`(req, res)` handler plus an optional `listen()` convenience, so no long-lived process is
required (FR-006, SC-004).

**Project Type**: Single npm package (existing); this feature owns the disjoint
`src/history-server/` module group and its tests/fixtures. No frozen 002 module and no
Wave-2/3 module is edited (ROADMAP rule 2); 011 imports them.

**Performance Goals**: Full chain reconstruction (≤ 10 pages per
SC-001; hard bound 1000 pages via a local walk constant mirroring 007, no orphan-probe reads) per request, sub-second against the fake;
cache TTL collapses repeat reads to zero port calls within the window; SSE cadence and
polling fallback both driven by `refreshSeconds`; HTML rendering is O(events) string
composition — ~10k events (the SC-001 10-page corpus) render without streaming machinery.

**Constraints**: Zero new runtime dependencies (R1); Node 20 APIs only (R8); read-only
surface — zero tracker mutations ever (constitution I; asserted from the fake-port call
log); every browser-visible string passes the `SecurityScreener` re-screen + HTML escaping
(FR-008); token/credential values never appear in any response, error body, log line, or
redirect (constitution "Credential handling" — Web transports keep credentials
server-side); 401/403/404/429/5xx bodies carry zero history bytes by construction
(research R7); the component never reimplements gating, locking, or screening logic —
re-screening uses the frozen screener contract (constitution V); distributed defaults
carry zero real organization identifiers (Principle III).

**Scale/Scope**: 8 FRs (001 FR-082…089), 4 SCs, 2 user stories; ~11 source modules behind
one subpath export; 1 route table × 4 not-found rules; 5 status codes × 3 content types
(HTTP surface matrix); one 10-page × 1000-event chain fixture (SC-001) + auth/cache/
rate-limit/serverless fixture worlds; ~40 tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Read-only surface: zero tracker mutations (only `getAttachmentByUrl` via the serving page-walk — asserted from the fake-port call log), zero repository/state-directory file access (`node:fs` banned inside `src/history-server/**` by contract scan — the component cannot write anything it cannot open). Every browser-visible string passes the injected `SecurityScreener` first; a blocked finding ships only the `[blocked:<category>]` sentinel output, never the source text. No apply/gate path is reachable from this surface. | PASS |
| II. Durable Identity | Routes are parsed exclusively through the frozen `parseAttachmentUrl` under the configured scheme — the canonical page-0 URL remains the sole identity anchor; the component never rewrites, moves, or duplicates an attachment and never searches descriptions. Unknown identity ⇒ 404 with zero history bytes (FR-002). | PASS |
| III. Intelligent Defaults, Overridable Configuration | Zero new config keys: the surface reads the **existing frozen 001 `web` surface group** (`ResolvedConfig.web` — `accessControlMode` default `"private"`, `realtimeSse` default `true`, `pollIntervalSeconds` default 15, `cacheTtlSeconds` default 10, `authEnvVarName` toolId-derived `<PREFIX>_WEB_TOKEN`), whose built-in defaults are exactly the spec's advised values; 011 adds surface-side startup range guards (`refreshSeconds` 1–3600, `cacheTtlSeconds` 0–3600, queue-group validation posture) because the frozen schema bounds no ranges, and keeps schema-less values (session lifetime, cadences, queue caps) as module constants. Zero organization identifiers/tokens/UUIDs in defaults, docs, or fixtures; the fixture harness derives the metadata namespace key from `builtInDefaults` at runtime. | PASS |
| IV. Determinism and Idempotency | All time math (cache TTL, session expiry, SSE cadence) runs on the injected `Clock`; rendering is a pure function of the chain state + config (stable-key JSON, byte-identical for identical chain state); the append-only log is never touched — reading is inert (Principle IV: entries are neither modified nor reordered in storage; chronological presentation is a view-level stable sort by `at`). | PASS |
| V. One Engine, Additive Surfaces | Strictly additive surface, constitution-named (`Sync_History_Server`): consumes the frozen 002 contracts and 007 read operations, never the engine internals; no gating, locking, journaling, or screening logic is re-implemented — the engine imports are
the frozen `createDefaultSecurityScreener` and the exported `history-page.ts` record
parser/addresser. All Linear access flows through the injected `Linear_Port` (hygiene scan forbids transport reach-arounds; the only `node:http` use is the inbound server listener, never outbound clients). | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR/SC maps to ≥1 automated test (quickstart traceability table). Pyramid: unit (route parsing, chain concat/chronology, cache TTL math under `fixedClock`, screening/re-screening posture, error sanitization) → contract (URL-template conformance vs the frozen builders, hygiene + zero-fs/zero-frozen-reads scans, credential sentinel sweep, packaging) → integration (real `node:http` on ephemeral ports against the fake with multi-page chain fixtures; SSE + polling fallback; leak scans with byte counting; rate-limit eventual-failure) → thin e2e (US1/US2 walkthroughs + serverless-shape). Tests written first, red before their implementation tasks. | PASS |
| Additional constraints | *Port/adapter*: injected `LinearPort` only; tests use the fake. *Credential handling*: token read server-side from the configured env-var name; never transmitted to clients, never in error bodies; constant-time comparison; cookie sessions carry only an HMAC tag derived from the token, never the token. *Resilience*: rate-limit/backoff/Retry-After posture is the port's, untouched — the component adds no retry loop and maps ultimate failure to a screened, history-free error (FR-007). *Technology stack*: zero runtime deps; one additive `exports` entry; Node ≥ 20. *No organization-specific literals*: fixtures use synthetic UUIDs + placeholder keys. | PASS |
| Development workflow / quality gates | No pipeline or tooling changes: existing tiers + coverage gate run the new files. Documentation duty (same change): `docs/history-server.md` (usage scenario, config keys, deployment shapes incl. serverless, security posture) + README status/export table update, placeholder identifiers only. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/011-sync-history-web-page/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 011-local interfaces only
│   ├── http-surface.md          # routes, status codes, content negotiation, SSE frames
│   ├── access-control.md        # token/session mechanics, leak rules
│   ├── history-reconstruction.md# read-side chain walk + merge + rendering rules
│   └── component-api.md         # createSyncHistoryServer(deps) + `web`-group settings view
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # + one exports entry "./history-server" (additive; deps unchanged)

src/
├── domain/ config/ state/ urls/ gates/ ports/       # FROZEN (002) — imported, never edited
├── tracker/                                          # 007 — chain walk + URL config, imported
├── engine/                                           # 008 — only createDefaultSecurityScreener
└── history-server/                      # ← 011's disjoint module group
    ├── index.ts                       # public surface for the ./history-server subpath
    ├── create.ts                      # composition root: createSyncHistoryServer(deps) → handler
    ├── options.ts                     # validated view of the frozen `web` group + startup range guards
    ├── routes.ts                      # req.url → RouteMatch via frozen parseAttachmentUrl
    ├── reconstruct.ts                 # serving page-walk → payload/page-record parse → ascending concat
    │                                  #   → chronological merge → HistoryPageView
    ├── render.ts                      # HTML shell (+ upgrade script), JSON body, error envelope
    ├── screen.ts                      # re-screen + HTML-escape every browser-visible string
    ├── sse.ts                         # text/event-stream writer (injected-clock cadence)
    ├── auth.ts                        # private/public modes, bearer token, stateless HMAC session
    ├── cache.ts                       # optional TTL cache + single-flight coalescing
    ├── serve.ts                       # node:http listener helper (optional; handler is the unit)
    └── errors.ts                      # port-error → HTTP status mapping, sanitized envelope codes

tests/
├── unit/                            # history-options / history-route / history-reconstruct /
│   │                                #   history-render / history-screening / history-cache /
│   │                                #   history-auth
├── contract/                        # history-route-conformance (002 builder round-trip),
│   │                                #   history-hygiene (zero-fs / zero-frozen-reads / no-outbound),
│   │                                #   history-credential-sentinel, history-packaging
├── integration/                     # history-us1 (10-page chain, SC-001), history-sse,
│   │                                #   history-cache (call-count cache-then-reread), history-auth
│   │                                #   (401/403 leak byte-counting), history-rate-limit,
│   │                                #   history-serverless-shape (SC-004)
├── e2e/                             # history-user-stories (US1 open-the-URL + US2 private/portable)
├── helpers/history-harness.ts       # fake-world chain builder (N pages × M events), ephemeral-port
│   │                                #   server boot, fetch helpers, fixed clock, token fixtures
└── fixtures/history/
    ├── README.md                    # fixture conventions (placeholders only, synthetic UUIDs)
    └── worlds/                      # ten-page-chain/, gap-stops-walk/, integrity-mismatch/,
                                     #   secret-shape/, rate-limit-exhaustion/, no-canonical/
```

**Structure Decision**: Single npm package (constitution "Technology stack"), continuing
the 007/008/009/010 disjoint-module precedent with the new `src/history-server/` group
behind one additive subpath export. 011 touches only `src/history-server/**`,
`tests/**/history-*` + `tests/fixtures/history/**`, `tests/helpers/history-harness.ts`, one
additive `package.json` exports entry, `docs/history-server.md`, the README status lines,
and its own `specs/011-sync-history-web-page/**`. All frozen 002 modules and all Wave-2/3
modules (003–008) are imported through their declared module surfaces, never edited
(ROADMAP rule 2). The component depends on NOTHING above it except the frozen contracts and
the tracker read path — it is the strongest parallel-development candidate in Wave 4 and
stays independent of the queue (010), MCP (012), and CI (013) module groups.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) a session table / in-memory login store — rejected in favor of the
stateless HMAC cookie (long-lived in-process state must stay optional, FR-006/SC-004);
(2) a templating engine or client framework for the page — rejected, server-rendered HTML
plus a small inline vanilla-JS upgrade script keeps zero dependencies and works with JS
disabled; (3) a WebSocket/SSE-ticket handshake — rejected, the bundled page consumes SSE via
`fetch` streaming, which carries the `Authorization` header natively (research R4/R5).

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design adds no runtime dependency, edits no frozen 002
module or contract (routes and reconstruction consume the frozen parser, payload, page
record, port, and screener verbatim), reaches no state directory, manifest, or checkpoint
(`node:fs` is banned inside the module group by contract scan — the stateless posture of
FR-004/SC-004 is proven at the import level), implements no parallel gating/locking path
(this surface is read-only), and the constitution-mandated contract/security test tiers
plus per-FR/SC traceability are specified in quickstart.md. No Complexity Tracking entries
were created by the design.
