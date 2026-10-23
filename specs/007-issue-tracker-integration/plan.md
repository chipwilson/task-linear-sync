# Implementation Plan: Issue-Tracker Integration Port

**Branch**: `007-issue-tracker-integration` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-issue-tracker-integration/spec.md`

## Summary

This is the Wave-2 feature that implements the concrete issue-tracker adapter behind 002's
frozen `Linear_Port` contract (`specs/002-core-domain-contracts/contracts/tracker-port.md`,
`src/ports/linear-port.ts`) plus the behavior the port owes the system on top of it:
paginated per-team-scoped issue listing, per-team metadata discovery, issue
get/create/update/archive, identity lookup **strictly via attachment metadata**, the
deterministic-URL attachment upsert, cursor-paginated attachment listing, and the
continuation-chain walk (stop at first absent index, report orphans). It also delivers the
**hermetic contract-tested fake `LinearPort`** that every other feature's tests inject
(constitution Principle VI test pyramid), and the resilience/credential posture the
constitution imposes on all platform access (retry with backoff/jitter honoring
`Retry-After`; **creates never auto-retried**). Headline plan decision: **zero new runtime
dependencies** — the platform transport is Node ≥ 20's built-in `fetch`, wrapped in a thin
injectable transport seam, so all test tiers run hermetically against recorded fixtures and
the fake with no live platform calls (research R1). Delivered as the `src/tracker/` module
group of the existing package behind new `./tracker` and `./tracker/testing` subpath
exports; the frozen 002 surface is consumed untouched.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per
exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). No toolchain changes.

**Primary Dependencies**: **None added at runtime — explicit plan decision (research R1).**
The Linear GraphQL transport is implemented over Node ≥ 20's built-in `fetch` behind a
minimal injectable `HttpTransport` seam. The constitution permits "Node built-ins plus
exactly one platform transport dependency"; that allowance is a **ceiling, not a quota**,
and this plan deliberately leaves it unspent (the R1/R2 minimal-runtime-dependency posture
from 002 is preserved in full). Had a dependency been chosen it would be `@linear/sdk`
(exact-pinned, lockfile-committed) — rejected in research R1 with rationale. The MCP SDK
remains 012's separately scoped `<pkg>/mcp` concern. Dev dependencies unchanged
(`node:test` + `node:assert/strict`, per 002 R2).

**Storage**: N/A — no local persistence in this feature. The tracker is the state of record;
run state is 002's `src/state`. The adapter holds only a per-call metadata cache
(team/project/workflow identifiers).

**Testing**: `node:test` per 002 R2, existing tiers (`unit`, `contract`, `integration`,
`e2e`) via `scripts/run-tests.mjs`. Cross-cutting types required by constitution VI and
delivered here: **contract** (fake-vs-real `LinearPort` conformance suite — the same suite
run against the fake and against the real adapter driven by recorded HTTP fixtures),
**property-based** (hand-rolled seeded-PRNG properties, preserving zero-dev-deps), and
**security** (credential-sentinel non-leak tests; GraphQL-document allow-list scan proving
no description-search operation exists; no-direct-tracker-access source scan; dependency
budget scan). Zero real network, zero real credentials, zero wall-clock nondeterminism
(clock, RNG, and sleeper injected per 002 R16 precedent).

**Target Platform**: Node.js ≥ 20 CLI/library host (Linux, macOS, Windows); consumed as
`task-linear-sync/tracker` (adapter) and `task-linear-sync/tracker/testing` (fake +
harness) by features 006/008/011 (and their tests).

**Project Type**: Single npm package (existing); this feature owns the disjoint `src/tracker/`
module group and its tests/fixtures. No frozen 002 module is edited (ROADMAP rule 2).

**Performance Goals**: Full multi-team inventory of "thousands of issues" (spec US1) via
cursor pagination at configured `pageSize` (default 100; platform connection max 250 —
validated and clamped with a diagnostic); per-team request concurrency capped at configured
`concurrency` (default 4); no request fan-out beyond one in-flight page per team beyond
that cap; chain walk issues one bounded lookup per page index.

**Constraints**: Zero new runtime dependencies (R1); hermetic tests at every tier (no live
platform calls in any automated tier — constitution VI + "Hermetic pipelines"); credentials
read only from configured env-var **names**, pre-flight rejected when unset/empty, never
appearing in any diagnostic/log/error (constitution "Credential handling"); resilience
exactly per constitution "Resilience" constraint (non-create 429/5xx/network retried with
exponential backoff + randomized jitter honoring `Retry-After`; creates never
automatically retried — a failed create surfaces as indeterminate); zero real organization
identifiers/tokens/UUIDs in fixtures or shipped constants (release-gate scan); `src/ports`,
`src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates` are frozen — imports only.

**Scale/Scope**: 6 FRs (001 FR-043…048), 3 SCs, 2 user stories; 11 frozen `LinearPort`
members implemented twice (real adapter + fake) and proven identical by one conformance
suite; ~10 GraphQL documents; ~8 recorded scenario fixtures under
`tests/fixtures/tracker/scenarios/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | This feature mutates only when called: it exposes no surface of its own, applies no policy beyond the port contract, and performs zero repository file writes. Screening posture per frozen tracker-port invariant 3: "All transmitted text is pre-screened by the caller (engine); the port transmits what it is given" — honored, not weakened (spec Assumption: "Screening … is enforced by callers (008)"). Credential pre-flight before any request; diagnostics name env vars only. All test mutations land on the fake. | PASS |
| II. Durable Identity | Identity lookup uses **only** the attachment metadata route (frozen `findIssuesByAttachmentUrl` / attachment scan); no adapter code path can search descriptions — enforced structurally (no search/description-filter document exists; allow-list contract scan) and adversarially (UUID-like descriptions produce 0 matches, SC-003). Chain identity keys solely off the page-0 canonical URL; URLs come from 002's frozen builders, never re-derived. | PASS |
| III. Intelligent Defaults, Overridable Configuration | Every knob this feature needs already has a built-in default in frozen `ResolvedConfig` (`pageSize: 100`, `maxRetries: 5`, `concurrency: 4`, `personalKeyPrefix`, `credentialEnvVarNames`, `ignoredStateTypes`, URL templates). The one value 002's frozen schema does not carry (GraphQL endpoint URL) is a **007-local option with a built-in platform-public default and programmatic override** — `ResolvedConfig` is not edited (that would be an amendment; research R11 documents the deferred amendment candidate instead). Shipped constants carry zero consumer-organization literals. | PASS |
| IV. Determinism and Idempotency | URL-idempotent upsert ⇒ repeated create-or-update never duplicates (SC-002); pagination preserves server cursor order with no client-side reordering; jitter derives from an **injected RNG** and delays from an **injected sleeper/clock** — identical seeds ⇒ identical schedules; the chain walk is deterministic over deterministic URLs; the fake reproduces the same observable behavior byte-for-byte for identical worlds. | PASS |
| V. One Engine, Additive Surfaces | "All Linear access MUST flow through the injectable `Linear_Port` so no component bypasses the port's retry, rate-limit, and diagnostic posture" — this feature **is** that posture: exactly one request site inside `src/tracker/internal/`, one `HttpTransport` seam, no other module gains HTTP capability (enforced by a no-direct-tracker-access contract scan). The port gains no methods; consumers 006/008/011 receive it by injection. New module is additive. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR/SC maps to at least one automated test (quickstart traceability). Test pyramid: unit (pure scoping/backoff/mapping/chain logic) → contract (fake-vs-real conformance — the constitution's "contract (fake-versus-real `Linear_Port`)" requirement) → integration (fixture corpora via fake and recorded transport) → thin e2e walkthroughs. Property-based and security tests are delivered, not deferred. All hermetic; coverage threshold inherited from the existing `npm test` gate. | PASS |
| Additional constraints | *Port and adapter architecture*: this feature implements both sides; fake is contract-tested against the real. *Credential handling*: env-**name**-only config, pre-flight diagnostic before any request, values never in types/errors/diagnostics (sentinel security test). *Resilience*: implemented verbatim — "Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST retry with exponential backoff and randomized jitter up to the configurable maximum, honoring `Retry-After`. Issue creation MUST never be automatically retried; a failed create is recorded as indeterminate and reconciled, not replayed" — the request site takes an explicit per-operation-class retry permission with `createIssue` hard-wired to never. *Technology stack*: runtime dependencies stay at Node built-ins only (within the one-transport ceiling; R1 leaves budget unspent). *No organization-specific literals*: fixtures use placeholders (`acme-team`, `proj-alpha`, synthetic UUIDs); a hygiene scan test asserts it. | PASS |
| Development workflow / quality gates | No pipeline changes needed: existing tiers and coverage gate run the new files. Recorded fixtures contain no headers/credentials (recording helper redacts `Authorization`), satisfying "Hermetic pipelines". Dependency addition would have required lockfile changes; R1 makes the change set dependency-free. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/007-issue-tracker-integration/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 007-local interfaces only
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # + exports entries "./tracker" and "./tracker/testing"
                                 #   (additive; dependency map unchanged per R1)

src/
├── ports/linear-port.ts         # FROZEN (002) — imported, never edited
├── urls/attachment-url.ts       # FROZEN (002) — chain walk uses its builders/parser
└── tracker/                     # ← 007's disjoint module group
    ├── index.ts                 # public surface for the ./tracker subpath
    ├── client.ts                # createLinearPort(deps): LinearPort — composition root
    ├── options.ts               # TrackerClientOptions (R11 007-local wiring: apiUrl,
    │                            #   transport, clock, rng, sleep, timeoutMs, orphanProbeLimit)
    ├── http.ts                  # HttpTransport seam (R3) + built-in-fetch implementation
    ├── resilience.ts            # R4: classification, backoff+jitter schedule, Retry-After
    ├── credentials.ts           # R5: env-name reads, pre-flight, value-sanitizing guard
    ├── errors.ts                # R12: TrackerError taxonomy incl. indeterminate-create
    ├── scoping.ts               # R6: per-team filter construction + client-side guard
    ├── pagination.ts            # R6: cursor iteration → complete-page AsyncIterableIterator
    ├── chain.ts                 # R7/R8: identity resolution + chain walk, orphan reporting
    ├── graphql/
    │   ├── documents.ts         # R12: the COMPLETE GraphQL document set (allow-listed)
    │   └── mapping.ts           # R10: response → IssueView/AttachmentView/TeamMetadataCollections
    ├── testing/
    │   ├── index.ts             # public surface for the ./tracker/testing subpath
    │   ├── fake-port.ts         # R9: behaviorally identical in-memory fake LinearPort
    │   └── harness.ts           # R9: recorded-transport driver + scripted-failure builders
    │                            #     (consumed by this feature's tests, exported for
    │                            #      006/008/011 integration/e2e tiers)
    └── internal/
        └── request.ts           # R3: the ONE request site (auth header, retry wrapper,
                                 #     timeout abort, error mapping) — nothing else fetches

tests/
├── unit/                        # tracker-resilience / tracker-credentials / tracker-scoping /
│   │                            #   tracker-pagination / tracker-chain / tracker-mapping /
│   │                            #   tracker-errors / tracker-fake (fake-specific semantics)
├── contract/                    # tracker-conformance (fake vs real one suite — the
│   │                            #   fake-versus-real Linear_Port test), tracker-doc-allowlist
│   │                            #   (no description-search), tracker-dependency-budget,
│   │                            #   tracker-no-direct-access (src scan), tracker-packaging
│   │                            #   (./tracker + ./tracker/testing resolve), tracker-hygiene
│   │                            #   (zero-org-literals in fixtures/constants)
├── integration/                 # tracker-inventory (SC-001 corpus), tracker-resilience-http
│   │                            #   (real adapter over scripted 429/5xx/create-failure
│   │                            #   transports), tracker-identity-attachments (SC-002/003),
│   │                            #   tracker-chain-walk (gap/orphans)
├── e2e/                         # tracker-user-stories (US1+US2 walkthroughs, zero network)
├── helpers/tracker-harness.ts   # scenario loader, seeded rng, fake sleeper, sentinel env
└── fixtures/tracker/
    ├── README.md                # fixture-corpus conventions (placeholders only, redaction)
    └── scenarios/               # multi-team-inventory/, mid-pagination-failure/,
        │                        #   metadata-discovery/, adversarial-descriptions/,
        │                        #   attachment-chain/, rate-limit-sequences/,
        │                        #   create-failure/, upsert-idempotency/
```

**Structure Decision**: Single npm package (constitution "Technology stack"), continuing
002's plan which pre-reserved `src/tracker` for exactly this feature. Wave-2 disjointness:
007 touches only `src/tracker/**`, `tests/**/tracker-*` + `tests/fixtures/tracker/**`,
`tests/helpers/tracker-harness.ts`, the two additive `package.json` exports entries, and its
own `specs/007-issue-tracker-integration/**`. Frozen modules (`src/domain`, `src/config`,
`src/state`, `src/urls`, `src/gates`, `src/ports`) are imported only; 002's frozen-surface
snapshot and package-surface contract tests remain untouched and green because the new
subpaths are additive. Consumers reach the feature only through the two new subpath exports
("import them only through this package's declared subpath exports" — 002 plan, Structure
Decision); `src/tracker/testing` exists because the constitution's test pyramid requires
*other features* to inject the fake in their integration tiers, and package exports are the
only sanctioned cross-feature import route.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. (The tempting
complexity — an SDK plus adapter shim — was explicitly rejected in R1; nothing simpler was
found insufficient, only the reverse.)

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design adds no runtime dependency (R1), no edits to any
frozen 002 module or contract, no repository-tree writes, no description-search code path
(structurally impossible under the R12 document allow-list), and the fake-vs-real
conformance suite is the constitution-mandated contract tier. New 007-local types extend
the frozen entities (field-mapping tables in data-model.md §10 reference 002 shapes
without altering them). Re-check result: **PASS**.
