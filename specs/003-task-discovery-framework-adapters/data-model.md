# Phase 1 Data Model: Task Discovery and Framework Adapters

**Feature**: `003-task-discovery-framework-adapters` | **Date**: 2026-10-22

003-local records only. This document **extends, never redefines**, the frozen 002 entities:
`TaskFile` / `Task` / `FrameworkId` / `FrameworkMetadata` (002 data-model §1–2, §8;
`contracts/task-model.md`) and `ResolvedConfig` (§17; `contracts/configuration.md`) stay exactly
as frozen. 003 produces the *pre-parse* discovery records below; 004 parses content and assembles
the frozen `TaskFile`/`Task` entities from them.

Relationship overview (003-owned records in **bold**):

```
DiscoveryOptions ──► DiscoveryResult 1 ── * DiscoveredFile ── 1 DetectionRecord ── * candidate ids
  │                       │                    │
  │ (ResolvedConfig,      │                    ├── frameworkId: FrameworkIdentity (R5; built-ins = frozen FrameworkId)
  │  frozen 002 type)     │                    ├── featureName?: adapter-derived (feeds frozen Task.featureName)
  │                       ├── 0..1 GitContext  └── siblingDocuments: existing configured docs (002 TaskFile §2 rule)
  │                       ├── * Refusal ("escape", FR-003)
  │                       └── * DiscoveryDiagnostic (non-root, non-escape)
AdapterRegistry 1 ── * FrameworkAdapter (built-in table + custom descriptors + overrides merged)
AgentHookScaffold (declarative record; 010 writes)
```

## 1. DiscoveredFile (003-local; predecessor of frozen `TaskFile`)

One discovered regular task file. NOT the frozen `TaskFile` entity — it carries no `tasks[]`
(004 owns parsing); 004 populates `TaskFile.tasks`/`Task.*` and keeps `filePath`,
`frameworkId` (when built-in), `featureName`, `siblingDocuments` byte-identical to this record.

| Field | Type | Rules |
|---|---|---|
| `filePath` | `string` | Root-relative POSIX (FR-004); unique within a result; sorted lexicographically |
| `frameworkId` | `FrameworkIdentity` (= frozen `FrameworkId` ∪ custom string, R5) | Selected per §4 detection; built-in adapters emit exactly `"bmad" \| "spec-kit" \| "open-spec" \| "kiro" \| "generic"` |
| `adapterId` | `string` | Winning adapter id (equals `frameworkId` for built-ins); distinguishes two custom adapters that shadow a built-in name in diagnostics |
| `featureName` | `string \| undefined` | Adapter-extracted per research R9; absent when underivable — never an error |
| `siblingDocuments` | `readonly string[]` | Root-relative POSIX paths of configured sibling docs that EXIST as regular non-symlink files in the same directory; absent siblings omitted without error (FR-005); order: the adapter's configured sibling list order |
| `detection` | `DetectionRecord` | How the identity was chosen (transparency for 006/008) |

Validation: `filePath` never absolute, never contains `..`, starts with canonical root (checked
pre-read, FR-003); `frameworkId` non-empty; `siblingDocuments` are distinct from `filePath`.

## 2. DiscoveryResult / DiscoveryOptions / DiscoveryRootError / Refusal / DiscoveryDiagnostic / GitContext

**`DiscoveryResult`** (all arrays deterministically ordered — SC-002 covers them too):

| Field | Type | Rules |
|---|---|---|
| `root` | `string` | Canonical absolute root (realpath-resolved, FR-001) |
| `files` | `readonly DiscoveredFile[]` | Sorted by byte-wise lexicographic compare of `filePath`; **empty array, no error, when nothing matches** (FR-004) |
| `refusals` | `readonly Refusal[]` | Escapes refused pre-read: `{ path: string; reason: "escape" }` (FR-003 edge case); no read performed |
| `diagnostics` | `readonly DiscoveryDiagnostic[]` | Non-root, non-escape partial failures: `{ path: string; condition: string }` (unreadable subdir, unparsable `.git` source) — traversal continues (R10) |
| `git` | `GitContext \| undefined` | Present unless `gitContext: false` requested (FR-006) |

**`DiscoveryOptions`**: `{ repositoryRoot: string; config: ResolvedConfig; overrides?:
DiscoveryOverrides; gitContext?: boolean }` — `config` is the frozen 002 merged config consumed
read-only; `overrides` is 003's programmatic layer (§5).

**`DiscoveryRootError`** (thrown, aborts with zero file reads — FR-002):
`{ condition: "missing" | "not-a-directory" | "unreadable"; requestedPath: string }` — the
message names the failing condition ("error naming the failing condition", FR-002).

**`GitContext`** (FR-006): `{ headCommit?: string; branch?: string; originRemote?: string }` —
each value omitted individually when its `.git` source is missing/unparsable; the others still
return; never throws for availability reasons (R6). `headCommit` = 40-hex-lowercase from HEAD or
resolved ref; `branch` = short ref name when HEAD is symbolic; `originRemote` =
`[remote "origin"] url` string verbatim.

## 3. FrameworkAdapter (interface — 003-owned, FROZEN for 004)

002 data-model §3 freezes the member list ("003 implements, 004 consumes the *interface*
only"): `id`, `taskFilePatterns`, `detect(taskFilePath, repoCtx)`, `featureName(taskFilePath)`,
`headingGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern`, `titleBehavior`,
`agentHooksDirectory?`. The full TS shape (superset members added for FR-007's convention
bundle: `baseDirectories`, `detection`, `siblingDocuments`, `agentHookTemplate`,
`frameworkSpecificExclusions`) is normative in
[contracts/framework-adapter.md](./contracts/framework-adapter.md) — single source, not
duplicated here. Field semantics:

| Member | Rules |
|---|---|
| `id: FrameworkIdentity` | Built-ins are the five frozen literals; custom = any non-empty string outside them (R5) |
| `taskFilePatterns` | Basename globs (R2); effective value after merge (R7) |
| `baseDirectories` | Repo-root-relative POSIX dir patterns; also discovery hints + rank material |
| `detection` | Declarative markers: `pathPrefixes?`, `pathContains?`, `siblingsAnyOf?`, `requirePathAndSiblings?` (spec-kit conjunctive rule, 001 R7.2) |
| `detect(candidate, ctx)` | Pure: returns `DetectionMatch` or `null`; rank material = `matchedPattern` |
| `featureName(relPath)` | Declarative kind (`parent-dir` \| `parent-or-basename` \| `segment-after`) or programmatic override fn (R9) |
| `headingGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern` | Regex **sources** as strings — consumed by 004 (parse) and referenced here for convention override/merge; 003 never parses content |
| `titleBehavior.stripPrefixes` | Default title strip prefixes (FR-007); hook for 005 derivation |
| `siblingDocuments` | Per-adapter configured names (R9 table above) |
| `agentHooksDirectory?` | kiro `.kiro/hooks/`, generic `.task-linear-sync/hooks/` (001 Glossary), others absent |
| `agentHookTemplate` | `"kiro-json" \| "none"` (R11) |
| `frameworkSpecificExclusions` | MUST be `[]` for `generic` (FR-010: "no framework-specific exclusions beyond the global summary/rollup defaults") |

## 4. AdapterRegistry, DetectionRecord, selection algorithm

**`AdapterRegistry`** (created by `createAdapterRegistry(config, overrides?)`): enabled adapters
= `config.frameworkAdapters` (enabled set, inventory order — *not* precedence, R8) +
`overrides.customAdapters`; conventions resolved per R7 three-layer merge; validation gate:
custom descriptors missing any required part (`id`, path/base-directory patterns, heading
grammar) → `CustomAdapterError { adapterId, missing: string[] }` listing **every** miss at once
(002 fail-fast-and-complete precedent).

**Selection** (`selectAdapter(filePath, ctx, registry)` → `DetectionRecord | generic fallback`):

1. `overrides.selection` present → fixed id (must exist in registry, else typed error) or
   predicate result; detection skipped (FR-011 "override framework selection").
2. Collect `DetectionMatch`es from all enabled adapters.
3. Rank: longest `matchedPattern` (string length; siblings-only match contributes 0) → index in
   precedence list (built-in default `["kiro","open-spec","spec-kit","bmad","generic"]`,
   overridable via `overrides.precedence`) → alphabetical by id. (FR-008 verbatim: "MUST select
   by longest matching path/base-directory pattern, then configured precedence, then
   alphabetical tie-break")
4. Zero matches → `generic` (fallback marker in record).

**`DetectionRecord`**: `{ adapterId: string; matchedPattern: string; via: "explicit" | "path" |
"path+siblings" | "siblings" | "fallback"; candidates: readonly string[] }` — `candidates` sorted
alphabetically; deterministic for every input (Principle IV).

State transitions (selection decision flow, deterministic function of inputs):
`input(path,ctx) → explicit-selection | detected(rank-decision) | generic-fallback`; the flow has
no state between calls (pure per file).

## 5. AdapterConventions / AdapterOverrides / CustomAdapterDescriptor / DiscoveryOverrides

- **`AdapterConventions`** = the convention-bundle record = §3 fields minus `detect` (declarative
  subset). Built-in table = defaults layer; frozen config keys = file layer; per-adapter partials
  = programmatic layer (`deepMerge`, arrays replace wholesale — overriding `taskFilePatterns`
  yields exactly the new list, 002 research R3 semantics).
- **`CustomAdapterDescriptor`** — minimal shape per FR-011 verbatim: "a custom adapter
  configuration providing at least an id, path/base-directory patterns, and heading grammar".
  `{ id: string (non-empty, ∉ built-in ids by default; shadowing requires an explicit opt-in flag);
  taskFilePatterns: readonly string[] (≥1); baseDirectories?: readonly string[];
  detection?: as §3; headingGrammar: string (valid `RegExp` source — compiled at registration,
  invalid → `CustomAdapterError` naming the failing part); phasePattern?/summaryPattern?/
  rollupPattern? (defaults = global grammar); siblingDocuments? (defaults = config
  `siblingDocuments`); titleStripPrefixes?; agentHooksDirectory?; featureName extraction? }`
- **`DiscoveryOverrides`**: `{ selection?: FrameworkIdentity | ((ctx: DetectionContext) =>
  FrameworkIdentity \| undefined); precedence?: readonly string[]; adapters?:
  Readonly<Record<string, Partial<AdapterConventions>>>; customAdapters?: readonly
  CustomAdapterDescriptor[] }` — highest precedence layer; every convention in §3 overridable
  here (SC-004: "a fixture suite overrides each convention at least once").
- **`AgentHookScaffold`** (pure output of `agentHookScaffold(adapterId, { binName })`, R11):
  `{ directory: string; fileName: string; contents: string }` for `"kiro-json"` adapters
  (`command` action invoking `<binName> enqueue`; binName derives from `toolId` — zero org
  literals), or `undefined` when `agentHookTemplate: "none"`; 003 writes nothing (010 owns
  scaffolding).

## 6. Effective-convention merge precedence (summary of R7)

```
built-in adapter table  →  ResolvedConfig (frozen: frameworkAdapters, taskFilePatterns,
                             specsBaseDirectories, skipDirectories, siblingDocuments,
                             headingIdGrammar, phasePattern, summaryPattern, rollupPattern,
                             titleStripPrefixes, agentHooksDirectory)  →  DiscoveryOverrides
```
Deterministic for identical inputs; the merged record is the ONLY input any adapter behavior
reads (no ad-hoc fallbacks at use sites).

## Validation rules summary

- `DiscoveryRootError` before any traversal read; conditions exactly the three FR-002 states.
- Every returned/derived path: root-relative POSIX, forward slashes, no trailing separator.
- Escape guard: separator-bounded containment of `realpath(candidate)` in `realpath(root)`;
  checked before any open in 003 and re-checked by 004/008 via exported `verifyInsideRoot`.
- `DiscoveredFile.files` sort: byte-wise lexicographic — stable, total, machine-independent.
- Custom adapter registration: required parts (`id`, ≥1 path/base-directory pattern,
  compilable `headingGrammar`) complete or typed error with full `missing` list.
- Built-in defaults scan: adapter table, scaffold templates, and fixtures contain zero real
  organization identifiers/tokens/UUIDs (constitution III; release-gate scan posture).
