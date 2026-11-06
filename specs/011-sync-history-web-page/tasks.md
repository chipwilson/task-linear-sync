---

description: "Task list for feature 011 — Sync-History Web Component"

---

# Tasks: Sync-History Web Component

**Input**: Design documents from `specs/011-sync-history-web-page/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R10), data-model.md, contracts/ (http-surface, access-control, history-reconstruction, component-api), quickstart.md

**Tests**: INCLUDED — constitution VI (Test-First, NON-NEGOTIABLE) and plan.md mandate automated coverage for every FR/SC, including contract and security tiers. Story-phase tests are written FIRST and must FAIL before their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = open the recorded URL, see the whole story (P1); US2 = private by default, portable everywhere (P2)
- All frozen 002 modules and Wave-2/3 modules (003–008) are **import-only** — never edit them (ROADMAP rule 2). 011 touches only `src/history-server/**`, `tests/**/history-*`, `tests/helpers/history-harness.ts`, `tests/fixtures/history/**`, one additive `package.json` exports entry, `docs/history-server.md`, README status lines, and this specs folder.
- Zero new runtime dependencies: `node:http` + `node:crypto` are the only Node built-ins the module group may lean on for behavior (research R1/R8); Node 20 APIs only (no `crypto.hash`, no `fs.globSync`, no experimental flags).
- All paths are repository-root-relative.

## Path Conventions

Single npm package: `src/history-server/` (011's disjoint module group), `tests/{unit,contract,integration,e2e}/`, `tests/fixtures/history/worlds/`. Tests run via `node scripts/run-tests.mjs` tiers (`unit`, `contract`, `integration`, `e2e`) with `node:test` + `node:assert/strict`, the 007 fake `LinearPort` (imported from `task-linear-sync/tracker/testing`), a real `node:http` server on an **ephemeral port**, and a `fixedClock` — zero network beyond localhost, zero real credentials. Fixture worlds use synthetic UUIDs + placeholder identifiers only (the distributed-defaults scan fails real org ids/tokens/UUID-looking literals).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Packaging surface and test scaffolding for the history-server module group

- [X] T001 Add one additive `"./history-server"` subpath export to `package.json` (types `./dist/history-server/index.d.ts`, default `./dist/history-server/index.js`) — zero dependency changes, zero other manifest edits (research R1, contracts/component-api.md §5)
- [X] T002 [P] Create `tests/fixtures/history/README.md` (fixture conventions: placeholders only, synthetic UUIDs via `syntheticUuid`, namespace key derived from `builtInDefaults` at runtime — zero real organization identifiers/team keys/tokens) and the world directories `tests/fixtures/history/worlds/ten-page-chain/`, `gap-stops-walk/`, `integrity-mismatch/`, `no-canonical/`, `secret-shape/`, `rate-limit-exhaustion/`
- [X] T003 Create `tests/helpers/history-harness.ts`: `buildChainWorld({ taskUuid, pages, eventsPerPage, interleave })` seeding a `FakeWorldSeed` with one placeholder issue + page-0 canonical attachment (payload via frozen `serializeSyncStatePayload`) + continuation attachments carrying page records serialized with the 008 `serializeHistoryPageRecord` (`{ taskUuid, page, history }` under `metadataNamespaceKey`) at `continuationAttachmentUrl` URLs; `withHistoryServer(overrides, fn)` booting a real `node:http` server on an ephemeral port with the fake port, a `fixedClock`, injected `env` (sentinel token only), and `web`-group overrides (e.g. `accessControlMode: "public"`); fetch helpers with content-type negotiation (per quickstart.md)

**Checkpoint**: Packaging entry + harness skeleton exist (harness types against `createSyncHistoryServer` so it compiles before `src/history-server` exists)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives both stories depend on: config-group validation, error taxonomy, route parsing from the frozen scheme, composition-root skeleton

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail)

- [X] T004 [P] Write unit tests for settings resolution in `tests/unit/history-options.test.ts` (contracts/component-api.md §2, data-model §4): `resolveHistoryServerConfig` reads the FROZEN 001 `web` group — with `builtInDefaults` it yields `accessMode: "private"`, `sseEnabled: true`, `refreshSeconds: 15`, `cacheTtlSeconds: 10`, `tokenEnvVarName` = `web.authEnvVarName` (`${envVarPrefixFor(toolId)}_WEB_TOKEN`); construction-time range guards — `web.pollIntervalSeconds` "integer in 1..3600", `web.cacheTtlSeconds` "integer in 0..3600" (0 disables), out-of-range overrides fail with ALL problems listed one dotted-key line each (complete listing, never fail-fast-on-first); the resolver is a pure read of `ResolvedConfig` (never mutated, no new config keys)
- [X] T005 [P] Write unit tests for route parsing in `tests/unit/history-route.test.ts` (FR-001/FR-002, contracts/http-surface.md §1, research R2): query/fragment stripped before matching; base host + path rebuilt and parsed via the frozen `parseAttachmentUrl`; canonical and continuation kinds accepted; 404 outcomes for template mismatch, tool-segment mismatch, non-lowercase-UUID identifier, `/<uuid>/0` page-0 segment, empty path; request `Host` header never consulted; a parser throw maps to 500 posture, never a silent accept
- [X] T006 [P] Write contract test `tests/contract/history-route-conformance.test.ts` (002 URL-scheme conformance): every path produced by `canonicalAttachmentUrl`/`continuationAttachmentUrl` under the DEFAULT config and under overridden `attachmentUrlTemplate`/`continuationUrlTemplate` values routes to its `(kind, taskUuid[, page])`; near-miss corpora (wrong prefix, upper-case UUID, extra segment, page 0) all 404 — router and builders round-trip identically (behavior rule 4 of attachment-url-scheme.md)

### Implementation for Foundational

- [X] T007 Implement the error taxonomy in `src/history-server/errors.ts`: `HistoryServerConfigError` (construction-time refusal naming config keys / env-var NAMES only, never values); the closed browser code set `NOT_FOUND`→404, `UNAUTHORIZED`→401, `FORBIDDEN`→403, `RATE_LIMITED`→429, `TRACKER_UNAVAILABLE`→502, `INTERNAL`→500 with FIXED sanitized message constants (research R7; port `detail` never referenced from these)
- [X] T008 Implement `resolveHistoryServerConfig` + `ResolvedHistoryServerSettings` in `src/history-server/options.ts` following the `src/queue/config.ts` precedent (makes T004 pass)
- [X] T009 Implement `parseHistoryRoute(config, reqUrl)` in `src/history-server/routes.ts` per data-model §1 — rebuild `cfg.attachmentBaseHost` (trimmed, trailing `/` dropped) + path, call the frozen `parseAttachmentUrl`, catch-and-classify, return `RouteMatch | notFound` (makes T005/T006 pass)
- [X] T010 Implement the composition-root skeleton `createSyncHistoryServer(deps)` in `src/history-server/create.ts` + the `src/history-server/index.ts` public surface + `src/history-server/serve.ts` (`listen()` convenience over `node:http.createServer(app.handle)`): construction-time fail-fast probes (config group; private mode with unset/empty token env var refuses naming the NAME only; URL scheme probed once via the frozen builders); `app.handle` returns 501 envelopes until later phases wire it; source imports restricted to Node built-ins + `src/{domain,config,urls,gates,ports,tracker,engine}` per research R1

**Checkpoint**: Foundation ready — config, errors, routing proven; user story implementation can now begin (US1 and US2 primitives are disjoint files)

---

## Phase 3: User Story 1 - Open the recorded URL, see the whole story (Priority: P1) 🎯 MVP

**Goal**: Full live reconstruction from the canonical attachment + continuation pages via the tracker port only; ascending concat + chronological merge; human-readable timestamps; rollback rendered like any other; HTML/JSON/SSE tiered transport with periodic-refresh fallback; not-found responses with zero history bytes.

**Independent Test**: Run `node scripts/run-tests.mjs --tier unit --test-name-pattern history-reconstruct|history-render|history-screening` plus `--tier integration --test-name-pattern history-us1|history-sse` (quickstart Scenarios 1–2, `web.accessControlMode: "public"` override): the 10-page × 1000-event chain renders every page-1000th event exactly once in exact chronological order; malformed corpus 100%-404; SSE streams updates on cadence and the JSON polling route serves the same view.

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T011 [P] [US1] Write unit tests for chain reconstruction in `tests/unit/history-reconstruct.test.ts` (FR-003, contracts/history-reconstruction.md §1–2): ascending page concat; stable chronological sort by `at` with ties keeping chain order (fixture interleaves timestamps across pages so page-order ≠ chronological); page-0 payload read via `parseSyncStatePayload`, continuation records via the 008 `parseHistoryPageRecord` under `metadataNamespaceKey`; integrity refusals (502, never partial) for page-record `taskUuid`/`page` mismatch, malformed JSON, non-array `history`, an existing-but-unparseable page attachment mid-chain; canonical probe `null` ⇒ not-found; empty history ⇒ valid empty view; walk stops at the first absent page — pages beyond a gap are never probed (`gap-stops-walk` world) and the hard bound at 1000 pages is a refusal, not a truncation; zero mutation members in the fake call log
- [ ] T012 [P] [US1] Write unit tests for rendering in `tests/unit/history-render.test.ts` (FR-003, contracts/http-surface.md §3): `atHuman = YYYY-MM-DD HH:MM:SS UTC` (no locale); JSON view stable key order and byte-identical for identical chain state; HTML escapes `& < > " '` in every string field; `kind: "rollback"` rows render with the identical shape as other kinds (no special section, no filtering); HTML shell embeds `refreshSeconds` + inline upgrade script; error envelopes render per negotiated type from constants only
- [ ] T013 [P] [US1] Write unit tests for the re-screening posture in `tests/unit/history-screening.test.ts` (FR-008, contracts/history-reconstruction.md §4): every event `description`/`references` string passes `screener.screen()` before view construction; a blocking finding ships only the `[blocked:<category>]` sentinel, never the source text; re-screening uses the injected screener (default `createDefaultSecurityScreener(config)` from `src/engine`); screening never fails a request
- [ ] T014 [P] [US1] Author fixture worlds under `tests/fixtures/history/worlds/`: `ten-page-chain/` (page 0 + continuations 1–9, 1000 events each, cross-page interleaved timestamps, every 1000th event a detectable marker description, at least one `rollback` event), `gap-stops-walk/` (pages 0–1 + an absent page 2 with a present page 3 — served view covers 0–1 only), `integrity-mismatch/` (a continuation record whose `taskUuid`/`page` contradicts its addressed URL), `no-canonical/`, `secret-shape/` (world.json + README, placeholders only; worlds too large for JSON hand-editing are generated by the T003 harness builder with the world directory holding README + seed parameters)
- [ ] T015 [P] [US1] Write integration test `tests/integration/history-us1.test.ts` (US1 AC1/AC2, SC-001, SC-002 — quickstart Scenario 1) over a REAL `node:http` server on an ephemeral port against the fake port (`web.accessControlMode: "public"` override): HTML `GET` at the recorded-URL path serves full chronological history with human-readable timestamps and rollback rows like any other; JSON `GET` proves every page-1000th marker present EXACTLY ONCE and `at` non-decreasing across the merged 10-page corpus; continuation route `.../<uuid>/3` serves the same whole-chain view; the 404 matrix (template mismatch, wrong tool segment, non-UUID, `/<uuid>/0`, unknown identity from `no-canonical` world) returns 404 with response byte-counts free of any history substring; fake call log contains only `getAttachmentByUrl`
- [ ] T016 [P] [US1] Write integration test `tests/integration/history-sse.test.ts` (US1 AC3, FR-005 — quickstart Scenario 2): `Accept: text/event-stream` yields an immediate `event: history` frame; advance the `fixedClock` past `refreshSeconds` and land a new event in the fake world ⇒ next frame contains it, unchanged ticks emit `: ping` only; client socket abort terminates the server loop (no further port calls); `Accept: application/json` polling route serves the same view; `refreshSeconds` honored at bounds 1 and 3600; invalid values refused at construction

### Implementation for User Story 1

- [ ] T017 [US1] Implement `walkHistoryChain` + `reconstructHistory` in `src/history-server/reconstruct.ts`: serving page-walk over the injected port (`historyPageAddress` URLs, stop at first absence, 1000-page hard bound as refusal, no orphan probes) + `parseSyncStatePayload` / 008 `parseHistoryPageRecord` parsing + ascending concat + stable chronological merge per contracts/history-reconstruction.md (makes T011 pass)
- [ ] T018 [P] [US1] Implement browser-text screening in `src/history-server/screen.ts`: screener pass + HTML-escape helpers used by every browser-visible string (makes T013 pass)
- [ ] T019 [P] [US1] Implement `renderView`/`renderError` in `src/history-server/render.ts`: HTML shell + inline upgrade script (fetch-stream SSE attempt → periodic JSON polling fallback at `refreshSeconds`), stable-key JSON, per-type error envelopes, security headers (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, the CSP from contracts/http-surface.md §5) (makes T012 pass)
- [ ] T020 [US1] Implement the SSE writer in `src/history-server/sse.ts`: flush headers immediately, `event: history` frames, changed-only emission on the injected-clock `refreshSeconds` cadence, `: ping` keepalive, stop on socket close, `event: error` before close on upstream failure
- [ ] T021 [US1] Wire the handler pipeline in `src/history-server/create.ts`: route → (access pass-through for now; auth gate lands in US2) → reconstruct → content negotiation (SSE/JSON/HTML) → respond; port/chain failures mapped to the T007 envelope codes; zero-history error path structurally separate from the view path (makes T015/T016 pass)

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently — the recorded URL opens the complete, ordered, screened history with push + fallback against the fake tracker.

---

## Phase 4: User Story 2 - Private by default, portable everywhere (Priority: P2)

**Goal**: Private-by-default access (server-side-only bearer token + stateless HMAC cookie session) with leak-free 401/403; public opt-in; optional non-authoritative cache TTL; serverless-shape full function; rate-limit ultimate-failure errors naming no credential and revealing no history.

**Independent Test**: Run `node scripts/run-tests.mjs --tier unit --test-name-pattern history-cache|history-auth` plus `--tier integration --test-name-pattern history-auth|history-cache|history-rate-limit|history-serverless-shape` and the contract-tier sentinel sweep (quickstart Scenarios 3–5): both access modes exercised with missing/invalid/valid credentials; cache-then-reread verified by fake-port call counts; the serverless-shape fixture (cache 0, no `listen()`) serves the full chain.

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T022 [P] [US2] Write unit tests for cache TTL math in `tests/unit/history-cache.test.ts` (FR-006, data-model §5, contracts/component-api.md §4) under `fixedClock`: hit while `elapsed < ttl`, miss at/after TTL; `cacheTtlSeconds: 0` stores nothing (every read misses); failed reconstructions never cached; stale never served on upstream error; single-flight coalesces concurrent misses for one `taskUuid` to one walk
- [ ] T023 [P] [US2] Write unit tests for access control in `tests/unit/history-auth.test.ts` (FR-008, contracts/access-control.md): missing credential ⇒ 401 decision + `WWW-Authenticate: Bearer`; invalid/expired ⇒ 403 (never a downgrade); bearer compare is `timingSafeEqual`-based; session cookie round-trip (`payload` = base64url expiry, `tag` = HMAC under `K = hkdfSync(sha256, ikm = token, salt = toolId, info = "history-session-v1")`) validates against the injected clock and the `SESSION_TTL_SECONDS` module constant (3600 s); tampered payload/tag and expired cookies rejected; the cookie value contains NO substring of the token; public mode ignores credentials entirely
- [ ] T024 [P] [US2] Write security contract test `tests/contract/history-credential-sentinel.test.ts` (SC-003, precedent `tests/contract/tracker-credential-sentinel.test.ts`): sentinel planted as the token env value AND echoed by a hostile fake-world description; across the full corpus (401/403/404/429/502/500 × HTML/JSON/SSE × private/public) ZERO response bytes contain the sentinel, and blocked-shipment descriptions appear only as `[blocked:<category>]` sentinels
- [ ] T025 [P] [US2] Write integration test `tests/integration/history-auth.test.ts` (US2 AC1, SC-003, contracts/access-control.md §3): private default — no-credential `GET` ⇒ 401 with response byte-count containing zero history substrings AND zero tracker probes (auth strictly before reconstruction, asserted from the call log); wrong token ⇒ 403; `POST` token form (8 KB cap) ⇒ 303 + `Set-Cookie` (value token-free) then cookie `GET` ⇒ 200; bearer `GET` ⇒ 200 full view; public opt-in ⇒ no-credential 200; non-GET/POST ⇒ 405
- [ ] T026 [P] [US2] Write integration test `tests/integration/history-cache.test.ts` (US2 AC2, FR-006 — quickstart Scenario 4): two `GET`s 4 s apart under `fixedClock` ⇒ second served from cache with identical fake-port `getAttachmentByUrl` counts and `X-History-Cache: hit`; advance 11 s ⇒ chain re-read (`miss`); `cacheTtlSeconds: 0` ⇒ re-read every time; `Promise.all` of 5 concurrent misses ⇒ exactly one walk
- [ ] T027 [P] [US2] Write integration test `tests/integration/history-rate-limit.test.ts` + the `rate-limit-exhaustion` world (FR-007, US2 AC4 — quickstart Scenario 5): fake `scriptedFailures` `http-429-retryAfter` with `maxRetries: 0` ⇒ `429` `RATE_LIMITED`; scripted `network` failure ⇒ `502` `TRACKER_UNAVAILABLE`; both bodies name no credential (sentinel-free) and contain zero history bytes; port `detail` never forwarded; component issues no retries of its own (call count = port's count)
- [ ] T028 [P] [US2] Write integration test `tests/integration/history-serverless-shape.test.ts` (US2 AC3, FR-004/FR-006, SC-004 — quickstart Scenario 5): `cacheTtlSeconds: 0`, NO `listen()` — invoke `app.handle` directly (stub req/res) twice sequentially against the 10-page chain ⇒ full history both times; nothing persists between invocations; no `node:fs` usage (belt-and-braces with the T032 scan)

### Implementation for User Story 2

- [ ] T029 [US2] Implement the TTL cache + single-flight in `src/history-server/cache.ts` per data-model §5 and contracts/component-api.md §4 — clock-injected, `ttl: 0` disables, non-authoritative (makes T022/T026 pass)
- [ ] T030 [US2] Implement access control in `src/history-server/auth.ts` per contracts/access-control.md: mode dispatch, bearer `timingSafeEqual` compare against the env-sourced token, HKDF/HMAC stateless cookie issue+verify, 401/403 decision rules, POST token-form bootstrap with 8 KB body cap (makes T023/T025 pass)
- [ ] T031 [US2] Wire auth + cache into the handler pipeline in `src/history-server/create.ts`: route → auth gate (tracker never probed pre-auth) → cache → reconstruct; map ultimate port failures to `RATE_LIMITED`/`TRACKER_UNAVAILABLE`/`INTERNAL` per contracts/http-surface.md §4 without forwarding `detail`; POST routed to the session bootstrap only in private mode (405 otherwise) (makes T027 pass)

**Checkpoint**: At this point, User Stories 1 AND 2 both work independently — private/public modes, cache semantics, and the serverless-shape run all pass; SC-003/SC-004 assertions green.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Provability scans, packaging, e2e story layer, documentation duty, full-suite gate

- [ ] T032 [P] Write contract test `tests/contract/history-hygiene.test.ts` (research R9, contracts/component-api.md §3): source scan of `src/history-server/**` — ZERO `node:fs`/`node:fs/promises` imports (proves no manifest/state-dir/checkpoint read or write, FR-004/SC-004); zero `../state/` imports and zero `StateStore`/`sync-state.json`/`manifest`/`last-run`/`checkpoint`/`keyProvider`/`manifestKey` occurrences; inbound-only transport (`node:http` allowed; `node:https|http2|net|tls|dns|dgram`, `fetch(`, `undici`, `WebSocket`, `XMLHttpRequest` banned); no `tracker/internal|http` or `tracker/testing` reach-ins; no `task-linear-sync/*` package specifiers; `process.env` in exactly one file; zero credential-shaped literals / non-placeholder UUIDs / non-benign hosts in source and `tests/fixtures/history/**`
- [ ] T033 [P] Write contract test `tests/contract/history-packaging.test.ts`: `task-linear-sync/history-server` resolves via the exports entry and surfaces `createSyncHistoryServer` + settings/view types + `HistoryServerConfigError` with generated `.d.ts`; the existing dependency-budget test still passes with zero runtime dependencies added
- [ ] T034 [P] Write e2e test `tests/e2e/history-user-stories.test.ts` (quickstart Scenarios 1+3+5 walkthroughs): US1 — open the recorded URL (HTML) on an ephemeral-port server, see the full ordered story, follow a landed update via SSE; US2 — private-by-default 401 → token form → cookie session → 200; public opt-in; serverless-shape handler run serves the full chain (SC-001…SC-004 at the story level)
- [ ] T035 Write `docs/history-server.md` (documentation duty, placeholder identifiers only): usage scenario for `createSyncHistoryServer`, the settings table (frozen `web`-group sources + surface range guards, verbatim from contracts/component-api.md §2), deployment shapes (long-lived behind proxy, direct, serverless handler), access modes + token env-var setup, SSE-vs-polling behavior, cache semantics, and the security posture (server-side-only credentials, screening, no-store headers)
- [ ] T036 Update `README.md`: Wave-4 status line for 011, the `./history-server` export entry in the surface/export table, and a docs link to `docs/history-server.md`
- [ ] T037 Run `npm test` (full suite, all tiers) GREEN including the coverage gate (lines 80 / branches 70 / functions 80); fix any 011-at-fault regressions; mark completed tasks `[X]` in this file
- [ ] T038 Close coverage gaps in `src/history-server/**` with additional focused unit tests under `tests/unit/` (only if T037 reports shortfalls)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all user stories (routing + options + errors feed both stories)
- **User Stories (Phases 3–4)**: Both depend on Foundational; US1 and US2 then proceed independently (disjoint files; US2 only edits the `create.ts` wiring points reserved for it)
- **Polish (Phase 5)**: Depends on the stories being delivered

### User Story Dependencies

- **US1 (P1)**: Independent after Foundational — runs in `web.accessControlMode: "public"` for its own tests; the auth gate is a US2 insert, not a US1 prerequisite
- **US2 (P2)**: Independent after Foundational for its units (cache/auth); its integration tests wrap the US1 pipeline — if developed in parallel, land against the T021 contract (`app.handle` + settings surface)

### Within Each User Story

- Tests MUST be written and FAIL before their implementation tasks
- Reconstruction before rendering; screening helper before render wiring; cache/auth units before their integration wrappers; handler wiring last

### Parallel Opportunities

- T002 ∥ T003 (setup); T004 ∥ T005 ∥ T006 (foundational tests)
- All US1 tests (T011–T016) parallel; T018 ∥ T019 inside US1 implementation
- All US2 tests (T022–T028) parallel; T029 ∥ T030 inside US2 implementation
- With Foundational done, US1 and US2 lanes can run in parallel (011 is the strongest parallel candidate in Wave 4 — plan.md Structure Decision)
- All Polish tasks except T037 are parallel

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (they must fail first):
Task: "Chain reconstruction unit tests in tests/unit/history-reconstruct.test.ts"
Task: "Rendering unit tests in tests/unit/history-render.test.ts"
Task: "Re-screening posture unit tests in tests/unit/history-screening.test.ts"
Task: "Fixture worlds under tests/fixtures/history/worlds/"
Task: "10-page chain integration test in tests/integration/history-us1.test.ts"
Task: "SSE + fallback integration test in tests/integration/history-sse.test.ts"

# Then implement in parallel where files are disjoint:
Task: "Screening helper in src/history-server/screen.ts"
Task: "Rendering in src/history-server/render.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (public-mode history view with tiered transport)
4. **STOP and VALIDATE**: quickstart Scenarios 1–2 (SC-001/SC-002 green)
5. Ship-able as an internal public-mode viewer

### Incremental Delivery

1. Setup + Foundational → routing/config proven against the frozen scheme
2. US1 → open-the-URL story works end-to-end → MVP
3. US2 → private-by-default, caching, serverless shape → deployable anywhere (SC-003/SC-004)
4. Polish → hygiene proofs + docs → full-suite green

---

## Notes

- [P] tasks = different files, no dependencies
- Verify tests fail before implementing (constitution VI)
- Commit after each task or logical group; `specs/011-sync-history-web-page: ...` / `feat(011): ...` / `test(011): ...` / `docs(011): ...` message style
- NEVER edit frozen 002 or Wave-2/3 modules; never add a runtime dependency; the error renderer never imports the reconstruction path (leak-proof by structure, T032/T024 enforce)
- Stop at any checkpoint to validate a story independently
