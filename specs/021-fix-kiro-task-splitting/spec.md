# Feature Specification: Per-Task Splitting of Kiro Implementation-Plan Task Files

**Feature Branch**: `021-fix-kiro-task-splitting`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "While running the integration tests which are located in another repo, this attached kiro tasks.md file creates one big issue in linear with the entire contents of the file, instead of each task in the file being a separate Linear issue. Please specify a fix along with the tests that prove the new correct behavior"

## Problem Summary

The reported file (attached by the reporter as `tasks.md`, 3,665 bytes) is a standard Kiro "Implementation Plan" layout: a single title heading (`# Implementation Plan`), thirteen numbered checkbox tasks (`- [x] 1. …` through `- [x] 10. …`, including `4.1`–`4.3` written at the same indentation level as their parent `4.`), un-checkboxed bullet lines giving each task's details, and italic `_Requirements: …_` cross-reference lines. There are no other headings in the file.

When this file is synced with out-of-the-box settings, the team receives **one** issue (titled "Plan") whose description is the **entire file** — all thirteen tasks, their details and their requirement notes. Expected behavior: each of the thirteen checkbox tasks is its own issue, carrying only its own detail lines. Investigation confirms this happens specifically for the combination of (a) exactly one title-only heading at the top of the file, (b) every task expressed as a top-level checkbox item beneath it, and (c) the shipped flat-board task-depth default — the checkbox tasks are treated as children of the title heading, hidden by the depth default, and the surviving title task then absorbs the whole file as its description. Heading-driven files (which contain task headings throughout) never hit this because later headings bound the title task's description.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kiro implementation plan syncs as one issue per task (Priority: P1)

An operator maintains a Kiro-style `tasks.md` (title heading + numbered checkbox tasks + detail bullets) for a feature. They run the sync. Instead of one giant "catch-all" issue containing the entire file, each numbered task appears in the team's Linear board as its own issue titled with that task's own text, and each issue's description contains only that task's own detail lines.

**Why this priority**: This is the reported defect and the core user value; without it the sync output is unusable for this file layout.

**Independent Test**: Sync the reported file (or a fixture reproducing its exact shape) against the standard test tracker and count the created issues and their titles/descriptions; no other behavior is needed to validate it.

**Acceptance Scenarios**:

1. **Given** a task file whose only heading is the leading `# Implementation Plan` title and whose thirteen tasks are top-level checkbox items, **When** the sync plan is built and applied with default settings, **Then** thirteen task issues are created — one per checkbox task — with titles taken from each task's own line (e.g., "Set up project structure and dependencies", "Create EC2 client wrapper with retry logic"), and none of them is a copy of another.
2. **Given** the same file and settings, **When** the plan is built, **Then** zero created issues contain a description that spans more than one task's region — no issue's description includes the text of a different task's line, detail bullets, or requirement notes.
3. **Given** the same file, **When** the sync runs, **Then** every checkbox task in the file is represented: all thirteen appear, including the `4.1`, `4.2`, `4.3` items written at the same level as their parent `4.`, and checked (`[x]`) as well as unchecked (`[ ]`) tasks.
4. **Given** the same file and settings, **When** the plan is built, **Then** the leading title heading behaves exactly like a leading title heading does in every other supported file today (it may surface as a task in its own right, per the existing "every heading is a task" behavior), except that its description now covers only its own preamble region (here: nothing, since the first task line immediately follows) and never the content of other tasks.

---

### User Story 2 - Each issue carries exactly its own task's details (Priority: P2)

A developer opens any one of the created issues in Linear. The description shows that task's own bullet details and its `_Requirements: …_` note, and nothing belonging to neighboring tasks. Conversely, a task with no detail lines of its own (e.g., item `4. Implement EC2 service module`, which is immediately followed by its `4.1` sibling) yields an issue with an empty description rather than one that absorbs the following tasks.

**Why this priority**: Splitting into thirteen issues is only useful if the right content lands in the right issue; mis-split regions are the same class of defect at smaller scale.

**Independent Test**: For each of the thirteen tasks in the reported file, compare the created issue's description against the file region from that task's line up to (but not including) the next task line; they must match modulo the existing description normalization.

**Acceptance Scenarios**:

1. **Given** a task followed by indented detail bullets and an italic requirements line, **When** its issue is created, **Then** its description contains those bullets and the requirements line, verbatim.
2. **Given** a task immediately followed by another task line (no body of its own), **When** its issue is created, **Then** its description is empty (no borrowed content from the following task).
3. **Given** the reported file, **When** the sync runs, **Then** no task's detail bullet or requirement note appears in any other issue.

---

### User Story 3 - Repeat syncs stay idempotent for split tasks (Priority: P2)

The operator edits the plan (checks a box, adds a detail bullet) and re-runs the sync. The thirteen tasks are matched to the same thirteen issues — none duplicated, none orphaned — the newly checked task is reflected as completed, and an unchanged re-run produces zero changes.

**Why this priority**: The tool's core promise is idempotent, identity-stable sync; a fix that splits correctly on the first run but loses matching on later runs would trade one defect for another.

**Independent Test**: Apply twice with no file changes (expect zero actions), then toggle one task's checkbox and re-apply (expect exactly that task's issue updated, no creates/deletes).

**Acceptance Scenarios**:

1. **Given** a completed sync of the reported file, **When** the sync is re-run without file changes, **Then** no new issues are created and no issue is updated.
2. **Given** a completed sync, **When** one task's checkbox is toggled and the sync re-runs, **Then** exactly that task's issue reflects the completion change and no other issue is touched.

---

### User Story 4 - No regressions for other file shapes or intentional folding (Priority: P3)

Maintainers change nothing for users of the other supported layouts: heading-driven task files, flat checklists with no heading at all, and the intentional flat-board behavior where checklists nested *under a real task heading* fold verbatim into that heading task's description. All previously passing automated tests still pass.

**Why this priority**: The fix must not change established, documented behavior for the majority of users; it only corrects the title-heading-swallowing case.

**Independent Test**: Run the complete existing automated test suite; every previously passing test still passes, and file-shape fixtures parse identically before and after the change.

**Acceptance Scenarios**:

1. **Given** every existing framework-shape test file in the project's test corpus, **When** parsing/planning runs with the same settings as before, **Then** extracted tasks, kinds, ids, titles, extents and folding outcomes are unchanged.
2. **Given** a file where an id-bearing task heading is followed by an orphaned checklist (the documented flat-board folding case), **When** the default settings are used, **Then** the checklist still folds into that task's description exactly as today.
3. **Given** the reported file placed anywhere a task file is recognized — whether classified as Kiro or as the generic fallback — **When** parsed, **Then** the extracted tasks are identical, as they are for all shared-grammar frameworks today.

---

### Edge Cases

- **No heading at all** (pure flat checklist file): already yields one task per checkbox at default settings; behavior MUST remain unchanged.
- **Title heading + prose only, zero checkbox tasks**: no catch-all issue arises; the file behaves like any other heading-only file (its heading task's description is bounded by the next task/heading, or end of file when there are none — as today).
- **Mixed shapes**: a checkbox-driven file that later gains `##` section headings — checkbox tasks before the first heading and heading tasks after it must all surface correctly.
- **Sub-numbered siblings** (`4.1`–`4.3` at the same indentation as `4.`): treated as sibling tasks, not as children hidden under `4.`.
- **Checked vs unchecked**: all thirteen reported tasks are `[x]`; completion state must not affect whether a task surfaces.
- **Title text that looks like an identifier** (`# Implementation Plan`): the visible title of that task must remain the full readable phrase — a leading word of an ordinary title must not be silently consumed as a task id (today's "Plan" mangling is a visible artifact of the giant issue and must not survive the fix).
- **Very large plans** (100+ checkbox tasks): every top-level checkbox task surfaces; no implicit truncation.
- **Trailing blank lines / blank lines between tasks**: do not create extra tasks and do not change task regions beyond existing normalization rules.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every top-level checkbox task item in a recognized task file MUST be extracted as an individual task, regardless of whether the file contains any other headings besides its leading title heading.
- **FR-002**: A leading title-only heading MUST NOT cause top-level checkbox tasks beneath it to be demoted below the default task-depth allowance; with out-of-the-box settings, every top-level checkbox task MUST surface in the plan as its own task.
- **FR-003**: Each task's description region MUST extend from its own task line to the next task line or heading (whichever comes first), and MUST include that task's own indented detail bullets and annotation lines (such as `_Requirements: …_`).
- **FR-004**: No issue created by the sync MAY contain text belonging to a different task; an issue's description MUST never span more than one task's region — and never the whole file when the file contains multiple tasks.
- **FR-005**: Each task's issue title MUST derive from that task's own line; the leading task number may be recognized as the task's local id, and the human-readable remainder of the line MUST be preserved as the title text.
- **FR-006**: Checked (`[x]`) and unchecked (`[ ]`) tasks MUST both surface; a task's checked state MUST continue to propagate to its issue's completion as it does today.
- **FR-007**: Each split task MUST carry the same durable identity rules as any other task, so re-runs match and update the existing issue rather than creating duplicates, and unchanged re-runs produce zero actions.
- **FR-008**: Extraction results for the same content MUST be identical whether the file is classified as Kiro or picked up by the generic fallback, consistent with today's shared-grammar behavior.
- **FR-009**: Existing behaviors for other file shapes MUST be unchanged: heading-driven files, heading-less flat checklists, nested checklists folding into a real id-bearing task heading under the flat-board default, and all outputs of the existing automated test corpus.
- **FR-010**: The corrected behavior MUST be proven by automated tests added with this fix: (a) the reported file's exact shape stored as a project test fixture, (b) parser-level tests asserting thirteen tasks with correct kind, id, title, checked state, parentage and description regions, and (c) a full sync-level test (against the standard test tracker, no real issue-tracker access) asserting one issue per task, per-issue descriptions, idempotent re-runs, and the no-whole-file-in-any-issue assertion. Every acceptance scenario above MUST be enforced by at least one automated test.

### Key Entities

- **Task file**: a `tasks.md` document; may have a leading title heading, any number of section/task headings, and top-level checkbox tasks with detail bullets. In the reported shape it has exactly one heading (the title) and thirteen top-level checkbox tasks.
- **Checkbox task**: a top-level `- [ ]`/`- [x]` item with an optional local number (`1.`, `4.1`), a title, a completion state, and an owned region of following detail/annotation lines.
- **Task description region**: the file lines belonging to a single task — its detail bullets and requirement notes — bounded by the next task or heading; this is what lands in the corresponding issue's description.
- **Title heading**: the document's opening heading (e.g., `# Implementation Plan`); names the document and must never own other tasks' content.
- **Sync plan unit**: the per-task record that becomes (or updates) exactly one issue in the team's board.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Syncing the reported file with out-of-the-box settings creates exactly thirteen task issues — one for each of its thirteen checkbox tasks — with 100% of titles taken from the tasks' own line text, replacing today's single catch-all issue.
- **SC-002**: 0 created issues contain a description spanning more than one task's region; 0 descriptions contain the full contents of the file; a task with no detail lines yields an empty description.
- **SC-003**: Re-running the sync on unchanged content creates 0 issues and updates 0 issues; toggling one task's checkbox updates exactly 1 issue.
- **SC-004**: The project's entire existing automated test suite passes with the change, and the new automated tests covering the reported file's shape pass — including in the project's continuous-integration pipeline, which is merge-blocking.
- **SC-005**: Across the project's existing framework-shape test corpus, extracted task counts and outputs are identical before and after the fix (0 changed outcomes), confirming no regression for other users.

## Assumptions

- "Every heading is a task" remains the product rule: after the fix the leading title heading may still surface as its own task (as the equivalent `# Tasks` heading already does in today's corpus), but only ever with its own bounded preamble as its description. Suppressing title-heading tasks entirely is out of scope.
- Items such as `4.1`, `4.2`, `4.3` written at the same indentation level as `4.` are sibling tasks — this matches how the authoring tool itself tracks their independent completion states.
- Italic `_Requirements: …_` lines and un-checkboxed detail bullets are description content, never tasks.
- The shipped flat-board depth default is NOT globally raised; the fix corrects how top-level checkbox tasks relate to a title-only heading, not the intentional folding of checklists nested under real task headings.
- The reported file sits under the Kiro feature-directory layout (`.kiro/specs/<feature>/tasks.md`) but the correction is a shared parsing-behavior matter, so the same content found anywhere a task file is recognized (generic pickup) behaves the same way.
- Proving tests live in this repository's own hermetic test suite (fake issue tracker, no real network/credentials), reproducing the scenario the reporter observed through their separate integration-test repo; no test needs to run against a real Linear organization.
- Security screening, routing, and all other existing sync governance behaviors apply unchanged to the newly split tasks.
