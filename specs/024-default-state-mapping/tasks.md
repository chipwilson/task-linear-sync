---
description: Task list for feature 024 — Default-On Task State Mapping to Linear Default Issue States
---

# Tasks: Default-On Task State Mapping to Linear Default Issue States

**Input**: Design documents from `specs/024-default-state-mapping/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/state-mapping-defaults.md (C1–C7), quickstart.md (V1–V10)

**Tests**: INCLUDED — constitution Principle VI (NON-NEGOTIABLE) requires automated coverage for every behavioral change; quickstart V1–V10 and SC-006 pin the required tiers. Write tests first; ensure they FAIL before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are included in every task description

## Path Conventions

Single package (library + CLI): `src/`, `tests/`, `docs/` at repository root. Test runner: `node scripts/run-tests.mjs` (tiers unit/contract/integration/e2e + property/security cross-cutters) via `npm test`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the pre-change baseline so later regressions are unambiguous

- [ ] T001 Establish green baseline from repo root: `npm run lint`, `npm run typecheck`, `npm test` all pass before any 024 change; record the result (no code changes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Default tables, type surface, load-time resolution pass, and enablement helper that EVERY user story consumes (research R1: the resolved config is the single source of truth, so `resolveLaneState`/`desiredCompletionStateName` need no mapping-logic change)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 [P] In `src/config/defaults.ts`, export `DEFAULT_WORKFLOW_STATE_NAMES` exactly `{ backlog: "Backlog", todo: "Todo", inProgress: "In Progress", done: "Done" }` and `DEFAULT_LANE_STATE_MAP` exactly `{ planned: "Backlog", claimed: "Todo", in_progress: "In Progress", for_review: "In Progress", in_review: "In Progress", approved: "In Progress", done: "Done", canceled: "Canceled" }` — **no `blocked` entry** (FR-003) — and add `stateMappingEnabled: true` to `builtInDefaults`; values are non-empty platform-generic Linear default state names only, zero team keys/project names/tokens/UUIDs (contract C1.1/C1.2, release-scan target)
- [ ] T003 [P] Additive type extensions: `WorkflowStateIdentities` gains optional `mappingEnabled?: boolean` in `src/domain/routing.ts` (amendment A-024-1; no frozen member changes); `ResolvedConfig` gains `stateMappingEnabled: boolean` and `ConfigOverrides` gains optional `stateMappingEnabled` in `src/config/schema.ts`
- [ ] T004 Implement post-merge resolution pass `applyStateMappingDefaults(merged)` in `src/config/load.ts`, invoked from `loadConfig` immediately after `applyToolIdDerivations(merged, explicit)`: for every team key present in `merged.teams` only, fill each of `backlog`/`todo`/`inProgress`/`done` whose merged value is `undefined` from `DEFAULT_WORKFLOW_STATE_NAMES`; an absent `lanes` map becomes a **fresh per-team copy** of `DEFAULT_LANE_STATE_MAP`; a present map gets every absent lane key filled while configured lane keys are kept; an explicit `null` lanes map **survives as `null`** (lane-mapping off); a configured non-empty string is kept (configured wins, FR-006); a configured blank string is kept and still fails validation exactly as today; never create a team that is absent from the config (contract C2.1/C2.2, data-model §2 fill table)
- [ ] T005 [P] In `src/engine/completion.ts`, export `stateMappingActive(config, teamKey)` = `config.stateMappingEnabled !== false && config.teams[teamKey].workflowStates?.mappingEnabled !== false` (contract C3.1), and make `desiredCompletionStateName` and `resolveLaneState` identity/lane reads **null-tolerant**: a `null`, absent, or blank value takes the existing "missing" branch — never a crash at `.trim()`, never a guessed name (contract C5.1, research R7)
- [ ] T006 Correct the "no built-in default exists" diagnostic wording in `desiredCompletionStateName` and `resolveLaneState` in `src/engine/completion.ts` to point at the default table and the disable levers (`stateMappingEnabled`, per-team `mappingEnabled`, `lanes: null`) — truthful after default-on (docs-duty 019 precedent); the text MUST NOT name snapshot contents, credentials, or state ids (contract C5.2)

**Checkpoint**: Foundation ready — resolved configs now materialize defaults; user story implementation can begin in parallel

---

## Phase 3: User Story 1 - Zero-config state propagation for spec-kitty missions (Priority: P1) 🎯 MVP

**Goal**: An operator configures only team identity; spec-kitty lane advances move the paired issue per `DEFAULT_LANE_STATE_MAP` with no mapping configured; lanes without a default counterpart (`blocked`) stay untouched and reported.

**Independent Test**: Team row with only `projects` against a default-workflow team; advance a work package lane; observe the issue move (quickstart V1 + V4).

### Tests for User Story 1 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T007 [P] [US1] Create `tests/unit/config-state-mapping-defaults.test.ts` covering quickstart V1: a team row with only `projects` resolves `backlog="Backlog"`, `todo="Todo"`, `inProgress="In Progress"`, `done="Done"` plus the full default lane map with **no `blocked` key**; `stateMappingEnabled` defaults to `true`; `canonicalizeConfig` of the resolved config is byte-identical across repeated `loadConfig` calls with identical inputs (contract C1.1/C2.3)
- [ ] T008 [P] [US1] Create `tests/integration/state-mapping-lanes-default.test.ts` covering quickstart V4 on the fake `Linear_Port`: event-log lane advances on a zero-config team move issues per the C1.1 table (planned→Backlog, claimed→Todo, in_progress/for_review/in_review/approved→In Progress, done→Done, canceled→Canceled); `blocked` leaves issue state untouched with reason `lane-state-unmapped` (FR-003); a mapped lane already matching the live state is a no-op (idempotent)

### Implementation for User Story 1

- [ ] T009 [US1] Make T008 green end-to-end: confirm the resolution pass in `src/config/load.ts` gives every team an independent lanes-map copy (no shared mutation across teams, contract C2.2) and that the `resolveLaneState` path in `src/engine/completion.ts` consumes default-filled values as ordinary configured values with **zero mapping-logic change** (research R1); fix any fallout surfaced by the integration run

**Checkpoint**: User Story 1 fully functional and testable independently — zero-config lane propagation works (MVP)

---

## Phase 4: User Story 2 - Bootstrap refuses states the team does not have, with correction guidance (Priority: P1)

**Goal**: In bootstrap mode, before ANY tracker or file mutation, verify every mapped name (four identities + reachable lane targets) and the `completed`/`canceled` type categories against each team's live workflow; abort with one `StateMappingBootstrapError` (exit 3) grouped per team with missing names + entry paths, available `name (type)` states, case-insensitive near-match hints, and step-by-step correction instructions.

**Independent Test**: Point at a team whose workflow renamed `In Progress`→`WIP` and lacks `Canceled`; run bootstrap; expect a clean stop, the described error content, and zero mutation calls (quickstart V6/V7/V9).

### Tests for User Story 2 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T010 [P] [US2] Create `tests/unit/state-validation.test.ts`: one-pass report over ALL configured teams; exact case-sensitive presence test against the snapshot; `nearMatches` (case-insensitive hits) do **not** clear `missing` (no guessing, R5); `missingTypes` flags absent `completed`-type and `canceled`-type states (FR-008 second clause); a snapshot with no states for a team (including teams the snapshot omits) yields `workflowEmpty: true` as a distinct outcome instead of N missing-name noise; a team passes only when `missing = ∅ ∧ missingTypes = ∅ ∧ ¬workflowEmpty` (contract C4.2, data-model §4)
- [ ] T011 [P] [US2] Create `tests/integration/bootstrap-mapping-validation.test.ts` covering quickstart V6/V7/V8/V9 on the fake `Linear_Port`: world with `In Progress`→`WIP` and no `Canceled` ⇒ bootstrap-mode plan throws `StateMappingBootstrapError` with ZERO mutation calls on the fake port; one error lists all missing names across all configured teams grouped per team with entry paths (`teams[K].workflowStates.done`, `teams[K].workflowStates.lanes.in_progress`), available `name (type)` states, `'todo' vs 'Todo' — case differs`-style hints, and correction steps; multi-team run where only one team mismatches still reports pass AND fail for every team and aborts whole (SC-002); corrected re-run succeeds with no other change (SC-004); sync-mode run (checkpoint present) skips the validator and keeps today's plan-time conflict findings (FR-011)
- [ ] T012 [P] [US2] Create `tests/e2e/cli-bootstrap-refusal.test.ts` following the `tests/e2e/cli-child-process.test.ts` child-process precedent: CLI `plan` against a fake-port world missing a default state exits 3 and the emitted message contains the per-team grouped correction report; happy zero-config bootstrap `plan` + `apply` moves issue states (quickstart V6 e2e half)

### Implementation for User Story 2

- [ ] T013 [US2] Create `src/engine/state-validation.ts` exporting the `BootstrapMappingReport` shape `{ teamKey, missing: [{entryPath, intendedName}], nearMatches: [{entryPath, intendedName, availableName}], available: [{name, type}], missingTypes: ("completed"|"canceled")[], workflowEmpty: boolean }`, the `StateMappingBootstrapError` class (engine family, stable name `"StateMappingBootstrapError"`, payload = report per data-model §4/§5), and the pure validator over resolved config + `TeamMetadataCollections[]` snapshot: scope = four identities + lane targets of a non-null map only (`blocked` checked only if configured); exact case-sensitive match; near-match hints; type-category assertions; message renders in ONE pass grouped by team — missing entry paths + intended names, available states as `name (type)` (NEVER ids), case-insensitive hints, missing type categories, and correction steps (edit the named `teams[K].workflowStates.*` key to a listed available name via config file or programmatic overrides, OR create/rename the state in Linear → Team → Workflow, then re-run) plus a pass/fail line for every configured team (contract C4.2–C4.4, FR-009)
- [ ] T014 [US2] Wire the validator into `src/engine/build.ts`: after stage-4 mode selection (`selectMode`, ~line 629) and only when the selected mode is `bootstrap`, validate against the stage-3 `discoverMetadata(Object.keys(config.teams))` snapshot already fetched (~line 625) — zero additional `Linear_Port` calls (contract C4.1/C4.3, research R4)
- [ ] T015 [US2] Wire the bootstrap re-check into `src/engine/apply.ts`: after the pre-mutation snapshot re-fetch (`discoverMetadata`, ~line 579) and BEFORE the first mutation, run the validator when the run is still bootstrap mode (checkpoint absent) — covers plan→apply drift and interrupted-rerun paths; failure leaves no partial state or side effects (contract C4.1/C4.5, FR-010)
- [ ] T016 [P] [US2] Register error names → `ExitCode.CONFIGURATION_ERROR` (3) in `exitCodeForError` in `src/cli/exit-codes.ts`: add `StateMappingBootstrapError` AND the existing `LaneMapError` (today it falls through to exit 1 — adjacent taxonomy gap closed here, research R6); extend `tests/unit/cli-exit-codes.test.ts` to pin both names to 3 (contract C4.6)
- [ ] T017 [US2] Re-export the additive symbols (`StateMappingBootstrapError`, report type, validator) from `src/engine/index.ts` so surfaces and the frozen-surface contract see them

**Checkpoint**: User Stories 1 AND 2 both work independently — default-on is now safe for customized workflows

---

## Phase 5: User Story 3 - Consistent defaults across every supported framework (Priority: P2)

**Goal**: One shared default table serves all 7 framework configurations; checkbox frameworks resolve checked→"Done", unchecked→"Backlog" out of the box; semantically equal task states land on identical Linear states regardless of framework.

**Independent Test**: Configure each framework's adapter with no state-mapping config against default-workflow teams; check a task in each; observe "Done" every time (quickstart V3).

### Tests for User Story 3 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T018 [P] [US3] Create `tests/integration/state-mapping-defaults.test.ts` covering quickstart V3: framework matrix (kiro, spec-kit, open-spec, bmad, spec-superpower, generic) each with a zero-config team row against the fake default-workflow world — a checked task moves the issue to `Done`, an unchecked task resolves `Backlog` (FR-004), and semantically equal states select identical targets across every framework (FR-005, SC-001/SC-006)
- [ ] T019 [P] [US3] Extend `tests/contract/framework-support-consistency.test.ts` to pin contract C1.3/FR-005: no adapter or framework-specific module under `src/` may carry or embed its own workflow-state name default — state moves derive exclusively from `DEFAULT_WORKFLOW_STATE_NAMES`/`DEFAULT_LANE_STATE_MAP`

### Implementation for User Story 3

- [ ] T020 [US3] Extend `tests/unit/engine-completion.test.ts` with per-framework `desiredCompletionStateName` cases resolving `Done`/`Backlog` from the resolved identities (including null-tolerant branches from T005), and fix any `src/` leak the run surfaces where a framework path bypasses the shared table (contract C1.3)

**Checkpoint**: All three shipped stories work independently; mixed-framework repos behave identically

---

## Phase 6: User Story 4 - Existing configuration always wins; opting out stays available (Priority: P3)

**Goal**: Configured entries always beat defaults (byte-identical outcomes for pre-024 full configs); explicit disables — global `stateMappingEnabled: false`, per-team `mappingEnabled: false`, per-team `lanes: null` — restore today's untouched-state posture with clear reporting.

**Independent Test**: Pre-set custom state names and each explicit disable; run syncs and compare against today's behavior (quickstart V2/V5).

### Tests for User Story 4 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T021 [P] [US4] Extend `tests/unit/config-state-mapping-defaults.test.ts` with quickstart V2 precedence cases: configured `done: "Completed"` wins over the default; a partial lane map merges per lane (configured lanes win, absent lanes filled, deterministic — US4-AC3); an operator-authored blank lane value still raises `LaneMapError` (contract C2.4, A-023-0(b) preserved for authored content); `lanes: null` survives the resolution pass as `null`; a full pre-024 explicit config resolves to byte-identical outcomes (SC-005)
- [ ] T022 [P] [US4] Create `tests/integration/state-mapping-disable.test.ts` covering quickstart V5: global `stateMappingEnabled: false` and per-team `workflowStates.mappingEnabled: false` each produce ZERO state operations, add reason label `state-mapping-disabled` to affected units, and are otherwise byte-identical to the pre-024 default-off posture (US4-AC2, contract C3.2); `lanes: null` leaves every lane untouched with `lane-state-unmapped` AND the bootstrap validator skips lane entries for that team (contract C3.3)

### Implementation for User Story 4

- [ ] T023 [US4] Gate the completion and lane decision paths in `src/engine/build.ts` on `stateMappingActive(config, teamKey)`: when inactive, derive NO state change from a checkbox change or lane event (including create-carrier labels) and add the reason label `state-mapping-disabled` to affected plan units (contract C3.2, data-model §6/§7)
- [ ] T024 [US4] Apply the disabled posture on the create path in `src/engine/apply.ts` (create-carrier state labels suppressed when inactive, reason reported) and confirm `resolveLaneState` in `src/engine/completion.ts` returns the untouched/"missing" result for a `null` lanes map (contract C3.2/C3.3)

**Checkpoint**: Each story independently functional; existing adopters fully protected

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Contract snapshots, property/security cross-cutters, governance records, and documentation required by FR-012/C7 in the same change

- [ ] T025 [P] Regenerate `tests/contract/snapshots/frozen-surface.json` for the additive exports (default tables, `stateMappingEnabled`, `mappingEnabled`, `stateMappingActive`, `StateMappingBootstrapError`, report type, validator) and update the exit-code table pin contract test so `StateMappingBootstrapError`/`LaneMapError` ⇒ 3 is asserted; `tests/contract/defaults-scan.test.ts` must pass with the new strings (quickstart V10)
- [ ] T026 [P] Extend `tests/integration/engine-properties.test.ts` with the R9 property cross-cutters: `canonicalizeConfig` determinism across the resolution pass, and repeated bootstrap re-runs over unchanged inputs byte-identical (contract C2.3, Principle IV)
- [ ] T027 [P] Extend `tests/unit/state-validation.test.ts` with the security cross-cutter: every `StateMappingBootstrapError` message and report payload carries no state ids, credentials, or snapshot internals and passes the security screening posture (Principle I, research R9)
- [ ] T028 [P] Amend `.specify/memory/constitution.md` to v1.1.0 (MINOR): Principle III platform-default exception — built-in defaults MAY ship for per-team workflow-state identities when values are the platform's own generic default names and remain overridable per existing precedence; org-literal ban retained verbatim; include the Sync Impact Report header per the amendment procedure and update the version line (research R8, contract C7)
- [ ] T029 [P] Add entries **A-024-0** (default name + lane tables supersede the "NO built-in default ships" clause of A-023-0(b) only), **A-024-1** (`stateMappingEnabled` + per-team `mappingEnabled`), **A-024-2** (bootstrap existence check + `StateMappingBootstrapError` + exit-code registration + resolver null guards) to `docs/contract-amendments.md`
- [ ] T030 Update documentation per FR-012 in the same change: `README.md` and `docs/configuration.md` (new defaults + opt-out), `docs/configuration-reference.md` (routing table + lanes paragraph + "keys that default to absent"; document that `lanes: null` is the disable and — explicitly — `"lanes": {}` is NOT, it deep-merges into all-defaults, research R3), `docs/cli.md` (exit-code narrative incl. new exit-3 names), `CHANGELOG.md` (breaking default-behavior callout: "no lanes configured ⇒ no state moves" now requires the explicit disable); keep `tests/contract/doc-truthfulness.test.ts` green
- [ ] T031 Update pre-existing tests whose fixtures assumed default-OFF mapping or asserted the old "no built-in default exists" wording (audit `tests/unit/config-lanes.test.ts`, `tests/unit/engine-lane-state.test.ts`, `tests/unit/engine-completion.test.ts`, and integration suites driving zero-config lanes, e.g. `tests/integration/engine-spec-kitty-*.test.ts`) to the default-on posture without weakening assertions
- [ ] T032 Run the full quickstart.md validation from repo root: `npm run lint`, `npm run typecheck`, `npm test` — all tiers green incl. the new 024 files, coverage ≥ configured minimum (merge-blocking, Principle VI)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — T004/T005/T006 depend on T002/T003; BLOCKS all user stories
- **User Stories (Phases 3–6)**: All depend on Foundational completion
- **Polish (Phase 7)**: Depends on the delivered stories; T025 additionally depends on T013/T016/T017 (frozen-surface additions) and T028/T029 gate merge per Governance

### User Story Dependencies

- **US1 (P1, Phase 3)**: After Foundational — no dependency on other stories; MVP
- **US2 (P1, Phase 4)**: After Foundational — independent (validates default AND configured names); spec calls it US1's safety counterpart, so ship both for default-on GA
- **US3 (P2, Phase 5)**: After Foundational — extends US1's mechanism but is independently testable via the V3 matrix
- **US4 (P3, Phase 6)**: After Foundational — T021 exercises the same unit file as T007, so schedule after Phase 3 when sequential

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Validator/implementation before surface wiring (T013 → T014/T015)
- Story complete before moving to next priority

### Parallel Opportunities

- T002 ∥ T003 (different files, Foundational)
- T005 ∥ T002/T003 (only T004 needs all three)
- T007 ∥ T008 (US1 tests, different files)
- T010 ∥ T011 ∥ T012 (US2 tests, different files)
- T016 ∥ T013–T015 (US2 impl, different files)
- T018 ∥ T019 (US3 tests)
- T021 ∥ T022 (US4 tests)
- T025 ∥ T026 ∥ T027 ∥ T028 ∥ T029 (Polish, different files)
- After Foundational, US1/US2/US3/US4 can proceed in parallel by different developers (watch the shared-file sequences noted above)

---

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together (they must FAIL first):
Task: "Unit validator semantics in tests/unit/state-validation.test.ts"          # T010
Task: "Integration bootstrap failure/re-run/sync-skip in tests/integration/bootstrap-mapping-validation.test.ts"  # T011
Task: "CLI exit-3 refusal in tests/e2e/cli-bootstrap-refusal.test.ts"            # T012

# Then implement (T013 first), with exit-code registration in parallel:
Task: "Validator + error class in src/engine/state-validation.ts"                # T013
Task: "Exit-code registration in src/cli/exit-codes.ts + tests/unit/cli-exit-codes.test.ts"  # T016
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline gate)
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart V1 + V4 pass independently
5. Ship/demo: zero-config lane propagation

### Incremental Delivery

1. Setup + Foundational → defaults materialize in resolved config
2. Add US1 → V1/V4 green → **MVP: default-on lanes**
3. Add US2 → V6/V7/V9 green → safe for customized workflows (pair US1+US2 before release; FR-008 is a MUST)
4. Add US3 → V3 framework matrix green
5. Add US4 → V2/V5 green → existing adopters protected
6. Polish → V10 + governance + docs (FR-012/C7 land in the same change)

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done: Developer A: US1 → US3; Developer B: US2; Developer C: US4
3. Merge order: Foundational → US1 → US2 → US3 → US4 → Polish (contract snapshot regeneration LAST, after all additive exports)

---

## Notes

- [P] tasks = different files, no dependencies
- Constraints quoted from data-model.md so they are never left to implementation discretion: identity values are non-empty strings; keys restricted to `WORKFLOW_STATE_IDENTITIES ∪ LANE_VOCABULARY`; zero organization-specific literals; `blocked` has NO default entry; `lanes: null` survives the pass; blank authored lane values still raise `LaneMapError`
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: same-file conflicts across parallel tasks (config-state-mapping-defaults.test.ts and build.ts/apply.ts/completion.ts are sequenced deliberately)
