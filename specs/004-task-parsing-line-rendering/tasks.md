# Tasks: Task Parsing and In-Place Line Rendering

**Input**: Design documents from `specs/004-task-parsing-line-rendering/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R13), data-model.md (§1–8), contracts/ (parsing-api.md, line-rendering.md, adapter-consumption.md, README.md), quickstart.md

**Tests**: INCLUDED — mandatory. Constitution Principle VI (NON-NEGOTIABLE: "Every behavioral change lands with automated tests... every acceptance criterion in the specification MUST be enforced at least once in an automated test") and quickstart.md's traceability table map every FR/SC to specific tests. Test tasks precede implementation tasks (test-first, verify RED before GREEN), per the 002 tasks.md precedent. Property-based and contract tests are required cross-cutting types (Principle VI), realized here as the round-trip/byte-preservation property suite and the parsing-boundary contract tier.

**Organization**: Tasks grouped by user story (US1 = faithful task extraction P1; US2 = byte-respectful line rendering P2). Setup, Foundational, and Polish tasks carry no story label. Wave-2 parallel-safety (ROADMAP): this feature "codes against the 003 adapter *interface* only — using the built-in `generic` adapter as its test fixture — never its internals" — every adapter reference below is the consumer-owned `TaskFileAdapter` (research R1) plus test fixtures in `tests/helpers/parsing-fixtures.ts`; NO task imports or waits on 003 code. Frozen 002 contracts (`specs/002-core-domain-contracts/`, `src/domain`, `src/config`) are **consumed, never modified** (ROADMAP rule 2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]/[US2]**: User-story phases only; Setup, Foundational, and Polish tasks carry no story label
- Test runner: `node:test` + `node:assert/strict` against compiled output; tiers `unit`, `contract`, `integration` (same runner wiring as 002 — `scripts/run-tests.mjs`)
- All paths are repository-root-relative; single npm package; module root `src/parsing/` (disjoint from 003 `src/discovery`/adapters, 005, 006, 007)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Turn the 002-scaffolded package into the place `src/parsing` can live, with the fixture corpus and `generic`-style fixture adapters ready. No parsing logic yet.

- [ ] T001 Add exactly one additive entry to the `exports` map in `package.json`: `"./parsing": { "types": "./dist/parsing/index.d.ts", "default": "./dist/parsing/index.js" }`, mirroring the existing per-module entries (research R12: "package.json gains exactly one additive `exports[\"./parsing\"]` entry"; touches no other field — this is the ONLY shared file this feature edits, single JSON entry, appended last, trivially merge-sequenced by the Wave-3 integrator; `src/index.ts` (002-owned) is NOT touched)
- [ ] T002 [P] Create module and test directory scaffold per plan.md § Source Code: `src/parsing/` with a stub barrel `src/parsing/index.ts` (empty re-exports grow per phase), `tests/fixtures/parsing/`, `tests/fixtures/parsing/golden/`, `tests/fixtures/parsing/frameworks/`, and confirm `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/types/` exist (002 scaffold present — verify only)
- [ ] T003 [P] Create parser fixture task files under `tests/fixtures/parsing/`: `nested.md` (heading tasks + nested checklists with mixed tab/space indentation and a `phase` heading series), `fenced.md` (checkbox syntax `- [ ]` inside ``` and ~~~ fenced blocks incl. an unclosed-fence case), `summary-rollup.md` (Summary/Overview heading section containing checklist items + standalone rollup checkbox), `flat-noheadings.md` (no headings at all), `flat-markers.md` (starts with configured `flatChecklistMarkers` lines, headings later), `dup-identities.md` (two tasks sharing local ID `Task 2.1` and two sharing issue ref `[SYNC-42]`), `conflict.md` (git-style `<<<<<<<`/`=======`/`>>>>>>>` block inside one task section, a second complete block between tasks, and an unterminated `<<<<<<<` case; also checkbox syntax INSIDE the conflict block), `broken-render.md` (a heading task whose line will be corrupted per scenario in US2 tests). All identities are placeholders (`SYNC` default key; zero real organization identifiers)
- [ ] T004 [P] Create five-framework corpus under `tests/fixtures/parsing/frameworks/`: `bmad/tasks.md`, `spec-kit/tasks.md`, `open-spec/tasks.md`, `kiro/tasks.md`, `generic/tasks.md` — each a small task file exercising kind/nesting/line/extent fidelity, authored so the SAME extraction assertion helper runs against all five with only the injected fixture adapter differing (research R10: corpus "differ only in interface-visible conventions")
- [ ] T005 [P] Create the `generic`-style fixture adapters and loaders in `tests/helpers/parsing-fixtures.ts`: `genericFixtureAdapter` (id `"generic"`, NO grammar overrides — inherits merged config — `featureName` derives `<feature>` from `<base>/<feature>/tasks.md` shapes or returns `undefined`), sibling fixture adapters `bmadFixtureAdapter`, `specKitFixtureAdapter`, `openSpecFixtureAdapter`, `kiroFixtureAdapter` (varying ONLY `featureName` derivation and optional grammar sources via the interface, e.g. kiro: `.kiro/specs/<feature>/tasks.md` → `<feature>`), a `minimalCustomAdapter` (id + `headingGrammar` only, mirroring 001 FR-026's minimal custom-adapter shape), a `makeTestConfig(overrides)` helper hand-cloning `builtInDefaults` from `task-linear-sync/config` with placeholder overrides (hand-construct, not `loadConfig` — 002 precedent), and `readFixture(relPath)` using `node:fs` (test-side only) — per contracts/adapter-consumption.md rule 4 (verbatim): "fixture adapters carry zero framework knowledge beyond what the interface exposes; adding a framework must never require parser changes (spec Assumption)"
- [ ] T006 [P] Create golden-file rewrite corpus under `tests/fixtures/parsing/golden/`: paired `<name>.in.md` / `<name>.out.md` for `multi-lf` (multiple assigned lines, LF), `mixed-crlf` (CRLF and mixed terminators), `no-trailing-newline` (final line unterminated), `conflict-untouched` (assigned line outside a conflict block; block bytes identical in golden), and `broken-line.in.md` + a `broken-line.expect-error.json` recording `{ filePath, lineNumber, reason }` for the abort fixture — goldens are hand-authored byte-exact (research R13: "compared to whole-file goldens", never generated by the implementation under test)

**Checkpoint**: Scaffold compiles (`npm run typecheck`), fixtures and goldens in place, fixture adapters type-satisfy `TaskFileAdapter` once T010 exists.

---

## Phase 2: Foundational (Shared Parsing Substrate)

**Purpose**: The content model, adapter-consumption interface, conflict scan, and `Stable_UUID` computation both user stories stand on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — US1's extraction consumes the line/fence model and the UUID; US2's rendering consumes the same terminator-preserving model and the conflict freeze set.

### Tests for the foundational substrate (write FIRST, must fail)

- [ ] T007 [P] Content-model unit tests in `tests/unit/parsing-content.test.ts` per research R4: terminator-preserving split (`\r\n`, `\n`, final unterminated line; 1-based `number`), leading-tab expansion for `indentWidth` at `config.tabWidth` (2) "used for nesting/extent comparisons" while `originalIndent` holds "the raw leading-whitespace bytes (used verbatim by the renderer)", and the fence map — opening `^ {0,3}(`{3,}|~{3,})`, close "at a line of the same char with length ≥ the opening length", "interiors (and the fence delimiter lines themselves) are `inFence: true` and non-task" (quote verbatim from R4); run against `tests/fixtures/parsing/fenced.md`
- [ ] T008 [P] Stable-UUID unit tests in `tests/unit/parsing-identity.test.ts` per research R3 and the frozen seed: seed obtained ONLY via the frozen `taskStableSeed` — verbatim frozen layout "`frameworkId + \"\\u0000\" + (featureName ?? \"\") + \"\\u0000\" + (localTaskId ?? `${ordinal}:${filePath}`)`"; `deriveStableUuid(seed, toolId)` output matches `^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (v5-shaped, lowercase); same seed bytes ⇒ same UUID across calls; property test re-asserting constitution II at UUID level (verbatim): "Every task MUST have a deterministic `Stable_UUID` derived from its stable positional seed... excluding mutable content such as title text, checkbox state, and the visible issue prefix" — mutate `title`, `checked`, and a visible `[SYNC-9]` prefix on a fixture task, `stableUuid` unchanged
- [ ] T009 [P] Conflict-scan unit tests in `tests/unit/parsing-conflict.test.ts` per research R7: markers opening `^<{7,}`, separator `^={7,}(=.*)?$` "inside an open block", closing `^>{7,}`; complete span → `ConflictBlock { startLine, endLine }`; "an unterminated opening marker extends the block to EOF (defensive freeze)"; fence-aware (markers inside fences are not blocks); blocks never overlap; run against `tests/fixtures/parsing/conflict.md`
- [ ] T010 [P] Import-purity contract test in `tests/contract/parsing-purity.test.ts` per contracts/adapter-consumption.md rule 1 (verbatim): "every import inside `src/parsing/**` resolves to `node:*`, a relative path within the module, or the frozen `task-linear-sync/domain` / `task-linear-sync/config` subpath exports. A contract test scans the module's import statements and fails on any 003/005/006/007 module path or on `node:fs`/`node:path`/`node:child_process`/`node:net` (research R12)" — implement as a source-text scan of `src/parsing/*.ts` (walk the directory, parse import specifiers; test-side `node:fs` use is allowed here, only `src/parsing/` is scanned)

### Implementation — shared substrate

- [ ] T011 Implement `src/parsing/adapter.ts`: the consumer-owned `TaskFileAdapter` interface exactly as contracts/adapter-consumption.md declares — `id: FrameworkId`, `featureName(taskFilePath: string): string | undefined`, optional `headingGrammar?`, `phasePattern?`, `summaryPattern?`, `rollupPattern?`; JSDoc states (verbatim, rule 2): "`parseTaskFile` consumes only the members above. Extra members a real adapter carries (`detect`, `taskFilePatterns`, `titleBehavior`, `agentHooksDirectory`) are invisible to the parser — structural typing means 003 may add or evolve them with zero 004 impact" and cite 002 data-model § 3 as the frozen source of member names (research R1: this is the subset frozen there, "the interface *members* are not invented here")
- [ ] T012 Implement `src/parsing/content.ts`: `ContentLine { number, text, terminator, originalIndent, indentWidth, inFence }`, `splitLines(content)`, tab expansion per T007 rules (`config.tabWidth`), fence pass per R4 — "one split feeds both user stories, so parsing and rendering cannot disagree about line numbering or bytes" (research R4); export the type for internal use + fence-set queries (`lineIsFenced(lineNumber)`)
- [ ] T013 [P] Implement `src/parsing/identity.ts`: `deriveStableUuid(seed: string, toolId: string): string` per R3 — "digest = `sha256(namespacePrefix(toolId) + seed)` with `namespacePrefix` a fixed `toolId`-derived constant; version nibble set to `5`, variant bits per RFC 4122, lowercase 8-4-4-4-12 rendering" (quote verbatim; `node:crypto` only); NEVER re-format the seed — callers pass `taskStableSeed(...)` output from `task-linear-sync/domain` verbatim
- [ ] T014 [P] Implement `src/parsing/conflict.ts`: `scanConflictBlocks(lines: readonly ContentLine[]): ConflictBlock[]` per T009/R7 rules, plus `blocksIntersecting(startLine, endLine, blocks): boolean` helper for the extent→flag step and a `frozenLineSet(blocks)` helper consumed by the renderer's freeze rule
- [ ] T015 Verification: run `npm run typecheck`, `npm run test:unit -- --test-name-pattern "content|identity|conflict"`, `npm run test:contract -- --test-name-pattern "purity"` to GREEN; extend the `src/parsing/index.ts` barrel to re-export `TaskFileAdapter`, `deriveStableUuid`, `scanConflictBlocks` (public because 008 consumes `deriveStableUuid` for synthetic tasks and re-runs scans); confirm fixture adapters in `tests/helpers/parsing-fixtures.ts` type-satisfy `TaskFileAdapter`

**Checkpoint**: Shared substrate green. US1 and US2 can now proceed in parallel (disjoint files: `extract/extent/warnings/taskfile` vs `title/render`).

---

## Phase 3: User Story 1 - Faithful task extraction (Priority: P1) 🎯 MVP

**Goal**: `parseTaskFile(filePath, content, adapter, config) → ParseResult` delivering FR-001…FR-010: heading + checklist tasks with "1-based line numbers, parent/child nesting, phase labels, derived `Task_Body` extents, parsed local task IDs and visible issue references, and a derived `Feature_Name` — while fenced code, summary sections, and rollup checklists are excluded with recorded reasons, and duplicate identities are warned about with every affected line" (spec US1, verbatim).

**Independent Test**: (spec, verbatim) "Parse fixtures with nested checklists, fenced blocks containing checkbox syntax, summary/rollup sections, flat documents, duplicate IDs, and conflict marker blocks; assert the full per-task field set, exclusion records, warnings, and extent boundaries — file content in, task objects out, no tracker." (Run: `npm run test:unit -- --test-name-pattern "parsing"` + `npm run test:integration -- --test-name-pattern "parsing corpus"`)

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [ ] T016 [P] [US1] Extraction unit tests in `tests/unit/parsing-extract.test.ts` per contracts/parsing-api.md rules 1–6: heading tasks matched by the grammar named groups `id`/`title` and checkbox lines per `flatChecklistMarkers`, "Fence interiors and fence delimiter lines are never tasks" (fixtures `nested.md`, `fenced.md`; FR-001); mixed tab/space nesting equals the space-equivalent file and "attaching orphans to the enclosing heading task" (FR-002); `Task.phase` = "most recent heading matching the resolved `phasePattern`... phase headings are not tasks" (FR-003); flat triggers for both branches of FR-005 ("those without grammar-matching headings, or matching configured flat markers"); issue-ref parse `\\[(<confirmationKey>)-(\\d+)\\]` → `issueRef { key, number }` and leading local ID recorded, `checked` present iff checklist, frozen invariant `kind === "heading"` ⇔ `checked === undefined` (FR-006); adapter-override precedence table — adapter-supplied `headingGrammar` beats merged config, absent member falls back, `minimalCustomAdapter` (id + grammar only) still extracts (contracts/adapter-consumption.md rules 2–3)
- [ ] T017 [P] [US1] Extent unit tests in `tests/unit/parsing-extent.test.ts` per contracts/parsing-api.md rule 10 and spec FR-010 (verbatim): extent is "the task line plus all content beneath it up to the next task or next equal-or-shallower heading, including nested checklist children" — operationalized per research R5: end before the first following non-descendant task or ≤-level heading (any heading for checklists), descendants stay inside, leaf task ⇒ `endLine === startLine`, inclusive `TaskBodyExtent` semantics from the frozen 002 shape
- [ ] T018 [P] [US1] Exclusion + warning unit tests in `tests/unit/parsing-exclusions-warnings.test.ts`: FR-004 (verbatim) summary-section and rollup items excluded "per configured patterns, recording each excluded item with its line number and an exclusion reason" — `ExclusionRecord { lineNumber, kind, reason: "summary-section" | "rollup", text }`, absent from `file.tasks`, and fenced pseudo-tasks are silently non-tasks, NOT exclusions (research R6 + R4); FR-007 (verbatim) warnings "identifying the shared value and all 1-based line numbers, when tasks within one file share a local task ID or share an issue reference" — fixture `dup-identities.md` yields exactly `{ kind: "duplicate-local-id", value: "Task 2.1", lineNumbers: [a, b] }` and the `[SYNC-42]` equivalent, ascending, parse still succeeds
- [ ] T019 [P] [US1] Five-framework corpus integration test in `tests/integration/parsing-corpus.test.ts` (test names contain "parsing corpus") per research R10 and spec SC-001 (verbatim): "100% of tasks in the five-framework fixture corpus are extracted with correct kind, nesting, line numbers, section extent, and derived feature name" — run one shared assertion helper over `tests/fixtures/parsing/frameworks/*` with only the fixture adapter injected, passing each fixture's content under a representative virtual repository path (e.g. `.kiro/specs/auth/tasks.md` for kiro, `specs/auth/tasks.md` for spec-kit — `parseTaskFile` takes `filePath` as a parameter, so no on-disk placement is needed) so `featureName` derivation is exercised per framework; assert `featureName` threading incl. the none-derivable case: FR-008 (verbatim) "derive the file's `Feature_Name` using the active framework adapter, recording none when none can be derived"; also assert FR-009 flagging on the shared fixtures: task whose section contains conflict markers → `unresolvedConflict: true`, block-interior lines never tasks

### Implementation for User Story 1

- [ ] T020 [US1] Implement `src/parsing/extract.ts`: convention resolution exactly per research R2 — `adapter.<convention>() ?? config.<grammar key>` over `headingIdGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern` with "No key is added to the frozen `ResolvedConfig`"; extraction pass producing raw `Task` drafts (kind, `lineNumber` 1-based, raw `title` from grammar `title` group or post-marker checkbox text with leading local-ID/visible-ref parsed out, `checked` iff checklist, `issueRef`, `localTaskId`, `phase`), indent-stack nesting with tab-normalized depth (`parentUuid`, ordered `childUuids`, orphan → enclosing heading task), summary-section and rollup `ExclusionRecord`s, flat-document pre-scan (both triggers)
- [ ] T021 [P] [US1] Implement `src/parsing/extent.ts`: `deriveExtents(tasks, lines)` producing `TaskBodyExtent { startLine, endLine }` per T017/T020 — computed after the full scan so "the 'next task' boundary is exact regardless of scan order" (research R5), descendants inside the parent extent
- [ ] T022 [P] [US1] Implement `src/parsing/warnings.ts`: `collectDuplicateWarnings(tasks)` per contracts/parsing-api.md rule 7 — one `ParseWarning` per shared value across the pooled heading+checklist set, "lineNumbers... sorted ascending", deterministic scan order (research R11); no failure, warning only
- [ ] T023 [US1] Implement `src/parsing/taskfile.ts`: the `parseTaskFile(filePath, content, adapter, config): ParseResult` orchestrator per contracts/parsing-api.md — split → conflict scan → extract (excluding block-interior lines) → extents → per task: `unresolvedConflict = blocksIntersecting(taskBody)` (FR-009), `stableUuid = deriveStableUuid(taskStableSeed(task, { ordinal, filePath }), config.toolId)` with ordinal = 0-based index in ascending-line order (contracts/parsing-api.md rule 11), `frameworkId = adapter.id`, `featureName` from `adapter.featureName(filePath)` onto file + tasks — "a pure function over file content plus the adapter conventions from 003" (spec Purpose); update `src/parsing/index.ts` to export `parseTaskFile` and the `ParseResult`/`ExclusionRecord`/`ParseWarning` record types
- [ ] T024 [US1] Run `npm run test:unit -- --test-name-pattern "parsing"`, `npm run test:integration -- --test-name-pattern "parsing corpus"`, `npm run test:contract` to GREEN over `src/parsing/{extract,extent,warnings,taskfile}.ts` and `tests/{unit/parsing-extract,unit/parsing-extent,unit/parsing-exclusions-warnings,integration/parsing-corpus}.test.ts`; verify SC-001 corpus fidelity 100% and repeat-parse deep-equality determinism (Principle IV); this is the MVP checkpoint

**Checkpoint**: At this point User Story 1 is fully functional and testable independently — extraction fidelity (SC-001) proven against interface fixtures only, zero 003 code imported. This is the MVP.

---

## Phase 4: User Story 2 - Byte-respectful line rendering (Priority: P2)

**Goal**: `renderTaskLines(filePath, content, assignments, config, options?) → RenderResult` delivering FR-011…FR-013: emitted line = "the configured issue-reference prefix precedes the cleaned desired title, with original indentation, heading level, and a present local task ID preserved unless configured otherwise, and checkbox state set from the assignment or retained"; rewrite "bottom-to-top" with byte identity elsewhere; structural surprise ⇒ "rendering of that file halts, the file is left unmodified, and an error identifies file path and line number" (spec US2 AC 1–3, verbatim). Pure over strings — zero I/O, so abort leaves any file trivially unmodified (constitution I posture, research R8).

**Independent Test**: (spec, verbatim) "Rewrite fixtures bottom-to-top; diff against golden files asserting byte identity of untouched lines, preserved trailing-newline style, preserved indentation/heading level/local ID, untouched conflict blocks; corrupt one expected line structure and assert a file-path + line-number error with the file left unmodified." (Run: `npm run test:unit -- --test-name-pattern "render"` + `npm run test:contract -- --test-name-pattern "golden"`)

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [ ] T025 [P] [US2] Render unit tests in `tests/unit/parsing-render.test.ts` per contracts/line-rendering.md: emitted line shape — `` `[${config.confirmationKey}-${issueRef.number}] ` + cleanTitle(desiredTitle) `` after the byte-preserved structural prefix; "preserved **structural prefix** (exact original bytes from line start through the heading hashes `#{1,6}`, the present local task ID span — unless `preserveLocalTaskId === false` — and the checkbox marker plus following whitespace)" (quote verbatim); checkbox "set `[ ]`/`[x]`/`[X]` from `assignment.checked` when provided; when `undefined` the original state byte is retained byte-for-byte"; abort matrix — corrupted heading level, removed checkbox marker, assignment inside a fence / inside a `ConflictBlock` (from `tests/fixtures/parsing/conflict.md`), `lineNumber` past EOF ⇒ `LineRenderError { filePath, lineNumber, reason: "structure-mismatch" | "inside-conflict-block" | "inside-fence" | "line-out-of-range" }` with NO content returned (FR-013, SC-003)
- [ ] T026 [P] [US2] Golden-corpus contract test in `tests/contract/parsing-golden.test.ts` per research R13: for each `tests/fixtures/parsing/golden/<name>.in.md` + assignment set, whole-file `assert.equal(rendered, golden)` — FR-012 (verbatim): "System MUST rewrite assigned lines bottom-to-top, reproduce the original trailing-newline style exactly, leave unassigned lines byte-identical, and leave unresolved conflict blocks byte-for-byte untouched"; SC-002 (verbatim): "Across the golden-file rewrite corpus, 0 bytes differ outside explicitly assigned lines, and trailing-newline style is preserved in 100% of fixtures"; the broken fixture asserts the recorded `LineRenderError` and byte-identical input after the throw
- [ ] T027 [P] [US2] Property/round-trip suite in `tests/integration/parsing-roundtrip.test.ts` (seeded PRNG only — deterministic, Principle VI "no... wall-clock nondeterminism"): (a) random assignment subsets over generated files leave every unassigned line's bytes identical and never emit inside a conflict block; (b) double-render is a byte fixpoint; (c) parse → render → parse reproduces identical titles — constitution IV (verbatim): "rendering round-trips (parse → derive → render → parse reproduces identical titles with no progressive prefixing)"; SC-003 posture: every corrupted generated file halts with file+line error and identical input bytes after

### Implementation for User Story 2

- [ ] T028 [US2] Implement `src/parsing/title.ts`: `cleanTitle(text, { confirmationKey, localTaskId, titleStripPrefixes })` iterating to a fixpoint per research R9 — FR-011 cleaning scope (verbatim): "titles are cleaned of configured strip prefixes, redundant issue prefixes, and duplicate leading local-ID prefixes"; strips `[<KEY>-<N>]` and bare `<KEY>-<N>` for the configured key and leading `Task 1.2:`/`T001 —`-style duplicate local-ID prefixes, collapsing leading whitespace; exported for 005's derivation reuse
- [ ] T029 [US2] Implement `src/parsing/render.ts`: `renderTaskLines(filePath, content, assignments, config, options?)` + `LineAssignment`/`RenderResult`/`LineChange`/`LineRenderError`/`RenderOptions` types per contracts/line-rendering.md — validate-ALL assignments first (same kind/heading-level/checkbox-marker at the recorded line, not fenced/conflicted/in-range) then apply in "descending `lineNumber`" bottom-to-top order into the terminator-preserving line array (research R8), "terminators are never regenerated, only carried"; conflict-block lines are frozen (assignment → abort, `frozenLineSet` from T014); returns `RenderResult { content, changes: { lineNumber, before, after }[] ascending }` — the `expectedMarkdownChanges` material provided to 009; export from `src/parsing/index.ts` alongside `cleanTitle`; "this module performs no file I/O — the caller (008's gated engine) writes the returned content" (contract header)
- [ ] T030 [US2] Run `npm run test:unit -- --test-name-pattern "render"`, `npm run test:contract -- --test-name-pattern "golden"`, `npm run test:integration -- --test-name-pattern "round-trip"` to GREEN over `src/parsing/{title,render}.ts` and `tests/{unit/parsing-render,contract/parsing-golden,integration/parsing-roundtrip}.test.ts`; SC-002 golden byte-exactness and SC-003 abort-all-cases confirmed

**Checkpoint**: US1 AND US2 both work independently. SC-002/SC-003 proven mechanically; 008 can now drive gated applies through `renderTaskLines`, 005 reuses `cleanTitle`, 009 consumes `RenderResult.changes`.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T031 [P] Create parsing-surface snapshot contract test `tests/contract/parsing-surface.test.ts` + checked-in snapshot `tests/contract/snapshots/parsing-surface.json`: exact export set of `src/parsing` (mirrors the 002 T008 frozen-surface pattern at feature scale) — "005/008/009 consumers get drift alarms; changes land deliberately" (quickstart boundary validation 3)
- [ ] T032 [P] Create negative-type assertion file `tests/types/parsing.test-d.ts` compiled by `npm run typecheck` (002 precedent): `src/parsing` exposes no fs/write/Stream surface (`RenderResult.content` is a plain string; no file-handle type escapes); `parseTaskFile` requires all four parameters; `TaskFileAdapter` is the only adapter type accepted — Principle I purity and the adapter boundary are compile-checked where the type system can express it
- [ ] T033 [P] Author `docs/parsing.md` per constitution "Documentation duty" ("whenever a public API... changes, the documentation MUST be updated in the same change"): module purpose, `parseTaskFile` / `renderTaskLines` / `cleanTitle` / `deriveStableUuid` usage with placeholder identifiers only, the adapter-consumption boundary, and the Wave-3 seam note (contracts/adapter-consumption.md rule 5: the named swap-in test `003-generic-adapter-satisfies-consumption-contract` is added by the integrating wave, "with **zero changes** inside `src/parsing/`") — do NOT edit README.md (shared file)
- [ ] T034 Run the full quickstart.md validation checklist: US1 scenarios 1–8, US2 scenarios 1–4, boundary & packaging 1–4 (incl. `task-linear-sync/parsing` resolving post-build with `dist/parsing/index.js` + `.d.ts`); record SC-001/SC-002/SC-003 traceability results; `npm test` green with the coverage threshold gate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — the 002 package already exists; T001–T006 touch disjoint files (T001 `package.json` is the only shared-file touch, one additive entry)
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS both user stories** (US1 consumes `content.ts` line/fence model + `identity.ts`; US2 consumes the same line model + `conflict.ts` freeze set; the barrel grows here)
- **User Stories (Phases 3–4)**: Both depend only on Foundational → can proceed **fully in parallel** (US1: `extract/extent/warnings/taskfile` + their tests; US2: `title/render` + their tests — disjoint file sets; `src/parsing/index.ts` edits are sequenced T023 → T029)
- **Polish (Phase 5)**: Depends on the stories it certifies

### User Story Dependencies

- **US1 (P1, extraction)**: After Phase 2; zero dependency on US2 — "file content in, task objects out, no tracker" (spec Independent Test)
- **US2 (P2, rendering)**: After Phase 2; consumes the Foundational line model and can build assignments from hand-constructed `Task` fixtures — it does NOT depend on US1's `parseTaskFile` existing (the round-trip property test T027 is the only task using both, and it lives in the US2 phase precisely because it certifies US2's idempotency claim)

### Within Each User Story

- Tests written first and observed FAILING (constitution VI), then implementation
- `content.ts`/`conflict.ts`/`identity.ts` (Foundational) before all story logic; `extract.ts` → `extent.ts`/`warnings.ts` → `taskfile.ts` orchestrator (T023 depends on T020–T022); `title.ts` before `render.ts` (T029 depends on T028)
- Story checkpoint green before claiming completion

### Parallel Opportunities

- Setup: T002–T006 in parallel after T001/T002 scaffold (disjoint paths)
- Foundational: T007–T010 (all test files) in parallel; then T011 (interface) unlocks T012/T013/T014 in parallel; T015 verification
- US1: T016–T019 (test files) in parallel; then T021/T022 in parallel with T020 (different files), T023 orchestrator last
- US2: T025–T027 (test files) in parallel; US1 and US2 implementation tracks fully parallel after Phase 2
- Polish: T031–T033 in parallel
- Cross-feature: none needed — this branch never touches 003/005/006/007 files (ROADMAP: 004 consumes "the 003 adapter *interface* only — using the built-in `generic` adapter as its test fixture — never its internals")

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (RED first):
Task: "Extraction unit tests in tests/unit/parsing-extract.test.ts"                 # T016
Task: "Extent unit tests in tests/unit/parsing-extent.test.ts"                       # T017
Task: "Exclusion + warning unit tests in tests/unit/parsing-exclusions-warnings.test.ts"  # T018
Task: "Five-framework corpus integration test in tests/integration/parsing-corpus.test.ts" # T019

# Then implement (T020 core scan first; T021/T022 parallel; orchestrator last):
Task: "Implement src/parsing/extract.ts"     # T020
Task: "Implement src/parsing/extent.ts"      # T021  (parallel with T020/T022)
Task: "Implement src/parsing/warnings.ts"    # T022  (parallel with T020/T021)
Task: "Implement src/parsing/taskfile.ts"    # T023  (after T020–T022)
```

## Parallel Example: User Story 2 (concurrent with US1 after Phase 2)

```bash
Task: "Render unit tests in tests/unit/parsing-render.test.ts"        # T025
Task: "Golden-corpus contract test in tests/contract/parsing-golden.test.ts"  # T026
Task: "Property/round-trip suite in tests/integration/parsing-roundtrip.test.ts"  # T027
Task: "Implement src/parsing/title.ts"       # T028
Task: "Implement src/parsing/render.ts"      # T029 (after T028)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (fixtures, fixture adapters, exports entry)
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; substrate + boundary + UUID)
3. Complete Phase 3: US1 faithful extraction
4. **STOP and VALIDATE**: `npm run test:integration -- --test-name-pattern "parsing corpus"` + US1 unit tier green — SC-001 corpus fidelity proven with zero 003 code; extraction alone unblocks 005's attribute consumption for its own tests
5. Ship MVP: content in → task objects out

### Incremental Delivery

1. Setup + Foundational → shared substrate + frozen-boundary tests green
2. Add US1 → extraction live (MVP; SC-001)
3. Add US2 → rendering live, byte-respectful (SC-002, SC-003) → full feature exit criteria (quickstart) reachable
4. Polish → surface snapshot, type-level negatives, docs, full-suite coverage gate; Wave 3 later swaps the fixture adapter for 003's real `generic` adapter with zero `src/parsing/` changes

### Parallel Team Strategy

1. One dev: Setup + Foundational (sequential-ish; the substrate is small)
2. Then split: Dev A: US1 (`extract/extent/warnings/taskfile`); Dev B: US2 (`title/render`) — disjoint files, same module directory
3. Reunite for Phase 5 (snapshot, types, docs, full validation)

---

## Notes

- [P] tasks = different files, no dependencies
- Tests are mandatory in this feature (constitution VI "NON-NEGOTIABLE"); verify RED before GREEN at each story checkpoint; property-based and contract tiers are required cross-cutting types, not extras
- Frozen-contract discipline: no task here edits `specs/002-core-domain-contracts/**`, `src/domain/**`, `src/config/**`, or `src/index.ts`; frozen shapes/seed layout/config keys are quoted verbatim in the relevant tasks and consumed via `task-linear-sync/{domain,config}` (ROADMAP rule 2)
- Adapter discipline: NOTHING imports 003; the fixture adapters in `tests/helpers/parsing-fixtures.ts` are the sanctioned oracle until the Wave-3 named-seam test swaps in the real `generic` adapter (contracts/adapter-consumption.md)
- The parsing/render pair performs zero I/O (`node:crypto` is the only node built-in in `src/parsing/`); T010's purity scan enforces it — "the caller (008's gated engine) writes the returned content"
- Zero real organization identifiers anywhere in fixtures/goldens (release-scan posture; `SYNC` default key, placeholder refs)
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: same-file conflicts between [P] tasks (notably `src/parsing/index.ts` — sequenced T015 → T023 → T029), cross-story coupling (US2 tests hand-build `Task` fixtures, they do not call `parseTaskFile` except in the round-trip suite), and any deviation from the frozen 002 field lists
