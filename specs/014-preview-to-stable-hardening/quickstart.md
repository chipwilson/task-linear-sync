# Quickstart: 014 — Preview-to-Stable Hardening (011 & 012 Surfaces)

**Date**: 2026-11-06 | **Journey**: from two preview-labelled surfaces to stability declarations
backed by machine-enforced freezes, resource bounds that survive long-lived deployments, one
bearer semantic, and current MCP protocol negotiation — with zero new dependencies, zero new
subpaths, and defaults byte-identical to 011/012 as merged.

Every check runs against built `dist/` plus the hermetic suites (fake `Linear_Port`, injected
`fixedClock`, loopback HTTP, spawned children). Verification mirrors the test tiers
(unit → contract → integration → e2e; contracts/README.md enforcement map).

## Prerequisites

```bash
npm ci && npm run build    # dist/ for both surfaces
npm test                   # full suite green BEFORE starting (baseline)
```

- History world: `createSyncHistoryServer(deps)` with fake port, injected clock/env, settings
  overrides via the amended `web.*` keys (tests/helpers world builders, 011 fixtures).
- MCP world: `createAgentToolServer(deps)` over the 009/008 fake worlds; long-lived HTTP mode
  with a token in the env var named by `mcp.authEnvVarName`.
- `tests/helpers/surface-freeze.ts` — comparator + synthetic-drift builders.

## Scenario 1 — the freeze catches unamended drift (US1, FR-002, SC-001)

```bash
npm run test:contract -- surface-freeze     # both snapshots match the live registries

# Mutation checks run INSIDE the suite (surface-freeze.md §4): each injects one synthetic drift
# and asserts the exact drift line — a dropped tool, a renamed route, a flipped 429 envelope,
# an added error code, a removed config key, a changed inputSchema.

# Human demo (fails exactly once, on purpose):
node -e "/* temporarily delete a tool from a cloned inventory */" # via the helper's demo mode
UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract                  # deliberate regeneration
```

**Expected**: clean run passes; every injected drift produces its named `ADDED/REMOVED/CHANGED`
line (≥ 5 categories per surface as applicable); amendment-entry ids from
`docs/contract-amendments.md`'s new 011/012 section are checked to still exist in the snapshot.

## Scenario 2 — history server under fan-out and overload (US2, FR-005/006/007, SC-002/003)

```js
// integration: history-bounds — fake port with M ≫ maxCacheEntries distinct tasks
settings: { web: { maxCacheEntries: 4, maxConcurrentWalks: 2, maxConcurrentSseStreams: 2 } }
browse 50 distinct task pages          → cache size never > 4; responses byte-equal to the
                                         maxEntries:100000 control run over the same tracker
3 concurrent cache-miss GETs           → 2 admitted; the 3rd: 429 + RATE_LIMITED envelope +
                                         Retry-After: 1, body holds ZERO history bytes
3 concurrent /stream joins             → 2 admitted; 3rd refused like above
GET with Last-Event-ID: "99"           → full current stream (header ignored, no error)
secureCookies:true, POST bootstrap     → Set-Cookie ends "; Secure"; default:false → the exact
                                         011-merged cookie string, byte-for-byte
```

**Expected**: SC-002 (bounded entries, identical bytes) and SC-003 (100% of excess requests get
the documented envelope with zero history bytes; admitted requests complete normally). The
existing SSE, cache-semantics, and rate-limit-from-tracker suites stay green unchanged.

## Scenario 3 — long-lived MCP server: expiry, eviction, fail-closed (US3, FR-009, SC-001)

```text
settings { mcp: { planReferenceTtlSeconds: 60, planReferenceMaxEntries: 3 } }
plan ×2 → apply(known ref)                     → engine sees ONE verbatim GateRequest (as 012)
advance fixedClock +61s → apply(same ref)      → isError PLAN_REFERENCE_UNKNOWN, message
                                                 unchanged; ZERO engine/port/state touch (spy)
plan ×4 (capacity 3)                           → oldest recorded ref evicted; store size ≤ 3
record("nothex")                               → refused pre-insert (PLAN_ID_PATTERN intact)
```

**Expected**: expired ≡ evicted ≡ unknown at the API — one vocabulary, ladder step 3, zero
side effects (fake-port call log empty at refusal; state-dir tree hash unchanged).
`mcp-hygiene` still proves zero `node:fs` and the import allowlist.

## Scenario 4 — bearer parity across the two real servers (US3, FR-008, SC-004)

```js
// integration: bearer-semantics-parity — real history handler + real MCP listenHttp()
for (const h of ["Bearer T","bearer T","BEARER T","BeArEr T","Bearer  T","\tbearer T",
                 "  bearer T","Bearer","Bearer ","Basic T","<absent>"])   // matrix rows
  → verdicts EQUAL on both surfaces; scheme-absent refusals carry www-authenticate: Bearer;
    zero-dispatch call logs EMPTY on both; sentinel sweep finds 0 credential bytes in all output
```

**Expected**: 11 rows × 2 surfaces, verdict-equal, leak-free (SC-004). History's old
case-sensitive refusal of `bearer <t>` is now ACCEPT — the intended behavior change.

## Scenario 5 — MCP protocol negotiation (US4, FR-010)

```text
initialize protocolVersion "2025-06-18"  → echoed "2025-06-18"
initialize "2025-03-26" / "2024-11-05"   → echoed (existing set intact)
initialize "2099-01-01"                  → result carries newest supported ("2025-06-18")
initialize protocolVersion 42            → {"code":-32602}
```

**Expected**: set = `{2024-11-05, 2025-03-26, 2025-06-18}` exactly; the set is in the MCP
snapshot — editing `SUPPORTED_PROTOCOL_VERSIONS` without an amendment entry breaks Scenario 1.
No SDK, no new surface: `tools/list` still returns exactly the three default tools.

## Scenario 6 — docs & traceability audit (US1, FR-003/004/011, SC-005/006)

| Check | How | Expected |
|---|---|---|
| No preview labels | contract doc grep (`stability-declaration.md` §3) | 0 hits in README/usage docs post-promotion |
| Status symmetry | same test | README rows, both docs, both spec `Status:` lines agree |
| As-built traceability | doc grep | 0 `Next.js`/`React`/`HTTP/SSE transport` in `specs/requirements.md`; README script list ⊆ `package.json` scripts |
| Deferral register | slug presence test | every non-goal slug + non-empty revisit trigger in the two Stability sections (SC-006) |
| Amendment integrity | freeze test | every 014 amendment landed: 002 configuration.md keys; 012 protocol set; 011 bearer/Secure/429 doc lines |
| Posture unchanged | `npm test` | 1520+ baseline green; `tracker-dependency-budget` still `SPENT 0`; no new exports entry |

## FR / SC → test traceability

| Requirement | Verifying checks |
|---|---|
| FR-001 (stability declaration) | Scenario 6; `contracts/stability-declaration.md` §1/§3 checks |
| FR-002 (amendment freeze) | Scenario 1; `tests/contract/surface-freeze-{history,mcp}.test.ts` (SC-001) |
| FR-003 (consistent status labels) | Scenario 6 symmetry grep; freeze doc checks |
| FR-004 (as-built traceability) | Scenario 6 greps; `specs/requirements.md` diff cites 011 R1 / 012 R1–R2 |
| FR-005 (cache bound) | Scenario 2 rows 1; `tests/unit/history-cache.test.ts`; SC-002 |
| FR-006 (walk/stream bounds) | Scenario 2 rows 2–3; `tests/integration/history-bounds.test.ts`; `tests/unit/history-options.test.ts`; SC-003 |
| FR-007 (Secure cookies) | Scenario 2 row 5; `tests/integration/history-auth.test.ts` extension |
| FR-008 (bearer parity) | Scenario 4; `tests/integration/bearer-semantics-parity.test.ts`; SC-004 |
| FR-009 (bounded store, fail-closed) | Scenario 3; `tests/unit/mcp-plan-store.test.ts`, `tests/integration/mcp-http.test.ts` |
| FR-010 (protocol set) | Scenario 5; `tests/unit/mcp-jsonrpc.test.ts`, `tests/integration/mcp-stdio.test.ts` |
| FR-011 (recorded decisions) | Scenario 6 register row; SC-006 |
| FR-012 (posture preserved) | Scenario 6 last row; existing hygiene/defaults/sentinel/packaging suites unchanged |
| SC-001 | Scenario 1 mutation checks + Scenario 3 zero-touch spies |
| SC-002 | Scenario 2 byte-equality control run |
| SC-003 | Scenario 2 envelope audit (zero history bytes) |
| SC-004 | Scenario 4 verdict-equality + sentinel sweep |
| SC-005 / SC-006 | Scenario 6 greps + register test |

## Cleanup

```bash
rm -rf /tmp/opencode/tls-*   # temp worlds; tokens env-only; stores in-memory; snapshots checked in
```

## Verification note

Running these scenarios is the promotion review: if Scenario 1 passes with a drifted snapshot,
if Scenario 2 serves history bytes in a 429, if Scenario 3 lets an expired reference reach the
engine, or if Scenario 4's verdicts differ across surfaces, the design has drifted from the
spec — fix the artifacts first, then the code. Only when Scenarios 1–6 are green does the
preview label come off (contracts/stability-declaration.md §2 checklist).
