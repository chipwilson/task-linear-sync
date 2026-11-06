# Contract: Resource Bounds (FR-005, FR-006, FR-007, FR-009)

## 1. The 002 config amendment (research R1) — one commit, three artifacts

`specs/002-core-domain-contracts/contracts/configuration.md` + `src/config/schema.ts` +
`src/config/defaults.ts` change TOGETHER, noted against feature 001, nothing else riding along:

```ts
// WebSurfaceConfig additions
readonly maxCacheEntries: number;        // default 500,        guard 1..100000
readonly maxConcurrentWalks: number;     // default 8,          guard 1..64
readonly maxConcurrentSseStreams: number;// default 16,         guard 1..1000
readonly secureCookies: boolean;         // default false       (boolean guard)

// McpSurfaceConfig additions
readonly planReferenceTtlSeconds: number;  // default 3600,     guard 60..86400
readonly planReferenceMaxEntries: number;  // default 1000,     guard 1..100000
```

- Range guards run where the surfaces already resolve settings:
  `src/history-server/options.ts` (four `web.*` lines) and `src/mcp/config.ts` (two `mcp.*`
  lines) — all problems listed at once, one dotted-key line each (`HistoryServerConfigError` /
  `McpConfigError` unchanged shapes).
- Defaults reproduce pre-014 observable behavior; defaults-scan rows extended.

## 2. History cache bound (FR-005, research R2)

- `createHistoryCache(deps { ttlSeconds, maxEntries, clock })`.
- Touch-on-hit: successful read of a FRESH entry moves it to the most-recent `Map` slot.
- On `set` past `maxEntries`: evict from the front (LRU; insertion-order tie-break); `flights`
  unbounded (admission is capped by §3 instead).
- Eviction NEVER changes response bytes (SC-002 rule; asserted by a fan-out test comparing
  bounded vs. `maxEntries: 100000` responses against the same fake tracker).

## 3. History admission bounds (FR-006, research R3)

Dispatch order at `createSyncHistoryServer`: parse route → auth gate → (GET stream? join :
data read).

- Live-stream join: if openStreams ≥ `maxConcurrentSseStreams` →
  `429 RATE_LIMITED` envelope + `Retry-After: 1`, zero history bytes; never open, so never
  counted.
- Data request cache miss that would start a walk: if inFlightWalks ≥ `maxConcurrentWalks` →
  same 429 envelope. Cache hits and single-flight FOLLOWERS are never refused — only walk
  leaders count.
- `Retry-After: 1` is the only envelope addition (header, not body) — the frozen body shape is
  untouched; the `http-surface.md` amendment records the self-protective trigger.
- Tracker-originated rate limits keep their existing mapping; the component still issues zero
  retries of its own.

## 4. Session cookie `Secure` (FR-007, research R4)

- Cookie string base (frozen, unchanged): `<name>=<value>; Path=/; HttpOnly; SameSite=Strict`.
- `web.secureCookies: true` → append `; Secure`. Default `false` → byte-identical to 011 merged.
- NO `X-Forwarded-Proto` sniffing. Doc rule (Security posture section): TLS-fronted deployments
  MUST set `secureCookies: true`; the front door terminates TLS.
- Bootstrap-token path (POST) shares the same builder → same rule.

## 5. MCP plan-reference store lifecycle (FR-009, research R6)

- Construction: `createPlanReferenceStore(clock, { ttlSeconds, maxEntries })` from
  `mcp.planReference*` settings (defaults §1).
- `record`: shape check (unchanged) → expiry sweep (drop `age > ttl`) → insert → capacity trim
  (oldest `recordedAt` first, insertion-order tie-break) → `true`.
- `has`/`get`: expired entry ⇒ treated as absent (lazy), removed opportunistically.
- Refusal integration: a `task_sync_apply` naming an expired/evicted reference hits the
  EXISTING `PLAN_REFERENCE_UNKNOWN` step-3 refusal — zero engine/port/state touch, message
  unchanged ("run task_sync_plan"). No new gate codes; `apply-gating.md` amendment folds TTL
  language into the same ladder step.
- Invariants preserved: in-memory only, zero `node:fs`, restart-clears, `PLAN_ID_PATTERN`.

## 6. SSE reconnect contract (FR-011, research R9)

- `Last-Event-ID` request header: ignored (asserted, not merely absent); every stream starts
  with the full current chain.
- Recorded as `sse-last-event-id-resume: re-deferred` non-goal in the Stability section with
  its revisit trigger.

## 7. Error/envelope inventory delta (for the freeze snapshot)

| Trigger | Status | Body | Header delta |
|---|---|---|---|
| SSE join over limit | `429` | existing `RATE_LIMITED` envelope | `Retry-After: 1` |
| Walk over limit | `429` | existing `RATE_LIMITED` envelope | `Retry-After: 1` |
| Tracker rate-limited (unchanged) | `429` | existing `RATE_LIMITED` envelope | — |

No new codes. Zero history bytes / zero credentials on every row (credential-sentinel sweep
extended to the two new triggers).
