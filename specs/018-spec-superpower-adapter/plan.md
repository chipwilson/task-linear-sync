# Implementation Plan: Full Adapter Support — Spec Superpowers

**Branch**: `018-spec-superpower-adapter` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-spec-superpower-adapter/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Add a sixth built-in framework identity, `spec-superpower`, that understands the
Superpowers-style implementation-plan convention: date-prefixed plan documents under
`docs/superpowers/plans/` are discovered by filename convention, each `Task N:` heading
becomes exactly one task (id `Task N`, title = component name), step checkboxes and code
fences are mirrored body content rather than tasks, preamble sections never become tasks,
and each plan file is its own feature named by its date-stripped filename. Technical
approach: one new conventions row (`src/discovery/adapters/spec-superpower.ts`) driven by
the existing adapter/conventions/parse machinery — a task-heading grammar that matches
only `Task N:` headings, a step-capture grammar that keeps every checkbox as excluded body
content, a new `date-stripped-basename` feature-name rule, and a file-scoped stable-identity
rule so plans sharing a derived feature name never collide identities (FR-010). Three
documented contract amendments ride along (identity-union widening, generic-fallback
narrowing, one new optional parse-adapter member); everything else is additive.

## Technical Context

**Language/Version**: TypeScript 5.x, strict, ES2022 modules (NodeNext); Node.js engine ≥ 20.0.0

**Primary Dependencies**: zero runtime dependencies (Node built-ins only — constitution "Technology stack"); dev-only `typescript` + `eslint`

**Storage**: N/A for this feature — discovery/parse conventions are pure over file content; run state, manifests, and attachments are consumed unchanged

**Testing**: `node:test` via `scripts/run-tests.mjs` (tiers: unit / contract / integration / e2e); fake `Linear_Port` for integration; fixture repos under `tests/fixtures/repos/discovery/`

**Target Platform**: standalone npm package (ESM library + CLI binary), Linux/macOS/Windows CI on GitHub Actions

**Project Type**: library + cli (single package, subpath exports; this change touches `src/discovery`, `src/parsing`, `src/config`, `src/domain`, docs, and tests)

**Performance Goals**: unchanged — single sorted traversal; the new basename pattern joins the existing compiled union, no additional walks or reads

**Constraints**: zero new runtime deps; no organization-specific literals in defaults (release scan); frozen-contract amendments only via `docs/contract-amendments.md` three-artifact rule; byte-for-byte determinism and round-trip fidelity (Principles II/IV)

**Scale/Scope**: one new built-in identity — 1 new adapter file, ~8 changed source/config files, 3 amended contract documents, 1 new fixture repo, ~6 new/extended test files, README + requirements + docs updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Safety First | PASS | No new surfaces; read-only lanes unchanged; step/body content flows through the existing `Security_Screener` path (US2-AC4), gating, locking, journaling untouched |
| II. Durable Identity | PASS (with documented rule) | Identities stay deterministic and content-free in the seed; FR-010 requires per-file distinct identities for same-named plans, realized as a **file-scoped local-id composition at the `parseTaskFile` seed call site only** — `taskStableSeed` and its frozen layout are untouched, all other adapters' seeds stay byte-identical. Justified in `research.md` R7 per governance ("complexity that appears to circumvent a principle MUST be justified in the plan") |
| III. Intelligent Defaults, Overridable Config | PASS | New defaults (`docs/superpowers/plans/` root, date-prefixed filename pattern, grammars, name rule) ship built-in, are overridable through the existing three-layer merge, and contain zero org-specific literals; no new `ResolvedConfig` keys (frozen-contract guard in `src/discovery/conventions.ts`) |
| IV. Determinism & Idempotency | PASS | Filename-derived names, ordered discovery, deterministic id-scoped UUIDs, and parse→render→parse round-trip are all pinned by existing suites extended to the new identity (SC-005) |
| V. One Engine, Additive Surfaces | PASS | The identity flows through the same engine/gates/surfaces (FR-001); no surface changes; `isBuiltInFrameworkId` acceptance is a data change, not a new path |
| VI. Test-First & Quality Gates | PASS | Consistency-suite and surface-pin updates land test-first (FR-013); every acceptance criterion maps to a suite in `quickstart.md`; SC-005 requires the full suite green with zero behavior change for existing identities |

**Amendment inventory (required by governance, executed test-first in implementation):**

1. `FrameworkId` union widening `"bmad" | … | "spec-superpower"` — the documented amendment
   path pre-authorized in `src/discovery/types.ts` ("widening it is an amendment candidate")
   — via `docs/contract-amendments.md`: update `specs/002-core-domain-contracts/contracts/task-model.md`,
   `src/domain/task.ts`, and regenerate `tests/contract/snapshots/frozen-surface.json` together.
2. Generic-fallback narrowing in `selectAdapter` — a candidate matched by **no** adapter falls
   back to `generic` only when its basename also matches the enabled `generic` adapter's
   effective `taskFilePatterns`; otherwise it is unclaimed and omitted (FR-002 "MUST NOT claim
   Markdown outside the configured plans root"; US1-AC4). Amends
   `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` rule set +
   `docs/discovery.md`. Built-in behavior is bit-identical (all built-in rows share `tasks.md`/`TASKS.md`,
   so every pre-existing candidate still matches); the only observable delta is the custom-adapter
   lane where a file matches only a custom pattern and no detection claims it.
3. One optional member on the parse-side `TaskFileAdapter` (`identityFileScope?: boolean`)
   consumed at the `taskfile.ts` seed call site — amends
   `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` member whitelist.
   Absent/false ⇒ seed inputs byte-identical for every current adapter.

**Post-design re-check (after Phase 0/1 artifacts): PASS** — `research.md` resolves every
Technical Context unknown (no NEEDS CLARIFICATION remains); `data-model.md` and
`contracts/spec-superpower-adapter.md` introduce no additional gates, surfaces, or defaults
beyond those checked above.

## Project Structure

### Documentation (this feature)

```text
specs/018-spec-superpower-adapter/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── spec-superpower-adapter.md   # Phase 1 normative behavior contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── domain/task.ts                     # AMENDED: FrameworkId union += "spec-superpower"
├── config/defaults.ts                 # frameworkAdapters enabled-set default += id
├── discovery/
│   ├── adapters/spec-superpower.ts    # NEW: the conventions row (defaults layer)
│   ├── adapters/index.ts              # builtInAdapters + builtInAdapterRows += row
│   ├── registry.ts                    # DEFAULT_PRECEDENCE += id; fallback gate (amendment 2)
│   ├── discover.ts                    # omit unclaimed candidates (amendment 2)
│   ├── adapter.ts                     # FeatureNameRule += date-stripped-basename kind;
│   │                                  #   FrameworkAdapter += identityFileScope carrier
│   ├── conventions.ts                 # applyFeatureNameRule branch; row plumbing
│   └── types.ts                       # BUILT_IN_FRAMEWORK_IDS += id
├── parsing/
│   ├── adapter.ts                     # TaskFileAdapter += identityFileScope (amendment 3)
│   └── taskfile.ts                    # seed-input composition when identityFileScope
├── parsing/extract.ts                 # no logic change (grammar-driven containment)
└── discovery/agent-hooks.ts           # UNTOUCHED — refusal path is the FR-012 behavior

specs/
├── requirements.md                    # Requirement 7 + Purpose + glossary (FR-013)
├── 002-core-domain-contracts/contracts/task-model.md          # amendment 1
├── 003-task-discovery-framework-adapters/contracts/framework-adapter.md  # amendment 2
└── 004-task-parsing-line-rendering/contracts/adapter-consumption.md      # amendment 3

docs/
├── framework-adapters.md              # new row/section + precedence
├── discovery.md                       # fallback-gate wording
├── contract-amendments.md             # amendment log entries (1–3)
└── configuration.md                   # per-adapter override examples for plans root/pattern

README.md                              # overview table row, precedence, ### Spec Superpowers
                                       # subsection incl. FR-009 completion note
CHANGELOG.md                           # Unreleased entry

tests/
├── fixtures/repos/discovery/spec-superpower/        # NEW fixture repo:
│   └── docs/superpowers/plans/                      #   3 dated plans, one name on two
│       ├── 2026-11-02-auth.md …                     #   dates, full preamble, 7 steps, fences
├── unit/           discovery-adapters-spec-superpower.test.ts      # row/table pins
│                   parsing-spec-superpower.test.ts                  # grammar/steps/preamble/ids
│                   discovery-adapters-builtin.test.ts               # five→six literal
│                   discovery-selection.test.ts                      # fallback gate
├── contract/       discovery-surface.test.ts                        # six-id snapshot
│                   frozen-surface.test.ts + snapshots/*.json        # regenerated
│                   framework-support-consistency.test.ts            # flip fabricated-name pin
├── integration/    discovery-spec-superpower.test.ts                # SC-001/002/003 matrix
│                   sync-spec-superpower-drift.test.ts               # US2: 1 write, byte-fidelity
└── e2e/            discovery-user-stories.test.ts                   # scenario walkthroughs
```

**Structure Decision**: single package, no new top-level directories — the change is one
more row in the existing adapter table plus the minimal plumbing each convention family
already exposes. `src/parsing/extract.ts` needs no code change because step containment and
preamble exclusion are expressed declaratively (adapter grammars), preserving the "parser
reads adapter conventions, never framework names" boundary.

## Complexity Tracking

No constitution violations to justify. The three contract amendments are the governance
channel itself (Principle compliance work, not deviations); each is the smallest change that
satisfies a spec MUST, with rejected simpler/alternative options documented in
`research.md` (R1, R6, R7).
