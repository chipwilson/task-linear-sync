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
| `spec-kitty` | `kitty-specs/` | path beneath `kitty-specs/` (no sibling requirement) | immediate parent dir beneath `kitty-specs/` (the mission) | from config `siblingDocuments` (`spec.md`, `plan.md`, `research.md`) | — |
| `generic` | from config `specsBaseDirectories` | none — detection matches nothing | parent dir beneath a configured base, else absent | from config `siblingDocuments` | `.task-linear-sync/hooks/` · `command-json` |

Notes:

- `generic` carries **no framework-specific exclusions** (`frameworkSpecificExclusions: []`,
  FR-010): when it is selected, downstream features must read that empty set rather than any
  framework's list.
- `spec-kitty` excludes `kitty-specs/*/tasks/` — the directory of generated per-work-package
  agent prompts. A whole-segment `*` in an exclusion entry means "exactly one path segment"
  (017 amendment 3), the match is repository-root-relative, and a matching **directory** skips
  its whole subtree. Disabling the adapter removes the exclusion again (FR-011).
- Base directories are **discovery hints**, not selection markers. `docs/` is a `bmad` base
  directory, but a `docs/**` task file with no bmad markers resolves to `generic` — directory
  names are generic discovery defaults, never routing values (001 R7.8).
- `spec-kitty`'s two extra grammar members follow the same override lanes as every other
  convention — `overrides.adapters["spec-kitty"]` (deep-merged, arrays replace) beats the
  built-in row — but neither has a config-file key, so `adapter.<member> ?? built-in default`
  is the whole resolution (017 C5.1). Their defaults stay inert for the other five rows,
  which parse exactly as before (017 C5.3).
- Grammar fields (`headingGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern`,
  `titleBehavior.stripPrefixes`, plus the optional `checklistIdPattern` and `titleTagPattern`
  of 017 amendment 2) are regex-source strings consumed downstream (004/005). Only
  `spec-kitty` declares the two new members; the rest inherit the built-in defaults.
  003 never parses task content.
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
