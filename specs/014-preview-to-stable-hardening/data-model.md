# Data Model: Preview-to-Stable Hardening (011 & 012 Surfaces)

**Feature**: `specs/014-preview-to-stable-hardening/spec.md` | **Date**: 2026-11-06
Phase 1 output. Entities introduced or extended by 014. Nothing here redefines a frozen 002
entity except the sanctioned config amendment (§3); all cross-referenced frozen shapes
(`Clock`, gate vocabularies, `RATE_LIMITED` envelope, `PLAN_ID_PATTERN`) are consumed verbatim.

## 1. Stability Declaration (`docs/agent-tools.md` §Stability, `docs/history-server.md` §Stability)

The per-surface promise the feature adds. One per surface; documentation-native (no runtime
object), machine-checked for presence by the freeze tests.

| Field | Rule |
|---|---|
| `surface` | `"mcp"` \| `"history"` — exactly one declaration each (FR-001) |
| `status` | `"stable"` after promotion; the ONLY value that permits dropping the preview label; `promotedBy: "014"`, `effectiveDate: ISO date` |
| `guaranteedScope` | pointer list, never a restatement: the feature's frozen contract docs (spec FR-002) + the surface snapshot file (§5) |
| `notGuaranteed` | everything outside the frozen inventory — single sentence, fixed wording across both docs |
| `nonGoals` | list of `DeferredDecisionRecord` (§4) — MUST cover every row of the R9/R7/R10 register; 0 silent deferrals (FR-011) |

**Consistency rule** (FR-003): README surface table, both usage docs, and `specs/011-*/spec.md`
/ `specs/012-*/spec.md` status lines MUST all state the same status; the freeze tests grep for
`preview` in the two docs + README section headings and fail on any hit after promotion.

## 2. Amendment Entry (`docs/contract-amendments.md` §"Surface contract freezes (011/012)")

The only path past a snapshot guard. One line-entry per changed element, appended to a
per-surface log section.

```text
YYYY-MM-DD · <surface> · <element-id> · <before> → <after> · rationale · migration-note
```

- `element-id` grammar: `tool.<name>`, `tool.<name>.inputSchema`, `route.<pattern>`,
  `status.<code>`, `error.<CODE>`, `config.<dotted.key>`, `protocol.<revision>`,
  `transport.<name>`, `sse.<aspect>`.
- A snapshot regeneration (`UPDATE_SURFACE_SNAPSHOTS=1`) without a matching entry for every
  drifted `element-id` MUST leave CI red (the entry set is diffed against the drift list).
- Entries are append-only; corrections append a new entry (004-style determinism — nothing is
  rewritten).

## 3. Resource Bound settings (config amendment — research R1)

Amendment to the frozen `WebSurfaceConfig` / `McpSurfaceConfig` (one commit; configuration.md +
`src/config/{schema,defaults}.ts` together). All numeric guards follow the existing
"every problem, one dotted-key line" posture.

| Key (on `ResolvedConfig`) | Type | Range | Default | Enforced in |
|---|---|---|---|---|
| `web.maxCacheEntries` | int | `1..100000` | `500` | `cache.ts` (LRU, R2) via `options.ts` |
| `web.maxConcurrentWalks` | int | `1..64` | `8` | `create.ts` dispatch counter (R3) |
| `web.maxConcurrentSseStreams` | int | `1..1000` | `16` | `create.ts` stream registry (R3) |
| `web.secureCookies` | boolean | — | `false` | `auth.ts` cookie builder (R4) |
| `mcp.planReferenceTtlSeconds` | int | `60..86400` | `3600` | `plan-store.ts` (R6) via `mcp/config.ts` |
| `mcp.planReferenceMaxEntries` | int | `1..100000` | `1000` | `plan-store.ts` (R6) |

- Defaults MUST reproduce pre-014 observable behavior (generous; `secureCookies:false`);
  defaults-scan extends to these keys (Principle III; zero org literals — all numeric/boolean).
- `ResolvedHistoryServerSettings` gains `maxCacheEntries`, `maxConcurrentWalks`,
  `maxConcurrentSseStreams`, `secureCookies`; MCP `McpSettings` gains the two `planReference*`
  fields. Both are still pure reads of the merged config — no new config sources.

## 4. Deferred Decision Record (stability docs, R9 register)

| Field | Rule |
|---|---|
| `item` | stable slug: `sse-last-event-id-resume`, `mcp-sdk-protocol-surface`, `mcp-tls-remote-exposure`, … |
| `decision` | `"implemented"` \| `"re-deferred"` |
| `rationale` | one paragraph; re-deferrals quote the originating research reference (e.g. 011 R4) |
| `revisitTrigger` | observable condition; MUST be non-empty for every `re-deferred` (FR-011) |

State rule: a record flips `re-deferred → implemented` only via an amendment entry (§2) for the
affected surface elements plus the doc update in the same change (documentation duty).

## 5. Surface Snapshot (the freeze artifacts — research R8)

Machine-generated JSON at `tests/contract/snapshots/{history,mcp}-surface.json`; content is
DERIVED from runtime registries at test time and compared, never hand-edited.

- **`mcp-surface.json`**: `tools[]` (`name`, `description`, `inputSchema` as parsed JSON,
  `visibleByDefault`), `protocolVersions[]`, `jsonrpcErrorCodes[]`, `httpStatusBodies` (status →
  constant body), `configKeys` (`mcp.*` dotted keys → defaults), `transports[]`.
- **`history-surface.json`**: `routes[]` (pattern, methods), `statusBodies` (status → envelope
  shape from `ERROR_ENVELOPES`), `sseContentType`, `configKeys` (`web.*` → defaults),
  `accessModes[]`, `cookieAttributes` (the `Path=/; HttpOnly; SameSite=Strict` base set +
  conditional `Secure`).
- **Comparator drift list** (tests helper): `ADDED <id>`, `REMOVED <id>`,
  `CHANGED <id>: <before> → <after>` — one line per element (002's posture). The freeze test
  fails iff the drift set minus the amendment-entry set is non-empty.
- **Mutation checks** (SC-001): for each inventory category, the suite feeds one synthetic drift
  (drop a tool / rename a route / flip a status body / add an error code / remove a config key)
  through the comparator and asserts the exact drift line — 5 named checks per surface as
  applicable.

## 6. Plan Reference lifecycle (extension of the frozen 012 store record)

`PlanReferenceRecord` keeps `{ planId, recordedAt }`; membership semantics unchanged, now
time-and-pressure bounded.

```text
record(planId) ──▶ VALID ──(clock − recordedAt > ttlSeconds)──▶ EXPIRED (lazy, on has/get/sweep)
                    │
                    └─(store size > maxEntries, oldest-first on record)──▶ EVICTED
EXTERNAL: process restart ⇒ store empty ⇒ UNKNOWN
```

- `EXPIRED` and `EVICTED` are indistinguishable from `UNKNOWN` at the API (`has → false`) —
  intentional (R6): refusal is `PLAN_REFERENCE_UNKNOWN` with zero engine/port/state touch; no
  new gate code, no timing side-channel.
- Validation rules inherited: `isPlanIdShape` (`PLAN_ID_PATTERN`, sha256 hex) gates `record`
  before insertion; invalid shapes still return `false`.
- Sweeps run lazily on `has`/`get` (expired-hit) and eagerly inside `record` (expiry pass +
  capacity trim, oldest `recordedAt` first, insertion-order tie-break) — deterministic, clock
  injected, no timers.

## 7. History cache entry lifecycle (extension)

```text
MISS ──walk(ok)──▶ FRESH ──(age > ttl)──▶ STALE(on read ⇒ refetch) ──▶ rebuilt
FRESH ──on hit──▶ most-recent Map slot (touch)      any ──size > max──▶ EVICTED (front slot)
walk(error) ──▶ not cached (existing delete-on-error path)
```

Eviction and staleness affect hit-rate telemetry only; response bytes MUST be identical to an
uncached walk for the same tracker state (SC-002 correctness rule). In-flight `flights` are
outside the entry bound and unbounded by design (R3 caps walk admission instead).

## 8. Bearer token verdict (cross-surface, R5)

Closed matrix over `(header casing × whitespace × token validity)`; verdicts
`ACCEPT | REJECT_401_SCHEME | REJECT_403_TOKEN` defined in `contracts/bearer-parity.md` and
identical across the two surfaces' real transports. No new entity persists; the token remains
an env-read secret compared with `timingSafeEqual`.
