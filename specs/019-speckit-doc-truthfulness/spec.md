# Feature Specification: Documentation Truthfulness — Framework Behavior Claims

**Feature Branch**: `019-speckit-doc-truthfulness`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "research and correct the identified doc truthfulness issue
with spec-kit syncs"

## Purpose and Scope

Feature 016 removed fabricated framework names from the README, but the audit that
produced that fix surfaced further claims that the code does not honor. The README's
GitHub Spec Kit section states that a synced spec creates "one issue per T-task, with
`[P]/[US<n>]` tags and 'Preceded by' edges recorded on the issue" — no part of the
codebase records capability tags or dependency edges on issues; dependency parsing does
not exist for any framework, and `[P]`/`[US<n>]` tags are neither extracted nor recorded.
Related wording implies the out-of-the-box capture of `T001`-style identifiers from
Spec Kit checkbox lines, but identifier capture from checklist lines requires a separator
the upstream format does not print, so Spec Kit tasks sync without local ids. A reader
who trusts these sentences builds wrong expectations about what lands in Linear.

This feature makes every framework-behavior statement in the user-facing documents
verifiable against the implementation: audit each claim, correct the false and ambiguous
ones to as-built truth, guard against reintroduction, and route any genuine
implementation gap into tracked follow-up work instead of silently deleting the intent.

**Owns**: the claim-by-claim audit and its evidence record; the wording corrections in
README, docs, and requirements where they contradict as-built behavior; the regression
guards for disproven claims.

**Consumes from 016**: the framework-consistency contract suite and its pattern of
doc-pinning tests, which this feature extends rather than duplicates.

**Out of scope**: changing sync behavior. If the audit concludes that a documented claim
reflects behavior the requirements mandate but the code lacks, this feature records a
defect and opens tracked follow-up work — it does not implement the missing behavior, and
it does not quietly delete a requirement that is merely unimplemented.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every framework claim has a verdict and evidence (Priority: P1)

A maintainer opens the audit record and finds every framework-behavior statement made in
the README, the framework/discovery docs, and the master requirements listed claim by
claim: where it appears, what code or test evidence supports it, and a verdict of true,
false, or ambiguous. The known suspects — issue-recorded `[P]`/`[US<n>]` tags, "Preceded
by" dependency edges, native `[DEP:]`/`[Dep:]` parsing (wherever such sentences survive),
out-of-the-box `T001`-id capture from checkbox lines — are each explicitly adjudicated.

**Why this priority**: without the evidence record there is no principled way to decide
what to correct, and the same fabrications can return with the next doc edit.

**Independent Test**: the audit record covers 100% of framework-behavior sentences in the
audited documents; spot-checking any five entries against the code reproduces the recorded
verdict.

**Acceptance Scenarios**:

1. **Given** the README's Spec Kit section, **When** the audit runs, **Then** the
   tags-and-edges sentence appears with a verdict of false and evidence naming the
   searched behavior (no tag extraction, no edge recording anywhere).
2. **Given** the sentence implying out-of-the-box `T001` identifier capture, **When** the
   audit runs, **Then** it receives a verdict reflecting the separator requirement of
   checklist identifier capture, with a concrete demonstration (a checkbox line as Spec
   Kit prints it yields no local id).
3. **Given** any surviving sentence claiming native dependency-syntax parsing, **When**
   the audit runs, **Then** it appears with a verdict and evidence.
4. **Given** a claim that is true (for example the selection-precedence statement or the
   agent-hook scaffold table), **When** the audit runs, **Then** it appears with a verdict
   of true and the test or source evidence that backs it.

---

### User Story 2 - False and ambiguous claims are corrected to as-built truth (Priority: P1)

Every claim the audit marks false or ambiguous is rewritten, removed, or explicitly
labeled, so what remains describes behavior a reader can reproduce. Corrections preserve
the reader's practical benefit — an honest description of what a synced Spec Kit task
actually produces — rather than leaving gaps.

**Why this priority**: the audit without correction leaves the original harm untouched;
P1 stories are the two halves of "research and correct".

**Independent Test**: re-running the audit after the corrections yields zero false or
ambiguous verdicts; each corrected passage cites the evidence entry that justifies its
new wording.

**Acceptance Scenarios**:

1. **Given** the disproven tags-and-edges sentence, **When** the correction lands,
   **Then** the README states what is actually recorded per task (the mirrored body, the
   reference prefix, the durable sync state) and no longer promises tags or edges.
2. **Given** the `T001`-capture wording, **When** the correction lands, **Then** a reader
   learns the true behavior — task numbering appears where it truly appears, and local-id
   capture follows the documented identifier grammar — without technical falsehoods in
   either direction.
3. **Given** a claim the audit finds true but ambiguously worded, **When** the correction
   lands, **Then** the revised sentence still matches its recorded evidence.
4. **Given** an audit finding where the requirement mandates behavior the code lacks,
   **When** the correction lands, **Then** the document no longer asserts the behavior as
   current AND a tracked follow-up entry records the gap.

---

### User Story 3 - Disproven claims cannot come back (Priority: P2)

The corrections are pinned: automated contract checks fail if a disproven claim is
reintroduced or if a corrected claim silently drifts, extending the pattern feature 016
established so documentation truthfulness becomes a maintained property, not a one-time
cleanup.

**Why this priority**: valuable prevention; the corrections themselves deliver the
immediate value and are independently shippable.

**Independent Test**: on a scratch branch, restore each disproven sentence and confirm the
contract suite fails; on the corrected branch, the full suite passes with zero behavior
tests changed.

**Acceptance Scenarios**:

1. **Given** a branch that restores the tags-and-edges sentence, **When** CI runs,
   **Then** a named contract test fails.
2. **Given** the corrected branch, **When** the full suite runs, **Then** it passes and
   the diff contains no changes to sync behavior (documentation and tests only).
3. **Given** the CHANGELOG, **When** the change lands, **Then** an entry records the
   correction under the unreleased section.

---

### Edge Cases

- **Claim fixed on an unmerged branch**: some sentences are being rewritten by the
  in-review framework-consolidation change; the audit runs against the document set as it
  stands when the feature executes and records merge-order dependencies rather than
  auditing a moving target.
- **Claim true for one framework, worded globally**: adjudicated per framework; the
  correction scopes the sentence to the frameworks where the evidence holds.
- **Docs that intentionally describe future work**: permitted only when explicitly
  labeled as planned; unlabeled future-tense sentences currently written as present-tense
  behavior count as false claims.
- **Requirements versus README conflict**: where the master requirements already state the
  as-built truth, the README is corrected to match; where the requirements themselves
  assert unimplemented behavior as current, the entry becomes a tracked defect (constitution
  governance applies).
- **Evidence that ages**: each evidence entry names a concrete test or a stable source
  location so later audits can re-verify cheaply.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The audit MUST cover every framework-behavior statement in the README
  framework sections, the framework-adapters and discovery docs, and the master
  requirements' framework-related text, recording for each: location, exact claim, code
  or test evidence examined, and a verdict of true, false, or ambiguous.
- **FR-002**: The audit MUST explicitly adjudicate the known suspect claims: issue-recorded
  `[P]`/`[US<n>]` tags, "Preceded by" dependency edges, any surviving native
  `[DEP:]`/`[Dep:]` parsing claim, out-of-the-box `T001` identifier capture from checklist
  lines, the selection-precedence statement, and the agent-hook scaffold table.
- **FR-003**: The evidence record MUST be persisted in this feature directory so future
  audits extend it instead of re-deriving it.
- **FR-004**: Every claim adjudicated false or ambiguous MUST be corrected, removed, or
  explicitly labeled as planned before this feature completes; corrected wording MUST be
  backed by the entry's evidence.
- **FR-005**: Corrections MUST NOT change any sync behavior; any audit finding that the
  requirements mandate behavior the code lacks MUST be recorded as a tracked follow-up
  entry (defect log in this feature directory) rather than implemented or silently
  dropped.
- **FR-006**: The System MUST add contract checks that fail CI when a disproven claim is
  reintroduced into audited documents, following the pattern of the framework-consistency
  suite from feature 016, written test-first.
- **FR-007**: The documentation duty of the constitution is satisfied by this feature:
  corrected documents, a CHANGELOG entry, and consistency with the master requirements in
  the same change.
- **FR-008**: Example identifiers in corrected text MUST remain fictional and
  placeholder-grade, consistent with the distributed-defaults rules.

### Key Entities

- **Claim**: one framework-behavior statement extracted from a document, with its location
  and exact wording.
- **Evidence Entry**: the code location, test name, or demonstration that decides a
  claim's truth.
- **Verdict**: true / false / ambiguous, with the reasoning summary.
- **Correction**: the replacement wording for a false or ambiguous claim, traceable to its
  evidence entry.
- **Follow-up Entry**: a tracked record of an audit finding that indicates a genuine
  implementation gap (kept out of this feature's scope).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of framework-behavior statements in the audited documents carry an audit
  entry, and after correction 0 entries remain with a false or ambiguous verdict.
- **SC-002**: Every one of the six named suspect claims has an explicit verdict with
  evidence in the record.
- **SC-003**: The regression guards exist and fail on restored claims; on the delivered
  branch the full test suite passes with zero changes to sync behavior (the diff touches
  documents, tests, and the changelog only).
- **SC-004**: A reader of the corrected README can state, without consulting source code,
  exactly what a synced task produces — verified by the audit's corrected-wording entries
  all citing reproduction evidence.

## Assumptions

- The audit runs against the merged document set at execution time; if the framework-
  consolidation change is still unmerged, its text is included as the working state and
  the dependency is recorded in the audit record.
- "Correct" means as-built truth: documents describe what the tool does today; desired
  future behavior belongs in requirements or tracked follow-ups, labeled as such.
- The `T001`-capture finding is expected to be resolved by honest wording in this
  feature; making checklist identifier capture separator-free (so Spec Kit checkbox ids
  truly sync) is a plausible follow-up entry, not part of this change.
- Contract checks guard phrasing patterns (named false claims), not general English — full
  semantic doc verification is out of scope; the audit record carries the rest.
- Landing this feature before 017/018 is preferred so those features extend already-
  truthful documents.
