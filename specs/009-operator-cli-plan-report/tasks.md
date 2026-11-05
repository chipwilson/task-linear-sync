---

description: "Task list for feature 009 — Operator CLI and Plan Review Report"

---

# Tasks: Operator CLI and Plan Review Report

**Input**: Design documents from `specs/009-operator-cli-plan-report/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/ (command-surface, queue-surface, plan-review-report), quickstart.md

**Tests**: INCLUDED — constitution VI (Test-First, NON-NEGOTIABLE) and plan.md mandate automated coverage for every FR-001…008 and SC-001…003, including contract tests for the frozen `plan-report.schema.json` and the zero-mutation/read-only guarantees. Story-phase tests are written FIRST and must FAIL before their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = predictable command surface (P1); US2 = approvable plan review report (P2)
- All frozen 002 modules and all Wave-2/3 modules (003–008) are **import-only** — never edit them (ROADMAP rule 2). 009 touches only `src/cli/**`, `tests/**/cli-*`, `tests/fixtures/cli/**`, `tests/helpers/cli-harness.ts` + `tests/helpers/json-schema-mini.ts` (new files), two additive `package.json` entries (`bin`, `./cli` exports), `README.md`/`docs/cli.md`, and this specs folder.
- All paths are repository-root-relative.

## Path Conventions

Single npm package: `src/cli/` (009's disjoint module group), `tests/{unit,contract,integration,e2e}/`, `tests/fixtures/cli/worlds/`, compiled bin `dist/cli/main.js`. Tests run via `node scripts/run-tests.mjs` tiers (`unit`, `contract`, `integration`, `e2e`) with `node:test` + `node:assert/strict`, the 007 fake `LinearPort` (from `task-linear-sync/tracker/testing`), a temp-directory `StateStore` **outside** the fixture repo, an injected fixed `Clock`, and recording fake `QueueSurface`s — zero network, zero credentials, placeholder identifiers only.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Packaging surface, fixture worlds, and the shared CLI test harness

- [X] T001 Add the two additive `package.json` entries — `"bin": { "task-linear-sync": "./dist/cli/main.js" }` and the `"./cli"` export (types `./dist/cli/index.d.ts` listed FIRST, default `./dist/cli/index.js`) — zero dependency changes, zero other manifest edits (research R1; constitution "Technology stack")
- [X] T002 [P] Create `tests/fixtures/cli/README.md` (fixture conventions: placeholder identifiers only, zero real organization identifiers/team keys/tokens/UUID values) and two world directories under `tests/fixtures/cli/worlds/`: `review-report/` (multi-project, multi-milestone tasks; an unmapped parent issue whose only mapped relation is a **mapped sibling**, plus one parent with a mapped **descendant**; one unresolved-conflict task with git-style markers; sentinel raw task bodies/descriptions for the SC-001 absence scan) and `zero-task/` (configured repo with an empty specs tree) — `world.json` seeds following the `tests/fixtures/engine/worlds/` conventions (import-only reuse of those worlds for apply/rollback scenarios)
- [X] T003 Create `tests/helpers/cli-harness.ts`: `buildCliWorld(name)` (fixture-repo builder + seeded `createFakeLinearPort` + temp `StateStore` outside the repo + fixed `Clock` + engine-harness-compatible config layering) returning a `CliContext` factory with captured `stdout`/`stderr`, a `RecordingQueueSurface` fake (per-member recorder, outcome injection, real 003-`agentHookScaffold` template write for `installAgentHook`), a default-`QueueSurface` passthrough mode, a `makeRoguePort(inner)` decorator seam for injecting mid-run mutation attempts, a repo-tree hash/walk helper, and a `writeDriver(worldDir, argv, wiring)` factory that emits a `driver.mjs` importing `task-linear-sync/cli` (absolute `dist/cli/index.js` fallback) for the e2e tier (research R8)

**Checkpoint**: Packaging entries + fixture worlds + harness compile before `src/cli` exists (harness types against frozen `SyncEngine`/`StateStore`/`LinearPort` interfaces and 009's own contract types declared in `contracts/`; import-only from 008 worlds)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure CLI core — argv parsing, exit mapping, command table, queue seam, read-only guard, io screening, context wiring — both stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail)

- [X] T004 [P] Write unit tests for the argv parser in `tests/unit/cli-argv.test.ts` (FR-001/FR-002, data-model §1): the twelve command names parse; per-command flag schema — global `--config <path>`; `bootstrap`/`sync` take `--apply`, `--confirm <key>` (value required), `--accept-low-confidence`, and required `--plan <planId>` (missing ⇒ usage failure naming `--plan`); `rollback` requires exactly one positional `runId`; `enqueue --mode bootstrap|sync` validated; `worker --once`; `last-run --json`; `install-agent-hook --framework <id>`; unknown commands/flags fail naming the unknown token; **FR-002 rule**: `plan` or `check` combined with any of `--apply`, `--confirm`, `--accept-low-confidence` fails naming **every** offending flag (complete listing, never fail-fast-on-first) and the parser performs zero I/O (same argv ⇒ byte-identical outcome)
- [X] T005 [P] Write unit tests for exit mapping in `tests/unit/cli-exit-codes.test.ts` (FR-001, research R3, data-model §3): `exitCodeForError` is a total pure function — parse failures → 2; `ConfigFileError`/`MissingIdentityError`/`StatePlacementError`/credential-preflight → 3; every frozen `GateFailureCode` except `LOCK_HELD` (`APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`, `MANIFEST_UNJOURNALED`, `MANIFEST_EXPIRED`) → 4; `LOCK_HELD` → 6; aborted applies, `IntegrityError`, `EngineFailError`, `ReportScreeningError`, `ReadOnlyViolationError`, blocked-stdout screening → 5; `QueueSurfaceUnavailableError` → 7; `check` findings → 8; anything unmapped → 1; no code outside the documented table is producible
- [X] T006 [P] Write unit tests for the default `QueueSurface` wiring in `tests/unit/cli-queue-surface.test.ts` (research R5, contracts/queue-surface.md): with `src/queue/` absent, `installHooks`/`installAgentHook`/`enqueue`/`runWorker` reject with `QueueSurfaceUnavailableError` naming the command and `task-linear-sync/queue`, with zero filesystem/network side effects; `readLastRun` returns `{ found: false }` for an empty state store and the frozen `LastRunMarker` (`runId`, `outcome`, `completedAt`, `reportPaths`, `notificationSuppressed`) after `writeRunReports` wrote one (temp store)
- [X] T007 [P] Write unit tests for the read-only guard in `tests/unit/cli-readonly-guard.test.ts` (FR-005, research R6, data-model §5): every mutating `LinearPort` member when invoked through the guarded port throws `ReadOnlyViolationError` naming the member while read members delegate unchanged; guarded `StateStore` refuses `writeJson`/`writeText` for `sync-state.json`, `manifests/…`, `intents/…`, `last-run.json`, and queue paths but allows `reports/…` and `plans/…` when configured with `["reports/","plans/"]`, and refuses **all** writes with `[]` (inventory/discover-metadata mode); `clock`/`config`/`screener` pass through by identity

### Implementation for Foundational

- [X] T008 Implement the `CliError` taxonomy in `src/cli/errors.ts` (data-model §2): `UsageError` (carries `flags: string[]` naming every offender), `QueueSurfaceUnavailableError`, `ReadOnlyViolationError` (names the attempted member or state relative path); all messages sanitized-screening-safe, never credential values; refusals reuse frozen `GateFailure` values verbatim — NO new gate vocabulary
- [X] T009 Implement the `ExitCode` enum + pure `exitCodeForError` mapping in `src/cli/exit-codes.ts` exactly per contracts/command-surface.md §3 (makes T005 pass)
- [X] T010 Implement the twelve-command registry + per-command flag schema in `src/cli/commands.ts` (data-model §1; names `inventory`, `discover-metadata`, `plan`, `bootstrap`, `sync`, `check`, `install-hooks`, `install-agent-hook`, `enqueue`, `worker`, `last-run`, `rollback`; help text uses placeholder identifiers only)
- [X] T011 Implement the pure parser `parseInvocation(argv)` in `src/cli/argv.ts` driving the T010 schema, including the FR-002 apply-flag rejection naming every offending flag (makes T004 pass; research R2 — no `node:util parseArgs`, zero dependencies)
- [X] T012 Implement `src/cli/queue-surface.ts`: the `QueueSurface` interface + input/outcome shapes exactly per contracts/queue-surface.md §1, `createDefaultQueueSurface()` with `readLastRun` over frozen `readLastRunMarker` and lazy dynamic `import("../queue/index.js")` for the other four members translating `ERR_MODULE_NOT_FOUND` into `QueueSurfaceUnavailableError` (makes T006 pass; research R5 — 010 replaces only the default wiring)
- [X] T013 Implement `createReadOnlyGuard(deps, allowedWritePrefixes)` in `src/cli/readonly-guard.ts` — explicit member-by-member mutating-port wrappers + state path-prefix write refusals, no Proxy defaults (makes T007 pass; research R6)
- [X] T014 Implement `src/cli/io.ts`: `Stdout`/`Stderr` writer ports screening every line via the injected `SecurityScreener` before writing; a blocking finding replaces the line with a sanitized blocked notice and flags the outcome for exit 5
- [X] T015 Implement `src/cli/context.ts`: `CliContext` (data-model §4) + `createProductionContext()` wiring frozen `loadConfig` (config path = `--config` value else `<repositoryRoot>/<configFileName>` default `<toolId>.json`), `createLinearPort`, `createDefaultSecurityScreener`, `createSyncEngine`, frozen `StateStore` factory, system `Clock`, `createDefaultQueueSurface()`, env-var key provider — handlers never touch `process`
- [X] T016 Implement the `src/cli/index.ts` barrel (`runCli` dispatch skeleton, `ExitCode`, `CliContext`, `QueueSurface` and outcome types as named re-exports) and the thin bin shim `src/cli/main.ts` (`runCli(process.argv.slice(2), createProductionContext())` → `process.exitCode = outcome.exitCode`; never `process.exit()` mid-stream)

**Checkpoint**: Foundation ready — argv → parse → context → exit mapping demonstrably wired for a throwing default handler; user story implementation can now begin (US1/US2 files are disjoint)

---

## Phase 3: User Story 1 - Predictable command surface (Priority: P1) 🎯 MVP

**Goal**: All twelve commands route through the engine (or the `QueueSurface` seam) with exit zero on success and the documented non-zero map on every refusal/abort/failure; `plan` + apply flags refused naming the flags; `install-agent-hook` performs zero network; `rollback` refuses unjournaled runs with no mutation; `check` is the CI-facing machine summary.

**Independent Test**: `node scripts/run-tests.mjs --tier unit --test-name-pattern "cli-argv|cli-exit"`, then `--tier integration --test-name-pattern "cli-commands|cli-rollback"`, then `--tier e2e --test-name-pattern "cli-"`: drive all twelve commands against the hermetic fixture worlds and assert exit codes, the FR-002 rejection text, FR-003 zero requests on the fake port call log, and FR-004 zero-mutation refusal (quickstart scenarios 1–3, 7).

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T017 [P] [US1] Write the twelve-command exit-status matrix in `tests/integration/cli-commands.test.ts` (FR-001, SC-002, quickstart 1+7): each command exits 0 on its success fixture (fake port + `RecordingQueueSurface`) and its mapped non-zero code on refusal/abort fixtures; `runCli(["plan","--apply","--accept-low-confidence"])` exits **2** naming both flags with zero captured stdout, zero port requests, and zero filesystem effects; `check` exits 0 on the clean world, 8 on `review-report` (conflict task), and 5 when the report artifact is removed mid-test (missing artifact is never a silent 0); `bootstrap`/`sync` refuse without `--plan` (exit 2), with a wrong `--confirm` key (exit 4 `CONFIRMATION_KEY_MISMATCH`, complete listing), and succeed with the frozen gate trio; `enqueue`/`worker`/`install-hooks`/`install-agent-hook` surface fake outcomes (installed/enqueued/stopped/skipped → 0, refused → 4) and, in default-`QueueSurface` mode, exit 7 naming the missing module with zero side effects; `last-run` reads an engine-written marker (`--json` emits exactly one JSON object) and exits 0 with a clean "no run recorded yet" report when absent; every printed line screened (secret sentinel fixture)
- [ ] T018 [P] [US1] Write `tests/integration/cli-rollback-refusal.test.ts` (FR-004): journaling disabled (`EngineOptions` off via config/override) and journaling enabled with no journal for the target `runId` both exit **4** naming `MANIFEST_UNJOURNALED` with zero mutations (fake port call log) and byte-identical repo tree + state dir (pre/post hashes); a journaled apply then `rollback <runId>` exits 0 through the engine's reversal (SC-002 coverage of the rollback row)
- [ ] T019 [P] [US1] Write `tests/e2e/cli-bin-smoke.test.ts` (research R8b): spawn `node dist/cli/main.js` — `--help` exits 0 listing twelve commands; unknown command exits 2; `plan --apply` exits 2 with stderr naming `--apply` and the fixture repo tree byte-identical (FR-002 across a real process boundary, zero filesystem effects)
- [ ] T020 [US1] Write `tests/e2e/cli-child-process.test.ts` (research R8a): `writeDriver`-generated `driver.mjs` child processes importing `task-linear-sync/cli` with fake wiring over `tests/fixtures/cli/worlds/review-report/` and one 008 world — `plan` exits 0 and stdout names both state-dir artifact paths; `bootstrap --plan <id> --apply --confirm <key> --accept-low-confidence` exits 0; a usage error propagates exit 2 through the real process exit code

### Implementation for User Story 1

- [ ] T021 [P] [US1] Implement `src/cli/commands/inventory.ts` (research R7): 003 `discoverTaskFiles` + adapter registry + 004 `parseTaskFile` over **guarded deps with allowed prefixes `[]`** — deterministic ordering (repository-relative POSIX paths, framework id, task counts), screened stdout, zero tracker writes (makes T017 inventory rows pass)
- [ ] T022 [P] [US1] Implement `src/cli/commands/discover-metadata.ts` (research R7): guarded `port.discoverMetadata(configured teamKeys)` → screened per-team projects/workflow states/milestones listing, deterministic order, zero writes
- [ ] T023 [US1] Implement the `plan`/`check` shared lane in `src/cli/commands/plan.ts`: guarded deps (`allowedWritePrefixes = ["reports/","plans/"]`) → `engine.buildSyncPlan({ repositoryRoot })` (engine stage 7 persists + writes the report pair) → resolve paths via `derivePlanReportRunId(planId, clock)` on `state.paths.reports` → verify both artifacts exist (missing ⇒ exit 5 naming the artifact) → `plan` prints human artifact lines; `check` prints exactly one `CheckSummary` JSON object `{ schemaVersion: 1, planId, reportJson, reportMarkdown, counts }` with counts **read off the report artifact** (never re-derived; research R10) and exits 0 / 8 per contracts/command-surface.md §4
- [ ] T024 [US1] Implement `src/cli/commands/apply.ts` (research R9): load `StoredPlan` for `--plan <planId>` via `state.readJson` (absent ⇒ frozen `PLAN_REFERENCE_UNKNOWN` refusal path via the engine when the reference is passed; missing flag already exit 2 at parse) and call `engine.applySyncPlan(plan, GateRequest)` with `applyFlag`/`confirmationKey`/`acceptLowConfidence`/`planReference` mapped verbatim from flags — zero CLI-side gating; present `ApplyResult`: refused → exit 4 naming every `GateFailure.code` + detail (complete listing), aborted → exit 5, applied → exit 0 with operation counts + `reportPaths` (mode is engine-selected; CLI never forces bootstrap/sync)
- [ ] T025 [US1] Implement `src/cli/commands/rollback.ts`: `engine.rollbackRun(runId)`; `status: "refused"` ⇒ exit 4 naming `MANIFEST_UNJOURNALED`/`MANIFEST_EXPIRED` with the frozen `refusal.detail`, zero CLI-side mutation or write (FR-004); `rolled-back`/`partial` ⇒ exit 0 / exit 5 with `reversedOperations` presented (makes T018 pass)
- [ ] T026 [US1] Implement `src/cli/commands/queue.ts`: the five presentations over `context.queueSurface` — parse inputs (data-model §1) → invoke → map `QueueOutcome`/`LastRunOutcome` to stdout/stderr + exit per contracts/queue-surface.md §1 rule 2; `install-agent-hook` calls the surface with the canonical repo root and performs no port call itself (FR-003 enforcement lands at the seam + fake; makes T017 queue rows pass)
- [ ] T027 [US1] Complete `runCli` end-to-end dispatch in `src/cli/index.ts` (parse → context build with per-command guarded deps → handler table → `CliOutcome { exitCode }`) and confirm `src/cli/main.ts` propagates exit codes through the real process (makes T019/T020 pass)

**Checkpoint**: MVP — all twelve commands respond with the contract exit codes against the fake world; `npm test` green for `cli-*` at every tier

---

## Phase 4: User Story 2 - Approvable plan review report (Priority: P2)

**Goal**: The paired JSON (durable ids, frozen schema) + Markdown (human names) artifacts, produced by the engine lane, satisfy the complete FR-006 field set, FR-007 grouping/unmapped/parent/conflict rules, and the FR-008 security-assertions + content-exclusion guarantees, with the read-only guard aborting any injected write attempt.

**Independent Test**: `node scripts/run-tests.mjs --tier contract --test-name-pattern "cli-report"` plus `--tier integration --test-name-pattern "cli-plan-report|cli-report-zero|cli-readonly-violation"`: generate the pair over `review-report/` and `zero-task/`, validate against `specs/002-core-domain-contracts/contracts/plan-report.schema.json`, assert the enforcement checklist of contracts/plan-review-report.md §2, and prove SC-003 with injected mutation attempts (quickstart scenarios 4–6).

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T028 [P] [US2] Extract the minimal draft-2020-12 validator (subset: `type`/`const`/`enum`/`pattern`/`format`/`required`/`additionalProperties`/`properties`/`items`/`min|maxItems`/`minimum`/`maxLength`/`$ref`) into `tests/helpers/json-schema-mini.ts` as a **new shared file** (do not edit the frozen 002 `tests/contract/report-schema.test.ts`)
- [ ] T029 [P] [US2] Write `tests/contract/cli-report-schema.test.ts` (FR-006/008, plan-artifact.md § Test obligations): run `plan` via `runCli` over `review-report/` and `zero-task/`, parse the generated `reports/<runId>/report.json`, and validate it against the frozen schema with T028's validator (including `additionalProperties: false` at every level, `taskUuid` UUID pattern, `descriptionContentHash`/`fileHashes` `^[0-9a-f]{64}$` patterns, `alternatives.maxItems: 3`, `expectedMarkdownChanges[].maxLength: 512`, `securityAssertions.minItems: 1`); zero-task pair validates with empty `groups`/`unmapped`
- [ ] T030 [P] [US2] Write `tests/integration/cli-plan-report.test.ts` (FR-006/007/008, SC-001; contracts/plan-review-report.md §2): per-entry field set complete for every entry; groups sorted project→milestone; `unmapped[]` separate with `parentMapped` true **iff any descendant is mapped** (fixture proves mapped-sibling parent stays `false`); the conflict task is surfaced in BOTH artifacts (JSON entry flags; Markdown "awaiting human marker resolution" section); security-assertions block contains the computed `no-raw-body-or-description-fields` + `description-material-hashed-only` assertions with `status: "pass"`; sentinel raw task bodies/descriptions appear in **neither** artifact (0 occurrences, whole-corpus scan); Markdown uses human-readable project/milestone names while JSON carries `planId`/`taskUuid`/`issueId`; artifacts exist only under `reports/<runId>/` in the state dir; fixture repo tree byte-identical before/after (SC-003 zero repo writes)
- [ ] T031 [P] [US2] Write `tests/integration/cli-report-zero-task.test.ts` (spec edge case): `zero-task/` world ⇒ both artifacts render with empty task sections and a **passing** security-assertions block; `plan` exits 0; `check` exits 0 (no findings) and its JSON summary reports zero counts
- [ ] T032 [P] [US2] Write `tests/integration/cli-readonly-violation.test.ts` (FR-005, SC-003): via `makeRoguePort` — (a) an `updateIssue` attempt from inside a read call during `plan` and (b) a `writeJson("sync-state.json")` attempt during report generation each abort with `ReadOnlyViolationError` naming the attempt and exit **5**; fake port mutation-call count stays 0; state dir and repo tree byte-identical after the abort; the same attempts against `inventory` and `discover-metadata` (allowed prefixes `[]`) abort identically

### Implementation for User Story 2

- [ ] T033 [US2] Finalize the read-only enforcement wiring in `src/cli/commands/plan.ts` (guard composition from T013/T015; artifact-existence verification and exit-5 naming; `CheckSummary` counts sourced strictly from the parsed report JSON) and confirm `src/cli/commands/inventory.ts`/`discover-metadata.ts` run with allowed prefixes `[]` (makes T029–T032 pass; no new renderer exists or is added — research R4)

**Checkpoint**: Both stories independently functional — review reports approvable from the pair alone; contract tier proves schema conformance

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T034 [P] Write `tests/contract/cli-packaging.test.ts`: `package.json` `bin["task-linear-sync"]` points at `dist/cli/main.js` (exists post-build, executable shim resolves); the `./cli` export entry has `types` FIRST and both files emit (`dist/cli/index.js` + `.d.ts`); a **new** zero-dependency re-assertion file `tests/contract/cli-dependency-budget.test.ts` proves `dependencies` stays `{}` (do not edit the frozen budget tests); bin smoke pass runs under the compiled bin path
- [ ] T035 [P] Write `tests/contract/cli-hygiene.test.ts`: read-only lane import scan — `src/cli/commands/{plan,inventory,discover-metadata}.ts` must NOT import `applySyncPlan`, `rollbackRun`, or construct `GateRequest` (mirrors engine-gates §4 at the module boundary); no direct `node:http`/GraphQL/`src/tracker/` internals imports from `src/cli`; zero-org-literal scan over `src/cli/**`, `tests/fixtures/cli/**`, and `docs/cli.md` (UUID/`lin_api_`/secret/email-shaped values fail; only benign placeholders pass)
- [ ] T036 [P] Write `docs/cli.md` (documentation duty): synopsis + flags + one placeholder-identifier example per command, the full exit-code map table (codes 0–8), the `check` machine contract for 013, the review-report artifact pair and placement, the `QueueSurface` seam with its exit-7 placeholder refusal today and 010 wiring note (contracts/command-surface.md + queue-surface.md are the sources of truth)
- [ ] T037 Update `README.md`: mark the Operator CLI surface live (009), link `docs/cli.md`, add the plan → review report → gated apply → rollback operator loop as the headline usage scenario with placeholder identifiers
- [ ] T038 Run the full suite: `npm test` (all tiers + coverage gate lines 80 / branches 70 / functions 80) GREEN, quickstart.md scenarios 1–9 replayed, and every completed task marked `[X]` in this file

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Phase 1; **BLOCKS all user stories** (handlers dispatch through argv/context/exit; tests import harness types)
- **User Story 1 (Phase 3, P1)**: depends on Phase 2. MVP.
- **User Story 2 (Phase 4, P2)**: depends on Phase 2 and the T023 lane from US1 (the report pair is produced by the `plan` command); all other US2 work is enforcement/tests over that lane and independent of US1's mutating/queue commands
- **Polish (Phase 5)**: depends on both stories (packaging/hygiene contracts scan the finished `src/cli`, docs describe the shipped surface)

### Parallel Opportunities

- T002 ∥ T003 in Setup; T004–T007 (four unit-test files) in parallel; T008–T015 touch disjoint files (T009/T011 sequence only via the T010 schema table; T016 after T008/T009/T011 exist)
- Within US1: T017–T019 (tests, different files) in parallel; T021/T022 and T024/T025/T026 are disjoint handler files and parallelize once T016 dispatch exists; T027 is the serial finisher
- Within US2: T028→T029 sequential; T030/T031/T032 in parallel; T033 serial after them
- T034/T035/T036 in Polish run in parallel

### Parallel Example: User Story 1

```bash
# Tests first (must fail), all different files:
Task: "Twelve-command exit matrix in tests/integration/cli-commands.test.ts"          # T017
Task: "Rollback refusal tests in tests/integration/cli-rollback-refusal.test.ts"      # T018
Task: "Bin smoke tests in tests/e2e/cli-bin-smoke.test.ts"                            # T019
# Then disjoint handlers:
Task: "inventory command in src/cli/commands/inventory.ts"                            # T021
Task: "discover-metadata command in src/cli/commands/discover-metadata.ts"            # T022
Task: "apply command in src/cli/commands/apply.ts"                                    # T024
Task: "rollback command in src/cli/commands/rollback.ts"                              # T025
Task: "queue-surface presentations in src/cli/commands/queue.ts"                       # T026
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL) → 3. Phase 3 US1 → 4. **STOP and VALIDATE**: quickstart scenarios 1–3 + 7 pass; the twelve commands answer with contract exit codes → 5. Ship: 013 can already wrap `check`/`plan`.

### Incremental Delivery

1. Setup + Foundational → pure core ready.
2. US1 → command surface live (queue commands honestly refuse, exit 7) → MVP.
3. US2 → review report proven approvable (schema + field set + exclusions + read-only abort).
4. Polish → packaging/hygiene contract tests + `docs/cli.md` + README + full-suite gate.
5. Later wave: 010 binds the real `QueueSurface` behind contracts/queue-surface.md — no `src/cli` edits expected.

---

## Notes

- **[P]** marker = different files, no dependencies; verify each test FAILS before its implementation task
- Frozen modules (`src/domain|config|state|urls|gates|ports`, 003–008 groups) and frozen contract tests are **import-only** — this file schedules no task that edits them
- Zero new runtime dependencies at every checkpoint; the two `package.json` edits (T001) are additive only
- Commit after each task or logical group following repo style: `feat(009): …` / `test(009): …` / `docs(009): …`
