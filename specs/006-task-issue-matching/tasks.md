# Tasks: Task-to-Issue Matching and Confidence

**Input**: Design documents from `specs/006-task-issue-matching/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R10), data-model.md (§1–7), contracts/ (README + 3 documents), quickstart.md

**Tests**: INCLUDED — mandatory. Constitution Principle VI (NON-NEGOTIABLE: "Every behavioral change lands with automated tests… every acceptance criterion in the specification MUST be enforced by at least one automated test"; "Property-based, contract (fake-versus-real `Linear_Port`), and security tests are required cross-cutting types") and quickstart.md's traceability table map every FR/SC to specific tests. Test tasks precede implementation tasks (test-first, verify RED before GREEN) — 002's tasks.md is the workflow precedent.

**Organization**: Tasks grouped by user story (US1 = optimal, explainable one-to-one matching, P1; US2 = durable identity wins, P2). Foundational phase freezes the 006-local input/projection vocabulary both stories share.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]/[US2]**: User-story phases only; Setup, Foundational, and Polish tasks carry no story label
- Test runner: `node:test` + `node:assert/strict` against compiled output via `npm run test:unit|test:contract|test:integration` (002 research R2 convention; tests import `task-linear-sync/matching` through the real `exports` map)
- All paths repository-root-relative; single npm package per plan.md. 006 code lives ONLY in `src/matching/` + new test files; frozen 002 modules (`src/domain|config|state|urls|gates|ports`) and 003/004/005/007 modules are NEVER edited or imported (plan.md Structure Decision; contracts/README.md table)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the 006 module tree, the one additive shared-file edit, and the test infrastructure both stories use (fake port, seeded corpus generator, fixtures).

- [X] T001 Create the module scaffold per plan.md § Source Code: `src/matching/` (empty, `index.ts` placeholder barrel) and test dirs `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/helpers/`, `tests/fixtures/matching/` — no edits to `src/index.ts`, `tsconfig*.json`, or any frozen module
- [X] T002 Add the single additive entry `"./matching": { "types": "./dist/matching/index.d.ts", "default": "./dist/matching/index.js" }` to the `exports` map in `package.json`, appended at the end of the map per research R10 (merge-disjoint from sibling Wave-2 keys `./discovery|parsing|routing|tracker`; this is the ONLY non-`src/matching` shared-file edit the feature ever makes — research R10: "006 does NOT edit `src/index.ts` (root barrel), any `src/domain|config|state|urls|gates|ports` file")
- [X] T003 [P] Create `tests/helpers/matching-linear-fake.ts`: in-memory fake implementing the FROZEN `LinearPort` interface from `task-linear-sync/ports` — all 12 members present for conformance; read side (`listIssues`, `discoverMetadata`, `getIssue`, `getAttachmentByUrl`, `listAttachments`, `findIssuesByAttachmentUrl`) backed by fixture data with deterministic page ordering; write side (`createIssue`, `updateIssue`, `archiveIssue`, `upsertAttachmentByUrl`, `updateAttachment`) CALL-RECORDING so tests assert zero mutating calls ("hermetic tests inject the fake — zero real requests", 002 tracker-port invariant 1). Per research R8 this is a 006-owned test stand-in — 007 owns the production fake; no imports from `src/tracker`
- [X] T004 [P] Create `tests/helpers/matching-corpus.ts`: seeded deterministic corpus generator (xorshift PRNG, constant seeds — research R7 "a seeded xorshift PRNG (constant seeds in tests)"; no new dependencies, no `Math.random`): generators for the SC-001 corpus (100 tasks with "renames, moves, and checkbox flips", durable attachments injected at configured rates), exhaustive ≤8×8 small-case enumerators for brute-force comparison (SC-003), and Fisher–Yates input-shuffle helpers for permutation-invariance tests (SC-002)
- [X] T005 [P] Create JSON fixtures under `tests/fixtures/matching/`: `scoring-goldens.json` (task/candidate pairs with hand-computed signal sums per contracts/confidence-scoring.md §1), `moved/` (issues relocated "across teams/projects/frameworks and renamed, carrying canonical attachment identity" — spec US2 Independent Test), `dup-uuid/` (two+ issues carrying the same task UUID in page-0 attachment payloads), `fake-pipeline/` (IssueView + AttachmentView sets for the integration tier). Placeholder identities only — `acme-team`, `proj-alpha`, `ENG`-shaped keys, fixed test UUIDv4s — "zero real organization identifiers" (quickstart Prerequisites)

**Checkpoint**: `npm run build && npm run typecheck && npm run lint` green with the placeholder barrel; `task-linear-sync/matching` resolves through the exports map.

---

## Phase 2: Foundational (Blocking Prerequisites — 006-local vocabulary)

**Purpose**: The input/projection/config vocabulary both user stories consume: 006-local types composing frozen 002 shapes (data-model §1–6), typed errors, defensive config validation (R9), deterministic normalization (R2), and candidate projection with durable-identity detection (R5).

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — US1 scoring and US2 integrity both consume `types.ts`/`projection.ts`.

### Tests for the foundational layer (write FIRST, must fail)

- [X] T006 [P] Create config-validation unit tests in `tests/unit/matching-config.test.ts` per research R9, honoring verbatim: weights — "configurable weights each greater than or equal to 0" (001 R5 c1) and "weighted INTEGER sum"; floors — "where the medium floor is greater than or equal to the plausible-match floor" (001 R5 c2) for `confidenceFloors { medium: 50, plausible: 18 }`; margin — "default 10, minimum allowed value 1" (001 R5 c8) so `minimumMatchMargin` must be an integer ≥ 1. Assert typed `MatchingConfigError { key, value, rule }` naming the offending key, and that nothing is silently clamped/coerced ("006 does **not** silently clamp, round, or ignore bad values")
- [X] T007 [P] Create normalization unit tests in `tests/unit/matching-normalize.test.ts` per research R2: step order — strip leading `^\[[A-Za-z0-9_-]+-\d+\]\s*` visible issue prefix; strip leading `<featureName>: ` "**only if** the task carries a `featureName` and the candidate title begins with that exact prefix"; "Unicode NFKC, casefold, collapse runs of whitespace to single spaces, trim"; tokenization on collapsed whitespace; fuzzy ratio is the Dice coefficient over token multisets: "`overlapRatio = 2·|common multiset| / (|A| + |B|)` … 0.0 when either side empty" — deterministic golden cases including decorated titles, CJK/accented NFKC cases, and empty-title edge cases
- [X] T008 [P] Create projection unit tests in `tests/unit/matching-projection.test.ts` per contracts/candidate-projection.md: page-0-only identity ("parseAttachmentUrl … `{ kind: "canonical", taskUuid }` … and `attachment.metadata[config.metadataNamespaceKey]` parses via … `parseSyncStatePayload`"); continuation pages "are history-only and never set identity"; identity "Never description, never in-file marker" (identity text in `IssueView.description` or other metadata keys sets nothing); "A malformed payload string under the namespace key is ignored for identity (candidate treated as non-durable)"; `issueNumber` from `/-(\d+)$/` on `issueKey` (non-matching ⇒ signal scores 0); `teamKey`/`projectRef` mapped from `IssueView.teamKey`/`IssueView.projectId` "compared as-is"; output "sorted by `issueId` ascending"

### Implementation — 006-local vocabulary (data-model.md §1–6)

- [X] T009 Implement `src/matching/types.ts`: `TaskMatchInput { task, routing? }` (data-model §1 — `routing` is a frozen `RoutingResolution` VALUE from `task-linear-sync/domain`, never a 005 import: "005's routing output enters as the frozen `RoutingResolution` **value**, never as an import", plan.md Constraints); `MatchCandidate` (data-model §2: `issueId`, `issueKey`, `teamKey`, `projectRef`, `title`, `durableTaskUuid?`, `frameworkId?`, `featureName?`, `filePath?` — `filePath` is "Context/reasons only; **not** an independent signal"); `SignalContribution`, `PairScore` (data-model §3: `total` — "unbounded weighted integer sum" (FR-001), `usable`, `exclusion: "below-plausible" | "gated-team" | "gated-project" | "gated-framework" | undefined`); `MatchingResult`, `UnresolvedTask` (`band: "unmatched"` fixed; `bestScore` "diagnostic only"), `MatchingWeightOverrides` (data-model §5: `{ localTaskId?, titleContainedRatio? ∈ [0,1], sameProject?, sameFramework? }`), `ProjectCandidatesInput` — all readonly; re-export frozen `Match`, `MatchAlternative`, `Confidence` types for consumer convenience WITHOUT redefining them
- [X] T010 [P] Implement `src/matching/errors.ts`: `MatchingConfigError` (`key`, `value`, `rule` — data-model §6) and `DurableIdentityCollisionError` (`taskUuid`, `issueIds` "(all conflicting, sorted ascending)"; payload text carries only ids/keys — "no secret-shaped content")
- [X] T011 [P] Implement `src/matching/config-check.ts`: `checkMatchingConfig(config: ResolvedConfig): void` validating the frozen matching slice exactly per T006's quoted rules (consumed `scoringWeights` keys integers ≥ 0; `confidenceFloors` integers ≥ 0 with `medium ≥ plausible`; `minimumMatchMargin` integer ≥ 1) throwing `MatchingConfigError` per violation — run at the entry of every public 006 function ("no silent bad config", contracts/matching-api.md invariant 8); reads `task-linear-sync/config` types only
- [X] T012 Implement `src/matching/normalize.ts`: `normalizeTitle(title: string, opts?: { featureName?: string })` and `tokenize(normalized: string)` and `overlapRatio(a: string, b: string)` implementing the R2 pipeline exactly per T007's quoted rules (pure, locale-independent, no `toLocaleLowerCase` — casefold only; deterministic across platforms)
- [X] T013 Implement `src/matching/projection.ts`: `projectCandidates(input: { issues, attachmentsByIssue, config }): MatchCandidate[]` per contracts/candidate-projection.md rules 1–6, importing ONLY frozen helpers `parseAttachmentUrl` (`task-linear-sync/urls`) and `parseSyncStatePayload` (`task-linear-sync/domain`) plus `IssueView`/`AttachmentView` types (`task-linear-sync/ports`); pure — performs zero port calls ("matching never fetches"); cross-issue duplicate-UUID integrity scan is wired in US2 (T033) — leave a documented extension point `scanDurableCollisions(candidates)` stubbed to no-op so the module boundary is final
- [X] T014 Implement `src/matching/index.ts` barrel exporting the vocabulary built so far; run `npm run build && npm run typecheck && npm run lint`; run T006–T008 to GREEN; confirm the subpath `task-linear-sync/matching` resolves via the T002 exports entry and that `tests/contract/frozen-surface.test.ts` (002's) still passes with zero edits

**Checkpoint**: Foundation ready — inputs project, config guards, normalization is deterministic. US1 and US2 tracks can now proceed (US2 tests can be authored against vocabulary but its behavior lands after US1).

---

## Phase 3: User Story 1 - Optimal, explainable one-to-one matching (Priority: P1) 🎯 MVP

**Goal**: Weighted integer signal scoring → bands from frozen floors → container gating → deterministic maximum-weight one-to-one assignment → margin downgrade → ≤3 ranked alternatives, byte-for-byte reproducible (FR-001…FR-006).

**Independent Test** (spec, verbatim): "Property-based suite over generated task/issue corpora: assert one-to-one validity, global optimality against brute force on small cases, deterministic tie-break stability across permutations, gate correctness, band thresholds, and alternative ordering — pure function, no I/O." (Run: `npm run test:unit -- --test-name-pattern "matching"` + `npm run test:contract`)

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [X] T015 [P] [US1] Signal-scoring unit tests in `tests/unit/matching-scoring.test.ts` per FR-001 verbatim: "score each task against each candidate issue as an unbounded weighted integer sum over configurable signals: durable identity match, existing issue reference, local task ID match, exact normalized title, contained normalized title, fuzzy title similarity (scaled token overlap), same-project alignment, and same-framework alignment" — golden sums from `tests/fixtures/matching/scoring-goldens.json` against the contracts/confidence-scoring.md §1 table (frozen defaults `durableUuid: 1000`, `issueRefExact: 500`, `titleExact: 60`, `titleTokenOverlap: 30`; derived `local-task-id = round(0.5 × issueRefExact)`, `title-contained = round(0.65 × titleExact)`, `same-project = same-framework = 10`); assert fuzzy is "scaled by a 0.0–1.0 token-overlap ratio" via `round(titleTokenOverlap × overlapRatio)`; assert title credit is "exact, else contained, else fuzzy — the strictest satisfied form only"; assert `MatchingWeightOverrides` changes derived/constant weights and that scores remain unbounded integers ≥ 0 (spec AC1)
- [X] T016 [P] [US1] Gating + selectability unit tests in `tests/unit/matching-gating.test.ts` per FR-003 verbatim: "exclude non-durable candidates whose team, project, or (when both known) framework differ from the task's" (spec AC3: candidate "is excluded entirely" from selection); per research R6: routing `undefined` or `unassigned: true` ⇒ "team/project gates skipped for that task"; candidate `frameworkId` unknown ⇒ framework gate not evaluated ("both … carry a known `Framework_Id`", 001 R5 c5); FR-002 selectability verbatim: "selectable candidates are restricted to at least the plausible-match floor" (`score ≥ confidenceFloors.plausible`, default 18) — sub-plausible pairs never selectable but retained as alternative candidates (T019)
- [X] T017 [P] [US1] Banding + margin unit tests in `tests/unit/matching-bands.test.ts`: FR-002 verbatim "assign exactly one confidence band per match from {high, medium, low, unmatched} from the configured floor thresholds" with the R5 c2 rule quoted in contracts/confidence-scoring.md §4 ("a score at or above the medium floor SHALL be high or medium, a score at or above the plausible-match floor but below the medium floor SHALL be low, and a score below the plausible-match floor SHALL be unmatched", floors `{ medium: 50, plausible: 18 }`); FR-005 verbatim "downgrade a high-confidence non-durable match to medium, with a recorded ambiguity reason, when its margin to the next usable candidate is below the configured minimum" (default `minimumMatchMargin: 10`; recorded reason label `ambiguous-margin`; spec AC5); margin definition per data-model §3/glossary "from both task and issue sides" — `margin = total − max(next-best usable competitor of the task, best usable rival of the issue)`, no competitor ⇒ `margin = total`, integer ≥ 0; edge case: "Empty candidate pool: every task bands `unmatched`; output remains deterministic"
- [X] T018 [P] [US1] Assignment unit tests in `tests/unit/matching-assignment.test.ts` per FR-004 verbatim: "solve a maximum-weight one-to-one assignment (each task at most one issue, each issue at most one task), selecting deterministically among equally optimal solutions so unchanged inputs reproduce matches byte-for-byte" — assert one-to-one validity on every corpus; SC-003 verbatim: "On exhaustive small-case fixtures (≤8 tasks × ≤8 issues), the assignment weight equals brute-force optimum in 100% of cases" (brute-force oracle enumerates all injective partial assignments over usable pairs via `tests/helpers/matching-corpus.ts`); forbidden cells (gated/below-plausible) never selected; dummy rows/columns produce `unresolved`, never a `Match`; equally-optimal alternatives resolve to the lexicographically-smallest optimal matching (research R4)
- [X] T019 [P] [US1] Alternatives unit tests in `tests/unit/matching-alternatives.test.ts` per FR-006 verbatim: "retain up to three alternative candidates per match, ordered by descending score with deterministic tie-breaks, each annotated mapped or unmapped" (spec AC6: "up to three alternative candidates are retained, ordered by descending score with deterministic tie-breaks, each annotated mapped or unmapped"): ≤ 3 entries, ordered `(score desc, issueId asc)`, `mapped: true` iff that alternative issue is itself assigned to some task in the final result, gated/below-plausible candidates eligible as alternatives, alternatives exclude the selected issue; ordering stable across input permutations
- [X] T020 [P] [US1] Determinism + serialization unit tests in `tests/unit/matching-serialize.test.ts`: `serializeMatchingResult` stable-key-sorted JSON; SC-002 verbatim: "Two consecutive matching runs over identical inputs produce byte-for-byte identical assignment output (determinism), across 100 randomized fixtures" (seeded corpora); permutation invariance: results byte-identical after shuffling task and candidate arrays with independent seeds (research R7 "shuffled input permutations produce byte-identical canonicalized results")
- [X] T021 [P] [US1] Contract test for the 006 public surface in `tests/contract/matching-api.test.ts`: snapshot the exported name set of `src/matching/index.ts` (002 R15 pattern) and assert every behavioral invariant 1–9 of contracts/matching-api.md on generated corpora (one-to-one, exactly-one-band, integer ≥ 0 score/margin, `alternatives.length ≤ 3`, deterministic serialize, `MatchingConfigError`/`DurableIdentityCollisionError` are the only typed aborts); parallel-safety greps: `src/matching/**` imports ONLY `task-linear-sync/{domain,config,urls,ports}` and Node built-ins — no `src/discovery|parsing|routing|tracker`, no edits to frozen modules, no additions to frozen-module export sets (002 `frozen-surface.test.ts` untouched and green)
- [X] T022 [P] [US1] Integration test over the fake port in `tests/integration/matching-fake.test.ts`: feed `projectCandidates` from `listIssues`/`listAttachments` reads through `tests/helpers/matching-linear-fake.ts` (fixtures under `tests/fixtures/matching/fake-pipeline/`); assert projection parity with direct fixtures; assert ZERO mutating `LinearPort` calls recorded on the entire 006-reachable path (constitution I posture; contracts/matching-api.md invariant 7); assert the fake satisfies the frozen interface at compile time (type assertion against `LinearPort`)

### Implementation for User Story 1

- [X] T023 [US1] Implement `src/matching/scoring.ts`: `scorePair(input: TaskMatchInput, candidate: MatchCandidate, weights: ResolvedWeights): PairScore` computing the eight-signal weighted integer sum exactly per the contracts/confidence-scoring.md §1 registry (weight resolution from frozen `ResolvedConfig.scoringWeights` + derived `round(0.5 × issueRefExact)` / `round(0.65 × titleExact)` / constants 10/10 overridable via `MatchingWeightOverrides`; "strictest satisfied form only" title credit; deterministic contributions order; machine-readable reason labels `durable-uuid`, `issue-ref-exact`, `local-task-id`, `title-exact`, `title-contained`, `title-fuzzy`, `same-project`, `same-framework`); weights pre-resolved+validated by T011 — depends on T009, T012
- [X] T024 [P] [US1] Implement `src/matching/gating.ts`: `applyGate(pair, input, candidate, floor): PairScore` setting `usable`/`exclusion` — honor FR-003 verbatim "exclude non-durable candidates whose team, project, or (when both known) framework differ from the task's" and the constitution II durable clause "a durable-identity match bypasses team/project/framework gating and margin downgrade so an issue moved or renamed across containers is never orphaned" (`durableIdentity ⇒ no gating`); R6 skip-when-task-side-unknown rule; plausible-floor usability "restricting selectable candidates to at least the plausible-match floor"
- [X] T025 [P] [US1] Implement `src/matching/assignment.ts`: `assignUsable(pairs: readonly PairScore[]): AssignedPair[]` per research R4 — Jonker–Volgenant shortest-augmenting-path Hungarian variant over integer weights on the square matrix (`n = max(|tasks|, |issues|)`); forbidden sentinel for non-usable cells; "Dummy rows/columns carry weight 0, which is exactly 'leave this task unmatched / this issue unmapped'"; determinism exactly as R4: "pre-sorted canonically (tasks by `stableUuid`, issues by `issueId`) … augmentation tie-breaks prefer the lowest canonical row index then column index; after solving, a canonical pass … [selects] the lexicographically-smallest optimal matching"
- [X] T026 [P] [US1] Implement `src/matching/bands.ts`: `bandAndMargin(selected, allUsable, config): Match[]` — raw band ("score ≥ confidenceFloors.medium ⇒ high; else low" for selected/usable pairs, contracts/confidence-scoring.md §4 step 1), both-sides margin formula (T017's quoted rule), FR-005 downgrade verbatim "high-confidence non-durable match to medium, with a recorded ambiguity reason" → `confidence: "medium"` + reason `ambiguous-margin`, durable never downgraded (R5 c9 "WHERE a match is a durable identity, THE System SHALL bypass … the margin downgrade"); emits frozen `Match` (fields per 002 data-model §5 — no shape invention)
- [X] T027 [P] [US1] Implement `src/matching/serialize.ts`: `serializeMatchingResult(r: MatchingResult): string` — deterministic stable-key-sorted JSON (002 `canonicalizePlanJson` discipline; research R7 "the SC-002 byte-identity artifact"); arrays keep their canonical order, never re-sorted at serialize time
- [X] T028 [US1] Implement `src/matching/matching.ts`: `matchAllTasks(tasks, candidates, config, weightOverrides?)` orchestrator — `checkMatchingConfig` first; canonical input ordering; per-pair score → gate → `assignUsable` → `bandAndMargin`; alternatives per FR-006 (top-3 other candidates by `(score desc, issueId asc)` incl. gated/below-plausible, `mapped` annotated post-assignment); `unresolved` with `band: "unmatched"` + `bestScore` diagnostic; `unmappedIssues` sorted; pure and deterministic (zero clock/env/random); extend `src/matching/index.ts` exports (T014 barrel) — depends on T023–T027
- [X] T029 [US1] Run `npm run test:unit -- --test-name-pattern "matching"`, `npm run test:contract`, `npm run test:integration -- --test-name-pattern "matching"` to GREEN over the US1 suite (`tests/unit/matching-scoring.test.ts`, `matching-gating.test.ts`, `matching-bands.test.ts`, `matching-assignment.test.ts`, `matching-alternatives.test.ts`, `matching-serialize.test.ts`, `tests/contract/matching-api.test.ts`, `tests/integration/matching-fake.test.ts`); verify quickstart US1 scenarios 1–8 pass; confirm SC-002/SC-003 property suites green

**Checkpoint**: US1 fully functional and independently testable — MVP complete: deterministic, explainable, globally optimal matching over injected data (002's frozen `Match` shape emitted). 008 can already compose this.

---

## Phase 4: User Story 2 - Durable identity wins (Priority: P2)

**Goal**: An issue carrying the task's durable identity matches "regardless of container moves or renames: durable matches bypass gating and margin downgrade so a moved issue is never orphaned"; duplicate durable UUIDs across issues are a hard integrity abort (constitution II).

**Independent Test** (spec, verbatim): "Fixture set of issues relocated across teams/projects/frameworks and renamed, carrying canonical attachment identity; assert 100% pairing survival and zero gating exclusions for durable candidates." (Run: `npm run test:unit -- --test-name-pattern "matching-durable|matching-integrity"` + `npm run test:integration -- --test-name-pattern "matching"`)

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [X] T030 [P] [US2] Durable-precedence unit tests in `tests/unit/matching-durable.test.ts` per constitution II verbatim: "Matching MUST prefer the durable identity; a durable-identity match bypasses team/project/framework gating and margin downgrade so an issue moved or renamed across containers is never orphaned" — assert spec AC1: "a candidate whose attachment metadata carries the task's durable identity … team/project/framework gating and the margin downgrade do not apply to it" (durable high match with margin < 10 STAYS high, no `ambiguous-margin`; durable pair across differing team/project/framework is selected); durable pair scores carry the `durable-uuid` contribution at `scoringWeights.durableUuid` (default 1000 — outranks the sum of all other signals); emitted `Match.durableIdentity: true`
- [X] T031 [P] [US2] Integrity-abort unit tests in `tests/unit/matching-integrity.test.ts` per spec US2 AC2 verbatim: "more than one issue carrying the same task UUID, **When** matching runs, **Then** the run aborts with a hard integrity failure and no changes (per constitution)" and 001 R5 c3 verbatim: "THE System SHALL abort the run, apply no changes, and report the task UUID and the identifiers of all conflicting issues" — assert `DurableIdentityCollisionError` carries `taskUuid` + ALL conflicting `issueId`s "sorted ascending"; no `MatchingResult` is returned ("no changes" is structural — the throw emits no result); both collision shapes from contracts/candidate-projection.md §Integrity (case a across issues from `tests/fixtures/matching/dup-uuid/`, case b contradictory anchors on one issue throws on the lexicographically-smallest offending `taskUuid` first); abort fires before scoring/scoring-independent ("cannot be sidestepped by configuration")
- [X] T032 [P] [US2] Relocation-survival integration test in `tests/integration/matching-durable-fixtures.test.ts` running `tests/fixtures/matching/moved/` through the fake-port pipeline: issues relocated across teams/projects/frameworks and renamed still pair 1:1 with their tasks (100% pairing survival), "zero gating exclusions for durable candidates", and results byte-identical across re-runs (Principle IV)

### Implementation for User Story 2

- [X] T033 [US2] Wire the integrity scan into `src/matching/projection.ts`: implement `scanDurableCollisions(candidates)` (T013's extension point) per contracts/candidate-projection.md §Integrity — group by `durableTaskUuid`, throw `DurableIdentityCollisionError { taskUuid, issueIds }` on any group of ≥ 2 (case b included, smallest `taskUuid` first); invoked inside `projectCandidates` "before any scoring"
- [X] T034 [US2] Harden `src/matching/matching.ts` for durable semantics: guarantee the abort path emits no partial result; confirm `durableIdentity: true` reaches every emitted `Match` of a durable pair and that durable alternatives keep `mapped` annotations; confirm the FR-005 downgrade guard reads `durableIdentity` (not scoring order) — "durable matches never downgrade (R5 c9)"
- [X] T035 [US2] Run `npm run test:unit -- --test-name-pattern "matching-durable|matching-integrity"`, `npm run test:integration -- --test-name-pattern "matching"`, plus the full US1 matching suites for zero regression — `tests/unit/matching-durable.test.ts`, `tests/unit/matching-integrity.test.ts`, `tests/integration/matching-durable-fixtures.test.ts` and every Phase-3 test file all GREEN

**Checkpoint**: US1 AND US2 independently functional. Constitution II survival proven; hard-abort surface complete. 009's per-task decision fields (score, margin, band, reasons, alternatives) and 013's inputs are fully emitted.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature SC enforcement, documentation duty, and the parallel-safety audit.

- [ ] T036 [P] Create SC-001 survival suite `tests/integration/matching-pairing-survival.test.ts` per spec verbatim: "In a 100-task fixture with renames, moves, and checkbox flips, ≥95% of tasks retain their correct issue pairing across re-runs, and 100% of durable-identity pairs survive title or container changes without orphaning" — seeded corpora via `tests/helpers/matching-corpus.ts`; re-run over mutated-but-identity-preserved inputs (rename titles, move containers, flip checkboxes — fields excluded from identity by 002 `taskStableSeed` posture) and assert both thresholds
- [ ] T037 [P] Author `docs/matching.md` (+ README usage section) per constitution "Documentation duty": signal table + weight resolution (incl. the derived-weights/override posture and the recommended `ScoringWeights` amendment pointer from plan.md Complexity Tracking), banding/margin/assignment determinism guarantees, integrity-abort behavior, and a usage example for `projectCandidates`/`matchAllTasks`/`serializeMatchingResult` — "Documentation examples MUST use placeholder identifiers only"; documents the new public API in the same change as the API itself
- [ ] T038 Audit parallel-safety per quickstart "Guard checks": `git diff --name-only main..HEAD` contains ONLY `specs/006-task-issue-matching/**`, `src/matching/**`, the new 006 test/fixture/helper files, and the single additive `"./matching"` block in `package.json`; 002's `tests/contract/frozen-surface.test.ts` and all `specs/002-core-domain-contracts/**` byte-identical (frozen contracts referenced, never modified); no `src/discovery|parsing|routing|tracker` import anywhere under `src/matching/`
- [ ] T039 Run the full quickstart.md validation checklist (US1 scenarios 1–8, US2 scenarios 1–4, SC-001–SC-003 rows, guard checks) and record the FR-001…FR-006 / SC-001…SC-003 → test traceability results
- [ ] T040 Verify `npm test` (all tiers + coverage threshold gate) and `npm run build` green: per-module `.js` + `.d.ts` for `src/matching`, `./matching` entry resolvable in `dist/`, lint + typecheck clean (constitution "Merge-blocking validation" posture)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (T001/T002 first; then T003–T005 in parallel)
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS both user stories** (US1 scoring consumes `types.ts`/`normalize.ts`; US2 integrity consumes `errors.ts`/`projection.ts`)
- **User Stories (Phases 3–4)**: Both depend only on Foundational. US1 is the MVP; US2 layers onto the same pipeline via `durableIdentity` already threaded in US1's gate/band signatures, so US2 = hardening + integrity scan + survival proof
- **Polish (Phase 5)**: Depends on the desired stories (T036 needs US2 durable semantics; T037–T040 need the final API)

### User Story Dependencies

- **US1 (P1)**: After Phase 2. Self-contained: emits frozen `Match` shape; does NOT depend on US2 tasks (durable pairs without collisions behave correctly as a side effect of US1's gate/band clauses; US2 *proves* it and adds the abort)
- **US2 (P2)**: After Phase 2 and after US1 implementation lands (T033–T034 edit `projection.ts`/`matching.ts` owned by T013/T028 — sequential file handoff, no same-time conflict). Independently testable via `moved/` + `dup-uuid/` fixtures

### Within Each User Story

- Tests written first and observed FAILING (constitution VI), then implementation
- `scoring → gating → assignment → bands → serialize → orchestrator` (dataflow order); alternatives live in the orchestrator (need the final assignment for `mapped`)
- Story checkpoint green (incl. prior stories' regressions) before claiming completion

### Parallel Opportunities

- Setup: T003, T004, T005 after T001/T002 (3-way)
- Foundational: T006, T007, T008 (test files, 3-way); T009 → { T010, T011 } parallel, then T012, T013 parallel-safe (disjoint files)
- US1: ALL eight test tasks T015–T022 in parallel; implementation T024–T027 in parallel after T023 (disjoint modules); T028 sequential (integrates)
- US2: T030–T032 tests in parallel; T033/T034 touch US1-owned files → sequential after US1's T029
- Polish: T036, T037 in parallel
- Cross-feature (repo level): 006 lands entirely inside `src/matching/` + new test files + one additive package.json key — merge-disjoint from 003/004/005/007 (research R10)

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (RED first) — 8-way parallel, disjoint files:
Task: "Signal-scoring unit tests in tests/unit/matching-scoring.test.ts"          # T015
Task: "Gating + selectability unit tests in tests/unit/matching-gating.test.ts"   # T016
Task: "Banding + margin unit tests in tests/unit/matching-bands.test.ts"          # T017
Task: "Assignment unit tests in tests/unit/matching-assignment.test.ts"           # T018
Task: "Alternatives unit tests in tests/unit/matching-alternatives.test.ts"       # T019
Task: "Determinism + serialization tests in tests/unit/matching-serialize.test.ts" # T020
Task: "Public-surface contract test in tests/contract/matching-api.test.ts"       # T021
Task: "Fake-port integration test in tests/integration/matching-fake.test.ts"     # T022

# Then implement bottom-up:
Task: "Implement src/matching/scoring.ts"        # T023 (needs T012 normalize)
# After T023 — 4-way parallel (disjoint files):
Task: "Implement src/matching/gating.ts"         # T024
Task: "Implement src/matching/assignment.ts"     # T025
Task: "Implement src/matching/bands.ts"          # T026
Task: "Implement src/matching/serialize.ts"      # T027
# Finally the integrator:
Task: "Implement src/matching/matching.ts"       # T028 (depends on T023–T027)
```

## Parallel Example: User Story 2

```bash
# All US2 tests together (RED first) — 3-way parallel:
Task: "Durable-precedence unit tests in tests/unit/matching-durable.test.ts"           # T030
Task: "Integrity-abort unit tests in tests/unit/matching-integrity.test.ts"            # T031
Task: "Relocation-survival integration test in tests/integration/matching-durable-fixtures.test.ts"  # T032
# Then sequential hardening (edits US1-owned files, after US1 checkpoint):
Task: "Wire integrity scan in src/matching/projection.ts"   # T033
Task: "Harden durable semantics in src/matching/matching.ts" # T034
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: Foundational (T006–T014) — CRITICAL, blocks both stories
3. Complete Phase 3: US1 (T015–T029)
4. **STOP and VALIDATE**: `npm run test:unit -- --test-name-pattern "matching"` + `npm run test:contract` green — deterministic, globally optimal, explainable one-to-one matching (FR-001–FR-006, SC-002, SC-003) over injected data; 008/009 can compose the output today
5. Ship — the pure matching brain is independently valuable and independently verifiable

### Incremental Delivery

1. Setup + Foundational → 006-local vocabulary frozen for this feature
2. Add US1 → deterministic optimal matching live (MVP) → 008 integration-ready
3. Add US2 → durable survival + hard integrity abort (constitution II closed out; SC-001 durable clause provable)
4. Polish → SC-001 suite, docs, parallel-safety audit, full-suite green

### Parallel Team Strategy

1. One dev: Setup + Foundational (small, sequential core)
2. US1: split tests 8-way, then 4-way on `gating/assignment/bands/serialize`, one integrator for `matching.ts`
3. US2 after US1 checkpoint: tests 3-way in parallel; T033/T034 sequential handoff on US1-owned files
4. Polish: T036/T037 in parallel while the audit and full-suite run complete the feature

---

## Notes

- [P] tasks = different files, no dependencies; every task names its exact repository-relative path(s)
- Frozen-contract rule: this feature NEVER edits 002 modules/contracts — "anything frozen in 002 (entities, ports, URLs, schemas, gate vocabulary) is edited only via an amendment noted in 001" (ROADMAP rule 2); the weight-key amendment recommendation lives in plan.md Complexity Tracking, not in code
- 005 boundary: gating inputs arrive ONLY as `RoutingResolution` values/fixtures (research R6); 007 boundary: tracker data arrives as frozen `IssueView`/`AttachmentView` values from fixtures or the 006-owned test fake (research R8) — both keep 006 independently testable
- Verbatim-quoted constraints (thresholds `{ medium: 50, plausible: 18 }`, `minimumMatchMargin: 10` ≥ 1, eight-signal list, gating/durable/abort/band wording) are inlined in the task text — implementers honor them exactly, no discretion
- Commit after each task or logical group; verify tests FAIL before implementing (Principle VI)
- Stop at any checkpoint to validate a story independently
