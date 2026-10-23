# Quickstart: Validating the Issue-Tracker Integration Port

Validation guide for `specs/007-issue-tracker-integration` — every scenario runs **hermeti-
cally**: recorded fixtures and the in-memory fake only, **zero live platform calls in every
tier** (constitution VI). Field details: [data-model.md](./data-model.md); contract details:
[contracts/README.md](./contracts/README.md); decisions: [research.md](./research.md).

## Prerequisites

- Node.js ≥ 20.0.0 (engine floor; built-in `fetch` is the transport — R1).
- `npm ci` from the committed lockfile. **No new runtime dependency exists** (decision R1);
  if a future amendment swaps in a transport SDK it lands exact-pinned here.
- **No Linear credentials and no network access required or used.** Scenarios deliberately
  run with `LINEAR_ACCESS_TOKEN`/`LINEAR_API_KEY` unset (the pre-flight scenario relies on
  it). All fixtures under `tests/fixtures/tracker/` use placeholder identities
  (`acme-team`, `proj-alpha`, …) and synthetic UUIDs; recorded fixtures carry no
  `Authorization` headers (redaction rule, tracker-testing.md §2).

## Setup

```bash
npm ci
npm run build          # tsc: ESM + .d.ts — includes src/tracker + src/tracker/testing
npm run typecheck      # tsc --noEmit over src + tests
```

## Test tiers

```bash
npm run test:unit        # tracker-* unit suites (scoping, backoff, mapping, chain, errors)
npm run test:contract    # fake-vs-real conformance parity, allow-list, dependency budget,
                         #   no-direct-access scan, packaging (./tracker subpaths), hygiene
npm run test:integration # corpora: inventory (SC-001), resilience-over-HTTP, identity/
                         #   attachments (SC-002/003), chain walk
npm run test:e2e         # tests/e2e/tracker-user-stories.test.ts (still zero network)
npm test                 # all tiers + inherited coverage threshold gate
```

## Validation scenarios

### US1 — Complete, correctly scoped inventory (P1)

Run: `npm run test:integration -- --test-name-pattern "inventory"` (parity:
`npm run test:contract -- --test-name-pattern "conformance"`)

Fixtures: `scenarios/multi-team-inventory/` (3 teams × multi-page + cross-team trap issues),
`scenarios/metadata-discovery/`, `scenarios/mid-pagination-failure/`; fake-world seeds with
the same shapes.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | All pages, all teams, configured page size | `inventory pagination` (fake `callLog` + recorded request count) | Exactly `ceil(teamCount/teamSize)` page requests per team via `after = endCursor`; every in-scope issue retrieved once — 100% in, 0 out over the corpus (SC-001, FR-001) |
| 2 | Non-configured project / ignored state type excluded; traps never leak | `scoping exactness` | Issue in configured team but foreign project excluded; `canceled`/`duplicate` state types excluded; team-B page never contains team-A rows; per-team isolation asserted per result partition (FR-001) |
| 3 | Mid-pagination failure | `mid pagination` | Scripted failure at page k after retries exhausted ⇒ iterator throws `TrackerError`; page-k rows **never yielded** (no partial-inventory consumption); earlier pages remain valid (edge case) |
| 4 | Metadata discovery | `metadata discovery` | Per requested team, in order: `{ teamKey, projects[{id,name}], workflowStates[{id,name,type}] }` — all three collections, complete (FR-002) |

### US2 — Identity and history via attachments only (P2)

Run: `npm run test:integration -- --test-name-pattern "identity|attachment|chain|resilience"`

Fixtures: `scenarios/adversarial-descriptions/` (UUID-like text inside descriptions),
`scenarios/attachment-chain/` (pages 0..N; gap case: page 3 absent, page 4 present),
`scenarios/upsert-idempotency/`, `scenarios/rate-limit-sequences/`,
`scenarios/create-failure/`.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Identity strictly via attachment metadata | `identity route` | Lookup resolves via canonical-URL query / attachment scan only; adversarial descriptions with embedded UUID-shaped text yield **0** matches (SC-003); `graphql/documents.ts` allow-list scan shows no search/description-filter operation exists (FR-004) |
| 2 | CRUD + archive with configured resilience | `resilience matrix` | Non-create 429/5xx/network retried ≤ `maxRetries` with jittered backoff (seeded rng ⇒ deterministic schedule recorded via fake sleeper); `Retry-After` (seconds + HTTP-date, clamped) replaces computed delay; `maxRetries: 0` override honored (FR-003, edge case "Rate limiting") |
| 3 | Creates never auto-retried | `create guard` | Scripted 429/5xx/network on `issueCreate` ⇒ exactly **1** request on the wire (`attempts: 1`), `IndeterminateCreateError` — no replay (FR-003, constitution Resilience) |
| 4 | URL-idempotent upsert | `upsert idempotency` | Two upserts of the same canonical URL ⇒ exactly 1 attachment, updated in place, no attachment id stored by the adapter — on **both** bindings (SC-002, FR-005) |
| 5 | Chain enumeration | `chain walk` | Pages 0..N via deterministic paged URLs; walk **stops at first absent index**; gap fixture (3 absent, 4 present) ⇒ `pages = [1,2]`, `orphans: [4]` reported (not skipped); `canonical: null ⇒ pages/orphans empty`; identity keys solely off page 0 (FR-006, edge case "Chain gap") |
| 6 | Cursor attachment listing | `attachment paging` | `listAttachments` slices at page size, opaque cursors, `nextCursor: null` at end; scan route finds identity-bearing attachment (FR-005) |

### Contract / cross-cutting validation

Run: `npm run test:contract`

1. **Fake-versus-real conformance parity** (constitution VI + Additional Constraint): one
   suite, two bindings (fake; real adapter over `createRecordedTransport`) — identical
   results on every scenario above (tracker-testing.md §3).
2. **Single request site / constitution V scan**: no `fetch(`/`linear.app`/transport import
   outside `src/tracker/` (and internals unimportable elsewhere).
3. **Dependency budget scan**: `package.json` runtime `dependencies` count ≤ 1 and currently
   **0** — R1's ceiling documented; any addition trips the test deliberately.
4. **Packaging**: `./tracker` + `./tracker/testing` subpath exports resolve at runtime
   (types-first condition), per-module `.js`/`.d.ts` emitted; 002's frozen-surface +
   package-surface snapshots **unchanged** (frozen contracts untouched).
5. **Hygiene**: fixtures + shipped constants contain no real org identifiers/tokens/
   UUID-shaped values (placeholder corpus scan).

### Security scenarios (credential posture)

1. Pre-flight: `LINEAR_ACCESS_TOKEN`/`LINEAR_API_KEY` unset/empty ⇒ `createLinearPort`
   throws `TrackerConfigError` naming the env-var name; zero requests issued.
2. Sentinel non-leak: unique sentinel planted as the token value; every failure scenario of
   the resilience matrix runs; sentinel appears in **0** captured errors/diagnostics/
   fixture outputs (constitution "MUST NEVER appear in diagnostics, logs…").
3. Prefix diagnostic: wrong-shape token ⇒ non-fatal diagnostic naming env-var name + the
   `personalKeyPrefix` constant only.

### Gate sanity (types as tests)

`npm run typecheck` compiles `tests/types/tracker-negative.test-d.ts`: a `LinearPort`-typed
variable accepts both the fake and the adapter (structural conformance is compile-checked);
no retry/tuning knob exists on port method signatures (frozen invariant 2); `chain.ts`
helpers accept any `LinearPort`, not the concrete adapter.

## Success-criteria traceability

| Spec SC / FR | Proven by |
|---|---|
| SC-001 (100% in / 0 out inventory) | US1.1 + US1.2 (both bindings via parity) |
| SC-002 (1 attachment per URL, 0 duplicates) | US2.4 property (seeded sequences) + parity |
| SC-003 (100% attachment-metadata identity / 0 description) | US2.1 adversarial fixtures + allow-list scan |
| FR-001 | US1.1–1.3 (+3 mid-pagination edge) |
| FR-002 | US1.4 |
| FR-003 | US2.2–2.3 |
| FR-004 | US2.1 |
| FR-005 | US2.4 + US2.6 |
| FR-006 | US2.5 (+ chain-gap edge) |
| Constitution Resilience / Credential constraints | resilience-and-credentials.md §6 obligations, Security scenarios 1–3 |
| Fake↔real contract requirement (constitution VI) | Contract scenario 1 |

## Exit criteria for this feature

`npm test` green (all tiers + coverage threshold + parity suite); `npm run build` emits
`dist/tracker/**` + `dist/tracker/testing/**` with working `./tracker` and
`./tracker/testing` exports; every quickstart scenario observed; 002's frozen-surface
snapshot byte-identical. Wave-3 consumers (008) then compose against `createLinearPort`
and `createFakeLinearPort`; 011's history reads ride the chain walk.
