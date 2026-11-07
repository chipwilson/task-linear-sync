# Operator CLI (`task-linear-sync`)

The operator command surface (feature [009](../specs/009-operator-cli-plan-report/spec.md)).
One bin, twelve commands, every sync behavior routed through the single engine
(`task-linear-sync/engine`); the same logic is importable as
`runCli(argv, context)` from `task-linear-sync/cli`.

Sources of truth: [contracts/command-surface.md](../specs/009-operator-cli-plan-report/contracts/command-surface.md)
(grammar, exit map, `check` contract, output posture) and
[contracts/queue-surface.md](../specs/009-operator-cli-plan-report/contracts/queue-surface.md)
(the queue seam). This document mirrors them for operators; the contracts win on conflict.

## Global grammar

```
task-linear-sync <command> [repo] [flags]
```

- `[repo]` — repository root (default: current directory). For `rollback`, when a second
  positional is present the first positional is the repository root.
- `--config <path>` — configuration file (default: `<repo>/<toolId>.json`).
- `--version` — print `task-linear-sync <version>` (the package version, the one
  version source) and exit 0; given alone it is the only action (no config load, no
  engine), and alongside a command it prints first and the command then proceeds.
- Unknown flags, unknown commands, and arity violations fail with exit 2 naming the
  offending token. `--help` prints the synopsis.

## Commands

### `inventory` — read-only spec inventory

```
task-linear-sync inventory [repo] [--config <path>]
task-linear-sync inventory ~/repos/my-project
```

Discovery + parse only: one sorted line per task file (`tasks=N …`), zero writes, zero
tracker mutations.

### `discover-metadata` — tracker metadata readout

```
task-linear-sync discover-metadata [repo] [--config <path>]
task-linear-sync discover-metadata --config /work/my-tool.json
```

Lists teams, projects, workflow states, and milestones for the configured team keys.
Read-only: zero writes, zero mutations. Every printed line passes the security screener.

### `plan` — build a plan and write the review-report pair

```
task-linear-sync plan [repo] [--config <path>]
task-linear-sync plan ~/repos/my-project
```

Runs `engine.buildSyncPlan` (guarded, read-only toward the tracker) and prints the
`planId` plus both artifact paths (see [Review-report artifacts](#review-report-artifacts)).
Apply flags are refused by design: `plan` with any of `--apply`, `--confirm`,
`--accept-low-confidence` exits 2 naming every offending flag with zero effects —
plan is read-only.

### `check` — machine-readable plan gate (for CI, feature 013)

```
task-linear-sync check [repo] [--config <path>]
task-linear-sync check --config /work/my-tool.json
```

Rebuilds the plan on the same guarded lane, writes the same artifact pair, and prints
**exactly one JSON object** on stdout — the `CheckSummary` machine contract:

```json
{
  "schemaVersion": 1,
  "planId": "<64-hex sha256>",
  "reportJson": "<state-dir>/reports/<runId>/report.json",
  "reportMarkdown": "<state-dir>/reports/<runId>/report.md",
  "counts": { "entries": 12, "unmapped": 2, "unresolvedConflicts": 1, "lowConfidence": 3 }
}
```

- `counts` are read **off the generated report artifact**, never re-derived.
- Exit `0` = completed with no findings; exit `8` = findings present (an entry with
  `decision === "conflict"` or `unresolvedConflict === true`, or a security assertion
  with `status: "fail"`). A missing/malformed report artifact is an abort (5), never a
  silent 0.
- All diagnostics go to stderr; stdout carries only the one JSON object. CI thresholds
  and protected-branch rules are evaluated by 013 from the report JSON — the CLI
  computes none of them.

### `bootstrap` / `sync` — confirmation-gated apply

```
task-linear-sync bootstrap [repo] --plan <planId> --apply --confirm <KEY> [--accept-low-confidence] [--config <path>]
task-linear-sync sync    [repo] --plan <planId> --apply --confirm <KEY> [--accept-low-confidence] [--config <path>]
task-linear-sync bootstrap ~/repos/my-project --plan 4f2b…af90 --apply --confirm ACME --accept-low-confidence
```

The frozen gate trio: `--plan` (a stored `planId` — Plan_Reference), `--apply`, and
`--confirm <KEY>` (must equal the configured confirmation key);
`--accept-low-confidence` acknowledges low-confidence entries. Mode
(bootstrap vs sync) is engine-selected from checkpoints — the CLI never forces it.
On success prints the applied `runId` and report paths; refusals exit 4 naming the
frozen gate code (`CONFIRMATION_KEY_MISMATCH`, `PLAN_REFERENCE_UNKNOWN`,
`LOW_CONFIDENCE_NOT_ACCEPTED`, …) with zero mutations.

### `rollback` — reverse a journaled run

```
task-linear-sync rollback [repo] <runId> [--config <path>]
task-linear-sync rollback ~/repos/my-project 9c31…d210
```

`engine.rollbackRun(runId)`: the journaled reversal, end-to-end. Unknown/unjournaled or
expired runs exit 4 (`MANIFEST_UNJOURNALED` / `MANIFEST_EXPIRED`) with zero mutations;
a held lock exits 6 (never wait, never steal).

### Queue commands — the `QueueSurface` seam

```
task-linear-sync install-hooks       [repo] [--config <path>]
task-linear-sync install-agent-hook  [repo] [--framework <id>] [--config <path>]
task-linear-sync enqueue             [repo] [--mode bootstrap|sync] [--config <path>]
task-linear-sync worker              [repo] [--once] [--config <path>]
task-linear-sync last-run            [repo] [--json] [--config <path>]
```

These five route through the `QueueSurface` seam, not the engine:

- Today the default wiring lazy-imports `task-linear-sync/queue`, which feature **010**
  provides. Until 010 lands, `install-hooks`, `install-agent-hook`, `enqueue`, and
  `worker` refuse with exit **7** (`SURFACE_UNAVAILABLE`) naming the module — with zero
  side effects. `last-run` works today (default wiring reads the frozen
  `last-run.json` marker): it prints the last run cleanly (exit 0) whether or not a run
  is recorded — `--json` switches to one JSON object (`{ "found": false }` when none).
- Refusals from the surface (`status: "refused"`, e.g. "a job is already pending")
  exit 4 naming the detail; `install-agent-hook` performs **zero issue-tracker
  network** by contract.

## Exit-code map (stable, CI-facing)

| Code | Name | Meaning |
|---|---|---|
| 0 | `SUCCESS` | command completed normally |
| 1 | `UNEXPECTED_ERROR` | anything unmapped (sanitized one-line stderr) |
| 2 | `USAGE_ERROR` | parse failures: unknown command/flag, arity, missing `--plan`, apply flags on `plan`/`check` |
| 3 | `CONFIGURATION_ERROR` | config file errors (category + path), missing workspace identity, state placement, credential-preflight diagnostics (names only, never values) |
| 4 | `GATE_REFUSED` | frozen gate refusals: `APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`, `MANIFEST_UNJOURNALED`, `MANIFEST_EXPIRED` (plus queue-surface `refused` outcomes) |
| 5 | `RUN_ABORTED` | aborted apply, integrity errors, report-screening failures, read-only violations, blocked output lines |
| 6 | `LOCK_HELD` | another sync holds the lock — reported, never waited on or stolen |
| 7 | `SURFACE_UNAVAILABLE` | queue command while `task-linear-sync/queue` (010) is absent |
| 8 | `CHECK_FINDINGS` | `check` only: findings present in the report |

No code outside this table is ever returned.

## Review-report artifacts

`plan` and `check` write the same pair, and only this pair, under the configured state
directory (plus the stored plan under `plans/`):

```
<state-dir>/reports/<runId>/report.json   # schema-frozen machine artifact (002 plan-report schema)
<state-dir>/reports/<runId>/report.md     # human review report
```

- Entries are grouped by **project → milestone**; unmapped issues form a separate
  section with an explicit `parentMapped` marker (true iff a descendant is mapped);
  unresolved conflict-marker tasks surface in **both** artifacts, flagged
  `AWAITING HUMAN MARKER RESOLUTION` in the Markdown.
- Sanitization is structural: the report schema admits **no** raw task body or issue
  description field — description material appears only as sha-256 content hashes and
  screened summaries — and the report carries computed security assertions
  (`no-raw-body-or-description-fields`, `description-material-hashed-only`) alongside
  the engine's `zero-tracker-mutations` / `zero-repository-writes` guarantees.
- The repository tree is never modified by `plan`/`check`; only the state dir gains
  artifacts. Read-only lanes are guard-enforced (`ReadOnlyGuard`): a mid-run mutation
  attempt aborts with exit 5 naming the attempt.

## Output posture

Every printed line (stdout and stderr) passes the configured security screener first;
a blocking finding suppresses the line and maps the outcome to exit 5. Credential
values never appear in output (environment-variable **names** only).
