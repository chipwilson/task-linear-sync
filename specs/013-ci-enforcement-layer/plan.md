# Implementation Plan: CI/CD Enforcement Layer

**Branch**: `013-ci-enforcement-layer` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-ci-enforcement-layer/spec.md`

## Summary

This Wave-4 feature ships the constitution's `CI_Enforcement_Action`: a distributable
GitHub Action (`action.yml` at repo root) plus a wrapper module group (`src/ci/`) that
invokes the **published read-only CLI** (`task-linear-sync check`, secondarily `plan`) and
gates a pull-request build on three independently toggleable violation conditions evaluated
**solely from the sanitized plan-report JSON artifact** — (a) high-confidence tasks with no
issue mapping exceeding a threshold (default 0), (b) tasks carrying unresolved conflict
blocks on a run targeting a protected branch (default: the pull-request base branch), (c)
spec-vs-tracker drift (matched tasks classified `spec-changed`/`both-changed`, or with
pending changed fields or expected Markdown changes) exceeding a threshold (default 0).
Headline plan decisions (research.md): a **composite** `action.yml` (`runs.using: composite`,
Node 20 via the runner's pre-installed `node`, research R1); a wrapper at `src/ci/` behind
one additive `./ci` subpath export with **zero new runtime dependencies** (research R2); an
injectable `CliInvoker` child-process seam so unit tests feed fixture report JSONs directly
and e2e tests spawn the real built CLI over fixture worlds with the fake tracker (research
R3); disabled conditions never fail, any trigger fails non-zero with a screened
human-readable summary naming each failed condition and its count, and a missing/malformed
report JSON is a configuration/input error naming the artifact — never a silent pass
(research R4–R9). The layer performs zero tracker mutations and zero repository writes; no
apply/mutate path exists anywhere in `src/ci/`, proven by a hygiene contract scan
mirroring `tests/contract/engine-no-direct-tracker.test.ts` (research R12).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`
per exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 / constitution
"Technology stack"). No toolchain changes. Node 20 APIs only: `node:child_process`
`spawn` (no shell), `node:fs` `readFileSync`/`existsSync`/`appendFileSync`,
`node:process`, `node:path` — no `fs.globSync`, no `crypto.hash`, no `--experimental`
flags (research R11).

**Primary Dependencies**: **None added at runtime** — `package.json` gains exactly one
additive `exports` entry (`"./ci"`); the `bin` map and every dependency set stay untouched
(research R2; precedent `tests/contract/cli-dependency-budget.test.ts`, which 013
re-asserts rather than edits). The module group imports only Node built-ins plus local
modules: `src/config` (frozen `loadConfig` for the screener's config bag), `src/engine`
(`createDefaultSecurityScreener` — screening only, never engine execution), `src/ports`
(`SecurityScreener` type), and the frozen report vocabulary as **types/shape only** (no
import of `src/engine` execution functions, no `src/gates` gating logic, no
`src/tracker`/`src/cli` reach-around — the CLI is invoked as a child process, research
R3/R12).

**Storage**: **None.** The layer stores nothing (spec Key Entities): reads exactly one
artifact file — the plan-report `report.json` produced by the CLI under the state dir —
plus the CLI's `CheckSummary` stdout as the artifact **locator** only. The single allowed
write is the env-gated append of `name=value` output lines to `$GITHUB_OUTPUT` (a CI
protocol file outside the workspace, research R9). Zero writes inside the workspace —
proven by `hashTree` equality in e2e tests.

**Testing**: `node:test` + `node:assert/strict`, existing tiers (`unit`, `contract`,
`integration`, `e2e`) via `scripts/run-tests.mjs`; tests-first per constitution VI. Unit:
per-condition predicates + toggle/threshold matrix + all-three-at-once + malformed/missing
artifact errors + settings validation (complete listing) + summary screening. Contract:
`action.yml` shape parsed directly vs `contracts/action.md` (inputs, outputs, defaults —
zero org identifiers), packaging + dependency budget re-assertion, `src/ci` hygiene scan
(no engine/gates/tracker/fs-write imports beyond the report read + CLI spawn + gated
`$GITHUB_OUTPUT` append). Integration/e2e: spawned wrapper entry over a spawned **real
built CLI** (`node dist/cli/main.js`, fake tracker injected behind a `writeCliEntry`
driver per the 009 `writeDriver` pattern) across fixture worlds — pass / each-condition
fail / toggle-off / branch-classification matrix / malformed-artifact / screened-summary
leak checks / workspace-tree hash invariance. Deterministic, injected `Clock` in driver
worlds, hermetic temp state dirs **outside** the repo working tree, placeholder
identifiers only.

**Target Platform**: GitHub Actions on standard GitHub-hosted runners (`ubuntu-latest`
baseline) checking out this repository; `action.yml` at repo root with
`runs.using: composite`, invoking `node <action-root>/dist/ci/main.js` (auto-building the
package inside the action dir when `dist/` is absent). The same wrapper runs standalone as
`node dist/ci/main.js` in any CI system (research R1/R9). Node 20 runtime; Node 24
inherits automatically.

**Project Type**: Single npm package (existing); this feature owns the disjoint `src/ci/`
module group, `action.yml`, and its tests/fixtures/docs. No frozen 002 module and no
Wave-2/3/4 module is edited (ROADMAP rule 2, constitution V); 013 imports them and spawns
the published CLI.

**Performance Goals**: enforcement step adds < 30 s to a pipeline beyond the wrapped
`check` run itself (one CLI spawn, one artifact read, pure evaluation); evaluation over a
10k-entry report is O(entries) single pass. No polling, no timers.

**Constraints**: constitution I (read-only: zero mutations, zero repo writes), V (wraps
the published CLI, never engine logic; no apply/mutate mode — structurally unreachable,
hygiene-proven), III (every action input has a generic default; zero org identifiers in
defaults/action.yml/docs), VI (test-first, every acceptance criterion automated), Node 20
API ceiling, zero new runtime dependencies, coverage gate lines 80 / branches 70 /
functions 80 held by 013's own tests.

**Scale/Scope**: ~7 new source modules (`src/ci/`), 1 `action.yml`, ~4 contract tests,
~4 unit-test files, 2–3 integration/e2e files, 1 harness helper, fixture report JSONs +
one CLI world reused from 009/008 fixture worlds. Smallest Wave-4 feature (3 FRs).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | PASS | Read-only surface: spawns only the read-only `check`/`plan` commands; zero `LinearPort` reach (hygiene scan forbids all tracker/engine-exec imports); zero workspace writes (`hashTree` invariance e2e; `node:fs` restricted to the two report reads + env-gated `$GITHUB_OUTPUT` append outside the workspace); all emitted text screened (research R8). |
| II. Durable Identity | PASS (n/a) | No identity derivation; consumes durable ids (`planId`, `taskUuid`) opaquely from the report. |
| III. Intelligent Defaults | PASS | Every action input has a generic default (toggles `true`, thresholds `0`, workspace from `github.workspace`, protected branch from the PR base as reported by the CI env); defaults/action.yml/docs carry zero org identifiers, tokens, or UUID values (contract scan, research R10). |
| IV. Determinism | PASS | Pure function of (report JSON, settings, env view); no clock reads, no randomness, no retries; identical input reports ⇒ identical outcome and byte-identical summary lines. |
| V. One Engine, Additive Surfaces | PASS | The action wraps the published read-only CLI (constitution's own CI clause), consumes the frozen report JSON, computes no gating/matching/classification of its own; strictly additive (`./ci` export + `action.yml`); no apply/mutate mode exists (research R3/R12 scan). |
| VI. Test-First (NON-NEGOTIABLE) | PASS | Every FR/SC/acceptance scenario maps to at least one automated test (quickstart traceability table); tests written first and failing per phase; contract + security (hygiene/defaults/leak) tiers mandated. |
| Additional constraint — Technology stack | PASS | ESM + `.d.ts`, zero new deps, Node ≥ 20; CI action ships as `action.yml` + wrapper invoking the published CLI — exactly the constitution's sentence. |
| Additional constraint — Credentials | PASS | The action defines **no credential input**; the CLI reads credentials from its configured env-var names inherited through the spawn; wrapper never logs env values and screened output cannot carry them (research R8; leak e2e). |
| Documentation duty | PASS | `docs/ci-enforcement.md` + README + workflow usage example land in the same change (Polish phase tasks). |

**Gate result: PASS — no violations, no Complexity Tracking entries.** Re-checked after
Phase 1 design: contracts/ pin the input/output surface with defaulted-generic values; the
hygiene contract task (ci-hygiene scan) operationalizes principles I/V in CI.

## Project Structure

### Documentation (this feature)

```text
specs/013-ci-enforcement-layer/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (decisions R1–R12)
├── data-model.md        # Phase 1 output (settings, outcome, taxonomy, consumed shapes)
├── quickstart.md        # Phase 1 output (validation scenarios + FR/SC traceability)
├── contracts/           # Phase 1 output
│   ├── README.md
│   ├── action.md        # action.yml inputs/outputs/env contract (013's public surface)
│   └── wrapper-api.md   # runEnforcement seam, CliInvoker, exit map, output formats
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
action.yml                      # CI_Enforcement_Action (composite, research R1)
src/ci/                         # 013's disjoint module group
├── index.ts                    # public barrel (./ci export)
├── settings.ts                 # raw inputs → validated EnforcementSettings (complete listing)
├── evaluate.ts                 # PURE: parsed report + settings → counts + triggered conditions
├── report-input.ts             # artifact load + structural validation + locator parsing (check/plan stdout)
├── cli-invoker.ts              # CliInvoker seam + default spawn implementation (no shell)
├── summary.ts                  # screened human-readable summary lines
├── enforcement.ts              # orchestration: acquire artifact → evaluate → outcome
├── errors.ts                   # CiConfigError / CiArtifactError / CiCliFailureError + exit map
└── main.ts                     # process adapter: env/argv → settings → run → print → $GITHUB_OUTPUT → exit

tests/
├── unit/ci-{settings,evaluate,report-input,summary}.test.ts
├── contract/ci-{action-shape,hygiene,packaging,defaults-scan}.test.ts
├── integration/ci-enforcement-conditions.test.ts
├── e2e/ci-enforcement-action.test.ts
├── helpers/ci-harness.ts
└── fixtures/ci/{reports/*.json,worlds/…(reuse),README.md}

docs/ci-enforcement.md          # docs duty (inputs table, conditions, workflow example)
README.md                       # status + export-list updates
```

**Structure Decision**: one new disjoint module group `src/ci/` (constitution V additive
surface; no frozen/Wave-2/3 module touched), one additive `package.json` `exports` entry,
and the constitution-mandated `action.yml` at the repository root. The action is a thin
YAML shell: all behavior lives in `src/ci/`, compiled to `dist/ci/` by the existing tsc
build, so the wrapper is testable in-process (unit/integration) and as a real spawned
process (e2e) from the same code.

## Complexity Tracking

> No violations — section intentionally empty.
