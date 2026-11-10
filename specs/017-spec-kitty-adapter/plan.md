# Implementation Plan: Full Adapter Support — Spec Kitty

**Branch**: `017-spec-kitty-adapter` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-spec-kitty-adapter/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Add a sixth built-in framework identity, `spec-kitty`, that understands the Spec Kitty
mission convention: roll-up task files under `kitty-specs/<NNN-slug>/` (`tasks.md` /
`TASKS.md`) are discovered without sibling markers, each mission directory becomes the
feature name, every `Txxx` checkbox subtask becomes exactly one task whose local id is the
printed identifier (with or without a trailing separator), `## Work Package WPxx:` headings
become the subtasks' grouping (phase) rather than tasks, standard template/prose sections
and YAML front matter never produce tasks, `[P]`-shaped capability tags are kept out of
derived and mirrored issue titles while surviving byte-for-byte in the file and mirrored
bodies, and per-work-package agent-prompt files under the mission's `tasks/` directory are
never discovered. Technical approach: one new conventions row
(`src/discovery/adapters/spec-kitty.ts`) driven by the existing
adapter/conventions/parse/engine machinery — declarative grammar overrides for the never-a
heading is a task / work-package-phase / template-section behaviors, plus two new optional
parse-adapter members (`checklistIdPattern`, `titleTagPattern`) and single-segment `*`
support in framework-specific exclusion entries. Three documented contract amendments ride
along (identity-union widening, parse-adapter member whitelist extension, exclusion-entry
grammar extension); everything else is additive, and no existing adapter's detection,
parsing, or identity behavior changes.

## Technical Context

**Language/Version**: TypeScript 5.x, strict, ES2022 modules (NodeNext); Node.js engine ≥ 20.0.0

**Primary Dependencies**: zero runtime dependencies (Node built-ins only — constitution "Technology stack"); dev-only `typescript` + `eslint`

**Storage**: N/A for this feature — discovery/parse conventions are pure over file content; run state, manifests, and attachments are consumed unchanged

**Testing**: `node:test` via `scripts/run-tests.mjs` (tiers: unit / contract / integration / e2e); fake `Linear_Port` for integration; fixture repos under `tests/fixtures/repos/discovery/`; parsing corpus under `tests/fixtures/parsing/frameworks/`

**Target Platform**: standalone npm package (ESM library + CLI binary), Linux/macOS/Windows CI on GitHub Actions

**Project Type**: library + cli (single package, subpath exports; this change touches `src/discovery`, `src/parsing`, `src/config`, `src/domain`, docs, and tests)

**Performance Goals**: unchanged — the new row joins the existing single sorted traversal and the compiled task-file-pattern union; no additional walks, reads, or per-file work

**Constraints**: zero new runtime deps; no organization-specific literals in defaults (release scan); frozen-contract amendments only via `docs/contract-amendments.md` three-artifact rule; byte-for-byte determinism and round-trip fidelity (Principles II/IV); zero behavior change for the existing five identities (SC-005)

**Scale/Scope**: one new built-in identity — 1 new adapter file, ~7 changed source files, 3 amended contract documents, 1 new fixture repo + 1 parsing-corpus fixture, ~8 new/extended test files, README + requirements + docs updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Safety First | PASS | No new surfaces; read-only lanes unchanged; file content flows through the existing `Security_Screener` path; gating, locking, journaling untouched. Requesting an agent-hook scaffold for `spec-kitty` keeps refusing with zero writes (FR-012, existing template-less path) |
| II. Durable Identity | PASS | `Txxx` capture feeds the **existing** seed layout (`Framework_Id` + `Feature_Name` + `Local_Task_ID` + ordinal fallback) in `taskfile.ts` — `taskStableSeed` and its frozen layout are untouched. FR-010 (insertion/reorder invariance) is realized by the local id joining the seed, exactly as spec-kit's `Task N` ids do today |
| III. Intelligent Defaults, Overridable Config | PASS | New defaults (specs root, task-file names, detection marker, exclusion entry, five grammars) ship built-in on the adapter row and are overridable through the existing three-layer merge (built-in → config file → `DiscoveryOverrides.adapters["spec-kitty"]`), following the 018 precedent for new adapter members; zero org-specific literals; no new `ResolvedConfig` keys |
| IV. Determinism & Idempotency | PASS | Path-derived feature names, deterministic longest-pattern → precedence → alphabetical ranking, id-scoped UUIDs, tag-stripping that is fixpoint-stable, and parse→render→parse byte fidelity are all pinned by existing suites extended to the new identity (SC-005, US2-AC4) |
| V. One Engine, Additive Surfaces | PASS | The identity flows through the same engine/gates/surfaces (FR-001); no surface changes; `isBuiltInFrameworkId` acceptance is a data change, not a new path |
| VI. Test-First & Quality Gates | PASS | Consistency-suite and surface-pin updates land test-first (FR-013); every acceptance criterion maps to a suite in `quickstart.md`; SC-005 requires the full suite green with zero behavior change for the existing five |

**Amendment inventory (required by governance, executed test-first in implementation):**

1. `FrameworkId` union widening `… | "spec-kitty"` — the documented amendment path
   pre-authorized in `src/discovery/types.ts` — via `docs/contract-amendments.md`:
   update `specs/002-core-domain-contracts/contracts/task-model.md`, `src/domain/task.ts`,
   and regenerate `tests/contract/snapshots/frozen-surface.json` together.
2. Parse-side `TaskFileAdapter` member-whitelist extension
   (`specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` § rule 2) with
   two optional members: `checklistIdPattern?: RegExp` (local-id capture on checklist lines)
   and `titleTagPattern?: RegExp` (bracket capability tags excluded from derived titles).
   Both resolve `adapter.<member> ?? built-in default`, where the built-in default for
   `checklistIdPattern` is **today's `LOCAL_ID_SPAN_RE` constant verbatim** and for
   `titleTagPattern` is **no stripping (undefined)**. Absent on every current adapter ⇒
   all five existing identities parse byte-identically.
3. Framework-specific exclusion entry grammar extension
   (`specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` exclusion
   semantics + `docs/discovery.md`): a root-relative exclusion entry (contains `/`) may
   contain `*` segments matching exactly one path segment. Existing entries — which contain
   no `*` — match byte-identically; `skipByExclusion` only gains a segment-matching branch.

**Post-design re-check (after Phase 0/1 artifacts): PASS** — `research.md` resolves every
Technical Context unknown (no NEEDS CLARIFICATION remains); `data-model.md` and
`contracts/spec-kitty-adapter.md` introduce no additional gates, surfaces, or defaults
beyond those checked above.

## Project Structure

### Documentation (this feature)

```text
specs/017-spec-kitty-adapter/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── spec-kitty-adapter.md          # Phase 1 normative behavior contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── domain/task.ts                     # AMENDED: FrameworkId union += "spec-kitty"
├── config/defaults.ts                 # frameworkAdapters enabled-set default += id
├── discovery/
│   ├── adapters/spec-kitty.ts         # NEW: the conventions row (defaults layer)
│   ├── adapters/index.ts              # builtInAdapters + builtInAdapterRows += row
│   ├── registry.ts                    # DEFAULT_PRECEDENCE += id (after bmad, before generic)
│   ├── traverse.ts                    # skipByExclusion: '*' single-segment support (amendment 3)
│   ├── adapter.ts                     # FrameworkAdapter += checklistIdPattern/titleTagPattern carriers
│   ├── conventions.ts                 # row → parse-adapter plumbing for the two new members
│   ├── agent-hooks.ts                 # UNTOUCHED — refusal path is the FR-012 behavior
│   └── types.ts                       # BUILT_IN_FRAMEWORK_IDS += id
├── parsing/
│   ├── adapter.ts                     # TaskFileAdapter += checklistIdPattern/titleTagPattern (amendment 2)
│   ├── extract.ts                     # resolveConventions consumes checklistIdPattern
│   ├── content.ts                     # stripLeadingLocalId takes the resolved pattern (default = current constant)
│   ├── title.ts                       # CleanTitleOptions += titleTagPattern, consumed in the fixpoint
│   ├── taskfile.ts                    # threads both members to clean/derive call sites (seed layout UNCHANGED)
│   └── render.ts                      # no logic change (cleanTitle reuse carries the tag rule)
└── titles/                            # derivation reuses cleanTitle — tag rule flows through unchanged

specs/
├── requirements.md                    # Requirement 7 + Purpose + glossary (FR-013)
├── 002-core-domain-contracts/contracts/task-model.md             # amendment 1
├── 003-task-discovery-framework-adapters/contracts/framework-adapter.md  # amendment 3
└── 004-task-parsing-line-rendering/contracts/adapter-consumption.md      # amendment 2

docs/
├── framework-adapters.md              # new row/section + precedence + spec-kitty behavior
├── discovery.md                       # exclusion-entry wildcard wording (amendment 3)
├── contract-amendments.md             # amendment log entries (1–3)
└── configuration.md                   # per-adapter override examples for root/filenames/exclusions/grammars

README.md                              # overview sentence (five→six), table row, precedence
                                       # sentence, ### Spec Kitty (`spec-kitty`) subsection
CHANGELOG.md                           # Unreleased entry (flips the 016 removal note)

tests/
├── fixtures/repos/discovery/spec-kitty/       # NEW fixture repo: two missions in
│   ├── kitty-specs/001-demo/tasks.md          #   canonical layout, WP sections with and
│   ├── kitty-specs/001-demo/tasks/WP01-*.md   #   without [P], prose sections, front matter,
│   ├── kitty-specs/002-billing/tasks.md       #   prompt files under tasks/, .kittify/
│   └── kitty-specs/002-billing/tasks/WP01-*.md
├── fixtures/parsing/frameworks/spec-kitty/tasks.md  # parsing-corpus fixture (US1/US2 pins)
├── unit/           discovery-adapters-spec-kitty.test.ts   # row/table/precedence pins
│                   parsing-spec-kitty.test.ts              # grammars/ids/tags/sections/front matter
│                   discovery-adapters-builtin.test.ts      # five→six literal
│                   discovery-selection.test.ts             # disjointness + precedence ranking
│                   agent-hooks.test.ts                     # spec-kitty refusal, zero writes (FR-012)
├── contract/       discovery-surface.test.ts               # six-id snapshot
│                   frozen-surface.test.ts + snapshots/*.json # regenerated (amendment 1)
│                   framework-support-consistency.test.ts   # flip fabricated-name pin (FR-013)
├── integration/    discovery-spec-kitty.test.ts            # SC-001/002 discovery+plan matrix
│                   discovery-adapters.test.ts              # identity table picks up sixth row
│                   parsing-corpus.test.ts                  # spec-kitty fixture task set
│                   sync-spec-kitty-drift.test.ts           # US3: insertion/reorder, 1 create, 0 identity moves
└── e2e/            discovery-user-stories.test.ts          # US1–US3 scenario walkthroughs
```

**Structure Decision**: single package, no new top-level directories — the change is one
more row in the existing adapter table plus the minimal plumbing each convention family
already exposes. The "parser reads adapter conventions, never framework names" boundary is
preserved: heading suppression, work-package grouping, template-section containment,
`Txxx` capture, and `[P]`-tag exclusion are all expressed declaratively through adapter
grammars; the only code-behavior changes are the two generic mechanism extensions
documented as amendments 2 and 3, each inert by default.

## Complexity Tracking

No constitution violations to justify. The three contract amendments are the governance
channel itself (Principle compliance work, not deviations); each is the smallest change
that satisfies a spec MUST, with rejected simpler/alternative options documented in
`research.md` (R4, R5, R6).
