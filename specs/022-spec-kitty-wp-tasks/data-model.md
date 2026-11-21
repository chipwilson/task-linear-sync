# Phase 1 Data Model: Spec Kitty Work-Package Task Source

**Feature**: `022-spec-kitty-wp-tasks` | **Date**: 2026-11-21
**Inputs**: [spec.md](./spec.md) Key Entities, [research.md](./research.md)

This feature adds **no new persisted entities**. It re-maps Spec Kitty document concepts
onto the frozen 002 shapes (`Task`, `DiscoveredFile`, `Stable_UUID`) — with one frozen-shape
amendment (`TaskKind += "document"`, A-022-0) — and declares the re-based adapter row.
Field semantics of the frozen shapes are otherwise unchanged; see
`specs/002-core-domain-contracts/contracts/task-model.md`.

## 1. Concept → shape mapping

### Mission (source concept — not an entity)

| Aspect | Value |
|---|---|
| Source | Directory immediately beneath the configured specs root (`kitty-specs/<NNN-slug>/`) |
| Maps to | `DiscoveredFile.featureName` → `Feature_Name` seed element of every task inside it (FR-006) |
| Rule | **NEW** `segment-under-base` feature-name kind (R3): first path segment after the effective base directory — identical result for `tasks.md`, `tasks/WP01-x.md`, and `tasks/<lane>/WP01-x.md` |
| Validation | Any directory beneath the root qualifies; a mission with no `tasks/` collection yields zero tasks and no error (US2-AC3) |

### Work-package document (the sync unit → `Task` of kind `document`)

| Aspect | Value |
|---|---|
| Source | A recognized markdown file inside the mission's `tasks` collection: `kitty-specs/<mission>/tasks/**/*.md` (flat layout or legacy lane sub-folders) |
| Maps to | Exactly one `Task { kind: "document" }` per recognized document (FR-002); `DiscoveredFile { frameworkId: "spec-kitty", featureName: <mission>, … }` |
| Prohibition | Internal `Tnnn` subtask lines and DoD checkboxes are never extraction inputs — they are body content (FR-004) |

| Task field | Derivation |
|---|---|
| `kind` | `"document"` (A-022-0) |
| `localTaskId` | Normalized WP id (R7): front-matter `work_package_id` scalar, else the file-name `WPnn` token; canonical form `WP` + digits (upper-case) |
| `title` (stored raw) | Title cascade (R6/FR-003): front-matter `title` → body's leading ATX heading text → readable file-name slug (`WP01-release-validation-tooling` → `Release Validation Tooling`). Front-matter text never appears in the title |
| `stableUuid` | Frozen seed `spec-kitty ⎵ <mission> ⎵ <WP id>` (R7) — no ordinal fallback for document tasks |
| `lineNumber` / `taskBody` | `lineNumber` = first body line; `taskBody = { startLine: first body line, endLine: last line }` — the extent **is** the mirrored content range (R11) |
| `checked` / `phase` | Absent (present-iff rules unchanged; work-package grouping is superseded) |
| `parentUuid` / `childUuids` | Absent / empty — one document is never nested (depth 1, fold-inert, R4) |
| `unresolvedConflict` | `taskBody` intersecting a conflict block (existing scan, unchanged) |
| Mirrored content | Body verbatim minus front matter — objectives, context, subtask guidance, test strategy, DoD, Activity Log, Review Report (FR-004); no truncation; empty body ⇒ empty content + visible `no-content` report label (R11) |
| Line write-back | **None** — document tasks receive no `[KEY-N]` rendering; `expectedMarkdownChanges` empty (R10) |

### Front matter (document region — never title, never content)

| Aspect | Rule (R5/R6) |
|---|---|
| Recognition | Leading `---` fence as the first non-blank line, closed by a `---`/`…` fence line |
| Keys consumed | `work_package_id` (identity scalar), `title` (title scalar) — top-level scalars only |
| Keys ignored | Everything else (`lane`, `dependencies`, `subtasks`, `phase`, history) — excluded from content wholesale |
| Malformed / absent fence | No front matter: whole file is body; title falls to the cascade |

### Mission roll-up (`tasks.md` / `TASKS.md`) — claimed documentation, not a task source

| Aspect | Value |
|---|---|
| Source | `kitty-specs/<mission>/tasks.md` or `TASKS.md` (basename discovery patterns unchanged) |
| Handling | Claimed by `spec-kitty` (no fall-through to `generic`); yields **zero** tasks and zero drafts in all cases — checkbox lines, WP headings, and prose are all documentation (FR-005) |
| Mission without any `tasks/` collection | Zero tasks; not an error; deliberately no roll-up fallback (R1) |

### Subtask (`Tnnn`) — content only

Body of the owning document task; never its own task regardless of task-depth settings
(spec Assumption; 020 folding is vacuous for document kind). Dependency front matter and
prose stay content; no machine-readable edges (017 C3.7 stance retained).

### Non-source files inside the collection (skipped content)

| File kind | Handling |
|---|---|
| `.md` failing recognition (notes, review-feedback artifacts) | Claimed by `spec-kitty`; zero tasks (R4) — never falls through to another identity |
| Non-`.md` (attachments) | Outside the candidate pattern; not discovered (R2) |
| Legacy lane sub-folders (`tasks/planned/…`) | Accepted as the same collection via `**` depth (R12); a lane *directory* is never a feature name |

### Roll-up-era issue (tracker side — cleanup material)

| Aspect | Value |
|---|---|
| Origin | Issues created under the superseded 017 roll-up-line model (recorded identity = `Tnnn`/ordinal seed) |
| Handling | Never paired onto document-kind tasks (durable-only pairing veto, R9/A-022-3); surfaced through existing stale/unmapped reporting for operator removal (FR-011/SC-004); no automatic deletion |

## 2. Recognition and collision decision table (FR-001/FR-005/FR-008/FR-009)

Applied per claimed spec-kitty file, pure over (path, content):

| # | File | WP id | Tasks | Notes |
|---|---|---|---|---|
| 1 | `tasks/WP01-x.md` with `work_package_id: WP01` | `WP01` (front matter) | 1 | Canonical; title from `title:` scalar |
| 2 | `tasks/planned/WP01-x.md`, no front-matter id | `WP01` (file name) | 1 | Legacy lane layout |
| 3 | `tasks/WP01-x.md`, `title:` only, no id | `WP01` (file name) | 1 | Title from front matter |
| 4 | `tasks/notes.md`, no id, no WP name | — | 0 | Skipped content, claimed |
| 5 | `tasks.md` (roll-up), any contents | — | 0 | FR-005, always zero |
| 6 | `spec.md`, `plan.md`, `meta.json` | — | — | Not candidates (unchanged) |
| 7 | `tasks/img.png` | — | — | Not a candidate (non-`.md`) |
| 8 | Two files in one mission both resolving to `WP01` | — | — | **Plan-build refusal** with sorted colliding paths (R8) |

Count parity (FR-009): per mission, plan task count = recognized-document count; roll-up
contribution is always zero.

## 3. Re-based adapter row (`spec-kitty` built-in defaults)

| Convention member | Value | Overridable via |
|---|---|---|
| `baseDirectories` | `["kitty-specs/"]` (unchanged) | programmatic layer |
| `taskFilePatterns` | `["tasks.md", "TASKS.md"]` (unchanged — roll-up claim) | programmatic layer |
| `taskPathPatterns` | `["kitty-specs/*/tasks/**/*.md"]` — **new** (A-022-1, R2) | programmatic layer |
| detection | `pathPrefixes: ["kitty-specs/"]`, no siblings (unchanged, 017 C2.1) | programmatic layer |
| feature-name rule | `segment-under-base` (was `parent-dir`) — **amended** (R3) | programmatic layer |
| `frameworkSpecificExclusions` | `[]` — 017 `kitty-specs/*/tasks/` entry **removed** (supersedes 017 C2.5) | programmatic layer |
| `documentTaskRule` | `{ collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$"`, `idKey: "work_package_id"`, `titleKey: "title"`, `fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$" }` — **new** (A-022-2, R4) | programmatic layer |
| `headingGrammar` | never-matching (`(?!)`) retained as the structural placeholder (conventions interface requires it; document mode does not consult it) | programmatic layer |
| `checklistIdPattern`, `titleTagPattern`, `phasePattern`, `summaryPattern` | **retired from the row** — unconsumed once the roll-up yields no tasks; the 017 whitelist members remain available to custom adapters | n/a |
| `identityFileScope` | absent (WP id is path-independent, R7) | n/a |
| `agentHooksDirectory` / template | none — scaffold requests keep refusing with zero writes (017 C1.3 retained) | n/a |

No new `ResolvedConfig` key (017 C5.1 precedent); defaults are generic format names — zero
organization-specific literals (Principle III, release scan). Disabling `spec-kitty` removes
patterns, claims, and document-mode as a unit → pre-017 generic fall-through (FR-013).

## 4. Precedence and ranking state

`DEFAULT_PRECEDENCE` unchanged:
`["kiro", "spec-kit", "open-spec", "bmad", "spec-superpower", "spec-kitty", "generic"]`.
Detection sets stay disjoint from `spec-kit` (017 C2.2 retained): both `specs/` and
`kitty-specs/` trees in one repository produce disjoint match sets; the new path patterns
are rooted in `kitty-specs/` and cannot claim other identities' candidates (R2).

## 5. State transitions

No new persisted state. Behavior-level invariants (all enforced by tests in `quickstart.md`):

| Lifecycle edit inside the collection | Identity | Mirrored content | Plan effect |
|---|---|---|---|
| `lane:` front-matter flip (planned → claimed → … → done) | unchanged | unchanged (front matter excluded) | no-change |
| Activity Log append / Review Report append | unchanged | re-mirrored | update (content) |
| DoD checkbox toggled in body | unchanged | re-mirrored | update (content) |
| File renamed within the collection (slug tidy-up) | unchanged | re-mirrored | update |
| Move between `tasks/` and a lane sub-folder | unchanged | re-mirrored | update |
| Document deleted upstream | — | — | existing stale/reconcile behavior (008) |
| Second sync with zero repository change | unchanged | unchanged | full no-op (FR-010) |
| Roll-up-era leftover issue present | n/a | n/a | reported stale/unmatched; zero pairings (SC-004) |

Round-trip: repository `tasks/` files are never written (R10), so repeated syncs over
unchanged content cannot oscillate (Principle IV, conflict-free-sync rule holds trivially).
