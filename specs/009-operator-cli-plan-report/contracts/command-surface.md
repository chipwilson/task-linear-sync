# Contract: Command Surface & Exit-Status Map

Modules: `src/cli/{argv,commands,exit-codes,context,io}.ts` + `src/cli/commands/*`.
The bin is `task-linear-sync` (`package.json` `bin` → `dist/cli/main.js`); the same
logic is importable as `task-linear-sync/cli` (`runCli(argv, context): Promise<CliOutcome>`,
research R1/R8). Every sync behavior routes through `task-linear-sync/engine`
(constitution V — this table is normative for that routing).

## 1. Command table (FR-001)

| Command | Syntax | Engine / delegate route | Success exit |
|---|---|---|---|
| `inventory` | `task-linear-sync inventory [repo] [--config <path>]` | read-only composition: 003 `discoverTaskFiles` + 004 `parseTaskFile`, guarded deps (R7) | 0 |
| `discover-metadata` | `… discover-metadata [repo] [--config]` | read-only `port.discoverMetadata(configured teamKeys)`, guarded deps (R7) | 0 |
| `plan` | `… plan [repo] [--config]` | `engine.buildSyncPlan` (persist + report pair via engine stage 7); prints artifact paths | 0 |
| `bootstrap` | `… bootstrap [repo] --plan <planId> --apply --confirm <key> [--accept-low-confidence] [--config]` | load stored plan → `engine.applySyncPlan(plan, GateRequest)` | 0 |
| `sync` | `… sync [repo] --plan <planId> --apply --confirm <key> [--accept-low-confidence] [--config]` | same apply path as `bootstrap` (mode is engine-selected from checkpoints — CLI never forces mode) | 0 |
| `check` | `… check [repo] [--config]` | `plan` lane + one-JSON-object machine summary on stdout (§4) | 0 clean · 8 findings |
| `install-hooks` | `… install-hooks [repo] [--config]` | `QueueSurface.installHooks` | 0 |
| `install-agent-hook` | `… install-agent-hook [repo] [--framework <id>] [--config]` | `QueueSurface.installAgentHook` — **zero issue-tracker network** (FR-003) | 0 |
| `enqueue` | `… enqueue [repo] [--mode bootstrap\|sync] [--config]` | `QueueSurface.enqueue` | 0 |
| `worker` | `… worker [repo] [--once] [--config]` | `QueueSurface.runWorker` | 0 on clean stop |
| `last-run` | `… last-run [repo] [--json] [--config]` | `QueueSurface.readLastRun` (default wiring: frozen `readLastRunMarker`, R5) | 0 (found **or** not found with a clean report) |
| `rollback` | `… rollback [repo] <runId> [--config]` | `engine.rollbackRun(runId)` — unjournaled/expired → frozen refusal, zero mutation (FR-004) | 0 |

Flag rules (data-model §1): unknown flags fail parsing naming the flag; `--plan` is
**required** for `bootstrap`/`sync` (engine-gates rule 3, research R9) — missing ⇒ exit 2
naming `--plan`; `--confirm` requires a value; positional arity is per the table.

## 2. FR-002 — apply-flag rejection on `plan`/`check` (normative)

For `plan` and `check`, if any of `--apply`, `--confirm`, `--accept-low-confidence` is
present, the parser returns a failure naming **every** offending flag and the CLI exits
**2** having performed nothing: no config load, no engine construction, no filesystem
effect, no network. Message shape (screened):

```
refusing plan with apply flag(s): --apply, --accept-low-confidence — plan is read-only; use `bootstrap`/`sync` with --plan, --apply, --confirm to apply a reviewed plan
```

## 3. Exit-status map (research R3 — stable, documented, CI-facing)

| Code | Name | Sources |
|---|---|---|
| 0 | `SUCCESS` | success paths above |
| 1 | `UNEXPECTED_ERROR` | anything unmapped (sanitized one-line stderr) |
| 2 | `USAGE_ERROR` | parse failures (unknown command/flag, arity, missing `--plan`, FR-002) |
| 3 | `CONFIGURATION_ERROR` | `ConfigFileError` (category + path), `MissingIdentityError` (all names), `StatePlacementError`, credential-preflight diagnostics |
| 4 | `GATE_REFUSED` | every frozen `GateFailure` code except `LOCK_HELD`, complete listing (`APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`, `MANIFEST_UNJOURNALED`, `MANIFEST_EXPIRED`) |
| 5 | `RUN_ABORTED` | `ApplyResult.status === "aborted"`, `IntegrityError`, `EngineFailError`, `ReportScreeningError`, `ReadOnlyViolationError` (SC-003), blocked-stdout screening finding |
| 6 | `LOCK_HELD` | frozen `LOCK_HELD` — report and exit, never wait/steal |
| 7 | `SURFACE_UNAVAILABLE` | `QueueSurfaceUnavailableError` (010 module absent, queue-surface.md §3) |
| 8 | `CHECK_FINDINGS` | `check` only: report carries ≥1 unresolved-conflict awaiting-human entry or ≥1 failed security assertion (§4) |

FR-001/SC-002 quantifier: every command exhibits 0 on success and a non-zero member of
this map on every refusal/abort/failure fixture. No code outside this table may be
returned by the CLI; `main.ts` sets `process.exitCode` (never `process.exit()` mid-stream).

## 4. `check` machine contract (013's input; research R10)

- stdout is **exactly one JSON object** (`CheckSummary`, data-model §9) — nothing else;
  all diagnostics go to stderr. Keys: `schemaVersion: 1`, `planId`, `reportJson`,
  `reportMarkdown` (absolute state-dir paths), `counts.{entries, unmapped,
  unresolvedConflicts, lowConfidence}` read off the generated report artifact — never
  re-derived.
- Exit semantics: `0` = completed with no findings; `8` = completed, findings present
  (unresolved-conflict awaiting-human entries `decision === "conflict" ∥
  unresolvedConflict === true`, or a `securityAssertions` item with `status: "fail"`);
  2/3/4/5/6 as per §3 for operational failures. **Missing/malformed report artifact is
  an abort (5), never a silent 0** — 013 relies on this to name the artifact.
- 013's own conditions (thresholds, protected-branch rules) are evaluated by 013 from
  the report JSON; the CLI computes none of them.

## 5. Output posture

- Human commands print: report artifact paths (`plan`), operation counts + report paths
  (`bootstrap`/`sync`/`rollback`), listings (`inventory`, `discover-metadata`,
  `last-run` human mode — `--json` switches to one JSON object).
- **Every line printed** (stdout and stderr) passes the injected `SecurityScreener`
  first; blocking findings abort propagation of the affected line and map the outcome
  to exit 5. Credential values never appear in any output (names only, per the
  constitution's credential rule — the port's preflight diagnostics carry names).
- Commands are side-effect-faithful: read-only commands' only filesystem products are
  the engine's state-directory artifacts (`plans/`, `reports/`); `last-run`/`check`
  write nothing; `rollback`'s mutations are the engine's journaled reversal.
