# Implementation Plan: Operator CLI and Plan Review Report

**Branch**: `wave-4-surfaces` (feature directory `009-operator-cli-plan-report`) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-operator-cli-plan-report/spec.md`

## Summary

The human-facing control plane: the twelve operator commands (`inventory`,
`discover-metadata`, `plan`, `bootstrap`, `sync`, `check`, `install-hooks`,
`install-agent-hook`, `enqueue`, `worker`, `last-run`, `rollback`) behind one
`task-linear-sync` bin with a strict, documented exit-status contract, plus the
sanitized plan review report — the paired JSON (durable ids, frozen 002 schema) +
Markdown (human names) that is the approval artifact and 013's sole machine input.
Headline plan decisions: **zero new runtime dependencies and zero edits to any frozen
or prior-wave module** — 009 is a new disjoint `src/cli/` module group plus one additive
`package.json` `bin` entry and one additive `./cli` subpath export (research R1). The CLI
is a pure, importable core (argv parsing, exit mapping, command handlers over an injected
`CliContext`) with a thin child-process `main.ts` bin shim (research R2). **No report
renderer is forked**: `buildSyncPlan` stage 7 already persists the plan and writes the
frozen-schema report pair through `src/engine/report.ts`; 009's review half is the
command lane, the CLI-side read-only mutation guard, and the contract/integration
enforcement of the full FR-006/007/008 field set and exclusions (research R4). The five
010-bound commands (`install-hooks`, `install-agent-hook`, `enqueue`, `worker`,
`last-run`) route through one injectable `QueueSurface` delegate seam — 009 owns only
their command-surface presentation and exit semantics; the default wiring lazy-imports
the future `src/queue/` module and refuses with a clear non-zero exit (code 7) while it
is absent, and 009's tests inject fakes (research R5).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`
per exported module; Node.js ≥ 20.0.0 engine constraint (inherited from 002 /
constitution "Technology stack"). No toolchain changes. Node 20-compatible APIs only
(research R2: no `fs.globSync`, no unguarded `crypto.hash`, no `--experimental` flags).

**Primary Dependencies**: **None added at runtime — explicit plan decision (research R1),
continuing the 002/007/008 posture.** The CLI imports only Node built-ins
(`node:child_process` in the bin shim and e2e harness, `node:fs`/`node:path`/`node:crypto`
where needed) and existing module surfaces: `task-linear-sync/{domain,config,state,urls,
gates,ports}` (002), `./discovery` (003, incl. the pure `agentHookScaffold`), `./parsing`
(004), `./engine` (008: `createSyncEngine`, report builders, `createDefaultSecurityScreener`),
`./tracker` + `./tracker/testing` (007, real port + fake). The argv parser is hand-rolled
pure code — `node:util parseArgs` rejected (research R2). The MCP SDK remains 012's
separately scoped concern.

**Storage**: None new. Every read-only command writes at most to the run-state directory
outside the working tree (frozen `StateStore` placement, `reports/<runId>/` +
`plans/<planId>.json` via the engine's stage 7). The review-report pair lands only under
`reports/<runId>/` in the state directory — never the repository working tree (spec edge
case "report name collision"; constitution I). `install-agent-hook` is the only command
that writes inside a workspace, and that write is owned by 010's behavior behind the
`QueueSurface` seam, not by 009 code.

**Testing**: `node:test` + `node:assert/strict`, existing tiers (`unit`, `contract`,
`integration`, `e2e`) via `scripts/run-tests.mjs`; compiled through `tsconfig.test.json`
into `build/tests/`. Pyramid (constitution VI): **unit** for the pure core (argv parsing,
exit-code mapping, command table, `QueueSurface` default refusal, read-only guard purity,
check-summary rendering); **contract** (report JSON validated against the frozen
`plan-report.schema.json` with the shared minimal validator; packaging — `bin` + `./cli`
export resolve; read-only command-lane import scan; dependency-budget re-assert; zero-org-
literal hygiene); **integration** driving `runCli` in-process with the 007 fake
`LinearPort`, a temp-directory `StateStore`, an injected fixed `Clock`, and fake
`QueueSurface`s against fixture repo worlds (008-worlds conventions, placeholders only);
**e2e** child-process drives — a driver script importing `task-linear-sync/cli` with fake
wiring, plus true bin smoke tests spawning `node dist/cli/main.js`. Zero real network,
zero real credentials, hermetic temp state dirs **outside** the repo working tree.

**Target Platform**: Node.js ≥ 20 CLI host (Linux, macOS, Windows) — the published
`task-linear-sync` bin that 013's action wraps and humans operate; also importable as
`task-linear-sync/cli` for 010/012/013 test wiring.

**Project Type**: Single npm package (existing); this feature owns the disjoint
`src/cli/` module group, one `bin` entry, one `exports` entry, and its tests/fixtures. No
frozen 002 module and no Wave-2/3 module is edited (ROADMAP rule 2); 009 imports them.

**Performance Goals**: Command dispatch overhead is milliseconds (pure argv parse + one
engine call); report pair rendering is linear in plan entries (engine-side, already
shipped); `check` produces its machine summary in the same single plan build (no second
pass); full `npm test` runtime stays dominated by the existing 900+ tests.

**Constraints**: Zero new runtime dependencies (R1); twelve commands, exit zero on
success and non-zero on refusal/abort/failure with a documented machine-facing map
(R3); `plan` combined with any apply flag is refused at parse time, naming the flags,
performing nothing (FR-002); `install-agent-hook` performs zero issue-tracker network
calls (FR-003 — asserted on the fake port call log); `rollback` refuses unjournaled runs
(`MANIFEST_UNJOURNALED`) with no mutation (FR-004 — the engine already refuses; 009 maps
it to exit 4 and asserts zero writes); report artifacts contain zero raw bodies/
descriptions (hashes only) and abort with a read-only violation error on any injected
mutation attempt (FR-005/008 — CLI-side guard, research R6); all CLI stdout/stderr text
passes the `SecurityScreener`; distributed defaults and docs carry zero org identifiers;
frozen modules are import-only.

**Scale/Scope**: 8 FRs (001 FR-072…079), 3 SCs, 2 user stories; 12 commands × ~10 CLI
source modules; 2 new fixture worlds + reuse of the 008 worlds corpus; ~20 new test
files across the four tiers.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Read-only commands (`inventory`, `discover-metadata`, `plan`, `check`) are typed and import-scanned so `applySyncPlan`/`rollbackRun` are unreachable from their lanes (mirrors engine-gates §4); every read-only command runs its port + state through the CLI `ReadOnlyGuard` — any tracker mutation method or non-canonical state write attempted during a read-only run throws `ReadOnlyViolationError` and aborts with exit 5 (research R6). Mutating commands (`bootstrap`, `sync`, `rollback`) construct a frozen `GateRequest` (apply flag + exact confirmation key + low-confidence acceptance + required `--plan <planId>` reference) and call ONLY the frozen engine methods — zero CLI-side gating logic. `install-agent-hook` reaches the tracker not at all (zero-network contract asserted on the fake call log). Report artifacts land only in the state directory via the engine's atomic owner-only writer, never the repo tree. | PASS |
| II. Durable Identity | The CLI never derives identity: JSON report entries carry the frozen `taskUuid`/`issueId`/`planId` verbatim (durable ids), Markdown names entities human-readably (spec FR-008). `rollback` targets a `runId`; `--plan` takes the `planId`; no id is re-derived or rewritten at the surface. | PASS |
| III. Intelligent Defaults, Overridable Configuration | The CLI adds no new config keys: it resolves configuration exactly through the frozen 002 layered loader (`--config <path>` → `configFileName` default `<toolId>.json` under the repository root, then overrides) and surfaces `ConfigFileError`/`MissingIdentityError` verbatim (all names listed, no fail-fast) at exit 3. All CLI ergonomics (exit codes, flag vocabulary, `bin` name via `binName`/`toolId`) ship as documented defaults; no organization literals anywhere in defaults, help text, fixtures, or docs. | PASS |
| IV. Determinism and Idempotency | Exit-code mapping is a pure function over frozen error/gate vocabularies (table-driven unit tests over every code). Command output ordering is the engine's deterministic plan ordering; the `check` machine summary is byte-stable for identical inputs. Repeated `plan` runs over unchanged inputs re-render byte-identical report artifacts (engine guarantee, asserted at the CLI surface). No wall-clock reads: the `Clock` is injected (default `SystemClock`, fixed clock in tests). | PASS |
| V. One Engine, Additive Surfaces | Every sync behavior routes through `createSyncEngine` from `task-linear-sync/engine`: `plan`/`check`/`bootstrap`/`sync` → `buildSyncPlan` (+ `applySyncPlan` for applies only), `rollback` → `rollbackRun`. Report build/render/write is **not reimplemented** — the CLI consumes the engine's exported report lane and asserts its output (research R4). `inventory`/`discover-metadata` are read-only presentations over frozen 003/004 + the injected port (the engine's frozen contract has no such methods); they touch no gating/locking/mutation path — a contract import-scan enforces that their command modules cannot import mutating engine entries (research R7). The five 010-bound commands add no parallel queue/hook logic: they present the `QueueSurface` seam (research R5). All tracker access flows through the injected `Linear_Port`. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR-001…008 and SC-001…003 maps to at least one automated test (quickstart traceability table). Pyramid: unit (argv/exit/purity) → contract (frozen-schema conformance, packaging `bin`+`./cli`, read-only import scan, hygiene) → integration (all twelve commands + report pair via `runCli` with fake port/queue/clock, incl. FR-002 flag rejection, FR-003 zero-network, FR-004 unjournaled refusal, SC-003 injected-mutation abort) → thin e2e child-process drives over `dist/cli`. Tests written first, must fail. Hermetic: fake port, injected `QueueSurface` fakes, temp state dirs, fixed clock; coverage threshold inherited from the `npm test` gate. | PASS |
| Additional constraints | *Port/adapter*: CLI composes only via `createLinearPort` / injected fakes — no HTTP, no GraphQL in `src/cli` (import-scan contract test). *Credential handling*: CLI never reads key values; the port's preflight naming diagnostics surface verbatim at exit 3; no credential name/value printed (screening test). *Locking/integrity*: `LOCK_HELD` gate failure maps to exit 6 — the CLI never creates or steals locks. *Technology stack*: ESM + per-module `.d.ts`, `bin` entry → `dist/cli/main.js`, one additive `exports` entry, deps unchanged at zero (budget tests re-asserted, not edited). *No org literals*: fixtures and docs use placeholders; hygiene contract test scans `src/cli` + fixtures. | PASS |
| Development workflow / quality gates | No pipeline or tooling changes; existing tiers + coverage gate run the new files. Documentation duty (same change): README "Operator CLI" section + new `docs/cli.md` covering all twelve commands, the exit-code map, the review-report artifacts, and the `QueueSurface` placeholder behavior, with placeholder identifiers only. | PASS |

**Pre-research gate result: PASS — no violations; no documented deviation required.
Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/009-operator-cli-plan-report/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command) — 009-local interfaces only
│   ├── README.md
│   ├── command-surface.md      # 12 commands, flags, exit-code map, check/013 machine contract
│   ├── queue-surface.md        # injectable 010 delegate seam + default wiring + refusal
│   └── plan-review-report.md   # report lane consumption, read-only guard, artifact placement
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json                     # + "bin": { "task-linear-sync": "./dist/cli/main.js" }
                                 #   + one exports entry "./cli" (additive; deps unchanged)

src/
├── domain/ config/ state/ urls/ gates/ ports/   # FROZEN (002) — imported, never edited
├── discovery/ parsing/ routing/ titles/         # 003–005 — imported
├── matching/ tracker/ engine/                   # 006–008 — imported
└── cli/                                 # ← 009's disjoint module group
    ├── main.ts                          # bin shim: runCli(argv, defaultContext()) + exitCode
    ├── index.ts                         # public surface for the ./cli subpath (named re-exports)
    ├── argv.ts                          # R2: pure argv parser + per-command flag schema
    ├── commands.ts                      # twelve-command registry (names, flags, help)
    ├── exit-codes.ts                    # R3: ExitCode enum + pure exit-code mapping
    ├── errors.ts                        # CliError taxonomy (UsageError names flags)
    ├── context.ts                       # CliContext (injected deps) + production wiring
    ├── io.ts                            # stdout/stderr writers — screened before print
    ├── readonly-guard.ts                # R6: mutating-port / state-write refusal decorator
    ├── queue-surface.ts                 # R5: QueueSurface interface + default lazy wiring
    └── commands/
        ├── plan.ts                      # plan (+ check shares the lane, R10 machine summary)
        ├── apply.ts                     # bootstrap/sync → GateRequest → applySyncPlan
        ├── rollback.ts                  # rollback → rollbackRun (refusal mapping, FR-004)
        ├── inventory.ts                 # read-only discovery+parse presentation (R7)
        ├── discover-metadata.ts         # read-only port.discoverMetadata presentation (R7)
        └── queue.ts                     # install-hooks/install-agent-hook/enqueue/
                                         #   worker/last-run → QueueSurface presentation

tests/
├── unit/                            # cli-argv / cli-exit-codes / cli-commands-table /
│   │                                #   cli-queue-surface / cli-readonly-guard /
│   │                                #   cli-check-summary (pure rendering)
├── contract/                        # cli-packaging (bin + ./cli resolve), cli-report-schema
│   │                                #   (generated pair vs frozen schema), cli-readonly-lane
│   │                                #   (import scan), cli-dependency-budget (re-assert),
│   │                                #   cli-hygiene (zero org literals, no-direct-tracker)
├── integration/                     # cli-commands (all twelve, exit matrix, FR-002/003/004),
│   │                                #   cli-plan-report (FR-006/007/008 field set + grouping
│   │                                #   + unmapped + conflicts + assertions), cli-readonly-
│   │                                #   violation (SC-003 injected mutation abort),
│   │                                #   cli-report-zero-task, cli-rollback-refusal
├── e2e/                             # cli-child-process (driver importing ./cli over fixture
│   │                                #   worlds + fake wiring) and cli-bin-smoke (spawn
│   │                                #   node dist/cli/main.js — help + FR-002 usage refusal)
├── helpers/cli-harness.ts           # CliContext builder over 008-worlds worlds + recording
│   │                                #   fake QueueSurface + child-process driver factory
└── fixtures/cli/
    ├── README.md                    # fixture conventions (placeholders only)
    └── worlds/                      # review-report/ (multi-project, unmapped parents,
        │                            #   conflict task), zero-task/ (empty specs dir repo)
```

**Structure Decision**: Single npm package (constitution "Technology stack"), continuing
002's reserved surface slots and 008's disjoint-module precedent. 009 touches only
`src/cli/**`, `tests/**/cli-*` + `tests/fixtures/cli/**`,
`tests/helpers/cli-harness.ts` (+ a shared `tests/helpers/json-schema-mini.ts` extractor
if the frozen-schema validator is reused — new files only), two additive `package.json`
entries (`bin`, `./cli` exports), `README.md`/`docs/cli.md`, and its own
`specs/009-operator-cli-plan-report/**`. **No `src/report/` module group**: the report
renderer lives in `src/engine/report.ts` (008, T025) and is exported from `./engine`;
forking a second renderer would violate Principle V — the decision is documented in
research R4. Consumers of the seam (010 later replaces the default `QueueSurface` wiring;
013 shells out to the published bin) depend only on the contracts in this feature folder.

## Complexity Tracking

No constitution violations to justify — gate passed with no entries. Notable rejected
complexity: (1) a separate `src/report/` rendering module — rejected because the engine
already owns the frozen-schema report lane and a second renderer is precisely the
"divergent path" Principle V forbids (research R4); (2) `node:util parseArgs` or a CLI
framework (commander/yargs) — rejected: zero-dependency posture plus the need to reject
`plan` + apply-flag combinations *naming every offending flag* before anything else runs
is a custom rule anyway (research R2); (3) implementing hook/queue behaviors in 009 to
make the five 010-bound commands "work" today — rejected: 010 owns those behaviors; the
`QueueSurface` seam plus a refusing default keeps ownership clean and the refusal
message tells the operator exactly what is missing (research R5).

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**:
all gates above still PASS. The design adds no runtime dependency, edits no frozen
module, writes nothing into the repository working tree from read-only lanes (the
`ReadOnlyGuard` makes an attempted violation an abort, not a silent pass), keeps the
report renderer single-homed in the engine, and the constitution-mandated
property/contract/security tiers are specified in quickstart.md with per-FR traceability
(SC-001 zero-body scan over the whole generated corpus is property-style; contract =
frozen-schema conformance; security = screening + zero-network + credential-sentinel
assertions). No Complexity Tracking entries were created by the design.
