# Contract: `spec-kitty` Sub-Task Depth & Status Authority (amends 022 C1.1/C2; supersedes the 022 "subtasks are always content" assumption)

**Feature**: `specs/023-spec-kitty-subtask-depth` | **Status**: Approved design (amendments
A-023-0…A-023-4 to be executed in `docs/contract-amendments.md` test-first)

Scope: the `spec-kitty` identity ONLY. Other identities are untouched (C9). Notation follows
the 022 contract (`specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md`),
which remains authoritative for everything not amended here.

## C0. Two-level unit of work

- **C0.1**: A canonical work-package document is exactly one task at depth level 1, never
  parented (022 C0 retained). Subtasks (`Tnnn`) are depth level 2: at `maxTaskIssueDepth = 1`
  (the built-in default) they fold verbatim into the owning WP task; at depth > 1 each
  promotable subtask is exactly one sub-task parented to that WP task (FR-001/FR-002).
- **C0.2**: Granularity contract: per mission, level-1 task count = canonical WP-document count
  at EVERY depth; sub-task count per WP = promotable anchors at depth > 1, zero at depth 1.
  The depth cap folds nesting and NEVER merges or splits level-1 tasks (FR-011/FR-016).

## C1. Canonicality gate (AMENDS 022 C1.1; amendment A-022-1 member semantics unchanged)

- **C1.1'**: `taskPathPatterns` stays `kitty-specs/*/tasks/**/*.md` (broad claim; no
  fall-through to `generic` for ANY file under a mission `tasks/` folder, FR-009/FR-015).
- **C1.2'**: `documentTaskRule.collectionPattern` recognizes a canonical document only as a
  DIRECT child of `kitty-specs/<mission>/tasks/` or one level beneath a recognized lane folder
  (`planned|claimed|in_progress|for_review|in_review|approved|done|blocked|canceled`, 022
  legacy variant retained). Any deeper nesting — per-WP artifact sub-folders (`review-cycle-*.md`,
  `reviewer-feedback-cycle-*.md`, attachments) — derives ZERO drafts regardless of front
  matter, including a duplicated `work_package_id` (FR-015). Consequence: canonical document +
  its own artifacts can never trip the duplicate-identifier refusal.

## C2. Subtask derivation (NEW; amendment A-023-2)

- **C2.1 Roster**: front-matter `subtasks` list (single-level block or flow form) ∪ body
  anchors within the anchor region. `scanFrontMatter` widens additively: top-level keys with a
  single-level list capture `string[]` values (scalars unchanged; everything else still ignored).
- **C2.2 Anchor**: an ATX heading or checklist line matching `anchorPattern` — optional
  `Subtask` word, token `T\d+` (overridable), separator (`:`/`–`/`—`/`-`), optional title text.
  Anchor section extent: anchor line through the line before the next anchor at the same-or-
  shallower heading level, or the anchor-region end.
- **C2.3 Anchor region**: body up to (exclusive) the first heading matching
  `anchorRegionStopPattern` (`Activity Log` / `Review Report`, case-insensitive). Restatements
  beyond the stop line are mirrored content only — never anchors, never collisions.
- **C2.4 Titles/extent**: child title = anchor text after the token, else readable form of the
  token; front matter never appears in a child title. Child content = section extent. Parent
  document task gains `taskBody.promotedRanges` = promoted child spans (inclusive); the
  document-kind mirror slice excludes them (A-023-3/A-023-0); no kind other than
  `kind === "document"` with non-empty `promotedRanges` changes rendering.
- **C2.5 Exclusions**: roster entries with no anchor → recognized-but-excluded, reason
  `subtask-no-anchor`, remain folded at every depth — no empty issue ever. At depth 1 all
  subtasks → exclusion records reason `depth-folded` (kind `subtask`).
- **C2.6 Collisions**: duplicate anchors of one id inside the anchor region produce drafts with
  identical seeds; the EXISTING document-kind collision guard refuses the plan with
  deterministic path ordering (no new error class). C2.5 of the 022 contract (no guessing)
  retained.

## C3. Identity (AMENDS 022 C4 seed inputs for sub-tasks)

- **C3.1**: Child seed = frozen `taskStableSeed` layout with third slot
  `<WP id>\0<subtask id>` (compose-slot precedent; `identity.ts` join never re-implemented).
  `Task.kind = "document"`; `Task.localTaskId` = normalized subtask token.
- **C3.2**: Stability: child identity is unchanged across lane front-matter flips, Activity
  Log / Review Report appends, other body edits, and renames or lane-style moves of the owning
  document (022 C2.3 lineage extended one level down). WP id space and T-id space remain
  disjoint from each other and from roll-up-line ids (022 C2 retained).

## C4. Matching (INHERITS 022 C5; no amendment)

Sub-tasks, as `kind === "document"`, pair through the durable anchor ONLY; title/local-id/
container heuristics never apply; unmatched ⇒ create; folded-back (depth lowered) children are
surfaced through `unmappedIssues` (stale/leftover) with zero auto-deletion (FR-010).

## C5. Rendering and write-back (EXTENDS 022 C6)

Neither level receives rendered lines or landed markers; documents are excluded from
`expectedMarkdownChanges` (022 C6 retained). Status is NEVER written into mirrored content —
no status text, no raw front-matter block, at any depth (FR-007).

## C6. Status authority (NEW; supersedes 022's "lane is mirrored content only" stance for STATE)

- **C6.1 Authority**: `status.events.jsonl` beneath the mission directory (adapter member
  `statusEventFileName`, built-in `"status.events.jsonl"`) is the SOLE source of a work
  package's current status. Qualifying line = valid JSON with string `wp_id` + string
  `to_lane`; the LAST qualifying line in FILE ORDER wins (append-only canonical order);
  malformed and non-qualifying lines (envelope events, annotations) are skipped without
  poisoning order; unknown `wp_id` ignored with a reported finding.
- **C6.2 Mapping**: lane → workflow-state NAME via the routed team's
  `workflowStates.lanes` (optional, keys ⊆ nine-lane vocabulary; NO built-in default);
  name → id via the existing snapshot resolution path (`resolveWorkflowStateId`). No events /
  no map entry ⇒ state untouched; unmapped lane or unresolvable name ⇒ state untouched +
  reported finding (never a silent guess, conflict posture of the completion path).
  `status.json` and the front-matter `lane` field are NEVER state sources (FR-007; clarification
  Q4).
- **C6.3 Mechanics**: drift evaluation at plan build beside the completion-state path
  (`changedFields += "state"`, label `lane:<lane>`); apply patches `IssueUpdatePatch.stateTypeId`
  through unchanged gates; creates carry the mapped state; history records append-only
  `"lane-changed"` events. Spec→tracker only — no reverse mapping (completion contract rule).
  Status files are read ONLY during plan build (read-only lanes never touch them).

## C7. Configuration and layering (FR-012)

All new members (`subtaskRule`, amended `collectionPattern`, `statusEventFileName`) ship on the
built-in row and are overridable through the existing merge (022 C7 posture; engine reads
built-in-row values per the 022 engine-registry precedent). `lanes` is optional per-team routing
config validated at load. Zero new REQUIRED configuration; out of the box on the standard
layout, the default board is flat and no issue state is ever moved (no `lanes` configured).

## C8. Inert artifacts (EXTENDS 022 C2 roll-up rule)

`meta.json`, `spec.md`, `plan.md`, roll-ups, `wps.yaml`, `status.events.jsonl`, `status.json`
yield zero tasks at every depth and never pair as issues; `status.events.jsonl` is consumed
exclusively through C6; `wps.yaml`, `status.json`, and `meta.json` are never consumed as sync
inputs in this release; dependency front matter stays mirrored content (no tracker relations).

## C9. Consistency and drift gates (test-pinned; FR-013/FR-014/FR-016)

- Other six identities byte-identical (discovery/parse/plan fixtures re-pinned; SC-006).
- Disabling `spec-kitty` restores pre-017 fall-through exactly (022 C9 retained).
- README adapter row/section, `docs/framework-adapters.md`, configuration reference (depth
  interplay + lane→state), `specs/requirements.md` Requirement 7, and CHANGELOG describe the
  two-level model and event-log status; the documentation-consistency suite passes against the
  corrected text, and `docs/contract-amendments.md` records A-023-0…4 + the supersession
  ledger (022 C1.1 pattern clause, the 022 subtasks-are-never-tasks assumption).
