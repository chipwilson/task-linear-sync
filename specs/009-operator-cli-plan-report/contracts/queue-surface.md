# Contract: `QueueSurface` — the 010 Delegate Seam

Module: `src/cli/queue-surface.ts`. The five commands `install-hooks`,
`install-agent-hook`, `enqueue`, `worker`, `last-run` are **command-surface
presentations of 010's behaviors** (spec Assumptions): 009 owns argv parsing, outcome →
exit mapping, and output; 010 owns what happens inside. This interface is the binding
seam — 010 ships `src/queue/index.ts` exporting a factory returning a `QueueSurface`
and replaces only the default wiring, with **zero `src/cli` edits**.

## 1. Interface (normative)

```ts
export interface QueueSurface {
  installHooks(o: InstallHooksInput): Promise<QueueOutcome>;
  installAgentHook(o: InstallAgentHookInput): Promise<QueueOutcome>;
  enqueue(o: EnqueueInput): Promise<QueueOutcome>;
  /** Resolves on clean stop (`--once` single pass, or a signalled shutdown). */
  runWorker(o: WorkerInput): Promise<QueueOutcome>;
  readLastRun(o: ReadLastRunInput): Promise<LastRunOutcome>;
}

export interface InstallHooksInput      { readonly repositoryRoot: string; readonly config: ResolvedConfig }
export interface InstallAgentHookInput  { readonly repositoryRoot: string; readonly config: ResolvedConfig; readonly frameworkId?: string }
export interface EnqueueInput           { readonly repositoryRoot: string; readonly config: ResolvedConfig; readonly mode: "bootstrap" | "sync" }
export interface WorkerInput            { readonly repositoryRoot: string; readonly config: ResolvedConfig; readonly once: boolean }
export interface ReadLastRunInput       { readonly state: StateStore }

export interface QueueOutcome {
  readonly status: "installed" | "skipped" | "enqueued" | "stopped" | "refused";
  readonly detail?: string;              // sanitized, screened before printing
  readonly installed?: readonly string[]; // hook names (installHooks)
  readonly path?: string;                 // template file written (installAgentHook)
  readonly jobId?: string;                // enqueue dedup target
}

export interface LastRunOutcome {
  readonly found: boolean;
  readonly marker?: LastRunMarker;       // frozen 002 shape (run-state.md §Reports)
}
```

Rules:

1. Inputs are the already-resolved config + canonical repository root; the surface
   performs its own validation of 010-owned values (managed-hook list, retry counts) —
   the CLI never pre-validates 010 semantics.
2. `status: "refused"` ⇒ exit 4 with `detail`; `installed`/`enqueued`/`stopped`,
   `skipped`, and `found: false` ⇒ exit 0 (a clean "nothing to do"/"no run recorded yet"
   is success, not failure). Outcomes are **plain data** — no callbacks, no streams —
   so fakes are one-liners and 010 carries zero CLI coupling.
3. `installAgentHook` MUST perform zero issue-tracker network calls (FR-003) and write
   only the local template file (003's pure `agentHookScaffold` record — `.kiro/hooks/`
   or `.task-linear-sync/hooks/`, `command` running `<binName> enqueue`). Never
   overwrites an existing file (010 ownership; 009 tests assert via the fake).
4. `runWorker` invokes **only** the engine apply path for jobs (010 rule); the CLI adds
   no sync logic on either side of the seam.

## 2. Default wiring (`createDefaultQueueSurface`)

- `readLastRun` — served immediately from the frozen 002 primitive
  `readLastRunMarker(state)`; the marker is written by the engine since 008, so
  `last-run` works in the 009-only world (research R5's documented resolution of the
  spec-assumption tension).
- The other four members attempt a lazy dynamic `import("../queue/index.js")` on each
  invocation. While `src/queue/` does not exist (the state of the repo when 009 ships),
  the `ERR_MODULE_NOT_FOUND` is translated into
  `QueueSurfaceUnavailableError("<command> is provided by the background-queue feature
  (task-linear-sync/queue), which is not installed in this build")` ⇒ **exit 7**, zero
  mutation, zero network. 010's arrival flips these to the real implementation with no
  CLI change.

## 3. Test-posture (009) vs wiring-posture (010)

- 009 integration/e2e tests inject recording fake `QueueSurface` implementations
  (`tests/helpers/cli-harness.ts`): success/refused outcome → exit mapping for all five
  commands; FR-003 zero-network asserted on the fake `LinearPort` call log during
  `install-agent-hook`; the default wiring's refusal asserted (exit 7, nothing written)
  against the real repo state (`src/queue/` absent).
- 010 replaces the default wiring and adds integration tests through the same CLI
  surface (briefing 010 note); the five-method interface, outcome shapes, and exit map
  above are what it must satisfy. Renaming or reshaping any member is a cross-feature
  amendment to this contract, not a private 010 decision.
