# Phase 0 Research: Issue-Tracker Integration Port

**Feature**: `007-issue-tracker-integration` | **Date**: 2026-10-22

The spec left no NEEDS CLARIFICATION; this document resolves the Technical Context unknowns
that planning surfaced — above all **the first-platform-dependency decision** (R1) — plus
auth/secrets handling (R5), rate-limit/retry/resilience patterns (R4), the port-to-platform
behavior mapping (R6–R10), the hermetic-testing architecture (R9), and the configuration
extension surface (R11). Each entry is Decision / Rationale / Alternatives considered.
Platform facts (attachment URL idempotency, `attachmentsForURL`, Relay cursor pagination,
SDK client surface) are from Linear's published developer documentation (linear.app/developers,
2026-10).

## R1 — Platform transport dependency (THE first-dependency decision)

- **Decision**: **Add no runtime dependency.** The Linear GraphQL transport is implemented
  over Node ≥ 20's built-in `fetch` behind the minimal `HttpTransport` seam (R3). The
  constitution's allowance — "runtime dependencies limited to Node built-ins plus exactly
  one platform transport dependency" — is treated as a **ceiling, not a quota**: 007 spends
  none of it. `package.json` `dependencies` stays empty; the new contract test
  `tests/contract/tracker-dependency-budget.test.ts` asserts the runtime dependency count
  is ≤ 1 and currently **0**, so any future addition is a deliberate, visible act.
- **Rationale**: (a) *Resilience-rule fidelity.* The constitution's resilience constraint
  is unusually precise: retry only 429/5xx/network, exponential backoff with randomized
  jitter, up to the configurable maximum, **honoring `Retry-After`**, and **creates never
  automatically retried**. Satisfying "honoring Retry-After" requires the raw HTTP status
  and response headers at the retry decision point; a higher-level client that normalizes
  failures into its own error model (the official SDK wraps errors into `LinearError`
  shapes) either loses those fields or forces use of its raw escape hatch — at which point
  the typed layer the dependency exists for is bypassed anyway. (b) *Create-never-retried
  by construction.* With one self-owned request site the guarantee is structural (the
  request site takes an explicit per-operation-class retry permission; `createIssue` passes
  never) rather than "a third party's default-on retry is hopefully disabled". (c) *The
  typed surface is already frozen.* 002 froze `IssueView`/`AttachmentView`/`Page<T>`; the
  adapter hand-writes ~10 small GraphQL documents and a mapping table (R10) — the codegen
  surface an SDK brings is ~unused, while its transitive tree (GraphQL client, codegen
  types) would become the package's first runtime supply-chain liability. (d) *Hermetic
  determinism* (all test tiers, no live calls): one `fetch` seam is the smallest possible
  injection point for the recorded-fixture driver (R9). (e) 002's R1/R2 posture
  ("zero build/runtime dependencies; minimal dev surface") is preserved without a
  deviation note — the dependency path would have needed one under the constitution's
  "complexity that appears to circumvent a principle MUST be justified" clause; zero-dep
  needs no justification. (f) The choice stays **reversible**: adoption of an SDK later
  touches only `src/tracker/internal/` + `src/tracker/http.ts` + `package.json` — port,
  fake, and every test above the transport seam are untouched.
- **Alternatives considered**:
  - `@linear/sdk` (official typed GraphQL client; the value the 002 plan earmarked as "the
    single platform transport dependency (Linear GraphQL) … arrive[s] with features
    007/012"). Rejected for 007: `LinearClientOptions` exposes `apiKey`/`apiUrl`/`RequestInit`
    but no documented jitter or `Retry-After` control, its error normalization
    (`LinearError`) sits between us and the HTTP semantics our retry classifier needs
    (`rawRequest` restores them but skips the typed models), its pagination/connection
    models do not match the frozen port's complete-page iterator contract (R6) so
    hand-driving cursors remains necessary, and accepting its transitive dependency tree
    buys a typed surface replaced here by ~10 hand-written documents constrained to an
    allow-list (R12). If maintainers later prefer it, adopt as an **exact pin +
    lockfile commit** inside the transport seam only — the R1 module boundary is designed
    for that swap, and the dependency-budget test (≤ 1) already bounds it.
  - `graphql-request` / raw `graphql` package — rejected: generic-GraphQL plumbing without
    platform value; same error-normalization friction; still the first runtime dependency.
  - Hand-rolled `node:http` keep-alive agent — rejected: `fetch` (undici) is built-in,
    timeout-controllable via `AbortSignal`, and keeps the seam one method; raw `http`
    reinvents connection handling for no constitutional benefit.
- **Consequence for tasks**: no dependency-addition task exists in Setup; instead Setup
  carries the guard test (dependency budget = 0 with the ceiling documented).

## R2 — Test runner and tier wiring (inherited)

- **Decision**: `node:test` + `node:assert/strict` on compiled output, existing tiers via
  `scripts/run-tests.mjs`; 007 adds files, not infrastructure (`test:unit` / `test:contract`
  / `test:integration` / `test:e2e` unchanged; coverage threshold gate inherited).
- **Rationale**: 002 R2 already decided the runner and its hermeticism rationale; Wave 2
  must not churn shared tooling (ROADMAP parallel-safety). The compiled-output import model
  additionally makes the new `./tracker` / `./tracker/testing` subpath exports themselves
  part of the contract surface tested.
- **Alternatives considered**: per-feature runner config — rejected: shared-file churn and
  drift; fast-check for property tests — rejected: a dev dependency contradicts the
  minimal-dev-surface posture for a capability we implement in ~20 lines with a seeded PRNG
  (deterministic, Principle IV) — see R9/quickstart property obligations.

## R3 — Transport seam and the single request site

- **Decision**: One interface, one implementation, one caller.
  `HttpTransport { postJson(req: HttpRequest): Promise<HttpResponse> }` with
  `HttpRequest { json: unknown; accessToken: string; timeoutMs: number }` (opaque to
  consumers) and `HttpResponse { status: number; headers: Record<string,string>; body:
  unknown }`. The built-in-`fetch` implementation (`src/tracker/http.ts`) sets
  `Authorization`/`Content-Type`, parses JSON, and never logs. `src/tracker/internal/request.ts`
  is the **only** module composing credentials (R5) → resilience wrapper (R4) → transport →
  error mapping (R12); every GraphQL operation in the port goes through it exactly once.
- **Rationale**: Constitution V demands one posture ("no component bypasses the port's
  retry, rate-limit, and diagnostic posture"); a single request site makes that a
  one-file review + a scan test, not a code-review hope. The seam is also the recording
  boundary for hermetic fixtures (R9): production = fetch; contract/e2e = recorded-replay
  driver; unit tests need no transport at all (they drive `request.ts` with an inline stub).
- **Alternatives considered**: injecting `fetch` directly — rejected: `fetch`'s signature
  invites header/body handling at every call site, re-spreading the posture; per-operation
  retry decorators — rejected: operation-level retry knobs are exactly what tracker-port
  invariant 2 forbids ("the interface carries no retry knobs"); a generic HTTP client
  class with middleware chains — rejected: more machinery than one POST endpoint requires.

## R4 — Resilience: classification, backoff schedule, Retry-After, and the create guard

- **Decision** (normative detail in contracts/resilience-and-credentials.md):
  - **Classification** at the request site: network/timeout errors, HTTP 429, HTTP 5xx ⇒
    `retryable`; other HTTP 4xx ⇒ `auth`/`not-found`/`client` (not retryable); HTTP 200 with
    GraphQL `errors` ⇒ `graphql` (not retryable; user-input errors do not become transient
    by retrying).
  - **Schedule**: up to `maxRetries` (config, default 5) **additional** attempts after the
    first (≤ 6 requests total for non-create ops); delay for attempt k =
    `min(baseMs · 2^k, maxDelayMs)` with **equal jitter** (`delay/2 + rng()·delay/2`),
    `baseMs = 250`, `maxDelayMs = 15_000` (007-local constants in `src/tracker/options.ts`);
    a `Retry-After` header (delta-seconds **or** HTTP-date, parsed defensively) **replaces**
    the computed delay when present, clamped to `[0, maxDelayMs]`; delays execute through an
    injected `sleep(ms)` — no wall-clock in tests.
  - **Create guard**: `request.ts` takes a mandatory `retryPolicy: "non-create" | "never"`;
    `createIssue` is the only `"never"` call path — compile-time and runtime identical
    enforcement. A post-dispatch create failure maps to `IndeterminateCreateError`
    (category `create-indeterminate`), surfaced, not replayed; 008's create-intent journal
    records and reconciles it (002 R10 / constitution wording: "a failed create is recorded
    as indeterminate and reconciled, not replayed").
  - **Concurrency**: at most `concurrency` (default 4) in-flight requests per client via a
    local semaphore; pagination chains one page at a time per team, so the cap matters when
    several teams list in parallel.
- **Rationale**: Implements the constitution Resilience constraint verbatim with concrete,
  testable numbers; equal-jitter (rather than full jitter) keeps retries from collapsing to
  near-zero waits under 429 storms while staying one RNG draw. Injecting rng/sleep makes
  "randomized jitter" deterministic under test (Principle IV/VI) instead of slept-at.
- **Alternatives considered**: full jitter — rejected: expected-throughput win is irrelevant
  at this request volume, and near-zero first retries worsen 429 feedback; respecting
  `Retry-After` only for 429 — rejected: the constraint says "honoring Retry-After" without
  restricting the status; 5xx responses frequently carry the real back-off hint; letting the
  SDK/client retry — rejected outright (R1b: create-replay risk).

## R5 — Credential handling and pre-flight diagnostics

- **Decision**: At `createLinearPort()` construction: read values **only** from
  `config.credentialEnvVarNames.token` / `.apiKey` env-var names (the injected `env` map in
  tests); if the selected name is unset or empty → throw `TrackerConfigError` **before any
  request**, naming the env-var name and the fix, never any value. When set, a shape check
  warns (via an injected diagnostic reporter, non-fatal) if the token does not start with
  `config.personalKeyPrefix` (default `lin_api_`) — the diagnostic text contains the env-var
  **name** and the expected prefix constant only. The bearer value flows exclusively into
  `HttpRequest.accessToken` → the `Authorization` header; `TrackerError.detail` rendering
  and every diagnostic pass through a sanitizing guard that strips the (internally held)
  token string, and the security tier proves non-leak with a sentinel value planted in the
  env (quickstart security scenarios). Only one of token/apiKey is used per client (token
  route default; `apiKey` name kept configurable per frozen schema — selection is a
  007-local option defaulting to `token`).
- **Rationale**: Direct implementation of the constitution's credential constraint and of
  the spec assumption "Credentials come from configured environment variables with
  pre-flight diagnostics (constitution); this spec owns no credential logic" beyond exactly
  this read-and-reject duty. Sanitizer + sentinel test converts "never appear in
  diagnostics, logs, reports…" from a hope into an enforced property.
- **Alternatives considered**: lazily reading env at request time — rejected: pre-flight is
  mandated ("before any request when unset or empty"); embedding the token in `TrackerClientOptions`
  — rejected: an options-object credential path bypasses env-name config and invites logging
  of the options bag; keychain integration — out of scope (constitution names env vars; 002
  config has no keychain key).

## R6 — Pagination and per-team scoping for `listIssues`

- **Decision**: One Relay-cursor query per page per team:
  `issues(first: $pageSize, after: $after, filter: { team: { key: { eq: $teamKey } },
  project: { id: { in: $projectIds } }, state: { type: { nin: $ignoredStateTypes } } })
  { nodes { …IssueFields } pageInfo { hasNextPage endCursor } }`, iterated per configured
  team **in configured `teamKeys` order**, each team's pages fetched sequentially
  (`after = endCursor` until `hasNextPage = false`) — teams proceed in parallel up to the
  R4 concurrency semaphore. `pageSize` is validated `1..250` (platform connection max) with
  clamping + diagnostic. Inclusion is thus enforced **twice**: server-side by the filter and
  client-side by a pure guard predicate (`scoping.ts`) re-checking every returned
  `IssueView` (team ∈ scope, project ∈ that team's projects, stateType ∉ that team's
  ignored types) — a guard violation aborts the listing rather than leaking a row. The
  frozen `AsyncIterableIterator<IssueView>` contract ("Yields complete pages; failure after
  retries surfaces with no partial-inventory consumption") is honored by fetching **whole
  pages** internally and only then yielding that page's views; a page that fails after
  retries throws from the iterator with nothing of that page emitted (prior pages already
  yielded remain consumed by design — the *failed page* is never partially consumed; spec
  edge case "Mid-pagination failure"). Cross-team trap coverage: per-team filters (never a
  global project-id filter) mean an issue in team A cannot satisfy team B's page; the client
  guard catches any fake/fixture misbehavior and the integration corpus plants exactly such
  traps (SC-001 "0 out-of-scope issues").
- **Rationale**: Per-team queries are the only scoping shape that cannot leak (one filtered
  request per team); the double enforcement is belt-and-braces for a rule the port contract
  calls never-leak; sequential pages per team bound memory to one page.
- **Alternatives considered**: one global `filter: { team: { key: { in: [...] } } }` query —
  rejected: project and ignored-state filters are **per-team** (frozen `IssueScope.perTeam`);
  a single query would intersect cross-team project sets and leak scoping; offset/limit
  pagination — not offered by the platform (Relay cursors only); materializing the full
  inventory before first yield — rejected: the frozen signature is a streaming iterator and
  memory should scale with pages, not corpus size.

## R7 — Attachment operations and the URL-idempotent upsert (platform mapping)

- **Decision**: Port member → platform operation (full table in
  contracts/tracker-adapter.md): `upsertAttachmentByUrl` → `attachmentCreate(input:
  {issueId, title, subtitle, url, iconUrl, metadata})` — the platform's documented
  idempotency ("if you try to re-create an attachment with the same URL on the same issue,
  the original attachment is updated instead") **is** the frozen "updates in place, no
  duplicate, no attachment id stored" semantic; `getAttachmentByUrl` /
  `findIssuesByAttachmentUrl` → `attachmentsForURL(url)` (identity route — URL query; the
  scan route is `listAttachments` over a known issue, never a description search);
  `updateAttachment(id, metadata)` → `attachmentUpdate(id, input: { metadata })`;
  `listAttachments(issueId, cursor)` → `issue(id) { attachments(first: pageSize, after:) }`
  mapped to frozen `Page<AttachmentView>`; issues: `issue(id)`, `issueCreate`,
  `issueUpdate`, `issueArchive`; metadata is the platform's flat string|number map (frozen
  `AttachmentMetadata` "flat by rule").
- **Rationale**: The frozen port was clearly cut along these documented platform seams;
  implementing the mapping table 1:1 keeps adapter logic thin (mapping + resilience +
  pagination — no invented semantics) and lets the fake reproduce observable behavior
  without emulating platform internals beyond documented ones.
- **Alternatives considered**: read-before-write upsert (`attachmentsForURL` then
  create/update) — rejected: the platform already upserts atomically by URL, and a
  client-side check-then-create introduces a duplicate race the deterministic-URL design
  exists to eliminate; using `attachmentLinkURL` shorthand — rejected: it drops `metadata`,
  which carries the sync-state payload (identity anchor); cross-workspace URL-uniqueness
  enforcement inside the port — out of scope: >1 issue carrying the same task UUID is a
  constitution-II integrity failure decided by 006/008 matching, and the frozen
  `findIssuesByAttachmentUrl` correctly returns **all** carriers so callers can abort.

## R8 — Identity resolution and the chain walk (007-local behaviors)

- **Decision**: `chain.ts` exposes (a) `resolveIssueByTaskIdentity(port, urlCfg, taskUuid)`
  — builds the page-0 canonical URL with 002's frozen `canonicalAttachmentUrl`, returns the
  issues from `findIssuesByAttachmentUrl` (0 → null, 1 → issue, >1 → returned array; the
  integrity abort is the caller's per R7) — plus the documented scan alternative
  `issueCarriesTaskIdentity(port, urlCfg, issueId, taskUuid)` via `listAttachments` cursor
  paging; and (b) `enumerateAttachmentChain(port, urlCfg, taskUuid)` — probe
  `getAttachmentByUrl` for the canonical (page 0) then `continuationAttachmentUrl(page)` for
  1, 2, … upward, **stopping at the first absent index** (frozen wording); then, to satisfy
  the spec edge case "orphaned higher pages are reported, not silently skipped", it probes a
  **bounded orphan window** of the next `orphanProbeLimit` (default 8) indices and reports
  any present-but-discontiguous pages as `orphans: number[]` (indices). Result shape
  (data-model §6): `{ taskUuid, canonical: AttachmentView | null, pages: AttachmentView[],
  orphans: number[] }`. Identity matching keys solely off the page-0 attachment (SC-003
  posture); continuation pages are pure URL addressing — no parsing beyond 002's frozen
  `parseAttachmentUrl` when the fake/adapter needs it.
- **Rationale**: The frozen port deliberately stops at URL-addressed attachment ops and
  assigns the walk to 007; a bounded probe window is the minimum machinery that detects
  (rather than silently skips) the page-3-missing/page-4-present case while keeping cost
  O(pages + window) and hermetic. Sequential upward probing (not binary search) matches
  "indices increment from 1" short chains.
- **Alternatives considered**: unbounded probing until an absolute cap — rejected: wasted
  round-trips on every ordinary task; enumerating via `listAttachments` and parsing URLs —
  rejected: O(all attachments) where deterministic addressing is O(pages); treating orphans
  as part of the chain — violates the frozen stop-at-first-absent-index rule; parallel
  page probes — rejected: page 0's existence gates the walk and sequentiality keeps
  request counts observable in tests.

## R9 — Hermetic test architecture: fake, recorded fixtures, fake-vs-real parity

- **Decision**: Three hermetic layers, zero live calls in **any** automated tier.
  (1) **The fake** (`src/tracker/testing/fake-port.ts`, shipped via `./tracker/testing`):
  an in-memory world (issues, per-issue attachment lists with opaque cursors,
  attachments-by-URL index, teams/projects/workflowStates, scripted per-operation failures)
  reproducing observable port behavior **including** URL-idempotent upsert, per-team
  scoping filtering, cursor pagination, and mid-pagination failure injection. It is the
  fake every other feature injects (constitution VI middle tier).
  (2) **The recorded-fixture driver** (`src/tracker/testing/harness.ts`): an `HttpTransport`
  implementation replaying `tests/fixtures/tracker/scenarios/<name>/` recorded
  request→response pairs (matched by GraphQL `operationName` + salient variables; numbered
  sequence files for retry scenarios). The **real adapter** runs against it at the
  contract/integration/e2e tiers — HTTP status codes and headers preserved, `Authorization`
  header redacted at record time (fixtures contain no credentials, ever).
  (3) **The parity suite** (`tests/contract/tracker-conformance.suite.ts`, run by
  `tests/contract/tracker-conformance.test.ts` against both implementations): one shared
  behavioral suite — pagination completeness, scoping exactness + traps, metadata triples,
  CRUD round-trips, identity-via-attachments (+ adversarial UUID-in-description negatives),
  upsert idempotency, chain semantics, mid-pagination failure, error taxonomy — parameterized
  over `{ fake, realOverRecorded }`. This **is** the constitution's required "contract
  (fake-versus-real `Linear_Port`)" test and the additional-constraint requirement that the
  fake "MUST conform to the same behavioral contract as the real implementation and be
  contract-tested against it". Property obligations (seeded PRNG per R2): repeated
  create-or-update of one URL yields exactly 1 attachment (SC-002); every yielded inventory
  issue is in scope for its team (SC-001); chain results identical across repeated runs of
  the same world (Principle IV).
- **Rationale**: The fake alone cannot test the real adapter's HTTP-facing posture (status
  classification, Retry-After, redaction); recorded fixtures alone cannot give other
  features a programmable world; parity is the only construct that keeps the two honest as
  Wave 3/4 lean on the fake. Fixtures-as-data (not code) keeps the corpus auditable for
  zero-org-literals (hygiene scan) and credential-free by construction.
- **Alternatives considered**: HTTP record-and-replay middleware over real `fetch`
  (nock-style) — rejected: a dev dependency and monkey-patching fights the clean seam;
  importing `@linear/sdk` in tests to compare semantics — rejected (R1; also would force
  the SDK into dev deps); snapshot-testing raw GraphQL bodies only — rejected: proves
  bytes, not behavior; the suite would still need the behavioral layer.

## R10 — Field mapping and identifier resolution (port ↔ platform)

- **Decision**: `graphql/mapping.ts` holds the single response→view mapping (full table in
  data-model.md §10): `IssueView.id/key/teamKey/projectId/title/description/stateType/
  updatedAt/archived` ← `Issue.id/identifier/team.key/project.id/title/description/
  state.type/updatedAt/archivedAt`; `AttachmentView.id/url/title/subtitle/metadata` ←
  `Attachment.id/url/title/subtitle/metadata`; `TeamMetadataCollections` ← team nodes with
  `projects { id name }` and `states { id name type }`. **Identifier resolution**: config
  carries team **keys** and per-team **project identities**; `discoverMetadata`
  (`teams(filter: { key: { in: $teamKeys } })` with projects + workflowStates in one query)
  resolves project identities → platform project ids used by R6's filter, and the create
  path resolves `teamKey` → `teamId` (platform `issueCreate` requires a team id) through the
  same per-client metadata cache (per-call lifetime; no staleness policy needed — a fresh
  port instance rediscovers). Unknown identity in scope → `TrackerConfigError` naming the
  team + identity (never a silent empty page).
- **Rationale**: Keeps every mapping decision visible in one file and greppable against the
  frozen views; resolving identities through discovery (rather than assuming name==id) is
  what lets 002's placeholder-identity fixtures exercise the real mapping in contract tests.
- **Alternatives considered**: assuming configured project strings are platform UUIDs —
  rejected: 001/002 deliberately call them "identities" (names are legitimate); persistent
  cross-call metadata cache — rejected: staleness policy is engine-level (008 re-fetch
  discipline), a per-call cache satisfies pagination/create without invalidation logic;
  GraphQL fragments/codegen typing — rejected with R1 (no codegen toolchain).

## R11 — Configuration extension surface (`TrackerClientOptions`), no frozen-schema edits

- **Decision**: The adapter consumes frozen `ResolvedConfig` for every knob 002 froze
  (`pageSize`, `maxRetries`, `concurrency`, `personalKeyPrefix`, `credentialEnvVarNames`,
  `ignoredStateTypes`, attachment templates/base-host via the URL builders). The values
  002's frozen schema does not contain — GraphQL endpoint URL, request timeout, backoff
  constants, orphan-probe window, injected transport/clock/rng/sleep/env — live in
  `TrackerClientOptions` (007-local, `src/tracker/options.ts`) with built-in defaults:
  `apiUrl = "https://api.linear.app/graphql"` (public platform endpoint constant — not a
  consumer-organization identifier; invisible to the release-scan heuristics, which flag
  UUID/`lin_api_`-value/secret/email shapes), `timeoutMs = 30_000`, plus R4's
  `baseMs`/`maxDelayMs` and R8's `orphanProbeLimit = 8`. `ResolvedConfig` is **not**
  extended: adding an `apiUrl` key to the frozen schema (for config-**file** overridability
  under Principle III's merge chain) is recorded here as a **candidate cross-feature
  amendment** noted against 001, out of scope per ROADMAP rule 2 — programmatic override
  exists from day one, and no FR in this spec requires a file-level endpoint override.
- **Rationale**: Constitution III is honored within the frozen boundary: every value with a
  reasonable generic default has one (shipped in code), and it is overridable — endpoint
  programmatically today, config-file the moment the amendment lands. Inventing a parallel
  config file or abusing env vars for non-secret settings would create a second merge
  chain — worse than the deferred amendment.
- **Alternatives considered**: editing `src/config/schema.ts`/`defaults.ts` — rejected:
  frozen surface, snapshot test would (rightly) fail; hard-coding the endpoint with no
  override — rejected: breaks the recorded-transport e2e story and private-instance users;
  reading an env var for the URL — rejected: creates an undocumented second config channel
  outside the constitution's merge precedence.

## R12 — Error taxonomy and the GraphQL document allow-list

- **Decision**: `errors.ts` defines `TrackerError { category: "config" | "auth" |
  "rate-limit" | "server" | "network" | "timeout" | "not-found" | "client" | "graphql" |
  "create-indeterminate"; retryable: boolean; attempts: number; httpStatus?: number;
  detail: string }` (sanitized per R5) plus `TrackerConfigError` and
  `IndeterminateCreateError` subclasses; the request site is the sole mapper from
  HTTP/GraphQL failures to this taxonomy (GraphQL `errors[]` messages included in `detail`
  only after sanitization — they are platform text, not credentials). Enforcement tests,
  contract tier: (1) **document allow-list** — `graphql/documents.ts` is the only module
  containing GraphQL text; the test asserts its exported document set is exactly the
  enumerated ~10 operations and that no document contains a search operation or a
  description-typed filter (`searchIssues`, `description` in any `filter` position) —
  Principle II/FR-004 enforced structurally; (2) **no-direct-tracker-access** — a source
  scan of `src/**` outside `src/tracker/` fails on any `fetch(`, `linear.app` literal, or
  import of the transport internals (constitution V scan); (3) the credential-sentinel and
  dependency-budget scans (R1/R5).
- **Rationale**: "MUST NOT search issue descriptions for identity" (FR-004) is a negative
  behavioral claim — negatives need structural + adversarial proof, not happy-path tests.
  A closed error taxonomy gives 008/009/013 stable categories to branch on (indeterminate
  create, config, rate-limit exhausted) instead of parsing messages.
- **Alternatives considered**: passing raw SDK/platform errors — rejected: leaks third-party
  shapes and risks header echo in upstream error messages; runtime AST validation of
  documents only — kept *in addition* at unit tier, but the allow-list snapshot catches
  additions at review time; lint rule instead of scan test — rejected: custom lint rule =
  new dev-dependency surface.

## Resolved unknowns summary

| Item | Resolution |
|---|---|
| First platform dependency (constitution ceiling) | R1 — zero-dep; `fetch` seam; budget ≤ 1 guarded, currently 0; SDK documented as the pinned-swap alternative |
| Runner/tiers/property tests without deps | R2 |
| Transport seam, single request site | R3 |
| Retry/backoff/jitter/Retry-After/create-never-retried | R4 |
| Credential pre-flight + non-leak enforcement | R5 |
| Pagination + per-team scoping (never-leak) | R6 |
| Port ↔ platform operation mapping, URL-idempotent upsert | R7 |
| Identity resolution, chain walk, orphan window | R8 |
| Fake + recorded fixtures + fake-vs-real parity suite | R9 |
| Field mapping + identity resolution/caching | R10 |
| 007-local options; deferred apiUrl amendment | R11 |
| Error taxonomy + structural negatives | R12 |

No NEEDS CLARIFICATION remains; Phase 1 gate cleared. (One deliberate deferral: `apiUrl`
config-file override as a 001-noted amendment candidate — R11 — not a clarification.)
