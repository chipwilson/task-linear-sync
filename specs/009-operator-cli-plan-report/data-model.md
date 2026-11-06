# Phase 1 Data Model: Operator CLI and Plan Review Report

**Feature**: `009-operator-cli-plan-report` | **Date**: 2026-11-05

009 owns **no persisted entities**: every durable artifact it touches (the `Plan`,
`StoredPlan`, report pair, `LastRunMarker`) is frozen in 002 and written by the 008
engine (`specs/002-core-domain-contracts/contracts/plan-artifact.md`,
`run-state.md`). The entities below are the CLI's in-memory presentation and
composition shapes. Section numbers are referenced by `contracts/` and `tasks.md`.

## 1. `CliInvocation` — parsed command (research R2)

| Field | Type | Rule |
|---|---|---|
| `command` | one of the twelve names | `inventory`, `discover-metadata`, `plan`, `bootstrap`, `sync`, `check`, `install-hooks`, `install-agent-hook`, `enqueue`, `worker`, `last-run`, `rollback` — anything else is a parse failure |
| `positional` | `readonly string[]` | per-command arity: `rollback` requires exactly one `runId`; `plan`/`check`/`bootstrap`/`sync`/`inventory`/`discover-metadata` accept 0–1 repository path (default `cwd`); others accept none |
| `flags` | `Record<string, string \| true>` | validated against the per-command flag schema (§2); unknown flag ⇒ parse failure naming it |

Validation rules:

- Flag schema per command (contracts/command-surface.md §2 is normative):
  global `--config <path>`; apply-path `--apply`, `--confirm <key>`,
  `--accept-low-confidence`, `--plan <planId>` (`bootstrap`/`sync` only — required,
  research R9); `rollback` none beyond `--config`; `enqueue --mode <bootstrap|sync>`;
  `worker --once`; `last-run --json`; `install-agent-hook --framework <id>`;
  `check` none beyond `--config`.
- **FR-002 rule (normative)**: for `plan` and `check`, any of `--apply`, `--confirm`,
  `--accept-low-confidence` present ⇒ parse failure listing **every** offending flag
  name; the parser performs nothing else.
- The parser is pure: same argv ⇒ byte-identical outcome; zero I/O.

## 2. `ParseFailure` / `CliError` taxonomy (research R2, R3)

| Error | Thrown by | Payload | Exit (R3) |
|---|---|---|---|
| `ParseFailure` (value, not thrown) | `parseInvocation` | `flags: string[]` (every offender), `message` | 2 |
| `ConfigError` wrapper | context build | wraps frozen `ConfigFileError` (category + path), `MissingIdentityError` (all missing names), `StatePlacementError` | 3 |
| `GateRefusal` wrapper | result presentation | the frozen `GateFailure[]` verbatim (complete listing) | 4 |
| `RunAborted` wrapper | result presentation | frozen `ApplyResult.status === "aborted"`, `IntegrityError`, `EngineFailError`, `ReportScreeningError`, drift detail | 5 |
| `LockHeld` wrapper | result presentation | frozen `LOCK_HELD` `GateFailure` + holder pid (informational only) | 6 |
| `QueueSurfaceUnavailableError` | default `QueueSurface` wiring | command name + missing module (`task-linear-sync/queue`) | 7 |
| `ReadOnlyViolationError` | `ReadOnlyGuard` (§5) | attempted member (`LinearPort` member name or state relative path) | 5 |
| unexpected `Error` | anywhere | sanitized one-line summary on stderr; never a credential value | 1 |

All messages pass the `SecurityScreener` before printing (io layer); messages name no
credential value and no raw task body (by construction + screening).

## 3. `ExitCode` (research R3 — frozen 009 vocabulary, documented in `docs/cli.md`)

`0 SUCCESS · 1 UNEXPECTED_ERROR · 2 USAGE_ERROR · 3 CONFIGURATION_ERROR · 4 GATE_REFUSED
· 5 RUN_ABORTED · 6 LOCK_HELD · 7 SURFACE_UNAVAILABLE · 8 CHECK_FINDINGS`.
`exitCodeForError(error): ExitCode` is a pure total function over the taxonomy above +
the frozen `GateFailureCode` union: `APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`,
`LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`,
`MANIFEST_UNJOURNALED` (FR-004), `MANIFEST_EXPIRED` → 4; `LOCK_HELD` → 6.

## 4. `CliContext` — the single injection seam (research R1, R5, R8)

| Member | Type | Default (production) |
|---|---|---|
| `cwd` | `string` | `process.cwd()` |
| `env` | `Record<string,string \| undefined>` | `process.env` |
| `stdout` / `stderr` | writer ports `(line: string) => void` | screened writers (§7) |
| `clock` | frozen `Clock` | system clock |
| `loadConfig` | `(o: LoadConfigOptions) => ResolvedConfig` | frozen `loadConfig`; config path = `--config` value else `<repositoryRoot>/<configFileName>` |
| `makePort` | `(config, env) => LinearPort` | `createLinearPort` (007); tests inject the 007 fake |
| `makeScreener` | `(config) => SecurityScreener` | `createDefaultSecurityScreener` (008) |
| `makeEngine` | `(deps, config) => SyncEngine` | `createSyncEngine` (008) |
| `makeState` | `(config, repositoryRoot) => StateStore` | frozen `StateStore` factory |
| `queueSurface` | `QueueSurface` (§6) | `createDefaultQueueSurface()` (R5) |
| `keyProvider` | frozen `KeyProvider` | env-var key provider (engine default) |

Rules: `runCli(argv, context)` is the only entry; `main.ts` = `runCli(process.argv.slice(2),
createProductionContext())` + `process.exitCode = outcome.exitCode`. Handlers never touch
`process` directly (contract-testable purity). Read-only commands receive context-built
**guarded** deps (§5).

## 5. `ReadOnlyGuard` (research R6 — enforces FR-005 / SC-003 / AC2-AC4)

`createReadOnlyGuard(deps: EngineDependencies, allowedWritePrefixes: readonly string[])`
returns wrapped deps:

- `port`: every mutating `LinearPort` member (`createIssue`, `updateIssue`, `updateIssueContent`,
  attachment create/update/delete members, … — enumerated from the frozen port surface)
  throws `ReadOnlyViolationError("attempted <member> during read-only command <name>")`;
  read members delegate unchanged.
- `state`: `writeJson`/`writeText` (and `ensure` side-effects beyond directory creation)
  throw `ReadOnlyViolationError` naming the relative path unless it starts with an
  allowed prefix. `plan`/`check` allow exactly `reports/` + `plans/` (engine stage-7
  artifacts); `inventory`/`discover-metadata` allow nothing.
- `clock`, `config`, `screener` pass through untouched.

State transition (per read-only run): `running → (any refused attempt | engine reject) →
aborted` — the run is not resumable; nothing is written before or after the violation.
Repo-tree zero-write proof is a test obligation (SC-003), not a runtime check.

## 6. `QueueSurface` — the 010 delegate seam (research R5; contracts/queue-surface.md)

| Member | Input (validated at parse) | Outcome fields |
|---|---|---|
| `installHooks` | `{ repositoryRoot, config }` | `QueueOutcome { status: "installed" \| "skipped" \| "refused", detail?, installed?: string[] }` |
| `installAgentHook` | `{ repositoryRoot, config, frameworkId? }` | `QueueOutcome { status, detail?, path? }` — writes only the local template file; zero network |
| `enqueue` | `{ repositoryRoot, config, mode: "bootstrap" \| "sync" }` | `QueueOutcome { status: "enqueued" \| "skipped" \| "refused", detail?, jobId? }` |
| `runWorker` | `{ repositoryRoot, config, once: boolean }` | `QueueOutcome { status: "stopped" \| "refused", detail? }` |
| `readLastRun` | `{ state: StateStore }` | `{ found: boolean, marker?: frozen LastRunMarker (runId, outcome, completedAt, reportPaths, notificationSuppressed) }` |

`status: "refused"` maps to exit 4 (with `detail`), the other statuses and `found: false`
to 0;
default wiring refuses all but `readLastRun` with `QueueSurfaceUnavailableError` (exit 7)
while `task-linear-sync/queue` is absent. `QueueOutcome` is data only — no callbacks, so
fakes stay one-liners and 010's real implementation carries no CLI coupling.

## 7. io + screening presentation

- stdout lines from command handlers pass `screener.screen()` before writing; a blocking
  finding replaces the line with a sanitized blocked notice and turns the command
  outcome into exit 5 (`RUN_ABORTED`) — propagation of blocked content is forbidden
  (constitution I).
- `check` stdout is exactly one JSON object (§9); `last-run --json` likewise.

## 8. Review-report entities (consumed — authority stays in 002/008)

The JSON artifact is the frozen `plan-report.schema.json` document; 009 introduces no
new report fields. 009's model is the **assertion surface**: per-entry required fields
(FR-006: `decision`, `framework`, `featureName`, `filePath`, `confidence`, `score`,
`margin`, `reasons`, `alternatives` ≤ 3, `changedFields`, `descriptionContentHash`,
`expectedMarkdownChanges`, `lowConfidenceGateStatus`), grouping invariants (FR-007:
`groups[]` project→milestone ordering; `unmapped[]` separate; `parentMapped` true iff a
descendant is mapped; unresolved-conflict entries surfaced in both artifacts), the
`securityAssertions[]` block (FR-008, `minItems: 1`, each `guarantee`/`status`/`detail`),
content exclusion (hashes only; SC-001 zero raw bodies/descriptions), and placement
(`reports/<runId>/` in the state directory only — spec edge case). See
contracts/plan-review-report.md for the normative list 009's tests enforce.

## 9. `CheckSummary` (research R10 — 013's machine surface, stdout-only, not persisted)

`{ schemaVersion: 1, planId: string, reportJson: string, reportMarkdown: string,
counts: { entries: number, unmapped: number, unresolvedConflicts: number,
lowConfidence: number } }` — every value read off the generated report artifact
(fields §8); deterministic byte output for identical inputs; contains no raw body or
description text (schema shapes only: ids, paths, integers).

## 10. Lifecycle state machines (command-level)

```
parse → context-build (config/state/port) → handler → present → exitCode
  │            │                             │
  └ 2 usage    └ 3 config / 5 placement      ├ refused(gate) → 4 (complete listing)
                                             ├ LOCK_HELD     → 6
                                             ├ aborted       → 5
                                             ├ surface absent→ 7
                                             └ check findings→ 8 (read-only lanes only)
```

Mutating commands construct `GateRequest { applyFlag: --apply present, confirmationKey:
--confirm value, acceptLowConfidence: --accept-low-confidence present, planReference:
--plan value }` and nothing else (research R9). Rollback: `runId` positional →
`engine.rollbackRun(runId)`; `status: "refused"` (MANIFEST_UNJOURNALED/MANIFEST_EXPIRED)
→ exit 4 with the frozen detail, zero mutation asserted (FR-004).
