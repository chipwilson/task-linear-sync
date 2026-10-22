# Implementation Plan: Task Parsing and In-Place Line Rendering

**Branch**: `004-task-parsing-line-rendering` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-task-parsing-line-rendering/spec.md`

## Summary

Wave-2 feature owning 001 group B (FR-007–019, source R2/R3): a **pure function over file
content plus adapter conventions** that (a) extracts heading and checklist tasks from a
discovered task file with faithful structure — 1-based line numbers, indent-stack nesting,
phase labels, `Task_Body` extents, local task IDs, visible `[<KEY>-<N>]` issue references,
`Feature_Name` via the active adapter, exclusion records, duplicate-identity warnings,
conflict-block flags — and (b) rewrites assigned task lines back into the content
byte-respectfully (bottom-to-top, trailing-newline and untouched-line byte identity,
conflict blocks frozen, structural surprises abort with a file-path + line-number error
and zero modification).

Parallel-safety posture (ROADMAP Wave 2 rule): this feature codes **only against the 003
adapter *interface*** — a consumer-owned structural view of the interface frozen in
`specs/002-core-domain-contracts/data-model.md` § 3 — and uses a built-in-`generic`-style
**fixture adapter in its own test helpers** as its development fixture. It never imports
003 internals and never waits for 003 to land. It implements the `Stable_UUID` computation
contract frozen by 002 research R11 ("004 computes, 002 freezes"), consuming the frozen
`taskStableSeed` from `src/domain/task.ts`. Everything lives in the disjoint module
`src/parsing/` (the module 002's plan already assigns to this feature); the frozen 002
contract surface is consumed verbatim, not redefined.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`
per exported module; Node.js ≥ 20.0.0 engine constraint (constitution "Technology stack")

**Primary Dependencies**: None at runtime — Node built-ins only (`node:crypto` for the
R11 UUID digest; no fs/network needed because parsing and rendering are pure functions over
strings). Compile-time-only consumption of the frozen 002 modules `task-linear-sync/domain`
(`Task`, `TaskFile`, `FrameworkId`, `TaskBodyExtent`, `IssueRef`, `taskStableSeed`) and
`task-linear-sync/config` (`ResolvedConfig` grammar group); the adapter surface is the
consumer-owned interface per research R1.

**Storage**: N/A for this feature — zero file writes by construction. Parsing takes file
content strings in; rendering returns new content strings out. Actual file mutation,
backup, and journaling belong to the 008 engine behind the safety gates (constitution I).

**Testing**: `node:test` + `node:assert/strict` (same tiers as 002): unit tests over the
pure parser/renderer, contract tests against the 004-local behavioral contracts
(parsing-api, line-rendering, adapter-consumption) using the `generic` fixture adapter,
golden-file corpus tests for byte preservation, property tests for parse→render→parse
round-trips (constitution IV) and exclusion/freeze invariants. Zero network, zero
wall-clock (no clock is used at all), hermetic fixtures with placeholder identities only.

**Target Platform**: Node.js ≥ 20 (Linux, macOS, Windows); consumed in-repo as the
`task-linear-sync/parsing` subpath export by 005/008/009 (and 010's hook payload later).

**Project Type**: Single npm package (constitution "Technology stack") — this feature adds
the `src/parsing/` module and one additive `./parsing` entry in the `exports` map; no other
structural change.

**Performance Goals**: Parsing is a single linear scan plus a second pass for extents/nesting:
≥ 50k lines/sec for realistic task files (a 10k-line file parses in < 200 ms); rendering is
O(lines + assignments) with bottom-to-top application — no quadratic re-parsing.

**Constraints**: Zero runtime dependencies; zero new configuration keys (frozen
`ResolvedConfig` grammar group — `headingIdGrammar`, `phasePattern`, `summaryPattern`,
`rollupPattern`, `flatChecklistMarkers`, `tabWidth`, `confirmationKey`,
`titleStripPrefixes` — covers every knob; adding a config key would be a 002 amendment,
out of scope); zero organization-specific literals in fixtures/defaults (release scan);
frozen 002 contracts consumed, never edited (ROADMAP rule 2); byte-for-byte preservation
outside assigned lines is a hard acceptance gate (SC-002).

**Scale/Scope**: 13 FRs (001 FR-007–019); 2 user stories; fixture corpus covering the five
framework identifiers (`bmad`, `spec-kit`, `open-spec`, `kiro`, `generic`) via interface
fixtures (research R10); ~9 source modules, ~10 test files; provides attributes to 005,
frozen-conflict blocks + sections to 008, and rendered-diff expectations to 009.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Parsing and rendering are pure string→value / (string, assignments)→string functions: **zero writes, zero tracker access, zero mutation by construction**, so no gate can be bypassed from here. The only file-write consumer is 008's gated apply path; this feature never exposes a write function. Abort semantics guarantee "leave the file unmodified" trivially (no I/O to leave behind). | PASS |
| II. Durable Identity | This feature **computes** `Stable_UUID` exactly per 002 research R11 over the frozen `taskStableSeed` (seed excludes title, checkbox state, visible issue prefix — property-tested here too). The UUID is **never rendered into file content**; rendering preserves only the visible local task ID and issue reference. | PASS |
| III. Intelligent Defaults, Overridable Configuration | Every convention consumed comes from merged `ResolvedConfig` (already default-merged by 002) or from the adapter's overridable regex sources (002 data-model § 3); no new required configuration and no new config keys. Fixture adapters use generic placeholder conventions only. | PASS |
| IV. Determinism and Idempotency | Parsing is a deterministic single forward scan (no Maps iteration-order dependence, no clock). Rendering is deterministic bottom-to-top. The rendering round-trip rule is enforced here: parse → clean title → render → parse yields an identical title with **no progressive prefixing** (property test), because the issue reference is always re-emitted from the parsed reference and the title is stripped of redundant prefixes first. | PASS |
| V. One Engine, Additive Surfaces | No user-facing surface is added; `src/parsing` is a library module the engine (008) calls. No gating, locking, or screening path exists here to diverge. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR-001…FR-013 and SC-001…SC-003 maps to at least one automated test in quickstart.md's traceability table; tests are written before implementation per story; property-based and contract tests are included as required cross-cutting types; golden files make byte identity mechanical. | PASS |
| Additional constraints | Node built-ins only (`node:crypto`); ESM + per-module declarations via the existing build; no credentials involved; no Linear access; no org literals (fixtures use `SYNC` confirmation key and `example` placeholders). | PASS |
| Development workflow / quality gates | Uses the existing pipeline (`lint`, `typecheck`, `build`, tiered `node:test` + coverage gate); adds only fixtures and test files — hermetic by construction. | PASS |

**Pre-research gate result: PASS — no violations; Complexity Tracking unused.**

## Project Structure

### Documentation (this feature)

```text
specs/004-task-parsing-line-rendering/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/                                     # 002 frozen modules — read-only for this feature
├── domain/task.ts                       # consumed: Task, TaskFile, TaskBodyExtent, IssueRef,
│                                        #   FrameworkId, TaskKind, taskStableSeed  (FROZEN)
└── config/schema.ts                     # consumed: ResolvedConfig grammar group keys (FROZEN)

src/parsing/                             # ← this feature's disjoint module (assigned by 002 plan)
├── index.ts                             # public surface for the ./parsing subpath export
├── adapter.ts                           # consumer-owned structural adapter interface
│                                        #   (TaskFileAdapter — subset of frozen 002 § 3;
│                                        #    never imports 003)
├── content.ts                           # line model: terminator-preserving split, tab
│                                        #   normalization (tabWidth), indent depth, fenced-block
│                                        #   map (``` and ~~~ fences)
├── extract.ts                           # heading/checklist recognition via grammar named
│                                        #   groups, phase tracking, summary/rollup exclusion,
│                                        #   flat-document mode, indent-stack nesting + orphans
├── extent.ts                            # Task_Body extent derivation (next task / equal-or-
│                                        #   shallower heading, descendants included)
├── conflict.ts                          # git-style conflict-block detection; conflict-block
│                                        #   freeze set for the renderer
├── identity.ts                          # Stable_UUID computation (R11 digest over the frozen
│                                        #   taskStableSeed; toolId-derived namespace prefix)
├── warnings.ts                          # duplicate local-ID / duplicate issue-ref warnings
│                                        #   (shared value + all 1-based lines)
├── taskfile.ts                          # parseTaskFile() orchestrator → ParseResult
│                                        #   (TaskFile + exclusions + warnings)
├── title.ts                             # title cleaning: strip prefixes, redundant issue
│                                        #   prefixes, duplicate leading local-ID prefixes
└── render.ts                            # renderTaskLines(): validate-all-then-apply,
                                         #   bottom-to-top, byte preservation, LineRenderError

tests/
├── helpers/parsing-fixtures.ts          # generic-style fixture adapter(s) + corpus loaders
│                                        #   (the 003-interface test fixture — NOT 003 code)
├── fixtures/parsing/                    # fixture task files: nested checklists, fenced
│   │                                    #   pseudo-tasks, summary/rollup, flat docs, dup IDs,
│   │                                    #   conflict blocks, structurally-broken render file,
│   │                                    #   five-framework corpus
│   └── golden/                          # golden rewritten files for byte-identity diffs
├── unit/                                # parsing-content / parsing-extract / parsing-extent /
│                                        #   parsing-conflict / parsing-identity / parsing-title /
│                                        #   parsing-render-line
├── contract/                            # parsing-surface snapshot; adapter-fixture conformance
│                                        #   to the consumption contract; golden-corpus runner
├── integration/                         # parse→render→parse round-trip suite; five-framework
│                                        #   corpus extraction ("parsing" in test names)
└── types/                               # negative type tests (no write/fs surface exported)
```

**Structure Decision**: Single npm package. `src/parsing/` is disjoint from 003
(`src/discovery`/adapters), 005 (`src/routing`), 006 (`src/matching`), and 007
(`src/tracker`) per ROADMAP Wave 2; the only shared-file touch is **one additive `exports`
entry** (`./parsing`) in `package.json` and the corresponding re-export — no frozen module,
no `.specify/`, no other `specs/NNN` path is touched. Imports of 002 go through the
declared `task-linear-sync/domain` and `task-linear-sync/config` subpath exports. 003's
adapter is consumed exclusively through the consumer-owned structural interface in
`src/parsing/adapter.ts` (research R1) — when 003 lands, its adapters satisfy this
interface structurally with zero changes in `src/parsing/`, and a Wave-3 integration test
swaps the fixture for the real `generic` adapter.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
All gates above still PASS. The design adds no dependencies, no I/O, no new configuration
keys, and no writes; the 004-local contracts define only parsing/rendering behavior and the
adapter-consumption boundary, citing 002's frozen entities without redefining any field;
the `Stable_UUID` computation implements the frozen R11 shape verbatim; every SC and FR is
test-mapped. Re-check result: **PASS**.
