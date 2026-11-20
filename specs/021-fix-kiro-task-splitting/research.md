# Phase 0 Research: Per-Task Splitting of Kiro Implementation-Plan Task Files

Feature 021. All findings verified against the repository at branch `021-fix-kiro-task-splitting`
and against the reported file (`/tmp/opencode/uploads/af081b02823e6/tasks.md`, 3,665 bytes —
reproduced in this research as the *reported file*). No NEEDS CLARIFICATION items remain.

## R1 — Verified root-cause chain

**Decision**: Record the defect as a four-link interaction, not a single bug, and fix it at links (2)/(3)
via requirements amendments rather than at link (4).

**Rationale** — verified by running the compiled parser on the reported file's exact shape:

1. **Catch-all heading grammar** (`src/config/defaults.ts:50`):
   `^\s{0,3}#{1,6}\s+(?:(?<id>[0-9]+(?:\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\d*)[.:]?\s+)?(?<title>.+)$`
   — the title group matches any heading text, so `# Implementation Plan` becomes a heading task at
   depth 1; worse, the digit-less word branch `[A-Za-z][A-Za-z0-9-]*\d*` captures `Implementation`
   as the local id, leaving the visible title as `Plan`.
2. **Orphan adoption rule** (`src/parsing/extract.ts:181-182`): `const parent = stack[stack.length - 1] ?? currentHeading;`
   — detail lines are not checkboxes, so each column-0 `- [x] N. …` pops its previous sibling and
   adopts `currentHeading` = the title task; every one of the thirteen checkbox tasks becomes depth 2
   (`src/parsing/depth.ts`: heading = 1; checklist = 1 + parent depth). `4.1`–`4.3`, written at the same
   indent as `4.`, become depth-2 siblings.
3. **Flat-board fold** (020 amendment A-020-1; `DEFAULT_TASK_DEPTH_CAP = 1`, `foldDraftsOverCap`): all
   thirteen depth-2 tasks are excluded as `depth-folded`.
4. **Extent over survivors only** (`src/parsing/taskfile.ts:68,80`; `src/parsing/extent.ts:52-70`):
   folded lines are no longer boundary "task lines", so the surviving title task's `Task_Body` runs to
   EOF; `mirrorRegion` (`src/engine/build.ts:214-219`, duplicated `apply.ts:616-622`) mirrors it into the
   one created issue's description (`apply.ts:893-916, 1754-1756`). One issue titled `Plan`, whole file inside.

Empirics: reported shape at default config → 1 task (line 1, kind heading, `localTaskId: "Implementation"`,
title `Plan`, body [1, EOF]) + 13 `depth-folded` exclusions. Same shape WITHOUT the `# Implementation Plan`
heading → 13 surviving depth-1 tasks. `maxTaskIssueDepth: 64` → 14 tasks with correct regions. Classification
(kiro vs generic) is irrelevant — both rows carry the identical default grammars.

**Alternatives considered**: treating the extent computation (link 4) as the bug — rejected: the 020
feature *intends* folded lines to live inside the nearest surviving ancestor's `Task_Body` (requirements
Requirement 2 criterion 8); that is correct when the ancestor is a real task heading (the `## 9.0:` case in
world `depth-folding-flat`). The defect is that a *document title* became an adoptive task parent at all.

## R2 — Why the original requirements were misunderstood (requirements-drift analysis)

**Decision**: The guardrail for this exact shape existed in the original requirements but was neutralized
by later grammar broadening; amend `specs/requirements.md` with A-021-1 (criterion 4), A-021-2
(criteria 2/13 + Requirement 15.4 default list), A-021-3 (criterion 9).

**Rationale** — the drift chain:

- **001/original requirement text** (still in `specs/requirements.md` Requirement 2 criterion 2, and the
  Requirement 15.4 default list) describes a *narrow* default heading-id grammar —
  `(?:[A-Z][A-Z0-9_]{1,8}-\d+(?:\.\d+)?|Task\s+\d+(?:\.\d+)?|T\d{2,5})` — under which `# Implementation
  Plan` is NOT a task heading at all.
- **The implemented built-in default drifted to the broad catch-all** above (R1.1), because the corpus
  model requires id-less headings to be tasks (`# Tasks`, `## 1.2: Wire session store`; pinned by
  `tests/integration/parsing-corpus.test.ts` and rendered goldens). The requirements text was never
  updated to match — a doc-truthfulness divergence of the kind feature 019 policed for spec-kit docs.
- **Criterion 9 (flat-checklist guard)** — "a document is treated as flat only when it contains no heading
  matching the heading-id grammar … SHALL treat top-level checkboxes as valid tasks **without an enclosing
  heading**" — was written against the *narrow* grammar. Under the broad default the condition is
  unsatisfiable for any real file with a title heading: `# Implementation Plan` matches, so the document is
  never "flat". (004 spec FR-005/US AC4 carried the same wording forward: "no grammar-matching headings".)
- **The flat-document signal is dead code**: `detectFlatDocument` exists (`src/parsing/extract.ts:79-93`)
  and is returned (`extract.ts:206`) but **no consumer reads `flatDocument`** — the guardrail was implemented
  and wired to nothing. Its second trigger (first text line is a checkbox marker) can never fire for a
  title-headed file anyway.
- **Criterion 4's orphan rule** ("attaching each checkbox … to the enclosing heading task when no such
  checkbox exists") then made the title heading the adoptive parent, and **A-020-2's fold** (criterion 8)
  — designed for genuine task headings — buried every real task.
- **Criterion 13 + `LOCAL_ID_SPAN_RE`** (`src/parsing/content.ts:167-168`) require a trailing separator
  (`.:—–-`) after numeric ids, so `- [x] 4.1 Create EC2 client wrapper…` yields NO `Local_Task_ID`
  (identity falls back to fragile ordinal), while the heading grammar's digit-less word branch
  over-captures (`Implementation`).

Net: nobody specified the *document-title heading* as a distinct concept; the flat-document rule assumed a
grammar the product no longer ships, and its implementation was never connected. Amendments below restore
the intent without reversing the deliberate "every heading is a task" corpus model or the deliberate 020
flat-board default.

**Amendments made to `specs/requirements.md`** (this branch, inline per the A-017/A-018/A-020 convention):

- **A-021-1** (Requirement 2 criterion 4): defines the **document-title heading** — the document's
  level-1 first-line heading that precedes every task line and whose text yields no `Local_Task_ID` —
  and states it is NOT an enclosing heading task: top-level checkboxes beneath it attach to no task
  heading (per criterion 9).
- **A-021-2** (Requirement 2 criteria 2 and 13; Requirement 15.4): aligns the *documented* default
  heading grammar with implemented reality (any heading text is a heading task) but requires word-form
  leading ids to contain a digit (so `TASK-1`/`SYNC1`-style ids still parse while `Implementation` in
  `# Implementation Plan` never does); checklist lines gain dotted-numeric id capture without a trailing
  separator (`4.1 Create …` → id `4.1`).
- **A-021-3** (Requirement 2 criterion 9; Requirement 15.4 flat-checklist default): flat-document
  detection disregards the document-title heading — a document whose only grammar-matching heading is its
  title heading IS a flat document — and the determination is normative for top-level checkbox parenting.

**Alternatives considered**: (a) restore the narrow 001 grammar as the default — rejected: breaks the
pinned corpus model (`# Tasks`, id-less `## 1.x:` headings must remain tasks; spec FR-009/SC-005 forbid
changed outcomes for existing shapes); (b) make the title heading structure-only (never a task) —
rejected: would delete the corpus-pinned `# Tasks` heading task (line 1 in
`parsing-corpus.test.ts CORPUS_TASKS`), violating FR-009, and contradicts the spec's documented
assumption that the title heading may still surface as a task with only its own preamble.

## R3 — Adapter-by-adapter analysis: is a similar fix needed elsewhere?

**Decision**: One shared-defaults-layer fix benefits all five affected adapters; the two immune adapters
need no fix but MUST gain regression pins. **No adapter row is edited.**

| Adapter | Heading grammar | Checkbox-id grammar | Exposed to the giant-issue shape? | Fix needed |
|---------|-----------------|---------------------|-----------------------------------|------------|
| kiro | built-in broad catch-all | built-in span (separator required) | **YES** (reported case) | shared fix (A-021-1/2/3) |
| generic (fallback) | built-in catch-all (row carries defaults) | built-in span | **YES** — identical outcome verified; same content parses identically | shared fix; parity pinned (spec FR-008) |
| spec-kit | built-in catch-all | built-in span | **YES** — a `specs/` file with `spec.md`/`plan.md` siblings and the title+checkbox shape breaks identically | shared fix |
| bmad | built-in catch-all | built-in span | **YES** | shared fix |
| open-spec | built-in catch-all | built-in span | **YES** | shared fix |
| spec-kitty | `"(?!)"` — never matches | adapter `checklistIdPattern` already captures dotted ids (`2.1` without separator — 017 amendment 2/T012) | **NO** — no heading tasks exist, so top-level checkboxes are already parentless depth-1 tasks | none; add immunity pin |
| spec-superpower | narrow `#{2,4} Task N:` only | n/a (all checkboxes are rollup-excluded body content by design) | **NO** — a `# Plan title` is not a grammar heading; a heading-less checkbox-only plan yields zero tasks, never a giant one; `Task N:` headings bound each other | none; add immunity pin |

Conclusions: (1) the defect is *shared-default parsing behavior*, so fixing the kiro row alone would leave
spec-kit/bmad/open-spec/generic exposed and would break the kiro↔generic parity invariant that
`parsing-corpus.test.ts` pins; (2) spec-kitty is living proof of the fix's shape — a never-matching heading
grammar plus dotted-id checklist capture is exactly the end state the shared defaults approximate for
title-headed checkbox documents; (3) spec-superpower shows the other valid coexistence model (rollup
capture) and must keep it untouched.

**Alternatives considered**: kiro-row-only grammar overrides — rejected on parity + five-adapter exposure;
engine-level "never create an issue whose description is the whole file" guard — rejected as a symptom
mask: it would fire on legitimately huge single-task documents and would not fix planning, matching,
reporting, or CI gates, which all consume the wrong task set upstream of the engine.

## R4 — Where the fix lands

**Decision**: Amend shared defaults + extraction rule only:
(1) `src/config/defaults.ts` `headingIdGrammar` — word-form id branch requires a digit
(e.g. `[A-Za-z][A-Za-z0-9]*-?\d[A-Za-z0-9-]*`); numeric/dotted-numeric branch unchanged; catch-all title
kept. (2) `src/parsing/content.ts` `LOCAL_ID_SPAN_RE` — add a dotted-numeric alternative capturable with
whitespace only (`[0-9]+(?:\.[0-9]+)+[ \t]+`), single-integer ids keep requiring their separator.
(3) `src/parsing/extract.ts` — when adopting `currentHeading` as orphan parent, skip the parent when the
heading is the document-title heading (level 1, first line of the file, no `localTaskId`, no preceding task
line); the heading task itself is still created, so the corpus model is untouched. Wire the corrected
flat-document determination into this decision and retire or repoint the dead `flatDocument` flag
(its output must now equal the new rule).
`depth.ts`, `extent.ts`, `taskfile.ts`, engine, titles: **no changes** — verified in R7.

**Rationale**: smallest surface that satisfies FR-001…FR-009 simultaneously; every alternative either
violates a pinned corpus outcome, breaks adapter parity, or masks symptoms (R2/R3 alternatives).

**Alternatives considered**: adapter-row overrides (R3); raising `maxTaskIssueDepth` default to 2+ —
rejected: 020's flat-board ruling is deliberate and would also un-fold legitimate depth-2 content;
special-casing files whose basename is `tasks.md` — rejected: shape, not filename, is the signal.

## R5 — Document-title-heading definition (the new concept)

**Decision**: A heading is the **document-title heading** iff ALL: it is the first non-blank line of the
document; its ATX level is 1; it matches the heading grammar (i.e. would be a heading task); its title
span yields no `Local_Task_ID` under the A-021-2 grammar; and no task line appears above it (trivially true
at line 1). At most one per document; fences respected.

**Consequences**: `# Implementation Plan` → title heading (after A-021-2 no id is captured, so its title
stays `Implementation Plan`); `# Task 1: Do thing` → NOT a title heading (id present → real task heading,
orphans still fold under it); `## Section` mid-file → not level-1-first-line → normal behavior;
`# Tasks` corpus heading → IS a title heading, but it still remains a heading task with extent [1,3]
(pinned corpus outcome preserved because the corpus fixture has no column-0 checkboxes before the first
`##` heading); world `depth-folding-flat`'s `## 9.0:` orphan case → level 2, unchanged folding.

**Rationale**: level-1 + first-line + id-less is the exact union of "names the document" signals; it
preserves every pinned outcome (verified against corpus fixture, depth-folding worlds, five-frameworks
discovery fixture, spec-kitty/superpower rows).

**Alternatives considered**: pure structural (level-1 first-line, ignore ids) — rejected: would re-parent
orphans away from genuine `# Task N:`-style H1 task headings; purely id-based (any id-less heading is a
title) — rejected: would re-parent orphans away from mid-file `## Phase`-style organizer headings and
change golden extents.

## R6 — Local-id grammar changes

**Decision**: (a) Heading word-form ids must contain a digit: `TASK-1`, `FOUND-1`, `SYNC1`, `ACME-2` keep
parsing as ids; `Implementation` (and any ordinary leading word) cannot. (b) Checklist dotted-numeric ids
(`4.1`, `1.2.3`) parse without a trailing separator when followed by whitespace + text; a bare integer
still requires `.`/`:`/`—`/`–`/`-` (so `- [ ] 2 of 3 done` stays id-less).

**Rationale**: fixes the visible title mangling (`Plan` → `Implementation Plan`, spec edge case) and gives
`4.1`–`4.3` durable positional ids instead of ordinal fallbacks (Principle II: seed prefers
`Local_Task_ID`); matches how the authoring tool itself numbers tasks. Mirrors the precedent of 017
amendment 2 (`spec-kitty` dotted-variant capture).

**Alternatives considered**: leaving `4.1` inside the title (title becomes `4.1 Create EC2 client wrapper…`)
— acceptable per spec FR-005's "may" but keeps fragile ordinal identity for exactly the tasks users edit
most; R1-style fence around all word ids — rejected, `T001`-style ids are letter-headed and pinned in
fixtures/goldens.

## R7 — Implementation-consequence trace for the amended requirements ("further fixes")

Tracing each amendment through every consumer to decide whether further fixes are needed:

| Consumer | Impact | Further fix? |
|----------|--------|--------------|
| `src/parsing/extract.ts` orphan rule + `detectFlatDocument`/`flatDocument` | New rule decides orphan parenting; the dead flag must equal the new determination or be removed | **YES — core fix** (R4.3) |
| `src/parsing/depth.ts` | Depth formula unchanged; checkbox tasks under a title heading now compute depth 1 | NO |
| `src/parsing/extent.ts`, `taskfile.ts` | Survivors now include the checkbox tasks, so boundaries fall correctly; title task's body = its preamble only | NO |
| `src/engine/build.ts` `mirrorRegion` / `apply.ts` create/update | Per-task regions shrink to correct spans; no code change | NO |
| Titles (`src/titles/derive.ts`, feature-prefix step) | `Implementation Plan` title now full text; feature prefix `auth:` still prepended | NO |
| Identity (`stableUuid` seeds) | Seeds change for the title task (id `Implementation` → none) and for dotted-id tasks (ordinal → `4.1`) — intended seed improvements; previously created giant/`Plan` issues simply stop matching and the corrected tasks create their issues (documented fix-run behavior, spec US3 covers post-fix idempotency) | NO code fix; note in quickstart |
| Requirement 3 rendering (write-back) | Criterion 1 "preserve a present `Local_Task_ID`": `4.1` lines now carry a parsed id; renderer keeps line's id text as-is — verify golden round-trip | **VERIFY** (test pin, not a code fix expected) |
| `src/discovery/adapters/*` rows | Shared defaults consumed via `adapter.x ?? config.x`; adapter-level overrides (`spec-kitty`, `spec-superpower`) keep precedence | NO — immunity pins only |
| `tests/integration/parsing-corpus.test.ts`, goldens, `parsing-identity`, `parsing-depth-fold`, contract surfaces | Must remain byte-identical (FR-009/SC-005); corpus uses cap 64 and the untouched fixture | NO — regression gate |
| Docs (`README.md` Kiro/adapter/grammar sections, `docs/framework-adapters.md`, `docs/configuration-reference.md`) | Documented defaults/behaviors change (A-021-2 grammar text, A-021-3 flat trigger, title-heading rule) | **YES — documentation duty** (same change) |
| `specs/requirements.md` | Requirement 2 criteria 2/4/9/13 + Requirement 15.4 | **YES — amendments A-021-1/2/3 (done on this branch)** |
| Constitution | No principle changes needed (grammar/rules are ordinary defaults) | NO |

Additional fixes that are NOT needed and why: the fold rule (criterion 8) needs no guard — once
parenting is corrected, a file with top-level checkboxes always yields depth-1 survivors; headings are
always depth 1; and checkbox-only files with deep indentation have parentless depth-1 top-level items.
The engine's "one giant issue" symptom has no separate code path, so fixing parsing removes it everywhere
(plan/report/check/CI/MCP included, Principle V).

## R8 — Risks and regression targets

**Decision**: treat these as merge-gating verification targets.

- **Grammar breadth change** (R4.1): any fixture/golden/identity seed relying on digit-less word-id capture.
  Sweep targets: `tests/contract/parsing-golden.test.ts` goldens, `tests/unit/parsing-identity.test.ts`
  (kiro seed values), `tests/fixtures/parsing/**`, engine world `expected/` trees. Known pins checked:
  corpus ids are numeric (`1.1`, `1.2`) or issue refs (`[SYNC-100]`), unaffected.
- **Id-span change** (R6): sentence-leading numbers with separators (`1. Introduction` heading bodies,
  `2.1:` spans) already parse today; only the *no-separator dotted* case is added — low blast radius,
  but `stripLeadingLocalId` is shared by checklist lines and heading title spans, so goldens re-run.
- **Orphan-rule change** (R4.3): must not move any `## 9.0:`-style orphan; world
  `depth-folding-flat` + `depth-folding-two-level`/`-tightened` and `tests/e2e/cli-depth-folding.test.ts`
  are the pins.
- **Corpus parity**: kiro vs generic parse-equality test extended to the new fixture (spec FR-008).
- **Idempotency**: engine world re-plan must show zero actions (Principle IV; spec US3).

**Alternatives considered**: ship behind a config toggle — rejected (Principle III: the broken behavior is
never a sensible default; the amendments are bug-fixes to existing requirements, not new options).

## R9 — Test strategy (maps spec acceptance scenarios → automated tests; FR-010)

**Decision**: add, do not modify existing pins:

1. **Fixture**: `tests/fixtures/parsing/kiro-plan/tasks.md` — the reported file verbatim (13 checkbox
   tasks, `4.1` siblings, `_Requirements:_` italics, no trailing newline).
2. **Unit** `parsing-kiro-plan.test.ts` — parse under kiro virtual path `.kiro/specs/<feature>/tasks.md`
   AND generic virtual path at the **default** config (no cap override — this is what the corpus test's
   `maxTaskIssueDepth: 64` pin never exercised): 14 tasks (13 checklist depth-1 + title heading), ids
   `1..10`,`4.1-4.3`, titles, checked flags, extents (one task body-to-next-task; body-less `4.` empty),
   zero `depth-folded` exclusions, feature name `auth`. US1 AC1-4, US2.
3. **Unit** `parsing-title-heading.test.ts` — R5 rule matrix (H1 id'd vs id-less, level-2, mid-file,
   fenced `#`, checkbox-only file, heading-only file, mixed shape, 100-task file) + dead-flag disposition.
4. **Unit** `parsing-local-id-span.test.ts` — R6 matrix (dotted no-sep, integer w/ sep still works,
   sentence text, `TASK-1`/`T001` ids, heading digit-less word not captured).
5. **Integration world** `tests/fixtures/engine/worlds/kiro-plan-basic/` (repo file at
   `.kiro/specs/<feature>/tasks.md`, fake Linear team) + `engine-kiro-plan-world.test.ts`: plan → 14
   creates; each created description equals its own region and **no description contains any other
   task's text or the whole file** (the regression assertion for the reported bug); re-plan 0 actions;
   toggle one checkbox → exactly 1 update; rollback restores; kiro-vs-generic dual-run equality. US1-US3.
6. **Pins re-run**: `parsing-corpus.test.ts`, goldens, `depth-folding-*`, `engine-spec-kitty-world`,
   spec-superpower tests, discovery suites — unchanged (US4, SC-004/SC-005).

**Rationale**: the bug class escaped testing precisely because the corpus pins the pre-020 cap and the
kiro fixture is heading-driven; the new tests run the reported shape at shipped defaults end-to-end.
**Alternative considered**: extend the shared corpus fixture — rejected: it is one template parsed by all
frameworks; a second kiro-specific shape belongs in dedicated files (017/018 precedent).
