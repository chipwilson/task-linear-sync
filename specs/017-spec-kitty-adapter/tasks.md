# Tasks: Full Adapter Support — Spec Kitty

**Input**: Design documents from `specs/017-spec-kitty-adapter/`

**Prerequisites**: plan.md (required), spec.md (required — user stories US1/US2/US3), research.md (R1–R10), data-model.md (adapter-row defaults §2), contracts/spec-kitty-adapter.md (C1–C6), quickstart.md (validation map)

**Tests**: INCLUDED — constitution Principle VI (NON-NEGOTIABLE test-first) and FR-013 ("written test-first") make test tasks mandatory for this feature. Write each test task first and confirm it FAILS before its implementation.

**Organization**: Tasks grouped by user story; Phases 1–2 are shared/foundational (all stories block on them), Phases 3–5 are US1 (P1) → US2 (P2) → US3 (P3), Phase 6 is polish.

**Branch discipline (user requirement)**: ALL work on branch `017-spec-kitty-adapter`. Every commit MUST touch only 017-related paths (`specs/017-spec-kitty-adapter/`, `src/`, `tests/`, `docs/`, `README.md`, `CHANGELOG.md`, `specs/requirements.md`, `specs/002|003|004-*-contracts/`). NEVER commit `specs/018-spec-superpower-adapter/` or `specs/019-speckit-doc-truthfulness/` files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, and Polish tasks carry no story label)
- Exact file paths included in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verified green starting point

- [X] T001 Confirm branch `017-spec-kitty-adapter` is checked out and the baseline is green at repo root: `npm ci && npm run build && npm run compile:tests && npm test` (all suites pass before any change)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make `spec-kitty` a real, syncable sixth identity (contract amendments + registry wiring + mechanism extensions). Default-inert for the existing five identities.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Per plan.md "Amendment inventory", the three frozen-contract amendments follow `docs/contract-amendments.md` (all three artifacts per amendment, one change, test-first).

- [X] T002 [P] Write the failing identity-pin tests first: extend `tests/unit/discovery-adapters-builtin.test.ts` (five→six id literal at L16) and the precedence/ranking expectations in `tests/unit/discovery-selection.test.ts` to `kiro → spec-kit → open-spec → bmad → spec-kitty → generic`; run `node --test build/tests/unit/…` and confirm failure (research R1)
- [X] T003 Amendment 1 — widen `FrameworkId` with `"spec-kitty"` updating the THREE artifacts together per `docs/contract-amendments.md`: contract doc `specs/002-core-domain-contracts/contracts/task-model.md` (union mirror at L8), module `src/domain/task.ts` (union at L8), and regenerate `tests/contract/snapshots/frozen-surface.json` via `UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`; also add the id to `BUILT_IN_FRAMEWORK_IDS` in `src/discovery/types.ts` (L18) (FR-001, contract C1.1)
- [X] T004 Amendment 2 — extend the parse-adapter member whitelist: add optional members `checklistIdPattern?: RegExp` and `titleTagPattern?: RegExp` to `TaskFileAdapter` in `src/parsing/adapter.ts`, update the member-whitelist rule (§ rule 2, L37) in `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md`, and log the amendment in `docs/contract-amendments.md`; both MUST default inert: `checklistIdPattern` resolves to today's `LOCAL_ID_SPAN_RE` verbatim, `titleTagPattern` to `undefined` (no stripping) (C5.3)
- [X] T005 Wire consumption of the two new members (behavior byte-identical when absent): `src/parsing/extract.ts` `resolveConventions` resolves `checklistIdPattern` (`adapter.<member> ?? built-in default`); `src/parsing/content.ts` `stripLeadingLocalId` consumes the resolved pattern instead of the module constant; `src/parsing/title.ts` `CleanTitleOptions` gains `titleTagPattern` consumed inside the existing fixpoint loop (strip bracketed tags anywhere; MUST NEVER match bracketed issue references `[<KEY>-N]` — the tag pattern admits no hyphen inside brackets, C3.5); `src/parsing/taskfile.ts` threads both members to the `stripLeadingLocalId`/`cleanTitle` call sites — seed layout at taskfile.ts L63–71 UNTOUCHED (C4.1); `src/parsing/render.ts` inherits via its `cleanTitle` reuse; add the carriers on `FrameworkAdapter` in `src/discovery/adapter.ts` and plumb row→parse-adapter in `src/discovery/conventions.ts` (research R4/R5)
- [X] T006 Create the conventions row `src/discovery/adapters/spec-kitty.ts` (frozen, via `defineFrameworkAdapter`) with EXACTLY the data-model.md §2 defaults: `baseDirectories: ["kitty-specs/"]`; detection `pathPrefixes: ["kitty-specs/"]` with NO sibling requirement (C2.1); feature-name rule parent-dir-under-base (C2.3); `taskFilePatterns: ["tasks.md","TASKS.md"]`; `frameworkSpecificExclusions: ["kitty-specs/*/tasks/"]`; `headingGrammar` never-matching (source `(?!)`) so zero heading tasks (C3.1); `phasePattern: /^#{2,4}\s+Work Package\s+(?<phase>WP\d+(?::\s*[^\n]*)?)\s*$/u` (C3.6); `summaryPattern` matching the standard template/prose sections (Inputs, Prerequisites, Organization, Subtask Format, Path Conventions, Goal, Independent Test, Implementation Notes, Parallel Opportunities, Dependencies, Risks & Mitigations); `checklistIdPattern: /^(?<id>[Tt]?\d{2,}(?:\.\d+)*)[ \t]*[.:—–-]?[ \t]+/u` (C3.4); `titleTagPattern: /\[(?:P\d*|US\d+)\]/gu` (C3.5); NO agent-hook scaffold template (C1.3). Register in BOTH tables of `src/discovery/adapters/index.ts` (`builtInAdapters` + `builtInAdapterRows`)
- [X] T007 Insert `"spec-kitty"` into `DEFAULT_PRECEDENCE` in `src/discovery/registry.ts` (L33) after `bmad`, immediately before `generic` — final: `["kiro","spec-kit","open-spec","bmad","spec-kitty","generic"]` (R1) — and into the `frameworkAdapters` enabled-set default in `src/config/defaults.ts` (L43) (C1.1); re-run T002's unit targets to green
- [X] T008 [P] Amendment 3 — extend exclusion-entry grammar in `src/discovery/traverse.ts` `skipByExclusion` (L143–149): a root-relative entry (contains `/`) may contain `*` segments matching exactly ONE path segment; entries without `*` MUST keep byte-identical prefix semantics (C2.5, C5.3); update the exclusion semantics in `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`, the wording in `docs/discovery.md`, and log the amendment in `docs/contract-amendments.md`
- [X] T009 [P] Update the 016 consistency suite test-first: in `tests/contract/framework-support-consistency.test.ts` narrow the fabricated-name pin at L68 from `/spec-kitty|spec-superpower/i` to `/spec-superpower/i` ONLY, and re-pin the id list in `tests/contract/discovery-surface.test.ts` (L143) to the six ids; confirm failure (C6.1/C6.3, FR-013)
- [X] T010 Documentation trio, same change as T009 (FR-013, C6.1/C6.2): `README.md` — overview sentence five→six built-in adapters (L12), adapter-table row (L162–168), precedence sentence EXACTLY equal to `DEFAULT_PRECEDENCE.join(" → ")` (L170–172, pinned by the suite), and a `### Spec Kitty (\`spec-kitty\`)` subsection with a >120-char body (pinned, suite L48–65); `specs/requirements.md` — Purpose (L5), glossary `Framework`/`Supported_Framework`/`Framework_Id` (L25/27/29 — the exact list the suite regexes), Requirement 7 AC1 id list (L212), AC2 detection clause (L213), AC5 per-adapter defaults bullet (L216–221); `docs/framework-adapters.md` — table row + precedence + override note (L13–33); `CHANGELOG.md` — Unreleased entry re-introducing Spec Kitty as real code (flips the 016 removal note); run `node --test build/tests/contract/framework-support-consistency.test.js build/tests/contract/discovery-surface.test.js` to green

**Checkpoint**: `npm test` fully green — `spec-kitty` is a registered, syncable identity with zero behavior change for the existing five (SC-005 base). User stories can now proceed in parallel.

---

## Phase 3: User Story 1 - Zero-configuration Spec Kitty mission sync (Priority: P1) 🎯 MVP

**Goal**: A canonical Spec Kitty repository syncs with zero configuration: roll-ups discovered as `spec-kitty`, one task per `Txxx` checkbox subtask with the printed id as local id, mission directory as feature name, `[P]`/`[USn]` tags out of mirrored titles but verbatim in file and bodies, prompt files never discovered (spec US1, SC-001/SC-003).

**Independent Test**: reference fixture (≥2 missions, canonical layout) discovered and planned with default configuration; ids, titles, and feature names asserted against printed fixture values (spec US1 Independent Test).

### Tests for User Story 1 ⚠️ (write FIRST, confirm failing)

- [X] T011 [P] [US1] Create the reference fixture repo `tests/fixtures/repos/discovery/spec-kitty/` per plan.md structure: `kitty-specs/001-demo/tasks.md` and `kitty-specs/002-billing/tasks.md` roll-ups with YAML front matter, `## Inputs` template section containing an UNFENCED illustrative `- [ ]` checkbox, two `## Work Package WPnn: <title>` sections each (at least one `[P]` subtask and one `[US1]` subtask across the fixture, ids printed WITHOUT trailing separator, e.g. `- [ ] T001 Create the scaffold`), `## Dependencies` prose (`T003 depends on T001.`), `## Risks & Mitigations`, plus per-work-package agent-prompt files `kitty-specs/<mission>/tasks/WP01-<slug>.md` and a `.kittify/` directory; mission dirs also carry `spec.md` sibling docs (SC-001 inputs)
- [X] T012 [P] [US1] Write `tests/unit/parsing-spec-kitty.test.ts` pinning contract rules on the row: C3.4 local-id capture variants verbatim — `T001` (no separator), `T001:`, `T001 —`, bare `042 Create …`, dot variant `2.1 …` — each yielding `localTaskId` equal to the printed id with separator excluded; derived title excludes the id span (FR-005); C3.5 `[P]`, `[P2]`, `[US1]` absent from derived/mirrored titles while the stored RAW title and file line keep them; `[<KEY>-N]` refs never treated as tags; R3 pin: `flatDocument === true` for a roll-up (metadata only, no behavioral consumer)
- [X] T013 [US1] Write `tests/integration/discovery-spec-kitty.test.ts` over the T011 fixture with DEFAULT configuration: SC-001 — 100% of the two roll-ups discovered as `spec-kitty` and 0 non-mission Markdown files claimed (`spec.md`, prompt files under `tasks/`, `.kittify/` contents all absent); US1-AC1 — `001-demo` yields exactly the checkbox-subtask tasks with local ids equal to printed `Txxx` and titles without the id span; US1-AC2 — every task carries feature name from its mission dir with zero configuration keys set; US1-AC3 — planned/mirrored titles contain neither the raw id prefix nor `[P]`; C2.5 robustness — prompt files still never discovered when `DiscoveryOverrides.adapters` broadens `taskFilePatterns` (exclusion, not pattern luck); US1-AC4 — second identical plan run yields zero create/update actions (fake `Linear_Port` harness, `tests/helpers/engine-harness.ts` or discovery-level double-plan)

### Implementation for User Story 1

(Implementation of the US1 behaviors is the adapter row + member wiring already landed in Phase 2 T004–T007; US1 implementation work is making the T012/T013 assertions pass — any failure is a defect in the row grammars or the T005 consumption path.)

- [X] T014 [US1] Fix any Phase 2 row/consumption defects surfaced by T012/T013 in `src/discovery/adapters/spec-kitty.ts`, `src/parsing/extract.ts`, `src/parsing/content.ts`, `src/parsing/title.ts`, `src/parsing/taskfile.ts`, and extend the framework-parameterized identity table in `tests/integration/discovery-adapters.test.ts` plus a US1 walkthrough scenario in `tests/e2e/discovery-user-stories.test.ts` (id set keyed off `builtInAdapters` must include `spec-kitty`)

**Checkpoint**: US1 fully functional — run `node --test build/tests/unit/parsing-spec-kitty.test.js build/tests/integration/discovery-spec-kitty.test.js` green; this is the MVP: a Spec Kitty repo works out of the box.

---

## Phase 4: User Story 2 - Work-package structure fidelity (Priority: P2)

**Goal**: Work packages are grouping, never tasks; template/prose sections and YAML front matter never produce tasks; file byte-identical across parse → render → parse apart from the visible issue-reference prefix (spec US2, SC-002).

**Independent Test**: fixture plans exactly one task per checkbox subtask — asserted by count — and every front-matter line, template section heading, and prose subsection appears nowhere in the task list (spec US2 Independent Test).

### Tests for User Story 2 ⚠️

- [X] T015 [P] [US2] Create the parsing-corpus fixture `tests/fixtures/parsing/frameworks/spec-kitty/tasks.md` (work packages with and without `[P]`, unfenced illustrative checkbox inside `## Inputs`, `## Dependencies` prose, front matter) and wire it into `tests/integration/parsing-corpus.test.ts`: SC-002 — planned task set EQUALS the checkbox-subtask set asserted by count; zero tasks of kind `heading` for WP/template/prose headings; zero tasks or title text from front-matter lines (C3.1–C3.3); each subtask's grouping equals its enclosing `WPxx: <title>` (C3.6); the `## Inputs` illustrative checkbox yields an exclusion record (reason `summary-section`), not a task
- [X] T016 [US2] Add a spec-kitty case to `tests/integration/parsing-roundtrip.test.ts`: parse → render → parse reproduces the file BYTE-FOR-BYTE apart from the visible `[<KEY>-N]` prefix; `[P]`/`[USn]` tags survive; no progressive prefixing and no tag loss across repeated cycles (C3.8, US2-AC4, Principle IV)
- [ ] T017 [US2] Edge-case tests: append to `tests/unit/parsing-spec-kitty.test.ts` a work package with NO subtasks contributing grouping context only (zero tasks) and to `tests/integration/discovery-spec-kitty.test.ts` a mission directory with `spec.md`/`plan.md` but no task file producing no candidate and no diagnostic worse than informational (spec Edge Cases, US2)

**Checkpoint**: US1 AND US2 work independently — count-based purity and byte-fidelity proofs green.

---

## Phase 5: User Story 3 - Multi-mission routing and durable identity (Priority: P3)

**Goal**: Many missions route independently through path-based team/project rules; captured `Txxx` ids give durable identity across insertion/removal/reorder (spec US3, SC-004).

**Independent Test**: two-mission fixture routed to two configured projects plans with the correct split; inserting a subtask mid-list and swapping two work packages changes no other task's stable identity or match (spec US3 Independent Test).

### Tests for User Story 3 ⚠️

- [ ] T018 [US3] Extend `tests/integration/discovery-spec-kitty.test.ts` with a routing case: configured path rule mapping `kitty-specs/002-*` to a second project; plan splits each mission's tasks per the rule (US3-AC1) using the existing routing configuration (`ProjectByPath` semantics)
- [ ] T019 [US3] Write `tests/integration/sync-spec-kitty-drift.test.ts` over the fake `Linear_Port` (`tests/helpers/engine-harness.ts`): after a full sync, (a) insert `- [ ] T005 Sync ledger` between `T002` and `T003` → exactly ONE create and every previously synced task keeps identity and match (US3-AC2, C4.2); (b) swap two `## Work Package` sections → the run reports grouping changes only, ZERO identity or match changes (US3-AC3, SC-004)

**Checkpoint**: All three user stories independently functional; durable identity proven under the spec's drift probes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Opt-out, refusal, parity, and full-suite validation

- [ ] T020 [P] Add the `spec-kitty` refusal case to `tests/unit/agent-hooks.test.ts` (mirroring the existing spec-kit case at ~L95–115): `install-agent-hook` for `spec-kitty` refuses with zero writes and the template-less diagnostic (FR-012, C1.3); `src/discovery/agent-hooks.ts` and `src/queue/agent-hooks.ts` stay UNTOUCHED
- [ ] T021 [P] SC-005 engine parity: add one `kitty-specs/`-layout world under `tests/fixtures/engine/worlds/` and wire it into the engine suites via `tests/helpers/engine-harness.ts`; verify the parameterized plan/apply/rollback/check/CI-gate suites (`tests/integration/engine-*.test.ts`, `tests/integration/engine-properties.test.ts`, `tests/integration/cli-commands.test.ts`, `tests/e2e/ci-enforcement-action.test.ts`) accept `spec-kitty` with the same results shape as the five existing identities
- [ ] T022 FR-011 opt-out test in `tests/unit/discovery-selection.test.ts` (or a new case in `tests/integration/discovery-spec-kitty.test.ts`): with `spec-kitty` removed from `frameworkAdapters` configuration, fixture files fall back to `generic` exactly as before this feature — positional ids, no mission name — AND the `kitty-specs/*/tasks/` exclusion disappears from the enabled pool (discover.ts L41–49), proving the disable path (C2.6)
- [ ] T023 Run the full gate at repo root: `npm test` (build + all tiers) green with NO snapshot drift (do not re-run `UPDATE_FROZEN_SNAPSHOT` — frozen-surface.json was regenerated once in T003); coverage threshold met
- [ ] T024 Execute `specs/017-spec-kitty-adapter/quickstart.md` manual walkthrough end-to-end (scratch repo, read-only `inventory` + `plan` probes, idempotence and drift probes, opt-out step) and record results
- [ ] T025 Branch hygiene audit: `git log --name-only` over this branch's commits MUST show no `specs/018-spec-superpower-adapter/` or `specs/019-speckit-doc-truthfulness/` paths and no unrelated files (user requirement: feature changes exclusively on `017-spec-kitty-adapter`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001 — **BLOCKS all user stories**. Internal order: T002 (tests first) → T003 → T004 → T005 → T006 (row needs T004/T005 members) → T007 → T008 ‖ T009 → T010 (docs land with the T009 pin flip — the consistency suite pins registry ⇄ glossary ⇄ README together)
- **User Stories (Phases 3–5)**: All depend on the Phase 2 checkpoint; then proceed in parallel or P1 → P2 → P3
- **Polish (Phase 6)**: Depends on the desired story phases; T023–T025 last

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no other-story dependencies. MVP target.
- **US2 (P2)**: After Phase 2 — tests reuse the T011 fixture but are independently verifiable (count/byte proofs do not depend on US1 fixes beyond the shared row)
- **US3 (P3)**: After Phase 2 — drift tests exercise a synced state but need only US1's row behavior, not US2's

### Within Each User Story

- Tests MUST be written and FAIL before implementation/fixes
- Fixture (T011) before parse/discovery assertions (T012/T013)
- Row/consumption defect fixes (T014) after the failing assertions
- Story checkpoint before moving to next priority

### Parallel Opportunities

- T002 ‖ (nothing else in Phase 2 starts before it — amendments T003 and consistency pins T009 may then run in parallel up to T006)
- T008 and T009 are [P] (disjoint files)
- Within US1: T011 ‖ T012 (different files; T012 can author fixtures inline); US1 ‖ US2 ‖ US3 once Phase 2 checkpoints
- Within US2: T015 [P] ‖ T016 ‖ T017 touch different files
- Within Phase 6: T020 ‖ T021

---

## Parallel Example: User Story 1

```bash
# After Phase 2 checkpoint, launch together:
Task: "Create the reference fixture repo tests/fixtures/repos/discovery/spec-kitty/ (T011)"
Task: "Write tests/unit/parsing-spec-kitty.test.ts pinning C3.4/C3.5/R3 (T012)"
# Then T013 (integration) once T011 exists; T014 drives fixes from the failing set.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (baseline green)
2. Complete Phase 2 (amendments + row + wiring) — **checkpoint: full suite green**
3. Complete Phase 3 US1 (fixture + unit/integration proofs + fixes)
4. **STOP and VALIDATE**: `node --test build/tests/integration/discovery-spec-kitty.test.js` + quickstart steps 1–4
5. Ship: zero-config Spec Kitty sync works — the spec's whole promise

### Incremental Delivery

1. Setup + Foundational → sixth identity registered, existing five byte-identical
2. US1 → zero-config sync (MVP) → validate via quickstart §"Manual walkthrough"
3. US2 → structure purity + round-trip fidelity → validate via corpus/roundtrip suites
4. US3 → routing + durable identity under drift → validate via drift suite
5. Polish → opt-out, refusal, SC-005 parity, full gate

### Parallel Team Strategy

With multiple developers: one completes Phase 2; then Developer A: US1, Developer B: US2 (fixture T011 is A's, B authors the smaller corpus fixture T015 independently), Developer C: US3 drift over the fake port.

---

## Notes

- Rebase rule (research R9): if 018/019 land first, take the UNION in `FrameworkId`, `BUILT_IN_FRAMEWORK_IDS`, `frameworkAdapters`, `DEFAULT_PRECEDENCE`, README/requirements glossary, and complete the fabricated-name pin flip; re-run T003's snapshot regeneration after any union merge
- Every acceptance criterion in spec.md maps to a task here (US1-AC1..4 → T012/T013; US2-AC1..4 → T015/T016; US3-AC1..3 → T018/T019; Edge Cases → T013/T017/T022; FR-012 → T020; FR-013 → T009/T010)
- Engine seed composition (`taskfile.ts` L63–71), `agent-hooks.ts` files, and the generic adapter are MUST-NOT-TOUCH (data-model.md §1, C1.3)
- Commit after each task or logical group — on `017-spec-kitty-adapter` only (see Branch discipline above)
