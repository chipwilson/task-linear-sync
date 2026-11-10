# Phase 1 Data Model: Spec Kitty Adapter

**Feature**: `017-spec-kitty-adapter` | **Date**: 2026-11-09
**Inputs**: [spec.md](./spec.md) Key Entities, [research.md](./research.md)

This feature adds **no new persisted domain entities**. It maps Spec Kitty document
concepts onto the frozen 002 shapes (`Task`, `DiscoveredFile`, `Stable_UUID`) and declares
the adapter row's defaults. Field semantics of the frozen shapes are unchanged; see
`specs/002-core-domain-contracts/contracts/task-model.md` (amended only by the
`FrameworkId` union widening).

## 1. Concept → shape mapping

### Mission (source concept — not an entity)

| Aspect | Value |
|---|---|
| Source | Directory immediately beneath the configured specs root (`kitty-specs/`) |
| Maps to | `DiscoveredFile.featureName` → `Feature_Name` seed element of every task inside it (FR-003) |
| Rule | Existing `parent-dir-under-base` feature-name rule; no new rule kind |
| Validation | Any directory beneath the root qualifies; a mission without `tasks.md`/`TASKS.md` yields no candidate and no diagnostic worse than informational (spec edge case) |

### Mission roll-up task file

| Aspect | Value |
|---|---|
| Source | `kitty-specs/<mission>/tasks.md` or `TASKS.md` (default `taskFilePatterns`) |
| Maps to | `DiscoveredFile { frameworkId: "spec-kitty", filePath, featureName, siblingDocuments, … }` |
| Sole task source | Yes (FR-004) — the only discovered file per mission |

### Work Package (grouping — not a task)

| Aspect | Value |
|---|---|
| Source | Heading `## Work Package WPxx: <title>` (levels 2–4) |
| Maps to | `Task.phase` of every subtask beneath the heading until scope resets |
| Grouping value | Captured `phase` group: `WPxx` plus the printed title span (e.g. `WP01: Setup`) |
| Prohibition | Never a `Task` of kind `heading` (adapter `headingGrammar` matches no heading) |
| Empty package | Zero tasks; grouping context only (spec edge case) |

### Subtask (the sync unit → `Task`)

| Task field | Derivation for spec-kitty |
|---|---|
| `kind` | `"checklist"` (only task kind this adapter produces) |
| `localTaskId` | Printed id captured by adapter `checklistIdPattern`: `T\d{2,}` or bare `\d{2,}` (dot-separated variants allowed), trailing separator `.` `:` `—` `–` `-` optional (FR-005, R4) |
| title (stored raw) | Checkbox text after the issue-ref strip and id-span strip — **includes** capability tags (frozen raw-field semantics, R5) |
| derived / mirrored title | `cleanTitle(raw)` — additionally strips `[P]` / `[USn]`-shaped tokens via `titleTagPattern`; never contains the id span, never contains a tag (FR-005, FR-006, SC-003) |
| `phase` | Enclosing work package's grouping value (§ Work Package) |
| `checked` | Checkbox state as usual (mutable; excluded from identity) |
| extent / body | Existing model: task line up to the next task or any heading — preserves `[P]` tags and dependency prose verbatim (FR-006/FR-008) |
| `stableUuid` | Existing seed `spec-kitty | <mission> | <Txxx>` (ordinal fallback only when no id printed) — insertion/removal/reorder of *other* tasks cannot change it (FR-010, SC-004) |

### Agent-prompt file (never synced)

| Aspect | Value |
|---|---|
| Source | `kitty-specs/<mission>/tasks/WPxx-*.md` (YAML execution history + prose) |
| Handling | Directory skipped during traversal by exclusion entry `<root>/*/tasks/` (amendment 3); never a candidate for any adapter (FR-004; spec edge case "prompt files") |

## 2. Adapter row (`spec-kitty` built-in defaults — amendment-bearing)

| Convention member | Default | Overridable via |
|---|---|---|
| `baseDirectories` | `["kitty-specs/"]` | `DiscoveryOverrides.adapters["spec-kitty"]` (programmatic layer; exclusion follows, R6) |
| `taskFilePatterns` | `["tasks.md", "TASKS.md"]` (shared default) | same |
| detection | `pathPrefixes: ["kitty-specs/"]`, no sibling requirement | same |
| feature-name rule | parent-dir-under-base | same |
| `frameworkSpecificExclusions` | `["kitty-specs/*/tasks/"]` | same |
| `headingGrammar` | never-matching (`(?!)`) | config-file `headingIdGrammar` applies only where adapter member is absent — override via programmatic layer |
| `phasePattern` | `/^#{2,4}\s+Work Package\s+(?<phase>WP\d+(?::\s*[^\n]*)?)\s*$/u` | programmatic layer |
| `summaryPattern` | template/prose section headings (Inputs, Prerequisites, Organization, Subtask Format, Path Conventions, Goal, Independent Test, Implementation Notes, Parallel Opportunities, Dependencies, Risks & Mitigations) | programmatic layer |
| `checklistIdPattern` *(new, amendment 2)* | `/^(?<id>[Tt]?\d{2,}(?:\.\d+)*)[ \t]*[.:—–-]?[ \t]+/u` | programmatic layer; **global** default = current `LOCAL_ID_SPAN_RE` (unchanged for all other adapters) |
| `titleTagPattern` *(new, amendment 2)* | `/\[(?:P\d*|US\d+)\]/gu` | programmatic layer; **global** default = undefined (no stripping) |
| `agentHooksDirectory` / template | none — scaffold requests refuse with zero writes (FR-012) | n/a |

All defaults are generic directory/format names — zero organization-specific literals
(Principle III, release scan). Enabling/disabling: `spec-kitty` joins the `frameworkAdapters`
default enabled set; disabling restores today's generic fall-through exactly, including the
exclusion list disappearing (FR-011, R6).

## 3. Precedence and ranking state

`DEFAULT_PRECEDENCE = ["kiro", "spec-kit", "open-spec", "bmad", "spec-kitty", "generic"]`
(R1). Ranking unchanged: longest matched pattern → precedence index → alphabetical.
Detection-set disjointness (R2) means position is deterministic-only, outcome-neutral.

## 4. State transitions

No new state. Behavior-level invariants (all enforced by tests in `quickstart.md`):

- `unplanned → created → mirrored`: unchanged engine lifecycle for spec-kitty tasks.
- **Identity invariance**: editing the mission file (insert/remove/reorder subtasks, swap
  work packages, retitling tasks) never changes any surviving task's `Stable_UUID`
  (FR-010); grouping (`phase`) changes are report-only (US3-AC3).
- **Round-trip**: parse → render → parse keeps the file byte-identical apart from the
  visible `[<KEY>-N]` prefix; tag stripping in derived titles is fixpoint-stable, so
  repeated renders never oscillate (Principle IV, US2-AC4).
