# Contract: QueueSurface Implementation Binding

**Feature**: 010 | **Status**: binding for `src/queue/index.ts`,
`src/queue/surface.ts`, `src/queue/config.ts`, `src/queue/worker-entry.ts`
**Satisfies**: [009 queue-surface contract](../../009-operator-cli-plan-report/contracts/queue-surface.md)
(frozen five-method seam — this feature adds zero CLI edits, zero new exit codes)

## 1. The binding (fixed, not negotiable — research R1/R12)

`src/queue/index.ts` MUST export `createQueueSurface(options?: QueueWiring): QueueSurface`:
`src/cli/queue-surface.ts` lazy-imports `"../queue/index.js"` per invocation and calls
`createQueueSurface` **with zero arguments** (falling back to `queueSurface` or the
module namespace only if the factory is absent — 010 provides the factory). The
package subpath `task-linear-sync/queue` (additive `exports` entry, types-first) is
the only public route into the group.

The seam types above are **re-declared structurally** inside `src/queue/surface.ts`
(`QueueOutcome` etc.) because `src/queue` MUST NOT import `src/cli` (import
direction CLI → queue only). Compatibility is enforced at test time:
`tests/contract/queue-surface-binding.test.ts` asserts
`impl satisfies import("../src/cli/queue-surface.js").QueueSurface` (type-level) and
drives all five members through the *real* 009 lazy-import path (behavior-level).

## 2. Member-by-member (frozen inputs/outputs — verbatim 009)

| Seam member (input) | Behavior | Resolves |
| --- | --- | --- |
| `installHooks({repositoryRoot, config})` | install/sanitize managed git-hook blocks per [hook-installation.md §1](./hook-installation.md) | success `{status:"installed", installed:[names]}`; `managedGitHooks: []` ⇒ `{status:"skipped", detail}`; bad hook *names* or invalid queue settings ⇒ `{status:"refused", detail}`; shebang-less-file warnings ride `detail` on an otherwise-successful install |
| `installAgentHook({repositoryRoot, config, frameworkId?})` | scaffold per [hook-installation.md §2](./hook-installation.md) | `{status:"installed", path}` (collision suffixes are *successes* — the chosen path is reported); unknown frameworkId ⇒ `{status:"refused", detail}`; zero network (009 FR-003 posture) |
| `enqueue({repositoryRoot, config, mode})` | merge-write + detached spawn, `mode: "bootstrap" \| "sync"` is the job hint | `{status:"enqueued", jobId}`; fs failure ⇒ `{status:"skipped", detail:<sanitized>}`; invalid queue settings ⇒ `{status:"refused", detail}` — **never throws** (hook posture exit 0 via 009 map: enqueued/skipped ⇒ 0, refused ⇒ 4) |
| `runWorker({repositoryRoot, config, once})` | queue-protocol §3–§5 drain loop; `once` ⇒ one pass; else loop until SIGINT/SIGTERM | `{status:"stopped", detail:<one-line summary of final drain>}` on clean stop; invalid queue settings ⇒ `{status:"refused", detail}`. Per-drain truth (`completed`/`failed`/`aborted` + deferred causes) is persisted in reports/marker, never squeezed into the frozen status set |
| `readLastRun({state})` | frozen `readLastRunMarker(state)` — the CLI serves this itself; the implementation exists for programmatic consumers | `{found:false}` or `{found:true, marker}` |

`detail` is always a single sanitized line (frozen `QueueOutcome` shape); where
several findings exist (e.g. complete-listing config errors), they are joined
into that one line — complete listing preserved, shape unchanged.

## 3. `QueueWiring` — all-optional production/test seam

Because the CLI calls `createQueueSurface()` with no arguments, every member of
`QueueWiring` has a production default and a test replacement (Principle VI —
no wall-clock, no real spawn, no real notifications in tests):

```ts
interface QueueWiring {
  clock?: Clock;                     // frozen state Clock (systemClock default)
  sleep?: (ms: number) => Promise<void>;   // injectable; tests pass instant
  spawnWorker?: (o: SpawnOptions) => void; // default: detached spawn (queue-protocol §5)
  notifier?: Notifier;               // default: platform best-effort (R8)
  which?: (tool: string) => string | null; // notifier tool resolution; fake in tests
  env?: Readonly<Record<string, string | undefined>>; // process.env default
  workerEntryPath?: string;          // default: ./worker-entry.js next to module
}
```

`worker-entry.ts` parses `argv[2] = repositoryRoot` (default cwd), calls
`loadConfig` itself (the spawned process has no CLI), builds
`createQueueSurface({})` and runs the same `runWorker({once:false})` — one
implementation, two entry points (R6).

## 4. Engine pass (frozen lane only) (FR-007)

`src/queue/apply-runner.ts` composes the frozen wiring exactly like
`src/cli/context.ts` (`createStateStore`, `createLinearPort`,
`createDefaultSecurityScreener`, `createSyncEngine` + `envVarKeyProvider`) —
composition only, zero engine logic, no `src/cli` import (re-exported frozen
factories come from `task-linear-sync/{state,tracker,gates,engine}`). Gates:
`applyFlag: true` (the operator's install-hooks intent is the standing
approval; the *plan's own* confirmations are the engine's own gate values from
config — `confirmationKey: config.confirmationKey`, `acceptLowConfidence:
config.queue?.autoAcceptLowConfidence ?? false`, fresh `planReference` derived
per drain). Classification of engine results:
[queue-protocol.md §4](./queue-protocol.md#4-claim--drain-pass-fr-003-fr-007-fr-009).
Refusals never degrade into "applied"; refusals never retry unboundedly.

## 5. Exit-code posture (009's map — extended, never rewritten)

| Seam outcome | 009 exit | Meaning here |
| --- | --- | --- |
| `installed` / `enqueued` / `skipped` / `stopped` | 0 | success postures (skipped = degraded-but-safe, hook must stay silent-green) |
| `refused` | 4 | invalid queue settings, bad hook names, unknown framework — operator-fixable, detail on stderr |
| frozen config/identity failure (CLI lane) | 3 | unchanged (loadConfig before seam) |
| `QueueSurfaceUnavailableError` | 7 | module-absent posture only — with 010 shipped the lazy import resolves, so the queue commands no longer produce it; the two 009 while-absent tests are adapted by R12 (kept alive for partial/broken installs) |

010's arrival adapts exactly two while-absent 009 tests (research R12:
`tests/unit/cli-queue-surface.test.ts` absent-module cases and the
`tests/integration/cli-commands.test.ts` exit-7-on-default-surface case) —
no other 009 test edits; the exit-code map tests stay untouched.

## 6. Hygiene (contract-scanned)

- `queue-hygiene`: no `src/cli` imports, no direct `node:http`/GraphQL, no
  `Math.random`/wall-clock (`Date.now`/`new Date`) outside injectable defaults;
  `child_process` only in `spawn.ts`/`notify.ts`.
- `queue-dependency-budget`: zero new runtime deps; allowed specifiers per R1.
- `queue-packaging`: `./queue` exports entry resolves types+js from `dist`.
- `queue-defaults-scan`: `autoAcceptLowConfidence` default false; no plaintext
  credential can reach any queue artifact (canary test reuses 009 sanitizer).
- Every write stays inside the state dir or the resolved hooks/agent dirs.
