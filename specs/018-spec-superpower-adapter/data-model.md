# Phase 1 Data Model: Spec Superpowers Adapter

**Feature**: `018-spec-superpower-adapter` | Consumes `research.md` (R1–R12)

No new persisted entities. The feature adds one row to the adapter table and small
additive shapes in discovery/parsing. Spec Key Entities map to existing records as shown;
every field below cites the requirement that governs it.

## 1. Entity mapping (spec Key Entities → records)

| Spec entity | Record | Owner |
|---|---|---|
| Implementation plan | `DiscoveredFile` / `TaskFile` (one per dated plan file) | 003/004 (unchanged shapes) |
| Plan task | `Task` with `kind: "heading"`, `localTaskId: "Task N"` | 002 frozen `Task` (unchanged shape) |
| Step | Content lines inside `Task.taskBody`; each checkbox additionally appears in `ParseResult.exclusions` | 004 `ExclusionRecord` (existing kinds) |
| Preamble | Headings/lines matching no task grammar — structure only, in neither `tasks` nor any body | 004 `extract.ts` (no grammar match ⇒ non-task) |
| Plans registry | The configured plans-root directory tree; not a record | config + discovery |

## 2. New/changed shapes

### 2.1 `FrameworkId` union — `src/domain/task.ts` (frozen amendment, R1)

```ts
export type FrameworkId = "bmad" | "spec-kit" | "open-spec" | "kiro" | "spec-superpower" | "generic";
```

Mirrored in lockstep (enforced by `framework-support-consistency.test.ts`):
`BUILT_IN_FRAMEWORK_IDS`, `builtInAdapters` keys, `frameworkAdapters` default enabled set,
`specs/requirements.md` glossary `Supported_Framework` + `Framework_Id`, README table.

### 2.2 Conventions row — `src/discovery/adapters/spec-superpower.ts` (defaults layer)

| Field | Default | Governs |
|---|---|---|
| `id` | `"spec-superpower"` | FR-001 |
| `taskFilePatterns` | `["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"]` | FR-002, FR-011 |
| `baseDirectories` | `["docs/superpowers/plans/"]` | FR-002 |
| `detection` | `{ pathPrefixes: ["docs/superpowers/plans/"] }` — beneath-any-depth; **no** siblings; a file elsewhere is never claimed by this rule | FR-002, US1-AC4 |
| `featureNameRule` | `{ kind: "date-stripped-basename" }` (§2.3) | FR-003, SC-003 |
| `headingGrammar` | `^\s{0,3}#{2,4}\s+(?<id>Task\s+[0-9]+)\s*:\s*(?<title>.+)$` | FR-004 |
| `rollupPattern` | `^\s*[-*+]\s*\[[ xX]\]` (step capture, R3) | FR-005 |
| `phasePattern` / `summaryPattern` | built-in defaults (harmless: phase headings stay organizers; `## Summary` style sections already excluded) | FR-006 (adjacent) |
| `titleBehavior` | `{ stripPrefixes: [...builtInDefaults.titleStripPrefixes] }` | — |
| `siblingDocuments` | `[]` — plans carry no spec-sibling markers | FR-002 |
| `identityFileScope` | `true` (§2.4) | FR-010 |
| `agentHooksDirectory` / `agentHookTemplate` | absent / `"none"` — refusal path unchanged | FR-012 |
| `frameworkSpecificExclusions` | `[]` (step containment is grammar-driven, not an exclusion list) | FR-011 |

Row is `deepFreeze`d like every other row; all fields overridable through the existing
three-layer merge (research R8) — no new `ResolvedConfig` keys.

### 2.3 `FeatureNameRule` union extension — `src/discovery/adapter.ts`

```ts
| { readonly kind: "date-stripped-basename" }
```

`applyFeatureNameRule`: basename → strip leading `NNNN-NN-NN-` (exactly that shape) →
strip final `.ext`. Never `undefined` for a claimed path (the pattern guarantees a
basename). Programmatic `featureName` override still wins (`resolveConventions`).
Examples: `docs/superpowers/plans/2026-11-09-auth.md → auth`;
`docs/superpowers/plans/notes.md → notes` (pattern-overridden team, R5).

### 2.4 Identity inputs (additive, R7)

`FrameworkAdapter` carries `readonly identityFileScope?: boolean`; `TaskFileAdapter` gains
the same optional, whitelisted member (amendment 3). Seed composition in `parseTaskFile`:

| `identityFileScope` | seed third component (task with local id) | Effect |
|---|---|---|
| absent / `false` (all current adapters) | `localTaskId` (byte-identical to today) | none (SC-005) |
| `true` (this row) | `` `${basename(relPath)}\u0000${localTaskId}` `` e.g. `2026-11-09-sync.md␀Task 1` | FR-010 distinct ids across same-name plans |

`taskStableSeed` itself is untouched; `Task.localTaskId` stays the bare `Task N`;
`FrameworkMetadata` fields unchanged. Seeds exclude titles/checkbox state/prefix as always
(Principle II).

### 2.5 Selection & fallback record flow (amendment 2)

`selectAdapter` return widens to `DetectionRecord | null` (null ⇔ unclaimed):

| Candidate situation | Result |
|---|---|
| Claims `spec-superpower` detection (beneath plans root + date glob) | `{ adapterId: "spec-superpower", via: "path", matchedPattern: "docs/superpowers/plans/" }` |
| Date-named file **outside** the plans root | **unclaimed (null)** — omitted from `DiscoveryResult.files` (US1-AC4) |
| `tasks.md` claimed by nothing | `generic` fallback as today (basename matches generic's patterns) |
| File matching only a custom descriptor's patterns, detection fails | unclaimed (documented narrowing, R6) |

`DEFAULT_PRECEDENCE` = `kiro → open-spec → spec-kit → bmad → spec-superpower → generic`
(single literal feeds README via the consistency suite).

## 3. Parse-model invariants for this format (validation rules)

For any file claimed by `spec-superpower` (`ParseResult` guarantees — each one an
automated test, Principle VI):

1. `tasks` = exactly the `Task N:` headings at levels 2–4; ids `Task 1 … Task N`;
   titles exclude the id span (FR-004, SC-002).
2. No task originates from a checkbox, preamble heading, or the document title (FR-005,
   FR-006, SC-002); every checkbox line ∈ `exclusions` (kind `checklist`, reason `rollup`).
3. Feature name = date-stripped basename (FR-003, SC-003).
4. Duplicate `Task N` ids within one file → `duplicate-local-id` parse warning; no silent
   collapse (FR-010; existing `collectDuplicateWarnings` path).
5. Plan without task headings → zero tasks, zero errors; checkboxes still excluded (edge
   case: informational diagnostic at most).
6. Empty task section → valid task, extent `startLine === endLine`, empty body (edge case).
7. Bodies mirror verbatim through screening; step edit ⇒ body drift, single-issue write on
   re-run; parse→render→parse reproduces the plan byte-for-byte apart from the visible
   reference prefix (FR-007, FR-008, SC-004).
8. Two plans, same stripped name, same `Task N` ids → pairwise-distinct `stableUuid`s
   (§2.4); in-place text edits change no uuid (FR-010, US3-AC3).
9. Renamed/re-dated file → new derived feature name and new file-scoped seeds ⇒ new
   feature (documented consequence, spec edge case).
10. Identity disabled in `frameworkAdapters` → glob absent from the traversal union;
    plans undiscovered by default (exact opt-out edge case).

## 4. Relationships

```text
plans root (configured directory)
 └── plan file (DiscoveredFile → TaskFile; featureName = date-stripped basename)
      ├── preamble (non-task headings + prose; excluded from all bodies)
      └── plan task (Task, kind=heading, localTaskId="Task N", title=component name)
           └── body extent (task line → next task / ≤-level heading)
                ├── steps (checkbox lines — exclusions + verbatim body content)
                ├── files / interfaces / commands / fenced code (verbatim body content)
                └── issue mirror (description = body span; completion = tracker-side)
```

Stable identity chain per task: `Stable_UUID = deriveStableUuid(spec-superpower ␀ <featureName> ␀ <basename>␀Task N, toolId)`
— anchor stored per constitution II (attachment metadata, never in-file).

## 5. State transitions

No new state machines. Task lifecycle for this identity is the existing heading-task
lifecycle (create → mirror → drift re-mirror → reconcile; completion states owned by the
tracker, FR-009). Step checkboxes have no lifecycle in the tool: `[ ]→[x]` in the plan is
ordinary content drift (§3 rule 7).
