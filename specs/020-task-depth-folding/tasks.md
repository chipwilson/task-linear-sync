# Tasks: Task-Depth Folding (sub-issue depth cap)

**Input**: Design documents from `specs/020-task-depth-folding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/depth-folding.md, contracts/configuration-amendment.md, quickstart.md

**Tests**: Included — constitution Principle VI and FR-009 make tests non-optional: every contract rule C1–C10 names its test gate (test-duty matrix in `contracts/configuration-amendment.md`).

**Organization**: Setup → **Artifact Amendment (Governance gate)** → Foundational → US1 → US2 → US3 → Polish. Tasks grouped by user story.

## ⚠️ Binding Posture — Maintainer Ruling 2026-11-18

The intelligent default for `maxTaskIssueDepth` is **1**. Effective semantics:

- `builtInDefaults` (`src/config/defaults.ts:34`, Grammar block lines 49–55) **carries `maxTaskIssueDepth: 1`**.
- The key is overridable through the frozen layering (file → programmatic; scalar replace).
- At the parsing entry, an **absent** value resolves to the built-in default **1** (Principle III: defaults MUST apply when the consumer does not override — the documented default applied, not a magic sentinel). **Default behavior is therefore a flat board** (zero Linear sub-issues).
- Range stays **1..64**; the pre-feature (unlimited) behavior is reached by explicitly configuring **`64`** (practically-unlimited escape hatch; every existing fixture is far shallower).
- Pre-feature byte-fidelity (the amended SC-001) is asserted **at explicit `maxTaskIssueDepth: 64`**, never at absence.
- Governance: this reverses research R1, so **Phase 2 amends every 020 artifact BEFORE any source task runs** — silent deviation is not permitted (constitution Governance section).

**Parallel strategy (multiple subagents)**: `[P]` = different files, no dependency on an incomplete task. Within Phase 2 one amendment subagent owns all `specs/020-task-depth-folding/` files (shared-context coherence beats file-level parallelism); one docs/requirements specialist runs in parallel. Within Phase 3: one **core** subagent (T011–T017, all `src/`) and one **baseline** subagent (T018–T023, all `tests/`); pinning edits never leave `tests/`, so the lanes stay file-disjoint. **Phases 4–6 are three fully parallel story lanes** after the Foundational checkpoint; in Phase 4 only T026 serializes on the shared unit-test file. See *Parallel Execution with Subagents*.

## Phase 1: Setup (Baseline Capture)

**Purpose**: Prove the starting suite green and freeze pre-change outputs so the amended SC-001 (64-fidelity) gate is measurable.

- [X] T001 Verify baseline: `npm run pretest && node scripts/run-tests.mjs --all` is fully green on branch `020-task-depth-folding` (repo root `/home/agentuser/repos/task-linear-sync`); record tier pass counts
- [X] T002 Capture the pre-change fidelity baseline in `/tmp/opencode/depth-baseline/`: write and run `/tmp/opencode/depth-baseline/capture.mjs` (imports `./dist/parsing/index.js`, `./dist/discovery/index.js`, `./dist/config/index.js`) parsing every `tests/fixtures/parsing/golden/` corpus file plus the quickstart Scenario-1 content — store `JSON.stringify(parseTaskFile(...))` bytes per file; record HEAD sha `823d8fb` in `/tmp/opencode/depth-baseline/META.txt`

**Checkpoint**: Suite green at baseline; reference bytes saved.

---

## Phase 2: Artifact Amendment — Governance Gate (BLOCKS ALL SOURCE TASKS)

**Purpose**: Correct every 020 artifact to the default-`1` posture before implementation (Governance: correct the artifact or amend; never silently deviate). The three frozen-contract records (`specs/002-.../configuration.md`, `specs/requirements.md`, `docs/contract-amendments.md`) stay with the code in Phase 7 per `contracts/configuration-amendment.md`; their text is authored here.

**Independent Test**: `grep -rn "absent" specs/020-task-depth-folding/` shows absence described ONLY as "resolves to the built-in default 1" (plus the 64 escape-hatch wording); no artifact still claims an absent key means unlimited.

- [X] T003 [P] Amend `specs/020-task-depth-folding/spec.md`: FR-001 → optional key `maxTaskIssueDepth` (int 1..64) with **built-in default 1**; absent resolves to 1 (flat board is the default posture); pre-feature behavior via explicit `64`; US1 AC2 → absent key yields a flat board, explicit `64` is byte-for-byte today's behavior; SC-001 → zero drift at explicit `64`; add a dated *Maintainer Ruling 2026-11-18* note recording the default-`1` decision
- [X] T004 [P] Amend `specs/020-task-depth-folding/plan.md`: Summary (builtInDefaults carries default 1; escape hatch 64), Technical Context Constraints (SC-001 fidelity measured at explicit 64; defaults-scan verified-green not unchanged-snapshot), Constitution-Check Principle III row rationale + post-design re-check note (III now satisfied by shipping default 1 per ruling), Scale/Scope (+ `builtInDefaults` key; ~15–20 test files triaged)
- [X] T005 [P] Amend `specs/020-task-depth-folding/research.md`: R1 rewritten as a **documented reversal** (Maintainer Ruling 2026-11-18: the intelligent default is 1; the previously-rejected "value in `builtInDefaults`" option is adopted at value `1`, honestly, no sentinel; legacy via `64`), R9 exact-list updated (`builtInDefaults` IS touched — defaults-scan benign-integer verify; parsing-surface + frozen-surface snapshots amended deliberately)
- [X] T006 [P] Amend `specs/020-task-depth-folding/data-model.md`: §1 table (Default: **1**; In `builtInDefaults`: **present**; merge/diagnostics unchanged), invariant I1 → default-fidelity-at-64, §8 transition table (absent ⇒ 1 row), §9 validation summary (absent ⇒ effective cap 1; present non-integer/`0`/`−1`/`1.5`/`65`/`NaN`/`Infinity`/non-number ⇒ `TaskDepthConfigError`)
- [X] T007 [P] Amend `specs/020-task-depth-folding/contracts/depth-folding.md`: C1 → key carries built-in default 1, never absent post-`loadConfig`, byte-identity gate at explicit 64, C6 → absent passes validation and resolves to cap 1, C10 surface-delta list (+ `builtInDefaults` value, + `TaskDepthConfigError` export); update each affected *Gate:* line
- [X] T008 [P] Amend `specs/020-task-depth-folding/contracts/configuration-amendment.md`: A-020-1 block text → "default 1; explicit `64` restores pre-amendment behavior; the added default is a benign integer (defaults-scan stays green); frozen-surface and parsing-surface snapshots amended deliberately", A-020-2 clause wording → "(default 1; set 64 for unlimited)", A-020-3 → behavioral change for existing consumers + migration (set `64`), duty matrices → defaults-scan "verify green", add existing-suite triage row, add `src/cli/exit-codes.ts` + `docs/cli.md` to the documentation duty matrix
- [X] T009 [P] Amend `specs/020-task-depth-folding/quickstart.md`: Scenario 1 → add `cap=64` row (reproduces `tasks=5 parented=3 folded=0`); `cap=undefined` row now equals the old `cap=1` row (`2/0/3`); recompute the `cap=2` row by measurement after implementation (existing "parented=3" appears to be an off-by-one — surviving parented tasks at cap 2 are `T001a` and `T100a` = 2), Scenario 2 → run pre-feature suites with `maxTaskIssueDepth: 64` pinned, Scenarios 4–5 unchanged family
- [X] T010 Consistency sweep in `specs/020-task-depth-folding/`: no residual "absent = unlimited" phrasing; constitution compliance review per Governance (Principles III/IV/V/VI against amended artifacts); record the ruling + reversal in a *Design History* note at the end of `specs/020-task-depth-folding/plan.md`

**Checkpoint**: All 020 artifacts consistent at default `1`; compliance review recorded. **Only now may source tasks begin.**

---

## Phase 3: Foundational — Mechanism, Default Flip, Baseline Green (Blocking Prerequisites)

**Purpose**: The shared parsing-lane mechanism plus the default flip, with the full suite restored green (legacy expectations pinned at `64`).

**⚠️ CRITICAL**: No user-story phase can begin until this phase is complete; T011–T017 are file-disjoint and parallel; T018–T023 are file-disjoint **only after T014/T015 land**.

- [X] T011 [P] Add `readonly maxTaskIssueDepth?: number` to `ResolvedConfig` (Grammar-key area) in `src/config/schema.ts` with a doc comment in the 014 range style ("int 1..64; built-in default 1 — flat board; set 64 for effectively unlimited"); the `ConfigOverrides` twin (`DeepPartial`, line 179) picks it up automatically
- [X] T012 [P] Add `maxTaskIssueDepth: 1` to the Grammar defaults block (lines 49–55) of `src/config/defaults.ts` with a comment citing the 020 amendment and the `64` escape hatch
- [X] T013 [P] Create `src/parsing/depth.ts`: pure module exporting `MIN_TASK_DEPTH=1`/`MAX_TASK_DEPTH=64`, `DEFAULT_TASK_DEPTH_CAP=1`, `TaskDepthConfigError` (`name: "TaskDepthConfigError"`, fields `key: "maxTaskIssueDepth"`, `value: unknown`, `reason: "not-an-integer" | "below-minimum" | "above-maximum"`; message names key + offending value only — no paths/identifiers), `validateTaskDepthCap(raw: unknown): number` (absent → `1`; integers 1..64 pass; else throws per `data-model.md` §9), and draft-depth computation (heading = 1; checklist = 1 + parent's depth, walking the frozen `extract.ts` parent pointers)
- [X] T014 [P] Extend `ExclusionRecord.reason` to `"summary-section" | "rollup" | "depth-folded"` at `src/parsing/extract.ts:21`
- [X] T015 [US-free prerequisite] Wire the fold in `src/parsing/taskfile.ts::parseTaskFile`: call `validateTaskDepthCap` on the incoming config **before any parsing work**; after `extractTasks` (line 57) and **before** uuid/index building (lines 70–96), prune drafts with `depth > cap`, push one `ExclusionRecord { lineNumber, kind: "checklist", reason: "depth-folded", text }` per pruned draft into `exclusions` ascending by line (monotone-depth inheritance folds whole subtrees automatically); `deriveExtents` then sees only surviving drafts (span-invariance I3 needs no extent change)
- [X] T016 [P] Export `TaskDepthConfigError` (and depth helpers as needed) from the barrel `src/parsing/index.ts`
- [X] T017 [P] Add `"TaskDepthConfigError"` to the exit-3 name list in `src/cli/exit-codes.ts` (`exitCodeForError`, lines 91–97; verify `tests/unit/cli-exit-codes.test.ts` mapping coverage and add a case there if the map is table-tested)
- [X] T018 Update `tests/contract/parsing-surface.test.ts`: add `depth` to `PARSING_MODULES` (line 19) and `TaskDepthConfigError` to the pinned barrel-name list (lines 80–111); regenerate `tests/contract/snapshots/parsing-surface.json` via `UPDATE_PARSING_SNAPSHOT=1 npm run test:contract` (depends on T011–T017)
- [X] T019 [P] Regenerate `tests/contract/snapshots/frozen-surface.json` deliberately via `UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract` if the new `builtInDefaults` value/surface changes it (depends on T011, T012)
- [X] T020 [P] Verify `tests/contract/defaults-scan.test.ts` passes unmodified (the added default is a benign integer — expected green; fix Phase-2/3 docs if not) (depends on T012)
- [X] T021 [P] Legacy-fixture triage — unit tier: in `tests/unit/parsing-*.test.ts` (extract/exclusions-warnings/extent/conflict/content/conventions-017/identity/render/spec-kitty/spec-superpower*) add `maxTaskIssueDepth: 64` to the config objects these tests build (centralize via the config builder in `tests/helpers/parsing-fixtures.ts` where tests share one) and pin explicit cap `1` where `buildConfig` defaults are asserted; adjust expectation literals only where `defaults.ts` content is asserted (`maxTaskIssueDepth === 1` added) — goal: `npm run test:unit` green (depends on T011–T017)
- [X] T022 [P] Legacy-fixture triage — contract + integration tiers: add `maxTaskIssueDepth: 64` to `tests/fixtures/config/valid-full.json` **and its assertions in `tests/integration/config.test.ts`**; amend `tests/contract/parsing-golden.test.ts` to parse each corpus file with a cap-`64` config, keeping goldens byte-unchanged except any line surfacing the new optional key; add `maxTaskIssueDepth: 64` to `world.config` in every `tests/fixtures/engine/worlds/*/world.json` with multi-level task nesting (inventory against the `attachEngine`/`buildWorld` harness in `tests/helpers/engine-harness.ts`) so `npm run test:contract` and `npm run test:integration` go green (depends on T011–T017)
- [X] T023 [P] Legacy-fixture triage — e2e tier + type pins: in `tests/e2e/cli-child-process.test.ts`, `tests/e2e/user-stories.test.ts` (determinism world), `tests/e2e/ci-enforcement-action.test.ts` and `tests/helpers/cli-harness.ts` worlds (`tests/fixtures/cli/worlds/*`), pin `maxTaskIssueDepth: 64` where nested-task output is asserted; extend `tests/types/parsing.test-d.ts` + `tests/types/negative.test-d.ts` with `maxTaskIssueDepth` presence/negative pins (wrong type rejected) and the three-member reason-union pin — goal: `npm run test:e2e` and `npm run typecheck` green (depends on T011–T017)

**Checkpoint**: Full suite green with the default flipped: `node scripts/run-tests.mjs --all` (runs `pretest` first). Default config now means cap 1; the fold mechanism works at any cap; legacy suites pinned at `64` prove the fidelity posture.

---

## Phase 4: User Story 1 — Flat board: no sub-issues at all (Priority: P1) 🎯 MVP

**Goal**: With the default posture (no key set ⇒ cap 1) or explicit `maxTaskIssueDepth: 1`, only depth-1 tasks become issues; every nested line rides verbatim in the nearest surviving ancestor's mirrored body and is recorded as a `depth-folded` exclusion.

**Independent Test**: Quickstart Scenario 1 (`cap=undefined` row prints `tasks=2 parented=0 folded=3` on the Scenario-1 fixture) and the new flat-board engine world plans with zero parented entries.

### Tests for User Story 1 (written first — must fail before implementation) ⚠️

- [X] T024 [P] [US1] Create `tests/unit/parsing-depth-fold.test.ts` (mechanism already landed via T011–T017; these encode the US1 matrices): depth matrix (C2: headings = 1, nesting via indent stack, checklist orphaned directly under a heading = 2, tab widths), fold matrix (C3: caps `undefined` (→1), `1`, `2`, `64`, deep chains ≥ 5, whole-subtree inheritance; cap-1 invariant "zero surviving tasks carry `parentUuid`"), exclusion fidelity + precedence (C5: exactly the over-cap drafts, ascending one record each; fenced-interior checkboxes never draft/fold; conflict-frozen lines never fold; `rollup`/`summary-section` win over folding at any depth), verbatim body + span invariance (C4/I3: quickstart Scenario-1 fixture parsed at caps `undefined`/`1`/`2`/`64` — `T001`'s `taskBody` span identical across caps, folded lines present verbatim in source order, folded lines receive no reference token)
- [X] T025 [P] [US1] Amend `tests/contract/parsing-golden.test.ts`: add span-invariance assertions (same corpus file parsed with caps `1` and `64` — surviving `Task_Body` extents byte-equal, over-cap lines appear in the ancestor body verbatim); the four hand-authored goldens in `tests/fixtures/parsing/golden/` must remain byte-unchanged

### Implementation for User Story 1

- [ ] T026 [US1] Extend `tests/unit/parsing-depth-fold.test.ts` (same file as T024 — serialize with that lane) with the default-posture block (C1): `loadConfig({}).maxTaskIssueDepth === 1`; file layer `{"maxTaskIssueDepth": 2}` resolves 2; programmatic override wins over file; explicit `64` resolves 64; amend `tests/unit/config-load.test.ts` with the default assertion; amend `tests/unit/config-merge.test.ts` with scalar-replace cases for the key (depends on T011, T012)
- [ ] T027 [P] [US1] Create the engine world `tests/fixtures/engine/worlds/depth-folding-flat/` (`world.json` per the `buildWorld` schema in `tests/helpers/engine-harness.ts` — config pins `maxTaskIssueDepth: 1` so the world is explicit even though it matches the default; task file with a top-level task, two nested levels, and a heading-orphaned checklist item) and its scenario file `tests/integration/depth-folding-flat.test.ts`: plan at cap 1 has zero parented entries, `create` steps carry no `parentId`, the fake `Linear_Port` (`src/tracker/testing/fake-port.ts`) receives a description containing every nested line verbatim (SC-002)

**Checkpoint**: US1 independently demonstrable — default config yields a flat board with verbatim folded bodies.

---

## Phase 5: User Story 2 — Two-level board with folded detail checklists (Priority: P2)

**Goal**: `maxTaskIssueDepth: 2` keeps depth-1 and depth-2 tasks as issues (parent links preserved at depth 2) and folds depth-3+ subtrees into their depth-2 parent's body; folded lines are invisible downstream everywhere (rule C8).

**Independent Test**: The two-level world yields issues at depths 1–2 with parent links and folds depth-3 lines in source order; the CI-action gate lane is green on a folded fixture.

### Tests for User Story 2 (write first) ⚠️

- [ ] T028 [P] [US2] Create the engine world `tests/fixtures/engine/worlds/depth-folding-two-level/` (`world.json` + a three-level nested task file) and scenario file `tests/integration/depth-folding-two-level.test.ts`: at cap 2 depth-1/2 tasks are issues, depth-2 entries carry their depth-1 `parentId`, exactly the depth-3 line folds; a fully folded subtree (depth-3 task with its own depth-4 child) rides **whole, in source order, verbatim** in the depth-2 parent's description (US2 AC2)
- [ ] T029 [P] [US2] Amend `tests/e2e/ci-enforcement-action.test.ts` with a `depth-folded` fixture scenario: a repo whose nested detail folds at cap 1 keeps all three gate conditions green (`fail-on-unmapped`, `fail-on-conflicts`, `fail-on-drift` — `src/ci/evaluate.ts` lines 94/97/100) and `check --json` totals exclude folded lines exactly as all exclusions are excluded (C8); amend `tests/integration/ci-enforcement-conditions.test.ts` if the unit-level gate triage needs a folded-world case

### Implementation for User Story 2

- [ ] T030 [US2] Append a `describe("cap 2 — two-level board")` block to `tests/unit/parsing-depth-fold.test.ts` (serializes on the file with T024/T026): depth-2 survival matrix, depth-3 fold, subtree inheritance at cap 2, exclusion-record contents

**Checkpoint**: US1 AND US2 independently functional; two-level boards supported.

---

## Phase 6: User Story 3 — Safe toggling and honest reporting (Priority: P3)

**Goal**: Tightening the cap never archives/deletes previously created issues (report-only via unmapped), invalid values refuse with exit 3 in every lane, and runs stay byte-deterministic.

**Independent Test**: The tightened-cap world plans with zero archive ops and one unmapped listing; `maxTaskIssueDepth: 0` refuses at CLI with exit 3; two consecutive `plan --json` runs are byte-identical.

### Tests for User Story 3 (write first) ⚠️

- [ ] T031 [P] [US3] Create the engine world `tests/fixtures/engine/worlds/depth-folding-tightened/` (`world.json` seeds state + fake-port world where a depth-2 task already has an issue + checkpoint; re-planned at cap `1`) and scenario file `tests/integration/depth-folding-tightened.test.ts` (C7): the plan touches neither the child issue nor its file line; the child issue appears exactly once in the unmapped-issue report section; the fake `Linear_Port` call script asserts **zero** `issueArchive` and zero delete operations (SC-003); a surviving task whose line carries a visible issue-reference token re-matches at high confidence despite any ordinal shift (US3 AC2)
- [ ] T032 [P] [US3] Create `tests/e2e/cli-depth-folding.test.ts` in the `writeDriver` + `spawnSync` style of `tests/e2e/cli-child-process.test.ts`, driven by the scratch-world pattern of quickstart Scenario 4 (a `tests/fixtures/cli/worlds/depth-folding/` world via `cliWorldDir` in `tests/helpers/cli-harness.ts`): each invalid cap `0`, `-1`, `1.5`, `65`, `"1"` → one diagnostic naming `maxTaskIssueDepth` and the offending value, `exit=3` (`CONFIGURATION_ERROR`), and zero state/files written into the repo; caps `1`/`2`/`64` → `inventory` succeeds with folded-task counts in output (SC-004)
- [ ] T033 [P] [US3] Add the C9 determinism scenario in `tests/e2e/user-stories.test.ts` (extend the double-run world at line 48) or as its own test in `tests/e2e/cli-depth-folding.test.ts` (coordinate the file split with T032): two consecutive `plan --json` (or `inventory --json`) runs on the folded fixture are byte-identical, `depth-folded` exclusions included in stable ascending order (precedent: `tests/integration/discovery.test.ts:137` byte-compare style) (depends on T032 if sharing that file)

### Implementation for User Story 3

- [ ] T034 [US3] Append the validation-refusal block to `tests/unit/parsing-depth-fold.test.ts` (C6; serializes on the file): absent → resolves cap `1` and parses; `0`/`-1` → `below-minimum`; `1.5`/`NaN`/`Infinity`/`"1"`/`null`/`{}` → `not-an-integer`; `65` → `above-maximum`; every throw names `maxTaskIssueDepth` and carries the offending value (`data-model.md` §9 verbatim), and zero parsing/mutation/write side effects occur; extend `tests/unit/cli-exit-codes.test.ts` proving `exitCodeForError` maps `TaskDepthConfigError` → `3`

**Checkpoint**: All three stories independently functional; toggling is safe-by-report.

---

## Phase 7: Polish — Governance Records, Documentation Duty & Cross-Cutting Validation

**Purpose**: The three frozen-contract records and all documentation land in the same PR as the code (Documentation duty / FR-008), then full validation. All tasks file-disjoint → maximal parallelism.

- [ ] T035 [P] Append the dated amendment block `## Amendment 2026-11-DD — maxTaskIssueDepth (feature 020)` to `specs/002-core-domain-contracts/contracts/configuration.md`, styled after the 2026-11-06 feature-014 block at line 71, using the A-020-1 text as amended in T008 (default 1; range 1..64; lane-entry refusal; `64` restores pre-amendment behavior; defaults-scan green as a benign integer)
- [ ] T036 [P] Amend `specs/requirements.md` inline, 018-tagged: Requirement 2 (heading line 108) new clause after the rollup criterion (line 120) with the A-020-2 fold text ("...WHEN the configuration resolves `maxTaskIssueDepth` (built-in default 1 — flat board; integers 1..64; set 64 for effectively unlimited; invalid values refused with a named diagnostic before any parsing — 020 amendment A-020-2)..."); Requirement 17.4 (line 417) append `maxTaskIssueDepth` (default 1) to the built-in-defaults enumeration
- [ ] T037 [P] Add the A-020-3 record to `docs/contract-amendments.md` following the `## Log — 002 frozen surface` entry format (`YYYY-MM-DD · surface · element-id · before → after · rationale · migration`, sample lines 58–66): one entry per surface delta — config key + `builtInDefaults` value, exclusion reason union, `depth` parsing module + `TaskDepthConfigError` export, CLI exit-3 name list — each with the set-`64` migration note
- [ ] T038 [P] Amend `docs/configuration-reference.md`: new row in the `## Grammar` table (line 72; table ends at `tabWidth`, line 83) — `maxTaskIssueDepth | integer | 1 (flat board; set 64 for effectively unlimited) | 1..64, named refusal at the parsing entry` — plus a pointer note under `## Keys that default to *absent*` (line 242) explaining `maxTaskIssueDepth` is NOT in that list because it ships a built-in default (014 precedent)
- [ ] T039 [P] Amend `docs/configuration.md`: one cross-reference line after the precedence block (lines 4–8) — the key lives in `docs/configuration-reference.md`; refusal happens at the parsing entry, not `loadConfig` (which stays merge-only)
- [ ] T040 [P] Amend `docs/parsing.md`: fold rule + depth definition (heading = 1; checklist = 1 + nearest task ancestor) + a `depth-folded` row in an exclusion-reason mini-table (note: the canonical reason text also lives in `specs/004-task-parsing-line-rendering/contracts/parsing-api.md` rule 4 — reference it, do not re-declare) + the span-invariance note (C4)
- [ ] T041 [P] Amend `README.md`: one sentence in the adapter-selection paragraph (lines 175–178) — how deep nested checklists become their own issues is configurable via `maxTaskIssueDepth` (default `1` — flat board; `64` for effectively unlimited) — pointing at `docs/configuration-reference.md`
- [ ] T042 [P] Amend `docs/cli.md`: extend the exit-code table row `| 3 | CONFIGURATION_ERROR | …` (line 148) to name `TaskDepthConfigError` as a mapped error name
- [ ] T043 [P] Add the toggling-risk note to `docs/parsing.md` (or the configuration-reference key row): set `maxTaskIssueDepth` **before** the first sync; prefer local ids where toggling is plausible; tightening reports orphaned child issues as unmapped and archives nothing; reference-token tasks re-match (R6 guidance)
- [ ] T044 [P] Add the `## [Unreleased]` entry to `CHANGELOG.md` (style: `- **Title** (\`path\`) — prose`, lines 10–19): feature entry stating the **default-`1` behavior change** for existing consumers and the `64` escape hatch (breaking-ish change called out honestly per 0.x practice)
- [ ] T045 Placeholder-identifier audit: confirm every doc/amendment example added by T035–T044 uses benign placeholders (no org literals, tokens, or UUIDs; quickstart-style `acme` scratch values allowed only inside throwaway `/tmp` scenarios per existing precedent) — constitution III
- [ ] T046 Run quickstart.md Scenarios 1–5 end-to-end against the built `dist/` and record actual outputs in `specs/020-task-depth-folding/quickstart-verification.md` (T009's re-measured cap-2 row lands here; correct T009's table if measurement differs)
- [ ] T047 Full validation: `node scripts/run-tests.mjs --all` (runs lint/typecheck prerequisites per `package.json` scripts, `npm run pretest` first) green including coverage thresholds; defaults-scan green; SC-001 fidelity — `diff` each file in `/tmp/opencode/depth-baseline/` against a re-parse at explicit `maxTaskIssueDepth: 64` and prove byte-identity (save the diff evidence beside `quickstart-verification.md`)
- [ ] T048 Update `specs/020-task-depth-folding/plan.md` Constitution Check with a final compliance line (III: default 1 shipped and overridable; IV: fidelity-at-64 proven by T047; VI: every C-rule gate landed) and remove any stale absent-default wording left by earlier phases

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: start immediately (T001 → T002)
- **Phase 2 (Artifact Amendment)**: BLOCKS all source tasks (Governance); parallel internally (T003–T009 [P]) → T010
- **Phase 3 (Foundational)**: starts after Phase 2; T011–T017 fully parallel; then T018–T023 (triage) parallel; the checkpoint (full suite green) blocks all stories
- **Phases 4–6 (US1/US2/US3)**: fully parallel with each other after the Foundational checkpoint; within Phase 4 write tests (T024, T025) before T026/T027; within each story, work on `tests/unit/parsing-depth-fold.test.ts` (T024 → T026 → T030 → T034) serializes
- **Phase 7 (Polish)**: T035–T044 need the story phases complete (records must match shipped behavior); T045 after T035–T044; T046–T047 after everything; T048 last

### Within Each User Story

- Tests first (must fail before their implementation angle is exercised), then world/fixture + scenario code
- Models/parsing before integration (both already landed in Foundational — stories add evidence, not mechanism)

### Parallel Opportunities

- T003–T009 (seven artifact files, disjoint) — and the docs/requirements lane T042/T043/T044 from the T008 text
- T011–T017 (seven disjoint `src/` files)
- T018–T023 (six disjoint `tests/` lanes, after T014/T015)
- After the Foundational checkpoint: **all three story lanes simultaneously**
- Story-internal parallel sets: {T024, T025}, {T026, T027}, {T028, T029}, {T031, T032}
- T035–T044 (ten disjoint docs/records files)

---

## Parallel Execution with Subagents

Suggested fan-out (OpenCode subagents; one task per file to keep lanes file-disjoint; include in every prompt: branch `020-task-depth-folding`, the **Binding Posture** section verbatim, and the exact task text):

1. **Wave A — artifacts (parallel)**: subagent *specs-editor* → T003–T009 (one folder, coherent voice, sequential internally); subagent *governance-docs* → drafts the T035–T037 + T042–T044 record/doc text from the T008-amended amendment source (lands in Wave D)
2. **Wave B — foundational (2 subagents)**: *core-parsing* → T011→T017 (all `src/`); *baseline-green* → T018–T023 (all `tests/`), started once T014/T015 report done
3. **Wave C — stories (3 subagents in parallel)**: *us1-flat* → T024→T025→T026→T027; *us2-two-level* → T028→T029→T030; *us3-toggle* → T031→T032→T033→T034. The shared file `tests/unit/parsing-depth-fold.test.ts` is owned by *us1-flat* (T024, T026) with append-only handoffs to *us2* (T030) and *us3* (T034) — or seed it with empty `describe` blocks in T024 so each lane edits only its own block and all three truly parallelize
4. **Wave D — polish**: up to ten parallel doc subagents (T035–T044), then single-agent verification chain T045→T046→T047→T048

```bash
# Wave C launch shape (conceptual — run as subagents, each with full context):
Task: "us1-flat: T024, T025, T026, T027 per specs/020-task-depth-folding/tasks.md (Binding Posture applies)"
Task: "us2-two-level: T028, T029, T030 per specs/020-task-depth-folding/tasks.md (Binding Posture applies)"
Task: "us3-toggle: T031, T032, T033, T034 per specs/020-task-depth-folding/tasks.md (Binding Posture applies)"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (baseline) → Phase 2 (artifact amendment — mandatory first)
2. Phase 3 (mechanism + default flip + suite green) — the hard 80%
3. Phase 4 (US1 evidence) → **STOP and VALIDATE**: quickstart Scenario 1 + `npm run test:integration`; the default posture already delivers the flat board — this is the shippable MVP
4. Then US2, then US3, each validated independently (quickstart Scenarios 3–5)

### Incremental Delivery

1. Setup + Amendment + Foundational → default = 1 live, zero suite drift
2. US1 → flat board proven end-to-end (MVP!) → US2 → two-level boards → US3 → safe toggling + refusals
3. Phase 7 records/docs land in the same PR before merge (Documentation duty)

---

## Notes

- `[P]` = different files, no dependency on an incomplete task; the `tests/unit/parsing-depth-fold.test.ts` append chain is the ONLY intentional cross-story serialization
- Quote constraints from `data-model.md` §9 and the reason union exactly — do not leave range/reason wording to implementation discretion
- Goldens are hand-authored byte-exact (`tests/contract/parsing-golden.test.ts`): never regenerate; amend deliberately
- `loadConfig` stays merge-only; refusal lives at the `parseTaskFile` entry so every lane (CLI, API, worker, MCP, CI action) shares one choke point (Principle V)
- Commit after each checkpoint; stop at any checkpoint to validate independently
- If measurement contradicts an artifact (e.g. the quickstart cap-2 row), the artifact is corrected (T046 → T009 fix) — never the other way round
