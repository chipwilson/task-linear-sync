# Phase 0 Research: Documentation Truthfulness — Framework Behavior Claims

**Feature**: `019-speckit-doc-truthfulness` | **Date**: 2026-11-10

All research questions were resolved against the repository as it stands on branch
`019-speckit-doc-truthfulness` at planning time (commit `5a92b4f`). No NEEDS
CLARIFICATION items remain. The six FR-002 suspect claims plus three adjacent suspect
claims were each adjudicated with file-level evidence; the full claim-by-claim audit of
every framework-behavior sentence is the P1 implementation artifact (`audit.md`), which
extends — never re-derives — the findings below (FR-003).

## R1. Audit scope and claim unit

- **Decision**: The audit record enumerates one claim per user-facing framework-behavior
  statement (sentence or table cell) in exactly four document sets: (a) README
  `## Using it with your SDD framework` section **plus** the two intro sentences in
  `README.md` L1–L10 that assert sync/framework behavior; (b) `docs/framework-adapters.md`;
  (c) `docs/discovery.md`; (d) `specs/requirements.md` framework-related text
  (Requirement 2, Requirement 7, framework glossary entries). `docs/parsing.md` is
  audited as adjacent text where it restates identifier-capture behavior. Claim id
  scheme, fields, and verdict vocabulary are fixed by
  [contracts/audit-record-format.md](./contracts/audit-record-format.md).
- **Rationale**: FR-001 names these document sets; the README intro sentences make the
  same kind of promise (`📋` marker line, milestone mapping) that the spec's Key
  Entities define as claims, so excluding them would leave the reader's wrong mental
  model untouched while the framework section was being fixed.
- **Alternatives considered**: README-only audit (rejected — FR-001 explicitly includes
  docs and requirements); per-word or per-paragraph granularity (rejected — sentence/
  table-cell granularity matches evidence granularity and keeps guards expressible).

## R2. The `[P]/[US<n>]` tags + "Preceded by" edges claim — FALSE

- **Decision**: `README.md:195-196` ("One milestone per spec folder, one issue per
  T-task, with `[P]/[US<n>]` tags and 'Preceded by' edges recorded on the issue") is
  recorded false. Correct wording states what is actually recorded per synced task:
  one issue per task, the mirrored task body as the issue description, the visible
  `[KEY-N]` reference token written back on the task line, and the durable sync state
  in the canonical `Sync_Attachment` metadata.
- **Evidence examined** (recorded in the audit entry): `src/tracker/operations/
  mutations.ts::createIssueImpl` writes only title, description, state, and parent —
  no label/tag input exists; repository-wide search for `[P]`/`[US<n>]` extraction,
  "preceded", or any dependency-edge construction returns zero hits in `src/`; the
  fake-and-real `Linear_Port` contract surface exposes no label or edge mutation.
  Requirement 2/7/9/10 mandate no tags or edges, so this is a pure documentation
  fabrication (016-era residue), not an unimplemented mandate — correction, not
  `defects.md`.
- **Rationale**: spec Acceptance Scenario US1-AS1 demands exactly this verdict +
  evidence naming the searched behavior.
- **Alternatives considered**: implementing tags/edges (out of scope per spec
  "Out of scope"); keeping the sentence labeled "planned" (rejected — nothing in any
  requirements text mandates it, so it has no home as a planned item; a `defects.md`
  *candidate* entry is not warranted because there is no requirements gap).

## R3. "Out-of-the-box T001-style ids" from Spec Kit checkbox lines — FALSE as worded

- **Decision**: `README.md:186` ("Tasks land at `specs/<feature>/tasks.md` and use
  T001-style ids — this is the out-of-the-box convention, no configuration needed") is
  recorded false-as-worded. As-built truth: discovery and the heading grammar handle
  `T001` ids on **headings** (`## T001: …` matches the frozen heading-id grammar), but
  checklist identifier capture (`stripLeadingLocalId` / `LOCAL_ID_SPAN_RE`,
  `src/parsing/content.ts:167-168`) requires an id followed by separator punctuation
  (`. : — – -`) and whitespace — Spec Kit's `/speckit.tasks` output prints
  `- [ ] T001 <description>` with a plain space, so Spec Kit checkbox tasks sync
  **without** `localTaskId` (identity falls back to the stable ordinal seed). The
  audit entry must carry the concrete demonstration required by US1-AS2: parsing
  `- [ ] T001 Create the scaffold` yields a task with no `localTaskId`.
- **Requirements check**: `requirements.md` R2.12 says `Local_Task_ID` is parsed "when
  the configured identifier grammar matches at the beginning of the task title" — the
  code honors that; the grammar itself is the separator-requiring one. So the
  requirements state as-built truth and the README alone overstates → README corrected
  to match (spec edge case "Requirements versus README conflict").
- **Follow-up routing**: making checklist capture separator-free (so Spec Kit checkbox
  ids truly sync) is recorded as a follow-up entry in `defects.md`
  (category: enhancement, not defect) per the spec Assumption.
- **Rationale**: honest wording in both directions — the sentence must not imply T-ids
  are ignored everywhere (headings do capture) nor that checkbox ids are captured
  (they are not).
- **Alternatives considered**: deleting the sentence (rejected — loses the genuinely
  true and useful fact that the `specs/<feature>/tasks.md` layout needs no config);
  implementing separator-free capture here (rejected — spec Out-of-scope: no sync
  behavior change).

## R4. Native `[DEP:]`/`[Dep:]` parsing claims — NO SURVIVING CLAIM (vacuous pass)

- **Decision**: Record an explicit audit entry stating that after feature 016 no
  sentence claiming native `[DEP:]`/`[Dep:]` dependency-syntax parsing survives in
  any audited document (grep across `README.md`, `docs/`, `specs/requirements.md`:
  zero hits). Verdict `true (no claim present)` keeps FR-002's "wherever such
  sentences survive" requirement checkable and prevents re-audit churn.
- **Rationale**: FR-003 wants future audits to extend, not re-derive; a future editor
  who reintroduces such a sentence hits the guard (R8) and the audit entry gets a real
  location.
- **Alternatives considered**: omitting the entry (rejected — SC-002 requires all six
  named suspects to carry an explicit entry).

## R5. Selection-precedence statement — TRUE, already pinned

- **Decision**: `README.md:171-172` (longest-match → fixed precedence
  `kiro → open-spec → spec-kit → bmad → generic` → alphabetical tie-break) is
  evidence-true against `DEFAULT_PRECEDENCE` in `src/discovery/registry.ts` and
  already pinned by 016's test `framework-support-consistency.test.ts`
  ("README precedence line matches DEFAULT_PRECEDENCE"). Audit cites that test as
  evidence; no new guard needed (guards must not duplicate 016 pins).
- **Rationale**: US1-AS4 (a true claim with test evidence); spec "Consumes from 016:
  extend rather than duplicate".
- **Alternatives considered**: re-pinning in the new suite (rejected — two guards for
  one fact drift separately).

## R6. Agent-hook scaffold table — TRUE, already pinned

- **Decision**: `README.md:322` ("Scaffold the agent-hook template (`kiro` default,
  `generic` also available)") and the per-framework hook-directory claims
  (`.kiro/hooks/`, `.task-linear-sync/hooks/`) are evidence-true against
  `agentHookScaffold` (`src/discovery/agent-hooks.ts`) and pinned by 016's
  "agent-hook scaffold claims match the code" test. Recorded true with that pointer.
- **Rationale / Alternatives**: as R5.

## R7. Adjacent README claims: `📋 Task [T###]` marker line and milestone mapping — FALSE

- **Decision** (both discovered during this research pass; the audit record promotes
  them to first-class entries):
  1. `README.md:7` ("A persistent `📋 Task [T###]` marker line keeps the mapping alive")
     and the `README.md:200` restatement are false: the character `📋` occurs nowhere
     in `src/`, `tests/`, `docs/`, or `specs/requirements.md` — no such marker line is
     ever written or parsed. As-built: mapping survives via (a) the visible `[KEY-N]`
     reference token on the task line (`src/parsing/render.ts` header + `:115`),
     (b) the deterministic `Stable_UUID` anchored in `Sync_Attachment` metadata — and
     the constitution (Principle II) **forbids** an in-file identity marker;
     `requirements.md` R2.9 parses no in-file marker. Correction: describe the
     reference-token + attachment-metadata anchors honestly.
  2. `README.md:9` ("task-file *sections* map 1:1 to Linear milestones") and the
     `README.md:194` fragment ("One milestone per spec folder") are false: zero
     milestone references exist in `src/engine/` or `src/tracker/` (no milestone is
     ever created or assigned); "milestone" exists only as a **report grouping
     bucket** keyed by `featureName` (`src/engine/report.ts:23-27, 141`). Correction:
     describe the report grouping as what it is; remove the tracker-side promise.
- **Requirements check**: no requirement mandates milestone creation/assignment
  (`requirements.md` uses "milestone" only inside the phase pattern and the report
  grouping), so both are doc fabrications → corrections, not `defects.md` entries.
- **Rationale**: these sentences sit in the audited intro/Spec-Kit sections, make the
  exact category of false promise the feature exists to eliminate, and one of them
  contradicts a NON-NEGOTIABLE constitutional principle.
- **Alternatives considered**: deferring to a later feature (rejected — SC-001 counts
  every framework-behavior sentence in the audited sections; leaving them false fails
  the feature's own success criterion).

## R8. Regression-guard pattern — new sibling contract suite

- **Decision**: Add `tests/contract/doc-truthfulness.test.ts`, authored **test-first**
  (red against the current README, green after corrections), following the 016
  doc-pinning pattern (`node:test` + `readFileSync` + regex asserts). Three check
  families, specified in
  [contracts/doc-truthfulness-guards.md](./contracts/doc-truthfulness-guards.md):
  1. **Per-claim pins** — for each disproven claim, a `doesNotMatch` on the named
     phrasing pattern (e.g. `` `[P]/[US<n>] `` tags, "Preceded by", `📋`, the
     "1:1 to Linear milestones" phrasing) over the audited documents;
  2. **Corrected-wording pins** — `match` assertions that the corrected Spec-Kit /
     intro sentences keep asserting the evidence-backed facts (reference token,
     attachment-metadata anchor, separator requirement);
  3. **Audit-record self-checks** — `audit.md` exists, every audited-doc claim table
     cell resolves to an entry, and no entry carries a `false`/`ambiguous` verdict
     once corrections land (SC-001 mechanically checked).
- **Rationale**: FR-006 demands CI failure on reintroduction "following the pattern of
  the framework-consistency suite from feature 016, written test-first"; a sibling
  file keeps the two concerns (framework-set consistency vs claim truthfulness)
  independently readable while sharing the same tier, runner, and idioms.
- **Alternatives considered**: extending `framework-support-consistency.test.ts`
  (rejected — mixes set-consistency with claim-truth pins and grows one file past its
  stated contract); a markdownlint/custom-lint plugin (rejected — new tooling, cannot
  express the audit self-checks, and the repo's contract tier already owns doc pins);
  semantic doc→code verification (explicitly out of scope per spec Assumptions).

## R9. Follow-up / defect tracking home — `defects.md` in the feature directory

- **Decision**: Follow-up entries (genuine implementation gaps or routed enhancements)
  live in `specs/019-speckit-doc-truthfulness/defects.md` using the entry schema in
  contracts/audit-record-format.md (id, discovered-by claim, what the docs/requirements
  expect vs what code does, suggested home feature, status). Known first entries:
  `FU-001` separator-free checklist identifier capture (from R3).
- **Rationale**: FR-005 prescribes "a tracked follow-up entry (defect log in this
  feature directory)"; the repo has no GitHub-issue workflow in its spec process, and
  the spec/roadmap flow (ROADMAP.md) gives the entry a concrete intake path.
- **Alternatives considered**: GitHub issues alone (rejected by FR-005's explicit
  wording; a later task may mirror entries as issues); silently editing requirements
  to match code (forbidden by the constitution's Governance section).

## R10. Merge-order dependency (unmerged 017/018, in-review doc churn)

- **Decision**: The audit runs against the document set as merged on this branch at
  execution time and records its baseline commit hash at the top of `audit.md`
  (evidence-aging rule from the spec edge cases). `specs/017-*` and `specs/018-*`
  describe spec-kitty / spec-superpower adapters; their *specs* are not audited
  documents (audit scope covers shipped docs), and the guards only pin shipped text,
  so their landing cannot false-positive the suite. Landing 019 before 017/018 keeps
  those features extending already-truthful documents (spec Assumption).
- **Rationale**: avoids auditing a moving target; baseline hash makes every evidence
  citation (file:line) cheaply re-verifiable later.
- **Alternatives considered**: waiting for 017/018 (rejected — they consume 019's
  truthful docs, not vice versa); auditing 017/018 spec files (rejected — out of
  FR-001 scope).

## Consolidated evidence index (seeds for audit.md)

| # | Location | Claim gist | Verdict | Evidence |
|---|---|---|---|---|
| C-001 | README.md:195-196 | `[P]/[US<n>]` tags + "Preceded by" edges on issues | **false** | R2: no tag/edge code anywhere; `createIssueImpl` writes title/description/state/parent only |
| C-002 | README.md:186 | out-of-the-box T001 id capture (incl. checkbox lines) | **false as worded** | R3: `LOCAL_ID_SPAN_RE` separator requirement, `src/parsing/content.ts:167-168`; demo `- [ ] T001 …` → no `localTaskId` |
| C-003 | (any audited doc) | native `[DEP:]`/`[Dep:]` parsing | true — no claim present | R4: zero grep hits post-016 |
| C-004 | README.md:171-172 | selection precedence | **true** | R5: `DEFAULT_PRECEDENCE` + 016 pin test |
| C-005 | README.md:322 + hook-dir rows | agent-hook scaffold table | **true** | R6: `agentHookScaffold` + 016 pin test |
| C-006 | README.md:7, :200 | persistent `📋 Task [T###]` marker line | **false** | R7.1: `📋` absent from src/tests/docs/requirements; Principle II forbids in-file markers; as-built = `[KEY-N]` token + attachment metadata |
| C-007 | README.md:9, :194 | sections map 1:1 to Linear milestones / one milestone per spec folder | **false** | R7.2: no milestone writes in `src/engine`/`src/tracker`; report-only grouping bucket (`src/engine/report.ts:23-27,141`) |

The implementation audit (P1) enumerates the remaining framework-behavior sentences in
the four document sets until coverage is 100% (SC-001).
