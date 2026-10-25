# Tracker Integration Port (`task-linear-sync/tracker`)

Spec 007 — the single Linear-adapter surface every downstream feature (sync engine, state
journaling, page routing) builds on. All Linear access flows through the injectable
`LinearPort` (constitution V): retry, rate-limit, credential, and diagnostic posture are the
adapter's, never a caller's, and the package ships **zero runtime dependencies** — the
built-in `fetch` hides behind one injectable `HttpTransport` seam.

## Subpath usage

```ts
// Production surface
import {
  createLinearPort,
  attachmentUrlConfigFrom,
  enumerateAttachmentChain,
  resolveIssueByTaskIdentity,
  issueCarriesTaskIdentity,
  TrackerError,
  TrackerConfigError,
  IndeterminateCreateError,
} from "task-linear-sync/tracker";

// Test surface — the fake and the recorded replay driver (devDependency-free too)
import {
  createFakeLinearPort,
  createRecordedTransport,
  syntheticUuid,
} from "task-linear-sync/tracker/testing";
```

`createLinearPort(deps)` takes the frozen 002 `ResolvedConfig` (imported, never reshaped)
plus optional wiring (`TrackerClientOptions`): `apiUrl`, `transport`, `env`, `clock`, `rng`,
`sleep`, `timeoutMs`, `baseDelayMs`/`maxDelayMs`, `orphanProbeLimit`, `credentialKind`,
`diagnostics`. Every knob 002 froze (`pageSize`, `maxRetries`, `concurrency`,
`personalKeyPrefix`, credential env names, ignored state types, URL templates) is consumed
from `config` — construction never requires a consumer-supplied value beyond credentials
(Principle III).

### The eleven members

| Member | Route | Posture |
| --- | --- | --- |
| `listIssues(scope)` | `issues` (per-team filter, cursor) | non-create retried; yields only in-scope rows |
| `discoverMetadata(teamKeys)` | `teamMetadata` (one batched query) | R10 cache; configured-identity resolution |
| `getIssue(id)` | `issue` | 404/absent ⇒ `null` |
| `createIssue(input)` | `issueCreate` | **the only never-retried path** — one request; failure ⇒ `IndeterminateCreateError` (recorded, never replayed) |
| `updateIssue(id, patch)` | `issueUpdate` | `stateTypeId` maps to a discovered `stateId` pre-dispatch |
| `archiveIssue(id)` | `issueArchive` | `success: false` ⇒ structured error |
| `findIssuesByAttachmentUrl(url)` | `attachmentsForURL` | ALL carriers returned (0/1/>1 — multi-carrier is the caller's integrity signal) |
| `upsertAttachmentByUrl(input)` | `attachmentCreate` | ONE request; platform URL idempotency IS create-or-update in place (no client-stored attachment id) |
| `updateAttachment(id, metadata)` | `attachmentUpdate` | flat metadata map passthrough |
| `getAttachmentByUrl(url)` | `attachmentsForURL` | first-or-`null` |
| `listAttachments(issueId, cursor?)` | `issueAttachments` | frozen cursor `Page`; the FR-004 scan route |

No search operation and no description filter exists anywhere (FR-004 — descriptions are
data; identity is attachment metadata and canonical URLs **only**). Identity machinery:
`resolveIssueByTaskIdentity` (page-0 canonical URL → 0 ⇒ `null`, ≥1 ⇒ all carriers),
`issueCarriesTaskIdentity` (cursor scan over `listAttachments`), and
`enumerateAttachmentChain` (canonical anchor → contiguous continuation pages → stop at the
first absent index → bounded orphan-window probes reported, never skipped). All three accept
ANY `LinearPort`, fake included (`tests/types/tracker-negative.test-d.ts` pins it).

## Credentials and pre-flight

Credentials resolve from the frozen env-var NAMES (`LINEAR_ACCESS_TOKEN`, then
`LINEAR_API_KEY`, selected via `credentialKind`) at construction time — **before any
request**. A missing/empty value throws `TrackerConfigError` naming the env-var NAME only.
The value itself never leaves the `Authorization` header: every emitted `detail`,
diagnostic, and error message passes a sanitizer seeded with the credential, and the
credential-sentinel contract test drives the full failure matrix to prove zero leakage.

## Resilience posture (summary)

- **Non-create** requests (every read + `issueUpdate`/`issueArchive`/attachment writes):
  429/5xx/network retry up to `config.maxRetries` with equal-jitter exponential backoff
  (seeded deterministic rng — same inputs ⇒ identical schedules) and per-attempt
  `AbortSignal.timeout`. A `Retry-After` header (delta-seconds or HTTP-date vs the injected
  clock) REPLACES the computed delay; clamped to `[0, maxDelayMs]`.
- **Create** (`issueCreate`): exactly one request, always. Any post-dispatch retryable
  failure surfaces as `IndeterminateCreateError` (`attempts: 1`, `retryable: false`) —
  reconciled upstream, never replayed.
- Closed 10-category `TrackerError` taxonomy (`config | auth | rate-limit | server |
  network | timeout | not-found | client | graphql | create-indeterminate`) with
  `{ category, retryable, attempts, httpStatus?, detail }` — `attempts` is the actual
  request count and `detail` is always sanitized.
- Concurrency comes from `config.concurrency` (one semaphore per client); `concurrency: 1`
  is fully sequential.

## Extending the fixture corpus (`tests/fixtures/tracker/scenarios/`)

Each scenario is one directory:

```
scenarios/<name>/
  scenario.json      # { name, notes, placeholderIdentities } — required
  world.json         # optional fake world: teams/issues/attachments/
                     # pageSize/scriptedFailures/ignoredStateTypes (data-model §9)
  NN-<operation>.json# recorded HTTP pairs: { request: { operationName, variables(pin) },
                     #   response: { status, headers?, body } }
```

Conventions (see `tests/fixtures/tracker/README.md`): pairs match the EARLIEST unconsumed
entry whose pinned `variables` keys equal the live request; `status: 0` is the synthetic
network error; `Retry-After` headers are first-class fixture data; a directory with no pairs
yet answers every request with the typed not-implemented signal so parity scenarios skip as
placeholder-backed (the suite then auto-flips to running the moment pairs land). Identities
must stay placeholders (`acme-team`, `proj-alpha`, `ACM-101`, `*.example.invalid`) and UUIDs
synthetic (`syntheticUuid(n)` = `ac000000-0000-4000-8000-…`); the hygiene contract test fails the release on
any real organization identifier, token shape, email, or non-synthetic UUID. Run
`npm run test:contract` after adding fixtures — the fake binding needs the matching
`world.json` for parity to exercise both sides.

## Deterministic testing knobs

`TrackerClientOptions` injects `transport`, `env`, `clock`, `rng`, and `sleep` — the same
levers the conformance harness uses (`FakeClock`, `FakeSleeper`, seeded `splitmixRng`) to
make retry schedules, HTTP-date `Retry-After` waits, and jitter envelopes byte-stable in
tests. Zero network, zero credentials: the recorded driver replays pairs; the fake models
the full world.
