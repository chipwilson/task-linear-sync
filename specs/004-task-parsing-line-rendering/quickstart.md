# Quickstart: Validating Task Parsing and In-Place Line Rendering

Validation guide for `specs/004-task-parsing-line-rendering` — proves the feature works
end-to-end against its own fixtures, with no 003 code, no tracker, and no file writes.
Record details: [data-model.md](./data-model.md); behavior:
[contracts/parsing-api.md](./contracts/parsing-api.md),
[contracts/line-rendering.md](./contracts/line-rendering.md),
[contracts/adapter-consumption.md](./contracts/adapter-consumption.md).

## Prerequisites

- Node.js ≥ 20.0.0 (constitution engine floor).
- npm with a lockfile (`npm ci`).
- Zero network, zero credentials, zero real organization identifiers: fixture identities
  are placeholders (`SYNC` confirmation key default, `ACME-1`-style refs only where a
  non-default key is exercised via config overrides). All fixtures live under
  `tests/fixtures/parsing/`.
- The `generic`-style **fixture adapter** in `tests/helpers/parsing-fixtures.ts` is the
  only adapter in play during this feature's validation (research R1); the real 003
  adapter is a Wave-3 swap-in (contract boundary rule 5).

## Setup

```bash
npm ci
npm run build          # tsc emits dist/parsing/{index.js,index.d.ts} among others
npm run typecheck      # tsc --noEmit over src + tests (includes tests/types/ negatives)
```

## Test tiers

```bash
npm run test:unit          # parsing-content/extract/extent/conflict/identity/title/render
npm run test:contract      # parsing surface snapshot + import-purity + golden corpus
npm run test:integration   # five-framework corpus + parse→render→parse round-trips ("parsing")
npm test                   # all tiers + coverage threshold gate
```

## Validation scenarios

### US1 — Faithful task extraction (P1) 🎯 MVP

Run: `npm run test:integration -- --test-name-pattern "parsing corpus"` plus the US1 unit
tier. Fixtures: nested/mixed-indent checklists, fenced blocks containing checkbox syntax,
phase headings, summary sections, rollup checklists, flat documents (both triggers),
duplicate IDs/refs, conflict-marker blocks, and the five-framework corpus under
`tests/fixtures/parsing/frameworks/`.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Heading + checklist extraction; fenced interiors inert | `parsing extract` | Full field set per task (1-based lines, kind, raw title, `checked` iff checklist); `TASK` checkbox inside a fence yields **zero** tasks (FR-001, edge case) |
| 2 | Mixed tab/space nesting, orphans | `parsing nesting` | Tab/space file nests identically to its space-equivalent twin at `tabWidth`; orphans attach to the enclosing heading task; `parentUuid`/`childUuids` consistent (FR-002) |
| 3 | Phase tracking; summary/rollup exclusions | `parsing phase` / `parsing exclusions` | Every task carries the most recent `phase`; summary-section and rollup items excluded **with** `{lineNumber, reason}` records and absent from `tasks` (FR-003, FR-004) |
| 4 | Flat documents | `parsing flat` | No-heading document and flat-marker document: top-level checkboxes extracted as root tasks (FR-005) |
| 5 | Duplicate identities | `parsing warnings` | One warning per shared local ID / issue ref naming the value and **every** affected 1-based line, ascending; parse still succeeds (FR-007) |
| 6 | Conflict-flagged sections | `parsing conflict` | Tasks whose extent intersects a block → `unresolvedConflict: true`; block-interior lines never tasks; `featureName` threaded from the fixture adapter incl. the none-derivable case (FR-008, FR-009) |
| 7 | Extents + UUID | `parsing extent` / `parsing identity` | Extent = line + content down to next non-descendant task / ≤-level heading, descendants included, leaf ⇒ `endLine === startLine` (FR-010); UUIDs v5-shaped, repeat-parse deep-equal, invariant under title/checked/issue-ref mutation (constitution II, 002 R11) |
| 8 | Five-framework corpus | `parsing corpus` | 100% of corpus tasks extracted with correct kind, nesting, lines, extents, feature name through interface-supplied conventions only (SC-001) |

### US2 — Byte-respectful line rendering (P2)

Run: `npm run test:unit -- --test-name-pattern "render"` + the golden-corpus contract tier.
Fixtures: multi-assignment files (LF, CRLF, mixed, no trailing newline), conflict-block
fixtures, structurally-broken fixture, golden outputs under `tests/fixtures/parsing/golden/`.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Emitted line shape | `render line shape` | `[SYNC-N] ` + cleaned title after the byte-preserved prefix (indent, heading level, present local ID kept by default / dropped by option); checkbox set from assignment or retained (FR-011) |
| 2 | Multi-line rewrite | `render golden corpus` | Whole-file bytes equal the golden: bottom-to-top application, unassigned lines byte-identical, trailing-newline style exact, conflict blocks byte-for-byte untouched (**SC-002: 0 bytes differ** outside assigned lines, 100% trailing-newline preservation) |
| 3 | Structural surprise | `render abort` | Corrupted expected line → `LineRenderError { filePath, lineNumber }`, no content returned, input file content byte-identical afterwards (**SC-003: 100%** of broken fixtures halt unmodified) |
| 4 | Round-trip idempotency | `parsing round-trip` (property) | parse → render → parse titles identical; re-render is a byte-fixpoint — no progressive prefixing (constitution IV) |

### Boundary & packaging validation (cross-cutting)

Run: `npm run test:contract`

1. **Import-purity scan**: `src/parsing/**` imports only `node:crypto`-class built-ins,
   relative paths, and `task-linear-sync/{domain,config}` — no 003/005/006/007 module, no
   `node:fs` (adapter-consumption rule 1; Principle I purity).
2. **Consumption-contract conformance**: fixture adapters satisfy `TaskFileAdapter`;
   override precedence table (adapter ?? config) passes; custom minimal adapter
   (id + heading grammar only) parses a fixture (adapter-consumption rules 2–4).
3. **Parsing-surface snapshot**: `src/parsing`'s export set matches the checked-in
   snapshot — 005/008/009 consumers get drift alarms; changes land deliberately.
4. **Exports map**: `task-linear-sync/parsing` resolves post-build (`dist/parsing/index.js`
   + `.d.ts`), the single additive `package.json` entry.

## Success-criteria traceability

| Spec SC / FR | Proven by |
|---|---|
| SC-001 corpus extraction fidelity | US1.8 (interface-parameterized five-framework corpus) |
| SC-002 0 bytes differ / trailing-newline 100% | US2.2 golden corpus |
| SC-003 broken fixture halts unmodified 100% | US2.3 abort fixtures + property test |
| FR-001…FR-010 | US1 rows 1–7 (1:1 mapped in contracts/parsing-api.md) |
| FR-011…FR-013 | US2 rows 1–3 (1:1 mapped in contracts/line-rendering.md) |
| Constitution II (UUID exclusion) | US1.7 invariance property test |
| Constitution IV (round-trip determinism) | US1.7 repeat-parse + US2.4 |

## Exit criteria for this feature

`npm test` green including the coverage gate; golden corpus byte-exact; import-purity and
surface-snapshot contract tests green; `task-linear-sync/parsing` resolvable for 005/008/009.
Wave-3 integration then swaps the fixture adapter for 003's real `generic` adapter (named
seam test) — with **zero changes** inside `src/parsing/`.
