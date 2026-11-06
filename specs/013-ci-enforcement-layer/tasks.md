---

description: "Task list for feature 013 — CI/CD enforcement layer"

---

# Tasks: CI/CD Enforcement Layer

**Input**: Design documents from `specs/013-ci-enforcement-layer/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/ (action.md, wrapper-api.md), quickstart.md

**Tests**: INCLUDED — constitution VI (Test-First, NON-NEGOTIABLE) and plan.md mandate automated coverage for every FR/SC, including contract and security tiers. Story-phase tests are written FIRST and must FAIL before their implementation tasks.

**Organization**: The spec carries one user story (pre-merge enforcement, P1); per the plan decomposition the implementation is split into two independently deliverable stories: **US1 (P1)** — the gating conditions evaluate from the report JSON (wrapper core, artifact-direct end-to-end); **US2 (P2)** — the distributable action surface (published-CLI wrapping, `action.yml`, toggles/thresholds as action inputs, outputs/exit map). Every US1 acceptance scenario maps to at least one task below (quickstart traceability table).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = condition evaluation from report JSON (P1); US2 = action surface + CLI wrapping (P2)
- All frozen 002 modules and Wave-2/3 modules (003–008) plus sibling Wave-4 groups (009–012) are **import-only** — never edit them. 013 touches only `src/ci/**`, `action.yml`, `tests/{unit,contract,integration,e2e}/ci-*`, `tests/helpers/ci-harness.ts`, `tests/fixtures/ci/**`, one additive `package.json` exports entry, `docs/ci-enforcement.md`, README status lines, and this specs folder.
- Zero new runtime dependencies; NO edits to `package.json` beyond the one additive `"./ci"` exports entry (no new `bin`, no dependency-set change — research R2; `tests/contract/cli-dependency-budget.test.ts` posture is re-asserted, not edited). Node 20 APIs only; no experimental flags; `node:child_process` spawn WITHOUT a shell; `node:fs` limited to `readFileSync`/`existsSync` + `appendFileSync` ONLY in `src/ci/main.ts` (`$GITHUB_OUTPUT`, env-gated).
- The wrapper NEVER imports engine execution, gates, tracker, or CLI internals — it SPAWNS the published read-only CLI (`check`/`plan`) and READS the plan-report JSON (constitution V; wrapper-api.md §5). All paths are repository-root-relative.

## Path Conventions

Single npm package: `src/ci/` (013's disjoint module group), `action.yml` (repo root), `tests/{unit,contract,integration,e2e}/`, `tests/helpers/ci-harness.ts`, `tests/fixtures/ci/**`. Tests run via `node scripts/run-tests.mjs` tiers with `node:test` + `node:assert/strict`, the frozen 007 fake (behind a spawned `writeCliEntry` driver over 009/008 fixture worlds), `fixedClock`, hermetic temp workspaces + temp state dirs **outside** the repo working tree, and `hashTree` before/after equality for the zero-repo-write proofs. Fixture literals are placeholders only (the defaults scan fails real org ids/tokens/UUID-looking secrets).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Packaging surface and module skeleton for the ci module group

- [X] T001 Add one additive `"./ci"` subpath export to `package.json` (`types` `./dist/ci/index.d.ts`, `default` `./dist/ci/index.js`) — zero dependency changes, zero other manifest edits, no new `bin` (research R2; contracts/wrapper-api.md §5)
- [X] T002 Create the empty module group skeleton: `src/ci/index.ts` placeholder barrel + `src/ci/errors.ts` (closed `EnforcementExitCode` enum `SUCCESS=0`/`VIOLATION=1`/`CONFIGURATION=2`/`CLI_FAILURE=3` + error classes `CiConfigError`/`CiArtifactError`/`CiCliFailureError` with stable `name`s) so the build has a target; `npm run typecheck` + `npm run build` pass and emit `dist/ci/index.js` + `dist/ci/index.d.ts`

**Checkpoint**: Packaging entry + skeleton compile; nothing functional yet

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives both stories depend on: settings validation, error taxonomy completion, fixture report corpus, test harness

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail)

- [X] T010 [P] Write unit tests for settings in `tests/unit/ci-settings.test.ts` (data-model §1–§2; research R6/R10): defaults are ALL toggles `true`, BOTH thresholds `0`, `command "check"`, `reportPath`/`configFile`/`cliEntry` null (FR-002 defaults; Req 26 criterion 13); boolean parsing is the CLOSED set `{true,false,1,0}` case-insensitive (anything else is a problem); thresholds satisfy `Number.isInteger && >= 0`; `command` is the closed enum `"check" | "plan"`; invalid inputs collect ALL problems into exactly ONE dotted-key line (complete listing, never fail-fast) and throw `CiConfigError`; flags win over `TLS_CI_*` env, env wins over defaults; CSV `protected-branches` splits on commas with trim + empty-drop; branch resolution order: input → `GITHUB_BASE_REF` → `GITHUB_REF_NAME` (`refs/heads/` prefix stripped) → null, and protected-set order: input CSV → `{GITHUB_BASE_REF}` when non-empty → `[]` (research R6 — a push run with no configured set resolves EMPTY); resolved defaults carry zero org identifiers

### Implementation for Foundational

- [X] T011 Create the fixture report corpus in `tests/fixtures/ci/reports/` (schema-valid per `specs/002-core-domain-contracts/contracts/plan-report.schema.json`, placeholder identifiers + sentinel body/description strings that can never legally appear in a report): `clean.json`, `violates-all-three.json` (1 high-band `issueId: null` entry, 2 `unresolvedConflict: true` entries, 3 drifted matched entries), `conflict-blocks.json`, `drift-spec-changed.json` (incl. a `reasons: ["conflict:spec-changed"]` skip-recorded `no-change` entry and a `linear-changed` conflict with `changedFields: ["description"]`), `drift-boundaries.json` (count EXACTLY at thresholds), `high-band-null-issue.json`, `unmatched-not-high.json` (band `"unmatched"` + `decision: "create"` entries — condition (a)/(c) must ignore), `malformed.json` (structural violation: `schemaVersion: 2` + non-array `groups`), `not-report.json` (valid JSON, not a report), and `tests/fixtures/ci/README.md` recording the placeholder conventions
- [X] T012 Create `tests/helpers/ci-harness.ts` on the `buildCliWorld`/`writeDriver` base (research R12): `writeCliEntry(entryPath, worldOpts)` — emits a `cli-entry.mjs` that acts as the published bin: wires the 007 fake port + `fixedClock` + temp state dir from a world fixture (009 driver conventions, RAW stdout single-object posture — no `OUT|` prefixes), runs the REAL CLI core via `task-linear-sync/cli` `runCli` with argv from `process.argv.slice(2)` (`command [repo] [--config]`), appends its invoked argv to a JSONL census file, mirrors stdout/stderr, sets `process.exitCode`; `runWrapper(args, { env, entry, workspace, outputFile })` — spawns `node dist/ci/main.js` with the args, a constructed env view (`GITHUB_BASE_REF`/`GITHUB_REF_NAME`/`GITHUB_OUTPUT`/`TLS_CI_*`), captures stdout/stderr/exitCode and the `$GITHUB_OUTPUT` file contents; `githubEnv({ eventName: "pull_request" | "push", baseRef?, refName? })` env builder; fixture-report copy helper into hermetic temp dirs; re-export `hashTree`/`listTree` from `cli-harness.ts`
- [X] T013 Complete `src/ci/errors.ts`: message-carrying constructors, `problems: string[]` bag on `CiConfigError` (complete listing rendered as ONE line), artifact-path-carrying `CiArtifactError`, command/exit-code-carrying `CiCliFailureError` (data-model §7; wrapper-api.md §3)

**Checkpoint**: Settings, taxonomy, fixtures, and harness proven — story phases touch disjoint files from here

---

## Phase 3: User Story 1 - Gating conditions evaluate from the report JSON (Priority: P1) 🎯 MVP

**Goal**: From a plan-report JSON artifact (artifact-direct mode — no CLI process needed), the three conditions evaluate exactly per data-model §3, disabled conditions never fail, pass/fail statuses and the screened summary are produced (FR-002 semantics, FR-003, all three spec edge cases).

**Independent Test**: Feed the fixture corpus through `runEnforcement` with `{reportPath}` and stub screener — per-condition triggers, toggle matrix, offending counts in the summary, non-zero-worthy fail status on triggers, pass on clean, input-error on malformed (spec Independent Test + quickstart Scenarios 1–3).

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T020 [P] [US1] Write unit tests for evaluation in `tests/unit/ci-evaluate.test.ts` (data-model §3; research R5/R6/R7): condition (a) counts entries with `confidence === "high" && issueId === null` (unmatched-band and create entries NEVER count); condition (b) counts `unresolvedConflict === true` ONLY (a `decision: "conflict"` entry without the flag does NOT count); condition (c) counts ONLY entries with `issueId !== null` AND (`reasons` includes `"conflict:spec-changed"` OR `"conflict:both-changed"` OR `changedFields.length > 0` OR `expectedMarkdownChanges.length > 0`) — create/unmatched entries never count, a skip-recorded `conflict:spec-changed` `no-change` entry DOES count; trigger semantics are STRICTLY "exceeding" for (a)/(c) (`count > threshold`; at-threshold passes) and BINARY for (b) (`count >= 1`) which additionally requires `targetBranch ∈ protectedBranches`; empty protected set or null target with (b) enabled ⇒ `protectionSkipped: true` and (b) never triggers; ALL SIX toggle combinations plus all-on/all-off: disabled conditions are counted but NEVER enter `triggered`; all-three-at-once names all three with counts in stable order (a)(b)(c); full 2×2×2 toggle matrix over one fixture; deterministic pure function (same bytes ⇒ same result, no clock/randomness)
- [ ] T021 [P] [US1] Write unit tests for artifact loading + locators in `tests/unit/ci-report-input.test.ts` (data-model §5–§6; research R4): load + validate every VALID fixture (structural read set: `schemaVersion === 1`, 64-hex `planId`, `groups[]` with `entries[]`, `unmapped` array; per-entry types for `issueId`/`confidence`/`reasons`/`changedFields`/`expectedMarkdownChanges`/`unresolvedConflict`) — additionally assert every valid fixture validates against the frozen `plan-report.schema.json` via `tests/helpers/json-schema-mini.ts`; missing file ⇒ `CiArtifactError` naming the path; unparseable JSON ⇒ same; `malformed.json`/`not-report.json` ⇒ structural violation naming the artifact; `check` locator: exactly-one-JSON-object stdout parses (schemaVersion 1, 64-hex planId, non-empty `reportJson`); extra stdout noise / empty / no-JSON ⇒ error naming the command; `plan` locator: `plan <hex>` + first `report <path>.json` line; locator `planId` ≠ artifact `planId` ⇒ provenance error naming both
- [ ] T022 [P] [US1] Write unit tests for the summary in `tests/unit/ci-summary.test.ts` (research R8; wrapper-api.md §4): pass line EXACTLY `task-linear-sync enforcement passed (unmapped-high-confidence: N, unresolved-conflict-block: N, spec-drift: N)`; fail line EXACTLY `task-linear-sync enforcement failed — <id>: <count>[; …]` over triggered conditions only, stable order; protection-skip warning line exact text; a spy screener proves EVERY emitted line passes the screener first; fixture sentinel body/description strings appear in NO output line; counts of DISABLED conditions still appear in the pass line; planId/branch values are screened
- [ ] T023 [P] [US1] Write integration tests in `tests/integration/ci-enforcement-conditions.test.ts` (SC-001; quickstart Scenarios 1–3): `runEnforcement` artifact-direct (no invoker dependency) over the full fixture corpus at DEFAULT settings — fails exactly the violating fixtures, passes all clean ones (0 FN / 0 FP); toggle matrix through orchestration (disabled ⇒ `status "pass"` despite signal); thresholds via settings (at-threshold pass, above fail); outcome `outputs` map carries `status`/`unmapped-count`/`conflict-count`/`drift-count`/`summary`/`report-json`; malformed/missing artifact ⇒ `runEnforcement` THROWS `CiArtifactError` (never returns a pass); branch env matrix: PR-shaped env triggers (b), push-shaped empty-set env passes with `protectionSkipped`, explicit `protected-branches: ["main"]` + `targetBranch: "main"` triggers

### Implementation for User Story 1

- [ ] T024 [P] [US1] Implement pure condition evaluation in `src/ci/evaluate.ts`: `evaluateConditions(parsedReport, settings): EvaluationResult` — flatten `groups[].entries[]` in artifact order, count all three conditions ALWAYS, `triggered` from enabled-only predicates per data-model §3 (strict `>` for (a)/(c); (b) binary + branch-classification gate + `protectionSkipped`), `CONDITION_IDS` stable-order constant (makes T020 pass)
- [ ] T025 [US1] Implement `src/ci/report-input.ts`: `loadReportArtifact(path)` (read + parse + structural validation of the §5 read set — `CiArtifactError` naming the artifact on ANY failure) + `parseLocator({ command, stdout })` (check single-JSON-object mode; plan `report <path>.json` line mode; provenance cross-check) per data-model §5–§6 (makes T021 pass)
- [ ] T026 [US1] Implement `src/ci/summary.ts`: `renderSummary(evaluation, { screener })` producing the §4 exact-format lines (pass/fail/warning), every line screened before return, counts always present in the pass line (makes T022 pass)
- [ ] T027 [US1] Implement orchestration in `src/ci/enforcement.ts` + finalize the `src/ci/index.ts` barrel (wrapper-api.md §1–§2 exported names): `runEnforcement(settings, deps)` — artifact-direct path first (`settings.reportPath` ⇒ load + evaluate + summarize, NO invoker), CLI-mode path stubbed to throw `CiCliFailureError` pending US2 wiring; `EnforcementDeps` seams `{ cliInvoker?, screener, env, log }`; outcome shape per data-model §4 including the outputs map (makes T023 pass)

**Checkpoint**: MVP — enforcement core evaluates all three conditions from the report JSON alone; quickstart Scenarios 1–3 pass

---

## Phase 4: User Story 2 - Action surface: published-CLI wrapping, action.yml, toggles/thresholds (Priority: P2)

**Goal**: The wrapper invokes the published read-only CLI as a child process (`check` default, `plan` supported), consumes the CheckSummary locator + report artifact, ships as `action.yml` + compiled wrapper with the thirteen inputs / six outputs, and exhibits the exit map on real spawned runs.

**Independent Test**: Spawn `node dist/ci/main.js` against a spawned real-CLI entry (fake tracker over fixture worlds) — pass/fail/toggle-off scenarios, branch env matrix, `$GITHUB_OUTPUT` contents, exit codes 0/1/2/3, leak and zero-write checks (quickstart Scenario 4).

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T030 [P] [US2] Write unit tests for the CLI seam in `tests/unit/ci-cli-invoker.test.ts` (research R3; wrapper-api.md §2): with an injected fake spawn — argv is `[entry, "check"|"plan", workspace, ("--config", file)?]`, NEVER a shell option, NEVER `bootstrap`/`sync`/`--apply`/`--confirm` tokens (closed command set); entry resolution order explicit → action-root `dist/cli/main.js` → workspace `dist/cli/main.js` → workspace `node_modules/task-linear-sync/dist/cli/main.js`, miss ⇒ `CiCliFailureError` naming EVERY candidate; exit `0` AND `8` both resolve (proceed), any other exit ⇒ `CiCliFailureError` naming command + exit code + screened stderr tail; spawn error ⇒ same class; env is inherited (credential vars pass through untouched, never logged)
- [ ] T031 [P] [US2] Write e2e tests in `tests/e2e/ci-enforcement-action.test.ts` (FR-001/FR-003; SC-001–003; quickstart Scenario 4) using `tests/helpers/ci-harness.ts` (spawned wrapper main + spawned real CLI core behind `writeCliEntry` with the fake port over temp-copied 009/008 fixture worlds — clean / conflict-marker / drift): clean world ⇒ exit 0 + `status=pass` outputs; conflict-marker world with `githubEnv({ eventName: "pull_request", baseRef: "main" })` ⇒ exit 1, summary names `unresolved-conflict-block` + count; same world, `push` env with no configured set ⇒ exit 0 + protection-skip warning; same world with `--protected-branches main --branch main` ⇒ exit 1; `--fail-on-conflicts false` ⇒ exit 0 (disabled NEVER fails); drift world ⇒ exit 1 naming `spec-drift`; `--command plan` locator path ⇒ same evaluation; malformed `--report` ⇒ exit 2 naming the artifact, NO outputs written; CLI-failure world (entry that exits 5) ⇒ exit 3; `$GITHUB_OUTPUT` file carries exactly the six outputs on pass/fail runs and is absent when the env var is unset; every wrapper output line free of the world's sentinel bodies/descriptions (SC-003); `hashTree(workspace)` byte-identical before/after every run AND fake-port census shows zero mutations (SC-002); CLI-entry argv census shows ONLY `check`/`plan` invocations

### Implementation for User Story 2

- [ ] T032 [US2] Implement `src/ci/cli-invoker.ts`: `CliInvoker`/`CliRequest`/`CliResult` types + `createSpawnCliInvoker({ spawn? })` — injectable spawn (default `node:child_process.spawn`, `stdio: ["ignore","pipe","pipe"]`, NO shell, inherited env), entry resolution per research R3, argv built from the closed command set + `--config` only, 0/8-acceptance and failure mapping per wrapper-api.md §2 (makes T030 pass)
- [ ] T033 [US2] Wire the CLI-mode path in `src/ci/enforcement.ts`: no `reportPath` ⇒ invoke `deps.cliInvoker ?? createSpawnCliInvoker(...)` → `parseLocator` → `loadReportArtifact` → evaluate/summarize unchanged (provenance-checked); `src/ci/index.ts` barrel updated (makes the CLI-mode half of T031 possible)
- [ ] T034 [US2] Implement the process adapter `src/ci/main.ts` (the ONLY `process` consumer in `src/ci/`): flags/env → `resolveSettings` → default deps (screener via `createDefaultSecurityScreener(loadConfig({ repositoryRoot: workspace }) || loadConfig({}))` — screening import only) → `runEnforcement` → screened stdout/stderr → `$GITHUB_OUTPUT` append (`appendFileSync`, only when the env var is defined; six outputs per contracts/action.md §3, no outputs on exit 2/3) → `process.exitCode` per the exit map (0/1/2/3; ANY unmapped throw ⇒ sanitized one-line + exit 2, never a stack, never 0)
- [ ] T035 [US2] Author `action.yml` at the repository root EXACTLY per contracts/action.md §1–§5: `runs.using: composite`, bash steps (build-guard `test -f "$ACTION_ROOT/dist/ci/main.js" || (cd "$ACTION_ROOT" && npm ci && npm run build)` gated by `auto-build`; enforcement step invoking `node "$ACTION_ROOT/dist/ci/main.js"` with non-default inputs mapped to flags), the thirteen inputs with their exact defaults, the six outputs, no credential input, zero org identifiers anywhere

**Checkpoint**: Distributable action complete — quickstart Scenario 4 passes end-to-end

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T040 [P] Write contract test `tests/contract/ci-action-shape.test.ts` (contracts/action.md): a purpose-built minimal YAML reader (no YAML dependency) parses the committed `action.yml`; assert the exact `name`/`description`/`author` strings, the EXACT thirteen input names with their EXACT defaults (incl. `workspace: ${{ github.workspace }}`), the EXACT six output names, `runs.using: composite` (never `node20`/`docker`), bash shells, the build-guard step, and the `node .../dist/ci/main.js` entry; no input named like a credential (`token`/`key`/`secret`)
- [ ] T041 [P] Write contract test `tests/contract/ci-hygiene.test.ts` (wrapper-api.md §5; precedent `tests/contract/engine-no-direct-tracker.test.ts`): source scan over `src/ci/**` — ZERO imports of `src/gates`/`src/tracker`/`src/queue`/`src/history-server`/`src/mcp`/`src/cli`/any `task-linear-sync/*` specifier; from `src/engine` ONLY `createDefaultSecurityScreener` (never `createSyncEngine`/`buildSyncPlan`/`applySyncPlan`/`rollbackRun`); no `fetch(`/transport built-ins/`WebSocket`/GraphQL naming/`lin_api_` shapes/`Authorization`; `node:child_process` ONLY in `cli-invoker.ts`; `node:fs` imports limited to `readFileSync`/`existsSync` + `appendFileSync` ONLY in `main.ts`; no `--apply`/`--confirm`/`accept-low-confidence` vocabulary outside the argv allowlist; zero clock/randomness imports in `evaluate.ts`/`report-input.ts`/`summary.ts` (SC-002 structural proof)
- [ ] T042 [P] Write contract test `tests/contract/ci-packaging.test.ts` (wrapper-api.md header): `task-linear-sync/ci` resolves to built `dist/ci/index.js` + generated `.d.ts`; the exported names match the contract list exactly; `dependencies` stay exactly `{}` and no `peerDependencies`/`optionalDependencies` appear (re-assert, do not edit, `cli-dependency-budget` posture); the `bin` map is unchanged
- [ ] T043 [P] Write contract test `tests/contract/ci-defaults-scan.test.ts` (Principle III; Req 26 criterion 14): run the defaults-scan token set (UUID-shaped, `lin_api_`, hex/base64/PEM secrets, email, real-org patterns) over the `action.yml` text, `src/ci/**` string literals, `docs/ci-enforcement.md`, and `tests/fixtures/ci/**` — zero hits (placeholder/example.invalid values only)
- [ ] T050 Write `docs/ci-enforcement.md` (documentation duty; Req 27 criterion 7): purpose + read-only posture, the three conditions with exact predicates and defaults, the inputs/outputs tables (mirroring contracts/action.md), protected-branch resolution rules, the exit map, a full example workflow invocation with a read-scoped credential via `env:` (placeholder identifiers), standalone `node dist/ci/main.js` usage, and the artifact-direct mode — zero org identifiers
- [ ] T051 Update `README.md`: status line for 013 (CI enforcement shipping on `wave-4-surfaces`), the `./ci` subpath added to the published-exports list, module-tree mention, and a pointer to `docs/ci-enforcement.md` (placeholder identifiers only)
- [ ] T060 Run the full quickstart.md validation (Scenarios 1–5) against built `dist/` and fix any drift between artifacts and behavior
- [ ] T061 Run `npm test` (full suite, all tiers) — GREEN with the coverage gate held (lines 80 / branches 70 / functions 80) by 013's own tests; mark completed tasks `[X]` in this file

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: start immediately (T001 ∥ T002)
- **Phase 2 (Foundational)**: after Phase 1 — BLOCKS both stories; within phase: T010 → T014, T011/T012 independent, T013 after T002
- **Phase 3 (US1, MVP)**: after Phase 2; tests T020–T023 (parallel) written first and FAILING, then T024/T025/T026 (parallel), then T027
- **Phase 4 (US2)**: after Phase 3 (wires onto `enforcement.ts`; tests T030/T031 first, then T032 → T033 → T034 → T035)
- **Phase 5 (Polish)**: after both stories (T040–T043 parallel; T050/T051 parallel; T060 → T061 last)

### User Story Dependencies

- **US1 (P1)**: needs only Foundational — independently deliverable (artifact-direct enforcement is a complete feature)
- **US2 (P2)**: builds on US1's evaluation core (same module group) — independently testable end-to-end via spawned processes

### Parallel Opportunities

- T001 ∥ T002; T010 ∥ T011 ∥ T012; T020 ∥ T021 ∥ T022 ∥ T023 (tests), T024 ∥ T025 ∥ T026 (impl); T030 ∥ T031 (tests); T040 ∥ T041 ∥ T042 ∥ T043; T050 ∥ T051

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (must fail before implementation):
Task: "Unit tests for evaluation in tests/unit/ci-evaluate.test.ts"        # T020
Task: "Unit tests for artifact loading + locators in tests/unit/ci-report-input.test.ts"  # T021
Task: "Unit tests for the summary in tests/unit/ci-summary.test.ts"        # T022
Task: "Integration tests in tests/integration/ci-enforcement-conditions.test.ts"          # T023

# Launch independent implementation modules together:
Task: "Implement evaluation in src/ci/evaluate.ts"     # T024
Task: "Implement artifact loading in src/ci/report-input.ts"  # T025
Task: "Implement summary in src/ci/summary.ts"         # T026
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 → **STOP and VALIDATE** quickstart Scenarios 1–3 (artifact-direct enforcement is fully usable in any CI via `--report`)

### Incremental Delivery

1. Setup + Foundational → harness, fixtures, settings, taxonomy proven
2. US1 → condition evaluation from the report JSON (quickstart 1–3 green) — MVP
3. US2 → spawned-CLI mode + `action.yml` + outputs/exit map (quickstart 4 green)
4. Polish → contract scans + docs duty + full-suite validation (quickstart 5 + `npm test`)

---

## Notes

- [P] tasks = different files, no dependencies; tests precede their implementation and MUST fail first (constitution VI)
- Commit after each phase checkpoint (`feat(013): …` / `test(013): …` / `docs(013): …` per repo history style); mark tasks `[X]` as completed
- The zero-write proof (`hashTree`), the argv census, and the hygiene scan are the SC-002 evidence trio — none of the three may be skipped
- Never edit frozen modules, the CLI exit-code map, or the frozen report schema; 013's exit map (0/1/2/3) is its OWN, documented vocabulary

## Execution deviations (recorded during implementation)

- **Settings implementation has no standalone task id.** The Dependencies
  section's "T010 → T014" references a task that does not exist in this file;
  `src/ci/settings.ts` (`resolveSettings`) was implemented alongside T013 in
  Phase 2 as the implicit implementation target of T010, and is covered by the
  T010 unit tests. No other file depends on it being split out.
- **Fixture generation helper.** T011's corpus is emitted by the committed
  deterministic generator `tests/fixtures/ci/build-fixture-reports.mjs`
  (regeneration is byte-identical); the JSON files are committed artifacts.
- **Pre-existing lint fix.** `tests/contract/mcp-credential-sentinel.test.ts`
  carried an unused `mkdirSync` import (012 leftover; `npm test` does not run
  eslint). Removed so `npm run lint` is green; zero behavior change.
