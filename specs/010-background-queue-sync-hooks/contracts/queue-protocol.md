# Contract: Queue Protocol (files, lock, claim, drain, retry)

**Feature**: 010 | **Status**: binding for `src/queue/**` | **See also**:
[data-model.md](../data-model.md) · [research R3–R7](../research.md) ·
[frozen run-state contract](../../002-core-domain-contracts/contracts/run-state.md)

This contract is observable through state-dir files and `QueueSurface` results;
it changes no frozen file format (`pending-job.json` extends the 002 §13
skeleton additively; all other 002 state files untouched).

## 1. Files

```
<stateDir>/                       # frozen StateStore.paths (outside repo)
├── pending-job.json              # PendingJob (§2) — single deduplicated slot
├── queue-lock.json               # QueueLockRecord (§3) — drain mutex, transient
├── last-run.json                 # frozen marker (engine + queue writes, §6)
└── reports/<runId>/{report.json,report.md}   # frozen writeRunReports
```

All JSON through `StateStore` (atomic temp+rename, 0o600, `schemaVersion: 1`) —
`pending-job.json` at the frozen `paths.queue`, lock/marker via root-relative
`writeJson("queue-lock.json")`. The lock's exclusive-create follows the frozen
`src/state/lock.ts` precedent exactly: full content written to a
`queue-lock.json.tmp-<pid>-<n>` then published with `link(2)` (EEXIST on
contention; readers can never observe a partial file). The lock's absolute path
is `dirname(paths.queue)/queue-lock.json` — derived from the frozen path, never
a new resolution rule.

## 2. Enqueue (FR-001, FR-007, FR-008; FR-002 scope note in §3)

Lock-free fast path (target: < 500 ms incl. spawn — R6 budget):

1. Read config (frozen `loadConfig`, additive `queue` group,
   [data-model §4](../data-model.md#4-queuesettings--additive-queue-config-group-research-r2));
   invalid queue settings ⇒ status `"refused"` + all bad fields in one detail line.
2. Credential pre-check by **env var name presence only** (`config.envVarName`,
   e.g. `TASK_LINEAR_SYNC_API_KEY`): absent ⇒ warn detail
   (`credential env '<NAME>' is not set — background runs will report an error until it is`)
   and **still enqueue**. No network call, no value read into any artifact
   (Principles III/IV).
3. Merge-write `pending-job.json`: existing record keeps `jobId`/`enqueuedAt`,
   takes latest `mode`, `retryCount: 0` (FR-001 merge), and **never touches `claim`** (a live claim survives; FR-003); fresh record gets
   a fresh id, `retryCount: 0`, `claim: null`.
4. Spawn detached worker (§5); spawn failure ⇒ warning detail (job stays).
5. Resolve `{status: "enqueued", jobId}`; any unexpected fs failure
   ⇒ `{status: "skipped", detail: <sanitized reason>}` —
   never a throw (hook posture: exit 0, FR-007/FR-008); invalid queue settings
   ⇒ `{status: "refused", detail: <complete listing in one line>}`.

Corrupt or foreign-schema `pending-job.json` is replaced by a fresh record with
a sanitized warning (self-healing; Principle I's durability applies only to
records we wrote).

## 3. Queue lock (FR-002)

- Record: `{schemaVersion:1, workerId, pid, acquiredAt}`; file exists ⇔ locked.
- Acquire: exclusive create via temp+`link(2)` (§1); EEXIST ⇒ read record; if
  `pid` provably dead (`process.kill(pid,0)` ⇒ ESRCH; EPERM counts as ALIVE —
  frozen fail-safe rule) take over (unlink, retry); else retry with injectable
  `sleep` (50 ms + jitter default step, injected Clock for test timing) until
  `queue.lockTimeoutSeconds`.
- Timeout: resolve/drain exits `stopped` (background) — **no job mutation**, one
  sanitized lock-failure report (§6; report outcome `aborted`, runId derived from
  `(workerId, attempt)`). Two simultaneous workers ⇒ exactly one drains
  (integration: process-isolated child race, 002 `state-lock-race` precedent).
- **FR-002 scope** (research R4): the lock serializes the *drain lifecycle* —
  read, reclaim, claim, terminal mutation. Enqueue's merge-write (§2) is the
  atomic single-slot rename and never waits on the lock: SC-001's unconditional
  500 ms enqueue SLA must not be blocked by an apply that may hold the lock for
  minutes, and the single-slot + claim-preserving merge keeps "one pending job"
  (SC-002) and "one live claim" (FR-003) intact mid-drain.
- Release: unlink iff the record carries one's own `workerId`; release is idempotent
  (`ENOENT ⇒ success`).

## 4. Claim + drain pass (FR-003, FR-004)

Under the queue lock:

1. Read `pending-job.json`; absent ⇒ nothing to do, release, exit quietly
   (spurious wake posture — no report spam, no marker change).
2. Abandoned-claim reclaim: `claim ≠ null` and age of `claim.claimedAt` >
   `worker.claimTimeoutSeconds` (frozen, default 300) ⇒ requeue
   `{retryCount+1}` then claim. Heartbeat: the draining process refreshes
   `claimedAt` every `claimTimeout/3` (injectable clock in tests — SC/threshold
   behavior never waits on wall clock).
3. Claim = one atomic rewrite embedding `claim: {workerId, pid, claimedAt}`
   (embedded in the single record — no second lock file to race).
4. Engine pass via [queue-surface-implementation.md §4](./queue-surface-implementation.md#4-engine-pass-frozen-lane-only-fr-007):
   fresh `buildSyncPlan({repositoryRoot, mode: job.mode})` → `applySyncPlan`
   with gate values sourced from config only.
5. Terminal-vs-retry classification (R7):

| Engine result | Classification | Job | Report / marker |
| --- | --- | --- | --- |
| `applied` | terminal | delete | engine's own report+marker stand |
| refused cause `LOCK_HELD` (run lock, another apply live) | **deferred — no retryCount increment** | requeue | "deferred" report; next spawn retries |
| refused — other causes (integrity, plan-reference, gate) | terminal | delete | sanitized report + marker via `writeRunReports` |
| outcome `aborted` / thrown error | retryable | requeue `{retryCount+1}` | report only at terminal |
| `retryCount+1 > queue.maxRetries` | terminal | delete | retry-limit report ("giving up after N attempts") + marker |

6. Every terminal claim-guarded mutation re-verifies `claim.workerId === self`
   immediately before the write — a reclaimed-then-resurrected worker cannot
   stomp a newer owner's record (claim-token guard).

## 5. Worker spawn + delayed fallback (FR-001)

One detached child per enqueue (R6):

```
spawn(process.execPath, [<dist>/queue/worker-entry.js, <repositoryRoot>],
      { detached: true, stdio: "ignore", env })  +  child.unref()
```

`worker-entry.js` runs: drain once immediately → sleep `queue.workerDelaySeconds`
→ drain once more → exit 0. The second pass is the lost-wake guard (an enqueue
racing the first drain is caught). The detached child ignores stdin/stdout and
swallows its own errors (reporting is file-based). `runWorker({once:false})`
(foreground) repeats `drain → sleep → drain` until SIGINT/SIGTERM and resolves
`"stopped"` on clean stop — the worker entry and the CLI `worker` command share
one implementation.

## 6. Marker + notification after drains (FR-005)

Per [research R8](../research.md#r8-last-run-marker--stderr-outcome--best-effort-notification-posture):
engine marker writes stand for engine runs; queue-level terminal outcomes write
their own paired report+marker via the frozen `writeRunReports`; after any
drain ending in a markered outcome the queue rewrites `last-run.json`
`notificationSuppressed` to the truth of its notification attempt
(`notificationsEnabled: false` OR no delivery path OR failed delivery ⇒
`true`). The notification itself (title `<toolId> sync <outcome>`, body
runId/outcome/timestamp, sanitized) fires **exactly once per finished run**
when enabled, via the Notifier seam — undeliverable is success; it never
alters the drain outcome or exit.

## 7. Exit posture

No new exit codes: results ride 009's map
([queue-surface contract §3](../../009-operator-cli-plan-report/contracts/queue-surface.md)).
The hook fire path can only ever produce exit 0 through the CLI (outcomes
`enqueued`/`skipped`/`refused` map 0/0/4 — and the hook block appends
`|| true`, so even exit 4 cannot fail the git operation).
