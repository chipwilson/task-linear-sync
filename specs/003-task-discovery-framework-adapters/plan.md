# Implementation Plan: Task Discovery and Framework Adapters

**Branch**: `003-task-discovery-framework-adapters` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-task-discovery-framework-adapters/spec.md`

## Summary

Wave-2 feature owning 001 group A (repository task discovery, 001 FR-001–006) and group D
(framework adapters, 001 FR-022–026). Delivers a self-contained `src/discovery/` module that
(a) finds every task file in a repository **safely and deterministically** — canonicalized
root, unlimited depth, skip-directories, symlink exclusion, refused-and-reported sandbox
escapes with zero reads outside the canonical root, root-relative POSIX paths in byte-identical
lexicographic order, empty-not-error results, and best-effort git context (HEAD commit, branch,
origin URL with individual omission) — and (b) ships the **framework-adapter layer**: the
`FrameworkAdapter` interface (frozen here as the seam 004 codes against), the five built-in
adapters (`bmad`, `spec-kit`, `open-spec`, `kiro`, `generic`) with the full convention bundle
(patterns, base directories, detection markers, `Feature_Name` extraction, heading/checklist
grammar, phase/summary/rollup patterns, sibling documents, default title strip prefixes,
agent-hook template behavior), deterministic marker-based detection precedence (kiro →
open-spec → spec-kit → bmad → generic fallback; ties by longest matching path/base-directory
pattern, then configured precedence, then alphabetical), and total overridability including
minimal consumer custom adapters (id, path/base-directory patterns, heading grammar). Pure
TypeScript/ESM, Node built-ins only, zero runtime dependencies; fully testable against the
frozen 002 contracts with filesystem fixtures — no parser (004), tracker (007), or engine (008)
required.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts` per
exported module; Node.js ≥ 20.0.0 engine constraint (constitution "Technology stack"; same
toolchain as 002's shipped `tsconfig.json` — no build changes needed)

**Primary Dependencies**: None at runtime — Node built-ins only (`node:fs/promises`,
`node:path`, `node:url`). Explicitly **no** `child_process` for git (file-based `.git` reads,
research R6) and **no** glob library (built-in basename/dir matcher, research R2). Consumes the
frozen 002 modules read-only: `src/domain` (`FrameworkId`, `FrameworkMetadata`),
`src/config` (`ResolvedConfig`, `deepMerge` discovery/grammar keys) — never redefined.

**Storage**: N/A — discovery is strictly read-only over the repository tree; the feature
persists nothing (no state-dir writes; results are in-memory records consumed by 004/006/008/010).

**Testing**: `node:test` + `node:assert/strict` against compiled output (002 precedent), tiers
`unit`/`contract`/`integration`/`e2e` via existing `scripts/run-tests.mjs`. Framework-layout
fixture repos committed under `tests/fixtures/repos/discovery/`; symlink-loop / escape /
unreadable-root fixtures built at test runtime (git does not transport symlinks or modes
reliably) via a helper. Permission-dependent assertions POSIX-conditional (002 quickstart
precedent). Zero network, zero wall-clock nondeterminism.

**Target Platform**: Node.js ≥ 20 CLI/library host (Linux, macOS, Windows) — this package's
`task-linear-sync/discovery` subpath, consumed by 004 (adapter interface + `generic` fixture),
006 (framework metadata for scoring), 008 (persist framework identity in synced state), and 010
(agent-hook template behavior for Kiro/generic defaults).

**Project Type**: Single npm package (library + shared core) — this feature adds one new,
disjoint module directory `src/discovery/` (per 002 plan.md's Wave-2 module list) plus one
additive `exports` key `./discovery` in `package.json`; no 002-owned file is touched.

**Performance Goals**: local-I/O-bound deterministic single-pass traversal — realistic monorepo
(≤ 100k entries) discovers in < 1 s with one `opendir` scan and one directory listing per
discovered file's directory (shared across detection + siblings); ordering sort is O(n log n)
on discovered paths.

**Constraints**: constitution v1.0.0 (gates, determinism, zero org literals, dependency
ceiling); frozen 002 contracts cited and never edited (ROADMAP rule 2); zero runtime
dependencies; Wave-2 disjointness (004–007 modules untouched); discovery performs zero writes
and zero tracker calls; the adapter interface frozen here is 004's compile-time dependency —
its contract test snapshot is as binding as 002's.

**Scale/Scope**: 5 built-in adapters + custom adapter support; 11 FRs, 4 SCs, 2 user stories;
~11 new `src/discovery/` files; ~9 new test files; fixture families for five framework layouts
plus adversarial sets (symlink loops, escaping links, unreadable/missing/non-directory roots,
empty repo, git variants).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Discovery is a read-only surface: zero tracker calls, zero file writes, zero state-dir involvement. Reads are structurally confined to the canonical root (skip-directories, symlink exclusion, pre-read inside-root verification refusing escapes — FR-001–003). Nothing is propagated to Linear/reports here, so the `Security_Screener` has nothing to screen; diagnostics carry only repository-relative paths and failing-condition labels — no credential values exist in this feature. | PASS |
| II. Durable Identity | 003 does not derive `Stable_UUID` (004 computes it), but it owns and records two seed inputs — `Framework_Id` and `Feature_Name` — exactly as the frozen seed layout expects, and produces the `FrameworkMetadata` fragment matching the frozen shape (008 persists it). No identity is stored in file content; discovery writes nothing. | PASS |
| III. Intelligent Defaults, Overridable Configuration | The built-in adapter table ships a default for every convention (FR-007); EVERY convention is overridable through the frozen config keys (discovery + grammar groups already exist in `ResolvedConfig`) plus the 003-local programmatic override layer, merged in the constitutional order "built-in defaults, then config file, then programmatic overrides" reusing 002 `deepMerge` semantics (arrays replace wholesale). Framework directory names (`.kiro/specs/`, `specs/`, `openspec/`, `bmad/`) are carried as the constitution's "generic discovery defaults, not routing defaults"; zero organization-specific literals in defaults, fixtures, or agent-hook templates. | PASS |
| IV. Determinism and Idempotency | Byte-for-byte identical, lexicographically ordered path lists across repeated runs (SC-002); adapter selection is a pure function of path + directory listing with a fully specified rank (longest pattern → precedence list → alphabetical); no wall-clock, no process.env reads, no `child_process`; git context read from `.git` files is deterministic per commit. | PASS |
| V. One Engine, Additive Surfaces | 003 is an internal module, not a user-facing surface; it adds no gating, locking, or screening path and no parallel implementation of any engine capability. It consumes only the frozen seams (`domain`, `config`) and provides its own published subpath for wave-3 composition. The single `exports`-map addition is additive (`./discovery`). | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR (001–011) and SC (001–004) maps to at least one automated test (quickstart traceability table); a contract snapshot freezes the `src/discovery` export surface so 004's compile dependency cannot drift silently; tests are hermetic (temp-tree adversarial fixtures, no network, POSIX-conditional permission cases). | PASS |
| Additional constraints | Node built-ins only — zero runtime deps; git metadata via file reads, not `git` CLI or a transport dep; no org-specific literals (constitution "No organization-specific literals" quoted in the adapter contract); ESM + per-module declarations via the existing `exports`/`types` packaging rules. | PASS |
| Development workflow / quality gates | Existing `Project_CICD_Pipeline` scripts (`build`, `typecheck`, `lint`, tiered `test`) run the new module with no pipeline changes; no secrets or network needed (hermetic). | PASS |

**Pre-research gate result: PASS — no constitution violations. One frozen-contract *shape*
deviation (custom-adapter identity vocabulary) is unavoidable given FR-011 and is justified in
Complexity Tracking + research R5; it edits no frozen file.**

## Project Structure

### Documentation (this feature)

```text
specs/003-task-discovery-framework-adapters/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── README.md                # index + amendment rule for 003-local contracts
│   ├── framework-adapter.md     # FrameworkAdapter interface (frozen seam for 004) + conventions/overrides
│   └── discovery-api.md         # discoverTaskFiles behavioral contract (FR-001–006)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/                                     # 002-owned modules untouched (domain, config, state, urls, gates, ports)

discovery/                     # ← THIS FEATURE ONLY (disjoint Wave-2 module)
├── index.ts                 # public barrel = ./discovery subpath export
├── types.ts                 # DiscoveryResult, DiscoveredFile, GitContext, Refusal, DiscoveryDiagnostic,
│                            #   DiscoveryRootError, FrameworkIdentity (+ isBuiltInFrameworkId)
├── adapter.ts               # FrameworkAdapter interface (FROZEN for 004), AdapterConventions,
│                            #   CustomAdapterDescriptor, DiscoveryOverrides, DetectionContext/Match
├── patterns.ts              # minimal basename/dir-name glob matcher (built-ins *, ?, [...])
├── root.ts                  # canonicalizeRepositoryRoot (FR-001/002 abort) + verifyInsideRoot guard (FR-003)
├── traverse.ts              # safe recursive walk: skip-directories, symlink exclusion, unlimited depth,
│                            #   escape refusals, regular-file + basename-pattern match
├── conventions.ts           # effective-convention resolution: built-in table ← frozen config keys ←
│                            #   programmatic overrides (deepMerge); custom-adapter validation
├── registry.ts              # enabled adapters from config.frameworkAdapters + custom adapters;
│                            #   selection engine: explicit override → detection rank → generic fallback
├── discover.ts              # discoverTaskFiles(): root → traverse → select adapter → featureName →
│                            #   sibling docs → git context → sorted DiscoveryResult
├── git.ts                   # file-based VCS context (.git/HEAD, loose refs, packed-refs, config; FR-006)
├── agent-hooks.ts           # agent-hook template behavior (kiro-json scaffold record for 010)
└── adapters/
    ├── kiro.ts              # .kiro/specs/ base, feature = parent dir, .kiro/hooks/ scaffold
    ├── open-spec.ts         # openspec/ + open-spec/, markers openspec.json/proposal.md
    ├── spec-kit.ts          # specs/ + spec/ AND sibling spec.md/plan.md (conjunctive detection)
    ├── bmad.ts              # bmad/, bmad-method/, docs/; siblings prd.md/architecture.md
    └── generic.ts           # fallback; NO framework-specific exclusions (FR-010)

tests/                       # new files only; no 002-owned test edited
├── unit/                    # discovery-patterns, discovery-root, discovery-traverse, discovery-git,
│                            #   discovery-selection, discovery-adapters-builtin, discovery-overrides
├── contract/                # discovery-surface.test.ts (export-surface snapshot = 004's drift guard)
├── integration/             # discovery.test.ts (path sets/order/aborts/escapes/determinism),
│                            #   discovery-adapters.test.ts (SC-001 identity + siblings)
├── e2e/                     # discovery-user-stories.test.ts walkthrough
├── helpers/                 # discovery-fixtures.ts (runtime temp trees: symlink loops/escapes/chmod)
└── fixtures/repos/discovery/  # five-framework layout repos + git-context fixtures (regular files only)
```

**Structure Decision**: 003 lives in exactly one new module directory, `src/discovery/` — the
name 002's plan.md pre-commits for this feature in its Wave-2 module list ("Wave-2+ features
add sibling modules (`src/discovery`, `src/parsing`, …)"). It is disjoint from 004–007 modules
(`parsing`, `routing`, `matching`, `tracker`), imports 002 only through the frozen modules, and
publishes one additive `exports` key `"./discovery"` (types-first condition, matching
`tests/contract/package-surface.test.ts` expectations). 004 imports the `FrameworkAdapter`
interface from `task-linear-sync/discovery` and uses the built-in `generic` adapter as its
fixture — never discovery internals. Adapter implementations live in the `src/discovery/adapters/`
subdirectory so the frozen interface file (`adapter.ts`) stays the single seam 004 sees.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 003-local `FrameworkIdentity = FrameworkId \| (string & Record<never, never>)` widens the identity vocabulary for adapter ids / discovery records beyond the 5-value union (002 data-model §3 shows adapter `id: FrameworkId`) | FR-011 (001 FR-026) requires consumer custom adapters supplying "at least an id, path/base-directory patterns, and heading grammar" — a sixth id like `my-flow` is mandatory behavior. §3 also states "003 implements, 004 consumes the *interface* only", so the interface definition is 003's to freeze. | Restricting adapters to the five frozen ids — rejected: directly contradicts FR-011 and SC-004; editing 002's `FrameworkId` union or `FrameworkMetadata` — rejected: ROADMAP rule 2, amendments only and out of scope here. Resolution (research R5): built-in flows stay 100% inside the frozen union; the widened type is 003-local, and a type-level `FrameworkId` widening is recorded as an amendment candidate noted against 001. |

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**: All
gates above still PASS. The design adds no runtime dependencies, performs zero writes and zero
tracker calls, keeps every default overridable through frozen-config keys plus the programmatic
layer, introduces no new config keys in `ResolvedConfig` (frozen), and the contract set matches
the spec's owned behavior (discovery traversal/safety + adapter conventions) without extending
any 002 frozen surface. The single Complexity Tracking entry is unchanged and bounded to a
003-local type alias. Re-check result: **PASS**.
