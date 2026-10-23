# Contract: Tracker Adapter (conformance to the frozen `Linear_Port`)

Module: `src/tracker/` (factory `createLinearPort`). **Conforms to** the frozen interface
`src/ports/linear-port.ts` — mirror `specs/002-core-domain-contracts/contracts/tracker-port.md`.
This document adds zero capability to that interface; it specifies, per frozen member, the
platform operation, resilience class, error mapping, and behavioral obligations. Verbatim
frozen-wording obligations are quoted, not paraphrased.

```ts
/** src/tracker/client.ts — composition root; all fields except `config` optional (R11). */
export function createLinearPort(deps: {
  readonly config: ResolvedConfig;          // FROZEN 002 type — consumed, not extended
  readonly urlConfig?: AttachmentUrlConfig; // defaults: derived from config (002 frozen type)
  readonly options?: TrackerClientOptions;  // data-model §1
}): LinearPort;
```

`createLinearPort` runs the credential pre-flight (resilience-and-credentials.md §3) before
returning — a misconfigured client throws `TrackerConfigError` **at construction**, "MUST be
rejected with a naming diagnostic before any request" (constitution credential handling),
and issues zero requests.

## Per-member conformance table

| Frozen member | Platform operation | Retry class (R4) | Behavior obligations (frozen wording in quotes) |
|---|---|---|---|
| `listIssues(scope)` | `issues(first, after, filter)` connection per team, sequential per team, teams parallel ≤ `concurrency` | `non-create` | "Pagination until exhausted; inclusion = configured team AND configured project AND not ignored state type (007 FR-001)" — filter built per R6; per-team filters only, "per-team scoping never leaks". "Yields complete pages; failure after retries surfaces with no partial-inventory consumption" — a page is fetched whole before its views are yielded; the failed page contributes nothing. Client-side guard re-checks every row; violation ⇒ abort (never leak). |
| `discoverMetadata(teamKeys)` | `teams(filter: { key: { in: $teamKeys } }) { key projects states }` — one query | `non-create` | "Three collections per configured team (007 FR-002)" — `{ teamKey, projects[{id,name}], workflowStates[{id,name,type}] }` for every requested team, in requested order. Warms the identity cache (R10). |
| `getIssue(id)` | `issue(id)` | `non-create` | `null` for absent (GraphQL null / not-found mapping R12). |
| `createIssue(input)` | `issueCreate(input: { teamId(resolved), title, description, stateId?, parentId? })` | **`never`** | "NEVER automatically retried — a failed create is indeterminate, not replayed": exactly one HTTP attempt (`attempts: 1`); post-dispatch failure throws `IndeterminateCreateError`. `teamKey → teamId` via R10 resolution; unknown ⇒ `TrackerConfigError` (pre-dispatch, so it is not indeterminate). |
| `updateIssue(id, patch)` | `issueUpdate(id, input: { title?, description?, stateId? })` | `non-create` | Partial patch passthrough; returns fresh view from mutation payload. |
| `archiveIssue(id)` | `issueArchive(id)` | `non-create` | `void` on `success: true`; `success: false` with `userError` ⇒ `graphql`/`client` error. |
| `findIssuesByAttachmentUrl(url)` | `attachmentsForURL(url)` → map carriers to `IssueView[]`, deduped | `non-create` | "Identity strictly via attachment metadata — URL query or attachment scan; implementations MUST NOT search descriptions for identity (007 FR-004)". Returns **all** carriers (0/1/>1; the >1 integrity abort is the caller's — constitution II). Structural enforcement: R12 document allow-list forbids any search/description-filter operation. |
| `upsertAttachmentByUrl(input)` | `attachmentCreate(input: { issueId, url, title, subtitle?, iconUrl?, metadata })` | `non-create` | "Create-or-update by deterministic URL: updates in place, no duplicate, no attachment id stored anywhere by callers (007 FR-005). Returns the resulting attachment." — platform URL idempotency (R7); adapter stores no attachment identifier anywhere (stateless). |
| `updateAttachment(id, metadata)` | `attachmentUpdate(id, input: { metadata })` | `non-create` | Flat metadata map passthrough (frozen "flat by rule"). |
| `getAttachmentByUrl(url)` | `attachmentsForURL(url)` → first node or `null` | `non-create` | Addressed purely by URL (scheme contract). |
| `listAttachments(issueId, cursor?)` | `issue(id) { attachments(first: pageSize, after: cursor) }` → `Page<AttachmentView>` | `non-create` | Cursor-based pagination per frozen `Page<T>`; `nextCursor: null` at end. (006/008 may scan attachments via this — the FR-004 "scan" route.) |

`chain.ts` helpers (not port members; 007 behavior **over** the port):
`resolveIssueByTaskIdentity` (page-0 URL only — "identity matching keys solely off the
page-0 canonical attachment"), `issueCarriesTaskIdentity` (scan route),
`enumerateAttachmentChain` ("the chain walk (page 0..n, stop at first absent index, report
orphans) is 007 behavior over these ops" — frozen tracker-port comment; spec edge case:
"Chain gap (page 3 missing but page 4 present): the walk stops at the first absent index;
orphaned higher pages are reported, not silently skipped").

## Structural invariants (contract-test enforced)

1. **Conformance parity** — the same behavioral suite runs against the real adapter (over
   the recorded transport) and against the fake; both pass identically (tracker-testing.md
   §3; constitution: fake "MUST conform to the same behavioral contract as the real
   implementation and be contract-tested against it").
2. **Single request site** — `src/tracker/internal/request.ts` is the only fetch consumer;
   scan test fails any other `fetch(`/`linear.app`/transport import in `src/**`
   (constitution V: "All Linear access MUST flow through the injectable `Linear_Port`").
3. **Document allow-list** — `graphql/documents.ts` exports exactly the enumerated
   operations; no description-search capability exists anywhere in the feature (FR-004
   negative).
4. **Zero credential leakage** — R5 sanitizer + sentinel test (see resilience contract §5).
5. **Frozen-surface respect** — 002's `tests/contract/frozen-surface.test.ts` snapshot stays
   byte-identical across this feature's merge (proof nothing frozen was touched).

## Test obligations (mapped in quickstart)

- Multi-team, multi-page corpus: 100% in-scope, 0 out-of-scope retrieval (SC-001);
  cross-team trap issues; per-team result isolation.
- Repeated upsert over the same URL ⇒ exactly 1 attachment (SC-002) — fake **and**
  recorded-adapter parity.
- Adversarial fixtures: UUID-like text in descriptions never matches (SC-003).
- `createIssue` against a 5xx/429/network-failure fixture ⇒ exactly one request observed
  (`attempts: 1`), `IndeterminateCreateError` raised, no replay.
- Mid-pagination failure after retries ⇒ iterator throws, no partial page consumed.
- Chain gap/orphan fixtures; stop-at-first-absent-index; `canonical: null ⇒ empty pages`.
