# Implementation Plan: Per-Task Splitting of Kiro Implementation-Plan Task Files

**Branch**: `021-fix-kiro-task-splitting` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-fix-kiro-task-splitting/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

A Kiro "Implementation Plan" `tasks.md` (one `# Implementation Plan` title heading + thirteen top-level checkbox tasks, no other headings) syncs as ONE giant Linear issue because: the catch-all heading grammar makes the title heading a task; the orphan rule adopts every top-level checkbox as that heading's child (depth 2); the shipped `maxTaskIssueDepth: 1` "flat board" default (A-020-1) folds all depth-2 tasks; and the surviving title task's `Task_Body` extent — computed over surviving tasks only — then spans the whole file, which the engine mirrors into the one issue's description.

The fix is made at the **shared built-in defaults/parsing layer** (not in the kiro row), because five of the seven built-in adapters (kiro, generic, spec-kit, bmad, open-spec) consume the identical default grammars — the same file shape breaks identically under all five — while spec-kitty and spec-superpower are structurally immune through their narrower grammar overrides and need regression pins only. Three requirements amendments (A-021-1/2/3 to `specs/requirements.md` Requirement 2 criteria 4, 9, 13 and the Requirement 15.4 default list) redefine: the *document-title heading* (exempt from orphan adoption), the *flat-document trigger* (title heading disregarded; dead `flatDocument` signal wired or removed), and the *local-id grammars* (word-form ids must contain a digit — kills the `Implementation`→id / `Plan`→title mangling — and dotted-numeric checklist ids like `4.1` are captured without a trailing separator). Per the user's directive, this plan includes the full adapter-by-adapter impact analysis and a requirements-misunderstanding analysis with an implementation-consequence trace (§Research R2, R3, R7).

## Technical Context

**Language/Version**: TypeScript (ECMAScript Module output, generated `.d.ts` per exported module), Node.js ≥ 20.0.0 — per constitution "Technology stack"

**Primary Dependencies**: Node built-ins plus exactly one platform transport dependency (MCP SDK scoped to `<pkg>/mcp`); this feature adds **zero** new runtime dependencies — the change is confined to parsing grammars/rules and their tests

**Storage**: N/A (no persistence changes; run state, audit manifest, and attachment metadata lanes are untouched)

**Testing**: `node:test` over compiled `build/tests/` via `scripts/run-tests.mjs` (`npm run test:unit|contract|integration|e2e`), merge-blocking CI pipeline; fake `Linear_Port` worlds under `tests/fixtures/engine/worlds/`

**Target Platform**: Publishable npm library + CLI (programmatic API, CLI, worker, history server, MCP, CI action — all route through the same engine, Principle V; this change is inside the shared parsing core, so every surface inherits it uniformly)

**Project Type**: Library/CLI

**Performance Goals**: Parsing stays single-pass over file lines; title-heading detection is O(lines) like today's `detectFlatDocument`; no measurable regression expected at corpus scale

**Constraints**: Determinism/idempotency (Principle IV) — the same file must parse identically on every run and under kiro vs generic classification (spec FR-008); zero org literals (Principle III); all existing corpus/world/golden pins stay byte-identical except where the amendments intentionally change the broken shape (Principles IV/VI, spec FR-009/SC-005)

**Scale/Scope**: 2 grammar constants (`src/config/defaults.ts`, `src/parsing/content.ts`), 1 extraction rule (`src/parsing/extract.ts` orphan rule + flat-document wiring), 0 changes to `depth.ts`/`extent.ts`/engine/titles (analyzed in R7); 1 requirements-file amendment; docs updates (README, `docs/framework-adapters.md`, `docs/configuration-reference.md`); new fixtures: parsing fixture + engine world + discovery placement; ~4–6 new test files, several pinned test files to re-verify unchanged

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Basis |
|-----------|---------|-------|
| I. Safety First (NON-NEGOTIABLE) | PASS | No new mutation surface. Read-only lanes (inventory/plan/check/MCP read) unchanged; screener still applied to all propagated text; the change only alters which tasks/regions the existing pipeline extracts. |
| II. Durable Identity | PASS | Tasks keep deterministic `Stable_UUID` seeds. A-021-2 *improves* seed quality: dotted ids (`4.1`) become `Local_Task_ID` inputs instead of ordinal fallbacks (seed change is the intended, documented outcome for the broken shape — see R7). The title-heading task keeps its existing seed. No in-file markers introduced. |
| III. Intelligent Defaults, Overridable Configuration | PASS | Amendments adjust built-in *generic* default grammars/rules only (no org literals); every value remains overridable through the frozen defaults→file→programmatic layering; adapter-level `headingGrammar`/`checklistIdPattern` overrides keep precedence (`adapter.x ?? config.x` unchanged). |
| IV. Determinism and Idempotency | PASS | Pure deterministic rule changes (no clock/random); kiro-vs-generic parity preserved because the fix sits in the shared defaults layer (spec FR-008); parse→derive→render round-trip re-verified by tests (render preserves now-parsed local ids per Requirement 3 criteria 1–2). |
| V. One Engine, Additive Surfaces | PASS | Single shared core change; no surface re-implements anything; plan/apply/CLI/MCP/CI inherit identically through `parseTaskFile`. |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | PASS (with duties) | Spec FR-010 mandates fixture + parser-level + fake-tracker sync-level tests; every acceptance scenario maps to ≥1 automated test (R8/R9). Existing corpus/world/golden suites act as the regression gate for FR-009/SC-005. Coverage threshold and CI gates unchanged. |
| Additional constraints (ports, credentials, resilience, locking, tech stack, no org literals) | PASS | None touched: no Linear access, no credentials, no network, no state, no new dependencies, grammar changes contain no org-specific literals. |
| Development Workflow / Documentation duty | PASS (with duty) | Docs MUST be updated in the same change: README Kiro section + depth-grammar notes, `docs/framework-adapters.md`, `docs/configuration-reference.md` (heading grammar, flat-checklist trigger, checklist-id span) — tracked in R7 consequences. |

**Gate result: PASS — no violations; Complexity Tracking not applicable.**

## Project Structure

### Documentation (this feature)

```text
specs/021-fix-kiro-task-splitting/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — root cause, adapter analysis, requirements-misunderstanding analysis, decisions R1–R9
├── data-model.md        # Phase 1 output — amended parsing concepts and validation rules
├── quickstart.md        # Phase 1 output — repro + validation guide
├── contracts/
│   └── kiro-plan-parsing.md        # Phase 1 output — behavioral contract C1–C9 for shared-default task extraction
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

Amended in place: `specs/requirements.md` (Requirement 2 criteria 2, 4, 9, 13; Requirement 15.4 default list — inline amendments A-021-1, A-021-2, A-021-3 following the existing A-017/A-018/A-020 convention).

### Source Code (repository root)

```text
src/
├── config/defaults.ts            # headingIdGrammar: word-form id branch must contain a digit (A-021-2)
├── parsing/
│   ├── extract.ts                # document-title-heading rule: orphan top-level checkboxes attach to no
│   │                             #   heading under it (A-021-1); wire the flat-document signal (or remove
│   │                             #   the dead flag in favor of the title-heading rule) — A-021-3
│   ├── content.ts                # LOCAL_ID_SPAN_RE: dotted-numeric ids ("4.1") capturable without a
│   │                             #   trailing separator (A-021-2)
│   ├── depth.ts                  # NO CHANGE (depth rule and fold partition are correct once parenting is fixed)
│   └── extent.ts                 # NO CHANGE (extents naturally re-bound once checkbox tasks survive)
├── discovery/adapters/           # NO ROW CHANGES — fix lives in the shared defaults five adapters consume;
│   └── ...                       #   spec-kitty/spec-superpower immunity pinned by regression tests (R3)
└── engine/                       # NO CHANGE (mirrorRegion/create inherit corrected task regions)

tests/
├── fixtures/parsing/kiro-plan/tasks.md          # the reported file's exact shape (verbatim reproduction)
├── fixtures/engine/worlds/kiro-plan-basic/      # world.json + repo/.kiro/specs/<feature>/tasks.md
├── unit/parsing-kiro-plan.test.ts               # 13 tasks, ids/titles/extents/checked at DEFAULT cap
├── unit/parsing-title-heading.test.ts           # title-heading rule matrix + dead-flag disposition
├── unit/parsing-local-id-span.test.ts           # "4.1 " id capture; digit-required word ids; no regressions
├── integration/engine-kiro-plan-world.test.ts   # plan→apply→re-plan→rollback: 13 task issues + title issue,
│                                                #   per-issue descriptions, idempotency, no-whole-file assertion
├── integration/parsing-corpus.test.ts           # PINNED — must stay unchanged (corpus fixture untouched)
└── integration/depth-folding-*.test.ts          # PINNED — intentional folding under real task headings unchanged
```

**Structure Decision**: Single existing library project; no new directories beyond test fixtures/tests. The change is localized to the parsing core's shared-defaults consumption point (`src/parsing/extract.ts`) plus two grammar constants, which keeps all five affected adapters fixed simultaneously and leaves the two immune adapters provably untouched (Principles III/V).

## Complexity Tracking

> No constitution violations — section intentionally unused.
