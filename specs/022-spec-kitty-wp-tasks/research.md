# Phase 0 Research: Spec Kitty Work-Package Task Source

**Feature**: `022-spec-kitty-wp-tasks` | **Date**: 2026-11-21
**Inputs**: [spec.md](./spec.md), `.specify/memory/constitution.md` v1.0.0, as-built code at HEAD, 017 artifacts (`specs/017-spec-kitty-adapter/`), upstream Spec Kitty docs (mission-system + kanban-workflow, researched and cited in the spec).

All Technical Context questions are answered from the as-built repository; **no NEEDS
CLARIFICATION remains**. Each decision below follows Decision / Rationale / Alternatives.

---

## R1 — Task source: the `tasks/` collection; the roll-up yields zero tasks

**Decision**: A mission's work-package collection is the only task source for
`spec-kitty`; a recognized work-package document yields exactly one task; the roll-up
(`tasks.md`/`TASKS.md`) yields zero tasks in all cases. 017 contract rules C2.4/C2.5/C3.x
and the C4 seed *inputs* are superseded for this identity (ledger entry A-022-4); 017 C1
(identity/surface), C2.1–C2.3/C2.6 (detection, feature naming, disable parity), and the C5
layering posture are retained.

**Rationale**: upstream Spec Kitty documents the work-package prompt file as the unit of
work ("Each WP has its own markdown prompt file… its own status on the kanban board") and
the roll-up as an index; the integration-test symptom (thousands of one-line, empty-
description tasks) is exactly the index being synced as tasks. FR-009 count parity (one
plan task per collection document) is only achievable when the roll-up contributes nothing.

**Alternatives considered**:
- *Parse both and deduplicate* — rejected: re-creates the defect at lower volume; the
  spec's US2 requires the roll-up's contribution to be zero, not merely smaller.
- *Fall back to roll-up parsing when a mission has no `tasks/` folder* — explicitly rejected
  by the spec (edge case + Assumption): roll-up-line tasks are the behavior being removed;
  such a mission contributes zero tasks without error (US2-AC3).

## R2 — Discovery: per-adapter path-scoped candidate patterns (amendment A-022-1)

**Decision**: New optional adapter member `taskPathPatterns` — root-relative POSIX globs
matched against the candidate's full repository-relative path, with `*` occupying exactly
one path segment and `**` zero or more segments (segment semantics consistent with the 017
A-3 exclusion grammar). `spec-kitty`'s default: `["kitty-specs/*/tasks/**/*.md"]`. The
traversal candidate predicate widens from `(name)` to `(name, relPath)`; basename-only
matchers ignore the second argument. The 017 exclusion entry `kitty-specs/*/tasks/` is
**removed** from the row so traversal descends the collection. Claiming is unchanged
detection (`pathPrefixes: ["kitty-specs/"]`), so every claimed collection file — recognized
or not — attributes to `spec-kitty` (FR-001: never falls through).

**Rationale**: candidates are gated by the **union** of enabled adapters' basename
patterns; any basename widening (`*.md`, or even `WP*.md`) silently enlarges *other*
identities' candidate sets — under a Spec Kit layout `specs/001-x/spec.md` would newly be a
candidate and spec-kit's path+siblings rule would claim it, breaking FR-013/SC-005 byte-
identity. Path scoping confines the widening to `kitty-specs/` missions; markdown-only
scoping keeps attachments (PNGs etc. inside `tasks/`) out of the parse pipeline while
`*.md` notes/review artifacts become claimed-but-skipped content. `**` covers both the
current flat layout and legacy `tasks/planned/`-style lane sub-folders (spec Assumption).

**Alternatives considered**:
- *Broaden `taskFilePatterns` with `*.md` (basename)* — rejected: claims `docs/*.md`,
  `specs/*.md`, README files for whichever adapter's detection matches; SC-005 violation by
  construction.
- *Narrow basename pattern `WP*.md`* — rejected: misses front-matter-recognized documents
  named otherwise (spec recognition rule #1) and would claim `WP*` files inside other
  adapters' roots (e.g. `.kiro/specs/*/WP01.md`) — again SC-005 drift.
- *Keep the traversal exclusion and pre-seed candidates from mission directories* —
  rejected: breaks the single-walk traversal design (003 R3/R4) and re-implements
  traversal outside the escape-guarded walk.

## R3 — Feature attribution: `segment-under-base` (amendment A-022-1)

**Decision**: The row's `featureNameRule` changes from `parent-dir` to a new declarative
kind `segment-under-base`: for a claimed path beneath an effective base directory, the
feature name is the **first path segment after the base** (`kitty-specs/002-x/tasks/WP01.md`
→ `002-x`; lane sub-folders and the roll-up alike). Derived from the row's *effective*
`baseDirectories`, so config/programmatic roots keep working.

**Rationale**: FR-006 — the mission, not the folder, is the feature. The existing
`parent-dir` rule returns `tasks` for collection files (immediate parent); the mission must
feed the `Feature_Name` seed element so same-numbered work packages in different missions
stay distinct (US3-AC3) and attribution survives renames/moves inside the mission.

**Alternatives considered**:
- *`segment-after` with marker `kitty-specs`* — rejected: markers are static and would not
  follow a consumer-overridden `baseDirectories` (Principle III); its index arithmetic is
  also tuned to two-level paths.
- *Programmatic `featureNameOverride` on the row* — rejected: a function on the built-in
  row is invisible to docs/config layering and the 016/019 doc-truthfulness suites;
  declarative kinds are the established pattern.

## R4 — Document-unit parsing mode (amendment A-022-2)

**Decision**: New optional whitelisted parse-adapter member
`documentTaskRule: { collectionPattern, idKey, titleKey, fileNameIdPattern }` (regex
source strings, consumed as `adapter.<member>`). When present, `parseTaskFile` runs a
document pipeline instead of heading/checklist extraction: split front matter → test
`collectionPattern` against `filePath` → recognize (non-empty front-matter scalar `idKey`
value, else `fileNameIdPattern` on the basename) → emit **0 or 1** draft of kind
`document` with `taskBody = { startLine: first body line, endLine: last line }`. Conflict
scan, screening inputs, and warnings machinery stay upstream/unchanged; conflict markers
inside a document still set `unresolvedConflict` (taskBody intersects the block). Depth
folding (020) is vacuous: a single parentless depth-1 draft folds only if a cap below 1
existed, which `validateTaskDepthCap` refuses — the unit is fold-inert by construction.

**Rationale**: FR-002/FR-004 demand the whole document as one task with internal `Tnnn`
steps and DoD checkboxes as content — that is a different *unit of extraction*, not another
grammar on the checklist unit. A declarative rule object keeps the parser framework-blind
(004 boundary rule) and overridable per 017 C5.1 precedent with zero new `ResolvedConfig`
keys. Files the identity claims but that fail recognition (the roll-up, notes, review
feedback artifacts) yield zero drafts and zero line-scanning — claimed documentation.

**Alternatives considered**:
- *`headingGrammar` matching the document's leading `#` heading* — rejected: cannot express
  front-matter-title recognition, breaks the no-heading document (front-matter-only edge
  case), and makes identity depend on editable prose.
- *Pre-processor rendering a synthetic one-checkbox "view" of each document* — rejected:
  couples parsing to the render lane and would write synthetic lines into upstream-managed
  documents.
- *One task per `## Work Package` heading (017 C3.6 extended)* — rejected: contradicts the
  spec's Key Entities (the document IS the unit; 017 phase grouping is superseded).

## R5 — Front matter without a YAML dependency (constraint-driven)

**Decision**: `src/parsing/document.ts` implements a minimal, pure leading-front-matter
scan: an optional leading `---` fence (first non-blank line) terminated by a following
`---`/`…` fence line; only **top-level scalar keys** are read; the rule consumes exactly
two keys — `idKey` (default `work_package_id`) for identity and `titleKey` (default
`title`) for the title cascade. Every other key (lane, dependencies, subtasks, phase,
history) is ignored by the parser but stays **out of the mirrored content** (front matter
is excluded wholesale per FR-004). A document with no well-formed leading fence (including
an unterminated fence) has no front matter: the whole file is body, title falls to the
cascade.

**Rationale**: the constitution limits runtime dependencies to Node built-ins plus one
transport — adding a YAML library is out. Only two flat scalar values are needed; nested
or aliased YAML structures are irrelevant to the unit-of-work correction. Conservative
malformed handling never drops content (the spec's "verbatim" posture).

**Alternatives considered**:
- *Add `yaml`/`js-yaml`* — rejected: dependency-budget violation, release-scan surface.
- *Treat front matter as content and parse nothing* — rejected: FR-003 forbids front-matter
  text in titles; FR-004 defines content as the document minus front matter.

## R6 — Title and content derivation

**Decision**: Title cascade (FR-003): front-matter `titleKey` scalar → the body's leading
ATX heading (first heading of any level, `#` text stripped; when the document has no
front matter this is also the first line) → readable file-name slug (strip the `WPnn`
identifier token and separators, `-`/`_` → spaces, collapse whitespace:
`WP01-release-validation-tooling` → `Release Validation Tooling`). Content (FR-004): the
body verbatim — objectives, constraints, subtask guidance, test strategy, DoD, and later
Activity Log / Review Report sections included; internal `Tnnn` ids and checkboxes are
never extracted; no size-based truncation (spec edge case). Empty-but-present bodies
(front-matter-only documents) produce empty mirrored content with a visible `no-content`
report label (R11).

**Rationale**: matches the spec's acceptance examples exactly ("Release Validation
Tooling" from front matter; slug fallback readable, never a raw front-matter dump). The
cascade is a pure function of (front matter, body lines, basename) — deterministic
(Principle IV) and identical across repeated parses.

**Alternatives considered**:
- *Heading → front matter → slug* order — rejected: FR-003 fixes the order (front matter
  first; the example document's heading carries a decorative `WP01 — …` span while its
  front-matter `title` is the canonical human title).
- *Deriving the slug without stripping the `WPnn` token* — rejected: "WP01 release
  validation tooling" duplicates the id already carried by `localTaskId`; spec's example
  shows the stripped form.

## R7 — Work-package identity (seed, normalization, stability)

**Decision**: `Task.kind = "document"`; `Task.localTaskId` = the **normalized WP id**:
front-matter `idKey` scalar or the file-name token matched by `fileNameIdPattern`
(default `(?i)^WP(\d+)…`), normalized to upper-case `WP` + digits (e.g. `wp01-foo.md` →
`WP01`). `Stable_UUID = deriveStableUuid(taskStableSeed({ frameworkId: "spec-kitty",
featureName: <mission>, localTaskId: <WP id> }))` — the frozen seed layout, untouched.
No `identityFileScope`, no ordinal fallback (a recognized document always has an id; the
ordinal path would mean recognition failed and no task exists). The `WPnn` id space is
disjoint from roll-up `Tnnn` ids and `004` ordinals by pattern and by seed composition.

**Rationale**: FR-007 stability classes map exactly onto the seed: lane front-matter
flips, Activity Log appends, Review Reports, body edits, and renames/lane-style moves
inside the mission change **no** seed element — same UUID, content re-mirrored. Different
missions → different `Feature_Name` → distinct UUIDs (US3-AC3). The spec's "roll-up ids
must never be adopted" edge case holds because `T001`-style ids never match
`fileNameIdPattern`/`idKey` and roll-up files yield no drafts at all.

**Alternatives considered**:
- *Path-derived identity* — rejected: renames are first-class upstream behavior ("Not
  Directories, Just a Field" plus slug tidy-ups); path anchors would churn duplicates.
- *Basename-derived (`identityFileScope`) ids* — rejected: same rename churn; the WP id
  exists precisely to be rename-stable.
- *Keeping `kind: "heading"` on document tasks* — rejected: the renderer/depth/extent
  lanes key behavior on `kind`; a distinct kind makes the durable-only pairing (R9),
  no-write-back rule (R10), and mirror slice (R11) explicit instead of inferred.

## R8 — Duplicate work-package identifiers: hard plan-build refusal

**Decision**: After parse, before matching, plan build scans the parsed task set for two
or more tasks sharing one `Stable_UUID`; for `spec-kitty` document tasks this is precisely
a duplicate WP id inside one mission. The run is **refused at plan build** with a
deterministic finding (framework, mission, WP id, sorted colliding file paths); no plan
exists, so no apply is reachable. Precedent: Constitution II treats duplicate durable
identities on the tracker side as a hard abort (`DurableIdentityCollisionError` →
`IntegrityError` in `build.ts`); the repository side gets the same posture.

**Rationale**: FR-008 "reported as a collision without guessing". Any plan that *contained*
the colliding pair would force the engine to route two tasks to one UUID — either guessing
a winner (forbidden) or carrying an unapplicable entry inside the frozen `SyncPlan` shape
(which has no findings channel). Refusal is the strongest "does not guess": every other
mission in the repository can be re-planned as soon as the collision is fixed upstream.

**Alternatives considered**:
- *Plan-level `integrityFindings` field, colliding tasks unrouted* — rejected: amends the
  frozen `SyncPlan` + plan-report schema for a state nothing may act on; a non-blocking
  finding invites accidental applies of the surrounding plan.
- *004 `ParseWarning` channel* — rejected: warnings are per-file; the collision is
  cross-file (mission-scoped), and "warning" understates a hard finding.

## R9 — Matching: durable-identity-only pairing for document tasks (amendment A-022-3)

**Decision**: Tasks of kind `document` participate in matching **only** through the
durable-identity signal (their `Stable_UUID` found among candidate issues' recorded
anchors). All weighted signal scoring — title exact/contained/token-overlap, local-id,
issue-ref, container alignment — is vetoed for them; with no durable hit the task is
simply unmatched (create path). Consequence: issues whose recorded identity comes from the
superseded roll-up-line model can **never** pair onto work-package tasks (FR-011/SC-004) —
they land in the existing unmatched/stale reporting unchanged and are operator-cleanup
material.

**Rationale**: roll-up-era issue titles ("Implement the release validation tooling
script") title-contain work-package titles ("Release Validation Tooling"), so default
scoring could pair them at medium/low confidence — a MUST-violation. Document tasks have
an authoritative deterministic anchor; fuzzy pairing can only produce false positives for
them. Renamed/moved documents keep their durable anchor (R7), so the veto loses nothing
across the lifecycle (SC-003).

**Alternatives considered**:
- *Global guard: veto signal pairing whenever both sides carry differing `localTaskId`s* —
  rejected: changes 006 behavior for all seven identities (SC-005 risk, broader amendment).
- *Leave scoring untouched; rely on low-confidence bands* — rejected: FR-011 is absolute
  ("MUST never be matched"); bands plus `--accept-low-confidence` make it violatable.
- *Delete-and-recreate cleanup for leftovers* — rejected: out of scope (the spec assigns
  leftovers to existing stale reporting; mutations of historical issues are not this
  feature's call).

## R10 — Write-back: zero line rendering for document tasks (amendment A-022-4)

**Decision**: Apply excludes kind-`document` tasks from `renderTaskLines` assignments;
their plan entries carry empty `expectedMarkdownChanges`; the repository files under
`tasks/` are **never modified** by this product. `renderTaskLines` defensively rejects any
document-kind assignment with `LineRenderError: structure-mismatch`. The durable anchor
lives in `Attachment_Metadata` (Principle II), so the in-file `[KEY-N]` title prefix —
designed for line-anchored checklist/heading identities — is unnecessary here.

**Rationale**: the upstream work-package document is managed by Spec Kitty's own tooling
(front-matter lane flips, activity appends); writing `[KEY-N]` into its leading heading
would mutate curated prose (dropping the decorative `WP01 — …` span under the 004 render
rule), needs a special case for documents with no heading, and buys no identity or
reconciliation capability (matching reads attachment metadata, not file tokens).
Round-trip fidelity (Principle IV) becomes trivial: the file never changes.

**Alternatives considered**:
- *Render `[KEY-N]` into the leading heading when present* — rejected: invasive to
  upstream-managed text, unsound for heading-less documents, no benefit (see above).
- *Append an HTML-comment marker line* — rejected: content pollution of the mirrored body
  (the marker would mirror back into Linear as description text) with zero capability gain.

## R11 — Engine mirror and the "no content" state (amendment A-022-4)

**Decision**: The mirrored description for a document task is its `taskBody` slice
**inclusive of `startLine`** (the body begins at the first line after front matter) through
`endLine` — versus the existing `startLine + 1` own-line skip for heading/checklist kinds;
the branch keys on `TaskKind`, leaving every existing identity's slice byte-identical
(SC-005). A front-matter-only document yields empty content: the plan entry still exists
(create/update like any task) and the report surfaces a deterministic `no-content` label
through the existing entry-label channel — no `SyncPlan` or report-schema shape change
(the schema forbids raw body fields by design; the label is metadata, not content).

**Rationale**: FR-004 ("reproduces the document minus its front matter" — including the
leading heading line itself, unlike a checklist task whose own line is the title) and the
"empty-but-reported, not silently dropped" edge case. Description normalization,
three-way conflict classification, and checkpoint hashing operate on the mirrored text
unchanged; a formatting-only drift still never triggers a write (conflict-free sync rule).

**Alternatives considered**:
- *Set `taskBody.startLine` one line early so the generic `+1` slice lands on the body* —
  rejected: corrupts the extent's documented semantics ("the task's own line") that
  render/conflict/reconcile lanes consume.
- *Skip front-matter-only documents entirely* — rejected: violates the spec's visible
  "no content" requirement.

## R12 — Layout variants and disable parity

**Decision**: Recognition accepts (a) the current flat layout (`tasks/WPnn-<slug>.md`) and
(b) legacy lane sub-folders (`tasks/<lane>/WPnn-…md`) via the `**` pattern depth; a file
counts as a source only under R4's recognition rules. Non-`.md` attachments are outside the
candidate pattern entirely; `.md` artifacts that fail recognition are claimed-but-skipped
(zero tasks, no diagnostics beyond normal claimed-file status). A mission without a `tasks/`
folder yields zero tasks and no error (US2-AC3). Disabling `spec-kitty` removes the row's
patterns/claims as a unit: `kitty-specs/` files fall through to `generic` byte-identically
to pre-017 behavior (FR-013), including the now-removed exclusion (nothing to restore —
disabling already dropped it in 017's model).

**Rationale**: keeps the corrected collection handling "part of the identity" (spec edge
case) and hermetic: all variants are fixture-reproducible; no upstream clone or network in
tests (Principle VI). A pathological artifact named like a work package (`WP01-review.md`)
is recognized and lands in R8's collision finding rather than being silently special-cased —
the spec makes name-based self-identification authoritative.

**Alternatives considered**:
- *Depth-limit the collection to one lane level* — rejected: upstream's own example file
  references deeper legacy paths; a depth cap would silently drop work (worse than the
  claimed-but-skipped noise it avoids).
- *Content-sniffing for lane folders (front matter `lane:` as recognition)* — rejected as
  a *requirement*: lane is lifecycle state, not identity (upstream: "Not Directories, Just
  a Field"); it remains front-matter content excluded from the mirror.

## R13 — Test and documentation surface

**Decision**: Superseded 017 pins flip test-first in the same change: parsing corpus
(roll-up now yields 0 tasks; collection documents yield the task set), discovery exclusion
pins (path patterns + descent), `sync-spec-kitty-drift` replaced by a lifecycle suite
(lane/activity/review/rename → zero creates, content updates), and the doc/consistency
suits (016 consistency, 019 doc-truthfulness) re-**pinned** to the corrected README
subsection, table row, `docs/framework-adapters.md` section, `specs/requirements.md`
Requirement 7, and CHANGELOG — never relaxed (FR-014). SC-005 is gated by the untouched
fixture/plan snapshots of the other six identities plus `frozen-surface` after the A-022-0
regeneration.

**Rationale**: Principle VI requires every acceptance criterion enforced; the 017 suites
pin the *defect* (exclusion + roll-up tasks), so they are the first thing to update. The
upstream reproduction fixture (`002-lightweight-pypi-release` shape with the
`WP01-release-validation-tooling.md` document content modeled on upstream) gives SC-001/
SC-002 a hermetic, deterministic home.

**Alternatives considered**:
- *Keep 017 roll-up tests behind a "legacy mode" flag* — rejected: no legacy parse mode
  exists (R1); kept tests would pin behavior the spec removes.

