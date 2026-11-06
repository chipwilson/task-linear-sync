# CI enforcement action (feature 013)

The CI enforcement layer ships a GitHub composite action (`action.yml` at the
repository root) plus a small wrapper (`task-linear-sync/ci`) that gates a
pull request on sync hygiene. The wrapper is **strictly read-only**: it wraps
the published `task-linear-sync check` / `task-linear-sync plan` commands,
consumes only the sanitized plan-report JSON artifact they produce, and fails
the step on three configurable violation conditions. There is zero tracker
mutation, zero repository writing, and no apply or mutate mode anywhere in
the layer — the apply path is not reachable from this code by construction
(and `tests/contract/ci-hygiene.test.ts` scans to keep it that way).

## The three conditions

Every run computes all three counts from the report JSON, even when a
condition is toggled off (the counts are always reported as outputs). The
predicates are pure functions of the report entries:

| | Condition | Predicate | Toggle (default) | Threshold (default) |
|---|---|---|---|---|
| a | `unmapped-high-confidence` | entry with high-band confidence and no mapped issue | `fail-on-unmapped` (`true`) | `unmapped-threshold` (`0`) — the count must EXCEED it to trigger |
| b | `unresolved-conflict-block` | entry carrying the unresolved-conflict marker | `fail-on-conflicts` (`true`) | — (any targeted marker block triggers) |
| c | `spec-drift` | MATCHED entry (mapped issue) whose reasons include a spec-change/both-changed conflict, or whose `changedFields` / `expectedMarkdownChanges` are non-empty | `fail-on-drift` (`true`) | `drift-threshold` (`0`) — the count must EXCEED it to trigger |

A disabled condition NEVER fails the step (FR-002). On failure the step exits
non-zero and prints a one-line, screened summary naming each triggered
condition and its count, e.g.:

```
task-linear-sync enforcement failed — unmapped-high-confidence: 1; spec-drift: 3
```

On success:

```
task-linear-sync enforcement passed (unmapped-high-confidence: 0, unresolved-conflict-block: 0, spec-drift: 0)
```

## Protected-branch resolution (condition b)

Condition (b) only gates when the run is TARGETED: a target branch is known
and belongs to the protected set.

1. Target branch: the `branch` input → `GITHUB_BASE_REF` → `GITHUB_REF_NAME`
   (a leading `refs/heads/` is stripped) → none.
2. Protected set: the `protected-branches` input (CSV) → `{GITHUB_BASE_REF}`
   when that is non-empty → empty.
3. When the toggle is on but targeting is impossible (e.g. a push run with no
   configured set), the run PASSES and emits the warning
   `task-linear-sync enforcement warning: unresolved-conflict-block protection skipped — branch context unresolved`
   on stderr. Classified-but-untargeted findings still appear in the counts.

## `action.yml` inputs (thirteen)

| Input | Default | Meaning |
|---|---|---|
| `workspace` | `${{ github.workspace }}` | repository root to enforce (`--workspace`) |
| `config` | `""` | CLI config file path passed to the wrapped command verbatim (`--config`) |
| `command` | `"check"` | wrapped command: `check` or `plan` (`--command`) |
| `report` | `""` | artifact-direct mode: evaluate this report JSON, spawn nothing (`--report`) |
| `cli-entry` | `""` | CLI entry override; empty ⇒ resolution order below (`--cli-entry`) |
| `fail-on-unmapped` | `"true"` | condition (a) toggle |
| `unmapped-threshold` | `"0"` | condition (a) threshold (count exceeds) |
| `fail-on-conflicts` | `"true"` | condition (b) toggle |
| `fail-on-drift` | `"true"` | condition (c) toggle |
| `drift-threshold` | `"0"` | condition (c) threshold (count exceeds) |
| `protected-branches` | `""` | CSV protected set; empty ⇒ `GITHUB_BASE_REF` fallback |
| `branch` | `""` | target-branch override; empty ⇒ `GITHUB_BASE_REF` → `GITHUB_REF_NAME` |
| `auto-build` | `"true"` | run `npm ci && npm run build` in the action dir when `dist/ci/main.js` is absent |

Credential env vars are deliberately NOT inputs: supply the configured
credential env-var NAME through the step's `env:` block (see the example).
The wrapper inherits the process environment for the CLI spawn and never
logs or screens-in values.

## `action.yml` outputs (six)

Written to `$GITHUB_OUTPUT` only when the variable is defined AND the run
produced a pass/fail decision — error exits emit nothing.

| Output | Value |
|---|---|
| `status` | `pass` or `fail` |
| `unmapped-count` | condition (a) count (always computed) |
| `conflict-count` | condition (b) count |
| `drift-count` | condition (c) count |
| `summary` | the screened one-line summary |
| `report-json` | absolute path of the consumed report artifact |

## Exit map (wrapper-owned vocabulary)

| Exit | Meaning |
|---|---|
| 0 | enforcement passed |
| 1 | enforcement failed (≥ one enabled condition triggered) |
| 2 | configuration or report-artifact problem (missing/malformed report names the artifact) |
| 3 | the wrapped CLI command itself failed (spawn error or exit outside `0`/`8`) |

This map is the wrapper's own and is distinct from the CLI's 0–8 exit codes;
the wrapper never leaks CLI exit codes.

## Example workflow

```yaml
jobs:
  enforcement:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: ./                       # or the published action repo
        id: enforce
        with:
          command: check
          drift-threshold: "0"
          protected-branches: "main"   # placeholder default is the PR base branch
        env:
          TASK_LINEAR_SYNC_TOKEN: ${{ secrets.LINEAR_READ_TOKEN }}   # read-scoped
      - run: echo "counts ${{ steps.enforce.outputs.unmapped-count }}"
```

## Standalone usage and artifact-direct mode

Outside GitHub Actions the wrapper is a plain CLI over the same settings
(flags > `TLS_CI_*` env > defaults; see `specs/013-ci-enforcement-layer/data-model.md`):

```bash
node dist/ci/main.js --workspace /path/to/repo --command check
node dist/ci/main.js --workspace /path/to/repo \
  --report /path/to/repo/.task-linear-sync/reports/check/latest.json
```

Artifact-direct mode (`--report`) spawns NOTHING: it loads, schema-validates,
and evaluates the given plan-report JSON — the natural fit for pipelines that
already run `task-linear-sync check`/`plan` as a separate step (or for any
non-GitHub CI that can read a JSON file). A missing or malformed artifact
fails with exit 2 naming the artifact path; a pass is never returned on bad
input.

CLI-mode resolution order for the wrapped CLI entry: the `cli-entry` input →
the action's own `dist/cli/main.js` → the workspace `dist/cli/main.js` →
`node_modules/task-linear-sync/dist/cli/main.js` inside the workspace. The
wrapper invokes only `check` and `plan` — there is no other command surface.

## Environment variables

| Variable | Role |
|---|---|
| `GITHUB_BASE_REF` / `GITHUB_REF_NAME` | branch resolution for condition (b) |
| `GITHUB_OUTPUT` | the wrapper's ONLY write target (step outputs) |
| `GITHUB_WORKSPACE` | default workspace |
| `TLS_CI_WORKSPACE`, `TLS_CI_CONFIG`, `TLS_CI_COMMAND`, `TLS_CI_REPORT`, `TLS_CI_CLI_ENTRY`, `TLS_CI_FAIL_ON_UNMAPPED`, `TLS_CI_UNMAPPED_THRESHOLD`, `TLS_CI_FAIL_ON_CONFLICTS`, `TLS_CI_FAIL_ON_DRIFT`, `TLS_CI_DRIFT_THRESHOLD`, `TLS_CI_PROTECTED_BRANCHES`, `TLS_CI_BRANCH` | flag fallbacks (flags win) |

## Embedding

```ts
import { runEnforcement, resolveSettings, createSpawnCliInvoker } from "task-linear-sync/ci";

const settings = resolveSettings({ flags: { workspace: "/repo", report: "/repo/report.json" }, env: {} });
const outcome = await runEnforcement(settings, {
  screener,                       // any SecurityScreener
  env: {},                        // branch/env view
  cliInvoker: createSpawnCliInvoker({ screener }), // used only in CLI mode
  log: (line, stream) => record(line, stream),
});
// outcome.status: "pass" | "fail"; outcome.outputs: the six action keys.
```

`runEnforcement` throws `CiConfigError` / `CiArtifactError` /
`CiCliFailureError` — never returning a pass on bad input.
