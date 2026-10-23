# Phase 1 Data Model: Issue-Tracker Integration Port (007-local entities)

**Feature**: `007-issue-tracker-integration` | **Date**: 2026-10-22

This document defines **only** entities this feature adds. The frozen 002 entities
(`src/ports/linear-port.ts`: `Page<T>`, `IssueScope`, `AttachmentMetadata`,
`AttachmentView`, `IssueView`, `CreateIssueInput`, `IssueUpdatePatch`, `TeamMetadataCollections`,
`LinearPort`; `src/urls/attachment-url.ts`: `AttachmentUrlConfig`, `ParsedAttachmentUrl`)
are **consumed as-is — never redefined or edited** (ROADMAP rule 2). Sections §1–§9 are
007-local types; §10 is the port↔platform field mapping (a reference table over frozen
shapes, not a new type). Decisions referenced as R# → [research.md](./research.md).

## 1. `TrackerClientOptions` — 007-local wiring (extends, not redefines, config)

```ts
export interface TrackerClientOptions {
  readonly apiUrl?: string;            // default "https://api.linear.app/graphql" (R11)
  readonly transport?: HttpTransport;  // default built-in-fetch impl (R3)
  readonly env?: Record<string, string | undefined>; // default process.env (R5)
  readonly clock?: Clock;              // 002 src/state/clock.ts Clock (injected; R4/R16)
  readonly rng?: () => number;         // [0,1) jitter source; default seeded splitmix over
                                       //   a fixed constant seed — deterministic (Principle IV)
  readonly sleep?: (ms: number) => Promise<void>; // default real timer; injected in tests (R4)
  readonly timeoutMs?: number;         // default 30_000 — AbortSignal per request (R11)
  readonly baseDelayMs?: number;       // default 250   (R4 schedule)
  readonly maxDelayMs?: number;        // default 15_000 (R4 schedule / Retry-After clamp)
  readonly orphanProbeLimit?: number;  // default 8 (R8 bounded orphan window)
  readonly credentialKind?: "token" | "apiKey"; // selects which frozen env-NAME to read (R5);
                                                //   default "token"
  readonly diagnostics?: (d: TrackerDiagnostic) => void; // non-fatal pre-flight notes (R5);
                                                         //   default no-op
}
```

Validation (throws `TrackerConfigError` at construction): `baseDelayMs ≤ maxDelayMs`;
`orphanProbeLimit ≥ 0`; `apiUrl` is an `https:` URL without query/fragment. Everything else
has a generic default — zero consumer-required values (Principle III).

## 2. Transport seam (R3)

```ts
export interface HttpRequest {
  readonly json: unknown;              // GraphQL body { query, operationName, variables }
  readonly accessToken: string;        // opaque; never logged (R5 sanitizer)
  readonly timeoutMs: number;
}
export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>; // lower-cased keys
  readonly body: unknown;              // parsed JSON (or { __rawText } when non-JSON)
}
export interface HttpTransport {
  postJson(req: HttpRequest): Promise<HttpResponse>; // network/timeout → throws (classified R4)
}
```

Relationships: `internal/request.ts` is the **sole** constructor-side consumer; production
binding = `fetchTransport()`; test bindings = recorded driver (§8) or inline stubs.

## 3. Resilience policy objects (R4)

```ts
export type RetryClass = "non-create" | "never";   // "never" = createIssue path only
export interface RetryOutcome { attempts: number; /* ≥1 */ waitedMs: number }
// Pure schedule function — unit-testable with injected clock/rng:
export function nextDelayMs(attempt: number, opts: {
  baseMs: number; maxDelayMs: number; rng: () => number;
  retryAfterHeader?: string | null; now: Date;
}): number;
```

Rules (normative text in contracts/resilience-and-credentials.md): equal jitter over
`min(baseMs · 2^attempt, maxDelayMs)`; `Retry-After` (delta-seconds or HTTP-date vs
`now`) **replaces** the computed value, clamped `[0, maxDelayMs]`; malformed header →
ignore and keep computed value.

## 4. Credentials and pre-flight (R5)

```ts
export interface CredentialBundle { readonly envVarName: string; readonly value: string }
export interface TrackerDiagnostic {
  readonly code: "credential-prefix-mismatch" | "page-size-clamped";
  readonly message: string;            // names env-var NAME / config key only — never a value
}
```

Transition: construction → (`env[name]` unset/empty) → `TrackerConfigError` abort (zero
requests issued) | set → shape check (prefix `personalKeyPrefix`) → optional diagnostic →
ready. The bundle value is referenced only by `HttpRequest.accessToken` and the sanitizer's
strip list.

## 5. Error taxonomy (R12)

```ts
export type TrackerErrorCategory =
  | "config" | "auth" | "rate-limit" | "server" | "network" | "timeout"
  | "not-found" | "client" | "graphql" | "create-indeterminate";
export interface TrackerError {
  readonly category: TrackerErrorCategory;
  readonly retryable: boolean;         // mirrors R4 classification of the FINAL failure
  readonly attempts: number;           // requests actually issued (1..maxRetries+1; 1 for "never")
  readonly httpStatus?: number;
  readonly detail: string;             // sanitized (R5): no credential value, no org PII beyond
                                       //   platform-returned issue keys/team keys
}
// subclasses: TrackerConfigError; IndeterminateCreateError (category
// "create-indeterminate", retryable: false — 008 reconciles via create-intent, never replays)
```

Classification table (HTTP/GraphQL → category) lives in
[contracts/resilience-and-credentials.md](./contracts/resilience-and-credentials.md) §2.

## 6. Chain enumeration result (R8)

```ts
export interface AttachmentChainResult {
  readonly taskUuid: string;                  // 002 Stable_UUID shape (validated by URL builder)
  readonly canonical: AttachmentView | null;  // page 0 — the sole identity anchor (Principle II)
  readonly pages: readonly AttachmentView[];  // contiguous pages 1..N (empty when N = 0);
                                              //   stops at the FIRST absent index
  readonly orphans: readonly number[];        // page indices > N+1 found present within the
                                              //   bounded probe window — reported, never skipped
}
```

Validation: `canonical === null` ⇒ `pages` and `orphans` are empty (no continuation without
the anchor — spec: identity keys solely off page 0). Determinism: identical world ⇒
identical result (property-tested).

## 7. Identity resolution helpers (R8; consumed by 006/008)

```ts
export interface TaskIdentityMatch { readonly taskUuid: string; readonly issues: readonly IssueView[] }
// >1 issues = constitution II integrity signal — the CALLER (006/008) aborts; the port/helper
// reports all carriers (frozen findIssuesByAttachmentUrl returns an array).
```

No new identity anchor is introduced: resolution is exclusively through
`canonicalAttachmentUrl` (002) + attachment metadata (FR-004).

## 8. Recorded-fixture schema (R9; data files under `tests/fixtures/tracker/scenarios/`)

One directory per scenario:

```text
scenarios/<name>/
├── scenario.json          # { name, notes, placeholderIdentities: ["acme-team", …] }
└── NN-<operationName>.json # ordered pairs: { "request": { operationName, variables },
                            #   "response": { status, headers?, body } }  (NN = 01,02,…;
                            #   headers never include Authorization — redacted at record time)
```

Driver matching: earliest unconsumed pair whose `operationName` matches and whose
`variables` match the request on the keys the scenario pins (`teamKey`, `after`, `url`,
`issueId`, …); unmatched request → driver throws `FixtureMiss` (loud, never silent).
Fake-world programs (in-memory seeds for `fake-port.ts`, consumed by integration tests) are
plain TS/JSON builders under the same directory, `world.json`:
`{ teams, issues, attachments, scriptedFailures? }` with placeholder identities and
synthetic UUIDs only (hygiene-scanned).

## 9. Fake world internals (`src/tracker/testing/fake-port.ts`; programmatic, not shipped as config)

| Structure | Content | Port methods served |
|---|---|---|
| `issues: Map<id, IssueView & { _team: string; _project: string }>` | issue table | getIssue, createIssue, updateIssue, archiveIssue, listIssues |
| `byUrl: Map<url, Set<issueId>>` + `attachments: Map<attId, AttachmentView>` | URL → carriers index | findIssuesByAttachmentUrl, getAttachmentByUrl, upsertAttachmentByUrl (update-in-place semantics per R7) |
| `perIssue: Map<issueId, AttachmentView[]>` + opaque cursors | ordered attachment lists | listAttachments (cursor pages over the live list) |
| `teams: Map<key, { projects, workflowStates }>` | metadata | discoverMetadata |
| `scriptFailures: Map<method, { atCall: number; kind: "http-429-retryAfter" \| "http-5xx" \| "network" \| "graphql-userError"; then?: "succeed" }>` | deterministic fault injection | failure-path parity (mid-pagination, rate-limit sequences) |

The fake applies the **same** scoping predicate semantics (R6 client guard) and the same
error taxonomy (R12) so the parity suite (R9) compares like with like.

## 10. Port ↔ platform field mapping (R10; reference over FROZEN shapes — changes here are amendments to *this* doc, not to 002)

| Frozen view field | Platform source | Notes |
|---|---|---|
| `IssueView.id` | `Issue.id` | platform UUID |
| `IssueView.key` | `Issue.identifier` | e.g. `ACM-123` placeholder-shaped in fixtures |
| `IssueView.teamKey` | `Issue.team.key` | per-team scoping key (R6) |
| `IssueView.projectId` | `Issue.project.id` | null project → `""` (documented mapping choice) |
| `IssueView.title` / `.description` | `Issue.title` / `.description` | description is **data**, never an identity route (FR-004 allow-list) |
| `IssueView.stateType` | `Issue.state.type` | e.g. `canceled`, `duplicate` (ignored-state matching, R6) |
| `IssueView.updatedAt` | `Issue.updatedAt` | ISO-8601 passthrough |
| `IssueView.archived` | `Issue.archivedAt != null` | |
| `AttachmentView.id/url/title/subtitle` | `Attachment.id/url/title/subtitle` | |
| `AttachmentView.metadata` | `Attachment.metadata` | flat string|number map (frozen "flat by rule") |
| `TeamMetadataCollections.teamKey` | `Team.key` | discovery resolves identities (R10) |
| `TeamMetadataCollections.projects[{id,name}]` | `Team.projects[{id,name}]` | resolves config project identities → ids (R6 filter) |
| `TeamMetadataCollections.workflowStates[{id,name,type}]` | `Team.states[{id,name,type}]` | `type` feeds stateType values |
| `CreateIssueInput.teamKey` | → resolved `teamId` via metadata cache | `issueCreate(input: { teamId, … })` (R10) |
| `CreateIssueInput.parentId` | `issueCreate(input.parentId)` | ordering policy owned by 008 |
| `IssueUpdatePatch.stateTypeId` | `issueUpdate(input.stateId)` | name mapping only |
| `IssueScope.pageSize` | connection `first` | validated 1..250, clamp + `page-size-clamped` diagnostic (R6) |

## State transitions summary (007-local)

- **Request attempt** (R4): `issued → (succeeded | retryable-failure → backoff → issued…)
  × ≤ maxRetries | terminal-failure` — for class `never`: `issued → (succeeded |
  IndeterminateCreateError)` (single edge, no loop).
- **Chain walk** (R8): `page0? → contiguous(1,2,…N) → gap → orphan-probe(≤ window) → done`;
  never re-visits an index; terminates on first absent index.
- **Metadata cache** (R10): `empty → warm(per-team)` within one port instance lifetime;
  no expiry policy by design (fresh instance = fresh discovery).

## Relationships (overview)

`client.ts` composes: `credentials.ts` (§4) + `internal/request.ts` (§2,§3,§5) +
`graphql/documents.ts` + `graphql/mapping.ts` (§10) → `LinearPort` implementation;
`pagination.ts`/`scoping.ts` (R6) drive `listIssues`; `chain.ts` (§6,§7) is pure port-level
behavior usable against the **fake too** (parity of chain semantics is suite-tested);
`testing/` (§8,§9) consumes only frozen port types + §2 seam. Nothing outside
`src/tracker/**` gains a transport or credential reference (R12 scan).
