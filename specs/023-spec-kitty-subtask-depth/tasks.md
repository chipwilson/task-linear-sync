---
description: "Task list for feature 023 — Spec Kitty Sub-Task Depth & Front-Matter Fidelity (v0.7.0 release)"
---

# Tasks: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Input**: Design documents from `specs/023-spec-kitty-subtask-depth/`

**Prerequisites**: plan.md, spec.md (US1–US4, FR-001…FR-016, SC-001…SC-007), research.md (R1–R8), data-model.md (§1–§5), contracts/spec-kitty-subtask-status.md (C0–C9), quickstart.md

**Tests**: REQUIRED. Constitution Principle VI (Test-First, NON-NEGOTIABLE): every FR/SC maps to ≥1 automated suite per quickstart.md; failing tests are written before the implementation they cover.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = two-level promotion; US2 = flat default; US3 = event-log status; US4 = naming & artifact hygiene
- Exact file paths included in each description

**Branch discipline**: ALL work happens on branch `023-spec-kitty-subtask-depth`. Commit messages carry NO `Co-Authored-By` / "Generated with" / self-attribution trailers (repo AGENTS.md).

**Key invariants for every task** (plan.md + constitution):

- Zero new runtime deps; no YAML/JSONL libraries — `scanFrontMatter` stays a line parser; status lines are per-line `JSON.parse` skip-and-report.
- The two-level model is INERT for every other identity: `promotedRanges` slicing applies ONLY to `kind === "document"` tasks with non-empty ranges; never "fix" a foreign identity's fixture — a byte-pin failing on the other six identities (FR-013/SC-006) means over-reach.
- Frozen-contract changes ride ONLY the amendment channel: A-023-0…A-023-3, each landed with contract-doc edit + module change + regenerated `tests/contract/snapshots/frozen-surface.json` in the SAME change (three-artifact rule).
- Seed rule is frozen: `taskStableSeed` 3-part layout (`domain/task.ts:98-104`); child composition `${wpId}\u0000${subtaskId}` goes in the third slot per the `composeSeedLocalTaskId` precedent (`src/parsing/taskfile.ts:57-65`); `identity.ts` join is never re-implemented.
- Nine-lane vocabulary verbatim: `planned, claimed, in_progress, for_review, in_review, approved, done, blocked, canceled` — `genesis` and anything else is known-unmapped (untouched state + reported).
- Status is NEVER mirrored text: no status block, no raw `---` front-matter region in any title/description; repository files receive zero write-back at both levels.
- Lane→state has NO built-in default (consumer-required class like `workflowStates`); absent/unmapped ⇒ untouched + finding.
- Tests are hermetic: fake `Linear_Port`, engine worlds, no network, no upstream clone, no credentials.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify branch state and build the shared fixtures every story's tests consume.

- [ ] T001 Verify HEAD is on `023-spec-kitty-subtask-depth` and the working tree is clean with all design artifacts of `specs/023-spec-kitty-subtask-depth/` committed (spec/plan/research/data-model/quickstart/contracts/checklists); if anything is untracked, commit it with message `docs(023): design artifacts`. No self-attribution trailers.

- [ ] T002 [P] REWORK the parsing corpus `tests/fixtures/parsing/frameworks/spec-kitty/` to the 023 shapes (research R8, data-model §1): keep `kitty-specs/001-corpus/tasks.md` roll-up; `tasks/WP01-auth.md` = full WP document with front matter (`work_package_id: WP01`, `title: Auth`, `lane: in_progress`, block-list roster `subtasks:` → `- T001`/`- T002`, plus `dependencies: [WP00]`, `assignee`, `review_status`) and body containing `## Objectives & Success Criteria`, anchors `### Subtask T001 – Implement validator CLI` (en dash) and `### Subtask T002 – Add pytest coverage` with step guidance and `#### Subtask T001: Auth ✅` RESTATED after a `## Activity Log` heading, plus a roster-only id `T099` (no anchor) and a `## Review Report` section; `tasks/WP02-flow.md` with FLOW-form roster `subtasks: [T003, T004]` and checklist-style anchors `- [ ] T003: Open the flow` / `- [ ] T004: Persist state`; `tasks/WP03-noanchors.md` (roster only, no anchors); `tasks/README.md` (no id — claimed, 0 tasks); legacy variant `tasks/planned/WP04-legacy.md`; artifact sub-folder `tasks/WP01-auth/review-cycle-1.md` stamped with DUPLICATED front matter `work_package_id: WP01` (FR-015 proof); mission files `meta.json`, `wps.yaml`, `status.json`, and `status.events.jsonl` whose lines MIX shapes (envelope `WPCreated`, flat `{"wp_id":"WP01","from_lane":"genesis","to_lane":"planned",...}` then a later flat line `"to_lane":"in_progress"`, an annotation `{"kind":"annotation","wp_id":"WP01"}`, and one malformed line). Hermetic, placeholder-only, deterministic.

- [ ] T003 [P] Create engine world `tests/fixtures/engine/worlds/spec-kitty-two-level/` (schema per `tests/helpers/engine-harness.ts` header): `repo/kitty-specs/002-auth-system/tasks/WP01-setup.md` with anchors T001–T004 and `WP02-oauth.md` with anchors T005–T007 (rosters + `### Subtask Tnnn – Title` anchors; Activity-Log restatement in WP01; unanchored roster id `T099` in WP02); `world.json` config pins `maxTaskIssueDepth: 2`, routing team acme with `workflowStates` but NO `lanes` map, `metadata.scenario` describing SC-001 expectations; `README.md` header note.

- [ ] T004 [P] Create engine world `tests/fixtures/engine/worlds/spec-kitty-event-status/`: single mission `002-auth-system` with WP01/WP02/WP03 documents; `status.events.jsonl` — WP02 last lane `in_progress` (preceded by older `planned`, mixed with envelopes/annotations and one malformed line), WP01 NO lane events, WP03 last lane `canceled`; `status.json` and all front matter deliberately say `planned` (contradiction fixture); `world.json` teams configure `workflowStates.lanes: { in_progress: "Doing", done: "Done" }` (no `canceled` entry) with matching `teams[].workflowStates` states Backlog/Todo/Doing/Done, seeded issue for WP02 sitting in Backlog with durable attachment; `README.md`.

- [ ] T005 [P] Create engine world `tests/fixtures/engine/worlds/spec-kitty-artifact-folders/`: missions `042-auth-system` (numeric prefix), `auth-system-01KQ2VNJ` (ULID suffix), `bare-slug-mission` — each with roll-up `tasks.md`, `wps.yaml`, `status.json`, `status.events.jsonl`, canonical `tasks/WP01-*.md` documents, per-WP artifact sub-folders `tasks/WP01-x/review-cycle-1.md` + `reviewer-feedback-cycle-1.md` DUPLICATING the canonical `work_package_id`, and `tasks/README.md`; `world.json` at default depth; `README.md` citing SC-007/FR-015.

**Checkpoint**: Fixtures ready — all story phases can start test-first against real shapes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Frozen-domain amendments, member threading, and shared parser primitives.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 A-023-0(a) (002 frozen): add optional `promotedRanges?: ReadonlyArray<readonly [number, number]>` (INCLUSIVE line spans) to `TaskBodyExtent` in `src/domain/task.ts`; amend `specs/002-core-domain-contracts/contracts/task-model.md`; regenerate `tests/contract/snapshots/frozen-surface.json`; add a unit pin in `tests/unit/domain-task.test.ts` that absence renders identically. Three-artifact rule in ONE commit.

- [ ] T007 A-023-0(b) (002 frozen): add optional `lanes?: Readonly<Record<string, string>>` to `WorkflowStateIdentities` in `src/domain/routing.ts`; enforce at config load (`src/config/schema.ts`, `src/config/validate.ts`): keys MUST be within the nine-lane vocabulary `planned|claimed|in_progress|for_review|in_review|approved|done|blocked|canceled`, values MUST be non-empty strings, failure names the offending team key, NO built-in default ships; amend `specs/002-core-domain-contracts/contracts/` routing contract; regenerate the frozen-surface snapshot; unit tests in `tests/unit/config-lanes.test.ts` (malformed key/value rejection, absent map passes).

- [ ] T008 A-023-1 (003 discovery): thread optional `statusEventFileName?: string` through the adapter surface — `FrameworkAdapter` + `AdapterConventions` whitelist + `CustomAdapterDescriptor` in `src/discovery/adapter.ts`, materialize in `defineFrameworkAdapter` and pass-through in `customDescriptorConventions` (`src/discovery/conventions.ts`); set built-in `"status.events.jsonl"` on the spec-kitty row `src/discovery/adapters/spec-kitty.ts`; amend `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` + `docs/framework-adapters.md`; update the whitelist gate `tests/contract/discovery-surface.test.ts`. ONE commit.

- [ ] T009 A-023-2 (004 parsing, primitives): extend `ExclusionRecord` kind union with `"subtask"` in `src/parsing/extract.ts` (reasons reuse `"depth-folded"`, add `"subtask-no-anchor"`); widen `scanFrontMatter` in `src/parsing/document.ts` to capture single-level list values (block `- T001` lines under a top-level key AND flow `[T001, T002]`) as `string[]` while scalar capture stays byte-identical; declare optional `subtaskRule?: { rosterKey; anchorPattern; anchorRegionStopPattern }` inside `DocumentTaskRule`; extend `src/parsing/adapter.ts` whitelist so `subtaskRule` reaches the parser; unit tests in `tests/unit/parsing-document-frontmatter.test.ts` (both roster forms, nested/other lists still ignored, scalars unchanged).

**Checkpoint**: Domain + parser primitives in place; every other identity byte-identical (run contract tier).

---

## Phase 3: User Story 1 - Subtasks become Linear sub-issues on a two-level board (Priority: P1) 🎯 MVP

**Goal**: At `maxTaskIssueDepth ≥ 2`, each promotable subtask becomes exactly one child task (kind `document`) parented to its work-package task, with de-duplicated parent content (FR-002…FR-006, FR-011).

**Independent Test**: World `spec-kitty-two-level` (quickstart scenario 2): 2 parents + 7 children, correct `parentId` links, child bodies = their sections, parent bodies without promoted spans, `T099` excluded — zero empty issues.

### Tests for User Story 1 ⚠️ (write FIRST, ensure they FAIL)

- [ ] T010 [P] [US1] Unit tests in `tests/unit/parsing-spec-kitty-subtasks.test.ts` over the corpus (T002): roster ∪ anchors derivation; anchor grammar matches `### Subtask T001 – Title` (en/em dash/colon/hyphen separators) and `- [ ] T003: …` checklist lines, does NOT match cross-references ("depends on T001 implementation"); anchor region stops at `## Activity Log`/`## Review Report` so restatements are never anchors; child title = text after token, fallback readable token form; section extent = anchor line .. next same-or-shallower heading/next anchor/region end; duplicate `T004` anchors INSIDE the region produce two drafts with IDENTICAL seed inputs.

- [ ] T011 [P] [US1] Integration test `tests/integration/engine-spec-kitty-two-level.test.ts` driving world T003: assert plan = 2 document parents + 7 document children; every child `Task.parentUuid` = owning WP task uuid and parent `childUuids` in source order; child seed layout is `spec-kitty\0002-auth-system\0WP01\0T001` (frozen 3-part `taskStableSeed`, NUL in third slot); apply creates parent-before-child with `CreateIssueInput.parentId` set and child descriptions equal their section text; parent description excludes every promoted span but still contains the Activity-Log restatement; `T099` roster-only id excluded with reason `subtask-no-anchor`.

### Implementation for User Story 1

- [ ] T012 [US1] Implement subtask derivation in `src/parsing/document.ts`: `deriveDocumentTask` widens to return the parent draft plus child drafts per contract C2 (anchor scan inside the region, roster union via `subtaskRule.rosterKey`, section extents, `promotedRanges` on the parent draft); the pre-023 single-draft path stays byte-identical when `subtaskRule` is absent (inert for custom adapters).

- [ ] T013 [US1] Wire the document branch of `src/parsing/taskfile.ts` (the 91-131 lane): materialize child `Task` entries (`kind: "document"`, `localTaskId` = normalized `T\d+` token, seed third slot `${wpId}\u0000${subtaskId}` per the compose-slot precedent), set `parentUuid`/`childUuids` (extraction-branch pattern at lines 175/187-193), run children through `foldDraftsOverCap` (`src/parsing/depth.ts`) BEFORE extent/mirror work, emit `ExclusionRecord` kind `subtask` for no-anchor roster entries.

- [ ] T014 [US1] Document-kind mirror slice: in `src/engine/build.ts` `mirrorRegion` (214-223) and its verbatim twin `src/engine/apply.ts` (617-624), exclude `taskBody.promotedRanges` spans when `kind === "document"` and ranges are non-empty; every other kind and empty-range case keeps the contiguous slice byte-for-byte (FR-013).

- [ ] T015 [US1] Set the built-in `subtaskRule` values on `src/discovery/adapters/spec-kitty.ts` VERBATIM per data-model §3: `rosterKey: "subtasks"`; `anchorPattern: ^(?:[-*+] \[[ xX]\] |#{1,6} )[ \t]*(?:Subtask[ \t]+)?(T\d+)\b[ \t]*[:–—-]?[ \t]*(.*)$`; `anchorRegionStopPattern: ^#{1,6}[ \t]+(Activity Log|Review Report)[ \t]*$`.

- [ ] T016 [US1] Run T010/T011 to green plus the duplicate-anchor refusal probe: extend `tests/integration/engine-spec-kitty-two-level.test.ts` (or a unit probe) asserting two in-region `T004` anchors refuse the plan through the EXISTING `DocumentIdentityCollisionError` (`src/engine/build.ts:539-560`) with both paths in deterministic order — no new error class.

**Checkpoint**: Depth-2 boards produce parented sub-issues; parents carry no duplicated sections.

---

## Phase 4: User Story 2 - The flat-board default keeps subtasks folded, byte-stable (Priority: P1)

**Goal**: At the shipped default (cap 1 / absent config) NOTHING nests: subtasks ride verbatim in the parent, zero sub-issues ever, `spec-kitty` plan output unchanged vs 0.6.0 except recognition fixes (FR-003 fold posture, FR-010/FR-011, SC-002/SC-005).

**Independent Test**: Quickstart scenarios 1 (default slice) and 4 (cap toggle convergence) on the same `spec-kitty-two-level` world with `maxTaskIssueDepth` absent/1.

### Tests for User Story 2 ⚠️

- [ ] T017 [P] [US2] Byte-pin `tests/integration/spec-kitty-flat-default-bytes.test.ts`: re-pin the 0.6.0 baseline outputs for the spec-kitty fixtures/corpus at default config and assert byte-identical plan output (task count = WP-document count, zero parented entries, subtask sections present verbatim inside parent descriptions); assert `[P]` parallel markers and `#### Subtask …` restatements are plain content.

- [ ] T018 [P] [US2] Cap-toggle convergence test `tests/integration/engine-spec-kitty-cap-toggle.test.ts`: apply at depth 2 (children created), reconfigure to 1, plan+apply — children fold verbatim into parents (bodies byte-equal to the flat baseline), the 7 former child issues surface in `plan.unmappedIssues` with zero archive/delete calls; reconfigure to 2 again — durable anchors re-match the SAME child issues, no re-creation (SC-005, FR-010).

### Implementation for User Story 2

- [ ] T019 [US2] Complete the depth-1 posture in `src/parsing/taskfile.ts` + `src/parsing/depth.ts` interplay: at cap 1 no child draft survives and NO `promotedRanges` are ever set (parent extent already spans the whole body — folded verbatim by omission, exactly the 020 mechanism); emit exclusion records kind `subtask`, reason `depth-folded` for visibility; confirm zero write-back: document parents AND children stay out of `expectedMarkdownChanges` (022 C6 extended by C5).

**Checkpoint**: Default posture provably flat and byte-stable; toggle round-trips.

---

## Phase 5: User Story 3 - Current status lands on the right board column (Priority: P2)

**Goal**: The mission's `status.events.jsonl` is the SOLE status authority; the mapped lane moves the issue's workflow state; descriptions never carry status text (FR-007, contract C6).

**Independent Test**: World `spec-kitty-event-status` (quickstart scenario 3): `status.json` + front matter deliberately contradict the log; last event wins everywhere.

### Tests for User Story 3 ⚠️

- [ ] T020 [P] [US3] Unit tests `tests/unit/parsing-status.test.ts` for the (to-be-created) `src/parsing/status.ts`: qualifying line = valid JSON with string `wp_id` AND string `to_lane` at top level; envelope/annotation/other lines skipped without poisoning order; LAST qualifying line per `wp_id` in FILE ORDER wins; malformed lines counted (one finding, content never propagates); unknown `wp_id` reported; nine-lane vocabulary recognized, `genesis`/anything else known-unmapped.

- [ ] T021 [P] [US3] Integration test `tests/integration/engine-spec-kitty-event-status.test.ts` driving world T004: only WP02 plans `changedFields += "state"` with label `lane:in_progress`; apply patches `stateTypeId` = "Doing" id and history records append-only `"lane-changed"`; WP01 (no events) state untouched; WP03 (`canceled`, unmapped) untouched + `lane-state-unmapped` reported; contradiction fixture: stale `status.json`/front-matter values NEVER win; mirrored descriptions contain no status text and no `---` block; second apply is a no-op (live state matches); read-only lanes never read status files outside plan build (Principle I).

### Implementation for User Story 3

- [ ] T022 [US3] Implement `src/parsing/status.ts` (pure, dependency-free): lines in → `Map<wpId, lane>` + findings out, exactly per C6.1 and the T020 rules.

- [ ] T023 [US3] Implement `src/engine/status-load.ts`: read-only loader invoked ONLY from plan build — for each mission featureName present in parsed `spec-kitty` units, read `<base>/<mission>/<adapter.statusEventFileName>` when it exists; missing file ⇒ empty map, never an error; cache per mission for entry assembly.

- [ ] T024 [US3] Lane-state resolver in `src/engine/completion.ts` beside `desiredCompletionStateName`: map lane → state NAME via the ROUTED team's `workflowStates.lanes` (no default, no `defaultTeamKey` fallback), resolve NAME→id through the existing `resolveWorkflowStateId` on the captured snapshot; unmapped lane / unresolvable name ⇒ untouched + reported finding with the conflict posture of `build.ts:420-429`.

- [ ] T025 [US3] Entry-assembly integration in `src/engine/build.ts` (beside the completion path 408-430): evaluate the status map per matched/created WP task, add `"state"` drift + `lane:<lane>` label, creates carry the mapped state; apply side reuses the existing `IssueUpdatePatch.stateTypeId` path (`src/engine/apply.ts:1133-1146`) and adds history event kind `"lane-changed"` in `src/engine/ops.ts` (append-only additive kind); sub-task (child) tasks derive NO state (C6 keys on work-package ids only).

**Checkpoint**: Board columns follow the event log; every contradiction fixture resolves to the last event.

---

## Phase 6: User Story 4 - Mission naming and artifact hygiene (Priority: P3)

**Goal**: All mission naming styles attribute; per-WP artifact sub-folders can never create issues or collisions; manifest/state artifacts stay inert; the reference repository is plannable (FR-008/FR-009/FR-015, SC-001/SC-007).

**Independent Test**: World `spec-kitty-artifact-folders` + the reference-reproduction e2e (quickstart scenarios 1 and 5).

### Tests for User Story 4 ⚠️

- [ ] T026 [P] [US4] Discovery/integration tests `tests/integration/discovery-spec-kitty-artifacts.test.ts` over world T005: artifact sub-folder files (incl. duplicated `work_package_id` front matter) yield ZERO tasks at depths 1 and 2 while remaining `spec-kitty`-claimed (no `generic` fall-through); canonical document + its own artifacts produce NO collision refusal; `tasks/README.md` claimed, 0 tasks; missions `042-*`, `*-01KQ2VNJ`, bare slug all attribute tasks to their directory name.

- [ ] T027 [P] [US4] Inertness + parity pins in `tests/integration/engine-spec-kitty-artifact-folders.test.ts`: `meta.json`, `spec.md`, `plan.md`, roll-ups, `wps.yaml`, `status.json`, `status.events.jsonl` contribute 0 tasks at every allowed depth (FR-009); count parity per mission (FR-011/FR-016: level-1 count = canonical WP-document count at BOTH depth settings).

### Implementation for User Story 4

- [ ] T028 [US4] Narrow the canonical gate on `src/discovery/adapters/spec-kitty.ts`: `collectionPattern` becomes VERBATIM `^kitty-specs/[^/]+/tasks/(?:(?:planned|claimed|in_progress|for_review|in_review|approved|done|blocked|canceled)/)?[^/]+\.md$` (direct children + legacy lane variant; `. +` no longer spans `/`); `taskPathPatterns` STAYS `kitty-specs/*/tasks/**/*.md` (broad claim preserved); amend contract C1.2' pins + `docs/framework-adapters.md` wording.

- [ ] T029 [US4] Reference-reproduction e2e `tests/e2e/spec-kitty-023-reference.test.ts` with fixture tree per research R8 (three naming styles, full artifact sets, duplicated-id artifacts, mixed status log, roster+anchor+restatement documents): asserts zero collision refusals (SC-007), stock-default count parity + zero sub-issues (SC-002/FR-016), depth-2 children = anchors (SC-001), no-op second plan, and status/no-lanes ⇒ zero state moves.

**Checkpoint**: The upstream-shaped repository is fully plannable and inert where it should be.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T030 [P] README refresh in `README.md`: adapter-table row + Spec Kitty subsection describing the two-level model, event-log status authority, and canonical-document rule (FR-014).

- [ ] T031 [P] Docs refresh in `docs/framework-adapters.md` (spec-kitty narrative: subtask promotion/folding, artifact sub-folders) and `docs/configuration-reference.md` (`maxTaskIssueDepth` interplay with document sources; `workflowStates.lanes` keys with NO default; `statusEventFileName`) (FR-014).

- [ ] T032 [P] Governance + release records: rewrite Requirement 7 in `specs/requirements.md`; add the `[0.7.0]` entry to `CHANGELOG.md` (headline: sub-task depth + event-log status; upgrade note: artifact sub-folders stop counting, no identity changes, zero description churn at the flat default); record A-023-0…A-023-3 + the supersession ledger (022 C1.1 pattern clause; the 022 "subtasks are never tasks" assumption) in `docs/contract-amendments.md`.

- [ ] T033 Contract-tier green: `tests/contract/discovery-surface.test.ts`, regenerated `tests/contract/snapshots/frozen-surface.json`, report-schema scan, and the documentation-consistency suite pass against the corrected text.

- [ ] T034 Full pyramid: `node scripts/run-tests.mjs` — all tiers + coverage threshold; the other six identities' discovery/parse/depth/plan fixtures byte-identical (SC-006); `spec-kitty` disabled restores pre-017 fall-through (022 C9 pin).

- [ ] T035 Run every scenario in `specs/023-spec-kitty-subtask-depth/quickstart.md` (1–7) and check the Definition-of-done list; final commit, no self-attribution trailers.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: start immediately.
- **Foundational (Phase 2)**: after Setup; BLOCKS all stories. T006→US1/US2; T007→US3; T008→US3; T009→US1/US2/US4.
- **User Stories**: all depend on Foundational.
  - **US1 (Phase 3)**: independent of other stories — MVP.
  - **US2 (Phase 4)**: needs the US1 mechanism (T012/T013) to fold; deliver immediately with US1 (co-P1 pair).
  - **US3 (Phase 5)**: independent of US1/US2 given T007+T008; state evaluation applies to WP tasks regardless of depth.
  - **US4 (Phase 6)**: US4's collection-gate (T028) is INDEPENDENT code (adapter row pattern) but the reference e2e (T029) asserts combined US1/US2/US3 behavior — run last among stories.
- **Polish (Phase 7)**: after the delivered story set.

### Within Each User Story

Tests (T0xx) written FIRST and failing → derivation/mechanism → engine wiring → turn green → story checkpoint.

### Parallel Opportunities

- Phase 1: T002/T003/T004/T005 [P] (different fixture dirs).
- Phase 2: T006/T007/T008/T009 touch different files — near-parallel (separate amendment commits).
- Across stories after Foundational: US1+US2 vs US3 are disjoint file sets (`parsing/document|taskfile|depth`, `engine/build|apply` mirror slice) vs (`parsing/status.ts`, `engine/status-load|completion|ops`) — two-developer parallel split.
- Per-story test pairs (T010/T011, T017/T018, T020/T021, T026/T027) [P].

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Unit tests for subtask derivation in tests/unit/parsing-spec-kitty-subtasks.test.ts"
Task: "Integration test for the two-level world in tests/integration/engine-spec-kitty-two-level.test.ts"
# Then implementation in dependency order (same-developer): document.ts → taskfile.ts → mirror slice → adapter row
```

## Implementation Strategy

### MVP First (US1 + US2 — the co-P1 pair)

1. Phase 1 (fixtures) → 2. Phase 2 (foundational amendments) → 3. Phase 3 (promotion at depth ≥ 2) → 4. Phase 4 (flat-default byte pins + toggle convergence) → **STOP & VALIDATE** with quickstart scenarios 1–2 and 4. Default-config users see zero change; depth-2 users get sub-issues.

### Incremental Delivery

1. MVP lands → 2. US3 (status authority) → validate scenario 3 → 3. US4 (hygiene + reference reproduction) → validate scenarios 1/5 → 4. Polish: docs/governance/release records → v0.7.0.

---

## Notes

- [P] tasks = different files, no dependencies; never parallelize two tasks touching `src/parsing/document.ts` or `src/engine/build.ts`.
- The nine-lane vocabulary, regex members, and seed layout are quoted VERBATIM where they appear above — copy them, do not paraphrase at implementation time.
- A foreign-identity byte pin failing is a stop-the-line signal (over-reach), not a fixture to update.
- Commit after each task or logical group; every checkpoint is a valid branch push point.
