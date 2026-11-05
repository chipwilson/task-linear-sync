# Tasks: Background Queue, Worker, and Hook Triggers

**Input**: Design documents from `specs/010-background-queue-sync-hooks/`

**Prerequisites**: plan.md (mandatory), spec.md (user stories), research.md, data-model.md, contracts/ (four files), quickstart.md (verification lanes — the scenario numbers cited below are its section numbers)

**Tests**: REQUIRED — constitution article VI (TDD, article I). The tests enumerated below are the same files the plan lists; they are written first, they must FAIL before the implementation task that closes them, and they are the mandatory gate for every phase.

**Structure**: The engine (`src/engine/`) already exists, so Foundational is the queue spine (config, pending job, lock, enqueue, drain, worker, reports, notify, hook generators, the surface). Story phases then carry the integration and e2e tiers per the contracts README tier rule: units for single-module semantics, integration for real-fs/real-subprocess flows, e2e for spawned-CLI + real-git journeys.

**Validation entry points** (run after every implementation task; the full matrix lives in quickstart.md §8):

- Unit / integration / e2e: `npm test` (tsx test files; spawned-CLI e2e lanes use `npm run build` first — `dist/queue/worker-entry.js` is the spawned worker argv[1])
- Packaging / dependency / defaults / surface / hygiene scans: `node specs/010-background-queue-sync-hooks/contracts/queue-*.mjs`
- Build gate: `npx tsc -p tsconfig.json` — no emit, zero errors, including the `./queue` subpath

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 — which user story the task serves (user stories only)
- File paths included directly in each description

## Path Conventions

- Product spine: `src/queue/` — the ONLY production source this feature adds; zero edits anywhere else in `src/`
- Tests: `tests/unit/`, `tests/integration/`, `tests/e2e/`, fixtures under `tests/fixtures/queue/`
- Verification scans: `specs/010-background-queue-sync-hooks/contracts/`
- Documentation duty (briefing §5): `docs/queue-hooks.md` + README updates in **Polish**

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: project wiring for the new module group; no logic.

- [ ] T001 [P] Add the additive `"./queue": { "types": "./dist/queue/index.d.ts", "import": "./dist/queue/index.js" }` entry to package.json exports (research R1; the frozen lazy-import shape in src/cli/queue-surface.ts:159-166 — zero-argument `createQueueSurface()` — is the binding contract); zero dependency and engines changes
- [ ] T002 [P] Reserve `tests/fixtures/queue/gitlab-stub/`, `tests/fixtures/queue/fs-storm/`, `tests/fixtures/queue/hooks/` with `.gitkeep` files and `tests/fixtures/queue/README.md` documenting fixture ownership per contracts README
- [ ] T003 [P] Create `tests/helpers/queue-harness.ts`: `makeQueueHarness({ config?, wiring? })` — tmp git repo, resolved config (frozen `loadConfig`, env cleared first), `StateStorePaths` for its state dir, fs stub, injected clock/sleep/which/spawner, cleanup (pattern: tests/helpers/cli-harness.ts) — plus exported helpers `writePendingJob(dir, job)`, `readPendingJob(dir)`, `readQueueLock(dir)`, `stripHookBlock(text, markers)` for the story phases

**Checkpoint**: package.json resolves `task-linear-sync/queue`; harness compiles — foundation ready

---

## Phase 2: Foundational (Prerequisite Steps)

**⚠️ CRITICAL**: All user stories depend on this phase — it builds the whole spine (`src/queue/`) behind the frozen 009 seam.

**Persistence primitives**:

- [ ] T004 [P] Write FAILING unit tests `tests/unit/queue-config.test.ts` — `queue` sub-object defaults (delay 75, lock timeout 30, retries 5, notifications true, autoAccept false, prefix = binName), inclusive-bounds rejection (1..3600 / 1..300 / 1..100), ONE combined dotted-key message for several invalid keys (contracts/queue-surface-implementation.md §2), frozen keys unchanged by merge, `validateQueueWiring` per-method required wiring + `QueueRefusal` shape
- [ ] T005 Implement `src/queue/config.ts` — `queueConfigSchema` (frozen z.number().int() idiom), additive merge on the frozen deep-merge path, `resolveQueueConfig()`, `validateQueueWiring(wiring, method)`, `QueueRefusal` helper (research R2, R3)
- [ ] T006 [P] Write FAILING unit tests `tests/unit/pending-job.test.ts` — atomic single-slot publish via temp-file + rename (concurrent `writePendingJob` → exactly one file, one winner per rename), corrupt file → `{ job: null, corrupt: true }`, merge rules per data-model §2 (jobId/enqueuedAt preserved, latest mode wins, retryCount reset to 0 on fresh enqueue, `claim` COPIED FORWARD — never cleared), zero-length write → null, not a directory → refused
- [ ] T007 Implement `src/queue/pending-job.ts` — `readPendingJob` / `writePendingJob` / `mergePendingJob` / `clearPendingJob` with the schema `{ schemaVersion, jobId, mode, trigger, enqueuedAt, updatedAt, retryCount, claim }` (data-model §1-§2; claim preservation is the R4 enqueue-under-lock decision)
- [ ] T008 [P] Write FAILING unit tests `tests/unit/queue-lock.test.ts` — mutual exclusion under concurrency 10 (exactly one holder), re-acquire by holder id, reclaim only when the recorded pid is dead (ENOENT → reclaim; EPERM → alive, kept), stale-token unlock refusal, timeout path → `{ held: true, timeoutSeconds }` after exactly the configured virtual seconds (injected sleep, 50 ms + jitter cadence), lock file byte-format `{ schemaVersion: 1, workerId, pid, acquiredAt }` (research R4 mirrors src/state/lock.ts)
- [ ] T009 Implement `src/queue/queue-lock.ts` — `acquireQueueLock(paths, { workerId, clock, sleep })` / `releaseQueueLock(paths, token)` with temp + `link(2)` publish and pid liveness re-expressing frozen `exclusiveCreate` semantics (research R4)

**Worker spine**:

- [ ] T010 [P] Write FAILING unit tests `tests/unit/enqueue.test.ts` — pending job visible within `writeBudgetMs` (500, virtual clock), merge-of-two semantics (exactly one file after both calls), `spawnWorker` called exactly once AFTER the job is durable, spawn throw → still `{ status: "enqueued" }` with the degraded sentence in detail, credentials absent → STILL enqueues + `warnings` carries the credentials sentence, lock directory unwritable → `{ status: "refused" }` (FR-001, FR-007 last scenario)
- [ ] T011 Implement `src/queue/enqueue.ts` + `src/queue/spawn.ts` — enqueue never takes the queue lock (FR-002 scope decision, research R4; FR-001 500 ms budget); default `spawnWorker` = one detached `node dist/queue/worker-entry.js <repoRoot>` child (`stdio: "ignore"`, `unref()`, `TASK_LINEAR_SYNC_TEST_NOTIFY` pass-through, research R6)
- [ ] T012 [P] Write FAILING unit tests `tests/unit/drain.test.ts` — claim written into the record before apply (token + pid + claimedAt), skip when a foreign claim is fresh (< claimTimeout under injected clock), reclaim when the foreign claim is abandoned (≥ `worker.claimTimeoutSeconds`, default 300 — FR-003), claim re-check lost → `{ status: "stopped" }` with zero engine calls, `LOCK_HELD` from apply → job kept for the next pass WITHOUT incrementing retryCount (R7), queue empty → `{ status: "stopped", jobsDrained: 0 }`
- [ ] T013 Implement `src/queue/drain.ts` + `src/queue/apply-runner.ts` — `runDrainOnce()` with atomic claim, heartbeat-as-claim-rewrite at claimTimeout/3, claim-token-guarded terminal actions, `applyAsRunner()` composing `src/engine/commands.ts` readConfig→runSync with a queue-level `QueueApplyOutcome` (research R5, R7)
- [ ] T014 [P] Write FAILING unit tests `tests/unit/worker.test.ts` — `runWorker({ once: true })` → one drain pass then `{ status: "stopped" }`; `once: false` → immediate drain + delayed fallback drain after `queue.workerDelaySeconds` (virtual clock), signal → `{ status: "stopped" }` and released lock, every exit path releases the queue lock and leaves no temp residue
- [ ] T015 Implement `src/queue/worker.ts` (loop, signal handling, delayed fallback drain — FR-001 second half) + `src/queue/worker-entry.ts` (detached entry, argv[1]-relative, never throws) — GREEN T014
- [ ] T016 [P] Write FAILING unit tests `tests/unit/queue-reports.test.ts` — `QueueApplyOutcome` → frozen `writeRunReports` mapping per data-model §5 (outcome `"success"|"partial"|"failed"` vs status `"started"|…|"succeeded"`; `startedAt`/`finishedAt` from the clock), `notificationSuppressed` REWRITTEN to delivery truth when the notify wiring was present, terminal-failure report carries `error.code` (`RETRY_LIMIT` / `APPLY_FAILED` / `VALIDATION_ERROR`), validation-refusal writes a failed marker + report only (research R8, R10)
- [ ] T017 Implement `src/queue/reports.ts` — queue-level terminal reports through the frozen `writeRunReports` + failure marker writer for pre-drain refusals — GREEN T016 (FR-005)
- [ ] T018 [P] Write FAILING unit tests `tests/unit/notify.test.ts` — sink resolution order (`TASK_LINEAR_SYNC_TEST_NOTIFY` file > osascript / notify-send / powershell by platform via injected `which`, absent → suppressed), append semantics + `NOTIFY_TARGET`/`NOTIFY_TITLE`/`NOTIFY_BODY` env contract (research R8), `notify()` NEVER throws (spawn throw → `{ delivered: false }`), `notificationsEnabled: false` → no attempt at all
- [ ] T019 Implement `src/queue/notify.ts` — the `Notifier` seam from src/cli/queue-surface.ts:92-100, default `spawnNotifier` (FR-005, research R8)
- [ ] T020 [P] Write FAILING unit tests `tests/unit/git-hooks.test.ts` — generated block = two lines (`"<prefix>" last-run 1>&2 || true` then `"<prefix>" enqueue 1>&2 || true`) inside `# >>> task-linear-sync managed hooks v1 >>>` / `# <<< … <<<`; splice preserves foreign bytes EXACTLY (byte-equal strip-and-re-add outside markers), re-install idempotent (one block, one install message), existing executable bit kept / created hooks mode 0o755, custom `hookScriptPrefix` in the block text, unsupported names + `pre-`/`post-checkout` refused BEFORE any write (`installed: []`, `path: null`) (research R9)
- [ ] T021 Implement `src/queue/git-hooks.ts` — marker constants, block generator, idempotent splice, install/remove/status against `managedGitHooks` ∩ supported list (FR-006) — GREEN T020
- [ ] T022 [P] Write FAILING unit tests `tests/unit/agent-hooks.test.ts` — scaffold content derived from 003 `scanAgentHookScaffolds()` `agentHookScaffold` (src/discovery/agent-hooks.ts:52-57, `${binName}-sync.json`) enriched with `event: "post-file-save"` + `pathPatterns` from `taskFilePatterns` (never re-hardcoded), directory precedence `hooksDirectory` → `agentHooksDirectory` → `.kiro/hooks/` when framework `kiro`, never-overwrite collision → `-2`/`-3` suffix reported in `installed`, invalid/unsafe file name refused before first write (FR-006 last scenario, research R11)
- [ ] T023 Implement `src/queue/agent-hooks.ts` — install/remove/status for `agentHooksDirectory` scaffolds — GREEN T022 (FR-009)
- [ ] T024 Write FAILING unit tests `tests/unit/queue-surface.test.ts` — the zero-argument `createQueueSurface()` binding: all five frozen methods resolve with ONLY the frozen status vocabulary (`installed|skipped|enqueued|stopped|refused`), wiring validation refusals surface as `{ status: "refused", detail }` without throwing, no wiring → defaults bind (no spawn during install/status paths)
- [ ] T025 Implement `src/queue/surface.ts` (`createQueueSurface(wiring?: QueueWiring)` — ALL-optional wiring bag because frozen delegateTo010() calls it with zero arguments) + `src/queue/index.ts` barrel exporting `createQueueSurface`, `worker-entry` stays binary-only; run `npm run build`, then `npm ls @linear/sdk --all` must still print `task-linear-sync@0.0.0` root only
- [ ] T026 Adapt the 009 tests written while `src/queue/` was absent (research R12): `tests/unit/cli-queue-surface.test.ts` lazy-import "surface absent" cases → real-binding assertions (keep a sub-suite that re-points the seam at a missing module to preserve the exit-7 branch coverage); `tests/integration/cli-commands.test.ts` (~line 291) default-surface exit-7 expectation → frozen default semantics for queue commands

**Checkpoint**: `npm test` + `npx tsc` green with the full spine — ANY story can now be exercised end to end

---

## Phase 3: User Story 1 - Non-blocking enqueue and drain (Priority: P1) 🎯 MVP

**Goal**: an `enqueue` (manual or hook-fired) returns within 500 ms without contacting the tracker, a worker drains in the background and ends with marker + stderr outcome + best-effort notification, retries are bounded, offline runs degrade loudly.

**Independent test**: run the tasks below and quickstart §2 (spawned-CLI lane) + §4 (degradation) + §2.5 (notification sink file) — green ⇒ enqueue ≤ 500 ms wall, one `failed` marker with `outcome`/`mode`/`error.code`/`jobId`, one notification record.

- [ ] T027 [P] [US1] Write integration tests `tests/integration/queue-enqueue-drain.test.ts` per quickstart §2.1-§2.4 with the REAL built CLI (`node dist/cli/main.js …`): `enqueue --mode bootstrap` exits 0 with `"outcome":"enqueued"` and the pending job visible on disk ≤ 500 ms wall clock; a second enqueue merges (jobId + enqueuedAt identical, mode = latest); `worker --once` exits 0 with `"outcome":"stopped"` and drains to no pending job; degraded offline the marker carries `outcome:"failed"`, `mode:"bootstrap"`, non-empty `error.code`, `jobId`, and stderr names the run as background
- [ ] T028 [P] [US1] Write e2e tests `tests/e2e/queue-background-sync.test.ts` per quickstart §2 + §6 (in-process lane): with the 007 fake port (credentials present) enqueue → `runWorker({ once: true })` applies (project visible via the fake tracker), terminal marker `outcome:"success"`, exactly ONE notification record in the `TASK_LINEAR_SYNC_TEST_NOTIFY` sink; a failing first apply increments `retryCount`, and reaching `queue.maxRetries` (config 2) ends with a terminal `failed` marker with `error.code:"RETRY_LIMIT"`, one notification, and a cleared queue — FR-004 retry bound, SC-001 timing
- [ ] T029 [US1] Run the independent MVP test: `npm test` filtered to T004-T019 units + T027 + T028; fix every defect the story exercises until green (this is the MVP completion gate — quickstart §8 preamble story rows, US1 = §2/§4/§6)

**Checkpoint**: MVP — enqueue→background-drain loop verified standalone, degraded offline verified standalone

---

## Phase 4: User Story 2 - Safe queue concurrency and claim recovery (Priority: P2)

**Goal**: exactly one live claim and one pending job under a 100-enqueue storm, abandoned claims reclaimed after 300 s, lock timeout defers without touching queue state, jobs apply in their recorded mode.

**Independent test**: quickstart §2.2 (single slot) + §8 SC-002 row (`pending jobs: 1`, `live claims: 1`, contended worker `"outcome":"stopped"`) + §5 exit-code row 4 (external live lock: `outcome=stopped`, marker untouched) — green ⇒ SC-002 and FR-002/FR-003 verified standalone.

- [ ] T030 [P] [US2] Write integration tests `tests/integration/queue-storm.test.ts` per quickstart §2.2 + §8 SC-002 row: 100 backgrounded `enqueue` calls → exactly ONE pending file/job (SC-001 merge guarantee); a pre-seeded fresh claim makes a concurrent `worker --once` exit 0 reporting `"outcome":"stopped"`; exactly ONE `"claim":` occurrence in the record; pre-seeded claims with `claimedAt` older than `worker.claimTimeoutSeconds` (seeded -900 s) make BOTH contended workers reclaim rather than stall forever — FR-003 (spec US2 scenarios 1-3)
- [ ] T031 [P] [US2] Write integration tests `tests/integration/queue-lock-timeout.test.ts` per quickstart §5 exit-code contract + §6: an externally written `queue-lock.json` with the harness's own live pid makes `worker --once` exit 0 with `"outcome":"stopped"` (NEVER exit 4), last-run marker byte-identical afterwards (zero drain-lifecycle writes while the lock was held), and the lock file itself unchanged; with `queue.lockTimeoutSeconds: 1` the give-up happens within ~1 s of virtual time and reports the timeout — FR-002 (spec US2 scenario 4)
- [ ] T032 [P] [US2] Write integration tests `tests/integration/queue-modes.test.ts` per quickstart §2.2 + §6 mode-application assertions: jobs enqueued with `--mode bootstrap` and plain (sync) carry their mode into `runDrainOnce({ mode })` and the marker (`jq -r '.mode'`), proving mode persistence + per-job application — FR-004 first half (spec US2 — mode recorded and honoured)
- [ ] T033 [US2] Run the independent US2 test: `npm test` filtered to T008/T009/T012/T013 units + T030-T032; fix defects until green (quickstart §8 preamble story rows, US2 = §5/§6)

**Checkpoint**: concurrency guarantees hold under real-process storms

---

## Phase 5: User Story 3 - Managed hook installation and scaffolds (Priority: P3)

**Goal**: managed git hooks and agent-hook scaffolds install idempotently, fire without ever failing the git operation, and change zero bytes outside their markers.

**Independent test**: quickstart §3.1-3.3 (install → byte scan → fire → exit 0 + stderr + merged job) + §3.4 (scaffold in `.kiro/hooks/`, no overwrite) — green ⇒ FR-006/FR-007/SC-003 verified standalone.

- [ ] T034 [P] [US3] Write integration tests `tests/integration/queue-hooks-install.test.ts` per quickstart §3.1-§3.2: `install-hooks` exits 0 with `"outcome":"installed"`; re-run stays exit 0 and adds no second block (idempotent); with `hookScriptPrefix: "task-linear-sync"` re-configured the block contains that prefix; byte-level scan — strip managed ranges and every remaining byte equals the pre-install text (SC-003); a config with an unsupported hook name exits 4 and writes NOTHING under `.git/hooks` (FR-006); `install-agent-hook --framework kiro` lands under `.kiro/hooks/` and never overwrites an existing file (collision `-2` suffix in `installed`) — quickstart §3.4, FR-009
- [ ] T035 [P] [US3] Write integration tests `tests/integration/queue-hook-fire.test.ts` per quickstart §3.3 + §3.5: direct `.git/hooks/post-merge` invocation (fresh-repo note: post-merge is NOT relied on for an already-up-to-date merge) writes the prior run outcome (marker `outcome` + `summary` string) to stderr and exits 0; running the hook with credentials CLEARED still exits 0 and enqueues; repeated hook fires with no worker keep exactly ONE pending job (SC-001, FR-007)
- [ ] T036 [US3] Run the independent US3 test: `npm test` filtered to T020-T023 units + T034-T035; fix defects until green (quickstart §8 preamble story rows, US3 = §3)

**Checkpoint**: hooks fire safely, installs are byte-honest

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: contract scans, documentation duty, cleanup, full-matrix run.

- [ ] T037 [P] Write `specs/010-background-queue-sync-hooks/contracts/queue-packaging.mjs`: `node --eval "import('task-linear-sync/queue')"` prints `function`; every package.json exports target exists under dist/; the `./queue` closure references only `dist/queue/**`, `dist/domain/**`, `dist/state/**`, `dist/urls/**`, `dist/engine/**`, `dist/config/**` (the frozen half + engine); package.json `dependencies` byte-unchanged vs feature start
- [ ] T038 [P] Write `specs/010-background-queue-sync-hooks/contracts/queue-dependency-budget.mjs`: the queue subtree closure never references `@linear/sdk` (grep dist chunks — FR-002 of 009 inherited); zero `dist/src/cli` imports in `dist/queue/**` (constitution IV one-way); run the frozen 009 dependency-budget scan unchanged as an acceptance task
- [ ] T039 [P] Write `specs/010-background-queue-sync-hooks/contracts/queue-defaults-scan.mjs`: default effective values 75 / 30 / 5 / 300 (`worker.claimTimeoutSeconds` — the FR-003 threshold is the frozen key, NOT a new one) in a pristine harness repo; env beats config beats default for the queue knobs (frozen precedence chain); a second invalid queue value lands in the SAME single combined message (quickstart §5 refusal rows, SC-003 message stability)
- [ ] T040 [P] Write `specs/010-background-queue-sync-hooks/contracts/queue-surface-binding.mjs`: default binding — 009's five queue commands delegate to the REAL `src/queue/` surface with frozen exit-code outcomes (enqueued/stopped/installed ⇒ 0, refused ⇒ 4 via the existing presenter, unchanged); `verify-hooks` still exits 2; the 009 exit-code table file is byte-unchanged (research R12)
- [ ] T041 [P] Write `specs/010-background-queue-sync-hooks/contracts/queue-hygiene.mjs`: the R13 zero-delta list — `git diff` touches nothing under src/domain|config|state|urls|gates|ports, src/engine/**, src/cli/**, src/discovery/**, src/reports/**, package.json deps/engines, and no test outside the two 009 files T026 names (briefing §2 frozen paths + §5 doc exception)
- [ ] T042 Document the manual sandbox cleanup (`git worktree remove`, `rm -rf "$SANDBOX"`) in quickstart.md §9.1 and add `tests/helpers/queue-cleanup.ts` (remove tmp git metadata + queue dirs) used by the integration/e2e harness teardown
- [ ] T043 [P] Write `docs/queue-hooks.md` in Polish (briefing §5 documentation duty): queue concepts (single-slot pending job, claims, queue lock), the five commands with the frozen exit-code table, the `queue` config block with defaults and bounds, the hook marker block and scaffold shapes, troubleshooting (lock held, reclaimed claims, suppressed notifications)
- [ ] T044 [P] Update `README.md` (Polish prose per the doc convention): commands section adds `enqueue`, `worker`, `last-run`, `install-hooks`, `install-agent-hook`; config section links the `queue` block to docs/queue-hooks.md; background-sync paragraph in the quick-start flow
- [ ] T045 Run `npm test` (all tiers) + `npx tsc -p tsconfig.json` + all five `queue-*.mjs` scans; record the SC-001 (≤500 ms wall, 100-enqueue storm) and SC-002 (≤1 pending job, exactly 1 live claim, 100% exit-0 hook runs) measurements in the quickstart §8 matrix log
- [ ] T046 Defect sweep: every quickstart §2-§7 scenario green in BOTH lanes (spawned-CLI degraded-offline + in-process fake port); code comment hygiene (constitution: only constraint comments); no `console.log` outside the CLI presenter layer in `src/queue/**`

---

## Dependencies & Execution Order

### Task Structure

```text
Setup (T001-T003)
  → Foundational (T004…T025, test→impl pairs; T024/T025 bind the surface last)
    → T026 (009 test adaptation — needs the built surface)
      → US1 (T027-T029)   ← MVP boundary
      → US2 (T030-T033)   ← needs T008/T009/T012/T013 + T025
      → US3 (T034-T036)   ← needs T020-T023 + T025
        → Polish (T037-T046)
```

### Milestones and Dependencies

1. **Setup** — T001 gates the built-package import lanes; T003 gates every later test
2. **Foundational** — each pair is test-first: T004→T005, T006→T007, T008→T009, T010→T011, T012→T013, T014→T015, T016→T017, T018→T019, T020→T021, T022→T023; T024→T025 binds everything behind the frozen seam; T026 flips the 009 while-absent tests (research R12). Stories CANNOT start before T025/T026 complete — the seam is the architecture
3. **US1 (MVP)** — T027/T028 independent of each other; T029 is the story gate
4. **US2** — T030/T031/T032 independent; T033 is the story gate
5. **US3** — T034/T035 independent; T036 is the story gate
6. **Polish** — T037-T041 independent scans; T043/T044 docs after behavior is settled; T045 full-matrix run; T046 sweep last

**Parallel opportunities**: the ten failing-suite authoring tasks T004/T006/T008/T010/T012/T014/T016/T018/T020/T022 touch disjoint files —
author them together (constitution VI: every suite must be observed RED before its implementation task), then implement the pairs.

### Implementation Strategy

**MVP only**: Setup + Foundational + US1 (T001-T029) — a working background-sync loop with reports and notifications, hooks installable via code paths already built but not yet story-verified.
**Incremental delivery**: MVP → US2 (concurrency hardening) → US3 (hook story verification) → Polish; each story phase ends at a standalone-verified checkpoint per spec.json independentTest commands.
**Team parallel**: after Foundational, three reviewers own US1 / US2 / US3 test phases independently.

---

## Parallel Example: Foundational

```bash
# Author every failing unit suite at once (disjoint files):
Task: "tests/unit/queue-config.test.ts"    (T004)
Task: "tests/unit/pending-job.test.ts"     (T006)
Task: "tests/unit/queue-lock.test.ts"      (T008)
Task: "tests/unit/enqueue.test.ts"         (T010)
Task: "tests/unit/drain.test.ts"           (T012)
Task: "tests/unit/worker.test.ts"          (T014)
Task: "tests/unit/queue-reports.test.ts"   (T016)
Task: "tests/unit/notify.test.ts"          (T018)
Task: "tests/unit/git-hooks.test.ts"       (T020)
Task: "tests/unit/agent-hooks.test.ts"     (T022)
```

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Every implementation task names the tests it must turn GREEN — constitution VI forbids writing the implementation first.
- Frozen-path discipline: any task that would `git diff` a frozen module (briefing §2 + the R13 list) is a defect by construction; T041 enforces it mechanically.
- Validation is exit-code based throughout (constitution article I examples).
- Acceptance gate (spec CLARIFICATION round 1 Q1-A): `npm test` green + every §2-§7 quickstart scenario green + the five `queue-*.mjs` scans pass.
