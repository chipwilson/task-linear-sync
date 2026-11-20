---
description: "Task list for feature 021 — Per-Task Splitting of Kiro Implementation-Plan Task Files"
---

# Tasks: Per-Task Splitting of Kiro Implementation-Plan Task Files

**Input**: Design documents from `specs/021-fix-kiro-task-splitting/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/kiro-plan-parsing.md (C1–C9), quickstart.md

**Tests**: REQUIRED. Spec FR-010 and constitution Principle VI (Test-First, NON-NEGOTIABLE) mandate fixture + parser-level + fake-tracker sync-level tests, written to FAIL before implementation. Every acceptance scenario maps to ≥1 automated test (research R9).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths included in each description

**Key invariants for every task** (plan.md + constitution): the fix lives ONLY in the shared built-in defaults/parsing layer (`src/config/defaults.ts`, `src/parsing/content.ts`, `src/parsing/extract.ts`) — **no adapter-row changes under `src/discovery/adapters/`, no changes to `src/parsing/depth.ts` / `src/parsing/extent.ts` / `src/parsing/taskfile.ts` / `src/engine/` / `src/titles/`** (research R4, R7); all existing corpus/golden/world pins stay byte-identical (FR-009/SC-005); zero org literals (Principle III); zero new dependencies.

**Status note**: Amendments A-021-1/2/3 are ALREADY applied to `specs/requirements.md` on this branch (Requirement 2 criteria 2/4/9/13; Requirement 15.4). Tasks below must not re-amend them — only conform to and verify them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The verbatim reproduction fixture every test depends on (FR-010(a)).

- [ ] T001 Create test fixture `tests/fixtures/parsing/kiro-plan/tasks.md` containing the reported file EXACTLY as embedded below (3,665 bytes, 84 lines, **no trailing newline** after the last `_Requirements:` line — byte-exact; source copy at `/tmp/opencode/uploads/af081b02823e6/tasks.md` if still present, otherwise transcribe verbatim from this block). Shape: one `# Implementation Plan` level-1 title heading; thirteen `- [x]` checkbox tasks with local ids `1.`–`10.` plus `4.1`, `4.2`, `4.3` written at the SAME column-0 indentation as their parent `4.`; two-space-indented un-checkboxed detail bullets under most tasks; one italic `_Requirements: …_` line per tasked body; task `4.` has NO body (immediately followed by `4.1`); blank lines separate task blocks.

  ````markdown
  # Implementation Plan

  - [x] 1. Set up project structure and dependencies
    - Create requirements.txt with boto3 and other Python dependencies
    - Set up Python project structure for Lambda development
    - Create directory structure for source code and tests
    - _Requirements: All requirements need proper project setup_

  - [x] 2. Implement configuration management module
    - Create configuration module to read environment variables with defaults
    - Implement validation for configuration values
    - Write unit tests for configuration loading with various scenarios
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 3. Implement logging module
    - Create structured logger with JSON output for CloudWatch
    - Implement different log levels (INFO, WARN, ERROR)
    - Add correlation ID support for request tracing
    - Write unit tests for logging functionality
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4. Implement EC2 service module
  - [x] 4.1 Create EC2 client wrapper with retry logic
    - Implement EC2 client initialization with boto3
    - Add exponential backoff retry logic for throttling using botocore retries
    - Add linear retry logic for network errors
    - Write unit tests with mocked boto3 calls
    - _Requirements: 3.1, 3.3_

  - [x] 4.2 Implement instance discovery functionality
    - Create function to describe instances with specific tags
    - Filter instances by tag key/value from configuration
    - Handle pagination for large instance lists
    - Write unit tests for instance filtering logic
    - _Requirements: 1.1, 1.2, 4.1, 4.2_

  - [x] 4.3 Implement instance shutdown functionality
    - Create function to stop individual EC2 instances
    - Skip instances that are already stopped
    - Handle permission errors gracefully
    - Write unit tests for shutdown operations
    - _Requirements: 1.2, 1.3, 3.2, 3.4_

  - [x] 5. Implement main Lambda handler
    - Create main handler function that orchestrates the shutdown process
    - Integrate configuration, logging, and EC2 service modules
    - Process instances and collect results
    - Generate summary response with statistics
    - Write unit tests for handler orchestration
    - _Requirements: 1.4, 2.5, 3.4_

  - [x] 6. Implement error handling and response formatting
    - Add top-level error handling in Lambda handler
    - Format Lambda response according to design specifications
    - Ensure partial failures don't stop entire process
    - Write unit tests for error scenarios
    - _Requirements: 3.2, 3.4_

  - [x] 7. Create IAM policy and deployment configuration
    - Write IAM policy JSON with minimal required permissions
    - Create AWS SAM or CloudFormation template for deployment
    - Configure Lambda function settings (memory, timeout, environment variables)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 8. Write integration tests
    - Create integration tests that work with real AWS services
    - Test various EC2 instance states and tag combinations
    - Verify IAM permissions work correctly
    - Test Lambda function end-to-end in test environment
    - _Requirements: All requirements need integration testing_

  - [x] 9. Add comprehensive error handling tests
    - Write tests for AWS API throttling scenarios
    - Test network failure and retry behavior
    - Test permission error handling
    - Verify logging output for all error conditions
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 10. Create deployment and monitoring setup
    - Write deployment scripts or CI/CD configuration
    - Set up CloudWatch alarms for function monitoring
    - Create custom metrics for instances processed and stopped
    - Document deployment and operational procedures
    - _Requirements: 2.5 (for monitoring), 5.4 (for security)_
  ````

  Note: the 4-space-indented bullets shown above are the fixture's real two-space indent plus this document's code-block nesting — strip 2 leading columns when transcribing; verify against the upload byte-for-byte (3,665 bytes) if available.

**Checkpoint**: Fixture exists; parsing it at default settings today yields 1 task + 13 `depth-folded` exclusions (pre-fix baseline, quickstart.md).

---

## Phase 2: Foundational (Shared Default Grammar — A-021-2 / contracts C6–C7)

**Purpose**: The two grammar-constant changes shared by all five default-grammar adapters (kiro, generic, spec-kit, bmad, open-spec). They serve every story (US1 titles/ids, US2 id capture, US3 seed quality) and MUST land test-first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 [P] Write FAILING unit tests in `tests/unit/parsing-local-id-span.test.ts` for the A-021-2/C6/C7 identifier matrix (research R6, data-model §4). Cases, quoting data-model constraints verbatim: (a) checklist line `- [x] 4.1 Create EC2 client wrapper with retry logic` → `Local_Task_ID` `4.1` captured **separator-free**, title `Create EC2 client wrapper with retry logic` ("dotted-numeric capture requires whitespace + text after the id"); (b) `- [x] 1. Set up …` → id `1` unchanged ("bare integers still require a trailing separator" `.`/`:`/`—`/`–`/`-`); (c) `- [ ] 2 of 3 done` → NO id (not dotted-numeric); (d) heading `# Implementation Plan` → **no id** and title `Implementation Plan` ("word-form ids MUST contain at least one digit"); (e) `# TASK-1: Boot`, `## SYNC1: Boot`, `FOUND-1`, `ACME-2`, `T001`-style ids still capture (unchanged); (f) dotted-numeric multi-level `1.2.3` whitespace capture; (g) `Task 2.1: …` / `1.2.3: …` separator spans unchanged; (h) adapter-supplied `checklistIdPattern` keeps precedence over the built-in span (V9 — spec-kitty). Run `npm run build && npm run test:unit` and confirm these new tests FAIL while existing ones pass.
- [ ] T003 Amend `headingIdGrammar` in `src/config/defaults.ts:50`: change the word-form id branch `[A-Za-z][A-Za-z0-9-]*\d*` to require a digit, e.g. `[A-Za-z][A-Za-z0-9]*-?\d[A-Za-z0-9-]*` (research R4.1). Keep the numeric/dotted-numeric branch `[0-9]+(?:\.[0-9]+)*` and the catch-all title group `(?<title>.+)` UNCHANGED — id-less headings remain heading tasks (corpus model, FR-009).
- [ ] T004 Amend `LOCAL_ID_SPAN_RE` in `src/parsing/content.ts:167`: add a dotted-numeric alternative capturable with whitespace only — `[0-9]+(?:\.[0-9]+)+[ \t]+` (research R4.2) — while bare-integer ids keep requiring the existing trailing separator `.:—–-`. Verify `stripLeadingLocalId` stores the dotted id separator-free and the title is the remainder (V8: "the rendered line preserves the original text" — re-verify the Requirement 3 criterion 1 round-trip).
- [ ] T005 Re-run the pinned suites and confirm byte-identical outcomes (R8 sweep for the grammar changes): `npm run test:unit tests…` scope = `tests/unit/parsing-identity.test.ts` (kiro seed values), `tests/contract/parsing-golden.test.ts` goldens under `tests/fixtures/parsing/golden/**`, `tests/unit/parsing-roundtrip.test.ts`, `tests/integration/parsing-corpus.test.ts`. All must pass UNCHANGED; if any golden/seed shifts, the grammar edit over-reached — fix the regex, not the pin.

**Checkpoint**: Grammar ready — `4.1` ids capture, `Implementation` no longer an id; T002 tests green, pins byte-identical.

---

## Phase 3: User Story 1 - Kiro implementation plan syncs as one issue per task (Priority: P1) 🎯 MVP

**Goal**: Parsing the reported shape at DEFAULT settings yields thirteen individual depth-1 checklist tasks (plus the title-heading task with only its preamble), instead of one catch-all task carrying the whole file.

**Independent Test**: Parse `tests/fixtures/parsing/kiro-plan/tasks.md` at default config and sync it against the fake `Linear_Port`; count created issues (14) and check titles/descriptions — no other behavior needed (spec US1).

### Tests for User Story 1 (write FIRST — must FAIL before T008) ⚠️

- [ ] T006 [P] [US1] Write `tests/unit/parsing-kiro-plan.test.ts` (research R9.2; follow the parse-seam conventions of `tests/integration/parsing-corpus.test.ts` but use the **default** config — NO `maxTaskIssueDepth` override, which is what the corpus pin never exercised). Parse the T001 fixture twice: under the kiro adapter with virtual path `.kiro/specs/auth/tasks.md` and under the generic adapter with virtual path `docs/auth/tasks.md`. Assert (C8 parity, FR-008): identical results for both; 14 task drafts = 13 checklist tasks (kind `checklist`, depth 1, `parent` null) + 1 heading task; local ids exactly `1`,`2`,`3`,`4`,`4.1`,`4.2`,`4.3`,`5`,`6`,`7`,`8`,`9`,`10`; titles are each task's own line text with the id stripped (e.g. `Create EC2 client wrapper with retry logic`); `checked` is `true` for all thirteen; **zero** `depth-folded` exclusions (C5); the title-heading draft has no `Local_Task_ID` and title `Implementation Plan` (NOT `Plan` — spec edge case); feature name `auth`.
- [ ] T007 [P] [US1] Write `tests/unit/parsing-title-heading.test.ts` — the C1/C2/C3 rule matrix (research R5, data-model §1 V1–V3): (a) first-line level-1 id-less heading = document-title heading → column-0 orphan checkboxes beneath it attach to NO heading (parent `null`, depth 1); (b) V1: first line `# Task 1: Do thing` (yields a `Local_Task_ID`) is a NORMAL heading task — orphans still adopt it; (c) a level-2 first heading (`## Scope`) is not a title heading — unchanged adoption; (d) a level-1 heading mid-file is not a title heading; (e) V2: `#` inside a code fence never qualifies; (f) V3: checkbox-only file has no title heading (unchanged flat behavior); (g) heading-only file (title + prose, zero checkboxes) — heading task's body bounded by EOF as today; (h) mixed shape: checkbox tasks before the first `##` heading AND heading tasks after it all surface; (i) 100+ checkbox tasks all surface, no truncation (spec edge case); (j) dead-flag disposition (C3): the internal `flatDocument` signal in `src/parsing/extract.ts` either equals the new determination or is removed — assert the determination table of data-model §2 ("Only grammar-matching heading is the Document_Title_Heading → flat = true").

### Implementation for User Story 1

- [ ] T008 [US1] Implement the document-title-heading rule in `src/parsing/extract.ts` (C1/C2/C3; amendments A-021-1/A-021-3). Detect the title heading per data-model §1 — verbatim conditions: "The document's first non-blank, non-fenced line", "ATX level exactly 1", "Matches the effective heading-id grammar", "Its title span yields no `Local_Task_ID`", "At most one per document". At the orphan-adoption site (`extract.ts:181-182`, `const parent = stack[stack.length - 1] ?? currentHeading;`) skip `currentHeading` adoption exactly when it is the document-title heading → parent `null` → depth 1; ALL other orphan adoption unchanged (`## 9.0:`-style level-2 organizer headings still adopt). Repoint `detectFlatDocument` (`extract.ts:79-93`) so `flatDocument` equals the new determination per data-model §2, or remove the flag as an internal detail (no public API change). Do NOT touch `depth.ts`, `extent.ts`, or `taskfile.ts` (R7: extents re-bound automatically once checkbox tasks survive).
- [ ] T009 [US1] Make T006/T007 pass, then re-run the near pins UNCHANGED: `tests/integration/parsing-corpus.test.ts`, `tests/unit/parsing-depth-fold.test.ts`, `tests/unit/parsing-extract.test.ts`, `tests/unit/parsing-extent.test.ts`. Confirm the corpus `# Tasks` heading stays a heading task with extent [1,3] (R5 consequence: it is a title heading but the corpus fixture has no column-0 checkboxes before the first `##`, so the pinned outcome is preserved).

### Sync-level proof for User Story 1

- [ ] T010 [US1] Create engine world fixture `tests/fixtures/engine/worlds/kiro-plan-basic/`: `world.json` modeled on `tests/fixtures/engine/worlds/spec-kitty-basic/world.json` (name `kiro-plan-basic`, fixed clock, placeholder-only `TEAM-A` team/project/workflowStates with `ac000000-…` placeholder UUIDs — zero real org identifiers, `confirmationKey: "SYNC"`, `descriptionNormalizationProfile: "default"`, `issues: []`); `repo/.kiro/specs/auth/tasks.md` = byte-copy of the T001 fixture; `README.md` describing the scenario (the reported bug's shape at shipped defaults).
- [ ] T011 [US1] Write `tests/integration/engine-kiro-plan-world.test.ts` driving the fake-`Linear_Port` seams (`buildWorld`/`attachEngine`/`callsOf` from `tests/helpers/engine-harness.js`, `buildSyncPlan` → `applySyncPlan`, following `tests/integration/engine-spec-kitty-world.test.ts` conventions). Assert (C4, spec US1 AC1/AC2, quickstart item 2): first plan+apply creates exactly **14** issues (13 task issues + the `Implementation Plan` title-heading issue); every task-issue title is its own line text with the feature prefix (e.g. `auth: Create EC2 client wrapper with retry logic`); NO issue is titled `Plan`; **no created description contains the full file or any other task's line/detail bullet/_Requirements_ note** — this is the reported bug's regression assertion; the title-heading issue's description is empty/preamble-only. This test FAILS before T008 lands.

**Checkpoint**: US1 fully functional — reported shape syncs as one issue per task at out-of-the-box settings, verifiable alone.

---

## Phase 4: User Story 2 - Each issue carries exactly its own task's details (Priority: P2)

**Goal**: Every task's `Task_Body`/issue description spans only its own region — its detail bullets and `_Requirements:` line — bounded by the next task line or heading; a body-less task yields an empty description.

**Independent Test**: For each of the thirteen tasks, compare the created issue's description against the file region from that task's line up to the next task line, modulo the `default` description normalization profile (spec US2).

### Implementation for User Story 2 (tests first; no new source code expected — R7: extent/engine inherit corrected regions)

- [ ] T012 [US2] Extend `tests/unit/parsing-kiro-plan.test.ts` with region assertions (C4, quoted verbatim: "Each surviving task's `Task_Body` spans its own line to the next task line or heading (exclusive), including its own indented detail bullets and annotation lines; a task immediately followed by another task line has an empty body"): task `1.` body = its 4 bullet lines incl. `_Requirements: All requirements need proper project setup_`; task `4.` body EMPTY (immediately followed by `4.1`); task `4.3` body ends before the blank line preceding `- [x] 5.`; no task body contains another task's id, title text, bullets, or `_Requirements:` note (V5: detail bullets and italic annotation lines are content, never tasks, never boundaries).
- [ ] T013 [US2] Extend `tests/integration/engine-kiro-plan-world.test.ts`: each created issue's description EQUALS its own task region modulo the `default` `Description_Normalization_Profile` (trailing whitespace / blank-line runs / line-ending style insignificant); the body-less `4.` issue has an EMPTY description; 0 descriptions span more than one task's region and 0 contain the full file (SC-002).
- [ ] T014 [US2] Run `npm run test:unit && npm run test:integration` — all green. Verify via `git diff --stat` that NO file under `src/engine/`, `src/parsing/extent.ts`, `src/parsing/taskfile.ts`, or `src/titles/` changed (R7 consequence trace: they inherit corrected regions without edits).

**Checkpoint**: US1 AND US2 both work independently — correct split AND correct content.

---

## Phase 5: User Story 3 - Repeat syncs stay idempotent for split tasks (Priority: P2)

**Goal**: Re-runs match the same thirteen task issues (no duplicates/orphans); an unchanged re-run is zero-action; a checkbox toggle touches exactly one issue; durable identity seeds follow Requirement 2 (prefer `Local_Task_ID`, exclude checkbox state).

**Independent Test**: Apply twice with no file changes (expect zero actions), then toggle one task's checkbox and re-apply (expect exactly that task's issue updated, no creates/deletes) (spec US3).

### Implementation for User Story 3 (tests first; engine idempotency machinery is unchanged)

- [ ] T015 [US3] Extend `tests/integration/engine-kiro-plan-world.test.ts`: (a) re-plan immediately after apply → **0 actions** (SC-003, FR-007); (b) flip exactly one fixture task's `- [x]` → `- [ ]` in the world repo (e.g. task `9.`), re-plan + apply → exactly **1 update** (that task's issue reflects the completion change), 0 creates, 0 deletes, no other issue touched (US3 AC2); (c) `rollbackRun` restores the repo file bytes to the pre-apply state (world README convention).
- [ ] T016 [US3] Assert identity posture: in `tests/unit/parsing-kiro-plan.test.ts` (or a focused case in `tests/unit/parsing-identity.test.ts` if conventions demand a new case there) verify `Stable_UUID` seeds for split tasks prefer `Local_Task_ID` — `4.1`–`4.3` now seed with their dotted ids instead of ordinal fallback (data-model §3; intended seed change per R7 identity row) — and that `checked` state is excluded from seeds so the T015 toggle cannot re-key identity (V4). Document-no-code note: the quickstart.md "Fix-run identity note" already covers first-post-fix-run behavior (old giant `Plan` issue stops matching; delete manually or via stale-issue report) — confirm it needs no edit.

**Checkpoint**: Split tasks are identity-stable across runs — no duplicates, no oscillation.

---

## Phase 6: User Story 4 - No regressions for other file shapes or intentional folding (Priority: P3)

**Goal**: Heading-driven files, heading-less flat checklists, intentional flat-board folding under real id-bearing task headings, and the immune adapters (spec-kitty, spec-superpower) are provably untouched; the whole existing suite passes with unchanged expectations.

**Independent Test**: Run the complete existing automated test suite; every previously passing test still passes and file-shape fixtures parse identically before and after the change (spec US4).

### Implementation for User Story 4

- [ ] T017 [US4] Run the FULL suite with unchanged expectations — `npm run test:unit && npm run test:contract && npm run test:integration && npm run test:e2e` — and confirm via `git diff` that NONE of these pins was edited: `tests/integration/parsing-corpus.test.ts`, `tests/contract/parsing-golden.test.ts` + `tests/fixtures/parsing/golden/**`, `tests/integration/depth-folding-flat.test.ts` / `depth-folding-two-level.test.ts` / `depth-folding-tightened.test.ts` + their worlds under `tests/fixtures/engine/worlds/` (the `## 9.0:` orphan fold survives — US4 AC2), `tests/e2e/cli-depth-folding.test.ts`, `tests/integration/engine-spec-kitty-world.test.ts` + `tests/fixtures/engine/worlds/spec-kitty-basic/**`, spec-superpower suites (`tests/unit/parsing-spec-superpower.test.ts`, `tests/unit/parsing-spec-superpower-identity.test.ts`, `tests/unit/discovery-adapters-spec-superpower.test.ts`, `tests/integration/discovery-spec-superpower.test.ts`), and the discovery suites.
- [ ] T018 [P] [US4] Add the C9 immunity pins in new file `tests/unit/parsing-adapter-immunity.test.ts` (research R3 "none; add immunity pin" rows): parse the T001 fixture content through the **spec-kitty** effective grammars (heading grammar `"(?!"` never matches → zero heading tasks, every top-level checkbox a parentless depth-1 task with its own dotted-id capture from the adapter `checklistIdPattern`) and through the **spec-superpower** grammar (`Task N:` only → `# Implementation Plan` is NOT a heading task; a heading-less checkbox-only plan yields zero tasks, never a giant one; `Task N:` headings bound each other) and assert both outcomes equal today's behavior; plus: a heading-less flat checklist file (pattern after `tests/fixtures/parsing/flat-noheadings.md`) still yields one task per checkbox unchanged (spec edge case 1).
- [ ] T019 [US4] Confirm scope discipline (FR-008, R3 "No adapter row is edited"): `git diff --name-only` lists NO file under `src/discovery/adapters/`, and the kiro-vs-generic parity assertion from T006 passed; classification is irrelevant to the corrected behavior.

**Checkpoint**: Existing users of every other shape see byte-identical behavior; immunity of the two structurally immune adapters is pinned by tests.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation duty (constitution Development Workflow — docs updated in the SAME change) and final gate validation.

- [ ] T020 [P] Update `README.md`: Kiro section + heading/depth-grammar notes describing the corrected defaults — document-title heading rule (level-1 first-line id-less heading never owns other tasks' content), word-form ids must contain a digit, dotted-numeric checklist ids (`4.1`) captured without trailing separator, flat-checklist trigger disregards the title heading. Placeholder identifiers only.
- [ ] T021 [P] Update `docs/framework-adapters.md`: shared built-in default grammars consumed by kiro/generic/spec-kit/bmad/open-spec; the A-021-1/2/3 behaviors; explicit note that spec-kitty and spec-superpower override rows are unchanged and immune (pinned by `tests/unit/parsing-adapter-immunity.test.ts`).
- [ ] T022 [P] Update `docs/configuration-reference.md`: the amended default values — heading grammar word-form branch (digit required), flat-checklist detection default (title heading disregarded), `checklistIdPattern` built-in span (dotted-numeric without trailing separator); keep text consistent with `tests/contract/doc-truthfulness.test.ts` expectations.
- [ ] T023 Run the full quickstart.md validation (exit criteria): `npm run test:unit && npm run test:integration && npm run test:contract && npm run test:e2e && npm run lint && npm run type-check && npm run build`; coverage at or above the configured threshold; confirm the four quickstart "Expected outcomes" hold (14 tasks at defaults; world creates 14 / 0 re-plan / 1 toggle-update; no issue titled `Plan`; pins unchanged).
- [ ] T024 Traceability + truthfulness audit: build the FR-010 mapping (every acceptance scenario US1–US4 ↔ ≥1 automated test among T002/T006/T007/T011/T012/T013/T015/T018) and record it in the PR description; verify `specs/requirements.md` A-021-1/2/3 wording (Requirement 2 criteria 2/4/9/13, Requirement 15.4) matches the implemented behavior exactly; confirm `tests/contract/doc-truthfulness.test.ts` and the defaults-scan contract tests (`tests/contract/defaults-scan*.test.ts`) pass — zero org literals in the new grammar/docs (Principle III).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (T001).
- **Foundational (Phase 2)**: Depends on T001 (T002's dotted-id cases reuse the fixture shapes) — **BLOCKS all user stories** (grammar constants underpin ids/titles for US1–US3).
- **User Stories (Phase 3+)**: All depend on Phase 2 completion.
  - **US1 (Phase 3)**: The core fix (T008) lives here; US2/US3 test extensions consume its artifacts.
  - **US2 (Phase 4)**: Extends the files US1 created (T012 extends T006's file; T013 extends T011's file) — sequential after US1, no new source code.
  - **US3 (Phase 5)**: Extends the same two files after US2 — sequential.
  - **US4 (Phase 6)**: Independent of US2/US3 content; T017/T019 need only T008+Phase 2, T018 needs only T001 — can run in parallel with US2/US3 by another worker once US1 is in.
- **Polish (Phase 7)**: Depends on all desired stories; docs (T020–T022) can start once T008 + Phase 2 are final.

### Within Each User Story

- Tests written FIRST and observed FAILING before the implementation task (Principle VI).
- Extraction rule (T008) before engine proof (T011); file extensions strictly US1 → US2 → US3 on shared test files (no same-file parallelism).

### Parallel Opportunities

- T002 ∥ (none in Phase 2 — T003/T004 touch different files but T002's failing-test baseline covers both; run T003+T004 together after T002).
- T006 ∥ T007 (different files, same prerequisites).
- T010 ∥ T006/T007 (fixture vs tests, different files).
- Phase 6 (T017/T018/T019) ∥ Phases 4–5, once T008 lands (different files).
- T020 ∥ T021 ∥ T022 (three separate doc files).
- After Phase 2, different team members can staff US1 while another pre-writes US4 pins (T018 needs only T001).

### Sequential Hot Spots (do NOT parallelize)

- `tests/unit/parsing-kiro-plan.test.ts` (T006 → T012 → T016) and `tests/integration/engine-kiro-plan-world.test.ts` (T011 → T013 → T015) are extended across stories — order strictly by phase.
- T008 must land after T006/T007 are written (red) and before any green-run checkpoint.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 checkpoint, write both failing unit tests together (different files):
Task: "Unit tests for reported shape at defaults in tests/unit/parsing-kiro-plan.test.ts"
Task: "Unit tests for title-heading rule matrix in tests/unit/parsing-title-heading.test.ts"
Task: "Engine world fixture in tests/fixtures/engine/worlds/kiro-plan-basic/"  # T010 also independent

# Then a single implementation task (T008) turns them green; verify with:
npm run build && npm run test:unit && npm run test:integration
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: fixture (T001).
2. Phase 2: grammar amendments test-first (T002–T005) — CRITICAL gate.
3. Phase 3: failing parser tests (T006–T007) → extraction fix (T008) → pins re-verify (T009) → world + engine proof (T010–T011).
4. **STOP and VALIDATE**: parse/sync the fixture at defaults alone — 14 issues, per-task titles, no whole-file description. That already resolves the reported defect.

### Incremental Delivery

1. Setup + Foundational → shared grammar corrected for all five default adapters.
2. + US1 → reported bug fixed end-to-end (MVP; shippable with docs T020–T022 ideally bundled per the documentation duty).
3. + US2 → region/description correctness asserted per issue.
4. + US3 → idempotency and toggle precision proven.
5. + US4 → immunity + full-corpus regression proof.
6. + Polish → docs in the same change, full merge-blocking gate run (T023), traceability audit (T024).

---

## Notes

- [P] tasks = different files, no dependencies; never mark two tasks [P] that touch the same test file.
- Never "fix" a pin: `parsing-corpus`, goldens, depth-folding worlds, spec-kitty/spec-superpower suites, and discovery suites are byte-frozen (FR-009/SC-005). A pin failing means the change over-reached.
- No adapter rows, no `depth.ts`/`extent.ts`/`taskfile.ts`/engine/titles edits — see research R7 trace table before questioning this.
- Tests run against the fake `Linear_Port` only: zero real Linear access, zero credentials, hermetic (Principles I/V/VI).
- Commit after each task or logical group; commit messages carry no self-attribution trailers (repo AGENTS.md).
- Checkpoints are validation points: stop at any of them to independently verify the story delivered so far.
