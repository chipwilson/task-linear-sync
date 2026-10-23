# Quickstart: Validating Path Routing and Title Derivation

Validation guide for `specs/005-routing-title-derivation` — proves the feature works
independently against the frozen `002` contracts, without implementing anything ahead of
`tasks.md`. Model details: [data-model.md](./data-model.md); contract details:
[contracts/](./contracts/README.md); decisions: [research.md](./research.md).

005 is a **pure, dependency-free slice**: no tracker, no filesystem, no network. Tasks are
hand-constructed fixtures (005 does not depend on 004 at test time) and routing/title fixtures
use placeholder identities (`acme-team`, `proj-alpha`, `user-authentication`, `<areaPrefixA>`, …)
— zero real organization identifiers.

## Prerequisites

- Node.js ≥ 20.0.0; `npm ci` against the committed `package-lock.json`.
- Wave-1 `002` frozen modules compiled and importable (this feature imports `src/domain/routing.js`,
  `src/domain/task.js`, `src/config/schema.js` — read-only).
- No Linear credentials, no network, no real organization identifiers anywhere in fixtures
  (Constitution VI / hermetic pipelines).

## Setup

```bash
npm ci
npm run build          # tsc: ESM + .d.ts per exported module (incl. src/routing, src/titles)
npm run typecheck      # tsc --noEmit over tests too (tests import compiled modules by relative path under build/)
```

## Test tiers (005 files)

```bash
npm run test:unit        # routing-resolve, titles-rules/template/decorate-strip/derive
npm run test:contract    # routing-resolution-shape + defaults-scan-005 (zero org literals)
npm run test:integration # routing-corpus (SC-001) + titles-roundtrip (SC-002)
npm run test:e2e         # routing-titles-user-stories walkthrough
npm test                 # all tiers + coverage threshold gate
```

> Export note (research R3): 005 does **not** edit `package.json`/`src/index.ts` in Wave 2; its
> tests import the compiled `build/src/routing/*` and `build/src/titles/*` by relative path.
> Public subpath exports are wired in Wave-3 integration.

## Validation scenarios

### US1 — Deterministic destination routing (P1) 🎯 MVP

Run: `npm run test:unit -- --test-name-pattern "routing"` +
`npm run test:integration -- --test-name-pattern "routing corpus"`

Fixtures under `tests/fixtures/routing-titles/`: nested-prefix maps, equal-length-tie maps, empty
maps, missing-default maps, and a path corpus.

| # | Scenario (spec AC / FR) | Test | Expected |
|---|---|---|---|
| 1 | Longest prefix selects team **and** project (AC1, FR-001) | `routing nested prefixes` | deepest matching `prefix` wins; `teamKey`+`project` from that entry; `matchedPrefix` set; `defaulted:false` |
| 2 | Equal-length tie broken by map order (AC2, FR-001) | `routing tie` | first-by-`projectByPath`-index entry selected; `tieBreak: "first-by-map-order"` recorded; re-run identical |
| 3 | Default fallback; empty map ⇒ default for all (AC3, FR-002) | `routing defaults` | unmatched path → `defaulted:true` with default team/project; **empty** `projectByPath` applies default to every task |
| 4 | Unassigned, processing continues (AC4, FR-002) | `routing unassigned` | no match + no defaults → `{ teamKey:"", project:"", defaulted:false, unassigned:true }`; remaining tasks all still resolve (no abort) |
| 5 | SC-001 determinism | `routing corpus` | routing over the corpus is 100% as designed and **byte-identical on every re-run** |

### US2 — Idempotent title derivation (P2)

Run: `npm run test:unit -- --test-name-pattern "title"` +
`npm run test:integration -- --test-name-pattern "roundtrip"`

Fixtures: ordered rule presets (including the 001 R6 informative-note shape with `<areaPrefix*>`
placeholders), tasks with/without `Feature_Name`, preset titles already carrying prefixes,
templates with absent-attribute placeholders.

| # | Scenario (spec AC / FR) | Test | Expected |
|---|---|---|---|
| 1 | First match wins + substitution + unresolved→""+indicator (AC1, FR-003) | `titles derive` / `titles template` | first matching rule's template applied; present attrs substituted; absent attr → `""` and name in `unresolvedPlaceholders` (never literal) |
| 2 | No rule / none configured → pass-through (AC2, FR-003) | `titles pass-through` | empty `titleRules` or no match → `baseTitle = task.title`, `matchedRuleIndex:-1`, `defaulted:true` |
| 3 | `Feature_Name` prefixed **exactly once** on every path, stable on re-derive (AC3, FR-004) | `titles decorate` / `titles derive idempotent` | consumer-rule, no-match, and pass-through outputs all begin with `<featureName>: ` once; re-derivation is a byte-identical no-op; a title already carrying the prefix is unchanged |
| 4 | Render-back strip removes the decorated set (AC4, FR-004) | `titles strip` | feature prefix + configured strip prefixes + redundant `[KEY-N]` issue prefix + duplicate leading `<localId>: ` removed; all other chars preserved |
| 5 | No `Feature_Name` ⇒ unprefixed (AC5, FR-005) | `titles no-feature` | final title equals the derived base title, no prefix added |
| 6 | SC-002 idempotent round trip | `titles roundtrip` (property-based, 10 cycles) | derive→mirror→render-back→re-derive is **byte-stable from cycle 1**; **0** titles gain a duplicated/compounding prefix |

### Contract + safety validation

Run: `npm run test:contract`

1. **Routing frozen-shape** (`routing-resolution-shape`): `resolveRouting` returns **exactly** the
   frozen `RoutingResolution` key set — no added field, no widened optionality
   ([contracts/routing-resolution.md](./contracts/routing-resolution.md)). Confirms 005 imports
   002 types rather than redefining them (ROADMAP rule 2).
2. **Zero-literal scan** (`defaults scan 005`): the built-in pass-through and default-strip
   behaviors and all fixtures contain no organization/product literal prefix — only benign
   placeholders (`acme-*`, `proj-*`, `<areaPrefix*>`) (constitution III, release gate).

## Success-criteria traceability

| Spec SC / FR | Proven by |
|---|---|
| FR-001 longest-prefix + tie-break | US1.1 + US1.2 |
| FR-002 defaults / unassigned / empty-map | US1.3 + US1.4 |
| FR-003 ordered rules / substitution / pass-through | US2.1 + US2.2 |
| FR-004 exactly-once decoration + render-back strip | US2.3 + US2.4 + US2.6 |
| FR-005 no feature ⇒ unprefixed | US2.5 |
| SC-001 routing determinism | US1.5 |
| SC-002 10-cycle idempotency (0 compounded prefixes) | US2.6 (property-based) |

## Exit criteria for this feature

`npm test` green including the coverage threshold and both 005 contract tests; `npm run build`
emits ESM + per-module declarations for `src/routing` and `src/titles`; every quickstart scenario
above observed. 006 can then consume `RoutingResolution`, and 008/004/009 can consume
`TitleDerivation` / `stripTitleForRender`, wired in Wave-3 integration — none importing 005
internals.
