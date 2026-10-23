# Implementation Plan: Path Routing and Title Derivation

**Branch**: `005-routing-title-derivation` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-routing-title-derivation/spec.md`

## Summary

Wave-2 pure slice that owns two deterministic, rule-driven decisions over task attributes:
(a) **which team and project** each task's file path routes to — longest-prefix match over the
consumer-supplied `ProjectByPath` map, equal-length ties broken deterministically by map order,
falling back to configured defaults, and leaving a task visibly **unassigned** when neither a
prefix nor a default exists; and (b) **what a task's issue title is** — ordered first-match-wins
title rules with template placeholders substituted from task attributes, the built-in
pass-through default, and the idempotent `<Feature_Name>: ` decoration that is prepended exactly
once on derivation and stripped (with configured strip prefixes, redundant issue prefixes, and
duplicate local-ID prefixes) when the title is rendered back into Markdown, so titles never
progressively prefix across runs.

Implemented as two pure, dependency-free modules — `src/routing/` and `src/titles/` — that
consume only the frozen `002` shapes (`Task`, `ProjectByPathEntry`, `RoutingResolution`,
`ResolvedConfig.titleRules` / `titleStripPrefixes` / `defaultTeamKey` / `defaultProject`) and
never touch the tracker, the filesystem, or the network. `resolveRouting` returns the frozen
`RoutingResolution` type verbatim so `006` can consume container-gating results **without
importing 005 internals**; `deriveTitle` / `stripTitleForRender` return 005-local,
frozen-compatible outputs for `008` (apply), `004` (render-back strip), and `009` (reports).
Delivered as TypeScript/ESM (`Node ≥ 20`), zero runtime dependencies, with a hermetic
`node:test` suite whose centerpiece is a property-based 10-cycle
derive→mirror→render-back→re-derive round-trip proving idempotent decoration/strip (SC-002).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per
exported module; Node.js ≥ 20.0.0 engine constraint (inherited from constitution "Technology
stack"; identical to 002 — no new toolchain).

**Primary Dependencies**: **None at runtime** — pure functions over `Task` + `ResolvedConfig`
slices. Node built-ins only where needed (a `node:test`/`node:assert/strict` suite; no
`node:crypto` requirement for this feature). Imports the frozen `002` modules only
(`../domain/routing.js`, `../domain/task.js`, `../config/schema.js`).

**Storage**: **N/A** — this feature performs zero reads/writes; routing consumes
`task.filePath` (a string) and the in-memory config; title derivation is pure over task
attributes. (Assumption: "Routing consumes only the path and configured map; it never consults
the tracker.")

**Testing**: `node:test` + `node:assert/strict` against compiled output (002 precedent,
research R2); tiers `unit`, `contract`, `integration`. Zero network, zero wall-clock
nondeterminism, zero real organization identifiers — fixtures hand-construct `Task` objects
(005 does not depend on 004 at test time) and use placeholder routing identities
(`acme-team`, `proj-alpha`, …). Property-based tests required by constitution VI for the
round-trip idempotency property.

**Target Platform**: Node.js ≥ 20 CLI/library host (Linux, macOS, Windows); consumed as an npm
package by 006 (container gating), 008 (title apply), 004 (render-back strip), 009 (routing
indications in reports) — all wired in Wave 3 against the frozen engine/report contracts.

**Project Type**: Single npm package (library + shared core); this feature adds the sibling
`src/routing` and `src/titles` modules described in 002's plan.md § "Structure Decision"
("Wave-2+ features add sibling modules (`src/discovery`, `src/parsing`, `src/routing`,
`src/matching`, `src/tracker`, …)").

**Performance Goals**: Routing is `O(P)` per task (`P` = number of `ProjectByPath` entries) — a
single `startsWith` scan; title derivation is `O(R + L)` per task (`R` = rules, `L` = template
length). Both pure and local; realistic corpora (thousands of tasks, tens of prefixes/rules)
resolve well under 1 ms each — no measurable budget needed (no I/O, no network).

**Constraints**: Zero runtime dependencies; **frozen contracts are referenced, never redefined or
edited** (ROADMAP rule 2 / 002 FR-008 — `RoutingResolution`, `ProjectByPathEntry`,
`ResolvedConfig.titleRules`/`titleStripPrefixes` all imported from `002`); no built-in default
routing values (constitution III — routing is consumer-required; 005 invents none and produces
an unassigned result instead); shipped default title behavior (pass-through + default strip)
contains **zero organization-specific or product-specific literal prefixes** (release-gate scan);
module set disjoint from 003/004/006/007; deterministic and idempotent per constitution IV.

**Scale/Scope**: 2 user stories (P1 routing, P2 titles); 5 FRs (005 FR-001…FR-005 mapping 001
FR-020, FR-021, FR-033, FR-034, FR-035); 2 SCs (SC-001 routing determinism, SC-002 title idempotency
over 10 cycles); 2 005-local contracts (`routing-resolution`, `title-derivation`); 0 edits to
frozen 002 files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | 005 performs **zero** tracker mutations, **zero** repository/state writes, and **zero** network calls — it is a pure function set over an in-memory `Task` + config slice. No gate, lock, or credential path is reached. The final `Feature_Name`-prefixed title is screened **downstream** by the propagation owner (008/009 per 001 R6.13); 005 never bypasses the `SecurityScreener` because it propagates nothing itself. | PASS |
| II. Durable Identity | 005 neither derives nor mutates `Stable_UUID` and never feeds title text into identity: routing reads `task.filePath` only; title derivation reads display attributes only. It reinforces Principle II by never writing an in-file marker and by making title round-trips stable so renames/moves do not orphan issues. | PASS |
| III. Intelligent Defaults, Overridable Configuration | Built-in defaults exist **only** for the two generic behaviors the spec names: pass-through title derivation when `titleRules` is empty/absent, and the default strip-prefix behavior when `titleStripPrefixes` is empty ("removes only the leading local-task-identifier prefix … and any redundant leading issue prefix, and removes no other prefix"). Neither contains an org/product literal. Routing has **no** built-in default: absent/unmatched with no configured `defaultTeamKey`/`defaultProject` ⇒ task left unassigned (never a 005-invented team). The `: ` decoration separator is generic punctuation, not a literal prefix. | PASS |
| IV. Determinism and Idempotency (headline) | Longest-prefix wins; "IF two or more configured path prefixes match the task's file path with an identical character length, THEN THE System SHALL select the first such entry by the map's defined ordering and record a deterministic tie-break indication" (001 R4.2). Titles: ordered first-match-wins is deterministic; `<Feature_Name>: ` is "prepend[ed] … exactly once … so that repeated derivations over unchanged inputs produce a byte-for-byte identical final title" (001 R6.10) and stripped on render-back "such that titles are not progressively prefixed across runs" (001 R6.12). SC-001/SC-002 encode both. | PASS |
| V. One Engine, Additive Surfaces | 005 exposes pure functions consumed by the single engine (008); it introduces **no** divergent gating/locking/screening path and no second engine. Its outputs are either the frozen `RoutingResolution` (002) or 005-local value objects; consumers import frozen types, not 005 internals. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR (001–005) and SC (001–002) maps to ≥1 automated test (quickstart traceability). Property-based tests cover the constitution-required "rendering round-trip stability where parse then derive then render then parse reproduces the same final titles with no progressive `Feature_Name` prefixing". Contract tests assert `resolveRouting` yields exactly the frozen `RoutingResolution` shape (no drift/redefinition). Hermetic: pure core, no transport. | PASS |
| Additional constraints | No org-specific literals (release-scan target: defaults + fixtures); ESM + per-module declarations; module set (`src/routing`, `src/titles`) disjoint from other Wave-2 features; no dependency added. | PASS |
| Development workflow / quality gates | Reuses the package's existing `build`/`typecheck`/`lint`/`test` scripts (no pipeline/secret changes; no network). CI stays hermetic (no Linear credentials, no org identifiers). | PASS |

**Pre-research gate result: PASS — no violations; Complexity Tracking unused.**

## Project Structure

### Documentation (this feature)

```text
specs/005-routing-title-derivation/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output — 005-LOCAL entities only (extends, never redefines, 002)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output — 005-LOCAL interfaces (routing resolution, title derivation)
│   ├── README.md
│   ├── routing-resolution.md
│   └── title-derivation.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── routing/                     # 005-owned — disjoint from 003/004/006/007
│   ├── resolve.ts               # resolveRouting(filePath, routingConfig): RoutingResolution (frozen type)
│   │                            #   longest-prefix match; equal-length tie → first-by-map-order + indication;
│   │                            #   default fallback; unassigned (empty strings + unassigned:true) when neither
│   ├── types.ts                 # RoutingConfigSlice (the {projectByPath, defaultTeamKey, defaultProject} view)
│   └── index.ts                 # module barrel (005-owned; public subpath re-export is a Wave-3 integration note)
├── titles/                      # 005-owned — disjoint
│   ├── rules.ts                 # parseTitleRules(raw: readonly string[]): TitleRule[]  — deterministic parse of
│   │                            #   ResolvedConfig.titleRules strings (guard " => " template grammar; research R2)
│   ├── match.ts                 # evaluateGuard(predicate, task): boolean — attribute-presence / !absence /
│   │                            #   framework= / kind= / path~ / child predicates (research R2)
│   ├── template.ts              # renderTemplate(template, task): { text, unresolved: string[] } — {placeholder}
│   │                            #   substitution from task attributes; unresolved → "" + indicator (research R5)
│   ├── decorate.ts              # decorateFeaturePrefix(base, featureName): string  — prepend `<fn>: ` exactly
│   │                            #   once (idempotent); no-op when featureName absent (FR-004/FR-005)
│   ├── strip.ts                 # stripTitleForRender(finalTitle, task, opts): string — remove feature prefix +
│   │                            #   configured strip prefixes + redundant issue prefix + duplicate leading local-ID
│   │                            #   prefix, preserving all other chars (FR-004 render-back; provided to 004)
│   ├── derive.ts                # deriveTitle(task, titleConfig): TitleDerivation — first-match-wins → pass-through
│   │                            #   default → feature decoration; the primary US2 entry point
│   ├── types.ts                 # TitleRule, TitlePredicate, TitleDerivation, TitleConfigSlice (005-local; research R2)
│   └── index.ts                 # module barrel (005-owned)
└── (domain/, config/, state/, urls/, gates/, ports/ are FROZEN 002 — imported only, never edited)

tests/
├── unit/
│   ├── routing-resolve.test.ts        # US1: nested prefixes, equal-length ties, empty map, no-default unassigned
│   ├── titles-rules.test.ts           # US2: rule-string parse, malformed-rule error, guard evaluation
│   ├── titles-template.test.ts        # US2: placeholder substitution + unresolved→""+indicator, pass-through default
│   ├── titles-decorate-strip.test.ts  # US2: decorate exactly-once, no-feature no-op, strip set removal
│   └── titles-derive.test.ts          # US2: first-match-wins, defaults, decoration on every path, idempotent output
├── contract/
│   ├── routing-resolution-shape.test.ts  # resolveRouting yields EXACTLY the frozen RoutingResolution (no drift)
│   └── defaults-scan-005.test.ts         # pass-through/default-strip behaviors contain zero org/product literals
├── integration/
│   ├── routing-corpus.test.ts            # US1/SC-001: fixture path corpus, deterministic across repeat runs
│   └── titles-roundtrip.test.ts          # US2/SC-002: 10-cycle derive→mirror→render-back→re-derive stability
├── e2e/
│   └── routing-titles-user-stories.test.ts  # scripted walkthrough of both stories over a fixture task set
└── fixtures/
    └── routing-titles/                   # placeholder routing maps, task factories, path corpus, title-rule presets
```

**Structure Decision**: Single npm package (constitution "Technology stack"). 005 owns exactly two
disjoint source directories — `src/routing/` and `src/titles/` — and their `tests/` counterparts,
matching the sibling-module plan in 002's plan.md. It **imports** the frozen `002` contract modules
and **never** edits files under `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`,
or `src/ports` (ROADMAP rule 2 / 002 FR-008: amendments only, out of scope here).

**Export/disjointness note (research R3)**: to keep the five Wave-2 features fully parallel with
**no shared files**, 005 does **not** edit `package.json` (a shared file) or `src/index.ts` (a 002
file) in this wave. It ships `src/routing/index.ts` and `src/titles/index.ts` barrels, and its
tests import the compiled output by relative path under `build/` (002's `tsconfig.test.json`
emits there). Registering the public subpath exports (`./routing`, `./titles`) and the top-level
re-export is a **Wave-3 integration** concern (done once, conflict-free, when 008 composes
003–007); 005's independent testability does not depend on it. Consumers (006/008/004/009) obtain
results through the composed engine/report using only frozen `002` types plus 005-local value
objects — never by importing 005 module internals.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. (Two pure, dependency-free
modules; no I/O, no new toolchain, no gate/lock/screening surface introduced.)

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**: All
gates above still PASS. The design adds no dependencies, no mutation/write/network paths, no
built-in routing values, and no organization-specific literals in shipped defaults; it references
the frozen 002 contracts (`RoutingResolution`, `ProjectByPathEntry`, `Task`, `ResolvedConfig`
slices) without redefining them, and its module set stays disjoint from 003/004/006/007. The two
005-local contracts add interpretation/behavior only (the `titleRules` string grammar and the
routing resolution algorithm), never new frozen capability. Re-check result: **PASS**.
