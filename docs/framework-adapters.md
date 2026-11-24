# Framework Adapters (Feature 003)

Feature 003 associates every discovered task file with a **framework identity** using
small, declarative convention bundles called **framework adapters**. Discovery is strictly
read-only; adapters themselves perform no I/O — the discovery caller supplies the directory
context (`DetectionContext`) that detection needs.

Everything below is the 003 realization of 001 R7.2/R7.5; the normative contract is
[`specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`](../specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md).

## Built-in adapter table

| Adapter | Base directories | Detection markers | `Feature_Name` rule | Sibling documents | Agent-hook directory / template |
| --- | --- | --- | --- | --- | --- |
| `kiro` | `.kiro/specs/` | path beneath `.kiro/` | immediate parent dir beneath `.kiro/specs/` | `requirements.md`, `design.md` | `.kiro/hooks/` · `kiro-json` |
| `spec-kit` | `specs/`, `spec/` | path beneath a base **AND** sibling `spec.md`/`plan.md` (conjunctive) | immediate parent dir beneath a base | `spec.md`, `plan.md`, `requirements.md` | — |
| `open-spec` | `openspec/`, `open-spec/` | path contains `openspec/`/`open-spec/` **OR** sibling `openspec.json`/`proposal.md` | segment after `openspec/`, `changes/`, or `specs/` | `spec.md`, `proposal.md`, `tasks.md` | — |
| `bmad` | `bmad/`, `bmad-method/`, `docs/` | path contains `bmad/`/`bmad-method/` **OR** sibling `prd.md`/`architecture.md` | parent dir, or task-file basename when no feature dir | `requirements.md`, `design.md`, `architecture.md`, `prd.md`, `spec.md` | — |
| `spec-superpower` | `docs/superpowers/plans/` | path beneath the plans root (path-only — no sibling markers; the dated-filename convention lives in `taskFilePatterns`) | date-stripped task-file basename (`2026-11-09-auth.md` → `auth`) | none | — |
| `spec-kitty` | `kitty-specs/` | path beneath `kitty-specs/` (no sibling requirement); tasks are the work-package documents that are DIRECT children of `kitty-specs/<mission>/tasks/` (or of a legacy lane folder beneath it) per the row's `documentTaskRule.collectionPattern` — deeper artifact files stay claimed but yield none, and the roll-up yields none | immediate parent dir beneath `kitty-specs/` (the mission) — `segment-under-base` | from config `siblingDocuments` (`spec.md`, `plan.md`, `research.md`) | — |
| `generic` | from config `specsBaseDirectories` | none — detection matches nothing | parent dir beneath a configured base, else absent | from config `siblingDocuments` | `.task-linear-sync/hooks/` · `command-json` |

Notes:

- `generic` carries **no framework-specific exclusions** (`frameworkSpecificExclusions: []`,
  FR-010): when it is selected, downstream features must read that empty set rather than any
  framework's list.
- `spec-kitty` carries **no framework-specific exclusions** (`frameworkSpecificExclusions: []`)
  since feature 022: the 017-era `kitty-specs/*/tasks/` exclusion is REMOVED — that folder
  is the work-package collection, claimed by the row's `taskPathPatterns` glob (supersedes
  017 C2.5). The roll-up `kitty-specs/<mission>/tasks.md` stays claimed as documentation and
  yields zero tasks.
- The collection gate is NARROWER than the claim (023 C1.2'): `taskPathPatterns` keeps
  EVERY `kitty-specs/*/tasks/**/*.md` file claimed as `spec-kitty` (no `generic`
  fall-through for artifact folders), while `documentTaskRule.collectionPattern` admits
  only direct children of the mission's `tasks/` folder — optionally under one of the
  nine legacy lane folder names — so per-WP artifact sub-folders (`tasks/WP01-x/review.md`)
  and `tasks/README.md` contribute zero tasks at every depth, duplicated front-matter ids
  included (FR-015, no identity collisions).
- Base directories are **discovery hints**, not selection markers. `docs/` is a `bmad` base
  directory, but a `docs/**` task file with no bmad markers resolves to `generic` — directory
  names are generic discovery defaults, never routing values (001 R7.8).
- `spec-kitty`'s document rule (`documentTaskRule`: collection pattern, `work_package_id`
  and `title` recognition keys, file-name id pattern) follows the same override lane as every
  other convention — `overrides.adapters["spec-kitty"]` (deep-merged, arrays replace) beats
  the built-in row — but it has no config-file key, so `adapter.<member> ?? built-in default`
  is the whole resolution (017 C5.1 stance retained). The 017-era roll-up grammar members
  (`checklistIdPattern`, `titleTagPattern`, `phasePattern`, `summaryPattern`) are RETIRED
  from the row (022 A-022-2): the whitelist members remain available to custom adapters, but
  the built-in `spec-kitty` row no longer declares them and the parser never consults them
  in document mode.
- The optional `statusEventFileName` member (023 A-023-1) names the file sought DIRECTLY
  BENEATH each mission directory as that identity's status event log. The built-in
  `spec-kitty` row ships `"status.events.jsonl"`; the file never joins the candidate
  union (never a task source) and is read by the engine during plan build ONLY —
  discovery never opens it. Like every other member it is overridable through the same
  merge lane; custom rows may declare it.
- Grammar fields (`headingGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern`,
  `titleBehavior.stripPrefixes`, plus the optional `checklistIdPattern` and `titleTagPattern`
  of 017 amendment 2) are regex-source strings consumed downstream (004/005). Since feature
  022, no built-in row declares the two 017 members anymore (022 A-022-2): the whitelist
  members stay available to custom adapters, and the rest of the field set inherits the
  built-in defaults. 003 never parses task content.
- **022 amendment A-022-1** adds two optional convention members, both absent-everywhere
  by default (the other rows' behavior is byte-identical when they are omitted, pinned by
  the discovery contract snapshots): `taskPathPatterns` — repository-root-relative POSIX
  globs (`*` one segment, `**` zero-or-more) claiming task files by full path instead of
  basename, joined into the same candidate union (see
  [discovery.md](./discovery.md)); and the `Feature_Name` rule kind `segment-under-base` —
  the first path segment beneath the adapter's **effective** `baseDirectories`, so files
  anywhere under a mission keep the mission's name and intermediate lane directories are
  never feature names. Both follow the existing override lanes: config-layer and
  `overrides.adapters.<id>` deep-merge with arrays replacing wholesale.
- Feature 021 amended those shared **built-in defaults** themselves — `headingIdGrammar`
  (`src/config/defaults.ts`) and the checklist-id span `LOCAL_ID_SPAN_RE`
  (`src/parsing/content.ts`) — and the five rows that consume them unchanged (`kiro`,
  `spec-kit`, `open-spec`, `bmad`, `generic`) pick the correction up all at once:
  a word-form heading id must contain a digit (`TASK-1`, `SYNC1`, `T001`-style ids still
  capture; digit-less leading words like `Implementation` no longer do, so `# Implementation
  Plan` yields no id and keeps its full text); a dotted-numeric checklist id captures with
  whitespace alone (`4.1 Create …` → id `4.1`) while bare integers still require a trailing
  separator, and an adapter `checklistIdPattern` override keeps precedence over the span.
  A first-line level-1 heading that matches the grammar yet yields no local id is the
  **document-title heading**: it stays a heading task (body = its preamble only) but never
  adopts column-0 checkboxes — those become parentless depth-1 tasks and survive the default
  `maxTaskIssueDepth: 1`. Flat-checklist detection counts a document whose only grammar
  heading is the title heading as flat (internal signal equals the determination — no
  public API change).
- The two override rows are unchanged by 021 and structurally immune, pinned by
  `tests/unit/parsing-adapter-immunity.test.ts`: `spec-kitty`'s never-matching heading grammar
  `(?!` yields zero heading tasks (in document mode since 022 the grammar is never consulted
  at all — `documentTaskRule` replaces heading/checklist extraction wholesale for claimed
  files), and in `spec-superpower` every checkbox is a rollup-excluded body line its narrow
  `#{2,4} Task N:` grammar never claims — a title-headed checkbox plan yields zero tasks
  (never one giant task) and `Task N:` headings bound each other.
- `builtInAdapters` (`task-linear-sync/discovery`) is the frozen seven-key record
  (`kiro`, `spec-kit`, `open-spec`, `bmad`, `spec-superpower`, `spec-kitty`, `generic`) of immutable
  `FrameworkAdapter` values.
- The `spec-superpower` row (feature 018) claims only date-prefixed plan files
  (`taskFilePatterns: ["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"]`) beneath the
  plans root at any depth; its 004-facing grammar is `^\s{0,3}#{2,4}\s+(?<id>Task\s+[0-9]+)\s*:\s*(?<title>.+)$`
  with every `- [ ] **Step N: …**` checkbox line matching the rollup pattern (mirrored
  body content, never a task), and `identityFileScope: true` composes the task-file
  basename into the seed input so same-name plans on different dates stay collision-free
  (amendment A-018-2).

## Detection precedence and ranking

Automatic selection (`selectAdapter(filePath, ctx, registry)`) is a pure function. Every
enabled adapter whose `detect` returns a match becomes a candidate; the winner is chosen by:

1. **Longest `matchedPattern`** (string length). Base-directory patterns count as rank
   material, which makes `.kiro/specs/` (12 chars) beat `specs/` (6) — the Kiro layout is
   robust against spec-kit's substring. A siblings-only match contributes `""` (rank 0).
2. **Precedence index** — the fixed default list `["kiro", "open-spec", "spec-kit", "bmad",
   "spec-superpower", "spec-kitty", "generic"]`, overridable via `overrides.precedence`.
   Path claims are segment-anchored, so `kitty-specs/` is not beneath `specs/`: the
   `spec-kit` and `spec-kitty` match sets are disjoint and precedence never has to
   arbitrate between them.
3. **Alphabetical** adapter id as the final tie-break.

Zero matches fall back to `generic` (`detection.via: "fallback"`) **only** while the file's
basename still matches the enabled `generic` adapter's effective `taskFilePatterns`;
otherwise the file is unclaimed, `selectAdapter` returns `null`, and discovery omits it
without a diagnostic (018 amendment A-018-1). An explicit
`overrides.selection` (fixed id or predicate) short-circuits detection entirely
(`via: "explicit"`); an id outside the enabled pool raises `SelectionOverrideError`. The
full result set of matched adapter ids is recorded, sorted alphabetically, on every
`DiscoveredFile.detection.candidates` for transparency.

## The three override layers

Convention resolution follows constitution III exactly — later layers win, and "arrays and
scalars replace wholesale" (002 merge semantics):

1. **Built-in adapter defaults** — the table above (`builtInAdapters`).
2. **The frozen config-file layer** (`ResolvedConfig`, feature 002): `taskFilePatterns`,
   the grammar keys, and `agentHooksDirectory` apply to all enabled adapters when they
   deviate from the built-in defaults; `specsBaseDirectories` and `siblingDocuments` feed
   the `generic` row (framework rows keep their per-framework 001 R7.5 lists).
   `frameworkAdapters` is the enabled set; `skipDirectories` the traversal skip set.
3. **Programmatic `DiscoveryOverrides`** — selection, precedence, per-adapter convention
   overrides (`overrides.adapters.<id>`), and custom adapters (next section). A
   programmatic `featureName` function beats the declarative rule.

Every convention in `FrameworkAdapter` is overridable at layers 2–3 (SC-004); the override
matrix is gated by `tests/unit/discovery-overrides.test.ts`.

## Custom adapters

A custom adapter needs at least an `id`, task-file/base-directory patterns, and a heading
grammar (FR-011). Placeholder identifiers only:

```ts
import { builtInDefaults } from "task-linear-sync/config";
import { createAdapterRegistry, discoverTaskFiles } from "task-linear-sync/discovery";

const descriptor = {
  id: "acme-flow", // any non-empty id outside the seven built-in literals
  taskFilePatterns: ["todo-*.md"],
  baseDirectories: ["flows/"],
  headingGrammar: "^#{2,4}\\s+(?<id>F\\d+)[.:]?\\s+(?<title>.+)$",
} as const;

const result = await discoverTaskFiles({
  repositoryRoot: "/path/to/repo",
  config: builtInDefaults,
  overrides: { customAdapters: [descriptor] },
});
// flows/todo-deploy.md → { frameworkId: "acme-flow", detection: { via: "path", ... } }
```

An incomplete descriptor aborts with `CustomAdapterError` listing **every** missing
required part at once. An `id` that shadows a built-in is rejected by default; set
`shadowBuiltInId: true` to opt in — the custom row then replaces the built-in row in the
enabled pool. Custom identities flow through `FrameworkIdentity`; 002's `FrameworkId`
union itself is unchanged (research R5).

## Agent-hook scaffolds

`agentHookScaffold(frameworkId, binName)` returns a pure
`{ directory, fileName, contents }` record for feature 010 to persist — it writes nothing
itself. `kiro` yields `.kiro/hooks/<binName>-sync.json`, `generic` yields
`.task-linear-sync/hooks/<binName>-sync.json`; both are JSON records whose `command`
action runs `<binName> enqueue`. Frameworks without a template return `undefined`.
