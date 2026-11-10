# Tasks: Full Adapter Support — Spec Superpowers (`spec-superpower`)

**Input**: Design documents from `specs/018-spec-superpower-adapter/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/spec-superpower-adapter.md](./contracts/spec-superpower-adapter.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED — constitution Principle VI (NON-NEGOTIABLE test-first) and FR-013 ("the framework-consistency contract suite (016) extended — written test-first") make test tasks mandatory; every test task lands and FAILS before its implementation.

**Organization**: Grouped by user story; US1 (P1) is the MVP. **All work stays on branch `018-spec-superpower-adapter`.**

**Test runner**: `node:test` — compile with `npm run compile:tests`, run tiers with `node scripts/run-tests.mjs --tier <unit|contract|integration|e2e>`. Test files are `build/tests/<tier>/*.test.js` compiled from `tests/<tier>/*.test.ts`.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verified baseline on the feature branch

- [X] T001 Confirm working branch is `018-spec-superpower-adapter` (create from current HEAD if missing), run `npm ci` then `npm test` at repo root and record the green baseline (all tiers, six→five identity set as of baseline)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Identity vocabulary, frozen-contract amendments (union only — the fallback and member amendments land with their stories/US3 tests), shared plumbing the conventions row needs, the row itself, and the fixture repo.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Note: `tests/contract/framework-support-consistency.test.ts` (T002) stays RED until the Phase 6 README/requirements tasks land — expected, test-first posture (research R11); do not revert the pin.

- [X] T002 [P] Flip the fabricated-names pin in tests/contract/framework-support-consistency.test.ts from `/spec-kitty|spec-superpower/i` to `/spec-kitty/i` and confirm the registry-parameterized assertions now demand the sixth id in README (FR-013, test-first; suite goes green only after T023/T024)
- [X] T003 [P] Update the hard-coded five-id registry literal to the six-id set (add `"spec-superpower"`, sorted) in tests/contract/discovery-surface.test.ts
- [X] T004 [P] Update the hard-coded five-id literal to the six-id set in tests/unit/discovery-adapters-builtin.test.ts
- [X] T005 Execute amendment A-018-0 (`docs/contract-amendments.md` three-artifact rule, ONE commit): widen the union in specs/002-core-domain-contracts/contracts/task-model.md and src/domain/task.ts to exactly `"bmad" | "spec-kit" | "open-spec" | "kiro" | "spec-superpower" | "generic"`, regenerate the snapshot with `UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`, and add the amendment entry to docs/contract-amendments.md (research R1)
- [X] T006 [P] Add `"spec-superpower"` to `BUILT_IN_FRAMEWORK_IDS` and update the "five frozen literals" comment in src/discovery/types.ts (engine `isBuiltInFrameworkId` gate now accepts the identity per contract Rule 1)
- [X] T007 [P] Add `"spec-superpower"` to the `frameworkAdapters` default enabled set in src/config/defaults.ts (FR-001 default-enabled; release scan must stay green)
- [X] T008 Add feature-name kind `{ readonly kind: "date-stripped-basename" }` to the `FeatureNameRule` union in src/discovery/adapter.ts and a branch in `applyFeatureNameRule` (src/discovery/conventions.ts): basename → strip a leading date prefix matching exactly `NNNN-NN-NN-` when present → strip the final `.ext` (e.g. `docs/superpowers/plans/2026-11-09-auth.md → auth`, `…/notes.md → notes`; never `undefined` for a claimed path; research R5)
- [X] T009 Add the optional member `readonly identityFileScope?: boolean` through src/discovery/adapter.ts (`FrameworkAdapter` and `AdapterConventions`), src/discovery/conventions.ts (`ResolvedConventions` + carried by `defineFrameworkAdapter`), and src/parsing/adapter.ts (`TaskFileAdapter`); in src/parsing/taskfile.ts, when `adapter.identityFileSeed` inputs a `localTaskId` and `identityFileScope === true`, compose the seed input as `` `${basename}<NUL>${localTaskId}` `` (basename = substring of `filePath` after the last `/`; `<NUL>` = `"\u0000"`), leaving `Task.localTaskId` the bare id and every non-scoped adapter's seed inputs byte-identical; amend specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md member whitelist and log the amendment in docs/contract-amendments.md (research R7, contract Rule 6 / amendment A-018-2)
- [X] T010 Create src/discovery/adapters/spec-superpower.ts with the `deepFreeze`d conventions row exactly per data-model.md §2.2 — `taskFilePatterns: ["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"]`, `baseDirectories: ["docs/superpowers/plans/"]`, `detection: { pathPrefixes: ["docs/superpowers/plans/"] }`, `featureNameRule: { kind: "date-stripped-basename" }`, `headingGrammar` source `^\s{0,3}#{2,4}\s+(?<id>Task\s+[0-9]+)\s*:\s*(?<title>.+)$`, `rollupPattern` source `^\s*[-*+]\s*\[[ xX]\]`, default `phasePattern`/`summaryPattern`/`titleBehavior`, `siblingDocuments: []`, `identityFileScope: true`, NO `agentHooksDirectory`/`agentHookTemplate` (FR-012), `frameworkSpecificExclusions: []` — and register the row + adapter in src/discovery/adapters/index.ts (`builtInAdapters` and `builtInAdapterRows`, listed before `generic`)
- [X] T011 Extend `DEFAULT_PRECEDENCE` in src/discovery/registry.ts to `["kiro", "open-spec", "spec-kit", "bmad", "spec-superpower", "generic"]` (contract Rule 2)
- [X] T012 [P] Create fixture repo `tests/fixtures/repos/discovery/spec-superpower/` with `docs/superpowers/plans/2026-11-02-auth.md`, `2026-11-01-sync.md`, `2026-11-09-sync.md` — each with the full standard preamble (document title `# …`, `## Goal`, `## Architecture`, `## Tech Stack`, Spec reference line, `## Global Constraints`, `## Review Focus`), tasks using `### Task N: <Component>` headings (use level `####` throughout `2026-11-02-auth.md` to pin level variance), seven `- [ ] **Step N: …**` checkboxes total, exact-file lists, commands, and at least one fenced code block per plan; plus NOT-claimed decoys: `docs/superpowers/2026-11-05-outside.md` (above the plans root) and `docs/superpowers/plans/scratch.md` (non-date filename) (fixtures spec: data-model.md + quickstart.md §3; helper `tests/helpers/discovery-fixtures.ts`)

**Checkpoint**: Registry, union, defaults, and row are consistent; T003/T004 surface pins green; consistency suite red only on README/doc coverage (expected until Phase 6); fixture discoverable.

---

## Phase 3: User Story 1 — Plan tasks become clean issues, nothing else does (Priority: P1) 🎯 MVP

**Goal**: Zero configuration discovers the plans, every `Task N:` heading yields exactly one task (id `Task N`, title = component name), and no step checkbox, preamble section, or document title becomes a task; plan files outside the root are not claimed at all.

**Independent Test**: parse/discover the fixture repo with default config → exactly three tasks per plan (SC-002 counts prove zero noise); a date-named file outside the plans root is absent from discovery (spec US1 Independent Test).

### Tests for User Story 1 ⚠️ (write FIRST, ensure they FAIL)

- [X] T013 [P] [US1] Create tests/unit/discovery-adapters-spec-superpower.test.ts: table-pin every row field against data-model.md §2.2 verbatim (glob, base dir, detection, rule kind, both grammar sources, `identityFileScope === true`, absent agent-hook fields, `frameworkSpecificExclusions` empty), `detect()` claims `docs/superpowers/plans/2026-11-09-auth.md` and also a nested-depth `a/docs/superpowers/plans/2026-11-09-x.md` but returns null for `docs/superpowers/2026-11-05-outside.md` and `docs/notes.md`, and `featureName()` table per research R5
- [X] T014 [P] [US1] Create tests/unit/parsing-spec-superpower.test.ts driving `parseTaskFile` with `builtInAdapters["spec-superpower"]` over fixture content: exactly 3 tasks with ids `Task 1`/`Task 2`/`Task 3` and titles excluding the id span; the 7 checkboxes appear ONLY in `exclusions` (kind `"checklist"`, reason `"rollup"`) and never in `file.tasks`; zero tasks from preamble headings or the document title; level-4 task headings still capture (auth fixture) and a level-5 `##### Task 9: X` does NOT; empty task section → valid task with `taskBody.startLine === endLine`; headingless-preamble-only content → zero tasks, zero errors; a stray `- [ ]` before the first task heading is excluded, never a task; step bodies byte-equal their plan span (FR-004/005/006, SC-002, data-model §3 rules 1–6)
- [X] T015 [P] [US1] Create tests/integration/discovery-spec-superpower.test.ts (pattern of tests/integration/discovery-adapters.test.ts, `fixtureRepoPath("discovery/spec-superpower")`): default config claims 3/3 plan files with `frameworkId === "spec-superpower"`, `via: "path"`, `matchedPattern === "docs/superpowers/plans/"`, and 0 unrelated Markdown files (SC-001); decoys absent
- [X] T016 [US1] Extend tests/unit/discovery-selection.test.ts (test-first for amendment A-018-1): selection of a date-named file outside the plans root returns UNCLAIMED (no adapter, no generic); a stray `tasks.md` with zero detection still falls back to `generic` (`via: "fallback"`) as today; a file matching only a custom descriptor's patterns with failing detection is now unclaimed; `generic` disabled + zero matches still throws as today (contract Rule 2 amendment)

### Implementation for User Story 1

- [X] T017 [US1] Implement the fallback narrowing (amendment A-018-1): in src/discovery/registry.ts `selectAdapter` returns `DetectionRecord | null` — zero-match candidates take the `generic` fallback ONLY when the basename matches the enabled generic adapter's effective `taskFilePatterns` (compile with `compileNamePattern` from src/discovery/patterns.ts), otherwise null; in src/discovery/discover.ts skip null selections (file omitted, no diagnostic); amend specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md (zero-match rule), docs/discovery.md wording, and log A-018-1 in docs/contract-amendments.md (FR-002 "MUST NOT claim Markdown outside the configured plans root"; research R6)

**Checkpoint**: US1 independently verifiable — run T013–T016 green + `node dist/cli/main.js inventory --repo tests/fixtures/repos/discovery/spec-superpower` (quickstart §3). MVP ready.

---

## Phase 4: User Story 2 — Steps are mirrored content, and progress travels (Priority: P2)

**Goal**: Issue descriptions mirror steps/files/code verbatim (screened); checking a step re-mirrors exactly that one task's issue body; the repository file round-trips byte-for-byte apart from the visible reference prefix.

**Independent Test**: sync the fixture on the fake `Linear_Port`, check one step in place, re-run → 1 issue description write, 0 other writes, bodies byte-faithful (spec US2 Independent Test / SC-004).

### Tests for User Story 2 ⚠️ (write FIRST, ensure they FAIL)

- [X] T018 [US2] Create tests/integration/sync-spec-superpower-drift.test.ts on the injected fake `Linear_Port` (pattern of the existing 008 sync integration suites): initial apply creates 3 issues per plan with descriptions reproducing each task's steps, file lists, commands, and fenced code verbatim; edit one plan file flipping `- [ ] **Step 2: …**` to `- [x] …`, re-plan/re-apply → exactly 1 issue description write and 0 other mutations; write-back then re-parse reproduces the plan byte-for-byte apart from the visible reference prefix (no progressive prefixing); a body containing security-screening trigger content is blocked pre-transmission while the rest of the run proceeds unchanged (FR-007/008, SC-004, US2-AC1–AC4, data-model §3 rule 7)

### Implementation for User Story 2

- [X] T019 [US2] Verify the existing 004/008 machinery satisfies T018 with NO src/ changes (extents, normalization profile, surgical rendering in src/parsing/render.ts, drift conflict maps); fix only what the red test pinpoints — any fix must leave other built-ins' golden fixtures untouched (SC-005); then extend every framework-parameterized suite so `spec-superpower` is covered: `grep -rln "builtInAdapters\|DEFAULT_PRECEDENCE\|five-frameworks" tests/` and add the new identity to each parameterized list (property/round-trip, overrides, e2e selection)

**Checkpoint**: US2 independently verifiable via T018 green + quickstart §5.

---

## Phase 5: User Story 3 — Filename-named features at plan-registry scale (Priority: P3)

**Goal**: Each plan file is its own feature (`date-stripped` name), same-name plans keep distinct deterministic identities, in-place edits never shift identity or matching, and plans route through path rules like any framework.

**Independent Test**: three dated plans (one name on two dates) → three derived feature names (date stripped); the repeated name resolves to distinct deterministic identities per file; editing task text changes no identities (spec US3 Independent Test).

### Tests for User Story 3 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T020 [P] [US3] Create tests/unit/parsing-spec-superpower-identity.test.ts: parsing `2026-11-01-sync.md` and `2026-11-09-sync.md` content with the built-in adapter yields pairwise-DISTINCT `stableUuid`s across the two files (contract Rule 6); repeated parses are byte-identical (determinism); an in-place description edit under `Task 2` leaves every uuid unchanged; two `Task 1:` headings in ONE file produce exactly one `duplicate-local-id` parse warning with both tasks retained (FR-010, data-model §3 rules 4/8); seed-input regression: parse an unchanged `kiro`/`generic` golden fixture and assert uuids identical to pre-feature goldens (`identityFileScope` absent ⇒ byte-identical seeds, SC-005)
- [ ] T021 [P] [US3] Extend tests/integration/discovery-spec-superpower.test.ts: feature names exactly `auth`, `sync`, `sync` (SC-003 "100% of derived feature names equal the date-stripped plan filename"); with `DiscoveryOverrides.adapters["spec-superpower"].taskFilePatterns` overriding the glob, `plans/scratch.md` is claimed and named `scratch` (edge case "keep the plans-root rule and override the filename pattern"); with routing configured via `projectByPath` rules for `docs/superpowers/plans/`, plan tasks route per the rules like any framework (US3-AC4); issues created for `2026-11-01-sync.md` never match tasks parsed from `2026-11-09-sync.md` (fake `Linear_Port` cross-match attempt, US3-AC2)
- [ ] T022 [US3] Extend tests/unit/discovery-adapters-spec-superpower.test.ts with the feature-name rule table (T008 branch): `2026-11-09-auth.md → auth`; `notes.md → notes`; a date prefix of the wrong shape (`2026-11-auth.md`, `x2026-11-09-a.md`) is NOT stripped; programmatic `featureName` override beats the rule via `resolveConventions` (FR-003, research R5/R8)

### Implementation for User Story 3

- [ ] T023 [US3] Confirm the T009 seed composition satisfies T020/T021 without touching `taskStableSeed` or `src/domain/task.ts` seed layout; adjust the composition in src/parsing/taskfile.ts (or the T009 plumbing) only as the red tests require; add the "renamed or re-dated plan file ⇒ new feature (documented consequence, no rename tracking)" sentence to specs/018-spec-superpower-adapter/contracts/spec-superpower-adapter.md Rule 6 examples if not already exercised by T020 (FR-010, spec edge case)

**Checkpoint**: US3 independently verifiable via T020–T022 green + quickstart §4.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: FR-013 same-change documentation (turns the consistency suite green), FR-012 refusal pins, full validation.

- [ ] T024 [P] README.md: add the `spec-superpower` row to the framework overview table, append `spec-superpower` before `generic` in the precedence sentence (must equal the recomputed `DEFAULT_PRECEDENCE` literal the consistency suite derives), and add a `### Spec Superpowers (\`spec-superpower\`)` subsection (>120 chars of real behavior) stating plainly per FR-009 that step checkboxes are mirrored content and never completion inputs and that workflow completion is managed on the tracker side
- [ ] T025 [P] specs/requirements.md: extend the Purpose five-built-ins sentence, Requirement 7 framework list (AC1/AC2), and the glossary entries `Framework`, `Supported_Framework` (exact parse target: "One of …;" list), and `Framework_Id` to enumerate all six identities with `spec-superpower` included (FR-013)
- [ ] T026 [P] docs/framework-adapters.md: built-in table row + precedence list + grammar/detection summary for `spec-superpower`; docs/configuration.md: example showing `DiscoveryOverrides.adapters["spec-superpower"]` overriding `baseDirectories`/`detection` (plans root) and `taskFilePatterns` (filename convention — note the array-replace semantics, research R8); docs/discovery.md already touched by T017 — cross-check consistency
- [ ] T027 [P] CHANGELOG.md: Unreleased entry for the new built-in identity, the three amendments (A-018-0/1/2), and the docs duty
- [ ] T028 [P] FR-012 refusal pins: add `spec-superpower` cases to tests/unit/agent-hooks.test.ts (`agentHookScaffold("spec-superpower", bin)` ⇒ `undefined`) and tests/integration/queue-hooks-install.test.ts (install ⇒ `{ status: "refused" }` with zero writes); confirm the consistency scaffold table remains `["generic", "kiro"]`
- [ ] T029 Extend tests/e2e/discovery-user-stories.test.ts with the US1/US3 walkthrough over the fixture repo (plan-level, read-only surfaces)
- [ ] T030 Run the full validation: `npm test` (all tiers + coverage gate + defaults scan; consistency suite now green), `node scripts/release.mjs --dry-run` (distributed-defaults scan: zero org literals), and quickstart.md §1–§5 end to end; record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: start immediately.
- **Phase 2 (Foundational)**: T002/T003/T004 (test-first pins) → T005/T006/T007 (vocabulary, one-commit union trio) → T008 → T009 (T008/T009 share files in `src/discovery/adapter.ts`+`conventions.ts` — sequential) → T010 (needs T008+T009 kinds/members) → T011 → T012 (independent, any time). **Blocks all stories.**
- **Phase 3 (US1)**: T013/T014/T015/T016 (tests, [P] trio + T016) → T017 (implementation). Row+fixtures from Phase 2 make T013–T015 meaningful already; T016 turns red on A-018-1 until T017 lands.
- **Phase 4 (US2)**: T018 (test) → T019 (verify/extend). Depends on US1 (claims + tasks exist); independently testable after.
- **Phase 5 (US3)**: T020/T021 (tests, [P]) → T022 → T023. T021 extends the US1 file (after Phase 3). Identity behavior depends on Phase-2 T009.
- **Phase 6 (Polish)**: all stories complete; T024/T025 turn `framework-support-consistency` green (T002's flipped pin).

### User Story Dependencies

- **US1 (P1)**: Foundational only — the MVP.
- **US2 (P2)**: Foundational + US1's claimed tasks (mirroring has nothing to mirror without them); its tests are self-contained in T018.
- **US3 (P3)**: Foundational + US1's fixture/discovery file; refines P1/P2 per spec ("capability refines P1/P2").

### Within Each User Story

- Tests written and FAILING before implementation (Principle VI); row/model before integration; story checkpoint before next priority.

### Parallel Opportunities

- T002‖T003‖T004 (three test files) and T006‖T007 (two src files); T012 anytime.
- Within US1: T013‖T014‖T015; US3: T020‖T021. Polish: T024‖T025‖T026‖T027‖T028 (all distinct files).

---

## Parallel Example: User Story 1

```bash
# Tests together (all fail until T017 + row behavior):
Task: "Row/detect/featureName table pins in tests/unit/discovery-adapters-spec-superpower.test.ts"
Task: "Parse tables (3 tasks, 7 exclusions, preamble zero) in tests/unit/parsing-spec-superpower.test.ts"
Task: "Zero-config discovery matrix in tests/integration/discovery-spec-superpower.test.ts"
# Then sequentially: T016 selection-gate tests → T017 registry/discover implementation
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (T001) → 2. Phase 2 (T002–T012, CRITICAL) → 3. Phase 3 (T013–T017) → 4. **STOP & VALIDATE**: quickstart §2–§3 (SC-001/SC-002, US1 acceptance) → 5. Feature merge-ready for the "plans become clean issues" value.

### Incremental Delivery

1. Setup + Foundational → row registered, fixture ready.
2. US1 → clean task extraction + unclaimed-outside-the-root (MVP).
3. US2 → progress-traveling mirrors (SC-004).
4. US3 → registry-scale naming + collision-free identities (FR-010).
5. Polish → docs duty lands in the same feature branch/PR (FR-013); consistency suite green = merge gate.

### Parallel Team Strategy

After Phase 2: Dev A takes US1→T017, Dev B drafts T018 (US2), Dev C drafts T020/T021 (US3) — files are disjoint except the two files US3 extends after US1 completes.

---

## Notes

- Branch discipline: every commit for this feature lands on `018-spec-superpower-adapter`; commit per task or logical group; NO self-attribution trailers (repo AGENTS.md).
- The intermediate RED of `framework-support-consistency.test.ts` between T002 and T024/T025 is by design (test-first); do not "fix" it by weakening the suite.
- [P] tasks = different files, no dependencies. Verify each test fails before implementing it.
- Field values (grammars, globs, id/date rules) are quoted verbatim from data-model.md §2 — do not improvise variants; FR-011 forbids new `ResolvedConfig` keys and org-specific literals.
