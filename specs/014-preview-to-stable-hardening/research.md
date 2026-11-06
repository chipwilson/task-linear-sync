# Research: Preview-to-Stable Hardening (011 & 012 Surfaces)

**Feature**: `specs/014-preview-to-stable-hardening/spec.md` | **Date**: 2026-11-06
Phase 0 output. Every Technical-Context unknown and every deferred-item decision below;
no NEEDS CLARIFICATION markers remain.

## R1. Where the new resource bounds live: one coordinated 002 config amendment

- **Decision**: All six new settings ship as keys on the existing frozen surface groups —
  `web.maxCacheEntries`, `web.maxConcurrentWalks`, `web.maxConcurrentSseStreams`,
  `web.secureCookies`, `mcp.planReferenceTtlSeconds`, `mcp.planReferenceMaxEntries` — added to
  `WebSurfaceConfig`/`McpSurfaceConfig` (`src/config/schema.ts`) with built-in defaults in
  `src/config/defaults.ts`, executed as ONE formal amendment: contract document
  `specs/002-core-domain-contracts/contracts/configuration.md` + the `src/config` modules + the
  `tests/contract/snapshots/frozen-surface.json` check, together, in a dedicated commit noted
  against feature 001, with nothing riding along.
- **Rationale**: spec FR-005/006/007/009 require the bounds to be *configurable* —
  constitution Principle III means config-file-visible, deep-merged keys, and both surfaces
  resolve settings as pure reads of the merged `ResolvedConfig` (`src/history-server/options.ts`
  reads `config.web`; `src/mcp/config.ts` reads `config.mcp`). The `web` and `mcp` groups were
  pre-frozen in 002 precisely so later surfaces could carry settings; the amendment rule in
  `docs/contract-amendments.md` is the sanctioned path. Adding interface *fields* does not
  change the snapshot's exported-name sets (so the drift test stays green by construction), but
  the change is still done as a full three-artifact amendment because the rule governs contract
  *shape*, not just test visibility. Defaults preserve observable behavior exactly: generous
  caps, `secureCookies: false` — spec FR-007's "defaults byte-for-byte as merged".
- **Alternatives considered**:
  - (a) Module constants with deps-injection overrides (011's session-lifetime/chain-walk
    precedent): rejected — the chain-walk bound is an intrinsic integrity ceiling, but operator
    capacity knobs are exactly what Principle III says must be overridable without code.
  - (b) A new non-frozen `history`/`mcpTuning` config group: rejected — adding a top-level
    group is a LARGER frozen-surface change (new exported type = snapshot drift) than adding
    fields to groups designed for this purpose.
  - (c) Env-var-only overrides: rejected — bypasses the deep-merge model and the
    complete-listing validation posture both surfaces already have.

## R2. History cache: deterministic LRU under the existing TTL model

- **Decision**: Extend `createHistoryCache` with a `maxEntries` bound: touch-on-hit (delete +
  re-`set` to move the key to the most-recent `Map` slot), evict from the front of the `Map`
  (least-recently-used; insertion order is the deterministic tie-break) whenever a `set` would
  exceed the bound. TTL stays lazy (checked at read) — no timers. In-flight promises (`flights`)
  stay unbounded: they are transient by construction and bounded indirectly by R3's walk
  counter.
- **Rationale**: closes 011 research R6's deferred item. `Map` iteration order is insertion
  order in V8/ECMAScript spec terms, giving a deterministic, clock-free LRU (constitution IV);
  eviction cannot change response bytes because every miss path rebuilds from the tracker.
  Default `maxCacheEntries: 500` (range `1..100_000`; range guards in `options.ts`).
- **Alternatives considered**: (a) TTL-sweep-on-write only (no LRU): rejected — the pathological
  case is breadth (many distinct tasks, each fresh), not age; (b) weight-by-entry-size: rejected
  — chain sizes are already bounded (1000-page walk cap), uniform entry counts are simpler and
  testable; (c) `LRU` via third-party dep: forbidden (zero-dep budget).

## R3. History inbound bounds: pre-admission counters, existing 429 envelope

- **Decision**: In `createSyncHistoryServer`'s dispatch, count (i) in-flight chain-walk
  operations (incremented only when a cache miss actually starts a walk — single-flight leaders)
  and (ii) concurrently open SSE streams. Over-limit requests are answered with the existing
  `RATE_LIMITED` envelope (429, zero history bytes) extended with a `Retry-After: 1` header —
  no queueing, no retry inside the component (011's existing "no retries of its own" posture).
  Defaults `maxConcurrentWalks: 8`, `maxConcurrentSseStreams: 16`.
- **Rationale**: spec FR-006 asks for bounded resources with a documented backpressure answer;
  `RATE_LIMITED` already exists in the closed error taxonomy (mapped today from tracker
  failures), so no new error code enters the frozen vocabulary — the freeze (R8) records the
  *same* envelope as now also the self-protection answer. Counters are plain integers —
  deterministic under the injected clock-free dispatch.
- **Alternatives considered**: (a) per-client tokens: rejected — the component is
  deliberately credential-light (private/public modes only); identity-keyed limiting invents an
  identity model; (b) shedding via random sampling: rejected — nondeterministic; (c) new
  error code `SERVER_BUSY`: rejected — expands the frozen envelope set for zero benefit.

## R4. `Secure` cookie: explicit config, no forwarded-header auto-detection

- **Decision**: New `web.secureCookies: boolean` (default `false`). When true, the session
  cookie builder in `src/history-server/auth.ts` appends `; Secure`. The security-posture doc
  states the deployment rule: set `secureCookies: true` whenever serving behind a TLS-terminating
  front door; plain-loopback defaults stay byte-identical to 011 as merged.
- **Rationale**: spec FR-007 allowed "explicit config or forwarded-protocol recognition,
  whichever the plan picks". An explicit boolean is deterministic, un-spoofable, and keeps the
  component honest about what it can see (it terminates no TLS of its own).
- **Alternatives considered**: (a) honor `X-Forwarded-Proto`: rejected — without a trusted-proxy
  allow-list the header is client-controlled; a cookie marked `Secure` because an attacker said
  so is worse than honest config; (b) always-on `Secure`: rejected — breaks the default loopback
  deployment (browser drops `Secure` cookies over `http://127.0.0.1`… except exceptions vary by
  browser — another reason to keep it explicit).

## R5. Bearer unification: history server adopts the MCP parser's semantics; parity pinned in tests

- **Decision**: Replace the case-sensitive `startsWith("Bearer ")` check in
  `src/history-server/auth.ts` with the MCP server's RFC 7235 semantics:
  `/^\s*bearer\s+(.+)$/i` (scheme case-insensitive, whitespace-tolerant), then the existing
  length-guard + `timingSafeEqual`. Add `tests/integration/bearer-semantics-parity.test.ts`:
  boots BOTH real servers (history over its `node:http` handler, MCP over `listenHttp()`) and
  runs one shared casing/whitespace matrix (`Bearer`/`bearer`/`BEARER`/`BeArEr`, leading
  spaces, tab separators, absent header, wrong token, correct token) asserting identical
  accept/reject verdicts, `www-authenticate: Bearer` on scheme-absent refusals from both, and
  zero credential bytes in any response.
- **Rationale**: 012's parser already conforms; one semantic, pinned black-box across real
  transports. The hygiene contracts keep `src/mcp` and `src/history-server` mutually
  unreachable, so a shared runtime module is off the table — the test is the unifier.
- **Alternatives considered**: (a) shared `src/lib` bearer util: rejected (plan Complexity
  Notes; new cross-module coupling for a regex); (b) "unify" by making MCP strict like 011:
  rejected — RFC 7235 says the scheme is case-insensitive; strictness was the bug.

## R6. MCP plan-reference store: TTL + capacity, lazy expiry, fail-closed vocabulary

- **Decision**: `createPlanReferenceStore(clock, { ttlSeconds, maxEntries })` (from `mcp.*`
  settings): `record` stamps `recordedAt` (already does) and evicts expired entries plus
  oldest-front entries beyond capacity; `has`/`get` treat an expired record as absent (lazy
  check, no timers). An evicted/expired reference is simply *not a session member* → the
  existing step-3 refusal `PLAN_REFERENCE_UNKNOWN` fires with zero engine/port/state touch —
  the same vocabulary apply-gating.md already freezes. Defaults `planReferenceTtlSeconds: 3600`
  (range `60..86_400`), `planReferenceMaxEntries: 1_000` (range `1..100_000`).
- **Rationale**: spec FR-009 requires boundedness + fail-closed refusal through existing
  vocabulary; session membership was always the semantic, so expiry composes with it exactly —
  a restarted process and an expired reference become indistinguishable, which is the guarantee
  012 sold. The injected `Clock` keeps it deterministic; `mcp-hygiene` (zero `node:fs`) is
  unaffected.
- **Alternatives considered**: (a) evict-with-distinct-code `PLAN_REFERENCE_EXPIRED`: rejected —
  adds a frozen-vocabulary member and a timing side-channel ("your ref existed") for zero safety
  gain; unknown IS expired, by design; (b) background sweep timer: rejected — timers break the
  hermetic determinism posture; lazy + on-write sweeps suffice; (c) persist to state dir:
  rejected again (012 rejected it; restart-clears is the feature).

## R7. MCP protocol currency: add `2025-06-18` to the hand-rolled negotiation set

- **Decision**: `SUPPORTED_PROTOCOL_VERSIONS` becomes
  `["2024-11-05", "2025-03-26", "2025-06-18"]` with `DEFAULT_PROTOCOL_VERSION = "2025-06-18"`.
  Behavior per MCP negotiation: supported request → echo it; unsupported (newer or older
  unknown) → respond with the newest supported; malformed `protocolVersion` → `-32602`. The set
  is listed in `specs/012-*/contracts/jsonrpc-stdio.md` and therefore enters the MCP surface
  freeze snapshot (R8); the 012 contract doc is updated as an amendment entry under the new
  011/012 freeze regime in the same change. No `oauth`/elicitation/`sse-get` surface is added —
  the subset framing (012 R2) stands.
- **Rationale**: spec FR-010; current agent hosts negotiate `2025-06-18`, and falling back is
  protocol-legal, so today's hosts already interoperate — but a stable release should name the
  set it actually answers for. One string + one doc line is the full cost without a dependency.
- **Alternatives considered**: (a) adopt the MCP SDK for full protocol surface: rejected —
  breaks the `SPENT 0` budget contract; 012 R1's revisit trigger (need for SDK-only surface)
  has not fired: streamable HTTP, resources, prompts, sampling stay recorded non-goals;
  (b) leave the set and document-only the fallback: rejected — hosts pre-check versions and
  stable-1.0 should not rely on "technically legal fallback" for mainstream compatibility.

## R8. Freeze mechanism for the two surfaces: runtime-derived snapshots, amendment-entry format

- **Decision**: Mirror the 002 regime for 011/012. Two snapshots —
  `tests/contract/snapshots/history-surface.json` and `mcp-surface.json` — are BUILT FROM the
  runtime registries at test time (not hand-written): MCP — tool names/descriptions/`inputSchema`
  JSON, visible-by-default set, protocol-revision set, JSON-RPC error codes, HTTP status codes +
  constant bodies, `mcp.*` config keys + defaults; history — route patterns + methods, status
  codes + envelope bodies from `ERROR_ENVELOPES`, SSE content type, `web.*` config keys +
  defaults. Drift prints a per-element diff list (002's `ADDED/REMOVED/CHANGED` posture).
  Regeneration is deliberate: `UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract`.
  `docs/contract-amendments.md` gains a "Surface contract freezes (011/012)" section defining:
  the frozen-doc lists (already named in spec FR-002), the amendment-entry format — `YYYY-MM-DD ·
  surface · element · before → after · rationale · migration` — and the rule that snapshot
  regeneration requires the matching entry in the same change. SC-001's mutation checks:
  `tests/helpers/surface-freeze.ts` exports the comparator, and the freeze tests run synthetic
  drift objects (dropped tool, renamed route, changed status code, new error code, config-key
  removal) through it, asserting a named failure per element.
- **Rationale**: 002's regime is proven in-repo; deriving snapshots from runtime registries
  (rather than the `.d.ts` text 002 parses) fits these surfaces, whose normative shapes ARE the
  exported registries (`TOOL_DEFINITIONS`, `ERROR_ENVELOPES`, route parser, config defaults) —
  and it catches value drift, which `.d.ts` name-sets cannot.
- **Alternatives considered**: (a) hand-maintained markdown tables as the diff source (012's
  current `mcp-tool-schema` style): kept for tool schemas, but alone it misses routes/status
  codes/config keys; (b) OpenAPI-style spec file: rejected — no tooling consumes it; the
  snapshot + contract doc pair already serves review; (c) extend `frozen-surface.test.ts`
  instead of new suites: rejected — that test guards the 002 surface only; conflating scopes
  muddies the amendment audit trail.

## R9. SSE `Last-Event-ID` resume: re-deferred as a named non-goal

- **Decision**: Not implemented. The server ignores a `Last-Event-ID` request header (verified:
  stream starts fresh, full current chain, no error). The 011 Stability section records the
  reconnect contract ("full re-render is the resume semantics; cadence re-read is idempotent",
  011 research R4 verbatim rationale) and a revisit trigger: adoption by a TLS-fronted real
  deployment showing repeated proxy-side stream drops, or MCP streamable-HTTP adoption (which
  would introduce event-id infrastructure anyway).
- **Rationale**: spec FR-011 demands a RECORDED decision, not implementation. The chain is
  append-only and re-derivable from the tracker; a resume cursor would cache chain state the
  component deliberately does not own (011 FR-004 posture: nothing reconstructed from local
  state).
- **Alternatives considered**: (a) implement event ids + replay: rejected for now — real cost
  (per-stream cursor state, R3 bounds interplay) for a problem no deployment has shown;
  (b) silently ignore without documentation: forbidden by spec FR-011.

## R10. Traceability reconciliation: as-built wording, cited to the features' own research

- **Decision**: `specs/requirements.md` lines describing the two surfaces are corrected to
  as-built: the history component is a zero-runtime-dependency server-rendered surface over
  Node's built-in HTTP (cites 011 plan/research R1), and the MCP transport set is stdio +
  loopback HTTP (cites 012 research R1/R2) — the Next.js/React and remote-HTTP/SSE wordings are
  removed. README fixes: drop the three `(preview)` labels and the `docs/agent-tools.md`
  disclaimer paragraph; replace the `test:cli` mention with the real script list; surface-table
  rows become `✅ merged (stable 1.0-prep)` at promotion… final wording: plain `✅ merged` once
  this feature's SCs pass. Spec status flips: 011/012 `spec.md` `Status: Draft` →
  `Stable (promoted by 014, 2026-11-XX)`.
- **Rationale**: the documentation duty + roadmap traceability; the requirement text's
  technology claims were superseded by in-feature research decisions, so the catalog follows
  the features, cited — not silent rewording.
- **Alternatives considered**: (a) leave `requirements.md` and note the drift in a footnote:
  rejected — the catalog is the traceability source; stale normative wording is precisely the
  "silent deviation" the constitution's Governance section forbids; (b) renumber/rewrite
  groups P/Q: rejected — only the descriptive wording drifts; the FR semantics (082–094) are
  unchanged and remain owned by 011/012.

## Deferred-decision register (spec FR-011 completeness check)

| Item | Source | Decision | Where recorded |
|---|---|---|---|
| History cache LRU cap | 011 R6 | **Implemented** (R2) | `resource-bounds.md`, docs |
| SSE `Last-Event-ID` resume | 011 R4 | **Re-deferred**, trigger recorded | R9, 011 Stability section |
| MCP SDK / SDK-only surface (resources, prompts, sampling, elicitation, roots, subscriptions, streamable HTTP) | 012 R1/R2 | **Re-deferred** (012 R1 trigger stands + R9 trigger) | R7, 012 Stability section |
| MCP TLS / remote exposure | 012 R9 | **Re-deferred** — loopback remains the documented shape; TLS is front-door's job (same rule as R4) | 012 Stability section |
| MCP protocol revision set | 012 R2 | **Implemented** — set extended to `2025-06-18` (R7) | `jsonrpc-stdio.md` amendment entry |
| Unbounded plan-reference store | 012 design gap | **Implemented** (R6) | `resource-bounds.md` |
| Bearer semantics split | cross-surface audit | **Implemented** — MCP semantics win (R5) | `bearer-parity.md` |
