# Phase 0 Research: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Feature**: `specs/023-spec-kitty-subtask-depth/spec.md` | **Date**: 2026-11-24

All upstream data shapes below were measured directly against a shallow clone of
`github.com/spec-kitty/spec-kitty` (838 missions; 4,198 `WPnn-*.md` files; 4,188 stock tasks at
0.6.0 default config) and the as-built 0.6.0 source — not against documentation alone.

---

## R1. Subtask roster and anchor grammar

- **Decision**: The roster is the front-matter `subtasks` list (single-level block OR flow
  form), unioned with body anchors. An anchor is an ATX heading or checklist line whose text
  opens with `Subtask T<digits>` or bare `T<digits>` followed by a separator (`:`, `–`, `—`,
  `-`) and a title, recognized ONLY inside the anchor region — the document body up to the
  first `## Activity Log`-or-`## Review Report` heading (case-insensitive
  `anchorRegionStopPattern`). The anchor's section spans to the next anchor at the same-or-
  shallower heading level or the region end. Title = anchor text after the identifier; a
  roster id with no anchor is excluded with reason `subtask-no-anchor` and stays folded.
- **Rationale**: Upstream `WP01-release-validation-tooling.md` uses exactly
  `subtasks:\n- T001\n- T002` (block list — invisible to the current scalar-only
  `scanFrontMatter`) with `### Subtask T001 – Implement validator CLI` anchors — note the en
  dash — and then RESTATES `#### Subtask T001: Validator CLI ✅` under later Activity Log /
  review sections. Scoping anchors to the pre-Activity-Log region keeps the spec's
  "duplicate anchor = integrity finding" rule true where it matters (the implementation
  guidance region) without breaking on upstream's legitimate restatements. A duplicate id
  inside the anchor region yields two drafts with identical seeds and is refused by the
  EXISTING document-kind collision guard — zero new integrity machinery.
- **Alternatives considered**: (a) treat every `Tnnn` mention as an anchor — rejected: restated
  headings and cross-references ("depends on T001 implementation") would collide or explode
  anchors; (b) require front-matter roster membership for promotion — rejected: legacy
  documents with body-anchored subtasks but no `subtasks:` key must still promote at depth ≥ 2
  (spec US1/edge case); (c) new collision error class — rejected: seed equality already routes
  duplicates through `DocumentIdentityCollisionError`.

## R2. Fold-vs-promote and the parent body without duplicated sections

- **Decision**: Subtask drafts are structural children of the document draft at depth 2 and
  pass through the 020 cap check (`foldDraftsOverCap`). At `maxTaskIssueDepth: 1` (default) no
  child drafts survive: the parent's mirrored extent already covers the whole body, so folded
  subtasks ride verbatim exactly like 020 checklist folding; exclusion records (kind `subtask`,
  reason `depth-folded`) are emitted for roster visibility. At depth ≥ 2, promoted children
  gain parent links, and the parent's `TaskBodyExtent` gains additive `promotedRanges` (the
  children's inclusive line spans); the document-kind branch of `mirrorRegion`
  (`build.ts:214-223` / `apply.ts:617-624`) slices those spans out — every other kind keeps the
  byte-identical contiguous slice.
- **Rationale**: Reuses the proven 020 fold mechanism and extent model instead of a parallel
  one; folding by omission (children removed before extent/mirror) is precisely how 020 already
  achieves verbatim folding, so the flat default is structurally free. `promotedRanges` is the
  minimal representation of "mirror the document minus promoted sections" — contiguous
  startLine..endLine cannot express holes, and a full segment-list rework of the frozen extent
  model would churn every kind.
- **Alternatives considered**: (a) keep promoted content duplicated in parent + child —
  rejected: FR-005 forbids duplication; (b) generalize `TaskBodyExtent` to
  `segments[]` for all kinds — rejected: touches every identity's rendering for no benefit
  (violates FR-013 byte-fidelity with maximal blast radius); (c) render-time regex removal of
  T-sections — rejected: non-deterministic text surgery vs. exact line spans.

## R3. Child identity seeding

- **Decision**: Child `Task.localTaskId` = normalized subtask token (`T004`); the seed's third
  slot composes `${wpId}\u0000${subtaskId}` following the existing `composeSeedLocalTaskId`
  NUL-join precedent (`taskfile.ts:57-65`), giving `spec-kitty | <mission> | WP01\0T004` under
  the FROZEN `taskStableSeed`. Child `Task.kind` stays `"document"`.
- **Rationale**: The 3-part seed layout is frozen and `identity.ts` forbids re-implementing the
  join; composing inside the stable-identity slot is the established pattern. Kind `"document"`
  inherits, with zero code, the A-022-3 durable-only pairing (children pair only via their own
  durable UUID — exactly the desired "re-parent after in-collection rename, never match by
  title") and the "never write a landed line back" posture.
- **Alternatives considered**: (a) new `TaskKind` "subtask" — rejected: forces A-022-3-style
  matching amendments and a second durable-only rule for no behavioral gain; (b)
  `identityFileScope: true` per-file scoping — rejected: WP-named files move between
  collection roots and lanes; the WP-id part must come from FRONT MATTER, not path/file name
  (022 C2 stability rules), which the compose-slot approach provides; (c) mission+file+subtask
  seed — rejected: breaks rename stability (022 C2.3 lineage).

## R4. Canonical-document gate (FR-015, measured defect)

- **Decision**: Narrow `documentTaskRule.collectionPattern` to
  `^kitty-specs/[^/]+/tasks/(?:(?:planned|claimed|in_progress|for_review|in_review|approved|done|blocked|canceled)/)?[^/]+\.md$`
  — direct children of the mission `tasks/` folder plus the legacy single lane sub-folder
  variant. `taskPathPatterns` stays `kitty-specs/*/tasks/**/*.md` so artifact files remain
  CLAIMED by `spec-kitty` (zero fall-through to `generic`) while deriving zero drafts.
- **Rationale**: Measured on the real reference repository: 0.6.0 counted six
  `tasks/WPnn-slug/review-cycle-1.md` artifacts as tasks because upstream stamps them with the
  owning document's `work_package_id` — and those missions would abort EVERY plan via
  `DocumentIdentityCollisionError` (canonical file + its own artifact share the id). Direct-
  child-only recognition matches the framework's own layout (a WP is a file; its review folder
  is an attachment) while the lane alternation retains the 022 legacy variant. Keeping the
  claim broad preserves the 022/FR-009 no-fall-through guarantee.
- **Alternatives considered**: (b) silent-attach of same-id artifacts (spec Q1 option B) —
  rejected by the user in clarification; (c) require operator cleanup (option C) — rejected:
  upstream is the canonical corpus; leaving the flagship reference repo unplannable fails the
  product's out-of-the-box promise.

## R5. Status authority: what `status.events.jsonl` actually looks like

- **Decision**: A pure scanner (`src/parsing/status.ts`) takes the mission file's lines and
  returns, per `wp_id`, the LAST `to_lane` value among qualifying lines IN FILE ORDER. A line
  qualifies iff it parses as JSON and has string `wp_id` + string `to_lane` at the top level;
  malformed lines and all other line shapes are skipped without poisoning order. Nine known
  lanes (`planned, claimed, in_progress, for_review, in_review, approved, done, blocked,
  canceled`); every other value (e.g. the bootstrap sentinel `genesis`) is a known-but-unmapped
  lane → untouched state + reported finding.
- **Rationale**: Measured upstream: the log MIXES three line shapes — envelope events
  (`{aggregate_type, event_type, payload, schema_version: "5.0.0", …}` including `WPCreated`),
  flat lane transitions
  (`{"wp_id": "WP01", "from_lane": "genesis", "to_lane": "planned", "at": …, "actor": …}`),
  and annotations (`{"kind": "annotation", "wp_id": "WP04", "delta": …}` — 17,884 of them in
  the sample). Only the flat shape carries lane changes; the append-only file's order IS the
  canonical order (clarification Q4). `status.json`'s `work_packages[wp].lane` exists but is
  explicitly never consulted (spec Q4: sole authority is the event log), which also immunizes
  the sync against stale materializations.
- **Alternatives considered**: (a) replay/sum-state via event envelopes — rejected: the sample
  shows envelope `event_type` coverage of lane moves is inconsistent across schema versions;
  the flat `to_lane` lines are universal; (b) trust `status.json` when `event_count` matches —
  rejected by the user's clarification (sole authority); (c) sort by `at` timestamp — rejected:
  clock skew across agents vs. append-only file order as spec'd authority.

## R6. Lane → tracker-state mapping and state drift

- **Decision**: Lane→state is per-team routing data: additive optional `lanes` map on
  `WorkflowStateIdentities` (keys ⊆ the nine-lane vocabulary, values non-empty state names,
  validated at config load). No built-in default mapping ships. Engine entry assembly gains a
  lane-state drift check beside the completion-state path: when a status lane maps through the
  routed team to a state NAME and the live snapshot's `stateType` differs, `changedFields`
  gains `"state"`; `apply` reuses `resolveWorkflowStateId` on the re-fetched snapshot and the
  existing `IssueUpdatePatch.stateTypeId` patch. Unmapped lane or unknown state name ⇒ state
  untouched + `lane-state-unmapped` label (conflict posture mirrors `build.ts:420-429`).
  Creates inherit the mapped state when a lane event exists (else tracker default). History
  gains append-only event kind `"lane-changed"`.
- **Rationale**: The completion path (`completion.ts:35-93`, `build.ts:408-430`,
  `apply.ts:1133-1146`) is an exact precedent — spec→tracker state, no reverse mapping, name→id
  via the 007 snapshot, no default team-key fallback — so lane state is that trio generalized
  from checked→{done,backlog} to lane→lanes[]. Team routing (`resolveRouting`) already picks
  the per-file team, so multi-team repos map lanes per routed team for free.
- **Alternatives considered**: (a) global lane→state config — rejected: state names are
  per-team/per-workspace in Linear; (b) built-in default mapping (planned→backlog, done→done) —
  rejected: `workflowStates` deliberately has NO defaults (constitution III names them as the
  consumer-required class), and a guessed default could move issues to wrong columns;
  (c) reverse sync (tracker→lane) — forbidden by the completion contract's one-way rule.

## R7. Where status files are consumed

- **Decision**: A read-only loader runs during plan build only (`src/engine/status-load.ts`),
  driven by the new adapter member `statusEventFileName` (built-in `"status.events.jsonl"`):
  for each mission featureName present in the parsed units, the loader reads
  `kitty-specs/<mission>/status.events.jsonl` if it exists and caches the wpId→lane map for
  entry assembly. Inventory/discover-metadata lanes do not read it (no user-visible need,
  zero cost for other identities). The file name convention is a `FrameworkAdapter` member so
  it participates in the discovery contract surface, while the engine reads built-in-row values
  (programmatic overrides do not reach the engine registry — 022 precedent).
- **Rationale**: The status file is not a task file — it must never appear in discovery
  candidate results as a task source (it is already claimed-inert); plan build is where the
  tracker snapshot, routing, and drift classification already live, so lane state is evaluated
  exactly once per matched task with the correct team.
- **Alternatives considered**: (a) parse it during file parsing and smuggle lanes through task
  fields — rejected: one file describes many tasks (mission-scoped, not file-scoped), and the
  parser is per-file pure; (b) apply-time load — rejected: the PLAN must show intended state
  changes (drift labels, plan-reference stability).

## R8. Reference-repository acceptance harness

- **Decision**: An e2e world reproduces the reference repo at measured scale-reduced ratio:
  three missions — numeric-prefixed (`042-auth-system`), ULID-suffixed
  (`auth-system-01KQ2VNJ`), bare slug — full artifact sets (meta/spec/plan/roll-up/wps.yaml/
  status.json/status.events.jsonl with mixed line shapes), one per-WP artifact sub-folder with
  duplicated `work_package_id`, `tasks/README.md`, and WP documents carrying block-list
  `subtasks` rosters plus `### Subtask Tnnn – Title` anchors and Activity-Log restatements.
  Scenarios: stock defaults (SC-002: zero sub-issues, count = WP count, artifacts contribute 0
  — SC-007 zero collisions); depth 2 (SC-001: children = anchors, parented, parent body has
  holes); status fixture (SC-003: `status.json`+front-matter deliberately contradict the log —
  last event wins; no-events mission untouched; unmapped lane reported); cap toggle
  2→1→converge (FR-010, SC-005).
- **Rationale**: All shapes above were chosen from files that exist in the real repo — the
  harness fails if any measured quirk (roster lists, en-dash anchors, restatements, mixed log
  lines, artifact duplication) regresses.
- **Alternatives considered**: cloning the real repo in CI — rejected (constitution VI
  hermeticity: no network in tests); the fixture reproduces the union of shapes instead.

## Resolved unknowns ledger

| Spec/plan unknown | Resolution | Source |
|---|---|---|
| `subtasks` front-matter shape | block list `- T001` (and YAML flow `[T001, T002]`) | R1 (measured) |
| Body anchor forms & restatements | `### Subtask T001 – Title`; restated under Activity Log | R1 (measured) |
| Lane-event line shape | flat `wp_id`/`from_lane`/`to_lane` among envelope+annotation lines | R5 (measured) |
| `genesis` pseudo-lane | not in the nine-lane vocabulary ⇒ unmapped ⇒ untouched | R5 |
| Parent body de-duplication | additive `promotedRanges` on the document extent | R2 |
| Child matching | inherits document-kind durable-only pairing | R3 |
| Reference-repo collision defect | collection gate = direct children + lane folders | R4 (measured: 6 artifact tasks / abort path) |

No NEEDS CLARIFICATION remains; the spec's four clarifications (2026-11-24) are fully honored
by these decisions.
