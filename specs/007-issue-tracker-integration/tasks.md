# Tasks: Issue-Tracker Integration Port

**Input**: Design documents from `specs/007-issue-tracker-integration/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md (§1–10), contracts/ (tracker-adapter.md, resilience-and-credentials.md, tracker-testing.md)

**Tests**: INCLUDED — mandatory. Constitution Principle VI (NON-NEGOTIABLE: "Every behavioral change lands with automated tests... every acceptance criterion in the specification MUST be enforced by at least one automated test") and quickstart.md's traceability table map every FR/SC to specific tests. The constitution additionally mandates cross-cutting types delivered here: "**contract (fake-versus-real `Linear_Port`)**" tests, property-based tests (seeded PRNG, zero new dev dependencies — research R2), and security tests (credential sentinel, document allow-list). Test tasks precede implementation tasks (test-first, verify RED before GREEN). **No live platform calls exist in any automated tier** — everything runs on the fake or recorded fixtures (research R9).

**Organization**: Tasks grouped by user story (US1 = complete scoped inventory P1, US2 = identity/history via attachments P2). The adapter skeleton, transport seam, resilience/credential posture, the fake, and the parity suite are the cross-cutting blocking foundation.

**Dependency-decision note (first platform dependency — research R1)**: this feature deliberately **adds no runtime dependency**: the transport is Node ≥ 20 built-in `fetch` (T014) behind the `HttpTransport` seam; `package.json` `dependencies` stays empty and the constitution ceiling ("runtime dependencies limited to Node built-ins plus exactly one platform transport dependency") remains unspent, guarded by the budget scan (T043). If maintainers later amend this decision, the swap is confined to `src/tracker/http.ts` + `src/tracker/internal/request.ts` + `package.json`: adopt the official SDK `@linear/sdk` with an **exact version pin** (no caret/tilde), commit the refreshed `package-lock.json`, and keep the ≤ 1 dependency budget green.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]/[US2]**: User-story phases only; Setup, Foundational, and Polish tasks carry no story label
- Test runner: `node:test` + `node:assert/strict` against compiled output (002 R2 inherited); tiers `unit`, `contract`, `integration`, `e2e` via `scripts/run-tests.mjs` (unchanged)
- All paths are repository-root-relative; single npm package per plan.md; frozen 002 modules (`src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, `src/ports`) are **imported only — never edited** (ROADMAP rule 2); no other Wave-2 feature's files are touched

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module scaffold, additive packaging entries, fixture-corpus conventions, and the shared test harness for this feature.

- [X] T001 Create directory scaffold per plan.md § Source Code: `src/tracker/{graphql,operations,testing,internal}/`, `tests/fixtures/tracker/scenarios/`; confirm `package.json` `dependencies` is and stays `{}` (research R1: zero new runtime dependencies; built-in `fetch` is the platform transport; the constitution's "exactly one platform transport dependency" allowance is a ceiling left unspent — if a future decision adopts an SDK it is exact-pinned, e.g. `@linear/sdk@<exact-version>` with committed `package-lock.json`, never a floating range)
- [X] T002 Add to `package.json` the two additive `exports` subpaths `./tracker` → `./dist/tracker/index.js` and `./tracker/testing` → `./dist/tracker/testing/index.js` (each with `types` condition listed FIRST, mirroring the existing frozen entries' shape; 002's structure rule: consumers "import them only through this package's declared subpath exports"); touch no other packaging field
- [X] T003 [P] Create fixture-corpus conventions doc `tests/fixtures/tracker/README.md` per data-model §8: scenario directory layout (`scenario.json` + ordered `NN-<operationName>.json` request/response pairs + optional `world.json` fake seeds); quoting the redaction rule: "headers never include Authorization — redacted at record time"; placeholder identities only (`acme-team`, `proj-alpha`, `ACM-123`-shaped keys, synthetic UUIDs — hygiene-scanned by T046)
- [X] T004 [P] Create test-helper layer `tests/helpers/tracker-harness.ts`: scenario-dir loader (typed against data-model §8), seeded splitmix `rng` (deterministic jitter — Principle IV), `FakeSleeper` (records `waitedMs` without wall-clock — resilience contract §3 "delays execute through an injected `sleep(ms)`"), sentinel-env builder for credential tests, and re-export of `FakeClock` from `tests/helpers/test-utils.ts`

**Checkpoint**: Scaffold exists; `npm ci && npm run build` passes (empty tracker modules still compile once T012–T023 land; exports entries resolve once `src/tracker/index.ts` exists at T024).

---

## Phase 2: Foundational (Adapter Skeleton, Posture, Fake, Parity Harness)

**Purpose**: The cross-cutting core every story needs and 006/008/011 consume: error taxonomy, options, transport seam, resilience wrapper, credential pre-flight, GraphQL documents + field mapping, the single request site, the **complete fake `LinearPort`** (all 11 frozen members — it is the test substrate for the whole system), the recorded-fixture driver, the port factory, and the fake-versus-real conformance suite.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — US1/US2 implement only the real adapter's operation modules behind the factory assembled here.

### Tests for the foundation (write FIRST, must fail)

- [X] T005 [P] Create error-taxonomy unit tests `tests/unit/tracker-errors.test.ts` per data-model §5: `TrackerError` shape `{ category, retryable, attempts, httpStatus?, detail }` with exactly the 10-category union; `IndeterminateCreateError` carries `category: "create-indeterminate"`, `retryable: false` — honoring the constitution: "a failed create is recorded as indeterminate and reconciled, not replayed"; `TrackerConfigError` detail names env-var **names** / config keys only
- [X] T006 [P] Create resilience unit tests `tests/unit/tracker-resilience.test.ts` per contracts/resilience-and-credentials.md §2–4 honoring the verbatim constraint: "Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST retry with exponential backoff and randomized jitter up to the configurable maximum, honoring `Retry-After`. Issue creation MUST never be automatically retried": classification rows 1–7 (network/timeout/429/5xx retryable; 401/403/404/other-4xx/GraphQL-200-errors not); schedule `min(baseMs·2^k, maxDelayMs)` equal-jitter bounds `delay ∈ [computed/2, computed]` under seeded rng (identical seed ⇒ identical sequence); budget `maxRetries` (default 5) **additional** attempts (≤ 6 requests) and `maxRetries: 0` override; `Retry-After` delta-seconds and HTTP-date (vs injected clock) **replace** the computed delay, malformed header ignored, clamp `[0, maxDelayMs]`; create-guard class `"never"` ⇒ exactly `attempts: 1` under every retryable signal
- [X] T007 [P] Create credential unit tests `tests/unit/tracker-credentials.test.ts` per contract §5, quoting: "Credentials MUST be read only from configured environment-variable names, MUST be rejected with a naming diagnostic before any request when unset or empty, and MUST NEVER appear in diagnostics, logs, reports, web responses, or MCP outputs": unset **and** empty ⇒ `TrackerConfigError` at construction with zero requests issued, `detail` names `config.credentialEnvVarNames` value (e.g. `LINEAR_ACCESS_TOKEN`) and never any value; prefix-mismatch ⇒ non-fatal `TrackerDiagnostic` naming env-var name + `personalKeyPrefix` constant only; sanitizer strips the planted sentinel from arbitrary strings
- [X] T008 [P] Create field-mapping unit tests `tests/unit/tracker-mapping.test.ts` per data-model §10: every row (e.g. `IssueView.key` ← `Issue.identifier`; `stateType` ← `Issue.state.type`; `archived` ← `archivedAt != null`; null project → `""`); identity resolution: configured project identity → platform id via discovery results, unknown identity ⇒ `TrackerConfigError` naming team + identity (pre-dispatch — "so it is not indeterminate", tracker-adapter.md create row)
- [X] T009 [P] Create fake-semantics unit tests `tests/unit/tracker-fake.test.ts` per contracts/tracker-testing.md §1: URL-idempotent upsert updates in place (map size unchanged, `callLog` grows); per-team scoping uses the **same** guard code path (shared module, not re-implemented); opaque `c:<index>` cursors with `nextCursor: null` only at end; `scriptFailure` maps to the identical R12 taxonomy with `attempts` semantics (create ⇒ always 1); the fake exposes **no** description-search capability at all (FR-004 world property)
- [X] T010 [P] Create the parity suite factory `tests/contract/tracker-conformance.suite.ts`: `linearPortConformance(name, makePort)` with scenario groups exactly per tracker-testing.md §3 (pagination completeness/scoping exactness/per-team isolation; metadata triples; CRUD round-trips; identity-via-attachments + adversarial negatives; upsert idempotency; attachment paging; chain gap/orphans via `chain.ts` over the port; mid-pagination failure; error taxonomy + create-guard counts); scenarios whose real-side member is still a T023 placeholder report **skip** (placeholder error carries `detail.code: "not-implemented"`), while the fake binding (complete at T020) always runs all
- [X] T011 [P] Create the binding runner `tests/contract/tracker-conformance.test.ts`: run T010's suite against BOTH bindings — `createFakeLinearPort()` and the real adapter over `createRecordedTransport(...)` + injected fake clock/rng/sleeper — asserting identical results per scenario per tracker-testing.md §3 ("one suite, two bindings"); real binding auto-skips placeholder-backed scenarios so incremental stories require **no edits to this file** (keeps T031/T040 disjoint)

### Implementation — posture core (disjoint files, mostly parallel-safe after tests)

- [X] T012 Implement `src/tracker/errors.ts`: the 10-category `TrackerError` union + `TrackerConfigError` + `IndeterminateCreateError` per data-model §5; the sanitizing detail-renderer (strip-list fed by the credential bundle — R5); request site (T019) is the sole mapper into this taxonomy (R12)
- [X] T013 Implement `src/tracker/options.ts`: `TrackerClientOptions` per data-model §1 with built-in defaults — `apiUrl: "https://api.linear.app/graphql"` (public platform constant, NOT a consumer-org literal — R11; `ResolvedConfig` is NOT extended; config-file overridability of `apiUrl` remains a 001-noted amendment candidate per R11, programmatic override ships now), `timeoutMs: 30_000`, `baseDelayMs: 250`, `maxDelayMs: 15_000`, `orphanProbeLimit: 8`, default seeded `rng`/`sleep`/`env`/`transport` bindings, `credentialKind` default `"token"`, no-op `diagnostics`; construction validation (`baseDelayMs ≤ maxDelayMs`; `orphanProbeLimit ≥ 0`; `apiUrl` https without query/fragment) throws `TrackerConfigError`
- [X] T014 Implement `src/tracker/http.ts`: `HttpRequest`/`HttpResponse`/`HttpTransport` per data-model §2 + `fetchTransport()` — the ONLY place touching global `fetch`: POST JSON body, `Authorization: Bearer <accessToken>` + `Content-Type`/`Accept`, `AbortSignal` per-request timeout from `timeoutMs`, lower-cased header map, non-JSON body → `{ __rawText }`; network/abort errors propagate uncaught-but-typed for T015 classification; **never logs anything** (R3)
- [X] T015 Implement `src/tracker/resilience.ts`: pure `classifyFailure(error | HttpResponse)` → R12 category + retryable flag (classification table, resilience contract §2); `nextDelayMs(attempt, opts)` equal-jitter schedule with `Retry-After` precedence/clamp (§4 rules verbatim above); `withRetry(run, { retryClass, maxRetries, ... })` wrapper taking the mandatory `retryClass: "non-create" | "never"` — the create guard is per-operation-class ("the interface carries no retry knobs to tempt per-caller retries" — frozen invariant 2: no knob may appear anywhere above the request site); per-client concurrency semaphore over `config.concurrency` (default 4)
- [X] T016 Implement `src/tracker/credentials.ts`: construction-time env read per T007/R5 (unset/empty ⇒ `TrackerConfigError` naming the env-var **name**; prefix diagnostic; `CredentialBundle` referenced only by `HttpRequest.accessToken` and the T012 sanitizer strip-list)
- [X] T017 Implement `src/tracker/graphql/documents.ts`: the COMPLETE GraphQL document set — the R12 allow-list: `issues` (first/after + per-team `filter { team.key.eq, project.id.in, state.type.nin }`), `issue`, `teamMetadata` (`teams(filter: { key: { in } }) { key projects states }`), `issueCreate`, `issueUpdate`, `issueArchive`, `attachmentsForURL`, `attachmentCreate`, `attachmentUpdate`, `issueAttachments` — each a named `operationName` + typed variables; NO search operation, NO description-typed filter anywhere (FR-004: "MUST NOT search issue descriptions for identity")
- [X] T018 Implement `src/tracker/graphql/mapping.ts`: response→view mapping exactly per data-model §10 table (frozen 002 view types imported, never reshaped); `IssueScope.pageSize` → connection `first` with validation "1..250" (platform max) + `page-size-clamped` diagnostic; per-team identity resolution helpers (project identities → ids; `teamKey → teamId` for create) over a per-instance discovery cache (R10: "`empty → warm(per-team)` … fresh instance = fresh discovery")
- [X] T019 Implement `src/tracker/internal/request.ts`: the ONE request site (R3) composing credentials (T016) → `withRetry` (T015, mandatory `retryClass`) → transport (T014) → GraphQL-envelope check → error mapping (T012); records `attempts`/`waitedMs` on outcomes; nothing else in `src/**` may hold a fetch/transport reference (constitution V: "All Linear access MUST flow through the injectable `Linear_Port`" — scan-enforced by T044)
- [X] T020 Implement `src/tracker/testing/fake-port.ts`: `createFakeLinearPort(world?)` — the in-memory `FakeWorld` (data-model §9: issues table, `byUrl` carriers index, per-issue attachment lists with `c:<index>` cursors, teams/projects/states, `scriptFailures`) implementing ALL 11 frozen `LinearPort` members with the §1 behavioral contract of tracker-testing.md, `callLog` request-count proofs, `scriptFailure(...)`, reusing T028's scoping guard when present (until then a private identical predicate that T028 refactors to the shared export — noted dependency); the fake is behaviorally identical to the real port: "The fake `Linear_Port` used in tests MUST conform to the same behavioral contract as the real implementation and be contract-tested against it."
- [X] T021 [P] Implement `src/tracker/testing/harness.ts` + `src/tracker/testing/index.ts`: `createRecordedTransport(scenarioDir)` per tracker-testing.md §2 — ordered `NN-*.json` pairs; matching = "earliest unconsumed pair with matching `operationName` and pinned variable keys; miss ⇒ loud `FixtureMiss`"; response `status`/`headers`/`body` replay verbatim (429/`Retry-After` fixtures drive the real resilience stack under fake clock/rng/sleeper); subpath re-exports (fake, harness, types) with zero runtime dependencies
- [X] T022 Implement `src/tracker/client.ts`: `createLinearPort(deps: { config, urlConfig?, options? }): LinearPort` per contracts/tracker-adapter.md — runs the credential pre-flight BEFORE returning ("MUST be rejected with a naming diagnostic before any request" — construction throws `TrackerConfigError`, zero requests issued); builds `TrackerContext` (options, credentials, request executor, mapping/discovery cache); assembles the port from the three operation modules + chain-independent members; derives `AttachmentUrlConfig` from frozen config for `chain.ts` consumers
- [X] T023 Implement operation shells (placeholder modules so the package compiles and parity auto-skips): `src/tracker/operations/inventory.ts`, `src/tracker/operations/mutations.ts`, `src/tracker/operations/attachments.ts`, `src/tracker/chain.ts` — each exported member throws `TrackerError { category: "config", detail: "not-implemented: <member>" }` (the T010/T011 skip signal); US1 replaces `operations/inventory.ts` internals (+ adds `scoping.ts`/`pagination.ts`), US2 replaces `operations/mutations.ts`, `operations/attachments.ts`, `chain.ts` internals — strictly disjoint file ownership between stories
- [X] T024 Wire `src/tracker/index.ts` (public `./tracker` surface: `createLinearPort`, `TrackerClientOptions`, error classes, chain helpers) and `src/tracker/testing/index.ts` re-check; run `npm run build && npm run typecheck && npm run lint`; drive T005–T009 unit tests GREEN and T010/T011 GREEN for the **fake binding** (real binding skips all placeholder-backed scenarios); verify 002's `tests/contract/frozen-surface.test.ts` + `package-surface.test.ts` still pass untouched (nothing frozen edited)

**Checkpoint**: Posture + fake + parity harness complete; fake-side conformance green; stories can proceed in parallel on disjoint operation modules. This is also what unblocks 006/008/011's fake injection (`task-linear-sync/tracker/testing`).

---

## Phase 3: User Story 1 - Complete, correctly scoped inventory (Priority: P1) 🎯 MVP

**Goal**: Real-adapter `listIssues` (all pages, all teams, exact per-team scoping — never leaking) and `discoverMetadata` (three collections per team) over the frozen request/resilience stack; parity suite green for the real binding on inventory + metadata scenarios (FR-001, FR-002).

**Independent Test**: "Contract suite against a fake tracker with multi-page responses, multi-team fixtures, and cross-team trap issues; assert page-count requests, complete retrieval, scoping filter exactness, and per-team result isolation." (Run: `npm run test:integration -- --test-name-pattern "inventory"` + `npm run test:contract -- --test-name-pattern "conformance"` — spec US1 Independent Test, both bindings.)

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [ ] T025 [P] [US1] Scoping unit tests `tests/unit/tracker-scoping.test.ts` per R6: inclusion = "belongs to a configured team AND one of that team's configured projects AND are not in an ignored state type (default: canceled, duplicate)" (FR-001); per-team filter construction (never a global project/state union — "Per-team scoping never leaks: project/state filters are evaluated per team"); client guard rejects cross-team trap rows; `pageSize` clamp 1..250 with `page-size-clamped` diagnostic
- [ ] T026 [P] [US1] Pagination unit tests `tests/unit/tracker-pagination.test.ts` per R6 against the frozen contract wording: "Pagination until exhausted… Yields complete pages; failure after retries surfaces with no partial-inventory consumption" — per-team sequential `after = endCursor` until `hasNextPage = false`; teams proceed in configured `teamKeys` order, parallel only up to the `concurrency` semaphore; a page's views are yielded ONLY after the whole page arrives; scripted page-k failure after retries exhausted throws from the iterator with ZERO rows of page k emitted (spec edge case "Mid-pagination failure")
- [ ] T027 [P] [US1] Inventory integration tests `tests/integration/tracker-inventory.test.ts`: fake worlds AND recorded scenarios `tests/fixtures/tracker/scenarios/multi-team-inventory/` + `metadata-discovery/` — SC-001: "listing retrieves 100% of in-scope issues and 0 out-of-scope issues over the multi-team, multi-page fixture corpus"; `callLog`/recorded-request counts prove `ceil(count/pageSize)` page requests per team (no extra fan-out); per-team result isolation partitions; mid-pagination scenario end-to-end; metadata discovery returns "the team key, its projects, and its workflow states as three collections per team" in requested order (FR-002, spec AC US1.3)

### Implementation for User Story 1

- [ ] T028 [US1] Implement `src/tracker/scoping.ts`: server-side per-team filter builder (per T017's `issues` document variables) + pure client-side guard predicate (single shared implementation the fake reuses per T020's note) + `pageSize` validate/clamp helper — the two-layer enforcement of R6 ("belt-and-braces for a rule the port contract calls never-leak")
- [ ] T029 [US1] Implement `src/tracker/pagination.ts`: complete-page `AsyncIterableIterator<IssueView>` per T026 semantics (whole-page fetch → yield views; sequential cursor per team; teams ordered; failure = terminal throw with the failed page unconsumed; T015 semaphore + `non-create` retry class) (depends on T028)
- [ ] T030 [US1] Implement `src/tracker/operations/inventory.ts` (replacing the T023 shell): `listIssues(scope)` = per-team filtered page loops via documents/mapping/request + guard; `discoverMetadata(teamKeys)` = ONE `teamMetadata` query mapped to `TeamMetadataCollections[]`, warming the T018 discovery cache (create-path id resolution benefits; unknown scope identity ⇒ `TrackerConfigError` naming team + identity — never a silent empty page) (depends on T028/T029)
- [ ] T031 [US1] Finalize recorded scenarios matching the real documents: `tests/fixtures/tracker/scenarios/multi-team-inventory/` (3 teams × multi-page + cross-team trap rows in team-A-shaped payloads), `mid-pagination-failure/` (page-2 5xx×(maxRetries+1) then terminal), `metadata-discovery/` — data-model §8 format, placeholder identities, no `Authorization`; parity real-binding inventory + metadata scenarios now execute automatically (T011 auto-detect — verify they flip from skip to run and pass; do NOT edit the binding-runner logic)
- [ ] T032 [US1] Story checkpoint: `npm run test:unit -- --test-name-pattern "scoping|pagination"`, `npm run test:integration -- --test-name-pattern "inventory"`, `npm run test:contract` — all GREEN incl. both parity bindings for inventory/metadata; record results against `specs/007-issue-tracker-integration/quickstart.md` US1 rows 1–4 (SC-001 evidence: 100% in / 0 out; page-count assertions)

**Checkpoint**: MVP — real adapter produces a complete, exactly-scoped, per-team-isolated inventory and metadata set, identical in behavior to the fake (parity green). 006's matching and 008's plan-build can consume `listIssues`/`discoverMetadata` already.

---

## Phase 4: User Story 2 - Identity and history via attachments only (Priority: P2)

**Goal**: Issue CRUD/archive with the configured resilience posture (non-create retried, creates NEVER), identity lookup strictly via attachment metadata, URL-idempotent attachment upsert, cursor attachment listing, and the chain walk with stop-at-gap + orphan reporting (FR-003…FR-006).

**Independent Test**: "Fake tracker with attachments addressed by deterministic URLs; assert create-or-update updates in place without duplicating, continuation URLs form the expected chain, walking stops at the first missing page, identity resolution uses only page 0, and a description containing UUID-like text never produces a match." (spec US2 Independent Test; run: `npm run test:integration -- --test-name-pattern "identity|attachment|chain|resilience"`.)

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [ ] T033 [P] [US2] Chain unit tests `tests/unit/tracker-chain.test.ts` per R8/§6: identity via `canonicalAttachmentUrl` page 0 ONLY ("identity matching keys solely off the page-0 canonical attachment" — FR-006); walk pages 1,2,… upward via `continuationAttachmentUrl` and "stop[]ing at the first absent index" (frozen tracker-port wording); gap fixture "page 3 missing but page 4 present: the walk stops at the first absent index; orphaned higher pages are reported, not silently skipped" ⇒ `pages = [1,2]`, `orphans = [4]` within `orphanProbeLimit`; `canonical: null ⇒ pages/orphans empty`; repeated-run identical results (determinism property, Principle IV)
- [ ] T034 [P] [US2] Resilience-over-HTTP integration tests `tests/integration/tracker-resilience-http.test.ts` (real adapter over scripted recorded transports; fake sleeper/clock/rng): 429 + `Retry-After: 3` then success ⇒ recorded wait `3000ms`, ≤ maxRetries+1 attempts; 429 + HTTP-date `Retry-After` evaluated vs fake clock; 5xx×2-then-success sequence; network-exhaustion ⇒ terminal `TrackerError` with `attempts = maxRetries + 1` and final category; `maxRetries: 0` override ⇒ 1 attempt; `create-failure/` scenario on `issueCreate` (429/5xx/network) ⇒ EXACTLY one request observed, `IndeterminateCreateError`, no replay ("Issue creation MUST never be automatically retried; a failed create is recorded as indeterminate and reconciled, not replayed"); 401 ⇒ `auth` category, detail names env-var name, never the sentinel value
- [ ] T035 [P] [US2] Identity/attachment integration tests `tests/integration/tracker-identity-attachments.test.ts`: adversarial fixtures `tests/fixtures/tracker/scenarios/adversarial-descriptions/` — descriptions embedding UUID-shaped text yield **0** matches on both bindings (SC-003: "Identity lookups resolve 100% via attachment metadata and 0 via description content"); `upsert-idempotency/` — two upserts of one canonical URL ⇒ exactly 1 attachment updated in place, adapter stores no attachment id (SC-002, FR-005); `findIssuesByAttachmentUrl` returns all 0/1/2+ carriers (>1 = the caller's constitution-II integrity signal — port reports, does not hide); `getAttachmentByUrl` absent ⇒ `null`; `listAttachments` cursor pages + scan route finds the identity-bearing attachment (FR-004's "scan the issue's attachments" route)
- [ ] T036 [P] [US2] Chain-walk integration tests `tests/integration/tracker-chain-walk.test.ts`: recorded `attachment-chain/` scenario (pages 0..N present; separate gap world) through the REAL adapter — continuation pages "addressed purely by URL (scheme contract)"; request-count proof = one lookup per probed page + bounded orphan window; end-to-end `enumerateAttachmentChain` result equals the fake binding's (parity)

### Implementation for User Story 2

- [ ] T037 [US2] Implement `src/tracker/operations/mutations.ts` (replacing the T023 shell): `getIssue` (`issue(id)` → view; not-found ⇒ `null`), `createIssue` (`issueCreate` with `teamKey → teamId` resolution; request class `"never"` — the ONLY never-retried path; post-dispatch failure ⇒ `IndeterminateCreateError`), `updateIssue` (partial `IssueUpdatePatch` → `issueUpdate` input incl. `stateTypeId → stateId` name mapping), `archiveIssue` (`issueArchive`; `success: false` ⇒ `graphql`/`client` error) — per contracts/tracker-adapter.md rows 3–6
- [ ] T038 [US2] Implement `src/tracker/operations/attachments.ts` (replacing the T023 shell): `upsertAttachmentByUrl` → `attachmentCreate` (platform URL idempotency IS the frozen "updates in place, no duplicate, no attachment id stored anywhere by callers" semantic — no read-before-write, no client-side check-then-create race, per R7); `findIssuesByAttachmentUrl`/`getAttachmentByUrl` → `attachmentsForURL` (the identity route; map carriers to deduped `IssueView[]` / first-or-null); `updateAttachment` → `attachmentUpdate(id, { metadata })`; `listAttachments(issueId, cursor?)` → `issue(id).attachments(first: pageSize, after:)` → frozen `Page<AttachmentView>`
- [ ] T039 [US2] Implement `src/tracker/chain.ts` (replacing the T023 shell): `resolveIssueByTaskIdentity` (page-0 URL via 002's frozen `canonicalAttachmentUrl`; 0 ⇒ null, ≥1 ⇒ all carriers), `issueCarriesTaskIdentity` (scan route over `listAttachments` cursors), `enumerateAttachmentChain` per T033 (sequential upward probes of deterministic paged URLs via `continuationAttachmentUrl`; stop at first absent index; bounded `orphanProbeLimit` lookahead reporting `orphans`; R8: "the minimum machinery that detects… the page-3-missing/page-4-present case") — usable against ANY `LinearPort` including the fake (type-level negative test T049) (depends on T038)
- [ ] T040 [US2] Finalize recorded scenarios under `tests/fixtures/tracker/scenarios/`: `adversarial-descriptions/`, `attachment-chain/`, `upsert-idempotency/`, `rate-limit-sequences/`, `create-failure/` per data-model §8 (retry sequences as ordered `NN-*.json` pairs; `Retry-After` headers as first-class fixture data; no `Authorization`, placeholder identities, synthetic UUIDs); confirm parity real-binding CRUD/attachments/chain/error-taxonomy scenarios auto-flip from skip to run and pass (no edits to the binding runner or suite logic)
- [ ] T041 [US2] Story checkpoint: `npm run test:unit -- --test-name-pattern "chain"`, `npm run test:integration -- --test-name-pattern "identity|attachment|chain|resilience"`, `npm run test:contract` — all GREEN incl. FULL parity on both bindings (zero remaining real-binding skips); record results against `specs/007-issue-tracker-integration/quickstart.md` US2 rows 1–6 (SC-002/SC-003 evidence)

**Checkpoint**: US1 AND US2 fully functional on the real adapter, identical to the fake (complete parity), resilience/credential posture constitution-exact. 008's mutations, 011's history reads, 006's identity lookups all have their substrate.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Structural enforcement of the constitution/contract negatives, security tier, e2e walkthroughs, packaging proof, documentation duty.

- [ ] T042 [P] Create document-allow-list contract test `tests/contract/tracker-doc-allowlist.test.ts` per R12/quickstart US2.1: parse `src/tracker/graphql/documents.ts`; assert the exported operation set equals the T017 enumerated allow-list; fail on any occurrence of a search operation (`searchIssues`, `searchDocuments`, …) or `description` in any filter position — FR-004 "MUST NOT search issue descriptions for identity" enforced structurally
- [ ] T043 [P] Create dependency-budget contract test `tests/contract/tracker-dependency-budget.test.ts`: parse `package.json`; assert runtime `dependencies` count ≤ 1 (constitution ceiling: "runtime dependencies limited to Node built-ins plus exactly one platform transport dependency") and currently **0** (research R1's deliberate unspent budget); a new dependency trips the test as a deliberate, visible amendment
- [ ] T044 [P] Create no-direct-tracker-access contract scan `tests/contract/tracker-no-direct-access.test.ts`: scan all `src/**` outside `src/tracker/` for `fetch(`, `linear.app`, `Authorization`, or imports of `src/tracker/internal|http` — zero hits required (constitution V: "All Linear access MUST flow through the injectable `Linear_Port` so no component bypasses the port's retry, rate-limit, and diagnostic posture" + "Port and adapter architecture: All Linear GraphQL access MUST be routed through the injectable `Linear_Port` interface; no component may issue Linear requests otherwise")
- [ ] T045 [P] Create packaging contract test `tests/contract/tracker-packaging.test.ts` (mirrors 002's package-surface style): `./tracker` and `./tracker/testing` resolve via self-referencing imports; per-module `.js` + `.d.ts` + `.d.ts.map` exist for every `src/tracker` module; `types` condition listed first; the two new entries are the ONLY diff to the exports map (frozen subpaths untouched)
- [ ] T046 [P] Create hygiene contract scan `tests/contract/tracker-hygiene.test.ts`: walk `tests/fixtures/tracker/**` + shipped `src/tracker` string constants — no credential-header keys in recorded pairs (`authorization`/`cookie` case-insensitive ⇒ fail), no `lin_api_`-shaped token values, no email shapes, no non-synthetic-looking org identifiers (placeholder-corpus allow-list of `acme-team`/`proj-*`/`ACM-`/`*.example.invalid`); supports the release gate: "fails the release — publishing nothing — if any real organization identifier, token, or UUID value is detected"
- [ ] T047 [P] Create credential-sentinel security sweep `tests/contract/tracker-credential-sentinel.test.ts` per resilience contract §5: plant a unique sentinel as the env token value; drive the full failure matrix (401/403/404/429-exhaustion/5xx-exhaustion/network/graphql-errors/`FixtureMiss`-equivalent server 500); assert the sentinel string appears in ZERO captured `TrackerError.detail`s, diagnostics, and thrown-message trees (constitution: credentials "MUST NEVER appear in diagnostics, logs, reports, web responses, or MCP outputs")
- [ ] T048 [P] Create scripted e2e walkthroughs `tests/e2e/tracker-user-stories.test.ts`: US1 (build config fixture → fake world → full inventory walk + metadata → assert isolation partitions) and US2 (identity resolve → upsert twice → chain enumerate → scripted rate-limit recovery → create-failure indeterminate) over fake + recorded bindings, zero network (quickstart "Test tiers" e2e row; constitution VI thin top layer)
- [ ] T049 [P] Create negative-type assertion file `tests/types/tracker-negative.test-d.ts` (compiled by `npm run typecheck`) per quickstart "Gate sanity": `LinearPort`-typed variable accepts BOTH `createLinearPort(...)` and `createFakeLinearPort(...)` (structural conformance compile-checked); no retry/timeout knob exists in any port method signature (frozen invariant 2); `enumerateAttachmentChain`/`resolveIssueByTaskIdentity` accept any `LinearPort` — not the concrete adapter type
- [ ] T050 [P] Author documentation per constitution "Documentation duty": create `docs/tracker-integration.md` (subpath usage `task-linear-sync/tracker` + `/tracker/testing`, credential env-name config + pre-flight behavior, resilience posture summary, fixture-corpus extension guide, placeholder identifiers ONLY) and add a single additive pointer section in `README.md` (no edits to 002's sections; keep the docs claim "whenever a public API… or configuration key… changes, the documentation MUST be updated in the same change" satisfied for the two new subpaths)
- [ ] T051 Full-feature validation: `npm test` (all tiers + inherited coverage-threshold gate) GREEN; `npm run build` emits `dist/tracker/**` + `dist/tracker/testing/**`; `git diff --stat main -- tests/contract/snapshots/ src/domain src/config src/state src/urls src/gates src/ports tests/contract/frozen-surface.test.ts tests/contract/package-surface.test.ts tests/contract/frozen-surface.json` empty (frozen surface byte-identical proof); run the full quickstart.md validation checklist (US1 1–4, US2 1–6, contract 1–5, security 1–3) and record FR-001…FR-006 / SC-001…SC-003 traceability results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (002 contracts already merged on main)
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories** (US1/US2 implement operation modules behind the factory T022 that consume the request site T019, documents T017, mapping T018; parity T010/T011 requires the fake T020 + harness T021)
- **User Stories (Phases 3–4)**: Both depend only on Foundational → then proceed **in parallel** (US1: `scoping.ts`, `pagination.ts`, `operations/inventory.ts` + own fixtures; US2: `operations/mutations.ts`, `operations/attachments.ts`, `chain.ts` + own fixtures — disjoint file sets by T023's ownership split)
- **Polish (Phase 5)**: Depends on all desired stories (T042–T047 enforce whole-feature negatives; T051 needs both bindings' parity complete)

### User Story Dependencies

- **US1 (P1)**: After Phase 2; zero dependency on US2 (inventory needs no mutation or attachment capability)
- **US2 (P2)**: After Phase 2; zero runtime dependency on US1 (`chain.ts` rides `getAttachmentByUrl`/`findIssuesByAttachmentUrl`/`listAttachments` — all US2-owned; resilience tests drive non-create members that US2 itself implements); the shared pieces (request site, resilience, mapping) live in Foundational, so neither story edits the other's files

### Within Each User Story

- Tests written first and observed FAILING (constitution VI), then implementation
- Pure predicate (`scoping.ts`) before iterator (`pagination.ts`) before operation (`operations/inventory.ts`); attachments before chain (`chain.ts` scan route)
- Recorded-scenario finalization follows its operation implementation (operation defines `operationName`s the fixtures must match)
- Story checkpoint green before claiming completion

### Parallel Opportunities

- Setup: T003 ∥ T004 after T001/T002 (T001→T002 sequential on package-adjacent files)
- Foundational: T005–T011 (all test files) fully parallel; T012–T018 (posture core, disjoint files) parallel after their test files exist; T019 after T012/T014/T015/T016; T020 ∥ T021 (fake vs harness — different files); T022 after T015/T016/T019; T023 with T022; T024 final
- **US1 ∥ US2 fully parallel after the Foundational checkpoint** (T025–T032 vs T033–T041 share zero files — T011's auto-skip design removes the only shared-file touch point)
- Within US1: T025 ∥ T026 ∥ T027 (test files); US2: T033 ∥ T034 ∥ T035 ∥ T036 (test files)
- Polish: T042–T050 in parallel (each its own file); T051 last

---

## Parallel Example: After Foundational (both stories at once)

```bash
# Dev A — User Story 1 (RED first, disjoint files):
Task: "Scoping unit tests in tests/unit/tracker-scoping.test.ts"                 # T025
Task: "Pagination unit tests in tests/unit/tracker-pagination.test.ts"           # T026
Task: "Inventory integration tests in tests/integration/tracker-inventory.test.ts"  # T027
# then: T028 scoping.ts → T029 pagination.ts → T030 operations/inventory.ts → T031 fixtures → T032 checkpoint

# Dev B — User Story 2 (RED first, disjoint files):
Task: "Chain unit tests in tests/unit/tracker-chain.test.ts"                     # T033
Task: "Resilience-over-HTTP tests in tests/integration/tracker-resilience-http.test.ts"     # T034
Task: "Identity/attachment tests in tests/integration/tracker-identity-attachments.test.ts" # T035
Task: "Chain-walk tests in tests/integration/tracker-chain-walk.test.ts"         # T036
# then: T037 mutations.ts ∥ T038 attachments.ts → T039 chain.ts → T040 fixtures → T041 checkpoint
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; also ships the fake + harness the rest of the system needs)
3. Complete Phase 3: US1 inventory
4. **STOP and VALIDATE**: `npm run test:integration -- --test-name-pattern "inventory"` + `npm run test:contract` green; SC-001 (100% in / 0 out) recorded; parity flips inventory/metadata scenarios to two-binding green
5. 006 (matching) can already consume `listIssues`/`discoverMetadata`; Wave-3 008 sees the read side complete

### Incremental Delivery

1. Setup + Foundational → transport/resilience/credential posture + the hermetic fake + parity harness → consumers get `./tracker/testing` (unblocks other features' fake-based tiers)
2. Add US1 → real-adapter inventory + metadata → MVP demo against recorded multi-team corpus
3. Add US2 → CRUD/attachments/chain + full resilience proof → complete port parity (zero skips) → quickstart fully runnable
4. Polish → structural negatives (allow-list, scans, budget), security sweep, e2e, docs → merge-ready

### Parallel Team Strategy

1. One dev: Setup + Foundational (it is the shared substrate — sequential or lightly parallel per the list above)
2. Then split: Dev A: US1 (`scoping`/`pagination`/`operations/inventory`); Dev B: US2 (`operations/mutations`+`attachments`/`chain`) — zero shared files by design (T023 ownership split + T011 auto-skip)
3. Reunite for Phase 5 (contract scans, security sweep, e2e, docs)

---

## Notes

- [P] tasks = different files, no dependencies; verify RED before GREEN at each story checkpoint (constitution VI)
- **Zero live platform calls in any automated tier** — fake + recorded fixtures only (spec mission + constitution VI/Hermetic pipelines); network egress is structurally absent from tests (no credentials exist in the environment)
- **No runtime dependency added** (R1): `dependencies` stays `{}`; T043 guards the ≤ 1 constitution budget; SDK adoption (if ever) = exact pin + transport-seam-only swap
- Frozen contracts untouched: this feature imports `src/ports/linear-port.ts`, `src/urls/attachment-url.ts`, `src/config/schema.ts` types, `src/state/clock.ts` — never edits them; T051's git-diff check is the merge-gate proof (ROADMAP rule 2; amendment-only otherwise)
- Credential rule everywhere: only env-var **names** are config; values read at construction into the bundle; sentinel sweep (T047) proves non-leak; recorded fixtures carry no `Authorization` (T046)
- Placeholders only in fixtures/constants (`acme-team`, `proj-alpha`, synthetic UUIDs, `sync.example.invalid` base host via 002 defaults) — T046 hygiene scan; zero org literals in shipped constants (R11)
- Chain negatives and description-search prohibition are enforced STRUCTURALLY (T042 allow-list) and adversarially (T035) — not by happy-path hope
- The `apiUrl` config-FILE override is a deliberate deferral documented in research R11 as a 001-noted amendment candidate; do NOT edit `src/config/schema.ts` to squeeze it in
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: touching another Wave-2 feature's files; editing `tests/contract/tracker-conformance.test.ts` per story (T011's auto-skip exists precisely to avoid that); adding a test-framework or retry dependency
