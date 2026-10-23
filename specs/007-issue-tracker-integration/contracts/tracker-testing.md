# Contract: Tracker Testing Surface (fake `Linear_Port` + recorded-fixture harness)

Modules: `src/tracker/testing/{fake-port,harness,index}.ts`, shipped under the new
subpath **`task-linear-sync/tracker/testing`** (additive export; runtime-dependency-free).
This is the fake the constitution's test pyramid mandates and every other feature injects:

> a middle layer of integration tests driving an injected fake `Linear_Port` with zero real
> Linear API requests … The fake `Linear_Port` used in tests MUST conform to the same
> behavioral contract as the real implementation and be contract-tested against it.
> — constitution v1.0.0 (Principle VI, Additional Constraints)

```ts
/** In-memory world; seed values use placeholder identities only (hygiene-scanned). */
export function createFakeLinearPort(world?: FakeWorld): FakeLinearPort;

export interface FakeLinearPort extends LinearPort {
  readonly world: FakeWorld;                 // inspectable/mutable between calls
  scriptFailure(method: keyof LinearPort, script: FailureScript): void; // data-model §9
  callLog: ReadonlyArray<{ method: string; args: unknown[] }>;          // request-count proofs
}

/** Recorded-transport driver (R9): replays scenario dirs for the REAL adapter. */
export function createRecordedTransport(scenarioDir: string): HttpTransport;
```

## 1. Fake behavioral contract (subset; full semantics = the parity suite, §3)

1. **URL idempotency**: `upsertAttachmentByUrl` with a previously-seen `(issueId, url)`
   updates in place — `callLog` grows, `attachments.size` does not (SC-002 semantics).
2. **Per-team scoping**: `listIssues` filters by the exact R6 predicate (same pure guard the
   real client-side check uses — shared code, not re-implemented); cross-team trap rows in
   the world are never yielded for another team.
3. **Cursor pagination**: per-team issue pages and per-issue attachment pages slice at
   `pageSize` with opaque cursors (`c:<index>`); `nextCursor: null` only at the end;
   mid-pagination `scriptFailure` fires at the scripted call count and the iterator throws
   with no partial page yielded.
4. **Identity route only**: the fake *has no description search at all* — making the
   adversarial UUID-in-description fixture provably inert is a world property, and the
   real side proves it via the R12 allow-list.
5. **Error taxonomy**: `scriptFailure` kinds map to the identical R12 `TrackerError` shapes
   the real request site produces (`attempts` semantics included: create ⇒ always 1).

## 2. Harness (recorded fixtures)

- Scenario directories follow data-model §8 (`scenario.json` + ordered `NN-*.json` request/
  response pairs; `world.json` for fake seeds). Matching = earliest unconsumed pair with
  matching `operationName` and pinned variable keys; miss ⇒ loud `FixtureMiss` (a fixture
  that no longer reflects reality must fail, not silently pass).
- `Retry-After`/status/headers are first-class in fixtures (retry scenarios drive the real
  resilience stack with an injected fake sleeper/rng — deterministic).
- Recording hygiene (for any future re-record): strip `Authorization` + cookie headers,
  replace real identifiers with corpus placeholders, synthetic UUIDs only — the
  `tracker-hygiene` contract test scans the whole corpus and fails otherwise.

## 3. Parity suite (the fake-versus-real contract test)

`tests/contract/tracker-conformance.suite.ts` exports `linearPortConformance(name, makePort)`
covering: pagination completeness + scoping exactness + per-team isolation (US1 scenarios);
metadata triples; get/create/update/archive round-trips; identity via attachment metadata
with adversarial description negatives; upsert idempotency; get/list attachment paging;
chain walk incl. gap/orphans (via `chain.ts` over the port); mid-pagination failure; error
taxonomy + create-guard attempt counts. `tests/contract/tracker-conformance.test.ts` runs
the suite **twice** — `{ port: fake }` and `{ port: real adapter over createRecordedTransport }`
— asserting identical results per scenario. Constitution compliance evidence: "contract
(fake-versus-real `Linear_Port`)" is a required cross-cutting test type, delivered here.

## 4. Consumer usage (006/008/011 and beyond — Wave-2 disjointness note)

```ts
import { createFakeLinearPort } from "task-linear-sync/tracker/testing"; // subpath import:
// the ONLY sanctioned route (002 Structure Decision: "import them only through this
// package's declared subpath exports"); no reaching into tests/ or src/tracker internals.
```

Consumers get `FakeWorld` seeds + `scriptFailure` for their own hermetic tiers; they never
need recorded fixtures (those exist to prove *this* feature's real side). 006 in its own
Wave-2 branch hand-stubs `LinearPort` from the frozen interface types until this branch
merges — no cross-branch file dependency is created in either direction.

## Test obligations (mapped in quickstart)

- Parity suite green for both bindings, same scenario names (contract tier gate).
- Fake `callLog` proves request counts (page counts per team, single request per discovery
  call, one attempt per create) — the SC-001 "assert page-count requests" mechanism.
- Hygiene scan: fixtures + shipped constants contain zero real org identifiers/tokens/
  UUID-shaped values (release-gate posture; placeholder corpus).
