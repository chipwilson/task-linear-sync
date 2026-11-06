# Contract: `action.yml` — the CI_Enforcement_Action surface

The file lives at the repository root and is EXACTLY this shape (bound by
`tests/contract/ci-action-shape.test.ts`, which parses the committed YAML with a
purpose-built minimal reader — no YAML dependency). Constitution "Technology stack":
"ships as `action.yml` plus a wrapper that invokes the published CLI"; 001 Requirement 26
criterion 1 names the published action `task-linear-sync-action`.

## 1. Top-level shape (normative)

```yaml
name: "task-linear-sync CI enforcement"        # exact name string
description: >-                                # read-only hygiene gate; zero mutations/writes
  Gates a pull request on sync hygiene: wraps the published read-only task-linear-sync
  check/plan commands, consumes only the sanitized plan-report JSON, and fails the step on
  the three configurable violation conditions. Zero tracker mutations, zero repository
  writes, no apply or mutate mode.
author: "task-linear-sync contributors"
inputs: { … }                                  # §2 — EXACTLY the thirteen inputs, no others
outputs: { … }                                 # §3 — EXACTLY the six outputs, no others
runs:
  using: composite                             # research R1 — never "node20", never "docker"
  steps:                                       # §5 — build-guard step + wrapper step, bash
```

## 2. Inputs (thirteen; defaults are the FR-002/FR-003 defaults — zero org identifiers)

| Input | Default | Meaning (wrapper flag / env per data-model §1) |
|---|---|---|
| `workspace` | `${{ github.workspace }}` | repo root to enforce (`--workspace`) |
| `config` | `""` | CLI config file path, passed to the CLI verbatim (`--config`) |
| `command` | `"check"` | wrapped command: `check` \| `plan` (`--command`) |
| `report` | `""` | artifact-direct mode: evaluate this report JSON, spawn nothing (`--report`) |
| `cli-entry` | `""` | CLI entry override; empty ⇒ research R3 resolution order (`--cli-entry`) |
| `fail-on-unmapped` | `"true"` | condition (a) toggle (`--fail-on-unmapped`) |
| `unmapped-threshold` | `"0"` | condition (a) threshold, count EXCEEDS to trigger (`--unmapped-threshold`) |
| `fail-on-conflicts` | `"true"` | condition (b) toggle (`--fail-on-conflicts`) |
| `fail-on-drift` | `"true"` | condition (c) toggle (`--fail-on-drift`) |
| `drift-threshold` | `"0"` | condition (c) threshold, count EXCEEDS to trigger (`--drift-threshold`) |
| `protected-branches` | `""` | CSV protected set; empty ⇒ `GITHUB_BASE_REF` fallback (research R6) |
| `branch` | `""` | target-branch override; empty ⇒ `GITHUB_BASE_REF` → `GITHUB_REF_NAME` (R6) |
| `auto-build` | `"true"` | build the package inside the action dir when `dist/ci/main.js` is absent (R1) |

(The set — thirteen including `auto-build` — is pinned exactly by the `ci-action-shape`
test.) Defaults must carry zero real organization identifiers/team keys/tokens/UUID values
(`ci-defaults-scan.test.ts` runs the defaults-scan token set over the file). All condition
toggles default ENABLED (FR-002); a disabled condition never fails the step (FR-002,
acceptance scenario 3).

## 3. Outputs (six; written only when `$GITHUB_OUTPUT` is defined, research R9)

| Output | Value |
|---|---|
| `status` | `pass` \| `fail` |
| `unmapped-count` | condition (a) count — always computed, even when toggled off |
| `conflict-count` | condition (b) count (marker-block entries) |
| `drift-count` | condition (c) count |
| `summary` | the screened one-line summary (FR-003; annotation-friendly) |
| `report-json` | absolute path of the consumed report artifact |

No outputs are written on configuration/CLI-failure exits (2/3) — no fabricated status.

## 4. Environment contract (read by the wrapper; the action passes it through)

- `GITHUB_BASE_REF` — PR base/target branch (condition-(b) protected default, R6).
- `GITHUB_REF_NAME` — git ref for push runs (`refs/heads/` prefix stripped; R6 fallback).
- `GITHUB_OUTPUT` — step-output file (the ONLY write target; env-gated).
- `GITHUB_WORKSPACE` — default workspace.
- Credential env vars are **NOT** action inputs: consumers supply their configured
  credential env-var names via the `uses:` step's `env:` block; the wrapper inherits the
  process environment for the CLI spawn and never logs or screens-IN values (requirement
  26 criterion 4; the credential never appears in outputs — screened output posture).

## 5. Steps (normative behavior, bound loosely — the shape test pins `using: composite`,
bash shell, the `test -f` build guard, and the `node .../dist/ci/main.js` entry)

1. Guard step (bash): when `auto-build` is truthy AND `"$ACTION_ROOT/dist/ci/main.js"` is
   missing → `cd "$ACTION_ROOT" && npm ci && npm run build` (no `--omit=dev`: tsc is a
   devDependency). No package-manager globals, no network beyond the locked manifest.
2. Enforcement step (bash): `node "$ACTION_ROOT/dist/ci/main.js" --workspace … --command …
   [--config …] [--report …] [--cli-entry …] --fail-on-unmapped … --unmapped-threshold …
   --fail-on-conflicts … --fail-on-drift … --drift-threshold … --protected-branches …
   --branch …` — flags emitted only for non-defaulted inputs; step exit code propagates
   (non-zero ⇒ failed build).

## 6. Example usage (placeholder identifiers only — docs/ci-enforcement.md mirrors this)

```yaml
jobs:
  enforcement:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: ./                       # or: owner/task-linear-sync-action@v1 once published
        id: enforce
        with:
          command: check
          drift-threshold: "0"
          protected-branches: "main"   # placeholder default is the PR base branch
        env:
          TASK_LINEAR_SYNC_TOKEN: ${{ secrets.LINEAR_READ_TOKEN }}   # read-scoped
      - run: echo "counts ${{ steps.enforce.outputs.unmapped-count }}"
```
