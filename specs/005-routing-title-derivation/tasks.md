# Tasks: Path Routing and Title Derivation

**Input**: Design documents from `specs/005-routing-title-derivation/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md (§1–7), contracts/ (routing-resolution.md, title-derivation.md), quickstart.md

**Tests**: INCLUDED — mandatory. Constitution Principle VI (NON-NEGOTIABLE: "Every behavioral change lands with automated tests... every acceptance criterion in the specification MUST be enforced by at least one automated test") and quickstart.md's traceability table map every FR (001–005) and SC (001–002) to specific tests. Test tasks precede implementation tasks (test-first, verify RED before GREEN). The SC-002 test is a **property-based** round-trip, a constitution-required property type ("rendering round-trip stability where parse then derive then render then parse reproduces the same final titles with no progressive `Feature_Name` prefixing").

**Organization**: Tasks grouped by user story (US1 = routing P1, US2 = title derivation P2). Setup/Foundational/Polish tasks carry no story label; user-story tasks carry [US1]/[US2].

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on an incomplete task)
- **[US1]/[US2]**: User-story phases only; Setup, Foundational, and Polish tasks carry no story label
- Test runner: `node:test` + `node:assert/strict` against compiled output (002 precedent); tiers `unit`, `contract`, `integration`, `e2e`
- All paths are repository-root-relative; single npm package; 005 owns only `src/routing/` and `src/titles/` (+ their `tests/` counterparts)
- **Frozen-contract rule** (ROADMAP rule 2 / 002 FR-008): 005 **imports** `RoutingResolution`, `ProjectByPathEntry`, `Task`, and `ResolvedConfig` slices from `002`; it MUST NOT redefine or edit them
- **No-shared-files rule** (research R3): 005 does NOT edit `package.json` or `src/index.ts` in Wave 2; tests import compiled `src/routing`/`src/titles` output by relative path under `build/` (no package-name subpath needed)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixture data both user stories (and the e2e walkthrough) consume; the two new source directories. Placeholder identities only — zero real organization identifiers (release-gate scan, quickstart Prerequisites).

- [X] T001 [P] Create routing fixture maps in `tests/fixtures/routing-titles/routing-maps.ts`: a nested-prefix map (`specs/`, `specs/api/`, `specs/api/auth/` → distinct `{teamKey, project}`), an equal-length-tie map (two matching prefixes of identical character length), a default map (`defaultTeamKey`/`defaultProject` set), a missing-defaults map (both empty strings), and an empty map (`projectByPath: []`) — all with placeholder identities (`acme-team`, `proj-alpha`, `acme-team-b`…) per quickstart
- [X] T002 [P] Create task/routing factories + path corpus in `tests/fixtures/routing-titles/factories.ts`: `makeTask(overrides)` returning a minimal valid frozen `Task` (required fields `kind`, `filePath`, `lineNumber≥1`, `frameworkId`, `title`, `childUuids: []`, `taskBody: {startLine,endLine}`, `unresolvedConflict: false`; optional `featureName`/`localTaskId`/`phase`/`issueRef`/`parentUuid`), `makeRoutingSlice(overrides)` for `RoutingConfigSlice`, and a `pathCorpus` array of `{ filePath, expected: RoutingResolution }` for routing (placeholder feature names `user-authentication`, `payments-refund`)
- [X] T003 [P] Create title-rule + title fixtures in `tests/fixtures/routing-titles/title-fixtures.ts`: ordered `titleRules: readonly string[]` presets — the 001 Requirement 6 informative-note shape using `<areaPrefixA>`/`<areaPrefixB>`/`<areaPrefixC>` placeholders (infrastructure-area-with-localId, delivery-area-with-phase, delivery-area-without-phase, checklist-child `{title}`, catch-all), a bare-template catch-all, and a rule referencing an absent attribute; `titleStripPrefixes` presets; and preset titles already carrying `<featureName>: `, `[SYNC-7] `, and a leading `Task 1.2: ` local-ID prefix — **all prefixes are placeholders**, zero org/product literals
- [X] T004 [P] Create the source directory scaffold `src/routing/` and `src/titles/` (modules are added incrementally in the story phases; **no `package.json` or `src/index.ts` edits** — public subpath export wiring is deferred to Wave-3 integration per plan.md § Structure Decision / research R3)

**Checkpoint**: Fixtures + module dirs in place; `npm run build && npm run typecheck && npm run lint` still green on an otherwise-empty 005 source.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The frozen-contract import guard (must hold before any contract test) and the two 005-local type modules the story modules import. These block both user stories.

**⚠️ CRITICAL**: No user story work can begin until the frozen-imports guard exists and the two `types.ts` modules compile.

- [X] T005 [P] Create frozen-contract import guard test `tests/contract/frozen-imports-005.test.ts`: assert `RoutingResolution`, `ProjectByPathEntry`, `Task` are **imported** from the frozen 002 modules (`src/domain/routing.js`, `src/domain/task.js`), and that **no** file under `src/routing/` or `src/titles/` declares its own `RoutingResolution` / `ProjectByPathEntry` / `Task` (a source-scan assertion: `src/routing`/`src/titles` may `import type { RoutingResolution }` but MUST NOT contain `interface RoutingResolution`/`interface ProjectByPathEntry`/`interface Task`) — enforcing ROADMAP rule 2 / 002 FR-008 ("anything frozen in 002 ... is edited only via an amendment")
- [X] T006 [P] Implement `src/routing/types.ts`: `RoutingConfigSlice { readonly projectByPath: readonly ProjectByPathEntry[]; readonly defaultTeamKey: string; readonly defaultProject: string }` — `ProjectByPathEntry` **imported from** `../domain/routing.js` (frozen), never re-declared (data-model §1)
- [X] T007 [P] Implement `src/titles/types.ts`: 005-local `TitlePredicate { attr: "featureName"|"localId"|"phase"|"framework"|"kind"|"path"|"child"|"issueRef"; negated: boolean; op: "present"|"eq"|"startsWith"; value?: string }`, `TitleRule { order: number; when?: TitlePredicate[]; template: string }`, `TitleDerivation { finalTitle: string; baseTitle: string; matchedRuleIndex: number; defaulted: boolean; unresolvedPlaceholders: readonly string[]; decorated: boolean }`, `TitleConfigSlice { titleRules: readonly string[]; titleStripPrefixes: readonly string[]; confirmationKey: string }` (data-model §3–7); `Task` **imported from** `../domain/task.js`

**Checkpoint**: Frozen-imports guard passes; both type modules compile. US1 (`src/routing/*`) and US2 (`src/titles/*`) can now proceed fully in parallel — disjoint file sets, no shared files.

---

## Phase 3: User Story 1 - Deterministic destination routing (Priority: P1) 🎯 MVP

**Goal**: Resolve each task's file path to `{team, project}` via the consumer-supplied path-prefix map — longest prefix wins, equal-length ties broken deterministically by configured map order with a recorded indication, default fallback, and unassigned-with-indication when neither exists — as a pure function returning the frozen `RoutingResolution` (005 FR-001/FR-002; contracts/routing-resolution.md is the normative behavioral contract; research R1/R7).

**Independent Test**: "Evaluate routing over a fixture path corpus against maps with nested prefixes, equal-length ties, empty maps, and missing defaults; assert selection, tie-break indications, default application, and unassigned-with-indication behavior — pure function, no tracker." (Run: `npm run test:unit -- --test-name-pattern "routing"` + `npm run test:integration -- --test-name-pattern "routing corpus"`)

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [X] T008 [P] [US1] Unit tests in `tests/unit/routing-resolve.test.ts` per contracts/routing-resolution.md § Normative behavior: (AC1/FR-001) "select the entry whose matching prefix has the greatest character length, routing the task to both the selected entry's `Team_Key` and its project" — nested prefixes, deepest wins, `matchedPrefix` set, `defaulted:false`; (AC2/FR-001) "IF two or more configured path prefixes match ... with an identical character length, THEN ... select the first such entry by the map's defined ordering and record a deterministic tie-break indication" → `tieBreak:"first-by-map-order"`, earliest-by-index selection, identical across re-runs; (AC3/FR-002) unmatched → `defaulted:true` with default team/project; "an absent or empty routing map applies the default path to every task"; (AC4/FR-002) no match + no defaults → `{ teamKey:"", project:"", defaulted:false, unassigned:true }` and "without terminating processing of remaining tasks" (a multi-unrouted corpus all resolve, none abort)
- [X] T009 [P] [US1] SC-001 integration test in `tests/integration/routing-corpus.test.ts`: resolve every `filePath` in `pathCorpus` (T002) → 100% match the designed `RoutingResolution`; and "identical results on every re-run" — deep-equal (canonicalized JSON) of two independent passes proves determinism (SC-001)
- [X] T010 [P] [US1] Frozen-shape contract test in `tests/contract/routing-resolution-shape.test.ts`: `resolveRouting` returns a value whose key set is **exactly** `RoutingResolution`'s frozen keys (`teamKey`, `project`, `matchedPrefix?`, `defaulted`, `tieBreak?`, `unassigned?`) — no added field, no widened optionality — proving 006 can consume the frozen type without importing 005 internals (contracts/routing-resolution.md § Frozen-shape guarantee)

### Implementation for User Story 1

- [X] T011 [US1] Implement `src/routing/resolve.ts`: `resolveRouting(filePath, config: RoutingConfigSlice): RoutingResolution` (`RoutingResolution` imported from `../domain/routing.js`) — literal `filePath.startsWith(prefix)` over **non-empty** prefixes (no path-segment normalization); greatest `prefix.length` wins; equal max length ⇒ earliest by `projectByPath` array index + `tieBreak:"first-by-map-order"`; no match **and** both `defaultTeamKey`+`defaultProject` non-empty ⇒ `defaulted:true` (matchedPrefix/tieBreak absent); else `{ teamKey:"", project:"", defaulted:false, unassigned:true }` (research R1/R7); absent/empty `projectByPath` ⇒ default-or-unassigned for every task; **no hardcoded** team/project/prefix literal (001 R4.6)
- [X] T012 [US1] Create `src/routing/index.ts` barrel re-exporting `./resolve.js` and `./types.js` (005-owned barrel only; **no `package.json`/`src/index.ts` edit** — Wave-3 integration registers the `./routing` subpath)
- [X] T013 [US1] Run to GREEN: `npm run test:unit -- --test-name-pattern "routing"`, `npm run test:integration -- --test-name-pattern "routing corpus"`, `npm run test:contract -- --test-name-pattern "routing-resolution-shape"`; confirm `tests/contract/frozen-imports-005.test.ts` (T005) still passes

**Checkpoint**: US1 fully functional and independently testable — routing resolves the corpus deterministically (SC-001), ties recorded, defaults/unassigned correct, frozen `RoutingResolution` shape exact. **This is the MVP.** 006 can consume `RoutingResolution`.

---

## Phase 4: User Story 2 - Idempotent title derivation (Priority: P2)

**Goal**: Derive issue titles from ordered first-match-wins rules with `{placeholder}` substitution and the built-in pass-through default, and decorate/prefix-strip the idempotent `<Feature_Name>: ` prefix so titles never compound across runs (005 FR-003/FR-004/FR-005; contracts/title-derivation.md is the normative contract; research R2/R4/R5/R6).

**Independent Test**: "Run derivation → mirror → render-back → re-derivation for ten cycles over tasks with and without `Feature_Name`, with matching/non-matching rules, unresolvable placeholders, and preset titles already carrying prefixes; assert the final title is stable byte-for-byte from cycle 1 onward and strip-on-render removes exactly the decorated prefix set." (Run: `npm run test:integration -- --test-name-pattern "roundtrip"`)

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [X] T014 [P] [US2] Unit tests in `tests/unit/titles-rules.test.ts` per research R2 / data-model §3–4: `parseTitleRules` is total; each rule splits on the **first** `" => "` into guard/template; a bare template (no `" => "`) is a catch-all (`when` absent ⇒ matches every task); a malformed rule throws `TitleRuleParseError` carrying `index` + `rule`; `evaluateGuard` honors present / `!`-negated / `attr=value` (`framework`⇔`frameworkId`, `kind`⇔`kind`) / `path~value` (`filePath.startsWith`) / `child` (`parentUuid !== undefined`) / `issueRef` predicates
- [X] T015 [P] [US2] Unit tests in `tests/unit/titles-template.test.ts` per research R5: substitution over the normative set (`{title}`, `{featureName}`/`{feature}`, `{localId}`, `{framework}`, `{phase}`, `{prefix}`→`[KEY-N]`); "IF a matched rule's template references a placeholder for which the task provides no corresponding attribute value, THEN ... substitute an empty string ... and produce an outcome indicator identifying the unresolved placeholder" → `unresolvedPlaceholders`; an unresolved/unknown token is "never left literal"
- [X] T016 [P] [US2] Unit tests in `tests/unit/titles-decorate-strip.test.ts` per research R4/R6: `decorateFeaturePrefix` prepends `"<featureName>: "` **exactly once**; "IF the derived title already begins with the exact prefix ... retain the title unchanged and SHALL NOT prepend a second occurrence" (idempotent); no-op when `featureName` absent. `stripTitleForRender` removes, from the front and in order, the feature prefix + each configured `titleStripPrefixes` entry + a redundant leading `[<confirmationKey>-N]` issue prefix + a duplicate leading `"<localTaskId>: "` prefix (removed "only when the preserved line already carries that identifier"), "preserving all other title characters unchanged"; default strip (empty `titleStripPrefixes`) "removes only the leading local-task-identifier prefix ... and any redundant leading issue prefix, and removes no other prefix"
- [X] T017 [P] [US2] Unit tests in `tests/unit/titles-derive.test.ts` per FR-003/FR-004/FR-005: (AC1) "evaluate the configured ordered title rules in ascending order and select the first rule whose conditions match the task attributes" → `matchedRuleIndex`; (AC2) no match / empty `titleRules` ⇒ pass-through (`baseTitle === task.title`, `matchedRuleIndex:-1`, `defaulted:true`); (AC3) `<featureName>: ` prepended exactly once on the consumer-rule, no-match, **and** pass-through paths alike, and "repeated derivations produce an identical final title"; (AC5) `featureName` absent ⇒ unprefixed
- [X] T018 [P] [US2] SC-002 property-based integration test in `tests/integration/titles-roundtrip.test.ts`: for each task fixture, apply `deriveTitle → stripTitleForRender → deriveTitle` for **10 cycles**; assert the `finalTitle` is byte-for-byte identical from cycle 1 and "0 titles gain a duplicated or compounding prefix"; and for tasks without a `Feature_Name`, the title is never prefixed (FR-005). Generators vary `featureName` presence, rule match/no-match, and absent-attribute placeholders

### Implementation for User Story 2

- [X] T019 [P] [US2] Implement `src/titles/match.ts`: `evaluateGuard(when: readonly TitlePredicate[], task: Task): boolean` per data-model §4 — `present` ⇔ attribute defined and non-empty (`child` ⇔ `parentUuid !== undefined`, `issueRef` ⇔ `task.issueRef !== undefined`); `eq` ⇔ string equality against `frameworkId`/`kind`/field; `startsWith` ⇔ `filePath.startsWith(value)`; negation inverts; empty predicate list (catch-all) ⇒ `true`
- [X] T020 [P] [US2] Implement `tests`-satisfying `src/titles/template.ts`: `renderTemplate(template, task): { text, unresolved }` per research R5 — replace the normative `{placeholder}` set from task attributes; an absent/empty attribute or unknown token ⇒ `""` + its name pushed to `unresolved` (never left literal)
- [X] T021 [P] [US2] Implement `src/titles/rules.ts`: `parseTitleRules(raw: readonly string[]): TitleRule[]` + `TitleRuleParseError` per research R2 — split each rule on the **first** `" => "` (a literal arrow in a template is escaped `\=>`), parse the guard into an ordered `TitlePredicate[]` (`[!]attr` with `=value`/`~value`), a missing guard ⇒ catch-all `when: undefined`, preserve config order in `order`; malformed guards throw `TitleRuleParseError { index, rule }`
- [X] T022 [P] [US2] Implement `src/titles/decorate.ts`: `decorateFeaturePrefix(baseTitle, featureName): string` — when `featureName` present, if `baseTitle` already starts with the exact `"<featureName>: "` return unchanged, else prepend once; absent `featureName` ⇒ unchanged (FR-004 idempotence / FR-005)
- [X] T023 [P] [US2] Implement `src/titles/strip.ts`: `stripTitleForRender(finalTitle, task, config: TitleConfigSlice): string` — remove leading `"<featureName>: "`, then each `config.titleStripPrefixes` entry, then a redundant leading `[<config.confirmationKey>-N]` issue prefix, then a duplicate leading `"<task.localTaskId>: "` prefix (only when the line already carries the identifier); empty `titleStripPrefixes` ⇒ built-in default strip (local-ID prefix + redundant issue prefix only, no other prefix); all other characters preserved (research R6, provided to 004)
- [X] T024 [US2] Implement `src/titles/derive.ts`: `deriveTitle(task, config: TitleConfigSlice): TitleDerivation` — `parseTitleRules(config.titleRules)`, evaluate `evaluateGuard` in ascending order for first match; no match or empty rules ⇒ pass-through `baseTitle = task.title` (`matchedRuleIndex:-1`, `defaulted:true`); a matched rule applies `renderTemplate` (collect `unresolvedPlaceholders`); then `decorateFeaturePrefix(baseTitle, task.featureName)` **on every path** → `TitleDerivation` (FR-003/FR-004/FR-005)
- [X] T025 [US2] Create `src/titles/index.ts` barrel re-exporting `./rules.js`, `./match.js`, `./template.js`, `./decorate.js`, `./strip.js`, `./derive.js`, `./types.js` (005-owned barrel only; **no `package.json`/`src/index.ts` edit** — Wave-3 integration registers the `./titles` subpath)
- [X] T026 [P] [US2] Zero-literal scan contract test `tests/contract/defaults-scan-005.test.ts`: the built-in pass-through title behavior and the default strip-prefix behavior, plus every fixture in `tests/fixtures/routing-titles/`, contain **no** organization-specific or product-specific literal prefix — only benign placeholders (`acme-*`, `proj-*`, `<areaPrefix*>`) — mirroring the constitution III / release-gate scan (contracts/title-derivation.md § Test obligations, 001 R6.7 "neither built-in default contains any organization-specific or product-specific literal prefix")
- [X] T027 [US2] Run the US2 suite to GREEN — `tests/unit/titles-rules.test.ts`, `tests/unit/titles-template.test.ts`, `tests/unit/titles-decorate-strip.test.ts`, `tests/unit/titles-derive.test.ts`, `tests/integration/titles-roundtrip.test.ts`, `tests/contract/defaults-scan-005.test.ts` via `npm run test:unit -- --test-name-pattern "title"`, `npm run test:integration -- --test-name-pattern "roundtrip"`, `npm run test:contract -- --test-name-pattern "defaults scan 005"`; then full `npm test` green

**Checkpoint**: US1 AND US2 both work independently. SC-002 proven (0 compounded prefixes over 10 cycles). 008 can apply `finalTitle`; 004 can call `stripTitleForRender`; 009 can surface `TitleDerivation` indications.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature enforcement and the documentation duty (constitution "Documentation duty").

- [X] T028 [P] Scripted e2e walkthrough `tests/e2e/routing-titles-user-stories.test.ts`: over a fixture task set, `resolveRouting` + `deriveTitle` + `stripTitleForRender`; assert routing selections (team/project/tie/unassigned) and that a feature-prefixed title round-trips (derive → strip → re-derive) unchanged — both stories end-to-end, zero network and zero dependency on 004 (tasks are hand-built fixtures)
- [X] T029 [P] Author documentation `docs/routing-and-titles.md` per constitution "Documentation duty": the `ProjectByPath` longest-prefix routing model with default + unassigned fallback, the title-rule string grammar (research R2) with the placeholder set, and the `<Feature_Name>: ` decorate-exactly-once / strip-on-render discipline; state that routing values are consumer-required with **zero** built-in defaults; **placeholder identifiers only** (no real org identifiers)
- [X] T030 Whole-feature gate: `npm test` (all tiers + coverage threshold), `npm run build` (confirm ESM + per-module `.d.ts` for `src/routing` and `src/titles`), `npm run lint`, `npm run typecheck` all green; the frozen-imports guard (T005) and both 005 contract tests (T010, T026) pass; **confirm zero diff under `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, `src/ports`** (frozen contracts untouched)
- [X] T031 Run the full `specs/005-routing-title-derivation/quickstart.md` validation checklist — US1 scenarios 1–5, US2 scenarios 1–6, contract+scan — and record SC-001 / SC-002 traceability results into `specs/005-routing-title-derivation/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — fixtures + dirs only (repo already has package scaffolding from 002)
- **Foundational (Phase 2)**: depends on Setup — **blocks both user stories** (T005 must hold before any contract test; the two `types.ts` modules are imported by every story module)
- **User Stories (Phases 3–4)**: both depend only on Foundational; then proceed **fully in parallel** (US1 owns `src/routing/*`, US2 owns `src/titles/*` — disjoint file sets, zero shared files)
- **Polish (Phase 5)**: depends on all desired stories

### User Story Dependencies

- **US1 (P1)**: after Phase 2; zero dependency on US2 — "pure function, no tracker" (spec Independent Test). Consumes only the frozen `002` `RoutingResolution`/`ProjectByPathEntry`.
- **US2 (P2)**: after Phase 2; zero dependency on US1 — derivation/strip are pure over `Task` + config slices; tasks are hand-built fixtures, so 005 does not depend on 004 at test time

### Within Each User Story

- Tests written first and observed FAILING (constitution VI), then implementation
- Types (Phase 2) → leaf modules (`match`/`template`/`decorate`/`strip`, all [P]) → `rules`/`derive`/`index` (composed) → run-to-green
- Story checkpoint green before claiming completion

### Parallel Opportunities

- Setup: T001–T004 all [P] (different fixture files / new dirs)
- Foundational: T005, T006, T007 all [P] (three independent files)
- US1 tests: T008–T010 all [P]; US2 tests: T014–T018 all [P]
- US2 implementation leaf modules: T019–T023 all [P] (disjoint files, only depend on Phase-2 types)
- **US1 and US2 tracks run fully in parallel after Phase 2** (different directories, no shared files)
- Polish: T028, T029 [P]

---

## Parallel Example: after Foundational (both stories at once)

```bash
# Track A — US1 routing (src/routing/*):
Task: "routing unit tests in tests/unit/routing-resolve.test.ts"          # T008 [P]
Task: "routing corpus SC-001 test in tests/integration/routing-corpus.test.ts"  # T009 [P]
Task: "routing frozen-shape contract test in tests/contract/routing-resolution-shape.test.ts"  # T010 [P]
# then: T011 resolve.ts → T012 index.ts → T013 run-to-green

# Track B — US2 titles (src/titles/*), same time:
Task: "rules/template/decorate-strip/derive/roundtrip tests"               # T014–T018 [P]
# then leaf modules in parallel (types-only deps):
Task: "src/titles/match.ts"      # T019 [P]
Task: "src/titles/template.ts"   # T020 [P]
Task: "src/titles/rules.ts"      # T021 [P]
Task: "src/titles/decorate.ts"   # T022 [P]
Task: "src/titles/strip.ts"      # T023 [P]
# then: T024 derive.ts (composes T019–T023) → T025 index.ts → T026 scan → T027 run-to-green
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (fixtures + `src/routing`, `src/titles` dirs)
2. Complete Phase 2: Foundational (frozen-imports guard + both `types.ts`)
3. Complete Phase 3: US1 routing
4. **STOP and VALIDATE**: `npm run test:unit -- --test-name-pattern "routing"` + `npm run test:integration -- --test-name-pattern "routing corpus"` + routing-shape contract green; SC-001 determinism observed → **MVP**
5. 006 can already consume the frozen `RoutingResolution` 005 produces

### Incremental Delivery

1. Setup + Foundational → 005-local types + frozen-import guard in place; both tracks unblocked
2. Add US1 → deterministic routing live (SC-001) → demo (MVP); 006 container gating ready
3. Add US2 → idempotent title derivation + render-back strip live (SC-002) → 008/004/009 outputs available; full feature exit criteria (quickstart) reachable
4. Polish → e2e walkthrough, docs, whole-feature gate, quickstart traceability

### Parallel Team Strategy

1. One dev: Setup + Foundational (small — guard + two type modules)
2. Then split: Dev A → US1 (`src/routing/`); Dev B → US2 (`src/titles/`) — fully disjoint, run concurrently
3. Reunite for Phase 5 (e2e, docs, whole-feature gate)

---

## Notes

- [P] tasks = different files, no dependencies
- Tests are mandatory (constitution VI "NON-NEGOTIABLE"); verify RED before GREEN at each story checkpoint
- **Never redefine frozen 002 contracts**: `RoutingResolution`, `ProjectByPathEntry`, `Task`, `ResolvedConfig` slices are imported; any change to them is a cross-feature amendment (ROADMAP rule 2), out of scope here (T005 guards this)
- **No shared files in Wave 2**: no `package.json`/`src/index.ts` edits; public subpath exports are a Wave-3 integration concern (research R3)
- Zero real organization identifiers in fixtures and shipped defaults (T001/T003 placeholder identities; T026 scan)
- Routing NEVER invents a default team/project — absent/unmatched with no configured defaults ⇒ `unassigned:true` (constitution III)
- Feature-prefix discipline is the SC-002 centerpiece: decorate exactly-once (R4) + strip-on-render (R6) = byte-stable round trip; a task without a `Feature_Name` is never prefixed (FR-005)
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: same-file conflicts between [P] tasks; cross-story coupling between `src/routing` and `src/titles` (they share only the frozen 002 modules, imported independently)
