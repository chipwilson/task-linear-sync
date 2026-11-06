# Data Model: Background Sync Queue, Worker and Hook Triggers (010)

**Date**: 2026-11-05 | **Feature**: `specs/010-background-queue-sync-hooks`
**Inputs**: [spec.md](./spec.md) · [research.md](./research.md) · frozen
[002 data model](../002-core-domain-contracts/data-model.md) (§13 PendingJob /
LastRunMarker, §14 Hook Definition/Hook Block, §17 Configuration)

010 adds **four new record types** (`PendingJob` extension, `QueueLockRecord`,
`QueueSettings`, `QueueOutcome`), consumes **two frozen shapes** (LastRunMarker,
Run Reports), and produces **two physical artifacts** (git hook block, agent
scaffold) as text. No frozen entity changes: 002 §13/§14 explicitly reserve
PendingJob/Hook-Block *behavior* to 010 — this file supplies it additively.

## 1. Entity map (010-local, all state-dir or repo-hook-located)

| Entity | Location | Lifetime | Writer |
| --- | --- | --- | --- |
| PendingJob | `<stateDir>/pending-job.json` | enqueue → terminal drain (single slot) | queue module only |
| QueueLockRecord | `<stateDir>/queue-lock.json` | one drain attempt | drain attempt |
| QueueSettings | in-memory, derived per entry | one command | `queue/config.ts` |
| QueueOutcome | in-memory + report/marker | one drain or enqueue | drain / enqueue |
| LastRunMarker | `<stateDir>/last-run.json` (frozen §13) | persistent | engine (runs) / queue (queue-level + suppression rewrite) |
| Run reports | `<stateDir>/reports/<runId>/{report.json,report.md}` (frozen §15) | persistent | frozen `writeRunReports` |
| Hook block | `<gitDir>/hooks/{pre-push,post-merge}` | persistent, marker-bounded | `install-hooks` / `uninstall-hooks` |
| Agent scaffold | `<agentHooksDirectory>/…` (003 layout) | persistent | `install-hooks --framework …` |

State paths come exclusively from the frozen `StateStore.paths` (`queue` =
pending-job path; state dir root for `queue-lock.json`). Raw fs is forbidden —
all reads/writes go through `StateStore.writeJson/readJson` (temp+rename,
0o600) except the lock's exclusive-create, which uses the same directory via
`wx` open (002 lock precedent).

## 2. PendingJob — the single-slot trigger record (FR-001, FR-003, FR-008)

Extends the frozen §13 skeleton `{enqueuedAt, trigger, claim}` with durable-job
fields (research R3). Shape is 010's contract
([queue-protocol.md §2](./contracts/queue-protocol.md)); the engine never reads
it.

```ts
interface PendingJob {
  schemaVersion: 1;
  jobId: string;                 // opaque id: sha256(stateDir|enqueuedAt|pid|seq).hex[0:16]
  mode: "bootstrap" | "sync";    // advisory hint (009 EnqueueInput vocabulary; FR-004) — engine's reality-wins rule unchanged
  trigger: HookTrigger;          // "manual" | "pre-push" | "post-merge" | "agent-save" | <extension literal>
  enqueuedAt: string;            // ISO-8601, injected Clock; kept from the FIRST trigger on merge
  updatedAt: string;             // ISO-8601; advanced on every merge write
  retryCount: number;            // 0 on fresh enqueue; +1 per retried (non-terminal) drain; merge resets to 0
  claim: {                       // null ⇔ unclaimed (data-model §13 claim skeleton, extended with pid)
    workerId: string;            // "<hostname-or-pid>-<random8>" — opaque
    pid: number;                 // OS pid for liveness probe
    claimedAt: string;           // ISO-8601; age feeds abandoned-reclaim
  } | null;
}
```

State transitions (one record slot; transitions happen only under the queue
lock except *enqueue*, which is lock-free by design — FR-001 latency):

```
(∅) ──enqueue──▶ fresh {retryCount:0, claim:null}
fresh|claimed ──enqueue(latest mode, keep jobId/enqueuedAt, reset retryCount)──▶ merged (claim preserved)
fresh ──claim (under queue lock; single atomic write)──▶ claimed
claimed ──applied | terminal-refused | retry-limit──▶ record DELETED (terminal reports/marker written)
claimed ──drain failure (throw/abort, non-LOCK_HELD refused)──▶ fresh{retryCount+1} (requeue)
claimed{age > worker.claimTimeoutSeconds} ──reclaim by any worker──▶ fresh{retryCount+1} → claim ▶ claimed
```

Merge rule (FR-001; spec's "Enqueue during drain" edge case): enqueue over an
existing record always succeeds, keeps `jobId`/`enqueuedAt`, sets `mode` to the
latest trigger's mode, advances `updatedAt`, resets `retryCount: 0` — and
**never touches `claim`** (a live claim survives the merge; FR-003's
single-holder invariant holds mid-drain, and a fresh trigger restarts the retry
budget). A record mid-claim may be merged — a worker mid-drain re-reads
nothing; the *next* drain sees the merged record (coalescing, never a lost
trigger). A corrupt record is treated as `(∅)`: replaced, warned, sanitized.

## 3. QueueLockRecord — drain-attempt mutex (FR-002; research R4)

010-local; distinct from the frozen per-run `RunLock` (002 §7) — the queue lock
serializes *worker drains*, the run lock serializes *apply runs*; nested in
that order only (queue lock → engine takes run lock inside).

```ts
interface QueueLockRecord { schemaVersion: 1; workerId: string; pid: number; acquiredAt: string; }
```

- Acquisition: exclusive create via the frozen `exclusiveCreate` mechanism
  (temp file + `link(2)` publish); on EEXIST read the record, pid-liveness probe
  (`process.kill(pid, 0)`; ESRCH ⇒ dead, EPERM ⇒ alive), takeover only after
  compare-`workerId`-before-unlink + retry create, and only when the holder pid
  is dead; retry with the injected sleep (50 ms + jitter) up to
  `queue.lockTimeoutSeconds`, then give up **without touching** `pending-job.json`
  and record a sanitized lock-failure report.
- Release: unlink only a record carrying one's own `workerId`. Stale-lock takeover
  is logged (sanitized). `readLastRun` never takes this lock (read-only, FR-005).

## 4. QueueSettings — additive `queue` config group (research R2)

Read from the frozen `loadConfig` result (deep-merge preserves unknown keys —
documented additive cast in `queue/config.ts`; frozen keys untouched):

| Key | Range | Default | Used by |
| --- | --- | --- | --- |
| `queue.workerDelaySeconds` | 1–3600 | 75 | delayed-fallback drain (FR-001) |
| `queue.lockTimeoutSeconds` | 1–300 | 30 | queue-lock acquisition budget (FR-002) |
| `queue.maxRetries` | 1–100 | 5 | retry-limit terminal (FR-004) |
| `queue.notificationsEnabled` | boolean | true | notification decision (FR-005) |
| `queue.autoAcceptLowConfidence` | boolean | false | `acceptLowConfidence` gate (FR-004) |
| `queue.hookScriptPrefix` | non-empty string | binName (`task-linear-sync`) | hook block command prefix |
| `queue.hooksDirectory` | absolute path | derived from git dir | override for hook install target |

Reused **frozen** keys: `managedGitHooks` (hook name set),
`agentHooksDirectory`, `confirmationKey`, `taskFilePatterns`,
`worker.claimTimeoutSeconds` (abandoned-claim threshold), `envVarName`
(credential pre-check), `stateDirectory`, `workspaceId` (identity check).

Validation is complete-list: every out-of-range/bad-type/malformed key is
collected and surfaced as one sanitized `QueueOutcome.detail` line (exit 4
posture via `status: "refused"`, never a partial application). Absent `queue`
group ⇒ all defaults (zero-config posture).

## 5. Outcome vocabulary — frozen seam statuses + internal drain causes

The seam-facing shape is **frozen 009**: `QueueOutcome.status ∈
{"installed" | "skipped" | "enqueued" | "stopped" | "refused"}` (+ `detail`,
`installed[]`, `path`, `jobId`) and `LastRunOutcome {found, marker?}` —
re-declared structurally in `queue/types.ts` (§ binding contract §1). 010 adds
**no** seam status. Richer truth lives internally and in persisted artifacts:

```ts
type DrainClass = "applied" | "terminal-refused" | "deferred" | "retried" | "retry-limit" | "stopped";
type Cause = "lock-held" | "retry-limit" | "credential-missing" | "engine-refusal" | "aborted" | "config-invalid" | …; // report/marker text only
```

`runWorker` always resolves `stopped` on clean stop (detail summarizes the
final drain); per-drain class is what reaches reports/marker, never the seam.

Outcome → persistence mapping (internal drain classes):

| Outcome | deletes pending job | report+marker (who) | notification | marker `notificationSuppressed` rewrite |
| --- | --- | --- | --- | --- |
| `applied` | yes | engine's own writes stand | if enabled & marker exists | rewritten with delivery truth |
| `deferred` (engine refused, cause `lock-held` only) | **no** (requeued, **no** retryCount increment) | deferred report only | no | — |
| `terminal-refused` (other refusal) | yes | queue writes via `writeRunReports` | same rules | rewritten |
| `retry-limit` | yes | queue terminal report | yes | rewritten |
| `retried` (throw/abort) | requeued `{retryCount+1}`; terminal `retry-limit` at the boundary | report on terminal only | terminal only | on terminal |
| `stopped` (queue-lock timeout) | **no** | sanitized lock-failure report, no marker | no | — |

Foreground `--once` is one pass of the same machine — the seam still resolves
`stopped`; there is no separate "dry" persistence.

## 6. Hook block & agent scaffold (frozen §14 shapes, behavior here)

- **Hook block** (research R9): marker-delimited lines
  `# >>> task-linear-sync managed hooks v1 >>>` … `# <<< task-linear-sync managed hooks v1 <<<`
  spliced byte-level into `<gitDir>/hooks/{pre-push,post-merge}` (name set =
  frozen `managedGitHooks`). Body: prior-run line `"<prefix>" last-run 1>&2 ||
  true` (FR-007) then `"<prefix>" enqueue 1>&2 || true` (FR-008 —
  `|| true` on every line ⇒ the hook always exits zero, FR-007). Splice preserves user
  content byte-for-byte outside markers (SC-003); create-if-absent adds
  `#!/bin/sh`; existing shebang-less files are left byte-intact + warning
  (never hijack an unknown script). Idempotent: reinstall when drifted,
  no-op when intact. Full normative text:
  [hook-installation.md](./contracts/hook-installation.md).
- **Agent scaffold**: consumes the frozen-pure 003
  `agentHookScaffold(frameworkId, hookScriptPrefix)` record additively —
  enriches its JSON with `event: "post-file-save"` and `pathPatterns:
  config.taskFilePatterns` (never changes the 003 shape contract); writes at
  the 003-suggested name or the first free `-2`/`-3` suffix (never overwrites —
  003 posture). No network, no framework discovery beyond the config-selected
  framework.

## 7. Invariants (enforced by `tests/contract/queue-*` + schema tests)

1. Queue files (`pending-job.json`, `queue-lock.json`) exist **only** inside
   the state directory — never in the repository tree (Principle I).
2. Every field written into a report, marker, notification, or stderr line is
   sanitized (tracker tokens/URLs, credentials, absolute user paths beyond the
   state dir) — reused 008/009 sanitizer, asserted by injected-canary tests.
3. `claim ≠ null ⇒ pid > 0` and `claimedAt` parses ISO-8601; corrupt record ⇒
   treated as `(∅)` with warning, never a crash.
4. `retryCount ∈ [0, maxRetries]`; values beyond range never persist (terminal
   delete happens at the boundary write).
5. Notification never changes a drain's exit path: notification failure is
   invisible to the outcome (FR-005 / research R8).
6. Hook files outside the markers are byte-identical to their pre-install
   bytes (SC-003 golden-bytes tests), and installed blocks equal the
   canonical block byte-for-byte (idempotence).
7. The queue module never imports `src/cli` (direction check,
   queue-dependency-budget) and never performs HTTP/GraphQL itself (Principle
   IV — engine/port lane only).
