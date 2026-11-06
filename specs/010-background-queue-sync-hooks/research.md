# Phase 0 Research: Background Sync Queue, Worker, and Hook Triggers

**Feature**: `010-background-queue-sync-hooks` | **Date**: 2026-11-05

Resolves every Technical Context unknown and every dependency/integration question.
No NEEDS CLARIFICATION remains in plan.md. Each entry: **Decision / Rationale /
Alternatives considered**.

## R1. Module placement, packaging surface, and dependency budget

- **Decision**: New disjoint `src/queue/` module group, exposed as exactly ONE additive
  subpath export `"./queue"` → `dist/queue/index.{js,d.ts}` (types-first condition). The
  group name is **fixed by the frozen 009 seam**, not chosen here: `src/cli/queue-surface.ts`
  hardcodes the lazy specifier `"../queue/index.js"` and the refusal names
  `task-linear-sync/queue`; the 009 `contracts/queue-surface.md` header states "010 ships
  `src/queue/index.ts` exporting a factory returning a `QueueSurface`". Zero new runtime
  dependencies (the budget tests re-assert zero, they are not edited); imports restricted
  to Node built-ins plus `task-linear-sync/{domain,config,state,ports,gates,discovery,
  engine,tracker}` — `src/queue` NEVER imports `src/cli` (enforced by the
  `queue-hygiene` contract test; the binding direction is CLI → queue only). `package.json`
  edits are exactly the one additive exports entry; `files` already ships `dist`,
  `README.md`, `docs`. Node 20 API floor: `child_process.spawn` detached + `unref`,
  `fs.open(path, "wx")` exclusive create, `process.kill(pid, 0)` liveness — nothing newer.
- **Rationale**: ROADMAP rule 2 / constitution V require an additive, disjoint module
  group; 007/008/009 each added exactly one subpath and 002's data-model §13/§14 and
  `StateStore.paths.queue` pre-reserved the queue's storage and behavior slots. The
  dependency-budget posture is pinned by `tests/contract/tracker-dependency-budget.test.ts`
  and 009's re-assertion; nothing in this feature needs more than Node built-ins.
- **Alternatives considered**: (a) implementing the queue inside `src/cli/` — rejected,
  inverts the seam (009's contract: "010 carries zero CLI coupling", `src/cli` is not
  010's to edit) and would make the queue un-importable by library consumers; (b) a
  separate package/workspace — rejected, the constitution ships one publishable package;
  (c) pulling in a job-queue library (`bullmq`, `cron-parser`) — rejected by the zero-spend
  budget and by the spec's explicit protocol requirements (dedup + lock + claim are simple
  file primitives; a broker is strictly more moving parts than the single pending-job file).

## R2. Configuration: additive `queue` group through the frozen loader + complete-listing validation

- **Decision**: `src/queue/config.ts` defines `QueueSettings` and
  `resolveQueueSettings(config: ResolvedConfig, env?): QueueSettings`, reading (a) the
  **frozen 002 keys** already reserved for these behaviors — `managedGitHooks` (default
  `["pre-push","post-merge"]`), `agentHooksDirectory` (per-framework adapter default),
  `worker.claimTimeoutSeconds` (the abandoned-claim threshold: frozen default 300 s,
  matching the spec range 1–3600 s exactly) — and (b) a feature-owned additive group
  `queue` that survives the frozen `loadConfig` deep-merge verbatim (the frozen merge is
  key-agnostic: unknown groups pass through and 002's own `load.ts` casts the merged
  object to `ResolvedConfig` without stripping), so consumers override 010 keys in the
  same `<toolId>.json` file / programmatic `overrides` layer with the identical
  defaults → file → programmatic precedence (constitution III). Keys, defaults, ranges:

  | Key (file path) | Range | Default | Meaning |
  |---|---|---|---|
  | `queue.workerDelaySeconds` | 1–3600 | **75** | delayed-fallback worker delay after the immediate drain (FR-001) |
  | `queue.lockTimeoutSeconds` | 1–300 | **30** | queue-lock acquisition timeout before the drain exits untouched (FR-002) |
  | `queue.maxRetries` | 1–100 | **5** | retry maximum before the retry-limit terminal report (FR-004) |
  | `queue.notificationsEnabled` | boolean | **true** | best-effort completion notification; `false` ⇒ suppressed (FR-005) |
  | `queue.autoAcceptLowConfidence` | boolean | **false** | the worker's `acceptLowConfidence` gate value — background apply never self-approves low-confidence matches by default (constitution I) |
  | `queue.hookScriptPrefix` | non-empty string | **`= binName`** (resolved at use, so `toolId` derivation wins) | the "configurable script prefix" the installed hook block and agent-hook scaffold invoke (FR-007/009) |
  | `queue.hooksDirectory` | repo-relative or absolute path | **absent** ⇒ repository git hooks directory (R10) | install target override (FR-006) |
  | `managedGitHooks` (frozen) | names validated against the git-hook vocabulary (R10) | `["pre-push","post-merge"]` | managed set (FR-006) |
  | `worker.claimTimeoutSeconds` (frozen) | 1–3600 | 300 | abandoned-claim threshold (FR-003) |

  Validation is **complete-listing, no fail-fast-on-first** (mirrors
  `MissingIdentityError` / gate vocabularies): every out-of-range or wrong-typed value is
  collected into one `QueueConfigError` naming every offending dot-path, its value, and
  its allowed range; the queue surfaces it as `status: "refused"` (009 exit 4) or worker
  startup refusal — never silently clamps or defaults. `builtInQueueDefaults` (exported)
  is the release-scan target alongside `builtInDefaults` (zero org identifiers — the
  `queue-defaults-scan` contract test runs the same shape-detectors over it plus the
  scaffold/hook-block templates).
- **Rationale**: `src/config/schema.ts` is frozen (never edited), but the frozen loader's
  deep-merge deliberately preserves unknown keys, giving an additive, precedence-correct
  landing spot for 010-owned keys without a contract amendment. 002 already shipped the
  three keys that were clearly 010's (`managedGitHooks`, `agentHooksDirectory`,
  `worker.claimTimeoutSeconds` — the last one's default equals the spec's abandoned-claim
  default, so no new key is needed for it). The remaining five values are intrinsically
  010-owned and belong in a group the engine/config layer never has to understand.
  `hookScriptPrefix` defaulting to `binName` keeps the published `bin` the out-of-box hook
  payload while letting library users point hooks at `node /path/to/dist/cli/main.js`
  (documented, used by the e2e fixtures).
- **Alternatives considered**: (a) extending the frozen `WorkerConfig` interface —
  rejected, editing `src/config/schema.ts` violates the freeze; (b) env-var-only
  configuration for queue values — rejected, constitution III mandates the deep-merge
  model with file + programmatic layers; env names would be a second, parallel config
  channel; (c) silently ignoring unknown `queue` keys — rejected, spec requires range
  validation with named diagnostics; (d) reusing frozen `maxRetries` (tracker retries) —
  rejected, different meaning (HTTP retry vs job retry), collision hazard.

## R3. Queue file layout — frozen placement, additive record shape

- **Decision**: All queue state lives in the 002 state directory (placement per frozen
  `resolveStateDir`: configured `stateDirectory` verbatim or platform default
  `<base>/<toolId>/<hash16>`, ABORT inside-repo — so FR "queue files outside the working
  tree" is structural, not procedural). Files:
  - `pending-job.json` — the frozen path `StateStore.paths.queue`, the SINGLE dedup
    record. Shape = 002 data-model §13 skeleton `{ enqueuedAt, trigger, claim }` extended
    additively by 010 (the §13 note says "behavior 010"):
    `{ schemaVersion: 1, jobId, mode: "bootstrap" | "sync", trigger, enqueuedAt,
    updatedAt, retryCount, claim: { workerId, pid, claimedAt } | null }`.
    `jobId = sha256(canonical trigger identity)` — stable across merges so the same
    logical request keeps its id (009's `QueueOutcome.jobId`), first-write wins on merge;
    `mode` is the **latest** enqueue's mode (a fresh hook fire re-targets the pending
    request; merge semantics documented in contracts/queue-protocol.md §2).
  - `queue-lock.json` — `{ workerId, pid, acquiredAt }` (R4).
  - `reports/<runId>/report.{json,md}` — queue-level sanitized reports (lock-failure,
    retry-limit, terminal refusal, drain failure) via the frozen `writeRunReports`
    (screener + secret-keyed refusal, atomic owner-only).
  - `last-run.json` — the frozen `LastRunMarker`; see R9.
  All writes go through `StateStore.writeJson` (temp+rename, 0o600) — the atomic
  temp+rename rename is what makes claim writes observable whole-or-nothing.
- **Rationale**: The spec's Key Entities name exactly two durable artifacts (pending job,
  last-run marker) plus the hook artifacts; 002 already reserved the path and the record
  skeleton, and matching its shape keeps the frozen `readLastRunMarker`-based `last-run`
  command working untouched. One file for "pending" is the dedup guarantee made
  filesystem-visible: SC-002's "at most one pending job" holds by construction because
  there is only ever one slot.
- **Alternatives considered**: (a) a `queue/` directory of numbered job files — rejected,
  contradicts both the frozen single-file path and the single-pending-job requirement;
  (b) storing the queue inside `sync-state.json` (checkpoints) — rejected, that file is
  008's checkpoint consistency unit; mixing protocols creates a corruption blast radius;
  (c) SQLite/LevelDB — rejected (R1).

## R4. Queue lock: distinct protocol, frozen algorithm, timeout = untouched exit

- **Decision**: `src/queue/queue-lock.ts` implements the queue lock on
  `queue-lock.json` with the frozen `acquireRunLock` algorithm re-expressed for the queue
  record (the frozen function itself is NOT reused — it is hard-bound to
  `store.paths.lock` and the frozen 60 s stale window): exclusive create via the frozen
  `exclusiveCreate` mechanism (full record to a temp file, published atomically with
  `link(2)` ⇒ EEXIST on contention, readers never see a partial file); on `EEXIST`, read
  the holder, probe `process.kill(pid, 0)` (ESRCH ⇒ dead ⇒ takeover allowed; EPERM ⇒
  alive); takeover/unlink only after compare-workerId-before-unlink
  + retry exclusive create (single-winner under contention, per the frozen "lock race"
  edge case). Acquisition **retries with short polling (injectable `sleep`, default
  50 ms + jitter) until `queue.lockTimeoutSeconds`**; on timeout the caller MUST NOT
  touch `pending-job.json` and records a sanitized **lock-failure report** via
  `writeRunReports` (outcome `aborted`, runId derived from `(workerId, attempt)`);
  the worker still resolves `status: "stopped"` — the drain *attempt* ended, cleanly
  (FR-002; exit untouched is asserted by content-hash equality of `pending-job.json`).
  Release deletes only a record carrying one's own `workerId` (frozen posture).
  **FR-002 scope (the only reading satisfying FR-001 + FR-002 + SC-001 together)**: the
  lock serializes the *drain lifecycle* — read, reclaim, claim, terminal mutation (R5).
  Enqueue's merge-write is the atomic single-slot rename of R3: it never waits on the
  lock (SC-001's unconditional 500 ms enqueue SLA must not be blocked by an apply that
  may legitimately hold the lock for minutes), never clears the `claim` field, and keeps
  exactly one slot — so "at most one pending job" (SC-002) and "exactly one live claim"
  (FR-003) hold even mid-drain ("Enqueue during drain" spec edge case). US2's
  "queue reads/writes happen only under the queue lock" scopes to the drain-side
  lifecycle mutations; tests pin the enqueue-mid-drain race both ways.
- **Rationale**: The frozen run lock (a) guards applies, (b) has a 60 s stale window
  with no caller timeout, and (c) refuses immediately — the queue protocol needs a
  *wait-with-timeout* of up to 300 s and must never be confused with apply serialization
  (a worker holding the queue lock then taking the run lock inside the engine is two
  distinct locks by design; plan Complexity Tracking records why merging them is wrong).
  Re-using the frozen *algorithm* keeps one reviewed single-winner proof.
- **Alternatives considered**: (a) `flock`-style lock via an open fd — rejected, Node has
  no portable advisory `flock` and it does not survive the record-inspection the
  spec's "sanitized lock-failure report" needs; (b) the engine's `LOCK_HELD` gate path —
  that is apply-level; a queue drain refused at the RUN lock (another apply is live) is
  a retriable job outcome, not a queue-lock timeout (R7); (c) no timeout (fail
  immediately) — rejected: FR-002 explicitly requires a configurable wait then an
  untouched exit.

## R5. Claim protocol: atomic claim under the lock, time-based reclaim, heartbeat

- **Decision**: While holding the queue lock, one drain pass executes (FR-003):
  1. read `pending-job.json`; if absent ⇒ clean no-op stop;
  2. **reclaim**: if `claim !== null` and `clock.elapsed(claim.claimedAt) >
     worker.claimTimeoutSeconds` (injected clock) ⇒ the claim is abandoned: overwrite it
     (reclaim) as part of step 3's single atomic write;
  3. **claim atomically**: write the same record with
     `claim = { workerId, pid, claimedAt }` via one `writeJson` (temp+rename) — because
     every mutation happens under the queue lock and lands as one atomic rename, only one
     worker ever holds a live claim (SC-002);
  4. run the apply (R7);
  5. terminal outcome ⇒ delete `pending-job.json` (unlink); retryable outcome ⇒ rewrite it
     with `claim = null`, `retryCount + 1`, `updatedAt` (FR-004);
  6. release the queue lock.
  **Heartbeat**: while the apply runs, the worker refreshes `claim.claimedAt` every
  `claimTimeoutSeconds / 3` (injectable schedule; writes are short lock re-acquisitions —
  if the lock is held by another worker at heartbeat time, the heartbeat is skipped,
  never forced), so a legitimately long apply is never "abandoned" while a crashed
  worker's claim is reclaimable exactly at the threshold. A reclaimed job that its
  original (zombie) worker later finishes does not double-mutate: the zombie's terminal
  actions (unlink/requeue) are claim-token-guarded — they execute only while
  `claim.workerId` still equals its own (checked under the lock), and the engine's own
  run lock + plan-stability guards are the second line of defense (the engine refuses a
  concurrent apply with `LOCK_HELD` regardless).
- **Rationale**: The spec's protocol is explicitly lock-ordered ("while holding the queue
  lock … reclaimed before the pending job is claimed atomically"), the frozen
  temp+rename gives the atomicity, and a time-based reclaim is the only rule that works
  for both crash-recovery and hung-worker cases; the heartbeat closes the long-apply
  hazard deterministically (unit-testable with the injected clock).
- **Alternatives considered**: (a) pid-liveness-only reclaim (like the run lock) —
  rejected: a live-but-hung worker would wedge the queue forever and the spec's FR-003
  is age-based; (b) separate `claim.json` file — rejected, a second file is a second
  atomicity domain; embedding the claim in the single record (the frozen §13 shape) is
  one rename = one transition; (c) OS `mkdir` locking — rejected, no inspectable record
  for the sanitized failure report and platform-dependent semantics.

## R6. Worker spawn mechanics under Node 20 (detached, immediate + delayed, zero cron)

- **Decision**: `src/queue/spawn.ts` spawns the detached worker with the Node 20-blessed
  pattern: `spawn(process.execPath, [workerEntryPath, repositoryRoot, ...(configFile ?
  ["--config", configFile] : [])], { detached: true, stdio: "ignore", env })` followed by
  `child.unref()` — enqueue never waits, never pipes, and dies happily before the worker
  does. `workerEntryPath` resolves to `new URL("./worker-entry.js", import.meta.url)`
  (compiled `dist/queue/worker-entry.js`), injectable in tests (spawn recorder/faker);
  the entry parses minimal argv and calls the same `runWorker` the seam calls, so the
  detached process and the CLI `worker` command execute identical code (research
  R12's one-surface rule). **Immediate + delayed fallback in ONE process**: the worker
  runs a drain pass immediately, then waits `queue.workerDelaySeconds` (injectable
  `sleep`; tests pass 0/fast values + fake timers, never real 75 s), runs one more drain,
  and exits 0 (once-mode: single immediate pass). A foreground `runWorker(once: false)`
  repeats `drain → sleep(workerDelay) → drain` until SIGINT/SIGTERM for a clean stop
  (009's "resolves on clean stop"). Spawn failure (EACCES/ENOENT) is swallowed into an
  enqueue warning — the pending job stays, and the next enqueue or a manual
  `task-linear-sync worker` drains it (documented degraded posture; the delayed-fallback
  guarantee holds *per successful spawn*, and the always-exit-zero rule keeps git
  unaffected). The 500 ms budget (FR-001/SC-001): the enqueue path is one stat/read +
  one atomic write + one non-blocking `posix_spawn` — asserted as a wall-clock ceiling
  in tests (generous; not timing-racy), never by injected clock.
- **Rationale**: `detached + unref + stdio ignore` is the documented Node way to fire a
  survivor process on all three platforms without daemons, service managers, or cron;
  one spawn covering both immediate and delayed drain is exactly the spec's
  "no lost wake" edge case (an enqueue racing the immediate drain is caught by the
  delayed one) at half the process churn of two spawns per enqueue.
- **Alternatives considered**: (a) spawn a second detached sleeper process per enqueue —
  rejected: doubles storms of processes for the same coverage; (b) spawn `<bin> worker`
  via `process.argv[1]` — rejected: works only when launched through the bin shim, and
  library-only consumers (programmatic `enqueue`) would spawn the wrong script;
  `worker-entry.js` resolves relative to the module itself; (c) `cron`/systemd/Task
  Scheduler — rejected (plan Complexity Tracking); (d) keeping one forever-running daemon
  "claimed" by a lockfile — rejected, resurrection after restart/reboot is the worker
  entry's job and a daemon is a standing privilege the spec never asks for.

## R7. Engine integration: composition only, gate sourcing, terminal-vs-retriable outcomes

- **Decision**: `src/queue/apply-runner.ts` mirrors `createProductionContext`'s wiring
  exactly (composition, zero logic): `createStateStore({repositoryRoot, config, clock})`,
  `createLinearPort({ config, options: { env } })`,
  `createDefaultSecurityScreener(config)`,
  `createSyncEngine(deps, { keyProvider: envVarKeyProvider(config, env) })`. A drain pass
  executes, for the claimed job: `plan = await engine.buildSyncPlan({ repositoryRoot,
  mode: job.mode })` (the job's mode is the frozen advisory hint — reality-wins mode
  selection stays the engine's per 008 `mode.ts`; "honoring the mode" means the worker
  passes the job's mode and never forces the other, asserted against the 007 fake
  worlds); `planId = derivePlanId(plan)` via `persistPlan(plan, state, clock)`
  (engine-exported), then `await engine.applySyncPlan(plan, gates)` with
  `gates = { applyFlag: true, confirmationKey: config.confirmationKey,
  acceptLowConfidence: settings.autoAcceptLowConfidence, planReference: planId }` — the
  background opt-in IS the configuration: the consumer put the confirmation key in the
  config file, the worker presents it exactly; every frozen gate (exact key match,
  low-confidence, stability guards, run lock, journaling, screening) runs inside the
  engine unchanged (constitution I/V). Outcome classification (FR-004):
  - `status: "applied"` ⇒ success — terminal, pending job removed (R5);
  - `status: "refused"` with ONLY `LOCK_HELD` ⇒ **deferred retry**: re-queue WITHOUT
    incrementing `retryCount` (a concurrent CI apply is not this job's failure);
  - any other `status: "refused"` (confirmation mismatch, low-confidence, stale plan…) ⇒
    **terminal**: sanitized refusal report + last-run marker outcome `failed`; retrying a
    deterministic gate refusal cannot change the answer and spinning to the retry limit
    would only spam reports — the retry counter is for transient failures;
  - `status: "aborted"` or a thrown engine/tracker error (incl. `TrackerConfigError` for
    absent credentials — credentials may appear later) ⇒ **retryable**: sanitized failure
    report, re-queue with `retryCount + 1`;
  - `retryCount + 1 > settings.maxRetries` ⇒ stop re-queuing, record the sanitized
    **retry-limit report** and terminal marker (FR-004).
  The engine already writes run reports + the `last-run.json` marker for applied/aborted
  runs (008 `writeRunReportWithMarker`); the queue writes its OWN reports/markers only
  for queue-level outcomes it owns (lock failure, gate refusal terminal, retry limit)
  via the frozen `writeRunReports` — no marker double-writes, no engine edits.
- **Rationale**: Constitution V allows exactly one apply path; the CLI's `apply.ts` is the
  reference caller and the worker copies its *shape*, not its presentation. The
  terminal-vs-retriable split is the only classification that bounds retry work
  meaningfully: deterministic refusals terminate immediately with a human-readable
  sanitized report; transient conditions consume retry budget.
- **Alternatives considered**: (a) reusing a previously stored plan (`--plan` reference
  from state) — rejected: a background run must reflect current inputs; freshness is
  re-derived every drain, plan-stability guards then re-check inside the engine;
  (b) `acceptLowConfidence: true` by default — rejected outright (constitution I: a
  background process may not self-approve a gate an interactive operator must accept);
  (c) retrying gate refusals — rejected per above; (d) importing `src/cli` to reuse its
  command handlers — rejected (R1: import direction).

## R8. Last-run marker + stderr outcome + best-effort notification posture

- **Decision**: FR-005 lands in three parts. (1) **Marker**: for engine-run outcomes the
  engine's marker write stands (frozen); for queue-level terminal outcomes the queue
  writes a paired sanitized report + marker via `writeRunReports` (outcome
  `"failed" | "aborted"`); after every drain that ends in a markered outcome, the queue
  re-writes `last-run.json` via `store.writeJson` with `notificationSuppressed` set to
  the truth of this drain's notification attempt (`true` when
  `notificationsEnabled: false` OR no platform delivery path exists OR the delivery
  spawn failed) — preserving all other frozen marker fields read back first.
  (2) **stderr outcome**: the hook block prints the previous run's outcome to stderr by
  invoking `"<prefix>" last-run 1>&2 || true` before enqueueing (R10) — the marker is
  already served by the frozen `readLastRunMarker` lane (works even in the 009-only
  world), and redirecting its stdout to stderr gives hooks spec-literal stderr output
  with **zero `src/cli` edits**. A foreground worker additionally writes the just-finished
  outcome line to `process.stderr` when `isTTY` — best-effort convenience, untested
  surface kept trivial (one guarded write). (3) **Notification**: `src/queue/notify.ts`
  defines `Notifier { notify(o: {title, body}): Promise<"delivered" | "undeliverable" |
  "suppressed"> }`; production best-effort delivery spawns the platform tool if present
  (`osascript` with `display notification` on darwin, `notify-send` on Linux when found
  on `PATH`, a `powershell -NoProfile -Command New-BalloonTip` on win32) with every
  error/absence mapped to `"undeliverable"` — never a throw, never a nonzero effect on
  the drain ("undeliverable continues without error", FR-005/assumption). Tests inject a
  fake notifier; the default delivery code path is exercised only via a fake
  `which`-resolver (zero real notifications in CI, constitution VI hermeticity).
  For the quickstart's spawned-CLI lane only: when NO platform tool resolves, the
  production resolver additionally honors `TASK_LINEAR_SYNC_TEST_NOTIFY` — the
  notification (`title\tbody` + newline) is appended to that file and counted
  `"delivered"` — giving the bash harness an observable seam without any real
  desktop notification (documented in quickstart §7).
  Body/title carry only runId/outcome/timestamp + tool identity — screened, no
  credential or path-sensitive material beyond the state dir path.
- **Rationale**: The engine owns marker semantics for runs it runs; the queue owns the
  marker for queue-level outcomes and the notification posture field — that split keeps
  exactly one writer per concern at a time and needs no frozen-code change. Redirecting
  existing CLI output in the *installed block* is the only way to get hook-context stderr
  without touching 009's presentation contract.
- **Alternatives considered**: (a) having `src/queue` write `process.stderr` directly
  from `enqueue()` for the previous-outcome line — rejected: untestable through the
  injected-writer CLI design and bypasses 009's io/screening lane; (b) adding a stderr
  sink to `QueueSurface` inputs — rejected: reshaping the frozen seam is "a cross-feature
  amendment, not a private 010 decision" (009 contract §3); (c) notification delivery via
  the tracker (Linear notification) — rejected: network on a completion path the spec
  calls best-effort and platform-local; (d) treating undeliverable as failure — rejected
  by FR-005 verbatim.

## R9. Git-hook installation: marker-bounded, byte-preserving, abort-before-write

- **Decision**: `src/queue/git-hooks.ts`. **Block format** (toolId-derived, versioned):
  start marker line `# >>> <toolId> managed hooks v1 >>>`, end marker
  `# <<< <toolId> managed hooks v1 <<<`; between them (contracts/hook-installation.md is
  normative): the shebang is NOT added inside the block (see byte rule), then
  `"<hookScriptPrefix>" last-run 1>&2 || true` and `"<hookScriptPrefix>" enqueue 1>&2 ||
  true` — previous-outcome to stderr, enqueue to stderr, and `|| true` makes the block
  itself unfailable, which is what makes "every hook invocation exits zero" a property of
  the installed artifact (SC-001) independent of what `enqueue` returns (refused ⇒ its
  `refused:` diagnostic already lands on stderr; skipped ⇒ the sanitized failure detail
  is redirected by `1>&2`). **Pure splice function** `spliceHookBlock(originalBytes,
  blockBytes, eol)`: byte-level, never a string round-trip — locates the marker pair as
  exact lines (LF or CRLF detected per file, preserved), replaces the enclosed region in
  place on re-install (idempotent), or appends `\n<block>\n` when no complete marker pair
  exists; everything outside stays byte-identical (SC-003: 0 bytes changed across
  install/re-install fixtures; property test over arbitrary foreign content). A hook file
  that exists but lacks a shebang is left byte-intact (the byte-preservation rule wins;
  git runs non-shebanged hooks through the shell in practice, and the install reports a
  warning line in `QueueOutcome.detail`). Files are created (when absent) as
  `#!/bin/sh\n<block>\n` and every install sets the executable bit (mode change is not a
  byte change). **Hook-name vocabulary**: a frozen table of the canonical git hook names
  (`applypatch-msg`, `commit-msg`, `fsmonitor-watchman`, `post-update`, `post-applypatch`,
  `post-checkout`, `post-commit`, `post-merge`, `post-receive`, `post-rewrite`,
  `post-update`, `pre-applypatch`, `pre-commit`, `pre-merge-commit`, `pre-push`,
  `pre-rebase`, `pre-receive`, `prepare-commit-msg`, `push-to-checkout`, `update`);
  validation runs BEFORE any write and reports **every** unrecognized name in one
  refused outcome (exit 4 via 009 mapping) — zero partial installs. **Hooks directory**:
  `queue.hooksDirectory` override verbatim, else repository-default resolution WITHOUT a
  `git` binary (003 `discovery/git.ts` precedent): canonical repo root → `.git` directory
  (or `.git` file → parse `gitdir:` one level of indirection, relative to the repo) →
  `<gitdir>/hooks`; missing `.git` ⇒ refused with a naming diagnostic. Installation
  never writes anywhere else in the repository (spec Assumption).
- **Rationale**: Byte-level splice over Buffers is the only way SC-003's "0 bytes"
  survives non-UTF-8 or CRLF content; embedding outcome-printing + always-zero in the
  installed block (not in library code) puts the guarantee exactly where the spec tests
  it — the fired hook script. Vocabulary-abort-before-write mirrors the
  complete-listing posture shared by gates/config validation.
- **Alternatives considered**: (a) `git config core.hooksPath` to a tool-owned directory —
  rejected: hijacks the developer's entire hooks path (a much bigger blast radius than a
  marker block), and the spec says "install into each git hook … at the configured or
  repository-default hooks directory"; (b) delegating to `husky` — rejected (R1 budget +
  the spec's own block semantics); (c) string-based editing with trailing-newline
  normalization — rejected, violates byte preservation; (d) prepending a shebang to
  shebang-less existing files — rejected: a byte change outside the markers for zero
  spec benefit (git invokes hooks via `sh` when exec format lacks a shebang on the
  platforms that matter; warn instead).

## R10. Shell-invocable enqueue entry + hook-fire behavior (FR-007/FR-008)

- **Decision**: The stable entry point is the published CLI command `enqueue` (bin
  `task-linear-sync enqueue [repo] [--mode bootstrap|sync] [--config <path>]`) — already
  presented by 009 and activated by 010's module landing; 010 documents it as the
  contract surface (no new bin). Fire semantics: the installed block (R9) runs
  `last-run` (outcome → stderr) then `enqueue`. `enqueue` behavior through
  `QueueSurface.enqueue`: check the configured credential env-var NAMES
  (`credentialEnvVarNames.token`/`.apiKey`) — absent/empty ⇒ **warning detail, enqueue
  still performed** (the worker will surface the configuration failure with a naming
  diagnostic later; FR-007 case 1); write/merge the pending job under the queue lock;
  spawn the worker (R6); map to outcomes: new ⇒ `enqueued` + `jobId`, merged ⇒ `enqueued`
  + same `jobId` + merge detail, runtime enqueue failure (unwritable state dir, spawn
  throw) ⇒ `skipped` + sanitized failure detail (009 maps `skipped` ⇒ **exit 0** — that
  is how "exit zero even when the enqueue itself fails (error emitted)" holds at the CLI
  while keeping the frozen exit map byte-identical: no new codes, no remapping; the
  block's `1>&2` puts the error text on stderr), invalid 010-owned config ⇒ `refused` +
  detail (exit 4 — a *configuration* error is not an "enqueue failure"; hooks exit 0
  anyway via `|| true`). Direct non-hook use behaves identically (FR-008: manual/CI use
  exits zero on success and on degraded enqueue).
- **Rationale**: One entry point, already frozen in 009's grammar; the `skipped`-means-
  exit-0 rule is 009's contract §1 rule 2 verbatim ("skipped … ⇒ exit 0"), so the
  always-zero hook promise composes without touching 009. Credential *values* are never
  read, only NAME presence (constitution credential handling).
- **Alternatives considered**: (a) a dedicated `enqueue` bin entry distinct from the CLI —
  rejected: two shells to keep stable forever for zero benefit; (b) returning `refused`
  on write failure — rejected: exit 4 would propagate into hook status handling and the
  block's `|| true` would swallow the *only* signal, while `skipped` carries the detail
  through the sanctioned stdout/stderr lane at exit 0; (c) refusing to enqueue without
  credentials — rejected by FR-007 verbatim ("enqueue still performed").

## R11. Agent-hook scaffolding (FR-009): 003 record + additive event/patterns, never overwrite, zero network

- **Decision**: `src/queue/agent-hooks.ts` builds on the frozen 003 pure record
  `agentHookScaffold(frameworkIdentity, hookScriptPrefix)` (it emits
  `{ directory: ".kiro/hooks/" | ".task-linear-sync/hooks/", fileName:
  "<binName>-sync.json", contents: { name, action: "command", command: "<prefix> enqueue"
  } }` and writes NOTHING). 010 (a) selects the framework: explicit `--framework` input
  (`InstallAgentHookInput.frameworkId`), else the first configured `frameworkAdapters`
  entry that carries an agent-hook template (kiro before generic in default order);
  (b) honors the `agentHooksDirectory` config override in place of the adapter default;
  (c) **enriches the JSON additively** with `event: "post-file-save"` and
  `pathPatterns: <config.taskFilePatterns>` — required by FR-009 ("default
  post-file-save event matched against the configured task-file patterns") while keeping
  the 003/009-frozen members (`name`, `action: "command"`, `command` invoking the enqueue
  entry) verbatim, so 009's harness expectations (which write/verify the plain 003
  template through its fake) stay satisfiable by the record's shape; (d) **never
  overwrites**: if the target file exists, write `<stem>-2.json`, `<stem>-3.json`, …
  (first non-conflicting name) and report the actual `path` with `status: "installed"`;
  (e) performs zero tracker mutation and zero network (structurally: the module imports
  nothing that touches the network — hygiene test), writes only under the repository's
  agent-hooks directory, and creates directories as needed.
- **Rationale**: 003 deliberately deferred the write side to 010 ("010-bound record …
  consumed by 010"); enriching rather than replacing keeps the frozen record contract
  and the spec's event/pattern requirement simultaneously. First-suffix naming keeps
  re-runs idempotent-without-destruction per AC-4 ("a non-conflicting name is written").
- **Alternatives considered**: (a) refuse with a conflict report instead of renaming —
  allowed by the spec but rejected as default because re-install ergonomics
  (`install-agent-hook` twice during onboarding) should succeed; renaming is also what
  009's harness fake asserts (second run refused by the *fake's* never-overwrite ⇒ exit
  4 — the fake's posture is 009's test property; 010's own tests pin the rename
  behavior); (b) rendering framework-specific richer templates (Kiro manifest with
  matchers etc.) — rejected: the scaffold vocabulary is exactly what 003 froze; richer
  per-framework formats are an amendment to 003, not a private 010 choice; (c) writing
  into `.kiro/hooks/` unconditionally — rejected, adapter/override selection is the
  frozen source of truth.

## R12. Seam binding to 009: exact landing, exit-map preservation, and the two while-absent tests

- **Decision**: `src/queue/index.ts` exports `createQueueSurface(options?:
  QueueSurfaceOptions): QueueSurface` — matching `delegateTo010`'s documented lookup
  (`mod["createQueueSurface"]` called with no arguments) — plus the public types
  (`QueueSettings`, `QueueSurfaceOptions`, record shapes, `builtInQueueDefaults`, the
  splice/scaffold pure helpers for testability). `QueueSurfaceOptions` is a fully optional
  wiring bag (everything the frozen seams inject: `clock`, `sleep`, `spawnWorker`,
  `notifier`, `makeEngine`/`deps` injection à la `EngineOptions`, `which` resolver,
  `env`) — production defaults fill the rest; the CLI calls `factory()` with no arguments
  and gets the production wiring, exactly flipping the four exit-7 members to real
  behavior. **The 0–8 exit map is untouched** (no new error class reaches the CLI: queue
  refusals are `QueueOutcome.refused` data, not throws). Two 009 tests assert the
  *while-absent* world and become unreachable once `src/queue` exists — per 009
  contract §2 ("010's arrival flips these to the real implementation") they are the
  planned landing adaptations, and they are the ONLY test edits 010 makes:
  (a) `tests/unit/cli-queue-surface.test.ts` — the four members rejecting with
  `QueueSurfaceUnavailableError` becomes: default wiring delegates to the real module
  (outcomes are real plain data); the pure
  `exitCodeForError(new QueueSurfaceUnavailableError(...)) === 7` unit assertions in
  `tests/unit/cli-exit-codes.test.ts` stay untouched (the map survives by construction);
  (b) `tests/integration/cli-commands.test.ts` "queue commands on the DEFAULT surface exit
  7" — rewritten (in-place, same harness) to assert the five default-wired commands now
  succeed against a temp world (`last-run` `found: false` ⇒ exit 0; `enqueue` ⇒ exit 0
  with state-dir writes; zero network), plus a retained refusal-path assertion driven by
  an injected throwing surface for the exit-7 presentation semantics. Everything else in
  009's suite (including `RecordingQueueSurface` fake tests) must pass **unmodified** —
  the seam's outcome vocabulary and exit map are 010's acceptance test.
- **Rationale**: The 009 contract is explicit about what landing means; enumerating the
  exact two test adaptations here prevents "extend vs rewrite" ambiguity at implement
  time and keeps rule 8 (full suite green) provable.
- **Alternatives considered**: (a) keeping the while-absent tests by lazy-import
  mocking — rejected: fragile (import caching, ESM loader hooks) and hides the real
  flip; (b) a second "compat" export shape (`queueSurface` module-level fallback) —
  rejected, `createQueueSurface` is the documented primary and the fallback branch is
  already dead code for 010's purposes.

## R13. Test strategy: deterministic timing, storms, and real fired hooks

- **Decision**: (1) **Clocks/timers**: all protocol timing (claim age, lock timeout,
  worker delay, retry cadence) is driven by the injected `Clock` + injectable `sleep`
  (a test fake advances the clock synchronously) — zero wall-clock sleeps in protocol
  tests; the 500 ms FR-001/SC-001 budgets are asserted as real elapsed-time *ceilings*
  around pure local work (generous, not racy). (2) **Lock/claim races**: real child
  processes (`node build/tests/integration/queue-lock-race-child.js`-style helpers)
  contend for the queue lock exactly like `tests/integration/state-lock-race.test.ts`
  (aged dead-pid takeover ⇒ exactly one winner; live pid ⇒ all refuse). (3) **Storm**:
  100 concurrent `enqueue()` calls (in-process, fake spawn recorder, temp state dir) ⇒
  exactly one `pending-job.json`, one `jobId` across all outcomes, then one drain pass ⇒
  exactly one live claim observed (claim log from the fake engine call sequence) —
  SC-002; plus an e2e flavor spawning 20 real CLI `enqueue` child processes. (4) **Engine
  mode honoring**: drain against `tests/fixtures/engine/worlds/` worlds through the
  007 fake (engine-harness reuse via a thin `tests/helpers/queue-harness.ts`):
  checkpointed world + `mode: "sync"` job ⇒ fake call log shows the sync-lane effects;
  bootstrap world + `mode: "bootstrap"` ⇒ bootstrap lane; the worker's zero-sync-logic
  claim is *proven* by the fake's identical call patterns versus a direct engine call.
  (5) **Hook e2e**: `tests/fixtures/queue/hooks/` files (foreign content, CRLF,
  shebang-less, occupied-target) installed via the real CLI (`install-hooks`,
  `hookScriptPrefix` configured to `node <repo>/../dist/cli/main.js`), fired as real
  scripts (`spawn(sh, [hook])` with `cwd` = fixture repo, POSIX; a PowerShell-gated
  equivalent is documented as CI-irrelevant since CI matrix runners are Linux) asserting
  exit 0 + stderr content + pending job landed; credential-absent and enqueue-failure
  (state dir chmod-read-only) injections included. (6) **Security**: secret sentinels in
  trigger metadata / failure details never appear in reports, marker, hook files, or the
  fake-port log; `writeRunReports` refusal posture on screener-blocked content.
- **Rationale**: Constitution VI's hermetic/deterministic mandate plus the briefing's
  anti-flake rule; the race tier reuses the already-proven child-process pattern rather
  than inventing a second concurrency proof style.
- **Alternatives considered**: (a) simulating races with interleaved promises only —
  rejected: proves nothing about exclusive-create semantics across processes;
  (b) real `setTimeout`/short sleeps — rejected (flake); (c) mocking `child_process`
  globally — rejected, the spawn recorder seam (R6) injects at the module boundary
  instead, keeping e2e spawn paths real where they matter.
