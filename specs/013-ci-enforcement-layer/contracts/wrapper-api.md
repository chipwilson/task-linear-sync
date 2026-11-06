# Contract: `task-linear-sync/ci` — the enforcement wrapper API

Module group `src/ci/` (disjoint, additive — no frozen/Wave-2/3 module edited). Public
barrel names (bound by `ci-packaging.test.ts`): `runEnforcement`, `evaluateConditions`,
`resolveSettings`, `loadReportArtifact`, `parseLocator`, `createSpawnCliInvoker`,
`renderSummary`, `CONDITION_IDS`, `EnforcementExitCode`, `CiConfigError`,
`CiArtifactError`, `CiCliFailureError`, and the types `EnforcementSettings`,
`EnforcementOutcome`, `EvaluationResult`, `ConditionCounts`, `TriggeredCondition`,
`ConditionId`, `CliInvoker`, `CliRequest`, `CliResult`, `EnforcementDeps`.

## 1. `runEnforcement(settings, deps): Promise<EnforcementOutcome>`

The single orchestration entry (data-model §4). Flow: artifact acquisition (CLI mode via
`deps.cliInvoker` → locator parse → artifact load, or artifact-direct mode via
`settings.reportPath` with NO spawn) → pure evaluation (`evaluateConditions(parsedReport,
settings)`) → screened summary render (`renderSummary(evaluation, { screener })`).
Throws `CiArtifactError` / `CiCliFailureError` / `CiConfigError` (data-model §7) — never
returns a pass on bad input (spec edge case 1).

`EnforcementDeps` seams (all injectable — the testability requirement):

| Member | Default | Purpose |
|---|---|---|
| `cliInvoker` | `createSpawnCliInvoker(...)` | CLI child-process seam (§2) |
| `screener` | `createDefaultSecurityScreener(loadConfig({}) fallback)` | screens EVERY emitted line + error text (FR-003) |
| `env` | `process.env` | `GITHUB_*` / `TLS_CI_*` view for branch resolution + `$GITHUB_OUTPUT` |
| `log(line, stream)` | `process.stdout/stderr` | presentation sink (tests capture arrays) |

## 2. `CliInvoker` (research R3) — the CLI-wrapping seam

```ts
type CliInvoker = (request: CliRequest) => Promise<CliResult>;
interface CliRequest { readonly command: "check" | "plan"; readonly workspace: string;
  readonly configFile?: string; readonly cliEntry?: string | null; readonly env?: Readonly<Record<string, string | undefined>>; }
interface CliResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string; }
```

`createSpawnCliInvoker()` resolves the entry (R3 order: explicit → action-root
`dist/cli/main.js` → workspace `dist/cli/main.js` → workspace
`node_modules/task-linear-sync/dist/cli/main.js`; miss ⇒ `CiCliFailureError` naming every
candidate), spawns `process.execPath` with argv `[entry, command, workspace,
"--config"?]` — NO shell — inherits env, and maps results: exit `0`/`8` ⇒ proceed; any
other exit (or spawn error) ⇒ `CiCliFailureError` (exit `3`) naming command + code +
screened stderr tail. The spawned command set is CLOSED (`check`, `plan`) — the argv
builder has no apply/mutate mode by construction (hygiene-scan enforced).

## 3. Exit map (`EnforcementExitCode`; `main.ts` only) — distinct from the CLI's 0–8 map

| Code | Name | Meaning |
|---|---|---|
| 0 | `SUCCESS` | no enabled condition triggered (pass) |
| 1 | `VIOLATION` | ≥ 1 enabled condition triggered; screened summary emitted |
| 2 | `CONFIGURATION` | settings/parse problems (complete listing) **or** missing/malformed/mismatched report artifact (names the artifact) |
| 3 | `CLI_FAILURE` | CLI spawn failure or CLI exit ∉ {0, 8} |

The wrapper NEVER returns any other code and NEVER leaks a CLI exit code.

## 4. Output posture (research R8/R9)

- Pass line (stdout): `task-linear-sync enforcement passed (unmapped-high-confidence: N,
  unresolved-conflict-block: N, spec-drift: N)`.
- Fail summary (stderr + `summary` output): `task-linear-sync enforcement failed —
  <condition-id>: <count>[; …]` over ONLY the triggered conditions, stable order (a)(b)(c).
- Protection-skip warning (stderr, when (b) enabled but branch classification impossible):
  `task-linear-sync enforcement warning: unresolved-conflict-block protection skipped —
  branch context unresolved`.
- Every line passes the injected screener first; blocking findings redact (the layer never
  propagates unscreened text; SC-003).
- `$GITHUB_OUTPUT` (when set): one `name=value` line per §3/§action.md output, values
  newline-flattened. Written by `main.ts` only (`appendFileSync` — the single fs write in
  `src/ci/`, hygiene-scan enforced); absent env ⇒ zero writes.

## 5. Hygiene invariants (bound by `tests/contract/ci-hygiene.test.ts`, research R12)

1. `src/ci/**` imports zero of: `src/gates`, `src/tracker`, `src/queue`,
   `src/history-server`, `src/mcp`, `src/cli`, and any `task-linear-sync/*` package
   specifier; from `src/engine` ONLY `createDefaultSecurityScreener` (screening) — never
   `createSyncEngine`/`buildSyncPlan`/`applySyncPlan`/`rollbackRun` (constitution V: wrap
   the published CLI, not engine logic).
2. No transport material: no `fetch(`, `node:http|https|http2|net|tls|dns|dgram`,
   `WebSocket`, GraphQL naming, `lin_api_` shapes, `Authorization`.
3. `node:child_process` importable ONLY from `cli-invoker.ts`; `node:fs` limited to
   `readFileSync`/`existsSync` anywhere in the group + `appendFileSync` ONLY in `main.ts`.
4. Zero apply reachability: no `--apply`/`--confirm`/`accept-low-confidence` argv is ever
   constructible; the closed command set and the flag allowlist are scanned (SC-002
   structural proof, mirroring `engine-no-direct-tracker.test.ts` posture).
5. Zero clock/randomness in the evaluation path (`evaluate.ts`/`report-input.ts`/
   `summary.ts` import no clock source; deterministic per bytes).
