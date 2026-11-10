# Tasks: Documentation Truthfulness — Framework Behavior Claims

**Input**: Design documents from `/specs/019-speckit-doc-truthfulness/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/audit-record-format.md, contracts/doc-truthfulness-guards.md, quickstart.md

**Tests**: INCLUDED and MANDATORY — FR-006 requires contract checks "written test-first"
and Constitution Principle VI (NON-NEGOTIABLE) requires every acceptance criterion
enforced by an automated test. The guard suite (`tests/contract/doc-truthfulness.test.ts`)
is authored RED-FIRST, before any correction lands.

**Organization**: Tasks grouped by user story. One deliberate deviation from priority
order: User Story 3's guard-authoring tasks (Phase 4) execute BEFORE User Story 2's
corrections (Phase 5) because FR-006 mandates test-first guards — the uncorrected
branch IS the "disproven claim restored" scenario (US3-AS1), and the corrections then
turn the suite green (US3-AS2). See Dependencies section.

**Branch discipline (user instruction)**: ALL specs and changes for this feature land on
branch `019-speckit-doc-truthfulness`. Never commit 017/018 files to this branch. Commit
messages carry no `Co-Authored-By` / "Generated with" trailers (repo AGENTS.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = audit record, US2 = corrections, US3 = regression guards
- Exact file paths included per task

## Path Conventions (single project, per plan.md)

- Audited/corrected docs: `README.md`, `docs/framework-adapters.md`, `docs/discovery.md`,
  `docs/parsing.md`, `specs/requirements.md`
- Feature artifacts: `specs/019-speckit-doc-truthfulness/` (`audit.md`, `defects.md`)
- Regression guards: `tests/contract/doc-truthfulness.test.ts`
- Changelog: `CHANGELOG.md`
- ZERO files under `src/` may change (FR-005/SC-003)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch and baseline pinning

- [X] T001 Confirm HEAD is on branch `019-speckit-doc-truthfulness` (`git switch 019-speckit-doc-truthfulness` if not) and capture the baseline commit full hash with `git rev-parse HEAD` — this exact value becomes the `Baseline commit:` header field of specs/019-speckit-doc-truthfulness/audit.md (research R10 evidence-aging rule)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Record scaffolds per contracts/audit-record-format.md — every story writes into these files

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Create specs/019-speckit-doc-truthfulness/audit.md with the exact machine-parsed header block from contracts/audit-record-format.md (`Baseline commit:`, `Audited documents:` listing README.md, docs/framework-adapters.md, docs/discovery.md, docs/parsing.md, specs/requirements.md, `Open false/ambiguous verdicts:`) plus the seven seeded claim sections C-001…C-007 transcribed from the consolidated evidence index in specs/019-speckit-doc-truthfulness/research.md, each using the claim-entry template fields with the data-model.md enum vocabulary (`Verdict.status`: true | false | ambiguous | true-no-claim-present; `EvidenceEntry.kind`: source | test | demo | absence-search; `Verdict.requirementsCheck`: requirements-silent | requirements-agree | requirements-mandate-code-lacks; `Correction.action`: rewrite | remove | label-planned)
- [X] T003 [P] Create specs/019-speckit-doc-truthfulness/defects.md with the `# Follow-up Entries (defect log)` header and the entry template from contracts/audit-record-format.md (fields: `Category` enum defect | enhancement, `Source claim` id pattern C-\d{3}, `Expectation`, `As built`, `Suggested home`, `Status` enum open | mirrored-issue:<url> | absorbed-into:<feature>; entries append-only except Status)

**Checkpoint**: Both records exist with schema-conformant skeletons; family-3 self-check guards will parse these exact shapes.

---

## Phase 3: User Story 1 - Every framework claim has a verdict and evidence (Priority: P1) 🎯 MVP

**Goal**: 100% of framework-behavior statements in the four audited document sets carry an audit entry with location, verbatim claim, evidence, and verdict (FR-001/FR-002/FR-003; SC-001/SC-002).

**Independent Test**: audit record covers every framework-behavior sentence in the audited documents; spot-checking any five entries against the code reproduces the recorded verdict (spec US1 Independent Test; quickstart.md step 4).

### Implementation for User Story 1

All tasks write claim sections into `specs/019-speckit-doc-truthfulness/audit.md`
(same file → no [P] among them).

- [X] T004 [US1] Enumerate every framework-behavior sentence in README.md — the intro block (lines 1–10, incl. the `📋 Task [T###]` marker sentence and the "task-file *sections* map 1:1 to Linear milestones" clause) and the entire `## Using it with your SDD framework` section (adapter table, precedence paragraph, all `###` framework subsections incl. the Spec Kit steps 1–3, customAdapters scope note) — and add one claim entry per sentence with verbatim `Claim:` quote, `Location:` (section + line range at baseline), `Framework scope:`, `Evidence kind:`/`Evidence pointer:`, `Verdict:`, and `Requirements check:`; claim ids continue from C-008 (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T005 [US1] Audit docs/framework-adapters.md (108 lines): one claim entry per framework-behavior statement (adapter table rows, selection-ranking rules, conventions-resolution text), verdicts adjudicated per framework where evidence differs (spec edge case "Claim true for one framework, worded globally") (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T006 [US1] Audit docs/discovery.md (81 lines): safety/skip/escape/determinism/git-context sentences as claimed behavior, each with a `source` or `test` evidence pointer that resolves (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T007 [US1] Audit docs/parsing.md: every sentence restating identifier-capture behavior (heading grammar vs checklist leading-ID span), recording whether each distinguishes heading `T001` capture from separator-requiring checklist capture; ambiguous wording per data-model verdict vocabulary gets a `Verdict: ambiguous` entry (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T008 [US1] Audit specs/requirements.md framework-related text (Requirement 2 parsing criteria, Requirement 7 adapter criteria, `Supported_Framework` glossary): where requirements state as-built truth record `true`; where a requirement mandates behavior the code lacks set `Requirements check: requirements-mandate-code-lacks` — do NOT edit the requirement (Governance; it becomes a defects.md entry) (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T009 [US1] Verify C-001…C-007 against the code at the baseline commit and finalize their fields so the six FR-002 named suspects each carry an explicit entry (SC-002): tags `[P]/[US<n>]` (C-001 false), "Preceded by" edges (C-001, with `Evidence search scope:` naming the searched behavior per US1-AS1), native `[DEP:]`/`[Dep:]` parsing (C-003 `Verdict: true-no-claim-present` after re-grep confirms zero surviving sentences), checkbox `T001` capture (C-002 false-as-worded), selection precedence (C-004 true, evidence pointer to tests/contract/framework-support-consistency.test.ts::framework-consistency: README precedence line matches DEFAULT_PRECEDENCE), agent-hook scaffold table (C-005 true, evidence pointer to the 016 scaffold test) (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T010 [US1] Produce the US1-AS2 concrete demonstration for C-002: run `npm run build`, then drive `parseTaskFile` from dist/parsing with a spec-kit-shaped task file containing the line `- [ ] T001 Create the scaffold`; paste the command and the observed output showing the task parsed with NO `localTaskId` into the `Demonstration:` field of C-002 (evidence kind `demo`) (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T011 [US1] Append the coverage-table appendix to audit.md per contracts/audit-record-format.md: one row per audited document listing every located framework-behavior sentence (verbatim) with its claim id, or `N/A` + reason; confirm 100% coverage of the four document sets (SC-001) (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T012 [US1] Re-verify every evidence pointer mechanically: each `src/...:line` or `src/...::symbol` target exists at HEAD, each `tests/**/*.test.ts::test name` appears in `npm run test:contract` output — satisfying the spec edge case "Evidence that ages" (file: specs/019-speckit-doc-truthfulness/audit.md)

**Checkpoint**: audit.md complete with 100% coverage; false/ambiguous verdicts may remain open at this point (corrections are US2). Five-entry spot-check reproduces verdicts → US1 independently demonstrable.

---

## Phase 4: User Story 3 - Disproven claims cannot come back (Priority: P2 — executed before US2 for test-first)

**Goal**: Contract suite that fails CI when a disproven claim is reintroduced or corrected wording drifts (FR-006), authored red-first per Constitution VI.

**Independent Test**: on the pre-correction branch (this state), the suite fails with named guard failures — equivalent to "restore each disproven sentence and confirm the contract suite fails" because the documents are still uncorrected; after US2 lands, the full suite passes with zero behavior tests changed (spec US3 Independent Test).

### Implementation for User Story 3

All tasks extend the same file `tests/contract/doc-truthfulness.test.ts` (no [P]
among them). Test-name and failure-diagnostic format is normative: names start
`doc-truthfulness: GUARD-NN ` and failures name the guard id, the audit entry
`C-\d{3}`, and the offending document (contracts/doc-truthfulness-guards.md).

- [ ] T013 [US3] Author family-1 forbidden-phrasing guards GUARD-01 (`` `[P]/[US<n>] `` tags / "Preceded by" edges phrasing, C-001), GUARD-02 ("use T001-style ids" + "out-of-the-box" co-occurrence, C-002), GUARD-03 (native `[DEP:]`/`[Dep:]` parsing claims, C-003), GUARD-04 (`📋 Task` marker-line phrasing, C-006), GUARD-04b ("map 1:1 to Linear milestones" / "One milestone per spec folder" phrasing, C-007) as `assert.doesNotMatch` over the concatenated audited documents, patterns keyed to the verbatim original wordings quoted in audit.md; run `npm run test:contract` and VERIFY GUARD-01/02/04/04b FAIL against the still-uncorrected README (red-first; this run is the US3-AS1 evidence) (file: tests/contract/doc-truthfulness.test.ts)
- [ ] T014 [US3] Author family-2 required-wording guards: GUARD-05 (Spec Kit section states mirrored description body + visible `[KEY-N]` reference token + durable sync state in the sync attachment — US2-AS1), GUARD-06 (corrected wording keeps both truths: config-free `specs/<feature>/tasks.md` layout AND local-id capture follows the documented identifier grammar — US2-AS2), GUARD-07 (intro states durability via reference token + attachment-metadata anchor, no in-file marker per Constitution Principle II) as `assert.match` over README.md; these are expected RED until Phase 5 (file: tests/contract/doc-truthfulness.test.ts)
- [ ] T015 [US3] Author family-3 audit-record self-check guards parsing specs/019-speckit-doc-truthfulness/audit.md and defects.md per contracts/audit-record-format.md self-check rules 1–4: header keys present; verdict vocabulary legal (enum set above); every `Verdict: false`/`ambiguous` entry carries a `**Correction**:` line; the six FR-002 suspect topics appear in the record; every `FU-\d{3}` entry's `Source claim` id resolves to a claim section (file: tests/contract/doc-truthfulness.test.ts)
- [ ] T016 [US3] Record the red-first verification in a `## Verification notes` section of audit.md: date, the `npm run test:contract` failure list naming GUARD-01/02/04/04b (and 05/06/07 pending), satisfying FR-006's test-first trail (file: specs/019-speckit-doc-truthfulness/audit.md)

**Checkpoint**: Guards exist and are verifiably red against every disproven sentence — US3's reintroduction defense is in place before wording changes.

---

## Phase 5: User Story 2 - False and ambiguous claims are corrected to as-built truth (Priority: P1)

**Goal**: Every false/ambiguous claim rewritten, removed, or explicitly labeled; corrections preserve practical reader value and cite their evidence (FR-004/FR-005/FR-008).

**Independent Test**: re-running the audit after corrections yields zero false or ambiguous verdicts; each corrected passage cites the evidence entry justifying its new wording (spec US2 Independent Test; mechanical via family-3 guards + audit header).

### Implementation for User Story 2

- [ ] T017 [US2] Correct README.md intro per C-006/C-007 recorded corrections: replace the `📋 Task [T###]` marker-line sentence (line 7) with the as-built durability story — visible `[KEY-N]` reference token on the task line plus the deterministic UUID anchored in the sync-attachment metadata (no in-file marker, Constitution Principle II) — and replace "task-file *sections* map 1:1 to Linear milestones" (line 9) with the truthful statement that plan reports group tasks by project and feature (report-only grouping; the tool never creates or assigns Linear milestones); wording must be backed by the C-006/C-007 evidence entries (file: README.md)
- [ ] T018 [US2] Correct the README.md Spec Kit section (lines ~186–201) per C-001/C-002: step 1 states what is actually recorded per synced task (one issue per task; description mirrors the task body; `[KEY-N]` reference token written back on the task line; durable state in the sync attachment) with no tags/edges/milestone promises; the T001 sentence states the honest grammar split — `T001`-style ids capture from headings matching the heading grammar, checkbox-line capture requires the identifier grammar's separator so plain Spec Kit `- [ ] T001 …` lines sync without local ids (ordinal fallback); example identifiers remain fictional and placeholder-grade (FR-008); after this and T017, GUARD-01/02/04/04b flip green and GUARD-05/06/07 satisfy (file: README.md)
- [ ] T019 [US2] [P] If the audit recorded any false/ambiguous claim in docs/parsing.md (per T007), rewrite it to match the recorded evidence — same content-bar as T018 (separator requirement stated, no falsehood in either direction); if the audit found docs/parsing.md fully truthful, record that outcome in the audit entry's notes instead and mark this task done with no edit (file: docs/parsing.md)
- [ ] T020 [US2] [P] Record follow-up entry FU-001 in specs/019-speckit-doc-truthfulness/defects.md using the contract template: Category `enhancement`, Source claim C-002, Expectation (Spec Kit `- [ ] T001 …` checkbox ids sync as `Local_Task_ID`s), As built (`LOCAL_ID_SPAN_RE` in src/parsing/content.ts requires separator punctuation + whitespace; plain-space Spec Kit lines get ordinal fallback), Suggested home (future feature amending the R2.12 grammar + docs/parsing.md), Status `open` — this is the FR-005 routed gap, NOT implemented here
- [ ] T021 [US2] Update audit.md: add the `**Correction**:` line (action newText landing, evidenceRef) to every entry still lacking one, set header `Open false/ambiguous verdicts: 0` (SC-001), and add `**Guards**: GUARD-…` traceability lines per entry (file: specs/019-speckit-doc-truthfulness/audit.md)
- [ ] T022 [US2] Run `npm run test:contract` and confirm ALL `doc-truthfulness:` guards plus the untouched 016 `framework-support-consistency:` suite pass together (US2 independent test + US3 green-half)

**Checkpoint**: README intro + Spec Kit section describe only reproducible behavior; record closed at zero open false/ambiguous; suite green.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 Add the correction entry under `## [Unreleased]` in CHANGELOG.md recording the doc-truthfulness corrections (what was claimed vs what is now stated, guards added) — US3-AS3 / FR-007 documentation duty; existing tests/contract/changelog.test.ts hygiene must still pass
- [ ] T024 [US2] Run the full `npm test` (all tiers) green, then run `git diff --stat main...HEAD` (or against the merge base) and confirm the touched paths are ONLY README.md, CHANGELOG.md, docs/parsing.md (if corrected), specs/019-speckit-doc-truthfulness/**, and tests/contract/doc-truthfulness.test.ts — zero `src/` files, zero pre-existing test files (SC-003 / US3-AS2)
- [ ] T025 Execute quickstart.md steps 1–6 end-to-end from specs/019-speckit-doc-truthfulness/quickstart.md (full-suite green, guard red-restoration on a scratch branch using recorded original wordings, five-entry evidence spot-check, reader-facing outcome check, changelog + defects checks) and confirm every step's stated expectations hold
- [ ] T026 Confirm branch discipline: `git status` clean for feature files and every commit containing 019 specs/changes is on `019-speckit-doc-truthfulness`; 017/018 untracked artifacts are NOT committed on this branch; commit messages contain no attribution trailers (repo AGENTS.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: start immediately
- **Foundational (Phase 2)**: after Phase 1 — BLOCKS all stories (records must exist with contract-conformant schema)
- **User Story 1 (Phase 3)**: after Phase 2 — the audit is the source of every correction and guard pattern
- **User Story 3 (Phase 4)**: after Phase 3 — REQUIRES audit entries' verbatim claim wordings for guard patterns
- **User Story 2 (Phase 5)**: after Phase 4 — corrections flip the red guards green (test-first ordering)
- **Polish (Phase 6)**: after Phase 5

### Deviation from priority order (documented per plan/constitution)

US3 is P2 but its guard AUTHORING (T013–T015) precedes US2's corrections because FR-006
says "written test-first" and Constitution VI is NON-NEGOTIABLE. This does not break US2
independence: US2's independent test (zero false/ambiguous after re-audit, corrections
cite evidence) is audit+record-based and fully satisfiable at Phase 5's checkpoint. US3's
own "restored claim fails CI" scenario is discharged on the pre-correction state (T013's
verified RED run).

### Within Each User Story

- T004–T012 share audit.md → strictly sequential (or one worker)
- T013–T015 share the guard test file → sequential; each must run before the next's verification
- T017 → T018 both edit README.md → sequential; T019/T020 touch different files → [P] with each other
- T021 (record closure) after T017–T019; T022 last in the story

### Parallel Opportunities

- T002 ∥ T003 (different record files, same contract)
- T019 ∥ T020 (docs/parsing.md ∥ defects.md)
- T012 pointer re-verification is read-only — can overlap with drafting T011
- Otherwise intentionally sequential: this feature edits a small shared document set
  (audit.md, README.md, one test file), so [P] is reserved where files genuinely differ

### Parallel Example

```bash
# Phase 2 skeleton, both records at once:
Task: "Create audit.md skeleton in specs/019-speckit-doc-truthfulness/audit.md"
Task: "Create defects.md skeleton in specs/019-speckit-doc-truthfulness/defects.md"

# Phase 5, different files:
Task: "Correct docs/parsing.md wording per audit entries"
Task: "Record FU-001 in specs/019-speckit-doc-truthfulness/defects.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (branch + baseline hash)
2. Complete Phase 2 (record skeletons)
3. Complete Phase 3 (full audit: 100% coverage, six suspects adjudicated, demo + pointers verified)
4. **STOP and VALIDATE**: five-entry spot-check reproduces verdicts (US1 Independent Test)
5. The evidence record alone is shippable value: future audits extend it (FR-003)

### Incremental Delivery

1. Setup + Foundational → records ready
2. US1 audit → validate independently → (MVP: evidence record exists)
3. US3 guards red-first → validate RED run names each disproven claim
4. US2 corrections → suite green, record closes at 0 open false/ambiguous → validate independently
5. Polish → CHANGELOG, full suite + diff purity, quickstart 1–6, branch-discipline check

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- NO file under `src/` changes in this feature (FR-005); a diff touching src/ is a stop-the-line defect
- Verify guards RED before corrections (T013/T016) — never correct first and guard after
- All example identifiers in corrected text fictional/placeholder-grade (FR-008, constitution Principle III)
- Commit after each phase; every commit stays on `019-speckit-doc-truthfulness` with no attribution trailers
- Stop at any checkpoint to validate a story independently
