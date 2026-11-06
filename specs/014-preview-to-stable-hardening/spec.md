# Feature Specification: Preview-to-Stable Hardening (011 & 012 Surfaces)

**Feature Branch**: `014-preview-to-stable-hardening`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "harden the preview surfaces (012 MCP, 011 history server) toward
stable-1.0" (`README.md` → Current Status → Next steps). Split with feature 015, which owns the
publish/release machinery.

## Purpose and Scope

The history server (011) and the MCP server (012) shipped merged but preview-labelled, and
"preview" is currently only a documentation word — nothing defines its exit criteria. This
feature turns that label into a guarantee: it declares what stable means for these two surfaces,
freezes their wire contract docs under an amendment-only regime, closes the resource-bounding
items each feature's research deferred, unifies the cross-surface authentication semantics, and
reconciles the traceability documents that drifted from the as-built implementations.

**Owns**: the stability declaration for 011/012; the amendment freeze over their contract docs;
the deferred-engineering backlog listed in Key Entities below; cross-surface bearer semantics;
traceability/doc reconciliation for these surfaces.

**Consumes from 011/012**: the shipped surfaces and their contract docs; the research deferrals
(`specs/011-*/research.md` R4/R6, `specs/012-*/research.md` R1/R2/R9) are the backlog source.

**Deliberately out of scope**: adopting the MCP SDK or any new runtime dependency (the one-transport
allowance stays unspent; that decision keeps its existing amendment trigger in 012 research R1);
TLS termination or non-loopback exposure (stays a proxy concern, per 012 R9); changes to the
frozen 002 surface; package versioning/release policy (feature 015); dogfooding against a real
Linear workspace (separate README next-step).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stability is declared and enforced (Priority: P1)

A consumer reads the usage docs and knows exactly which guarantees the two surfaces make: tool
names and schemas, routes, status codes, error envelopes, config keys, and streaming semantics
will not change without a formal amendment. A maintainer cannot silently drift the wire surface:
renaming a tool, route, setting key, or error code breaks CI unless an amendment entry accompanies
the change. The preview label is either removed from both surfaces in the same breath or is
applied symmetrically — never one with a disclaimer and one without.

**Why this priority**: "stable-1.0" is meaningless until the promise is written down and
mechanically enforced; every other story is worthless if the surface can still drift silently.

**Independent Test**: Against the implemented docs and contract tests, attempt unamended drift
(remove a tool, rename a route, drop a status code, change an error code) and confirm CI fails;
remove the accompanying amendment entry and confirm it still fails; then confirm the docs state
the stability status identically for both surfaces.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the contract suite runs, **Then** each frozen element of
   both surfaces (tool name + input schema, route, status code, error code, config key) is
   covered by a snapshot check that fails on unamended change.
2. **Given** a change that amends a frozen contract doc, **When** the amendment entry in
   `docs/contract-amendments.md` is missing, **Then** CI fails; with the entry and updated
   snapshot together, CI passes.
3. **Given** the promoted state, **When** the README, both usage docs, and both feature specs are
   inspected, **Then** the stability status is stated the same way everywhere and zero
   preview-disclaimer text remains on promoted surfaces.
4. **Given** the traceability catalog (`specs/requirements.md`), **When** its history-server and
   MCP-server descriptions are read, **Then** they describe the as-built zero-dependency
   components (no Next.js/React claim, no remote HTTP/SSE MCP transport claim), and every npm
   script named in the README exists in `package.json`.

---

### User Story 2 - Long-running history server is resource-bounded (Priority: P1)

An operator deploys the read-only history component behind a TLS-terminating proxy and leaves it
running. Memory stays bounded no matter how many distinct tasks are browsed; a noisy client gets
a clean, documented rate-limit response instead of degrading every other client; the session
cookie declares itself Secure when the deployment is HTTPS; reconnect after a dropped live stream
behaves per the documented rule.

**Why this priority**: these are the two deferred items (`011` research R6 cache capping, R4
stream resume) plus one preview-only shortcut (cookie `Secure`) that a stability promise
immediately exposes in long-lived deployments.

**Independent Test**: Drive the server with a fan-out fixture exercising far more distinct tasks
than the cache bound, with concurrent walk-triggering requests and concurrent live streams beyond
the configured limits, over HTTPS-forwarded and plain-HTTP requests; assert bounded cache size,
documented backpressure envelopes with zero history bytes, cookie attributes per deployment mode,
and reconnect behavior matching the docs.

**Acceptance Scenarios**:

1. **Given** a cache bound of N and a browse sequence touching far more than N distinct tasks,
   **When** requests continue, **Then** cached entries never exceed N, eviction is deterministic
   (least-recently-use first), and every response is byte-identical to the uncached result for
   the same tracker state.
2. **Given** concurrent requests and live streams beyond the configured in-flight and stream
   limits, **When** the excess arrives, **Then** excess requests receive the documented
   rate-limit error envelope (429 with a retry hint, zero history bytes) and admitted requests
   complete normally; the tracker-originated rate-limit mapping keeps its existing posture.
3. **Given** a deployment configured for a TLS-terminating proxy, **When** a session cookie is
   issued, **Then** it carries the Secure attribute; over plain loopback HTTP at defaults it does
   not, and defaults are byte-for-byte unchanged from 011 as merged.
4. **Given** a dropped live update stream, **When** the client reconnects (with or without a
   resume identifier), **Then** the server responds exactly as the stability doc states —
   full re-stream — with no error and no duplicated state.

---

### User Story 3 - Long-lived MCP sessions stay bounded and consistent (Priority: P2)

An agent host keeps one MCP server process alive for days. Plan references expire cleanly on a
documented lifetime, so the reference store never grows without bound; applying an expired
reference fails closed through the existing gating vocabulary instead of silently succeeding or
crashing; and a client sending its bearer token with different casing (`Bearer`, `bearer`,
`BEARER`) gets the same accept/reject verdict on both surfaces.

**Why this priority**: the unbounded plan-reference store and the bearer-parsing split between the
two surfaces are the inconsistencies a stable release must not ship; they are smaller than the
011 items and share the auth test harness.

**Independent Test**: Drive a long-lived HTTP-mode server through plan→apply cycles beyond the
reference-store bound; assert TTL/capacity eviction, fail-closed apply on an evicted reference,
and unchanged zero-`node:fs` posture. Run the bearer casing matrix against both surfaces and
assert identical verdicts and constant-time-path acceptance of the credential comparison.

**Acceptance Scenarios**:

1. **Given** a long-lived server that has recorded more plan references than the configured TTL
   window allows, **When** the store is inspected or pressured, **Then** stale references are
   gone and the store stays within its bound.
2. **Given** a plan reference that has expired, **When** an apply references it, **Then** the
   apply is refused with the existing expired/invalid plan-refusal wording and zero engine or
   port code runs.
3. **Given** the bearer casing matrix, **When** each variant is sent to each surface with a
   correct and an incorrect token, **Then** verdicts match across surfaces, incorrect tokens
   still get the leak-free 401 with `www-authenticate`, and 0 credentials appear in any output.

---

### User Story 4 - Deferred items reach a recorded decision (Priority: P3)

Every item either surface deferred with a "revisit" note has, at promotion time, a written
decision: implemented and supported, or re-deferred as a named non-goal with rationale and a
revisit trigger. Concretely, the MCP handshake negotiates the declared revision set — which now
includes the revision current hosts request (`2025-06-18`) — and falls back to the newest
supported revision otherwise; the SDK-only protocol surface (streamable HTTP transport,
resources, prompts, sampling, elicitation, roots, subscriptions) and `Last-Event-ID` history
resume stay re-deferred with their triggers recorded.

**Why this priority**: it protects the stability promise from silent-forever deferrals, but only
the negotiation extension is code; the rest is recorded decision, which is cheap to land and can
follow the P1/P2 work.

**Independent Test**: Send `initialize` with each supported revision, an unsupported newer
revision, and a malformed version; assert the declared negotiation behavior. Grep the stability
docs for every deferred item from both research docs and confirm each has a decision section.

**Acceptance Scenarios**:

1. **Given** `initialize` requesting a supported revision (including `2025-06-18`), **When** the
   handshake completes, **Then** the server echoes that revision; for an unsupported revision the
   server responds with its newest supported revision per the negotiation rule.
2. **Given** the supported-revision set, **When** the contract doc is checked, **Then** the set is
   part of the frozen surface — changing it requires an amendment entry.
3. **Given** every deferral recorded in 011 research R4 and 012 research R1/R2/R9, **When** the
   stability docs are read, **Then** each appears as implemented, or as a named non-goal with a
   rationale and a revisit trigger — 0 silent deferrals remain.

## Edge Cases

- **Cache bound of 0 or 1**: caching effectively off, but every response still correct; the
  single-flight dedup keeps its behavior for concurrent identical requests.
- **Entry evicted while a walk is in flight**: the in-flight result may still be returned (or
  re-cached per the documented rule); no request errors purely because eviction raced it.
- **Plan reference expires between plan and apply** (the normal race): the apply fails closed
  with the expired-plan refusal — never a partial apply.
- **Proxy misconfiguration**: `Secure` cookie demanded over plain HTTP → the session never
  establishes; the docs give the operator the diagnostic, and no token ever travels over a
  connection the operator declared TLS.
- **Resume identifier sent to the history server** although resume is a re-deferred non-goal:
  the identifier is ignored cleanly and the client gets the full current stream.
- **Bearer header with correct casing but wrong token** versus wrong casing correct token:
  verdicts are per-token, never per-casing; timing path does not branch on the secret.
- **Multiple frozen elements changed in one unamended commit**: CI fails listing every drifted
  element, not just the first.

## Requirements *(mandatory)*

- **FR-001**: Both surfaces MUST carry an explicit stability declaration in their usage docs
  stating: the stability status and effective date; the exact scope of what is guaranteed (tool
  names and input schemas, routes, status codes, error-code taxonomy, configuration keys,
  streaming semantics, default values) as defined by their contract docs; and what is explicitly
  not guaranteed (undocumented behavior).
- **FR-002** (extends `docs/contract-amendments.md`): The contract docs of both surfaces
  (011: `http-surface`, `access-control`, `history-reconstruction`, `component-api`; 012:
  `tool-definitions`, `jsonrpc-stdio`, `transport-auth`, `apply-gating`, `component-api`) MUST be
  governed by an amendment-only freeze equivalent in force to feature 002's: a checked-in
  snapshot per surface, a contract test that fails CI on unamended drift, and an amendment-entry
  requirement in `docs/contract-amendments.md`.
- **FR-003**: The README surface table, both usage docs, and both feature specs MUST state the
  final stability status identically; on promotion, 0 preview-disclaimer texts remain; until
  promotion, if any surface is labeled preview, both MUST be labeled the same way.
- **FR-004**: `specs/requirements.md` MUST describe both surfaces as-built — zero-runtime-dependency
  history component served over built-in HTTP, MCP transport set equal to stdio plus loopback
  HTTP — with the stale Next.js/React and remote HTTP/SSE transport wording corrected; the README's
  npm-script references MUST all exist in `package.json`.
- **FR-005** (011 research R6): The history cache MUST enforce a configurable entry bound with
  deterministic least-recently-use eviction; eviction MUST affect hit rate only, never response
  bytes; the default bound MUST keep typical-workload behavior and be documented.
- **FR-006**: The history server MUST bound concurrent chain-walk operations and concurrent live
  streams per instance; requests beyond the bound MUST receive the existing rate-limit error
  envelope (429, retry hint, zero history bytes) rather than unbounded resource use; tracker-side
  rate-limit mapping keeps its existing posture; all bounds overridable per constitution
  Principle III.
- **FR-007**: Session cookies MUST carry the `Secure` attribute when the deployment declares
  TLS-fronting (explicit config or forwarded-protocol recognition, whichever the plan picks and
  documents); loopback defaults MUST remain byte-for-byte as merged; the proxy assumption joins
  the security-posture doc.
- **FR-008**: Bearer credential comparison MUST share one semantic across both surfaces —
  RFC 7235 case-insensitive scheme, tolerant whitespace, constant-time secret comparison,
  leak-free 401 with `www-authenticate` — pinned by a cross-surface contract test that runs the
  same casing/whitespace matrix against both.
- **FR-009** (012 store hardening): The MCP plan-reference store MUST be bounded by a configurable
  TTL and capacity; expired or evicted references MUST fail closed through the existing
  plan-refusal vocabulary with zero engine or port code executed; the structural no-`node:fs`
  guarantee of the MCP surface MUST be preserved.
- **FR-010** (012 research R1 revisit trigger): The MCP handshake MUST negotiate a declared set of
  protocol revisions that includes `2025-06-18` alongside the currently supported revisions; an
  unsupported requested revision MUST receive the newest-supported fallback per the negotiation
  rule; the revision set MUST be part of the frozen contract doc (FR-002).
- **FR-011**: Every previously deferred item (011 R4 `Last-Event-ID` resume; 012 R1 SDK-only
  protocol surface and streamable HTTP; 012 R9 TLS/remote exposure) MUST appear in the stability
  docs either as implemented behavior or as a named non-goal with rationale and revisit trigger —
  0 silent deferrals after promotion.
- **FR-012**: All existing constitution posture MUST be preserved and remain test-green: zero
  runtime dependencies (transport allowance unspent), apply disabled by default and refused before
  any engine or port code, no-`node:fs` MCP surface, hygiene / defaults-scan / credential-sentinel
  contract suites, and the documentation duty (docs updated in the same change as any public
  change).

### Key Entities

- **Stability Declaration**: per-surface record — status, effective date, guaranteed scope
  (pointing at the contract docs), explicit non-goals with revisit triggers.
- **Amendment Entry**: dated change to a frozen contract doc naming the before/after surface
  element and migration note; the only path past the snapshot guard.
- **Resource Bound**: named configurable limit — cache entries, concurrent walks, concurrent
  streams, plan-reference TTL/capacity — each with default, override key, and backpressure
  behavior.
- **Deferred-Decision Record**: for each research deferral — implemented, or re-deferred with
  rationale and trigger; location pinned in the stability docs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of frozen-surface elements (each tool, route, status code, error code, config
  key of both surfaces) fail CI when drifted without an amendment entry, and pass with
  amendment + snapshot update, demonstrated by mutation checks in the contract suite.
- **SC-002**: A fan-out stress fixture touching ≥ 10× the cache bound keeps cached entries ≤ the
  bound at all times, with byte-identical responses versus an uncached run.
- **SC-003**: Under load beyond the walk/stream bounds, 100% of excess requests receive the
  documented rate-limit envelope containing zero history bytes, and 100% of admitted requests
  complete normally.
- **SC-004**: The bearer casing/whitespace matrix yields identical verdicts on both surfaces for
  every token state tested; 0 credential values and 0 history bytes appear in any response or log
  line.
- **SC-005**: 0 preview-disclaimer texts and 0 stale traceability references (Next.js/React,
  remote HTTP/SSE MCP transport, nonexistent npm scripts) remain in README, docs, and the traceability
  catalog after promotion.
- **SC-006**: 100% of previously deferred items carry a recorded decision (implemented, or
  non-goal with rationale + revisit trigger) in the stability docs.

## Assumptions

- "Stable-1.0" here is a per-surface guarantee (docs + amendment-enforced freeze), not a
  package-wide version bump; the package version policy is feature 015's decision.
- The declared MCP revision set is exactly the currently supported set plus `2025-06-18`; no
  newer revision is claimed without a future amendment.
- The MCP SDK stays unadopted; all negotiation work extends the existing dependency-free subset.
- All new bounds ship with generous defaults so existing deployments see no behavior change;
  promotion removes the preview label only when every P1/P2 story and SC passes.
- TLS termination remains outside both components (proxy/front-door concern), per 012 research R9
  and 011's deployment-shape doc.
- Real-workspace dogfooding is tracked as its own README next-step and does not gate this
  feature's promotion.
