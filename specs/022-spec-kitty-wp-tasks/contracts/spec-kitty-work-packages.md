# Contract: `spec-kitty` Work-Package Task Source (amendment to the 017 adapter contract)

**Feature**: `022-spec-kitty-wp-tasks` | **Status**: Draft (normative for implementation)
**Consumes**: 003 adapter contract, 004 parsing contracts, 006 matching contract, 002 task
model — amended per `docs/contract-amendments.md` entries A-022-0…A-022-4 of this feature.
**Supersedes** for the `spec-kitty` identity: 017 C2.4, C2.5, C3.1–C3.8, and the C4 seed
*inputs* (roll-up-line/ordinal derivation). **Retains**: 017 C1 (identity/surface parity),
C2.1/C2.2/C2.3/C2.6 (detection, disjointness, mission naming, disable parity), C4.2 stance
(identity invariance), C5 (layering posture), C6 (documentation duties, re-pinned here).

## C0. Unit of work

- **C0.1** One recognized work-package document = exactly one task (kind `document`),
  regardless of headings, `Tnnn` subtasks, or checklist items inside it (FR-002).
- **C0.2** The task source is the mission's `tasks` collection:
  `kitty-specs/<mission>/tasks/**/*.md` by default (flat layout and legacy lane
  sub-folders), claimed by `spec-kitty` and never left to fall through to another
  identity (FR-001).

## C1. Candidate discovery (amends 017 C2.4/C2.5; amendment A-022-1)

- **C1.1** Adapter member `taskPathPatterns` (segment globs: `*` exactly one path segment,
  `**` zero or more) joins the traversal candidate union alongside basename patterns;
  matching is against the full root-relative POSIX path. Basename-only matchers, including
  every other identity's, behave byte-identically (FR-013).
- **C1.2** The 017 exclusion entry `kitty-specs/*/tasks/` is absent from the row: traversal
  descends the collection. Non-`.md` entries are not candidates.
- **C1.3** Match sets stay disjoint from `spec-kit` and every other identity (017 C2.2
  preserved): the default patterns are rooted at the configured specs base.
- **C1.4** Disabling `spec-kitty` removes the path patterns and claims as a unit;
  `kitty-specs/` files behave exactly as pre-017, byte-identical fall-through to `generic`
  (FR-013).

## C2. Recognition and collisions (FR-001/FR-005/FR-008/FR-009)

- **C2.1** A collection file yields one task iff it identifies itself: non-empty
  front-matter `work_package_id` scalar, **or** a basename matching the `WPnn` file-name
  identifier pattern; otherwise it yields zero tasks and remains claimed documentation
  (notes, review-feedback artifacts).
- **C2.2** The roll-up (`tasks.md`/`TASKS.md`) yields **zero** tasks in all cases,
  including missions with no collection, with no diagnostics beyond claimed-file normality
  (FR-005, US2-AC3).
- **C2.3** Count parity: per mission, plan tasks = recognized documents; zero plan tasks
  may originate from roll-up checkbox lines (FR-009, SC-001).
- **C2.4** Two documents in one mission resolving to the same normalized WP id are a hard
  integrity finding: plan build refuses with a deterministic report (framework, mission,
  id, sorted colliding paths); no plan is produced and no winner is guessed (FR-008, R8).

## C3. Title and content (FR-003/FR-004)

- **C3.1** Title = front-matter `title` scalar → body's leading ATX heading text →
  readable file-name slug (`WP01-release-validation-tooling` → `Release Validation
  Tooling`). Raw front matter never appears in any title; no title is ever empty for a
  recognized document.
- **C3.2** Content = the document verbatim minus front matter — Objectives, Context &
  Constraints, `Tnnn` step guidance, Test Strategy, Definition-of-Done, Activity Log,
  Review Report — no truncation for size. `Tnnn` ids and DoD checkboxes are never extracted
  as tasks (SC-002).
- **C3.3** A front-matter-only document still yields exactly one task whose mirrored
  content is empty and whose report entry carries the visible `no-content` label (not
  silently dropped).

## C4. Identity (amends 017 C4 seed inputs; FR-007/FR-008)

- **C4.1** Seed = frozen layout with `Framework_Id = "spec-kitty"`, `Feature_Name =
  <mission>` (rule `segment-under-base`), `Local_Task_ID = <normalized WP id>`
  (`WP` + digits). Front-matter id beats file-name token.
- **C4.2** Identity is unchanged by: lane front-matter edits, Activity Log / Review Report
  appends, any body edit, file renames within the mission's collection, and moves between
  the collection and its lane sub-folders (FR-007/FR-010, SC-003).
- **C4.3** The same WP id in different missions yields distinct tasks (mission in the
  seed). Work-package ids never adopt, match, or inherit roll-up-line (`Tnnn`) or ordinal
  identities (different id spaces, disjoint by pattern and seed).

## C5. Matching posture (amendment A-022-3; FR-011/SC-004)

- **C5.1** Document-kind tasks pair with tracker issues **only** via the durable identity
  signal; weighted signal scoring never applies to them. With no durable hit the task is
  unmatched (create path).
- **C5.2** Issues whose recorded identity derives from the superseded roll-up-line model
  are never matched to work-package tasks and surface through the run's normal
  stale/unmatched reporting; nothing here deletes them (FR-011).

## C6. Rendering and write-back (amendment A-022-4; Principle II)

- **C6.1** Document-kind tasks receive **zero** line rendering: apply issues no
  `renderTaskLines` assignment for them, plan entries carry empty
  `expectedMarkdownChanges`, and `renderTaskLines` rejects document-kind assignments with
  `structure-mismatch`. Repository collection files are never modified.
- **C6.2** The mirrored-description slice for document kind runs `startLine..endLine`
  **inclusive** (the body is the content); heading/checklist slices and rendering remain
  byte-identical for every other identity (SC-005).
- **C6.3** The durable anchor remains the `Attachment_Metadata`-addressed UUID; no
  in-file marker or title token is required for reconciliation of document tasks.

## C7. Configuration and layering (FR-012; 017 C5 posture retained)

- **C7.1** Every default in C0–C6 (collection location, document recognition, roll-up
  treatment, title order, identity anchor) resolves through the existing three-layer merge
  (built-in row → frozen config keys → `DiscoveryOverrides.adapters["spec-kitty"]`); **no
  new `ResolvedConfig` key** is introduced; zero new required configuration; out-of-the-box
  on the standard Spec Kitty layout.
- **C7.2** Defaults contain zero organization-specific literals (release scan).

## C8. Documentation and consistency gates (test-pinned; FR-014)

- **C8.1** README adapter table + `### Spec Kitty` subsection, `docs/framework-adapters.md`,
  `docs/discovery.md` (path-scoped candidate grammar), `specs/requirements.md` Requirement 7
  and glossary, and `CHANGELOG.md` describe the work-package-document task source and the
  zero-task roll-up, replacing the roll-up-as-source text in the same change.
- **C8.2** The 016 consistency suite and 019 doc-truthfulness pins MUST pass against the
  corrected text — pins are updated to the new truth, never relaxed.
- **C8.3** `docs/contract-amendments.md` carries entries A-022-0…A-022-4 and the 017
  supersession note; A-022-0 regenerates `tests/contract/snapshots/frozen-surface.json`
  alongside the contract doc and module (three-artifact rule).
