# Implementation Plan: Preview-to-Stable Hardening (011 & 012 Surfaces)

**Branch**: `014-preview-to-stable-hardening` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-preview-to-stable-hardening/spec.md`

## Summary

This feature converts the documentation-only "preview" label on the history server (011) and
the MCP server (012) into a mechanical guarantee, and closes the deferred engineering items the
stability promise exposes. Headline decisions (research R1–R10): **one coordinated amendment to
the frozen 002 config surface** adds every new resource bound as `web.*` / `mcp.*` keys with
defaults that preserve current behavior exactly, following the documented amendment rule (R1);
a **per-surface contract freeze** mirrors the 002 regime — checked-in snapshots
(`tests/contract/snapshots/history-surface.json`, `mcp-surface.json`) built from the runtime
registries, failing CI on unamended drift, with `docs/contract-amendments.md` extended to govern
the 011/012 contract docs (R8). Hardening itself is local to the two module groups: LRU-bounded
history cache, in-process walk/stream concurrency bounds answering excess with the existing
429 envelope, `secureCookies` cookie attribute, RFC-7235 bearer semantics unified on the MCP
server's existing tolerant parser (pinned by a black-box cross-surface parity test, no shared
module — hygiene rules forbid cross-reach, R5), TTL + capacity eviction of MCP plan references
through the existing `PLAN_REFERENCE_UNKNOWN` fail-closed vocabulary (R6), and
`2025-06-18` added to the MCP protocol negotiation set — still hand-rolled, the one-dependency
allowance stays unspent (R7). `Last-Event-ID` resume, SDK-only protocol surface, and TLS/remote
exposure are re-deferred as **named non-goals with revisit triggers** inside a new "Stability"
doc section on both surfaces (R9/R1). No frozen gate vocabulary, engine path, or report schema
changes; no new dependency; no new export subpath.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`;
Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution "Technology stack"). No
toolchain changes. Node 20 APIs only — `node:crypto` `timingSafeEqual`, `node:http`, injected
`Clock`; no timers, no `--experimental` flags (determinism + 012 R11 posture).

**Primary Dependencies**: **None added at runtime** (spec FR-012; `tracker-dependency-budget`
stays `SPENT 0`). Edits touch: `src/config/{schema,defaults}.ts` (one formal 002 amendment, R1),
`src/history-server/{cache,create,auth,options,errors,sse}.ts`, `src/mcp/{jsonrpc,plan-store,
config,create}.ts` (history's bearer parser is the only auth edit; MCP auth already conforms),
the two features' contract docs, `docs/{agent-tools,history-server,contract-amendments}.md`,
`README.md`, and `specs/requirements.md` (as-built wording, R10).

**Storage**: **None.** The plan-reference store stays an in-memory Map — now bounded by TTL +
capacity with lazy expiry on touch (no timers), zero `node:fs` preserved (`mcp-hygiene`
unchanged). The history cache stays in-process. All state access unchanged (history: zero
`../state/` imports; MCP: injected `StateStore` only).

**Testing**: `node:test` + `node:assert/strict`, existing four tiers via `scripts/run-tests.mjs`;
tests-first per constitution VI. New: contract surface-freeze suites (mutation checks for
SC-001), integration history-bounds (fan-out + over-limit load), integration bearer-parity
(both real servers, casing matrix), unit extensions (cache LRU, options guards, plan-store TTL,
jsonrpc negotiation). Existing MCP/history suites stay green; defaults-scan, credential-sentinel,
hygiene, and packaging contracts run the changed files unchanged.

**Target Platform**: unchanged — Node ≥ 20 consumers of `task-linear-sync/history-server` and
`task-linear-sync/mcp`; stdio default and loopback HTTP transports keep their exact defaults
(spec FR-007: defaults byte-for-byte as merged).

**Project Type**: Single npm package (existing). 014 is a hardening feature: it edits the two
Wave-4 module groups in place (unlike 012, which added a disjoint group), plus a formal
amendment inside the frozen `src/config` surface — the ONLY frozen-module edit, gated by the
amendment rule (ROADMAP rule 2).

**Performance Goals**: hardening is additive to the request path: one Map touch for LRU recency,
two integer counters per request, one timestamp compare per store access. Rejected-load responses
are constant-size envelopes. The 1 MiB / 1000-page existing bounds are untouched.

**Constraints**: Zero new runtime dependencies; zero new export subpaths; frozen 002 surface
changes ONLY via the three-artifact amendment in one dedicated commit (nothing rides along — the
amendment rule); apply stays disabled by default and refused before engine/port code;
`node:fs`-free `src/mcp`; leak-free envelopes (zero history bytes, zero credentials) on every
new refusal path; deterministic eviction (insertion-order LRU under injected `Clock`).

**Scale/Scope**: 12 FRs, 6 SCs, 4 user stories; ~10 source files edited + 1 amendment commit;
~5 new test files + ~8 extended; 2 doc "Stability" sections; 1 contract-amendments extension;
~35 tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | No new mutating surface anywhere: history stays read-only (bounds only shed load); MCP apply path untouched — expired/evicted plan references refuse with `PLAN_REFERENCE_UNKNOWN` BEFORE any engine/port/state code (SC checks assert zero-touch logs). New 429/401 paths emit constant envelopes: zero history bytes, zero credentials (sentinel sweeps extended to the new paths). Read-only lanes unchanged. | PASS |
| II. Durable Identity | No identity logic touched: `planId` shape, `PLAN_ID_PATTERN`, and engine plan/report artifacts consumed verbatim; eviction keys on the same `planId`, derives nothing. | PASS |
| III. Intelligent Defaults, Overridable Configuration | All six new bounds ship as `web.*`/`mcp.*` config keys (R1) with deep-merged defaults whose defaults reproduce today's observable behavior (generous caps; `secureCookies: false`); range guards list every problem, one dotted-key line each (existing posture). No new env-var names; no org identifiers (defaults-scan extended to the new keys). | PASS |
| IV. Determinism and Idempotency | LRU order = insertion/recency order (no hashes of content, no wall-clock: injected `Clock`); TTL expiry is a pure function of (recordedAt, clock); over-limit decisions are deterministic counters, not probabilistic; admitted-request responses byte-identical to pre-014 (cache-eviction-correctness test, SC-002). | PASS |
| V. One Engine, Additive Surfaces | Zero engine/gate/lock/journal changes: refusals reuse existing vocabularies (`RATE_LIMITED` envelope, gate-failure codes); the freeze regime adds enforcement docs/tests, not code paths; both surfaces keep routing everything through the frozen engine/port; no surface removes capability. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR/SC maps to ≥1 test (quickstart traceability table). New contract freeze suites are the enforcement evidence for FR-002/SC-001 (mutation checks); integration tiers drive REAL servers for bounds and bearer parity; e2e unchanged suites guard regressions. Story-phase tests red-first. | PASS |
| Additional constraints | *Port/adapter*: untouched. *Credential handling*: bearer parse unification keeps `timingSafeEqual` + env-name-only reads; matrix test asserts 0 leaks on both surfaces. *Resilience*: port retry posture untouched. *Technology stack*: zero deps, same `exports` map; the frozen-surface edit is the sanctioned amendment (configuration.md + schema/defaults + snapshot check together, noted against 001) — NOT a silent deviation. *No org-specific literals*: new defaults are numeric booleans; fixtures synthetic. | PASS |
| Development workflow / quality gates | Pipeline unchanged (existing tiers run the edits). Hermetic: no new secrets. Documentation duty satisfied in-feature: both usage docs' Stability sections, README label/status lines, `requirements.md` as-built wording, and the contract-amendments extension land in the same change set as the code they document. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.** (The 002 amendment is the governance mechanism working as designed,
not a principle violation — it is the rule ROADMAP 2 + `docs/contract-amendments.md` provide for
exactly this need.)

## Project Structure

### Documentation (this feature)

```text
specs/014-preview-to-stable-hardening/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 014-local interfaces only
│   ├── stability-declaration.md  # required "Stability" doc sections, promotion checklist
│   ├── surface-freeze.md         # frozen-element inventories, snapshot format, amendment-entry format
│   ├── resource-bounds.md        # new web.*/mcp.* keys, defaults, guards, backpressure envelopes
│   └── bearer-parity.md          # cross-surface bearer matrix and leak rules
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                        # UNCHANGED (no new exports entry, no new deps)

specs/002-core-domain-contracts/
└── contracts/configuration.md      # AMENDMENT: web.*/mcp.* bound keys (R1; dedicated commit)

src/
├── domain/ state/ urls/ gates/ ports/          # FROZEN — untouched
├── config/                          # FROZEN — amended ONLY, per the amendment rule:
│   ├── schema.ts                    #   + web.{maxCacheEntries,maxConcurrentWalks,
│   ├── defaults.ts                  #     maxConcurrentSseStreams,secureCookies},
│   └── ...                          #   + mcp.{planReferenceTtlSeconds,planReferenceMaxEntries}
├── history-server/                  # 011 hardening (in place)
│   ├── cache.ts                     #   LRU bound + touch-on-hit (FR-005)
│   ├── create.ts                    #   in-flight walk + SSE stream counters (FR-006)
│   ├── errors.ts                    #   RATE_LIMITED envelope gains Retry-After (FR-006)
│   ├── auth.ts                      #   RFC-7235 bearer parser + Secure attribute (FR-007/008)
│   └── options.ts                   #   range guards for the new web.* keys (FR-005/006/007)
└── mcp/                             # 012 hardening (in place)
    ├── jsonrpc.ts                   #   protocol set += "2025-06-18"; newest-supported fallback (FR-010)
    ├── plan-store.ts                #   TTL + capacity eviction, fail-closed (FR-009)
    ├── config.ts                    #   range guards for the new mcp.* keys
    └── create.ts                    #   store constructed with bounds from settings

tests/
├── unit/           # history-cache (LRU), history-options (guards), mcp-plan-store (TTL/evict),
│                   #   mcp-config (guards), mcp-jsonrpc (negotiation set)
├── contract/       # surface-freeze/history, surface-freeze/mcp (snapshots + mutation checks),
│                   #   bearer-semantics-parity (matrix helper + both-surface verdicts),
│                   #   defaults-scan / credential-sentinel / hygiene / packaging UNCHANGED but
│                   #   now also sweeping the new envelopes and defaults
├── integration/    # history-bounds (fan-out ≤ cap; over-limit 429 zero-bytes; secureCookies;
│                   #   Last-Event-ID ignored), history-auth (casing extensions), mcp-http
│                   #   (store eviction under long-lived server), mcp-stdio (negotiation)
├── helpers/surface-freeze.ts        # snapshot comparator + drift-list + mutation-check harness
└── fixtures/mcp|history/            # bound-override world variants (synthetic ids only)
```

**Structure Decision**: Single npm package, hardening in place — 014 owns `src/history-server/**`
and `src/mcp/**` edits (the first feature allowed to edit both Wave-4 module groups, as the
promotion owner), the formal `src/config` amendment in its own commit, `tests/**` additions
named `*-surface-freeze` / `bearer-semantics-parity` / `history-bounds`, and the doc surface:
both usage docs, `docs/contract-amendments.md`, `README.md`, `specs/requirements.md`, and the
011/012 spec + contract docs (status flips + amendment entries). Import direction unchanged:
nothing new imports across module groups — the bearer parity lives in tests, not in a shared
runtime module (R5); hygiene tests keep `src/mcp` and `src/history-server` mutually unreachable.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) a shared `src/lib/bearer.ts` runtime module — rejected (R5): adds a frozen-surface
neighbor and cross-module dependency for a 3-line parser; black-box parity test pins the behavior
instead; (2) forwarded-proto auto-detection for `Secure` cookies — rejected (R4): trusting
`X-Forwarded-Proto` without a trusted-proxy model is a spoofing footgun; an explicit boolean is
honest and keeps loopback defaults byte-identical; (3) adopting the MCP SDK to gain protocol
revisions "for free" — rejected (R7): breaks the zero-dep budget contract and needs a
constitution-level amendment while the needed delta is one string in a closed negotiation set;
(4) persistent plan-reference store in the state dir — rejected again (R6): the session-scoped
guarantee is the spec's own promise; bounding it with TTL/capacity is enough.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design's only frozen-surface change is the R1 amendment,
specified in `contracts/resource-bounds.md` and sequenced as a standalone commit per the
amendment rule; the freeze regime (R8) ADDS snapshots and tests without touching runtime
behavior; every new refusal answer is drawn from existing closed vocabularies (no new error
codes), keeping the envelope-freeze honest; no runtime dependency, subpath export, or engine
call-path was introduced. No Complexity Tracking entries were created by the design.
