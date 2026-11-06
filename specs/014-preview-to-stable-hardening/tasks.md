# Tasks: Preview-to-Stable Hardening (011 & 012 Surfaces)

**Input**: Design documents from `specs/014-preview-to-stable-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED and RED-FIRST — constitution VI (Test-First and Quality Gates) is
NON-NEGOTIABLE and the plan maps every FR/SC to ≥1 automated test. Each story's tests are
written first and must FAIL before their implementation tasks.

**Organization**: Tasks grouped by user story; Phases 1–2 are shared groundwork. The 002 config
amendment (Phase 2) is a SINGLE dedicated commit per `docs/contract-amendments.md` — nothing
rides along.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no incomplete dependency — safe to parallelize
- **[US1..US4]**: maps to spec.md user stories
- Paths are repository-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Working baseline on the feature branch

- [x] T001 Cut branch `014-preview-to-stable-hardening` from `main` (current tree is `docs/readme-wave4-status` with uncommitted work) and commit the in-flight spec artifacts: `specs/014-preview-to-stable-hardening/**`, `specs/015-package-publish-tooling/**`, `specs/ROADMAP.md`, `.specify/feature.json`
- [x] T002 Verify baseline green: `npm ci && npm run lint && npm run build && npm run typecheck && npm test` (expect 1520+ tests, coverage gates 80/70/80) — record the baseline count for the SC-005 "≥ baseline" check

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The R1 frozen-surface amendment (all six config keys), the amendment-entry log with
this feature's entries, and the snapshot comparator.

**⚠️ CRITICAL**: Every user story reads these config keys and/or the amendment log; nothing
below may bundle unrelated changes (amendment rule: "Nothing else may ride along").

- [x] T003 [US-none] Amend the contract document `specs/002-core-domain-contracts/contracts/configuration.md`: document the six additions verbatim — `web.maxCacheEntries` (int, guard `1..100000`, default `500`), `web.maxConcurrentWalks` (int, `1..64`, default `8`), `web.maxConcurrentSseStreams` (int, `1..1000`, default `16`), `web.secureCookies` (boolean, default `false`), `mcp.planReferenceTtlSeconds` (int, `60..86400`, default `3600`), `mcp.planReferenceMaxEntries` (int, `1..100000`, default `1000`) — do NOT commit yet (T006 commits the trio together)
- [x] T004 [P] Mirror T003 in `src/config/schema.ts`: add the four fields to `WebSurfaceConfig` and the two to `McpSurfaceConfig` (exact names/defaults/ranges from T003)
- [x] T005 [P] Mirror T003 in `src/config/defaults.ts`: add defaults `500 / 8 / 16 / false / 3600 / 1000` to the `web`/`mcp` groups (defaults MUST reproduce pre-014 observable behavior)
- [x] T006 Commit T003+T004+T005 as the STANDALONE amendment commit after `npm run typecheck && npm test` proves `frozen-surface` drift stays green (interface field additions change no exported NAME set) — commit message cites "amendment: configuration web/mcp bounds keys (noted against feature 001)"
- [x] T007 Extend `docs/contract-amendments.md` with the section "Surface contract freezes (011/012)" per `contracts/surface-freeze.md` §3: frozen-doc lists (011: http-surface, access-control, history-reconstruction, component-api; 012: tool-definitions, jsonrpc-stdio, transport-auth, apply-gating, component-api), the entry grammar `YYYY-MM-DD · surface · element-id · before → after · rationale · migration-note` with the `element-id` forms (`tool.<name>`, `route.<pattern>`, `status.<code>`, `error.<CODE>`, `config.<dotted.key>`, `protocol.<revision>`, `transport.<name>`, `sse.<aspect>`), the `UPDATE_SURFACE_SNAPSHOTS=1` regeneration rule, and per-surface log sections PRE-SEEDED with the five 014 entries listed in `contracts/README.md` (002 keys; 012 protocol `+2025-06-18`; 012 apply-gating TTL fold-in; 011 bearer case-insensitivity + Secure; 011 self-protective 429 + Retry-After)
- [x] T008 Create `tests/helpers/surface-freeze.ts`: the comparator (sorted deterministic diff → drift lines `ADDED <id>` / `REMOVED <id>` / `CHANGED <id>: <before> → <after>`, one per element), the live-registry inventory builders (MCP: `TOOL_DEFINITIONS`+`isVisible` at defaults, `SUPPORTED_PROTOCOL_VERSIONS`+`DEFAULT_PROTOCOL_VERSION`, JSON-RPC error code constants, HTTP status→constant-body table, `mcp.*` config keys+defaults, transports; history: route patterns+methods via `parseHistoryRoute`+dispatch, `ERROR_ENVELOPES` status→envelope, SSE content type, `web.*` keys+defaults, access modes, cookie base attribute set with `Secure` recorded as conditional), synthetic-drift builders for the mutation rows, and `UPDATE_SURFACE_SNAPSHOTS=1` write mode
- [x] T009 [P] Unit-test the helper in `tests/unit/surface-freeze.test.ts`: drift-line exactness, deterministic ordering, drift-set math (`driftIds ⊆ entryIds` pass/fail cases) — run red-first, then green

**Checkpoint**: amendment committed; comparator tested; story work unblocked.

---

## Phase 3: User Story 1 - Stability is declared and enforced (Priority: P1) 🎯 MVP

**Goal**: The freeze regime exists on both surfaces (snapshots + CI-failing mutation checks +
amendment-entry integrity), labels/docs are symmetric, and the traceability catalog matches
as-built. Label REMOVAL happens only in the promotion phase after all SCs pass.

**Independent Test**: `npm run test:contract` after injecting each synthetic drift fails with the
exact named drift line; regeneration without the corresponding entry stays red; README/docs
preview labeling is symmetric; `specs/requirements.md` has zero stale technology claims.

### Tests for User Story 1 ⚠️ (red first)

- [x] T010 [P] [US1] Write `tests/contract/surface-freeze-mcp.test.ts` per `contracts/surface-freeze.md`: snapshot compare + mutation checks rows 1 (drop tool → `REMOVED tool.task_sync_status`), 3 (flip status body → `CHANGED status.<code>`), 4 (add error code → `ADDED error.<NEWCODE>`), 6 (change `inputSchema` → `CHANGED tool.task_sync_plan.inputSchema …`); amendment-entry integrity: every entry id in the MCP log section still exists in the snapshot; each check asserts the EXACT drift line (SC-001)
- [x] T011 [P] [US1] Write `tests/contract/surface-freeze-history.test.ts`: snapshot compare + mutation rows 2 (rename route → `REMOVED route.…` + `ADDED route.…`), 3 (flip 429 envelope → `CHANGED status.429 …`), 5 (remove config key → `REMOVED config.web.maxCacheEntries`); amendment-entry integrity for the history log section (SC-001)

### Implementation for User Story 1

- [x] T012 [US1] Generate both checked-in snapshots `tests/contract/snapshots/history-surface.json` and `tests/contract/snapshots/mcp-surface.json` via `UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract` (captures post-amendment config keys; T010/T011 turn green) and commit them
- [ ] T013 [P] [US1] Correct `specs/requirements.md` as-built (research R10): replace the Next.js/React history-server wording (lines ~15 and ~55, glossary entry) and the "HTTP/SSE transport for remote use" MCP wording (line ~17) with the as-built zero-dependency built-in-HTTP component and stdio+loopback-HTTP transport set, citing 011 research R1 and 012 research R1/R2 — FR numbering (groups P/Q) unchanged
- [ ] T014 [P] [US1] Make preview labeling symmetric pre-promotion (spec FR-003): add the same preview disclaimer wording used at `docs/agent-tools.md:14-15` to `docs/history-server.md`, and fix `README.md` line ~99 to list ONLY npm scripts that exist in `package.json` (drop `test:cli`)
- [ ] T015 [US1] Add the `## Stability` section skeleton to BOTH `docs/agent-tools.md` and `docs/history-server.md` per `contracts/stability-declaration.md` §1 in WORKING state: status line "preview — hardening in progress (feature 014); stable upon promotion" (identical text both docs — symmetry), guaranteed-scope pointer list to that surface's contract docs + snapshot file, the single "not guaranteed" sentence, an empty non-goals list (filled by US2/US4), and deployment-assumptions lines (history: TLS front door + `web.secureCookies`; MCP: loopback-only HTTP, stdio default)

**Checkpoint**: unamended drift of ANY frozen element breaks CI (SC-001); traceability honest;
labels symmetric. US1 delivers value even if US2–US4 stall.

---

## Phase 4: User Story 2 - Long-running history server is resource-bounded (Priority: P1)

**Goal**: Bounded LRU cache, admission-bounded walks/SSE answering excess with the 429
envelope + `Retry-After: 1` and zero history bytes, opt-in `Secure` cookie, documented SSE
reconnect rule. Defaults byte-identical to 011 as merged.

**Independent Test**: quickstart Scenario 2 — fan-out keeps cache ≤ bound with byte-identical
responses vs control run (SC-002); every over-limit request gets the envelope (SC-003); cookie
attributes per mode; `Last-Event-ID` ignored.

### Tests for User Story 2 ⚠️ (red first)

- [ ] T016 [P] [US2] Extend `tests/unit/history-cache.test.ts`: LRU bound enforcement at `maxEntries: 4` — touch-on-hit moves FRESH entries to the most-recent slot; eviction from the front; insertion-order tie-break; TTL stays lazy (no timers); `flights` stay unbounded; eviction NEVER alters response bytes (data-model §7)
- [ ] T017 [P] [US2] Extend `tests/unit/history-options.test.ts`: guards for the four new keys, quoting the ranges verbatim — `maxCacheEntries` integer `1..100000`, `maxConcurrentWalks` integer `1..64`, `maxConcurrentSseStreams` integer `1..1000`, `secureCookies` boolean; all problems listed at once, one dotted-key line each, `HistoryServerConfigError` shape unchanged
- [ ] T018 [P] [US2] Write `tests/integration/history-bounds.test.ts` per quickstart Scenario 2: fan-out 50 tasks at `maxCacheEntries: 4` → size never > 4 AND responses byte-equal to the `maxEntries: 100000` control run (SC-002); 3 concurrent cache-miss GETs at `maxConcurrentWalks: 2` → third gets `429` + existing `RATE_LIMITED` envelope + `Retry-After: 1` + ZERO history bytes, cache hits and single-flight FOLLOWERS never refused; 3 concurrent `/stream` joins at `maxConcurrentSseStreams: 2` → third refused identically and never counted; GET with `Last-Event-ID: 99` → full current stream, no error; `secureCookies: true` → cookie ends `; Secure`, default `false` → the exact 011-merged cookie string byte-for-byte

### Implementation for User Story 2

- [ ] T019 [US2] Implement LRU in `src/history-server/cache.ts`: accept `maxEntries` on `HistoryCacheDeps`; touch-on-hit via delete+re-`set`; evict front slot(s) when a `set` would exceed the bound (research R2)
- [x] T020 [US2] Extend `src/history-server/options.ts`: resolve + range-guard the four `web.*` keys into `ResolvedHistoryServerSettings` (adds `maxCacheEntries`, `maxConcurrentWalks`, `maxConcurrentSseStreams`, `secureCookies`)
- [ ] T021 [US2] Extend `src/history-server/auth.ts`: append `; Secure` when `secureCookies` is true; the base cookie string `<name>=<value>; Path=/; HttpOnly; SameSite=Strict` stays byte-identical at the default (no `X-Forwarded-Proto` sniffing — research R4)
- [ ] T022 [US2] Extend `src/history-server/errors.ts`: attach `Retry-After: 1` on the self-protective 429 path (header only; the frozen envelope body shape is unchanged)
- [ ] T023 [US2] Implement admission in `src/history-server/create.ts`: integer in-flight-walk counter incremented ONLY for single-flight leaders on data-route cache misses, and an open-SSE-stream registry counted at join time before the stream opens; excess → the 429 envelope (decrement/close paths exception-safe) (research R3)
- [ ] T024 [US1-docs][US2] Documentation duty (same change): update `docs/history-server.md` — cache bound + eviction semantics, backpressure (two 429 triggers + `Retry-After`), TLS-front-door + `secureCookies` rule in Security posture, SSE "full re-stream is the resume semantics" note; fill the Stability non-goals: `sse-last-event-id-resume` and `history-inbound-identity-limiting`, each with rationale + non-empty revisit trigger (research R9/R3, data-model §4)
- [ ] T025 [US2] Re-run `UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract`, commit the regenerated `tests/contract/snapshots/history-surface.json` (now records the `Secure` conditional + `Retry-After` rule per the pre-seeded entries), and confirm `surface-freeze-history` amendment integrity green

**Checkpoint**: quickstart Scenario 2 green; SC-002 + SC-003 proven.

---

## Phase 5: User Story 3 - Long-lived MCP sessions stay bounded and consistent (Priority: P2)

**Goal**: Plan-reference store bounded by TTL + capacity with fail-closed
`PLAN_REFERENCE_UNKNOWN` refusals and zero engine/port/state touch; one bearer semantic across
both surfaces pinned by a black-box parity test.

**Independent Test**: quickstart Scenarios 3 + 4 — expiry/eviction ≡ unknown with empty call
logs; 11-row bearer matrix verdict-equal on both REAL servers, leak-free.

### Tests for User Story 3 ⚠️ (red first)

- [ ] T026 [P] [US3] Extend `tests/unit/mcp-plan-store.test.ts`: construction `createPlanReferenceStore(clock, { ttlSeconds, maxEntries })`; `fixedClock` +61 s at ttl `60` → `has`/`get` report absent; capacity 3 + fourth `record` → oldest `recordedAt` evicted (insertion-order tie-break), `size ≤ 3`; `isPlanIdShape` refusal unchanged; expired ≡ evicted ≡ unknown at the API (data-model §6; ranges `60..86400` / `1..100000` from resource-bounds.md §5)
- [ ] T027 [P] [US3] Extend `tests/unit/mcp-config.test.ts`: guards for `mcp.planReferenceTtlSeconds` integer `60..86400` default `3600` and `mcp.planReferenceMaxEntries` integer `1..100000` default `1000`; all problems at once, one dotted-key line each, `McpConfigError` shape unchanged
- [ ] T028 [P] [US3] Extend `tests/integration/mcp-http.test.ts`: long-lived server at `planReferenceTtlSeconds: 60` / `planReferenceMaxEntries: 3`; apply of an expired ref → `isError PLAN_REFERENCE_UNKNOWN`, message unchanged ("run task_sync_plan"), ZERO engine/port/state touch via injected spies, state-dir tree hash unchanged; capacity-evicted ref behaves identically; restart-clears case still green
- [ ] T029 [P] [US3] Write `tests/integration/bearer-semantics-parity.test.ts` per `contracts/bearer-parity.md` §2: boot the REAL history server (its `node:http` handler, fake tracker) and the REAL MCP server (`listenHttp()`, port 0); run the 11-row matrix (`Bearer T`/`bearer T`/`BEARER T`/`BeArEr T`/`Bearer  T`/`\tbearer T`/`  bearer T`/`Bearer`/`Bearer `/`Basic T`/absent) asserting row-by-row verdict equality, `www-authenticate: Bearer` on scheme rejections from BOTH, zero-dispatch call logs EMPTY on both, and a credential-sentinel sweep over all response bytes

### Implementation for User Story 3

- [ ] T030 [US3] Implement bounds in `src/mcp/plan-store.ts`: signature `createPlanReferenceStore(clock, { ttlSeconds, maxEntries })`; lazy expiry on `has`/`get` (remove opportunistically); eager expiry sweep + capacity trim inside `record` (oldest `recordedAt` first, insertion-order tie-break); NO timers; zero `node:fs` preserved (research R6)
- [ ] T031 [US3] Wire settings: add `planReferenceTtlSeconds` / `planReferenceMaxEntries` to `McpSettings` in `src/mcp/config.ts` (guards per T027) and construct the bounded store in `src/mcp/create.ts`
- [ ] T032 [US3] Unify the bearer parser in `src/history-server/auth.ts`: replace `startsWith("Bearer ")` with the MCP semantics `/^\s*bearer\s+(.+)$/i` (capture trimmed; empty capture → scheme rejection), keeping the length guard + `timingSafeEqual` and the pre-dispatch zero-touch ordering (research R5)
- [ ] T033 [US3] Documentation duty (same change): `docs/agent-tools.md` session-state section — reference TTL/capacity eviction, "expired ≡ evicted ≡ unknown" wording; `docs/history-server.md` access-modes section — bearer scheme case-insensitive per RFC 7235

**Checkpoint**: quickstart Scenarios 3 + 4 green; SC-004 proven; hygiene suites unchanged.

---

## Phase 6: User Story 4 - Deferred items reach a recorded decision (Priority: P3)

**Goal**: MCP negotiation set includes `2025-06-18`; every research deferral is recorded as
implemented or a named non-goal with rationale + revisit trigger — 0 silent deferrals.

**Independent Test**: quickstart Scenario 5 negotiation rows; the register test finds every
required slug in both Stability sections with non-empty triggers.

### Tests for User Story 4 ⚠️ (red first)

- [ ] T035 [P] [US4] Extend `tests/unit/mcp-jsonrpc.test.ts`: `initialize` echoes each of `2024-11-05` / `2025-03-26` / `2025-06-18`; unsupported `"2099-01-01"` → result carries newest supported `"2025-06-18"`; `protocolVersion: 42` (non-string) → `-32602`; `DEFAULT_PROTOCOL_VERSION === "2025-06-18"`; `SUPPORTED_PROTOCOL_VERSIONS` is exactly the three-item set
- [ ] T036 [P] [US4] Extend `tests/integration/mcp-stdio.test.ts` with the quickstart Scenario 5 handshake rows end-to-end over the line-transport harness

### Implementation for User Story 4

- [x] T037 [US4] Set `SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"]` and `DEFAULT_PROTOCOL_VERSION = "2025-06-18"` in `src/mcp/jsonrpc.ts` (fallback behavior already conforms) and update `specs/012-ai-agent-tool-interface/contracts/jsonrpc-stdio.md` with the new set (entry `protocol.2025-06-18` pre-seeded in T007)
- [ ] T038 [P] [US4] Fill the MCP Stability non-goals in `docs/agent-tools.md`: `mcp-sdk-protocol-surface` (streamable HTTP, resources, prompts, sampling, elicitation, roots, subscriptions — 012 R1 trigger stands, plus research R9's streamable-HTTP trigger) and `mcp-tls-remote-exposure` (loopback remains the documented shape; front-door TLS, mirroring research R4) — each with rationale + non-empty revisit trigger (spec FR-011)
- [ ] T039 [US4] Re-run `UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract`, commit the regenerated `tests/contract/snapshots/mcp-surface.json` (protocolVersions changed), confirm `surface-freeze-mcp` amendment integrity green

**Checkpoint**: quickstart Scenario 5 green; SC-006 register complete across both docs.

---

## Phase 7: Polish, Promotion & Cross-Cutting Concerns

**Purpose**: All SCs green → the label comes off, simultaneously on both surfaces.

- [ ] T040 Write `tests/contract/stability-docs.test.ts` (SC-005/SC-006 machine checks per `contracts/stability-declaration.md` §3): `preview` word-boundary grep = 0 hits across `README.md`, `docs/agent-tools.md`, `docs/history-server.md`; `Next.js`/`React`/`HTTP/SSE transport` = 0 hits in `specs/requirements.md`; README npm-script mentions ⊆ `package.json` scripts; status symmetry across README rows + both docs + both spec status lines; every required non-goal slug present with non-empty revisit trigger. EXPECTED RED until T041/T042 land
- [ ] T041 [US-none] Promotion (one change, both surfaces, checklist per `contracts/stability-declaration.md` §2): drop the three `(preview)` labels in `README.md` (surface-table row line ~23, feature bullet line ~96, section heading line ~290) and the `docs/agent-tools.md` disclaimer paragraph (~lines 14-15); flip both `## Stability` status lines to `Stable · effective 2026-11-XX · promoted by feature 014`; update the README Current-Status "Next steps" line to remove the completed hardening item (keep publish tooling + dogfooding); update `README.md` feature-011/012 bullets with the hardening summary
- [ ] T042 [P] [US-none] Flip `specs/011-sync-history-web-page/spec.md` and `specs/012-ai-agent-tool-interface/spec.md` status lines `Draft` → `Stable (promoted by feature 014, 2026-11-XX)` and set `specs/014-preview-to-stable-hardening/spec.md` status `Draft` → `Delivered`
- [ ] T043 Run `npm test` — T040 now green; full suite ≥ T002 baseline; coverage gates 80/70/80 pass; `tracker-dependency-budget` stays `SPENT 0`; `mcp-hygiene` / `history-hygiene` / defaults-scan / credential-sentinel (extended) green; no `package.json` `exports` map change
- [ ] T044 Execute quickstart.md Scenarios 1–6 end-to-end against built `dist/` and record results (promotion review evidence)
- [ ] T045 Final audit: amendment commits are standalone (T006 alone; entries per contracts/README list); `git log --stat` shows no frozen-module edits outside T006's commit; PR description cites SC-001…SC-006 evidence lines from T043/T044

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: start immediately.
- **Foundational (Phase 2)**: after Phase 1. BLOCKS everything: T010–T012 snapshot config keys
  (needs T003–T006), T016–T025 read `web.*` keys, T026–T033 read `mcp.*` keys, all integrity
  checks read the T007 log.
- **US1 (Phase 3)**: after Phase 2. **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**:
  each after Phase 2 + US1's T012 (both snapshots must exist before story-level regeneration);
  beyond that they touch DISJOINT files and run fully parallel: US2 = `src/history-server/*` +
  history tests/docs; US3 = `src/mcp/{plan-store,config,create}.ts` + `history/auth.ts` bearer
  line + their tests/docs; US4 = `src/mcp/jsonrpc.ts` + its tests/docs. The single cross-story
  file is `docs/history-server.md` (US2 T024 vs US3 T033 — different sections; sequence the
  two doc edits or split by section ownership).
- **Polish (Phase 7)**: after ALL desired stories; promotion (T041/T042) requires every SC green.

### Per-Story Order (within each story)

Tests red → implementation (models/store/cache → guards → transport/dispatch) → docs duty in
the same change → snapshot regeneration where the surface changed → story checkpoint.

### Parallel Opportunities

- Phase 2: T004 ∥ T005 (after T003 drafted); T009 ∥ nothing (needs T008) — T007 ∥ T008.
- US1: T010 ∥ T011; T013 ∥ T014 (after T012).
- US2: T016 ∥ T017 ∥ T018 (all red-first, disjoint files).
- US3: T026 ∥ T027 ∥ T028 ∥ T029.
- US4: T035 ∥ T036.
- After T012: US2 ∥ US3 ∥ US4 by different agents (disjoint file sets per above).

### Parallel Example: User Story 2

```bash
# Write all US2 tests first (disjoint files, all red):
Task: "Extend tests/unit/history-cache.test.ts (LRU semantics)"
Task: "Extend tests/unit/history-options.test.ts (four web.* guards)"
Task: "Write tests/integration/history-bounds.test.ts (fan-out/overload/cookies)"
# Then implement; T019/T021/T022 are disjoint-file tasks:
Task: "LRU in src/history-server/cache.ts"
Task: "Secure attribute in src/history-server/auth.ts"
Task: "Retry-After in src/history-server/errors.ts"
# T020 (options.ts) then T023 (create.ts) consume the settings; T024 docs; T025 re-snapshot.
```

---

## Implementation Strategy

### MVP First (Setup + Foundational + US1)

1. Phase 1 → baseline green on the branch.
2. Phase 2 → the standalone 002 amendment commit + freeze plumbing.
3. Phase 3 → freeze tests + checked-in snapshots + symmetric labels + honest traceability.
4. **STOP and VALIDATE**: mutation injection catches every frozen element (SC-001); ship this —
   stability is now enforceable even if hardening pauses. (Note: the preview label stays ON at
   MVP by spec FR-003's rule — promotion is the all-SC gate in Phase 7.)

### Incremental Delivery

1. MVP above → freeze enforced.
2. + US2 → history server production-grade (SC-002/003).
3. + US3 → MCP sessions bounded, one bearer semantic (SC-004).
4. + US4 → deferrals all recorded, protocol current (SC-006).
5. Phase 7 → both labels drop simultaneously; docs/README/specs flip in one gated change
   (SC-005).

### Parallel Team Strategy

With multiple developers: pair on Phases 1–2 together (amendment needs two eyes), then after
T012: Dev A → US2, Dev B → US3, Dev C → US4; Phase 7 is a single maintainer promotion review.

---

## Notes

- Constraint ranges are quoted verbatim in tasks from `contracts/resource-bounds.md` §1 and
  `data-model.md` §3 — implementers MUST NOT adjust them.
- The amendment rule outranks convenience: T006 is its own commit; if T004/T005 need follow-on
  fixes, they amend T006 before merge, never bundle later work in.
- Every refusal response stays leak-free: zero credentials, zero history bytes — sentinel
  sweeps extend, never weaken.
- Commit after each task or logical story group; snapshots regenerate only via
  `UPDATE_SURFACE_SNAPSHOTS=1` with their amendment entries already in `docs/contract-amendments.md`.
- Stop at any checkpoint to validate the story independently (matching quickstart scenarios).
