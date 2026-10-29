---

description: "Task list for feature 008 — Sync Engine: Conflict Resolution, State Persistence, Apply, and Rollback"

---

# Tasks: Sync Engine — Conflict Resolution, State Persistence, Apply, and Rollback

**Input**: Design documents from `specs/008-sync-engine-apply-rollback/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/ (engine-pipeline, conflict-resolution-matrix, history-log, journal-rollback), quickstart.md

**Tests**: INCLUDED — constitution VI (Test-First, NON-NEGOTIABLE) and plan.md mandate automated coverage for every FR/SC, including property-based, contract, and security tiers. Story-phase tests are written FIRST and must FAIL before their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = conflict-aware reconciliation (P1); US2 = gated apply + rollback (P2)
- All frozen 002 modules and Wave-2 modules (003–007) are **import-only** — never edit them (ROADMAP rule 2). 008 touches only `src/engine/**`, `tests/**/engine-*`, `tests/helpers/engine-harness.ts`, `tests/fixtures/engine/**`, one additive `package.json` exports entry, and this specs folder.
- All paths are repository-root-relative.

## Path Conventions

Single npm package: `src/engine/` (008's disjoint module group), `tests/{unit,contract,integration,e2e}/`, `tests/fixtures/engine/worlds/`. Tests run via `node scripts/run-tests.mjs` tiers (`unit`, `contract`, `integration`, `e2e`) with `node:test` + `node:assert/strict`, the 007 fake `LinearPort` (imported from `./tracker/testing`), a temp-directory state store, and an injected fixed `Clock` — zero network, zero credentials.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Packaging surface and test scaffolding for the engine module group

- [X] T001 Add one additive `"./engine"` subpath export to `package.json` (types `./dist/engine/index.d.ts`, default `./dist/engine/index.js`) — zero dependency changes, zero other manifest edits (research R1)
- [X] T002 [P] Create `tests/fixtures/engine/README.md` (fixture conventions: placeholders only, zero real organization identifiers/team keys/tokens/UUIDs) and the ten world directories under `tests/fixtures/engine/worlds/`: `first-run-bootstrap/`, `linear-changed/`, `spec-changed/`, `both-changed/`, `unresolved-block/`, `completion-toggle/`, `indeterminate-create/`, `history-rollover/`, `formatting-noise/`, `rollback-full/`, `rollback-interrupted/`
- [X] T003 Create `tests/helpers/engine-harness.ts`: fixture-repo builder (reads `tests/fixtures/engine/worlds/<world>/`), seeded fake `LinearPort` world builder, temp-directory `StateStore`, fixed injected `Clock`, `createSyncEngine` factory against the frozen `SyncEngine` interface, and injectors for scripted create failures and rollback interruption at an exact step index (per quickstart.md Harness section)

**Checkpoint**: Packaging entry + harness skeleton exist (harness types against the frozen `SyncEngine` so it compiles before `src/engine` exists)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Engine-local primitives both stories depend on: error taxonomy, options, normalization, screening, mode/checkpoint store, composition-root skeleton

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write first, must fail)

- [X] T004 [P] Write unit tests for checkpoint store + mode selection in `tests/unit/engine-mode.test.ts` (FR-001, data-model §1–2): no checkpoint record for the repo ⇒ `bootstrap`; ≥1 checkpoint ⇒ `sync`; `BuildPlanOptions.mode` hint is advisory — reality wins and a disagreeing hint yields a sanitized diagnostic reason; store file schema `{ schemaVersion: 1, checkpoints: Record<taskUuid, Checkpoint> }` at `sync-state.json`, read/written exclusively via `StateStore.readJson`/`writeJson`
- [X] T005 [P] Write unit tests for the built-in `"default"` normalization profile in `tests/unit/engine-normalize.test.ts` (research R5, SC-002): idempotent; equates the 004/007 round trip (`normalize(mirror(render(x))) === normalize(x)`); rules — CRLF/CR→LF, tabs-in-blank-lines stripped, trailing whitespace per line removed, runs of blank lines collapsed to one, single trailing newline enforced, Unicode NFC; MUST NOT alter content-bearing Markdown (emphasis, list markers, heading `#` counts, code fences)
- [X] T006 [P] Write unit tests for the default SecurityScreener in `tests/unit/engine-screening.test.ts` (research R12): blocking categories — token/secret-shaped strings (high-entropy assignments, known provider key prefixes), private key blocks; non-blocking — email addresses redacted in output, configurable review-term annotations; `screen()` returns `{ output, blocked, findings }` per the frozen `src/ports/engine.ts` shape; ruleset injectable via `EngineOptions.screener`

### Implementation for Foundational

- [X] T007 Implement the `EngineError` taxonomy in `src/engine/errors.ts` (research R14): `EngineFailError` (fail action), `IntegrityError` (multi-issue identity collision), `JournalError` (tamper/unreadable journal); user-facing refusals reuse frozen `GateFailure` codes verbatim — NO new refusal vocabulary
- [X] T008 Implement `EngineOptions` in `src/engine/options.ts` per contracts/engine-pipeline.md: `keyProvider?` (manifest/step-journal key source, default env-var name from config `manifestKeyEnvVarName` + `manifestKeyId`; null ⇒ key unavailable ⇒ abort), `normalizationProfiles?` (registry extension; built-in `"default"` always present), `journalingEnabled?` (default `true`; false ⇒ unjournaled applies and rollback refusal)
- [ ] T009 Implement the normalization-profile registry + built-in `"default"` profile in `src/engine/normalize.ts` (makes T005 pass)
- [ ] T010 Implement the built-in `SecurityScreener` in `src/engine/screening.ts` (makes T006 pass)
- [ ] T011 Implement `selectMode` + the CheckpointStore (read at plan start, atomic whole-file write, restore/remove semantics material) in `src/engine/mode.ts` (makes T004 pass)
- [X] T012 Implement the composition-root skeleton `createSyncEngine(deps: EngineDependencies, options?: EngineOptions): SyncEngine` in `src/engine/create.ts` plus the `src/engine/index.ts` public surface for `./engine`: returns an object implementing the frozen `SyncEngine` 3-method contract; methods throw `EngineError` until wired in later phases; imports restricted to Node built-ins + `src/{domain,config,state,urls,gates,ports,discovery,parsing,routing,titles,matching,tracker}` (research R1)

**Checkpoint**: Foundation ready — user story implementation can now begin (US1 and US2 primitives are disjoint files)

---

## Phase 3: User Story 1 - Conflict-aware reconciliation on later runs (Priority: P1) 🎯 MVP

**Goal**: Bootstrap-vs-sync mode selection with per-mode action maps; three-way description conflict classification via normalized hashes; six resolution actions with FR-004 defaults; git-style conflict-marker blocks with the frozen-block rule; checkbox→workflow completion mapping; every applied action's reason surfaced.

**Independent Test**: Run `node scripts/run-tests.mjs --tier unit --test-name-pattern engine-` plus `--tier integration --test-name-pattern engine-bootstrap|engine-conflict-freeze`. With a checkpoint in place, mutate (a) only the issue description, (b) only the task section, (c) both in each fixture world and verify plan-level effects: classification, resolved action + reasons, planned effect (marker block text, push/no-push), frozen-block skip — all against the hermetic fake with zero mutations during `buildSyncPlan` (end-to-end effect execution through apply is exercised in US2, Phase 4, per contracts/conflict-resolution-matrix.md and quickstart.md 1.1–1.7).

### Tests for User Story 1 (write first, must fail) ⚠️

- [X] T013 [P] [US1] Write classification unit tests in `tests/unit/engine-classify.test.ts` (FR-002, data-model §3): `specChanged = sha256(normalize(section)) ≠ checkpoint.descriptionContentHash`, `linearChanged = sha256(normalize(issueDescription)) ≠ same`; both ⇒ `both-changed`, spec-only ⇒ `spec-changed`, linear-only ⇒ `linear-changed`, neither ⇒ `null`; bootstrap: identical-after-normalization ⇒ `null`, any meaningful difference ⇒ `both-changed`; `titleChanged`/`checkedChanged`/`stateTypeDrift` tracked separately and never routed through the description machinery; formatting-only drift ⇒ `null` on both sides (SC-002)
- [X] T014 [P] [US1] Write action-resolution unit tests in `tests/unit/engine-actions.test.ts` (FR-003/004/005): built-in `bootstrapConflictDefaults` (all three types ⇒ `overwrite-linear`) and `syncConflictDefaults` (`spec-changed`⇒`overwrite-linear`, `linear-changed`⇒`overwrite-spec`, `both-changed`⇒`report-only`) exported from `src/engine/actions.ts`; table-driven 36-cell matrix (6 actions × 3 conflict types × 2 modes) over the pure resolver (research R6); `prefer-newer` recency rule per conflict-resolution-matrix.md §3: `spec-changed`⇒overwrite-linear, `linear-changed` with `issue.updatedAt > checkpoint.issueUpdatedAt`⇒overwrite-spec, `linear-changed` with `updatedAt ≤ checkpoint.issueUpdatedAt` ⇒ degrade `report-only` + `degraded: true`, `both-changed` ⇒ always degrade; `fail` ⇒ effect `abort-run`; every result carries `{ conflictType, action, reason }`
- [X] T015 [P] [US1] Write marker-synthesis unit tests in `tests/unit/engine-markers.test.ts` (research R4): block format `<<<<<<< <toolId>:local <filePath>#L<line>` / local content / `=======` / tracker content / `>>>>>>> <toolId>:linear <ISSUE-KEY>`; labels derived from configured `toolId` + issue reference; NEVER contains the task UUID (Principle II); output is structurally compatible with 004 `scanConflictBlocks`/`frozenLineSet`; a synthesis attempt into a section already containing a block is refused (no nested markers)
- [X] T016 [P] [US1] Write completion-mapping unit tests in `tests/unit/engine-completion.test.ts` (FR-006, research R7): `checkedChanged ∧ ¬descriptionConflict` ⇒ desired state = configured done state (checked) / backlog state (unchecked) — per-team consumer-configured identities, NO built-in default; name→id resolved via the 007 `discoverMetadata` workflow-state snapshot; unknown configured state name ⇒ plan-time validation failure (sanitized), not a runtime surprise; a toggle with unchanged description records NO description conflict; tracker-side state moves update `stateTypeDrift` only, never pushed back
- [X] T017 [P] [US1] Author fixture worlds for US1 under `tests/fixtures/engine/worlds/`: `first-run-bootstrap/`, `formatting-noise/`, `linear-changed/`, `spec-changed/`, `both-changed/`, `unresolved-block/`, `completion-toggle/` (spec files + fake-world seed data + expected artifacts; placeholders only)
- [X] T018 [US1] Write integration test `tests/integration/engine-bootstrap.test.ts` (US1 AC1, SC-001/SC-002 at the plan boundary): no checkpoint ⇒ bootstrap mode driving `bootstrapConflictMap`; meaningful difference classifies `both-changed`; normalized-identical ⇒ no conflict; after a full bootstrap cycle a second `buildSyncPlan` over unchanged inputs reports zero pending changes; `formatting-noise` world ⇒ zero conflicts and zero planned rewrites (SC-002)
- [X] T019 [P] [US1] Write integration test `tests/integration/engine-conflict-freeze.test.ts` (US1 AC4, FR-007, SC-004 property): `unresolved-block` world ⇒ plan decision `skip-unresolved`, exactly one unresolved-conflict report entry per task per run, checkpoint untouched (baseline preserved), no planned file/issue mutation; property test: block survives N arbitrary intervening runs byte-for-byte; removing the markers returns the task to normal classification against the stored checkpoint

### Implementation for User Story 1

- [X] T020 [US1] Implement `ClassificationOutcome` computation in `src/engine/classify.ts` per data-model §3 (fields: `taskUuid`, `mode`, `descriptionConflict`, `titleChanged`, `checkedChanged`, `stateTypeDrift`, `unresolvedConflict`, `reasons`), hashing normalized content under the configured profile (makes T013 pass)
- [X] T021 [P] [US1] Implement the pure action resolver + FR-004 built-in default map exports (`bootstrapConflictDefaults`, `syncConflictDefaults`) + `AppliedAction { taskUuid, conflictType, action, effect, degraded, reason }` in `src/engine/actions.ts`; maps sourced from `ResolvedConfig.bootstrapConflictMap`/`syncConflictMap` through the frozen deep-merge chain (makes T014 pass)
- [X] T022 [P] [US1] Implement git-style conflict-marker synthesis + nested-block refusal in `src/engine/markers.ts` (makes T015 pass)
- [X] T023 [P] [US1] Implement checkbox→workflow-state mapping in `src/engine/completion.ts` (name→id via 007 `discoverMetadata` snapshot; unknown-name plan-time validation failure) (makes T016 pass)
- [X] T024 [US1] Implement `buildSyncPlan` read-only pipeline in `src/engine/build.ts` per contracts/engine-pipeline.md stages 1–7: discover (003) → `parseTaskFile` (004, conflict blocks ⇒ `unresolvedConflict`) → `resolveRouting`/`deriveTitle` (005) → `matchAllTasks` (006, durable-identity collisions ⇒ integrity abort) → mode + classify → action resolution → assemble `Plan` (frozen shapes, `derivePlanId`, guards captured: input hashes + HEAD, structural exclusion of raw bodies/descriptions); zero tracker mutations and zero repository writes end-to-end (makes T018/T019 pass)
- [X] T025 [US1] Implement plan persistence + report artifacts in `src/engine/report.ts` per research R13: `StoredPlan` → `plans/<planId>.json` and `reports/<runId>/report.json` conforming to `specs/002-core-domain-contracts/contracts/plan-report.schema.json` + sanitized `report.md` (structural exclusion + screener pass; project→milestone grouping, separate unmapped section, unresolved-conflict surfacing, security-assertions block); conflicts surface as `decision: "conflict"` entries with `conflictType` + mapped `action` reasons (FR-005); `runId` deterministic under the injected clock
- [X] T026 [US1] Wire `buildSyncPlan` through `createSyncEngine` in `src/engine/create.ts` and export the public surface from `src/engine/index.ts`; negative contract per contracts/engine-pipeline.md: no transport/credential/GraphQL handling, no new `GateFailureCode` values
- [X] T027 [P] [US1] Write purity integration test `tests/integration/engine-build-purity.test.ts` (constitution I): `buildSyncPlan` against every US1 world leaves the fake-port call log free of mutation calls and the fixture repo tree byte-identical (content hashes before/after); only state-directory writes (`plans/`, `reports/`) occur

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently — classification, action resolution, marker synthesis, completion mapping, plan assembly, and reports all pass against the fake with zero mutations.

---

## Phase 4: User Story 2 - Gated apply with durable state, history, and resumable rollback (Priority: P2)

**Goal**: The frozen enforcement order in `applySyncPlan` (gates → lock → plan-stability re-check → complete journal before first mutation → screened mutations); parent-before-child creates with reverse siblings; create-intent-before-attempt with indeterminate reconciliation; authoritative page-0 payload rewrite + append-only history with rollover; resumable guarded `rollbackRun` preserving history and identity.

**Independent Test**: Full apply against the fake tracker then `rollbackRun` (quickstart.md 2.1–2.6): restore of every file/field/checkpoint, `archived === true` for created issues, zero history loss; interrupt the rollback at each step index and resume without repeats; corrupt one step's state ⇒ `conflict-halted` + `status "partial"`; fail one create ⇒ indeterminate with zero replay calls; run `node scripts/run-tests.mjs --tier integration --test-name-pattern engine-` plus the contract tier.

### Tests for User Story 2 (write first, must fail) ⚠️

- [X] T028 [P] [US2] Write op-ordering unit tests in `tests/unit/engine-ops-order.test.ts` (FR-011, research R10/R14): creates parent-before-child dependency-sorted on `parentUuid`, stable across files; sibling issues within one parent emitted in reverse working order; `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` and `runId = sha256(planId ‖ clock.now().iso ‖ seq)` deterministic under the injected clock
- [X] T029 [P] [US2] Write history-log unit tests in `tests/unit/engine-history-rollover.test.ts` (FR-009/010, contracts/history-log.md): exactly one screened, timestamped (injected-clock) `SyncHistoryEvent` per landed affecting action with kinds 1:1 from the frozen vocabulary (`discovered`, `issue-created`, `matched`, `title-updated`, `description-updated`, `checkbox-changed`, `conflict-detected`, `rollback`); zero events for `no-change`/skip-unresolved/refused gates; rollover when `len(candidate) > historyLogMaxEntries` (default 50) or `bytes(canonicalSerialize(candidate)) > historyLogMaxBytes` moves ONLY the new tail to page `n+1`; entries never edited, reordered, removed, or moved backwards
- [X] T030 [P] [US2] Write contract test `tests/contract/engine-gate-order.test.ts` (frozen vocabulary + enforcement order, contracts/engine-pipeline.md): `APPLY_FLAG_MISSING` + `CONFIRMATION_KEY_MISMATCH` + `LOW_CONFIDENCE_NOT_ACCEPTED` all collected and returned together as `status: "refused"` with no lock acquired and no reads-mutated; `PLAN_REFERENCE_UNKNOWN`/`PLAN_REFERENCE_STALE` via frozen `validatePlanReference` re-run at apply start ⇒ zero mutations; `LOCK_HELD` refusal on live contention; `rollbackRun` refuses `MANIFEST_UNJOURNALED` (journaling off / no journal) and `MANIFEST_EXPIRED` (injected clock past `manifestExpiryDays` via frozen `isManifestExpired`); envelope tag-check failure ⇒ refusal with no plaintext returned
- [X] T031 [P] [US2] Author fixture worlds for US2 under `tests/fixtures/engine/worlds/`: `indeterminate-create/`, `history-rollover/`, `rollback-full/`, `rollback-interrupted/` (placeholders only)
- [X] T032 [US2] Write integration test `tests/integration/engine-conflict-matrix.test.ts` (SC-004 end-to-end): all 36 cells (6 actions × 3 conflict types × 2 modes) exercised through full `buildSyncPlan` + gated `applySyncPlan` over fixture worlds with overridden maps — assert fake-port call log per conflict-resolution-matrix.md §2 (`overwrite-linear` ⇒ screened `updateIssue` description + full payload rewrite + `description-updated`; `overwrite-spec` ⇒ section body replaced by the both-sides marker block, ZERO `updateIssue` calls, `conflict-detected`; `report-only` ⇒ zero changes both sides; `skip` ⇒ zero changes, internal-only record, NOT a report conflict entry; `fail` ⇒ run `status: "aborted"` before the next mutation with already-applied journal steps still rollback-able); nested-marker write into a frozen section refused outright (FR-007)
- [X] T033 [P] [US2] Write integration test `tests/integration/engine-completion-states.test.ts` (US1 AC5 applied, FR-006): `completion-toggle` world — newly checked ⇒ `updateIssue(stateTypeId=done)` + one `checkbox-changed` history event; unchecked ⇒ backlog state; no description conflict recorded; unknown configured state name ⇒ plan-time validation failure surfaced sanitized
- [X] T034 [P] [US2] Write integration test `tests/integration/engine-apply-creates.test.ts` (US2 AC1/AC2, FR-011/012): op order asserted from the fake call log (parents before children, same-parent siblings reversed); assigned task lines rewritten via 004 `renderTaskLines` with issue reference + derived title; scripted create failure + `findIssuesByAttachmentUrl` reconciliation per data-model §8 — exactly one match ⇒ adopt + `confirmed-created`/reconciled; zero or >1 ⇒ intent `indeterminate`, further creation for that task (incl. children) aborted, report entry, ZERO replay create calls in-run and on resume; >1 additionally surfaces the Principle II integrity-failure diagnostic
- [X] T035 [P] [US2] Write integration test `tests/integration/engine-attachment-state.test.ts` (FR-008/009/010/015, quickstart 2.5): page-0 canonical attachment at `canonicalAttachmentUrl` rewritten authoritatively (full replace, `serializeSyncStatePayload`, stable keys) after screening each applied run; `historyLogMaxEntries: 3` configured `history-rollover` world ⇒ deterministic continuation pages via `getAttachmentByUrl` walk with every prior entry preserved byte-identical; resumed/re-run apply lands byte-identical attachment pages (URL idempotency, no duplicates, no locally stored page index or attachment ids)
- [X] T036 [P] [US2] Write integration test `tests/integration/engine-rollback.test.ts` (US2 AC3/AC4/AC5, FR-013/014/015/016, SC-003): `rollback-full` — every modified file byte-equal to before content (from `fileBackups`), each patched issue field restored to before value, each created issue `archived === true` and never deleted, checkpoint entries restored and absent-in-snapshot entries REMOVED; history: event count after = before + exactly one appended `rollback` event per task referencing reversed `opId`s, zero prior events altered, zero continuation pages removed, page-0 canonical created during the run RETAINED with non-history payload adjusted to mirror restored state; `engine-lock-contention`-free but rollback acquires the advisory lock itself; journal manifest `operations` complete (every planned attachment op with target issue, addressed URL, prior metadata where one existed — FR-015); `rollback-interrupted` + interruption injector at EVERY step index ⇒ resume never repeats completed (`rolled-back`) steps; corrupted step state (matches neither snapshot) ⇒ `stepState: "conflict-halted"`, HALT, `RollbackResult.status: "partial"` naming the step; external fix then resume proceeds
- [X] T037 [P] [US2] Write integration test `tests/integration/engine-fail-abort.test.ts` (edge case `fail` action mid-run): mapped `fail` on the second conflicting task ⇒ run status `aborted` before that task's mutation, earlier applied steps remain rollback-able (rollback succeeds afterwards), report + `last-run.json` marker record the abort, no automatic rollback performed
- [X] T038 [P] [US2] Write integration test `tests/integration/engine-lock-contention.test.ts` (frozen `src/state/lock.ts` semantics): a second concurrent `applySyncPlan` while the lock is held ⇒ `ApplyResult{ status: "refused" }` with `LOCK_HELD`, no lock re-acquire, no mutations
- [X] T039 [P] [US2] Write security contract test `tests/contract/engine-screening.test.ts` (constitution I, research R12): world with a secret-shaped string in one task section ⇒ that content never appears in the fake-port call log, reports, or journal artifacts (other tasks still sync); blocking finding fails ONLY that op with sanitized detail naming finding categories, never content; email addresses redacted in propagated output; secret sentinels never appear in reports/logs/manifests; every string handed to `port.updateIssue`/`port.upsertAttachmentByUrl`/file writes passed `screener.screen()` pre-transmission

### Implementation for User Story 2

- [X] T040 [US2] Implement the op taxonomy in `src/engine/ops.ts` per data-model §5: kinds `create-issue`, `update-issue`, `upsert-attachment`, `render-file`, `write-checkpoint` with kind-specific `beforeSnapshot`/`afterSnapshot`, inverse mapping, and history-event mapping; deterministic `opId`/`runId` derivation (research R14); FR-011 emission order (makes T028 pass)
- [X] T041 [P] [US2] Implement journal artifacts in `src/engine/journal.ts` per contracts/journal-rollback.md §1: frozen `Audit_Manifest` at `manifests/<runId>.json` via `src/state/manifest.ts` seal/open (AES-256-GCM versioned envelope, unencrypted `createdAt` header, `fileBackups` full before content + hash, `checkpointBefore` full snapshot, one `AuditOperation` per planned op with attachment `attachmentUrl` + `priorMetadata` — FR-015) AND the 008-local step journal `runs/<runId>/journal.json` sealed with the same envelope/key-provider/expiry posture carrying `JournalStep[]` guard material; materialized COMPLETE before the first mutation, re-sealed + atomically rewritten after every step transition; `journalingEnabled: false` ⇒ neither artifact exists
- [X] T042 [P] [US2] Implement attachment-chain writes in `src/engine/payload.ts` + `src/engine/history-page.ts` per contracts/history-log.md: page-0 authoritative non-history rewrite (`taskUuid`, `frameworkMetadata`, normalized mirrored `descriptionContentHash`, `cursors.lastSyncAt` from injected clock) after screening; exactly-one append per landed affecting action via page walk `getAttachmentByUrl` 0..n (chain state never cached locally); rollover of only the new tail to `continuationAttachmentUrl(cfg, taskUuid, n+1)` with page record `{ taskUuid, page, history }` under the same `metadataNamespaceKey`; all writes URL-idempotent `upsertAttachmentByUrl` (makes T029 pass)
- [ ] T043 [US2] Implement `applySyncPlan` in `src/engine/apply.ts` — THE single mutating entry — enforcing the frozen order verbatim per contracts/engine-pipeline.md: (1) gate evaluation collecting ALL failures together (`status: "refused"`, frozen `GateFailure` codes, no lock, no read-back); (2) advisory lock via `src/state/lock.ts`; (3) stability re-check — frozen `validatePlanReference` over live file hashes + HEAD AND per-issue snapshot re-fetch via `getIssue`/`getAttachmentByUrl`, drift ⇒ abort zero mutations; (4) journal materialization complete-before-first-mutation via T041; (5) mutations in FR-011 order, per op: screen → plan-precondition re-check → mutate → journal step → history append → step `applied`; create flow via `src/state/intent.ts` `writeCreateIntentBeforeAttempt` → `createIssue` (never auto-retried) → reconcile per data-model §8; task-line renders via 004 `renderTaskLines` (frozen-block targets refused by 004 and skipped); `fail` action ⇒ `EngineFailError` before next mutation with status `aborted`; after last mutation: atomic checkpoint store write, run report + `last-run.json`, lock release; converged inputs ⇒ zero pending ops, zero tracker writes (SC-001) (makes T032–T035/T037–T039 pass)
- [ ] T044 [US2] Implement `rollbackRun` in `src/engine/rollback.ts` per contracts/journal-rollback.md §2–§4: refusals (`MANIFEST_UNJOURNALED`, `MANIFEST_EXPIRED`, tamper-no-plaintext); advisory lock acquisition; reverse `operations` walk with observed-state guards (rolled-back ⇒ skip; current == beforeSnapshot ⇒ nothing to undo, mark rolled-back; current == afterSnapshot ⇒ execute inverse: restore file from `fileBackups`, `updateIssue` field→before value, `archiveIssue` created issues, re-upsert `priorMetadata` by URL or no-op where none existed; matches neither ⇒ `conflict-halted` + HALT, `status: "partial"`); step-state transitions persisted by re-sealing both artifacts atomically after every step; checkpoint store restored from `checkpointBefore` (absent entries removed); FR-016 preservation (nothing deleted, page-0 and continuation pages retained, payload mirroring adjustment, exactly one appended `rollback` event per task referencing reversed `opId`s); report + `last-run.json` outcome marker (makes T036 pass)
- [ ] T045 [US2] Extend `src/engine/report.ts` with run reports for `applySyncPlan`/`rollbackRun` (same `reports/<runId>/` paths, frozen schema, sanitized) + frozen `LastRunMarker` writes to `last-run.json` for applies and rollbacks; wire `applySyncPlan` and `rollbackRun` through `createSyncEngine` in `src/engine/create.ts` replacing the Phase-2 skeleton throws

**Checkpoint**: At this point, User Stories 1 AND 2 both work independently — full gated apply → rollback lifecycle passes over the fake; SC-003 assertions green.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story property suites, contract-tier hygiene, end-to-end walkthrough, docs, full gate

- [ ] T046 [P] Write cross-cutting property suites in `tests/integration/engine-properties.test.ts`: SC-001 apply-twice convergence (second plan zero pending changes; second apply zero tracker writes on seeded worlds); SC-002 normalized-hash classification never fires on formatting-only noise (zero conflicts, zero description rewrites across a full apply-and-plan round trip); SC-003 rollback total-restoration over seeded worlds (every file/field/checkpoint restored, created issues archived, 0 history events lost or altered)
- [ ] T047 [P] Write contract test `tests/contract/engine-plan-report-schema.test.ts`: every plan/run `report.json` validates against `specs/002-core-domain-contracts/contracts/plan-report.schema.json`; `report.md` contains no raw bodies/descriptions; every applied action's entry names conflict type + action + reason (FR-005)
- [ ] T048 [P] Write contract test `tests/contract/engine-no-direct-tracker.test.ts`: source scan of `src/engine/**` — no transport/HTTP/GraphQL/credential imports; all tracker access flows through the injected `Linear_Port` (constitution V, plan.md Testing security tier)
- [ ] T049 [P] Write contract test `tests/contract/engine-packaging.test.ts`: `task-linear-sync/engine` resolves via the `package.json` exports entry and surfaces `createSyncEngine` + `EngineOptions` with generated `.d.ts`
- [ ] T050 [P] Write contract test `tests/contract/engine-hygiene.test.ts`: zero real organization identifiers/team keys/tokens/UUIDs in `src/engine/**` and distributed defaults; marker labels derive from `toolId`; `tests/fixtures/engine/**` uses placeholders only (Principle III)
- [ ] T051 Write `tests/e2e/engine-user-stories.test.ts` per quickstart.md e2e walkthrough: bootstrap apply on a fresh fixture repo → mutate spec side + fake-world issue side → `buildSyncPlan` → conflict cells per matrix → `applySyncPlan` (gates satisfied) → checkpoints + history pages verified → `rollbackRun` → SC-003 assertions → resolve markers by hand → next run classifies normally
- [ ] T052 Add engine usage-scenario documentation in `docs/` (plan.md documentation duty: engine scenarios alongside the plan-report contract references; how 009/010/012 consume `./engine` through the frozen `SyncEngine`)
- [ ] T053 Run quickstart.md validation: `npm ci` → `npm run pretest` → `npm test` (full gate: build + all tiers + coverage threshold) and the four tier-scoped `node scripts/run-tests.mjs --test-name-pattern engine-` invocations from quickstart.md "Run the suites"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (T003 harness may type against the frozen `SyncEngine` interface)
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (mode/screening/normalize/errors/options are consumed by both stories; T012 composition root is the wiring seam)
- **User Stories (Phase 3–4)**: Both depend on Foundational. US1 (P1) then US2 (P2); with capacity they can partially overlap because US1 touches `classify/actions/markers/completion/build/report(plan)` and US2 touches `ops/journal/payload/history-page/apply/rollback/report(extension)` — the only shared files are `create.ts` (separate wiring tasks T026/T045) and `report.ts` (T025 before T045). US2 integration tests exercise US1 modules, so delivering US1 first is strongly preferred.
- **Polish (Phase 5)**: Depends on all delivered stories (SC-001 property needs apply; contract hygiene suites need the full `src/engine` tree)

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2 — no dependency on US2; testable at the plan boundary independently
- **US2 (P2)**: Starts after Phase 2 — rides on US1's classification/action modules per spec ("rides on top of the reconciliation machinery"); its integration tests assert US1 semantics end-to-end through apply, so sequence US1 → US2 for a working MVP path

### Within Each User Story

- Tests written first and MUST fail before implementation (constitution VI)
- Pure modules (`classify`, `actions`, `markers`, `completion`; `ops`, `payload`/`history-page`) before pipeline modules (`build`; `apply`, `rollback`)
- `journal.ts` before `apply.ts`/`rollback.ts`; wiring task last in each story

### Blocking Edges (must serialize)

- T024 (build.ts) after T020–T023 · T026 after T024–T025
- T043 (apply.ts) after T040–T042 (and US1 modules) · T044 (rollback.ts) after T041
- T045 after T025, T043, T044 · T046–T051 after all story implementation

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- Foundational tests T004–T006 in parallel; implementations T009–T011 in parallel (T007/T008 also parallel)
- US1 tests T013–T019 in parallel (disjoint files); US1 implementations T020–T023 in parallel (disjoint files); T027 parallel with T025/T026
- US2 tests T028–T031 and T033–T039 in parallel (disjoint files); T041 and T042 in parallel
- Polish tests T046–T050 all parallel; a second developer can staff US2 test authoring (T028–T039, writing-failing-tests only) while US1 implementation proceeds

---

## Parallel Example: User Story 1

```bash
# Launch all US1 unit tests + fixture authoring together (must fail first):
Task: "Classification unit tests in tests/unit/engine-classify.test.ts"          # T013
Task: "Action-resolution unit tests in tests/unit/engine-actions.test.ts"        # T014
Task: "Marker-synthesis unit tests in tests/unit/engine-markers.test.ts"         # T015
Task: "Completion-mapping unit tests in tests/unit/engine-completion.test.ts"    # T016
Task: "US1 fixture worlds in tests/fixtures/engine/worlds/"                      # T017

# Then launch all four pure-module implementations together:
Task: "ClassificationOutcome in src/engine/classify.ts"    # T020
Task: "Action resolver in src/engine/actions.ts"           # T021
Task: "Marker synthesis in src/engine/markers.ts"          # T022
Task: "Completion mapping in src/engine/completion.ts"     # T023
```

## Parallel Example: User Story 2

```bash
# Tests (disjoint files, all parallel once Phase 2 + US1 semantics exist):
Task: "Op-ordering unit tests in tests/unit/engine-ops-order.test.ts"           # T028
Task: "History-rollover unit tests in tests/unit/engine-history-rollover.test.ts" # T029
Task: "Gate-order contract test in tests/contract/engine-gate-order.test.ts"    # T030
Task: "Rollback integration test in tests/integration/engine-rollback.test.ts"  # T036

# Parallel implementation pair:
Task: "Journal artifacts in src/engine/journal.ts"                  # T041
Task: "Attachment-chain writes in src/engine/payload.ts + history-page.ts"  # T042
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (plan-side reconciliation: mode, classification, six actions, markers, completion, reports)
4. **STOP and VALIDATE**: run the engine unit + US1 integration tiers; confirm zero-mutation purity (T027)
5. Deploy/demo if ready — 013's drift/conflict signals ride the plan/report entries already

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → plan-side reconciliation green → demo conflict classification/reports (MVP)
3. US2 → full gated apply, durable state, history, resumable rollback green (SC-003) → demo
4. Polish → property/contract/security/hygiene tiers + e2e walkthrough + full `npm test` gate
5. Each story adds value without breaking previous stories; frozen 002 modules are never touched

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done: Developer A runs US1 implementation; Developer B writes all US2 tests (T028–T039 fail-first, they can land as red/skipped until US2 implementation)
3. B then implements `ops`/`journal`/`payload` in parallel while A finishes US1 wiring; `apply`/`rollback` follow
4. Team pairs on the e2e walkthrough (T051) and quickstart validation (T053)

---

## Notes

- [P] tasks = different files, no dependencies
- Frozen modules (`src/{domain,config,state,urls,gates,ports}`) and Wave-2 modules (`src/{discovery,parsing,routing,titles,matching,tracker}`) are import-only; the ONLY edits outside `src/engine/**` + engine tests are the single `package.json` exports entry (T001) and `docs/` (T052)
- Every test is hermetic: 007 fake via `task-linear-sync/tracker/testing`, temp-dir state store, injected `Clock`; zero real network/credentials/wall-clock
- Screening gate: any string reaching `updateIssue`/`upsertAttachmentByUrl`/file writes must have passed `screener.screen()`; blocked ⇒ that content only is not transmitted
- Verify tests fail before implementing; commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts (`create.ts`/`report.ts` have serialized wiring tasks), cross-story edits to frozen modules
