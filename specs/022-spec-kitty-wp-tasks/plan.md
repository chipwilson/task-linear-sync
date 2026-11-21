# Implementation Plan: Spec Kitty Task Source — Work-Package Documents

**Branch**: `022-spec-kitty-wp-tasks` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/022-spec-kitty-wp-tasks/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Re-base the `spec-kitty` identity on Spec Kitty's real unit of tasking: **one work-package
document inside a mission's `tasks/` collection = exactly one task**, and **the mission
roll-up (`tasks.md`/`TASKS.md`) yields zero tasks** while staying claimed. The 017 model
(every roll-up checkbox line is a task; the whole `tasks/` folder excluded from discovery) is
superseded for task selection; detection identity, mission-based feature naming, and the
engine guarantees 017 relies on are retained. Technical approach — adapter-row data plus
three generic, amendment-governed mechanism extensions:

1. **Discovery**: a new per-adapter *path-scoped candidate pattern* member
   (`taskPathPatterns`, default `kitty-specs/*/tasks/**/*.md`) brings the work-package
   collection — including legacy lane sub-folders — into the single traversal **without**
   broadening the basename union that other identities consume; the 017 C2.5 traversal
   exclusion `kitty-specs/*/tasks/` is removed from the row.
2. **Parsing**: a new whitelisted parse-adapter member `documentTaskRule` selects
   *document-unit task mode*: a zero-dependency leading-front-matter scan plus recognition
   rules (front-matter `work_package_id`, else a `WPnn` file-name token inside the
   collection) decide **0-or-1 task per file**; title cascades front-matter title → leading
   heading → readable file-name slug; content is the document verbatim minus its front
   matter (subtask `Tnnn` steps and Definition-of-Done checkboxes stay content, never tasks).
3. **Identity/engine/matching**: the frozen `TaskKind` union gains `"document"`; the seed
   stays the frozen layout with `Local_Task_ID = <normalized WP id>` and
   `Feature_Name = <mission>` (new `segment-under-base` feature-name rule, because a WP
   file's immediate parent is `tasks`); document-kind tasks **pair only via durable
   identity** (so roll-up-era leftovers can never fuzzy-match onto them — FR-011); duplicate
   WP ids inside one mission are a **hard plan-build refusal**; document-kind tasks receive
   **zero line write-back** (`[KEY-N]` prefixes stay a line-anchored-identity convenience;
   the durable anchor lives in `Attachment_Metadata` per Principle II).

Five documented contract amendments ride along (§Constitution Check); the 017 amendment ledger
entries remain valid — this feature supersedes only the roll-up-as-task-source contract rules
(017 C2.4/C2.5/C3.x, and C4 seed *inputs* for this identity).

## Technical Context

**Language/Version**: TypeScript 5.x, strict, ES2022 modules (NodeNext); Node.js engine ≥ 20.0.0

**Primary Dependencies**: zero runtime dependencies (Node built-ins only — constitution
"Technology stack"); no YAML library — the front-matter scan is a leading-fence line parser
(research R6). Dev-only `typescript` + `eslint`

**Storage**: N/A for this feature — discovery/parse conventions are pure over file content;
run state, manifests, and attachment metadata are consumed unchanged

**Testing**: `node:test` via `scripts/run-tests.mjs` (tiers: unit / contract / integration /
e2e); fake `Linear_Port` for integration (zero real Linear requests); fixture repos under
`tests/fixtures/repos/discovery/`; parsing corpus under `tests/fixtures/parsing/frameworks/`

**Target Platform**: standalone npm package (ESM library + CLI binary), Linux/macOS/Windows
CI on GitHub Actions

**Project Type**: library + cli (single package; touches `src/discovery`, `src/parsing`,
`src/domain`, `src/matching`, `src/engine`, docs, and tests)

**Performance Goals**: unchanged order of magnitude — traversal now descends one extra
directory per mission (`tasks/`) and claims `*.md` files beneath it; document-mode parsing is
O(file) with a single front-matter scan; no additional walks or tracker calls

**Constraints**: zero new runtime deps; no organization-specific literals in defaults
(release scan); frozen-contract amendments only via `docs/contract-amendments.md`
three-artifact rule; byte-for-byte determinism, idempotent re-syncs, and no write-back for
document tasks (Principles II/IV); zero behavior change for the other six built-in identities
(FR-013/SC-005, byte-identical fixtures)

**Scale/Scope**: correction of one existing identity — ~11 changed source files, 1 new
parsing module (`src/parsing/document.ts`), 5 amended contract documents, 1 fixture-repo
rework + 1 upstream-reproduction fixture + 1 collision fixture, ~10 new/updated test files
(including re-pinned 017 suites), README + requirements + docs updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Safety First | PASS | No new surfaces; all lanes stay read-only except apply behind unchanged gates; WP-id collision is refused at plan build — before any mutation; mirrored document text still flows through the existing `Security_Screener` path |
| II. Durable Identity | PASS | Seed stays the frozen `taskStableSeed` layout — `spec-kitty \| <mission> \| <WP id>` — excluding lane/title/body mutability; the anchor remains the `Attachment_Metadata` UUID, never an in-file marker (document tasks receive **no** `[KEY-N]` write-back); duplicate WP ids within a mission are treated with the same hard-failure posture as duplicate durable identities |
| III. Intelligent Defaults, Overridable Config | PASS | `taskPathPatterns`, `documentTaskRule`, and the `segment-under-base` rule ship as built-in row defaults, overridable through the existing three-layer merge (programmatic `DiscoveryOverrides.adapters["spec-kitty"]`, 017 C5.1 precedent — **no new `ResolvedConfig` key**); zero required config; zero org-specific literals |
| IV. Determinism & Idempotency | PASS | WP id normalization is deterministic; lifecycle edits keep identity and update content (FR-010); zero write-back makes the render round-trip trivially stable; the mirror slice for `kind === "document"` is kind-conditional, so heading/checklist rendering stays byte-identical (SC-005); collision refusal details are deterministically ordered |
| V. One Engine, Additive Surfaces | PASS | All behavior flows through discover → parse → match → engine unchanged gating; the matching pairing guard and mirror slice live in the engine/matching core, not in any surface |
| VI. Test-First & Quality Gates | PASS | Every FR/SC maps to a suite in `quickstart.md`; 017's superseded pins flip test-first; SC-005 requires the full pyramid green with the other six identities' fixtures byte-identical |

**Amendment inventory (governance channel, executed test-first in implementation):**

1. **A-022-0 (002 frozen)** — `TaskKind` union `"heading" | "checklist"` →
   `… | "document"`: `specs/002-core-domain-contracts/contracts/task-model.md`,
   `src/domain/task.ts`, regenerated `tests/contract/snapshots/frozen-surface.json`, and
   `specs/002-core-domain-contracts/data-model.md` §1 in one change. Additive; no existing
   value's seed or payload changes; the plan-report schema carries no `kind` field, so it is
   unaffected (pinned by the report-schema scan).
2. **A-022-1 (003 discovery)** — candidate matching gains an optional adapter member
   `taskPathPatterns` (root-relative POSIX segment globs: `*` = exactly one segment, `**` =
   zero or more segments, matched against the full relative path; basename matchers get the
   widened `(name, relPath)` traversal predicate, basename-only behavior unchanged) and
   `FeatureNameRule` gains kind `segment-under-base` (first path segment after the effective
   base directory). Amends
   `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` +
   `docs/discovery.md` + `docs/framework-adapters.md`. Entries/patterns absent ⇒ every other
   adapter's candidate set byte-identical.
3. **A-022-2 (004 parsing)** — `TaskFileAdapter` member whitelist
   (`specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` rule 2) gains
   optional `documentTaskRule` (regex **source** strings: `collectionPattern`, `idKey`,
   `titleKey`, `fileNameIdPattern`) and `contracts/parsing-api.md` gains the document-unit
   pipeline (0-or-1 draft, front-matter containment, kind `document`, extent = body,
   fold-inert at depth 1). Absent ⇒ extraction unchanged for every other adapter.
4. **A-022-3 (006 matching)** — pairing veto for `kind === "document"` tasks: they may pair
   only via the durable-identity signal; signal scoring (title/containment/token/local-id/
   issue-ref) never applies to them. Amends `specs/006-task-issue-matching/contracts/`.
5. **A-022-4 (008 engine + supersession ledger)** — mirror-section slice rule for document
   tasks (`taskBody` inclusive of `startLine`, vs the `+1` own-line skip for line-anchored
   kinds), document tasks excluded from render assignments (`expectedMarkdownChanges`
   empty), and the WP-id-collision plan-build refusal; `docs/contract-amendments.md` records
   A-022-0…4 **and** the supersession of 017 C2.4/C2.5/C3.x/C4-inputs by this feature's
   contract (`specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md`).

**Post-design re-check (after Phase 0/1 artifacts): PASS** — `research.md` resolves every
Technical Context question from the as-built repository (no NEEDS CLARIFICATION remains);
`data-model.md` and `contracts/spec-kitty-work-packages.md` add no surfaces, gates, or
defaults beyond those checked above; the five amendments are the minimal governance-bearing
set (each rejected-simpler alternative is recorded in `research.md`).

## Project Structure

### Documentation (this feature)

```text
specs/022-spec-kitty-wp-tasks/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── spec-kitty-work-packages.md    # Phase 1 normative contract (amends/supersedes 017 C-rules)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── domain/task.ts                     # AMENDED (A-022-0): TaskKind union += "document"
├── discovery/
│   ├── adapters/spec-kitty.ts         # row re-base: +taskPathPatterns +documentTaskRule
│   │                                  #   +segment-under-base; −C2.5 exclusion; −rollup-era
│   │                                  #   grammar members (017 checklistIdPattern/titleTag-
│   │                                  #   Pattern/phasePattern/summaryPattern retire)
│   ├── adapter.ts                     # FrameworkAdapter/AdapterConventions += new members;
│   │                                  #   FeatureNameRule kind "segment-under-base"
│   ├── conventions.ts                 # defineFrameworkAdapter/override plumbing for members
│   ├── patterns.ts                    # path-glob compiler (segment `*`, multi `**`)
│   ├── traverse.ts                    # task-file matcher predicate widened to (name, relPath)
│   └── discover.ts                    # path-pattern matchers join the candidate union
├── parsing/
│   ├── adapter.ts                     # AMENDED (A-022-2): whitelist += documentTaskRule
│   ├── document.ts                    # NEW: front-matter scan, recognition, title cascade,
│   │                                  #   single document draft + body extent (pure)
│   └── taskfile.ts                    # document-mode branch (0-or-1 draft), kind-conditional
├── matching/
│   └── matching.ts                    # AMENDED (A-022-3): durable-only pairing for document tasks
└── engine/
    ├── build.ts                       # AMENDED (A-022-4): collision refusal; document mirror
    │                                  #   slice; render-assignment exclusion
    └── report.ts                      # visible "no content" state for front-matter-only docs

specs/
├── requirements.md                    # Requirement 7 rewrite: work-package task source (FR-014)
├── 002-core-domain-contracts/contracts/task-model.md                     # A-022-0
├── 003-task-discovery-framework-adapters/contracts/framework-adapter.md  # A-022-1
├── 004-task-parsing-line-rendering/contracts/{adapter-consumption,parsing-api}.md  # A-022-2
└── 006-task-issue-matching/contracts/                                    # A-022-3

docs/
├── framework-adapters.md              # spec-kitty section re-based; candidate-path patterns
├── discovery.md                       # path-scoped candidate grammar (A-022-1)
└── contract-amendments.md             # A-022-0…4 + 017 supersession note

README.md                              # adapter-table row + Spec Kitty subsection (FR-014)
CHANGELOG.md                           # Unreleased: defect correction entry

tests/
├── fixtures/repos/discovery/spec-kitty/       # REWORK: detailed WP docs under tasks/, legacy
│   └── kitty-specs/<mission>/…                #   lane sub-folder, notes/review artifacts,
│                                              #   front-matter-only + no-title docs, mission
│                                              #   without tasks/ (0 tasks, not an error)
├── fixtures/repos/plan/spec-kitty-upstream/   # NEW: hermetic reproduction of the upstream
│   └── kitty-specs/002-lightweight-pypi-release/…   # 002-mission shape (SC-001/SC-002)
├── fixtures/repos/plan/spec-kitty-collision/  # NEW: duplicate WP01 mission (refusal pin)
├── fixtures/parsing/frameworks/spec-kitty/    # corpus re-based: roll-up (0 tasks) + WP docs
├── unit/              discovery-adapters-spec-kitty · discovery-traverse (path patterns +
│                      disable-restores-pre-017) · parsing-spec-kitty (document mode,
│                      recognition, cascade, front matter) · parsing-document (scan unit) ·
│                      matching-document-kind (pairing veto) · engine-spec-kitty (collision)
├── contract/          frozen-surface (regenerated) · discovery-surface ·
│                      framework-support-consistency + doc-truthfulness (re-pinned, not
│                      relaxed — FR-014) · adapter-contract (new whitelist member)
├── integration/       discovery-spec-kitty (count parity FR-009/SC-001) ·
│                      parsing-corpus (re-based) · sync-spec-kitty-lifecycle (US3: lane
│                      flip/activity/review/rename → 0 creates) ·
│                      sync-spec-kitty-rollup-leftovers (SC-004 stale surfacing, 0 matches)
└── e2e/               spec-kitty-work-packages.test.ts      # US1–US3 scenario walkthroughs
```

**Structure Decision**: single package, no new top-level directories — the correction is the
`spec-kitty` row re-based on the corrected conventions plus three generic mechanism
extensions (path-scoped candidates, document-unit parsing, document-kind pairing/mirror rules),
each documented as an amendment and **inert by default** for every other identity. The
"parser reads adapter conventions, never framework names" boundary is preserved: recognition,
title cascade, and identity anchoring are expressed as declarative members on the row; the
only framework-name-free code additions are the front-matter/document module and the
kind-conditional engine/matching rules keyed on `TaskKind`.

## Complexity Tracking

No constitution violations to justify. The five amendments are the governance channel itself
(Principle compliance work, not deviations); each is the smallest change that satisfies a spec
MUST, with rejected simpler/alternative options recorded in `research.md` (R2, R5, R6, R8,
R9, R10).
