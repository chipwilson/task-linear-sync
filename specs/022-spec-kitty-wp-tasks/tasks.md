---
description: "Task list for feature 022 — Spec Kitty Work-Package Task Source (v0.6.0 release)"
---

# Tasks: Spec Kitty Task Source — Work-Package Documents

**Input**: Design documents from `specs/022-spec-kitty-wp-tasks/`

**Prerequisites**: plan.md, spec.md (US1–US3, FR-001…FR-014, SC-001…SC-005), research.md (R1–R13), data-model.md (§1–§5), contracts/spec-kitty-work-packages.md (C0–C8), quickstart.md

**Tests**: REQUIRED. Constitution Principle VI (Test-First, NON-NEGOTIABLE) and research R13: the superseded 017 pins flip **test-first**; every FR/SC maps to ≥1 automated suite per quickstart.md's validation table.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in each description

**Branch discipline**: ALL work happens on branch `022-spec-kitty-wp-tasks` (currently checked out). Every commit lands on this branch; the PR merges it to `main`. Commit messages carry NO `Co-Authored-By` / "Generated with" / self-attribution trailers (repo AGENTS.md).

**Key invariants for every task** (plan.md + constitution):
- Zero new runtime dependencies; the front-matter scan is a leading-fence line parser, no YAML library (R5).
- The three mechanism extensions (`taskPathPatterns`, `documentTaskRule`, kind-`document` engine/matching rules) are **inert by default** — every other adapter and the other six identities stay byte-identical (FR-013/SC-005). Never "fix" another identity's fixture or pin; a foreign pin failing means this change over-reached.
- Frozen-contract changes ride ONLY the amendment channel: A-022-0…A-022-4, each landed with its contract-doc edit + module change + regenerated snapshot in the same change (three-artifact rule, plan §Constitution Check).
- Document tasks receive **zero line write-back** — repository `tasks/` files are never modified; the durable anchor lives in `Attachment_Metadata` (Principle II, C6).
- Zero organization-specific literals in any default or doc (Principle III, release defaults-scan).
- Tests run against the fake `Linear_Port` / hermetic fixtures only: zero real Linear requests, zero credentials, no upstream clone (Principles I/VI).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm branch state, commit the design artifacts, and build the fixtures every story's tests consume.

- [x] T001 Verify HEAD is on branch `022-spec-kitty-wp-tasks` (up to date with `main`), then commit the currently-untracked design directory `specs/022-spec-kitty-wp-tasks/` (spec.md, plan.md, research.md, data-model.md, quickstart.md, contracts/spec-kitty-work-packages.md, tasks.md) with message `docs(022): spec, plan, research, data-model, quickstart, contract and tasks`. No self-attribution trailers.

- [x] T002 [P] REWORK the discovery fixture repo `tests/fixtures/repos/discovery/spec-kitty/` to the corrected layout (plan §Project Structure; quickstart step 1 extended with every edge-case shape). Keep `kitty-specs/001-demo/`, `kitty-specs/002-billing/` and `.kittify/kit.md` directories but populate: (a) `kitty-specs/001-demo/tasks.md` roll-up with dozens of `- [ ] T001 …` checkbox lines (0 tasks expected); (b) `kitty-specs/001-demo/tasks/WP01-scaffold.md` — full WP document: YAML front matter (`work_package_id: WP01`, `title: Scaffold`, `lane: planned`, plus ignored keys `dependencies`/`subtasks`/`phase`), then `# WP01 — Scaffold`, `## Objectives & Success Criteria`, `## Context & Constraints`, `T001`/`T002` step guidance, `## Test Strategy`, `## Definition of Done` checkboxes, `## Activity Log`; (c) `kitty-specs/001-demo/tasks/notes.md` — no front-matter id, no `WPnn` name (fails recognition, claimed, 0 tasks); (d) a review-feedback artifact `kitty-specs/001-demo/tasks/review-feedback.md` (no front-matter id, no `WPnn` file-name shape — skipped content; do NOT name it `WP*`, since `(?i)^WP(\d+)…` per R7 would make it a recognized document); (e) `kitty-specs/001-demo/tasks/front-matter-only.md` with `work_package_id: WP02`, `title: Empty Body`, and NO body (edge case: 1 task, empty content, `no-content` label); (f) `kitty-specs/001-demo/tasks/WP03-no-title.md` — front matter WITHOUT `title:` and no leading heading (title falls to readable slug "no title" per C3.1); (g) `kitty-specs/002-billing/tasks/planned/WP01-billing.md` — legacy lane sub-folder, recognized by file name only; (h) `kitty-specs/003-plan-only/tasks.md` roll-up but NO `tasks/` folder (0 tasks, not an error — US2-AC3); (i) `kitty-specs/001-demo/tasks/img.png` — non-`.md` attachment (never a candidate). All content hermetic, placeholder-only, deterministic.

- [x] T003 [P] CREATE the upstream-reproduction fixture `tests/fixtures/repos/plan/spec-kitty-upstream/kitty-specs/002-lightweight-pypi-release/` — hermetic reproduction of the upstream mission shape (SC-001/SC-002, R13): `spec.md`, `tasks.md` roll-up with many `- [ ] Tnnn …` index lines, and `tasks/` with ≥3 richly detailed WP documents including `tasks/WP01-release-validation-tooling.md` modeled on upstream: front matter `work_package_id: WP01`, `title: Release Validation Tooling`, lane history, dependencies, subtasks; body with `## Objectives & Success Criteria`, `## Context & Constraints`, `T001`/`T002` step-by-step guidance, `## Test Strategy`, `## Risks & Mitigations`, `## Definition of Done`, `## Activity Log`, `## Review Report`. Add a second small mission (e.g. `001-triage/` with `tasks/WP01-intake.md` + `tasks/WP02-export.md`) so multi-mission parity is covered. Zero org identifiers; do NOT clone upstream.

- [x] T004 [P] CREATE the collision fixture `tests/fixtures/repos/plan/spec-kitty-collision/kitty-specs/001-demo/tasks/` with exactly two files both resolving to `WP01` — `WP01-alpha.md` (front matter `work_package_id: WP01`) and `wp01-beta.md` (no front-matter id; file-name token normalizes `wp01` → `WP01` per R7) — plus `../tasks.md`. Deterministic sorted-path refusal pin material (C2.4).

- [x] T005 RE-BASE the parsing corpus `tests/fixtures/parsing/frameworks/spec-kitty/`: replace the 017 roll-up-era content (current `tasks.md` has `## Work Package WP01: …` headings) with the corrected pair: `tasks.md` roll-up (checkbox lines, WP headings — all documentation, 0 tasks) plus `tasks/WP01-auth.md` and `tasks/WP02-billing.md` full WP documents (can be condensed models of T003's shape). Consumed by `tests/integration/parsing-corpus.test.ts` (T022 re-pin).

**Checkpoint**: Fixtures exist; nothing behavior-changing yet — the full suite must still pass byte-identically after Phase 1 (fixtures are not yet consumed).

---

## Phase 2: Foundational (Mechanism Amendments A-022-0/1/2 + Row Re-Base)

**Purpose**: The three generic, amendment-governed mechanism extensions and the re-based `spec-kitty` row. Each is inert for every other identity by construction.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 [P] A-022-0 (002 frozen): add `"document"` to the frozen `TaskKind` union in `src/domain/task.ts` (verbatim: `TaskKind` union `"heading" | "checklist"` → `… | "document"`). Three-artifact rule IN THE SAME CHANGE: amend `specs/002-core-domain-contracts/contracts/task-model.md` and `specs/002-core-domain-contracts/data-model.md` §1, then regenerate `tests/contract/snapshots/frozen-surface.json` via `UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract` and confirm the drift suite is green afterwards (quickstart §Contract-amendment validation). Additive only: no existing value's seed or payload changes; confirm the plan-report schema carries no `kind` field so it is unaffected (the frozen-imports/report-schema scan, `tests/contract/frozen-imports-005.test.ts`, must pass unedited).

- [x] T007 [P] Write FAILING unit tests in `tests/unit/discovery-patterns.test.ts` for the new path-glob compiler (A-022-1, C1.1): root-relative POSIX segment globs where `*` occupies exactly one path segment and `**` zero or more (segment semantics consistent with the 017 A-3 exclusion grammar), matched against the FULL relative path. Cases: `kitty-specs/*/tasks/**/*.md` matches `kitty-specs/002-x/tasks/WP01-a.md`, `kitty-specs/002-x/tasks/planned/deep/WP01-a.md` (`**` = zero or more segments) and NOT `kitty-specs/002-x/tasks.md`, NOT `kitty-specs/002-x/tasks/img.png`, NOT `specs/001-x/tasks/WP01.md`; a single `*` never crosses `/`; anchored match (no suffix leak). Run `npm run build && npm run test:unit` and confirm these FAIL while existing tests pass.

- [x] T008 Implement the path-glob compiler in `src/discovery/patterns.ts` (compiles `taskPathPatterns` sources to predicates over root-relative POSIX paths; same segment semantics as the existing exclusion grammar compiler). Make T007 pass.

- [x] T009 [P] Write FAILING unit tests in `tests/unit/discovery-traverse.test.ts` for the A-022-1 traversal extension (C1.1/C1.2/C1.4): (a) the task-file matcher predicate widens from `(name)` to `(name, relPath)` and basename-only matchers ignore the second argument — existing adapters' candidate sets unchanged; (b) with `taskPathPatterns: ["kitty-specs/*/tasks/**/*.md"]` traversal descends `kitty-specs/<mission>/tasks/` and claims nested lane sub-folders (`tasks/planned/WP01-x.md`); (c) path-pattern matchers join the candidate union in `src/discovery/discover.ts` alongside basename patterns WITHOUT widening the basename union other identities consume (a `specs/001-x/spec.md` file must not become a candidate); (d) DISABLE parity: with `spec-kitty` removed from the enabled adapters, `kitty-specs/` files fall through to `generic` byte-identically to pre-017 behavior (FR-013 — pin against the T002 fixture's fall-through output captured BEFORE this change).

- [x] T010 [P] Write FAILING unit tests in `tests/unit/discovery-adapters-builtin.test.ts` for the new `FeatureNameRule` kind `segment-under-base` (A-021 precedent style, R3): first path segment after the EFFECTIVE base directory — `kitty-specs/002-x/tasks/WP01.md` → `002-x`; `kitty-specs/002-x/tasks.md` → `002-x`; `kitty-specs/002-x/tasks/planned/WP01-x.md` → `002-x` (a lane directory is never a feature name, data-model §1); a consumer-overridden `baseDirectories` (programmatic layer) is honored (Principle III); rule lives behind `applyFeatureNameRule` in `src/discovery/conventions.ts` (extend the `parent-dir`/`segment-after` case matrix there).

- [x] T011 Implement the A-022-1 type + plumbing layer: add optional `taskPathPatterns` to `FrameworkAdapter`/`AdapterConventions` in `src/discovery/adapter.ts` and `src/discovery/conventions.ts` (deep-merge override plumbing per the existing descriptor pattern, arrays replace); add the `segment-under-base` kind to the `FeatureNameRule` union (`adapter.ts` ~line 37) and its case in `applyFeatureNameRule` (`conventions.ts` ~line 147–160, derived from the row's EFFECTIVE `baseDirectories`). Same change: amend `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` (new member + new rule kind, both optional ⇒ absent-everywhere behavior byte-identical) and re-pin `tests/contract/discovery-surface.test.ts` snapshots (three-artifact rule). Make T010 pass.

- [x] T012 Implement traversal + union: widen the task-file matcher predicate in `src/discovery/traverse.ts` to `(name, relPath)` and wire compiled `taskPathPatterns` matchers into the candidate union in `src/discovery/discover.ts` (next to the `adapter.taskFilePatterns` union at line ~32). Non-`.md` files stay outside candidates. Make T009 pass.

- [x] T013 [P] Documentation for A-022-1 (same amendment, different files from T011/T012): `docs/discovery.md` — document the path-scoped candidate grammar (`taskPathPatterns`, `*`/`**` segment semantics, `(name, relPath)` predicate, basename-only behavior unchanged); `docs/framework-adapters.md` — the new convention member in the conventions table (the spec-kitty ROW narrative itself is re-based later in T033 — do not rewrite that section here).

- [x] T014 [P] Write the FAILING contract pin for A-022-2: extend `tests/contract/adapter-contract.test.ts` — the `TaskFileAdapter` member whitelist (004 `contracts/adapter-consumption.md` rule 2) gains optional `documentTaskRule` (regex **source** strings: `collectionPattern`, `idKey`, `titleKey`, `fileNameIdPattern`); regenerate `tests/contract/snapshots/parsing-surface.json` via the `UPDATE_FROZEN_SNAPSHOT=1` flow if the `index.d.ts` surface shifts. Absent ⇒ extraction unchanged for every other adapter (pin that the member is optional).

- [x] T015 Implement the whitelist member: `src/parsing/adapter.ts` — `TaskFileAdapter` gains optional `documentTaskRule`; same change amends `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` (rule 2 whitelist) and `specs/004-task-parsing-line-rendering/contracts/parsing-api.md` (the document-unit pipeline: 0-or-1 draft, front-matter containment, kind `document`, extent = body, fold-inert at depth 1) — A-022-2 three-artifact rule. Make T014 pass.

- [x] T016 [P] Write FAILING unit tests in `tests/unit/parsing-document.test.ts` for the pure front-matter/document core (R5/R6/R7): (a) leading-front-matter scan — optional leading `---` fence as the first non-blank line closed by a following `---`/`…` fence; only top-level scalar keys read (`work_package_id`, `title`); malformed/unterminated/absent fence ⇒ no front matter, whole file is body; (b) recognition (C2.1): non-empty front-matter `idKey` scalar wins over `fileNameIdPattern` on the basename; both absent ⇒ not a document; (c) WP-id normalization: `wp01-foo.md` → `WP01` (upper-case `WP` + digits); (d) title cascade verbatim: "front-matter `title` scalar → body's leading ATX heading text → readable file-name slug (`WP01-release-validation-tooling` → `Release Validation Tooling`)"; strip the `WPnn` token and separators, `-`/`_` → spaces, collapse whitespace; front-matter text NEVER appears in a title; (e) body extent = first body line..last line.

- [x] T017 Implement `src/parsing/document.ts` (NEW, pure, zero-dep): front-matter scan, recognition, title cascade, readable slug, normalized WP id, body extent — exactly the R5/R6/R7 rules; consumes the `documentTaskRule` member values (regex source strings; defaults per data-model §3 when members absent is NOT a thing — the module is only consulted when `documentTaskRule` is present). Make T016 pass.

- [x] T018 Write the FAILING document-mode pins by RE-BASED-REWITING `tests/unit/parsing-spec-kitty.test.ts` (flip the superseded 017 checklist-grammar pins test-first, R13): parse claimed spec-kitty files through the document pipeline — (a) each recognized WP document yields EXACTLY ONE draft: `kind: "document"`, `localTaskId` = normalized WP id, `title` per cascade, `taskBody = { startLine: first body line, endLine: last line }` inclusive, `parentUuid` absent/`childUuids` empty (fold-inert at depth 1, R4); (b) the roll-up (`tasks.md`/`TASKS.md`) yields ZERO drafts and zero line-scanning — checkbox lines, WP headings, prose are documentation (FR-005); (c) `notes.md`-style non-recognizing files yield zero drafts, still claimed (no fall-through); (d) `Tnnn` subtask ids and DoD checkboxes are never extraction inputs (FR-004); (e) front-matter-only document ⇒ one draft with empty body (report label asserted later in T023); (f) conflict markers inside a document still set `unresolvedConflict` (taskBody intersects the block, R4). Run and confirm FAILING (document mode not wired).

- [x] T019 Implement the document-mode branch in `src/parsing/taskfile.ts`: when the consumed adapter carries `documentTaskRule`, run the document pipeline INSTEAD of heading/checklist extraction (0-or-1 draft per T018); files failing recognition short-circuit to zero drafts with NO line scanning. Conflict scan, screening inputs and warnings machinery stay upstream/unchanged (R4). Make T016/T018 green. Depth folding (020 `src/parsing/depth.ts`) must be untouched — verify a single parentless depth-1 draft passes through unchanged.

- [x] T020 RE-BASE the adapter row `src/discovery/adapters/spec-kitty.ts` + write its pins `tests/unit/discovery-adapters-spec-kitty.test.ts` (pins first, then the row). Row per data-model §3 verbatim: `baseDirectories: ["kitty-specs/"]` (unchanged); `taskFilePatterns: ["tasks.md", "TASKS.md"]` → keep shipped defaults semantics (roll-up claim, unchanged); `taskPathPatterns: ["kitty-specs/*/tasks/**/*.md"]` (new); detection `pathPrefixes: ["kitty-specs/"]`, no siblings (unchanged, 017 C2.1); `featureNameRule: { kind: "segment-under-base" }` (was `parent-dir`); `frameworkSpecificExclusions: []` (the 017 `kitty-specs/*/tasks/` entry REMOVED — supersedes 017 C2.5); `documentTaskRule: { collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$", idKey: "work_package_id", titleKey: "title", fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$" }` (new); `headingGrammar: "(?!)"` never-matching placeholder retained; RETIRE `checklistIdPattern`, `titleTagPattern`, `phasePattern`, `summaryPattern` from the row (the whitelist members stay available to custom adapters); `identityFileScope` absent; no `agentHooksDirectory` (017 C1.3 retained — scaffold refusals pinned by the untouched `tests/unit/agent-hooks.test.js`/`.ts` suite). Pins: exact member values, disable-removes-the-row-as-a-unit, and that `specs/` vs `kitty-specs/` match sets stay disjoint (017 C2.2). Same change DELETES the superseded `tests/integration/sync-spec-kitty-drift.test.ts` (it pins roll-up-line sync behavior the spec removes; its lifecycle coverage is re-homed as `tests/integration/sync-spec-kitty-lifecycle.test.ts` in T030 — record the deletion in the commit message).

**Checkpoint (Foundational)**: `npm run build && npm run test:unit && npm run test:contract` green with the new unit pins; `git diff` shows NO changes under other identities' fixtures; frozen/parsing/discovery contract snapshots regenerated only for A-022-0/1/2.

---

## Phase 3: User Story 1 — One work package, one fully detailed task (Priority: P1) 🎯 MVP

**Goal**: Every work-package document under a mission's `tasks/` folder appears as exactly one task attributed to that mission, carrying the document's curated detail (spec US1; contract C0–C3, C6.2–C6.3).

**Independent Test**: Sync the upstream-reproduction fixture (T003) with zero configuration; per mission assert task count = work-package document count, each task's content contains the "Objectives & Success Criteria" section and the `Tnnn` subtask guidance, and no title contains front matter (spec US1 Independent Test; SC-001/SC-002).

### Implementation for User Story 1

- [x] T021 [P] [US1] RE-PIN `tests/integration/discovery-spec-kitty.test.ts` to the corrected model over the T002 fixture and assert over the T003 upstream fixture with `builtInDefaults` and ZERO configuration keys: (a) count parity per mission — discovered/plan task count = recognized WP-document count, and zero tasks originate from `tasks.md` (FR-009/SC-001, C2.3); (b) claimed-file set — `tasks/WP01-scaffold.md`, `tasks/notes.md`, `tasks/planned/WP01-billing.md`, both roll-ups all framework `spec-kitty` with feature names `001-demo`/`002-billing`/`003-plan-only` — NEVER `tasks` (FR-006); `spec.md` and `tasks/img.png` absent from candidates (C1.2); (c) SC-002 at plan level: every WP task has a non-empty title (front-matter title beats decorative heading: `WP01-release-validation-tooling.md` → `Release Validation Tooling`) and non-empty content containing its Objectives section and `Tnnn` guidance, with no raw front matter anywhere in title or content; (d) `003-plan-only` (roll-up, no collection) contributes zero tasks and the run is not an error; (e) the old header comment block's 017 pins (tasks-directory exclusion, roll-up checkbox tasks) are replaced by the corrected contract references. This test FAILS if any Phase-2 mechanism regressed.

- [x] T022 [P] [US1] Re-base `tests/integration/parsing-corpus.test.ts` against the re-based corpus (T005): the roll-up file yields the empty task set; each `tasks/WPnn-*.md` yields exactly one `kind: "document"` task with `localTaskId = WPnn`, title per cascade, and content containing its Objectives + `Tnnn` guidance verbatim-minus-front-matter (C3.2, SC-002). Corpus results for the other frameworks' directories must remain byte-identical.

- [x] T023 [P] [US1] Write FAILING unit tests `tests/unit/engine-spec-kitty.test.ts`: (a) C2.4 collision — planning the T004 fixture refuses at plan build with a deterministic integrity finding naming framework `spec-kitty`, mission `001-demo`, id `WP01`, and BOTH colliding paths sorted (`../tasks/wp01-beta.md` before `../tasks/WP01-alpha.md` case-insensitively per the fixture's normalization — assert the exact deterministic order the implementation documents); no plan object exists, no apply is reachable, no winner guessed (FR-008, R8); removing one file restores a clean plan; (b) C6.2 mirror slice — a document task's mirrored description is `taskBody.startLine..endLine` INCLUSIVE (includes the leading heading line; excludes front matter), while a heading/checklist task's slice (own-line `+1` skip) is unchanged; (c) C3.3/R11 — the front-matter-only document still has a plan entry whose report carries the visible `no-content` label (entry-label channel; no `SyncPlan`/report-schema shape change — the report-schema scan test must stay unedited); (d) C6.1 plan side — document plan entries carry EMPTY `expectedMarkdownChanges`; (e) `renderTaskLines` defensively rejects a document-kind assignment with `LineRenderError: structure-mismatch`.

- [x] T024 [US1] Implement A-022-4 (engine half) to make T023 green: `src/engine/build.ts` — after parse, before matching, scan the parsed task set for two+ tasks sharing one `Stable_UUID` and refuse plan build with the deterministic C2.4 finding (precedent: the existing `DurableIdentityCollisionError`/`IntegrityError` posture); kind-conditional mirror slice — `kind === "document"` slices `startLine..endLine` inclusive, other kinds keep the `+1` skip byte-identical (SC-005); document tasks excluded from render assignments (empty `expectedMarkdownChanges`). `src/engine/report.ts` — the `no-content` entry label for empty mirrored document content. `src/parsing/render.ts` — defensive `structure-mismatch` rejection for document-kind assignments. Zero changes to conflict classification, normalization, or checkpointing lanes (R11).

- [x] T025 [US1] CREATE `tests/e2e/spec-kitty-work-packages.test.ts` — the US1 scenario walkthrough on the read-only CLI / fake-`Linear_Port` lanes (quickstart steps 3–4; `buildCliWorld` + `runCli` conventions of `tests/integration/engine-spec-kitty-world.test.ts`): `inventory` over a scratch copy of the T003 fixture lists the collection files and roll-ups under framework `spec-kitty` with mission feature names; `plan` yields exactly one entry per WP document, titles `Release Validation Tooling` etc., content = document minus front matter including `Tnnn` guidance and DoD checkboxes verbatim, `expectedMarkdownChanges` empty everywhere, zero roll-up-line entries, no dependency edges (017 C3.7 stance retained). (US2/US3 walkthroughs extend this file in T039 — sequential hot spot, do not parallelize this file.)

**Checkpoint**: US1 fully functional — sync the upstream-reproduction fixture alone and the board shape is right: one richly detailed task per work package, zero fragments.

---

## Phase 4: User Story 2 — The roll-up stops generating one-line tasks; the board converges (Priority: P2)

**Goal**: The plan proposes no roll-up task; roll-up-era leftover issues are never matched onto work-package tasks and surface as stale for operator cleanup (spec US2; contract C5, C2.2).

**Independent Test**: Seed a tracker with issues matching the roll-up-line tasks of a fixture mission; run the corrected sync; assert the plan contains no roll-up-line tasks, proposes each WP task, and reports every seeded roll-up issue as stale/unmatched with zero pairings (spec US2 Independent Test; SC-004).

### Implementation for User Story 2

- [x] T026 [P] [US2] Write FAILING unit tests `tests/unit/matching-document-kind.test.ts` (A-022-3, C5.1): a `kind: "document"` task pairs ONLY via the durable-identity signal — (a) candidate issue whose recorded `Attachment_Metadata` anchor equals the task's `Stable_UUID` pairs (durable hit survives even across containers); (b) a candidate whose TITLE exactly contains the document title (the roll-up-era shape: "Implement the release validation tooling script" ⊃ "Release Validation Tooling") scores ZERO and pairs to nothing — title exact/contained/token-overlap, local-id, issue-ref, container-alignment signals never apply; (c) with no durable hit the task is simply unmatched (create path), even under `--accept-low-confidence` band settings (FR-011 is absolute); (d) signal scoring for heading/checklist-kind tasks is byte-identical (SC-005).

- [x] T027 [US2] Implement the pairing veto in `src/matching/matching.ts` (A-022-3): document-kind tasks participate in matching only through the durable-identity signal; weighted signal scoring never applies to them. Amend `specs/006-task-issue-matching/contracts/` (the pairing-signal rules in `confidence-scoring.md` / `matching-api.md`) in the same change. Make T026 green; the existing `tests/unit/matching-*.test.ts` suites pass UNEDITED (the veto keys on kind; no global guard, no band changes).

- [x] T028 [P] [US2] CREATE `tests/integration/sync-spec-kitty-rollup-leftovers.test.ts` (SC-004, C5.2, quickstart step 6): on a fresh fake-`Linear_Port` world seeded with issues whose recorded identities are the OLD roll-up-line seeds of the T002 fixture mission (`Tnnn`/ordinal seeds — simulate a pre-022 sync), run plan + apply under the corrected model: (a) the plan contains ONLY WP-document tasks — zero roll-up-line tasks (FR-005); (b) EVERY seeded roll-up-era issue is reported stale/unmatched; ZERO of them pair onto document-kind tasks — including the one whose title contains `Release Validation Tooling` (durable-only veto); (c) nothing deletes the seeded issues (C5.2); (d) `003-plan-only` (no collection) contributes zero tasks and the run is not an error (US2-AC3). This test FAILS before T027 lands.

**Checkpoint**: US1 AND US2 — corrected plan contents AND convergence for previously-synced repositories.

---

## Phase 5: User Story 3 — Work-package tasks survive the kanban lifecycle (Priority: P3)

**Goal**: Lane flips, Activity Log / Review Report appends, body edits, and in-collection renames update the SAME task; same-numbered WPs in different missions stay distinct (spec US3; contract C4, C6.1 apply-side).

**Independent Test**: Sync a fixture, flip `lane:`, append Activity Log lines and a Review Report, rename the file within the mission's `tasks/` folder, re-sync: zero new tasks, the existing task updated, two missions' `WP01` remain two distinct tasks (spec US3 Independent Test; SC-003).

### Implementation for User Story 3

- [x] T029 [P] [US3] CREATE engine world fixture `tests/fixtures/engine/worlds/spec-kitty-lifecycle/`: `world.json` modeled on `tests/fixtures/engine/worlds/spec-kitty-basic/world.json` (fixed clock, placeholder-only `TEAM-A` team/project/workflowStates with `ac000000-…` placeholder UUIDs — zero real org identifiers, `confirmationKey: "SYNC"`, `descriptionNormalizationProfile: "default"`, `issues: []`); `repo/` with TWO missions each containing a `WP01` document (`kitty-specs/002-alpha/tasks/WP01-one.md`, `kitty-specs/003-beta/tasks/WP01-two.md` — US3-AC3 distinctness material), roll-ups beside them, and README.md describing the lifecycle scenario (021 world-fixture convention).

- [x] T030 [US3] CREATE `tests/integration/sync-spec-kitty-lifecycle.test.ts` driving the fake-`Linear_Port` seams (`buildWorld`/`attachEngine`/`callsOf` from `tests/helpers/engine-harness.js`, `buildSyncPlan` → `applySyncPlan`; replaces the deleted `sync-spec-kitty-drift.test.ts`). Assert (SC-003/FR-010/C4.2, quickstart step 5): first plan+apply creates exactly one issue per WP document (2 here); re-plan with zero changes = FULL no-op (0 actions); then in the repo flip `lane: planned → claimed`, append Activity Log lines, append a `## Review Report` section, and rename `WP01-one.md` → `WP01-one-tooling.md`; re-plan+apply → `{"create":0,"update":1,"no-change":1}`-style counts (update on content only), zero new issues, zero identity/match changes; the landed repo files are BYTE-IDENTICAL to the user's edited files (no `[KEY-N]` insertion anywhere — C6.1 apply side); the two missions' `WP01` tasks are two distinct issues, each attributed to its own mission (FR-007/C4.3); a final re-plan after content settles is a full no-op.

- [x] T031 [US3] RE-BASE `tests/integration/engine-spec-kitty-world.test.ts` and its world `tests/fixtures/engine/worlds/spec-kitty-basic/` (repo files) to the document model: the world's repo gains a `tasks/` collection with WP documents (roll-up retained as claimed documentation); re-pin the plan/apply/no-op/rollback assertions to the corrected task set (one entry per WP document, content = body verbatim, `expectedMarkdownChanges` empty); `rollbackRun` still restores repo bytes (unchanged machinery — document tasks were never written, so the rollback of a document-only run is a no-write undo).

**Checkpoint**: All three stories independently verified — the reported defect cannot recur through the lifecycle.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation duty (constitution — docs in the SAME change/PR), the amendment ledger, and final gate validation.

- [x] T032 [P] Update `README.md` (FR-014, C8.1): the adapter-table row for `spec-kitty` (task source = `kitty-specs/<mission>/tasks/**/*.md` work-package documents; roll-up yields no tasks) and the `### Spec Kitty` subsection — replace the roll-up-as-task-source description with the work-package-document model (one document = one task; title cascade; content minus front matter; legacy lane sub-folders accepted; zero write-back; overridable via the existing adapter-override lane). Placeholder identifiers only.

- [x] T033 [P] Update `docs/framework-adapters.md` (FR-014, C8.1): re-base the `spec-kitty` section — remove the 017 exclusion narrative ("`spec-kitty` excludes `kitty-specs/*/tasks/`") and the `checklistIdPattern`/`titleTagPattern` grammar notes; describe the re-based row (data-model §3): `taskPathPatterns`, `documentTaskRule`, `segment-under-base`, empty exclusions, retired members; keep text consistent with the doc-truthfulness pins (T035).

- [x] T034 [P] Update `specs/requirements.md`: rewrite Requirement 7's spec-kitty detail to the work-package-document task source with an FR-014-style statement (roll-up = claimed documentation, zero tasks; identity = mission + WP id; durable-only pairing), and correct any glossary/overview wording that describes roll-up checkbox lines as the spec-kitty task source. This is the feature's owned requirement rewrite (plan §Project Structure).

- [x] T035 Re-pin the documentation-consistency suites against the corrected text — `tests/contract/framework-support-consistency.test.ts` and `tests/contract/doc-truthfulness.test.ts` (016/019): update the pins to the NEW truth, never relax them (FR-014, C8.2). Both suites green with T032/T033/T034 and the T013 docs.

- [x] T036 Add the `## [Unreleased]` entry in `CHANGELOG.md` (plan §Project Structure): a defect-correction entry — spec-kitty work-package documents are the task source (one document = one fully detailed task), the roll-up yields zero tasks, roll-up-era issues from previous syncs are surfaced as stale for operator cleanup and never re-matched (upgrade identity note for affected operators, mirroring the 0.5.0 note style). Moved to `[0.6.0]` in T041.

- [x] T037 Update `docs/contract-amendments.md` (C8.3): entries A-022-0…A-022-4 (each: amendment, affected frozen contract(s), rationale pointer to research R2/R4/R8/R9/R10-R11, landing PR/commit) AND the supersession note — 017 C2.4/C2.5/C3.1–C3.8 and the C4 seed *inputs* superseded by `specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md`, retained 017 rules listed (C1, C2.1–C2.3/C2.6, C4.2 stance, C5, C6). Verify `specs/002-core-domain-contracts/contracts/task-model.md` mirrors the widened union (C8.3 cross-check, done in T006).

- [x] T038 Run the FULL quickstart.md validation: every row of the Automated-validation table (including `node --test build/tests/unit/agent-hooks.test.js` scaffold-refusal pin and the five contract suites row); the manual walkthrough steps 1–8 executed on the fake-`Linear_Port` CLI lanes with zero configuration (steps 5–7 are automated in T030/T028/T023 — spot-verify the CLI output shapes); `npm run build && npm run compile:tests`; `npm test` full pyramid green with coverage ≥ threshold; SC-005 check: `git diff --stat` proves the other six identities' fixtures/snapshots untouched. Record the outcome in the PR body (T042).

- [x] T039 Extend `tests/e2e/spec-kitty-work-packages.test.ts` (created in T025 — same file, strictly after it) with the US2 and US3 scenario walkthroughs: leftovers probe (quickstart step 6) and idempotence + lifecycle probe (step 5) plus the collision probe refusal (step 7) and the opt-out fall-through (step 8, FR-013) at the CLI/e2e level, complementing the integration suites.

---

## Phase 7: v0.6.0 Release, PR Submission & CI Monitoring

**Purpose**: Ship the correction as the v0.6.0 feature release following docs/release-process.md; all branch-side work stays on `022-spec-kitty-wp-tasks`.

- [x] T040 Re-run the merge-blocking gate locally on the final tree (mirrors `.github/workflows/ci.yml`): `npm ci && npm run lint && npm run build && npm run typecheck && npm test` — all green on the current Node LTS, and the engines-floor posture per CI (any failure fixed ON THE BRANCH before proceeding; the `release-dry-run` rehearsal gate is validated remotely in T043).

- [x] T041 CREATE the release commit on `022-spec-kitty-wp-tasks` (mirror the `release: 0.5.0` commit shape, docs/release-process.md maintainer steps 1–2): edit **only** `package.json.version` `0.5.0` → `0.6.0` (the single version source); regenerate `src/version.generated.ts` via `npm run prebuild` (drift test refuses hand-edited duplicates); sync the root version fields in `package-lock.json`; move the T036 entry under a new `## [0.6.0] - <YYYY-MM-DD>` heading in `CHANGELOG.md` keeping an empty `## [Unreleased]` on top; update the README "Version posture" bullet to name 0.6.0. Commit message: `release: 0.6.0 — spec-kitty work-package task source` + body describing the correction and the upgrade identity note. No self-attribution trailers.

- [x] T042 PUSH and SUBMIT the PR from `022-spec-kitty-wp-tasks` to `main`: `git push -u origin 022-spec-kitty-wp-tasks`, then `gh pr create --base main --title "release: 0.6.0 — spec-kitty work-package task source (feature 022)" --body …` with a body containing: the defect summary and corrected model; the amendment inventory A-022-0…4 + 017 supersession pointer; the FR-001…FR-014 / SC-001…SC-005 ↔ test traceability map (per T038 output); the quickstart validation record; and the operator note for roll-up-era leftovers (surfaced as stale, removed manually — nothing auto-deletes). Do NOT merge the PR yourself.

- [ ] T043 MONITOR CI until green: `gh pr checks --watch` on the PR — the `validate` matrix legs (Node 20.x and 24.x: lint/build/typecheck/test with the coverage gate on the modern-runner leg) AND the credential-free `release-dry-run` rehearsal (last stdout line is the JSON verdict, expect `WOULD_PUBLISH`; ≤ 12-minute stage budget per docs/release-process.md). On any failure: read the failing stage's streamed tool output from the run log (`gh run view --log-failed`), fix with a new commit ON `022-spec-kitty-wp-tasks`, push, and re-watch. A `release-dry-run` refusal (`REFUSED`/`STAGE_FAILED`) is merge-blocking — treat it as a defect in this change, never skip or soften a stage.

- [ ] T044 AFTER the PR merges to `main` (merge is maintainer-gated — wait for it): perform the operator release per docs/release-process.md maintainer steps 3–4 — check out the merged `main` (clean tree, HEAD at the release commit), `git tag v0.6.0 && git push origin v0.6.0`, then dispatch the Release workflow (`gh workflow run release.yml -f tag=v0.6.0`), approve the `release` environment gate, and watch the run (`gh run watch`) through the stage machine to the final `PUBLISHED` verdict on the secret-less OIDC/Trusted-Publishing path. Confirm `npm view task-linear-sync version` reports `0.6.0`. Do NOT use `allow_unattested` — the unattested override is reserved for documented external capability outages (release-process §Attestation).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 first (commit artifacts), T002/T003/T004 in parallel, T005 after T003 (corpus documents are condensed models of the T003 content).
- **Foundational (Phase 2)**: Depends on Phase 1. Internal order: T006 (TaskKind) blocks T016–T020; discovery chain T007→T008→T012 (with T009 pinning); rule chain T010→T011; parsing chain T014→T015→T016→T017→T018→T019; T013 anytime after T011; T020 LAST (the row activates all three mechanisms together and deletes the drift suite). **BLOCKS all user stories.**
- **User Stories (Phase 3+)**: All depend on the Foundational checkpoint.
  - **US1 (Phase 3)**: T021/T022/T023 in parallel; T024 after T023 (test-first); T025 after T024.
  - **US2 (Phase 4)**: T026 → T027 → T028 (T028 also needs T024's build.ts for plan contents; sequential after US1 if same worker, else after T024).
  - **US3 (Phase 5)**: T029 anytime after Phase 2; T030 after T024+T027 (apply must exclude document renders and veto pairing); T031 after T024.
- **Polish (Phase 6)**: T032/T033/T034 in parallel once the behavior is final; T035 after all three; T036/T037 anytime after their amendments landed (T037 after T006/T011/T015/T024/T027); T038 after everything; T039 after T025 (file) + T027/T030 (scenarios).
- **Release/PR/CI (Phase 7)**: T040 after T038 → T041 → T042 → T043 → (merge) → T044. Strictly sequential.

### Within Each User Story

- Tests written FIRST and observed FAILING before their implementation task (Principle VI): T023→T024, T026→T027, T028/T030 red before their subjects land if run mid-phase.
- Mechanism (Phase 2) before story proofs; story proofs before polish; docs before PR (documentation duty = same PR).

### Parallel Opportunities

- Phase 1: T002 ∥ T003 ∥ T004 (three fixture directories).
- Phase 2: T007 ∥ T009 ∥ T010 (three unit-test files, red together); T008 ∥ T011 ∥ T014 ∥ T016 (different files, after their pins); T013 ∥ implementation tasks; T006 ∥ the discovery chain (domain vs discovery files).
- Phase 3: T021 ∥ T022 ∥ T023 (three separate test files).
- Phase 4/5: US2 (T026) and US3 (T029) can start as soon as Phase 2 is in; T028 ∥ T029.
- Phase 6: T032 ∥ T033 ∥ T034 ∥ T036 ∥ T037 (five separate docs files).

### Sequential Hot Spots (do NOT parallelize)

- `tests/e2e/spec-kitty-work-packages.test.ts` — T025 creates, T039 extends: strictly ordered.
- `src/discovery/adapters/spec-kitty.ts` (T020) lands after all Phase-2 mechanism tasks it consumes.
- Phase 7 is a strict chain: gate → release commit → PR → CI → merge → tag/dispatch.
- `package.json.version` is the ONLY version source (T041); never hand-edit `src/version.generated.ts`.

---

## Parallel Example: User Story 1

```bash
# After the Foundational checkpoint, write the three story-level test files together:
Task: "Re-pin tests/integration/discovery-spec-kitty.test.ts (count parity, claims, SC-002)"
Task: "Re-base tests/integration/parsing-corpus.test.ts against frameworks/spec-kitty/"
Task: "Failing engine pins in tests/unit/engine-spec-kitty.test.ts (collision, slice, no-content, empty changes)"

# Then one implementation task (T024) turns the engine suite green; verify with:
npm run build && npm run test:unit && npm run test:integration
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: branch + fixtures (T001–T005).
2. Phase 2: the three amendments + row re-base, test-first (T006–T020) — CRITICAL gate.
3. Phase 3: parity/corpus/engine pins → build.ts/report.ts/render.ts changes → e2e walkthrough (T021–T025).
4. **STOP and VALIDATE**: sync the upstream-reproduction fixture with zero configuration — one detailed task per WP document, zero roll-up fragments, SC-001/SC-002 hold. That alone fixes the reported breakage.

### Incremental Delivery

1. Setup + Foundational → mechanisms inert-for-others, row corrected.
2. + US1 → the reported defect is gone at plan level (MVP).
3. + US2 → convergence for already-synced repositories (leftovers surfaced, never re-matched).
4. + US3 → lifecycle-proof (lane/activity/review/rename never duplicate).
5. + Polish → docs + ledger + full gate (documentation duty satisfied in the same PR).
6. + Phase 7 → v0.6.0: version-bump commit, PR, CI green, post-merge tag + Release workflow.

---

## Notes

- [P] tasks = different files, no dependencies; never mark two tasks [P] that touch the same file.
- Never "fix" a pin of another identity: other six identities' discovery/parse/plan fixtures and all frozen snapshots (except the sanctioned A-022-0/1/2 regenerations) are byte-frozen (FR-013/SC-005). A foreign pin failing means this change over-reached.
- Recognition is authoritative by data-model §2's decision table; a pathological `WP01-review.md` is a real document (collision path), not a special case (R12).
- The durable anchor lives in `Attachment_Metadata` only; repository `tasks/` files are NEVER written by apply (C6, Principle II).
- Tests: fake `Linear_Port` only, zero credentials, hermetic (raw-CLI manual probes need only a placeholder `LINEAR_ACCESS_TOKEN` — quickstart note).
- Commit after each task or logical group; ALL commits on `022-spec-kitty-wp-tasks`; commit messages carry no self-attribution trailers (repo AGENTS.md).
- Checkpoints are validation points: stop at any of them to independently verify the story delivered so far.
