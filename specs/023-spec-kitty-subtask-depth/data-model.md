# Phase 1 Data Model: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Feature**: `specs/023-spec-kitty-subtask-depth/spec.md` | **Date**: 2026-11-24

Builds on `specs/022-spec-kitty-wp-tasks/data-model.md` (unchanged: mission attribution,
front-matter region exclusion, title cascade, durable pairing). Only deltas are stated here;
everything not restated keeps its 022 shape and semantics.

## 1. Concept → shape mapping

### Work-package document (depth level 1 — 022 shape, two amendments)

Unchanged: one canonical document = one `Task` of kind `document`; seed
`spec-kitty | <mission> | <WP id>`; title cascade front-matter → leading heading → readable
slug; extent = body minus front matter.

Amendments (both additive, amendment A-023-0/A-023-2):

| Field | Type | Rule |
|---|---|---|
| `taskBody.promotedRanges` | `ReadonlyArray<[number, number]>` (optional; inclusive line spans) | Present only on document tasks with promoted children (depth ≥ 2); the document-kind mirror slice excludes these spans so promoted subtask sections appear ONLY on the child issues. Absent ⇒ contiguous slice exactly as 0.6.0 (byte-identical flat default). |
| canonicality | derived from path | Canonical iff the file is a DIRECT child of `kitty-specs/<mission>/tasks/` or sits one level under a recognized lane folder (`planned, claimed, in_progress, for_review, in_review, approved, done, blocked, canceled`). Everything deeper inside `tasks/` (per-WP artifact sub-folders: review cycles, reviewer feedback) derives ZERO drafts whatever its front matter (FR-015) while remaining claimed. |

### Subtask (depth level 2 → `Task` of kind `document`)

| Attribute | Rule |
|---|---|
| Identity seed | `spec-kitty \| <mission> \| <WP id>\0<subtask id>` (frozen `taskStableSeed`; compose-slot join per `composeSeedLocalTaskId` precedent) |
| `localTaskId` | normalized `T<digits>` token (upper-cased letters+digits, same normalizer as WP ids) |
| `kind` | `"document"` — inherits durable-only pairing, no-landed-line, and no-render posture with zero matching code |
| Title | anchor text after the identifier (`### Subtask T001 – Implement validator CLI` → "Implement validator CLI"); anchor without title text → readable form of `T001`; front matter never in title |
| Content (extent) | anchor line..end of its section (next same-or-shallower heading or anchor-region end), rendered as the child's mirrored body |
| Parent link | `Task.parentUuid` → owning WP task's `stableUuid`; parent's `childUuids` lists children in source order |
| Roster | front-matter `subtasks` list (block `- T001` or flow `[T001, T002]`) ∪ body anchors in the anchor region |
| Fold (depth = 1) | no child draft survives; the section rides verbatim in the parent extent (020 semantics); exclusion record kind `"subtask"`, reason `"depth-folded"` |
| No-anchor roster entry (depth ≥ 2) | excluded with reason `"subtask-no-anchor"`; remains folded in the parent — no empty issue is ever created |
| Duplicate anchor inside the anchor region | two drafts, identical seed → refused by the EXISTING `DocumentIdentityCollisionError` (document kind, deterministic path order) |

### Anchor region (new parsing region)

Body lines from first body line up to (exclusive) the first ATX heading matching
`anchorRegionStopPattern` (case-insensitive `Activity Log` / `Review Report`). Anchors are
recognized only inside the region; restatements of `Tnnn` headings after the stop line (e.g.
`#### Subtask T001: Validator CLI ✅` in Activity Logs) are plain mirrored content — never
anchors, never collisions. At depth ≥ 2 the region's promoted spans are the
`promotedRanges`.

### Status event (mission-scoped, plan-time input — not a `Task`)

| Attribute | Rule |
|---|---|
| Source | `kitty-specs/<mission>/status.events.jsonl` (adapter member `statusEventFileName`), read ONLY during plan build |
| Qualifying line | valid JSON object with string `wp_id` AND string `to_lane` at the top level (envelope events, annotations, and malformed lines are skipped, never poisoning order) |
| Derived map | `wp_id → to_lane` of the LAST qualifying line in FILE ORDER (append-only = canonical order) |
| Lane vocabulary | `planned, claimed, in_progress, for_review, in_review, approved, done, blocked, canceled`; any other value (e.g. bootstrap `genesis`) is known-unmapped |
| Unknown `wp_id` (no canonical document) | ignored with a reported finding; the log never conjures issues or states |

### Lane→state mapping (per-team routing data — amendment A-023-0)

| Attribute | Rule |
|---|---|
| Shape | `TeamIdentity.workflowStates.lanes?: Record<LaneName, string>` — optional; keys restricted to the nine-lane vocabulary; values non-empty workflow-state NAMES |
| Default | NONE ships (consumer-required class, like `workflowStates` itself); absent or unmapped lane ⇒ issue state untouched + `lane-state-unmapped` finding |
| Resolution | mapped name → `stateTypeId` via the existing `discoverMetadata` snapshot (`resolveWorkflowStateId`), routed per the task's team; unresolvable name ⇒ conflict posture identical to the completion-state path |
| Apply | `IssueUpdatePatch.stateTypeId` (existing path); history event kind `"lane-changed"` (append-only additive) |

## 2. Recognition and depth decision table

| Input (inside `kitty-specs/<mission>/tasks/`) | depth 1 (default) | depth ≥ 2 |
|---|---|---|
| `WP01-x.md` direct child, front matter or `WPnn` name | 1 task (whole body mirrored) | 1 task (body minus promoted spans) |
| `WP01-x/review-cycle-1.md` (any front matter) | 0 tasks (claimed inert) | 0 tasks (claimed inert) |
| `planned/WP02-y.md` (lane folder, legacy) | 1 task | 1 task (+children) |
| `README.md`, non-`WPnn` name, no front-matter id | 0 tasks | 0 tasks |
| `### Subtask T004 – Title` inside the anchor region | folded verbatim + exclusion `"depth-folded"` | child task, parented, own extent |
| `subtasks: [T007]` roster entry with NO body anchor | folded (part of whole-body extent) | exclusion `"subtask-no-anchor"`, folded |
| Duplicate `T004` anchors inside the anchor region | both folded (no drafts) | collision REFUSAL (existing document-kind guard) |
| Restated `#### Subtask T001: …` after Activity Log stop | mirrored content | mirrored content (never an anchor) |
| Mission `status.events.jsonl` / `status.json` / `wps.yaml` / `meta.json` / roll-up | 0 tasks | 0 tasks |
| Depth config 1 → 2 → 1 | n/a | raise: creates children; lower: refolds verbatim, former children reported `unmapped` (stale/leftover), zero auto-delete |

## 3. Re-based adapter row (`spec-kitty` built-in defaults — delta only)

```
taskPathPatterns:   ["kitty-specs/*/tasks/**/*.md"]                    # UNCHANGED — claims stay broad (FR-009/FR-015 no fall-through)
documentTaskRule:
  collectionPattern: ^kitty-specs/[^/]+/tasks/
                     (?:(?:planned|claimed|in_progress|for_review|in_review|approved|done|blocked|canceled)/)?
                     [^/]+\.md$                                        # AMENDED — direct children + lane variant (FR-015)
  idKey:             work_package_id                                   # unchanged
  titleKey:          title                                             # unchanged
  fileNameIdPattern: (?i)^WP(\d+)[^/]*\.md$                            # unchanged
  subtaskRule:                                                       # NEW (A-023-2, all optional members)
    rosterKey:              subtasks
    anchorPattern:          ^(?:[-*+] \[[ xX]\] |#{1,6} )[ \t]*(?:Subtask[ \t]+)?(T\d+)\b[ \t]*[:–—-]?[ \t]*(.*)$
    anchorRegionStopPattern: ^#{1,6}[ \t]+(Activity Log|Review Report)[ \t]*$
statusEventFileName: "status.events.jsonl"                             # NEW (A-023-1)
```

Every member overridable through the existing three-layer merge (config layer for frozen
keys; programmatic `DiscoveryOverrides.adapters["spec-kitty"]` on discovery lanes; engine
consumes built-in row values per 022 precedent). Zero new required configuration (FR-012).

## 4. State transitions (tracker-visible)

Work-package issue state follows the event log ONLY (FR-007; spec Q4):

```
(no lane event for WP)            → create: tracker default; update: state untouched (no label)
last lane → mapped, stateType ≠ name → plan: changedFields += "state", label lane:<lane>;
                                       apply: patch.stateTypeId; history "lane-changed"
last lane → mapped, stateType = name → no-change (idempotent; re-run is a no-op)
last lane → unmapped / name unresolvable → state untouched + reported finding (never a silent guess)
status.json / front-matter lane flips ONLY → nothing observable (never state sources)
lane front matter flips WITH an appended event → state follows the event; description follows the
                                                 body; identity unchanged (single update)
```

Sub-issue lifecycle: created parent-before-child (`emissionOrder`); child skipped subtree-style
if the parent did not land (existing 020 posture); in-collection WP rename keeps parent AND
children identities (durable anchors) — children re-parent to the same issue.

## 5. Validation rules (config load / plan build)

- `lanes` map: keys ⊆ nine-lane vocabulary; values non-empty; malformed ⇒ config validation
  failure naming the offending team key (no partial application).
- Status loader: mission file missing ⇒ empty map (never an error); malformed lines counted
  into one reported finding per mission (count only — content never propagates to reports).
- Anchor pattern: subtask token grammar `T\d+` overridable via the `subtaskRule` member — the
  only knob needed for custom subtask id shapes (FR-012).
- Collision guard: unchanged code path; children participate automatically via kind
  `"document"`.
