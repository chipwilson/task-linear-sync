# Phase 0 Research: Operator CLI and Plan Review Report

**Feature**: `009-operator-cli-plan-report` | **Date**: 2026-11-05

Resolves every Technical Context unknown and every dependency/integration question.
No NEEDS CLARIFICATION remains in plan.md. Each entry: **Decision / Rationale /
Alternatives considered**.

## R1. Module placement, packaging surface, and dependency budget

- **Decision**: New disjoint `src/cli/` module group, exposed two ways: (a) a `bin`
  entry `"task-linear-sync": "./dist/cli/main.js"` (the published operator/CI binary)
  and (b) one additive subpath export `"./cli"` → `dist/cli/index.{js,d.ts}` (the
  importable pure core: `runCli`, `ExitCode`, `CliContext`, `QueueSurface` types) so
  010/012/013 and the test lanes can drive the CLI in-process with injected wiring.
  Zero new runtime dependencies; imports restricted to Node built-ins plus
  `task-linear-sync/{domain,config,state,urls,gates,ports,discovery,parsing,engine,
  tracker,tracker/testing}` (package-relative `../` imports in source). `package.json`
  edits are exactly the two additive entries; `files` already ships `dist`, `README.md`,
  `docs`. Node 20 API compatibility is a hard constraint (no `fs.globSync`, no unguarded
  `crypto.hash`, no experimental flags).
- **Rationale**: Precedent is fixed by 002's reserved slots and 007/008's zero-spend
  posture (`tests/contract/tracker-dependency-budget.test.ts` pins runtime deps at 0).
  The `bin` + importable-core split is what the spec's "Provides to" demands: 013 wraps
  the *published* read-only commands (bin) while every test tier needs the same logic
  with a fake port injected — impossible through a child process alone without a dev
  wiring path (R8). The dependency-budget and packaging contract tests (`package-surface`,
  `engine-packaging`) run unmodified and stay green because both entries are additive.
- **Alternatives considered**: (a) a separate `bin/` hand-written JS shim calling
  `dist/` — rejected, `src/cli/main.ts` compiles through the same tsconfig and gets
  typed checking + coverage like everything else; (b) exporting the CLI only as `bin`
  (no `./cli` subpath) — rejected, forces e2e-only testing or a duplicated internal
  harness and denies 010/013 the documented test-wiring seam; (c) a `src/report/`
  module group — rejected, see R4.

## R2. Argv parsing: hand-rolled pure parser over `node:util parseArgs`

- **Decision**: A pure, dependency-free parser in `src/cli/argv.ts`: `parseInvocation(
  argv: readonly string[]): { ok: true; invocation: CliInvocation } | { ok: false;
  failure: ParseFailure }` driven by the per-command flag schema in `src/cli/commands.ts`
  (twelve commands, exact names, typed flag specs, no aliases beyond documented ones).
  Unknown commands/flags, missing required values, and the FR-002 rule — `plan` (and
  `check`) combined with any apply flag (`--apply`, `--confirm`, `--accept-low-confidence`)
  — fail at parse time with a `ParseFailure` **naming every offending flag** (complete
  listing, no fail-fast-on-first, mirroring the gate/identity vocabularies). Nothing
  else runs before the parser returns: no config load, no engine, no filesystem beyond
  `cwd` (spec FR-002 "performing nothing").
- **Rationale**: The FR-002 rejection vocabulary is a custom rule no parser library ships;
  hand-rolling keeps the module 100% pure and trivially unit-testable (constitution VI
  unit tier) and sidesteps version drift — `parseArgs` stability/option-set differs
  subtly across the Node 20/24 matrix, and a hand-rolled parser is identical everywhere.
- **Alternatives considered**: (a) `node:util parseArgs` — rejected as above (still would
  need the whole custom cross-flag rule layered on top); (b) a CLI framework
  (`commander`/`yargs`) — rejected outright by the zero-dependency budget (R1) and
  because its `exitOverride`-style side exits would break the pure-core design; (c)
  `minimist`-style vendoring — rejected, re-implementing is smaller than vendoring.

## R3. Exit-status contract: documented machine-facing map

- **Decision**: `src/cli/exit-codes.ts` exports the frozen-in-009 map (documented in
  `contracts/command-surface.md` and `docs/cli.md`) and a **pure** mapping function from
  parse failures, frozen error classes, and frozen `GateFailure.code` values:

  | Code | Name | Meaning (all non-zero are refusal/abort/failure per FR-001) |
  |---|---|---|
  | 0 | `SUCCESS` | command completed successfully |
  | 1 | `UNEXPECTED_ERROR` | unmapped internal error (sanitized one-line diagnostic on stderr) |
  | 2 | `USAGE_ERROR` | unknown command/flag, missing value, or **plan+apply-flag rejection naming the flags** (FR-002) |
  | 3 | `CONFIGURATION_ERROR` | `ConfigFileError` (category + path), `MissingIdentityError` (all names), `StatePlacementError`, credential-preflight naming diagnostics — verbatim, sanitized |
  | 4 | `GATE_REFUSED` | any frozen `GateFailure` code (`APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`, `MANIFEST_UNJOURNALED`, `MANIFEST_EXPIRED`), each named, complete listing (FR-004 maps here) |
  | 5 | `RUN_ABORTED` | engine aborted: `ApplyResult.status === "aborted"` (drift/stability, fail action), `IntegrityError`, `EngineFailError`, `ReportScreeningError`, `ReadOnlyViolationError` (SC-003) |
  | 6 | `LOCK_HELD` | `LOCK_HELD` gate failure — report and exit, never wait/steal |
  | 7 | `SURFACE_UNAVAILABLE` | a `QueueSurface` behavior is not wired (queue module absent — R5) |
  | 8 | `CHECK_FINDINGS` | `check` completed read-only but the report carries blocking findings (R10) |

- **Rationale**: The spec fixes only "zero on success, non-zero otherwise"; a *documented,
  stable, machine-facing* map is what 013 and scripts need (spec "Provides to",
  briefing). Codes avoid 2 (usage convention) collisions and reserve the 4/5/6 split so
  CI can distinguish "operator must re-confirm" (4) from "world drifted" (5) from "retry
  later" (6). Mapping is table-driven so unit tests cover 100% of the vocabulary and
  `GATE_REFUSED` never invents vocabulary the frozen `GateFailureCode` union lacks
  (additions there are 002 amendments, not 009 code).
- **Alternatives considered**: (a) binary 0/1 — rejected: 013's wrapper and shell scripts
  would have to scrape stderr for refusal classes, re-deriving what the engine already
  names; (b) mapping gate codes onto shell `EX_*` constants (`sysexits.h` 64/78…) —
  rejected, familiar but fragments the gate vocabulary across codes and wastes the
  small-codes space CI needs; (c) exit 4 for locks too — rejected: "someone else is
  running" needs its own retry signal (6).

## R4. Report rendering placement: engine owns it, 009 consumes and enforces (no `src/report/`)

- **Decision**: The paired review artifacts are produced by the engine lane exactly as
  shipped by 008: `buildSyncPlan` stage 7 already persists `StoredPlan` and writes the
  frozen-schema `reports/<runId>/report.json` + `report.md` via `src/engine/report.ts`
  (`buildPlanReportJson` / `renderPlanReportMarkdown` / `writePlanReportArtifacts`,
  exported from `task-linear-sync/engine`). The `plan` command is a thin lane: call
  `engine.buildSyncPlan`, then resolve the artifact paths from `state.paths.reports` +
  `derivePlanReportRunId(planId, clock)` and print them. 009 **owns the enforcement**:
  contract tests validate the generated pair against the frozen
  `plan-report.schema.json`; integration tests assert the FR-006 complete field set,
  FR-007 grouping/unmapped/`parentMapped`/unresolved-conflict surfacing, the FR-008
  security-assertions block, zero raw bodies/descriptions (SC-001), zero-task rendering,
  and state-directory-only placement. 009 adds only what the engine lane does not
  provide: the `ReadOnlyGuard` (R6) around the read-only commands' deps and the CLI-side
  report-path resolution/presentation (`src/cli/commands/plan.ts`).
- **Rationale**: plan-artifact.md says "009 renders the paired artifacts" as the
  *specification owner* of the field set — but 008 had to implement the writer because
  `ApplyResult.reportPaths` requires report material per apply run, and its module
  header already cites 009 FR-006/007/008. Forking a second renderer in `src/report/`
  would create exactly the divergent path constitution V forbids ("no surface MAY
  reimplement"), and the two would drift on every fix. One renderer, one authority;
  tests are the enforcement (constitution VI: "property-based, contract, and security
  tests are the primary enforcement evidence").
- **Alternatives considered**: (a) new `src/report/` group with its own renderer —
  rejected above; (b) moving the report code out of `src/engine/` into `src/report/`
  and having the engine import it — rejected: edits 008's shipped module group (ROADMAP
  rule 2) for zero behavioral gain; (c) re-exporting the report helpers through
  `./cli` so docs present one surface — rejected; named re-export of identical bindings
  is harmless but adds a second import path for the same contract; docs point at
  `./engine` instead.

## R5. `QueueSurface` delegate seam for the five 010-bound commands

- **Decision**: `src/cli/queue-surface.ts` defines the injectable seam
  (`contracts/queue-surface.md` is the normative binding contract for 010):

  ```ts
  export interface QueueSurface {
    installHooks(o: InstallHooksInput): Promise<QueueOutcome>;
    installAgentHook(o: InstallAgentHookInput): Promise<QueueOutcome>;
    enqueue(o: EnqueueInput): Promise<QueueOutcome>;
    runWorker(o: WorkerInput): Promise<QueueOutcome>;   // resolves on clean stop (--once)
    readLastRun(o: ReadLastRunInput): Promise<LastRunOutcome>;
  }
  ```

  `CliContext.queueSurface` carries it. **Default wiring** (`createDefaultQueueSurface`):
  `readLastRun` is served immediately from the frozen 002 primitive
  `readLastRunMarker(state)` (008's engine already writes the marker, so `last-run`
  works from Wave 4 onward without 010); the other four methods attempt a lazy dynamic
  `import("../queue/index.js")` per invocation — while that 010 module does not exist
  the import fails with `ERR_MODULE_NOT_FOUND` and the surface throws
  `QueueSurfaceUnavailableError` naming the command and the missing module → exit 7.
  009's tests inject recording fake `QueueSurface`s: the integration tier asserts the
  five commands' presentation (flags passed through, outcome → exit mapping, stdout
  shape), `install-agent-hook` with a fake that performs the documented scaffold write
  (template from the pure 003 `agentHookScaffold`) while the fake port logs **zero**
  network calls (FR-003), and the default wiring's refusal + zero-mutation behavior
  while `src/queue/` is absent. When 010 lands it replaces the default wiring behind
  the same five-method interface — zero CLI edits expected.
- **Rationale**: The spec's Assumptions assign these behaviors to 010 while assigning
  009 only "command-surface presentation and exit semantics"; the briefing demands an
  injectable seam with a refusing default. Making the seam a plain interface with
  lazy-import default wiring means the refusal is a *runtime* property, independently
  testable, and the exit-7 code (R3) tells scripts "feature not installed" distinctly
  from config errors. `last-run` is treated as the spec's edge: the marker is a frozen
  002 artifact the engine already writes, so refusing to read one's own last run would
  make a working capability appear broken — documented here as the deliberate
  resolution of the spec-assumption tension.
- **Alternatives considered**: (a) stub implementations that write real files today —
  rejected: pre-empts 010's ownership (dedup window, lock, byte-preserving hook install)
  and creates the deletion work later; (b) `last-run` also gated on the queue module —
  rejected above (and would break the operator loop "apply, then check last-run" in the
  009-only world); (c) a `QueueSurface` returning raw strings for stdout — rejected:
  structured outcomes keep exit-code mapping pure and testable.

## R6. Read-only violation guarantee: CLI-side `ReadOnlyGuard` decorator

- **Decision**: `src/cli/readonly-guard.ts` exports
  `createReadOnlyGuard(deps: EngineDependencies): EngineDependencies` used by all four
  read-only command lanes (`plan`, `check`, `inventory`, `discover-metadata`). It wraps
  (a) the `LinearPort` so **every mutating member** (`createIssue`, `updateIssue`,
  `delete*/archive*`, attachment writes, …) throws `ReadOnlyViolationError` naming the
  attempted member, and (b) the `StateStore` so any write whose relative path is not
  under `reports/` or `plans/` throws the same error — the engine's sanctioned stage-7
  report/plan artifacts are the only permitted outputs of a read-only run. The error
  maps to exit 5 (`RUN_ABORTED`, R3) and names the attempted operation, sanitized.
  `inventory`/`discover-metadata` additionally receive a store whose writes are *all*
  refused (they produce no artifacts).
- **Rationale**: FR-005/SC-003 demand that an attempted write/update/delete against task
  sources, the tracker, or persisted state during report generation *aborts* with a
  read-only violation error. The engine's build lane is already read-only by
  construction, but "by construction" is not "enforced": the guarantee must survive a
  future regression or a rogue adapter, and no such guard exists anywhere in 002/008
  (verified by search). A decorator at the composition boundary is minimal, fully unit-
  testable, and leaves frozen modules untouched. Zero repo writes are additionally
  proven by hashing the fixture repo tree before/after (SC-003, and 002's own
  "walk the fixture repo" obligation).
- **Alternatives considered**: (a) trust the engine + assert call logs in tests only —
  rejected: SC-003's "injected write attempt aborts" requires an enforced runtime
  refusal at the surface that composes the deps; (b) a Proxy over the whole port/store
  — rejected in favor of an explicit member-by-member wrapper: a property-name typo in a
  future port member must fail loudly in a contract test, not silently pass through a
  proxy default; (c) wrapping only the port — rejected: FR-005 explicitly includes
  persisted state (checkpoints, `sync-state.json`) and task-source writes (repo-write
  refusal is via the tree-hash assertion plus the guard's store path rule; `src/cli`
  opens no task files for writing anywhere, import-scan enforced).

## R7. `inventory` and `discover-metadata`: read-only composition (engine has no such methods)

- **Decision**: The frozen `SyncEngine` contract exposes exactly three methods, so these
  two read-only commands compose the frozen modules directly: `inventory` = 003
  `discoverTaskFiles` + adapter registry + 004 `parseTaskFile` → a screened, deterministic
  listing (repository-relative POSIX paths, framework id, task count, task count with
  stable uuids) on stdout; `discover-metadata` = `port.discoverMetadata(configured team
  keys)` → screened listing of projects/workflow states/milestones/labels per team. Both
  receive guarded deps (R6). **Principle-V posture**: they construct no `GateRequest`,
  never receive the engine's mutating methods — the command modules are statically
  import-scanned (contract test `cli-readonly-lane`) to forbid importing
  `applySyncPlan`/`rollbackRun`/`GateRequest` vocabulary, mirroring engine-gates.md §4's
  type-level rule at the module boundary. All propagated text passes the engine's
  `createDefaultSecurityScreener` (no forked screening).
- **Rationale**: Constitution V forbids divergent *gating/locking/screening* paths, not
  read-only presentations of already-frozen discovery/metadata reads; 001's group M
  defines these commands as inventory surfaces, and both are listed read-only surfaces
  in constitution I — the constitution itself treats them as surfaces beside plan/check.
  Routing their screening through the engine's screener keeps the one screening path.
- **Alternatives considered**: (a) adding `inventory()` to `SyncEngine` — rejected:
  `src/ports/engine.ts` is frozen (amendment would be a cross-feature change 009 must
  not make); (b) shelling to `plan` and listing plan entries — rejected: inventory is
  useful *before* routing/matching configuration is complete (a plan build requires full
  workspace identity and tracker reads), and 001 R15 defines inventory without plan
  semantics.

## R8. e2e child-process drives: test/dev wiring path

- **Decision**: The e2e tier spawns child processes two ways. (a) **Driver scripts**:
  e2e tests write a tiny `driver.mjs` into the temp tree that imports
  `task-linear-sync/cli` (via the package self-reference, which resolves from any cwd
  because `node_modules/task-linear-sync` symlinks the repo in this workspace; if
  unavailable, the driver imports `dist/cli/index.js` by absolute path), builds a
  `CliContext` with the 007 fake port seeded from a fixture world, a fixed clock, a temp
  `StateStore`, and a recording fake `QueueSurface`, then runs `runCli([...], ctx)` and
  writes `{ exitCode }` — the parent asserts on the exit code plus artifacts. This is
  the documented **test/dev wiring path** (the `CliContext` seam, R1/R5) exercised under
  a real process boundary. (b) **Bin smoke tests**: spawn `node dist/cli/main.js`
  directly for the paths needing no tracker at all — `--help`/unknown-command usage, and
  the FR-002 `plan --apply` rejection naming the flag (exit 2, zero filesystem effects).
- **Rationale**: A fake `LinearPort` is a live object — it cannot cross a plain process
  boundary, so a pure "spawn the bin with env vars" strategy cannot test the mutating
  commands hermetically without network. Injecting through the importable core inside a
  child process keeps the "real CLI code under test" property (argv parsing → exit code
  end to end, real `process.exitCode` path) while satisfying the zero-network rule; the
  bin shim itself gets a thin honest smoke layer.
- **Alternatives considered**: (a) a dev-only env var pointing the bin at a JSON fixture
  "world" file the fake loads — rejected: invents a serialization format for the fake and
  duplicates 007's world seeds; (b) recording-proxy HTTP transport against the real
  adapter (007's recorded-transport harness) — rejected for 009's e2e: heavier, and 009
  owns no transport concerns; (c) in-process-only testing without children — rejected:
  the bin's argument plumbing and exit plumbing would go untested, and 013's whole
  premise is the child-process contract.

## R9. Apply flag vocabulary and the required `--plan` reference

- **Decision**: `bootstrap`/`sync` accept exactly `--apply`, `--confirm <confirmation-key>`,
  `--accept-low-confidence`, `--plan <planId>`, plus the global `--config <path>`.
  All four apply-path flags map onto the frozen `GateRequest`; the CLI performs **no
  gating itself** — the built-or-loaded plan and the `GateRequest` go to
  `engine.applySyncPlan`, whose `ApplyResult` (refusal listing / abort / applied ops +
  `reportPaths`) is presented and mapped (R3). `--plan` is required for applies:
  engine-gates.md normative rule 3 names the "CLI `sync`/`bootstrap` apply path" among
  the `planReference` consumers, and requiring an explicit reference to a previously
  built (and now report-reviewed) plan is exactly the approval loop the spec's purpose
  statement describes. A missing `--plan` is a usage error (exit 2) naming the flag; an
  unknown/stale reference arrives as the frozen `PLAN_REFERENCE_UNKNOWN` /
  `PLAN_REFERENCE_STALE` refusals (exit 4, complete listing). `plan`/`check` reject the
  three apply flags at parse time (FR-002, R2).
- **Rationale**: One gate path (the engine's), complete refusal listings, and a CLI that
  cannot diverge from the agent tool's (012) semantics — the spec's stated purpose for
  the shared vocabulary. The "plan, review the report, then apply that exact planId"
  flow is the human mirror of 012's fresh-`Plan_Reference` rule.
- **Alternatives considered**: (a) build-and-apply in one `sync --apply` invocation —
  rejected: violates rule 3 and lets an unreviewed plan mutate; (b) treating a missing
  `--plan` as `PLAN_REFERENCE_UNKNOWN` — rejected: nothing was *unknown to the engine*,
  the CLI never called it; that distinction belongs to usage (2), not a gate refusal (4);
  (c) free-form `--gate k=v` passthrough — rejected: invents vocabulary.

## R10. `check` semantics: read-only CI-facing command with a machine summary

- **Decision**: `check [repo]` is the read-only CI entry (013's wrap target): guarded
  deps (R6), full plan build with the report pair written (same lane as `plan`), stdout
  is **one JSON object** (nothing else): `{ schemaVersion: 1, planId, reportJson,
  reportMarkdown, counts: { entries, unmapped, unresolvedConflicts, lowConfidence } }`
  — counts read from the generated report artifact fields, never re-derived. Exit codes:
  `0` clean completion with zero findings; `8 CHECK_FINDINGS` iff the report carries ≥1
  unresolved-conflict awaiting-human entry (`decision: "conflict"` or
  `unresolvedConflict: true`) or ≥1 `securityAssertions` item with `status: "fail"`;
  everything else uses the shared map (usage/config/gate/abort/lock). Thresholds,
  branch rules, and per-condition failure reporting stay in 013, which consumes the
  report JSON as its sole machine input — 009 only guarantees "the report exists, is
  valid, and the exit code distinguishes quiet-clean from quiet-has-problems from
  couldn't-run".
- **Rationale**: The spec gives `check` no decision semantics of its own; the CI design
  (briefing 013 notes) warns against re-deriving decisions in wrappers. A two-value
  pass/findings completion signal plus stable operational codes is the minimum CI needs
  to distinguish "the tool failed" from "the plan has conflicts" without parsing
  English. Reading counts off the report keeps the single authority.
- **Alternatives considered**: (a) `check` = `plan` with `--json` — rejected: conflates
  the human review command with the machine interface 013 pins; (b) exit codes per
  condition (unmapped=8, conflicts=9, drift=10) — rejected: computes 013's thresholded
  conditions at the wrong layer (thresholds belong to 013) and re-derives decisions;
  (c) exit 0 always on completion — rejected: CI greps would become the contract.

## R11. Documentation surface

- **Decision**: Same-change documentation (constitution Documentation duty): a
  README.md status/surface update plus a new `docs/cli.md` — twelve commands with
  synopsis, flags, examples (placeholder identifiers only), the exit-code map table,
  the review-report artifact pair description, `check`'s machine contract for 013, and
  the `QueueSurface` placeholder behavior with its exit-7 refusal.
- **Rationale**: Precedent: every prior feature shipped `docs/<surface>.md`
  (`engine.md`, `tracker-integration.md`, …); the contract tests that scan docs for
  org literals keep examples benign.
- **Alternatives considered**: README-only — rejected: the exit map + machine contract
  deserve a stable deep link (`docs/cli.md`) that 013's README can reference.
