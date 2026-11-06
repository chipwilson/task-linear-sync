# Phase 1 Data Model: CI/CD Enforcement Layer

**Feature**: `013-ci-enforcement-layer` | **Date**: 2026-11-06

Every entity below is process-lifetime: the layer STORES nothing (spec Key Entities).
Consumed shapes (§5–§6) are read-only views of frozen 002/009 artifacts — never edited,
never re-derived. Validation posture follows the 010/012 precedent: complete-listing
validation (ALL problems collected, reported in ONE dotted-key line, `ok: false`).

## 1. Raw inputs (`main.ts` env/argv adapter)

Two sources, merged into one bag — flags win over env:

| Flag | Env fallback | Note |
|---|---|---|
| `--workspace <path>` | `TLS_CI_WORKSPACE` → `process.cwd()` | repo to enforce |
| `--config <path>` | `TLS_CI_CONFIG` | passed to the CLI verbatim |
| `--command check\|plan` | `TLS_CI_COMMAND` | closed enum |
| `--report <path>` | `TLS_CI_REPORT` | artifact-direct mode |
| `--cli-entry <path>` | `TLS_CI_CLI_ENTRY` | R3 override |
| `--fail-on-unmapped <bool>` | `TLS_CI_FAIL_ON_UNMAPPED` | closed bool set |
| `--unmapped-threshold <int>` | `TLS_CI_UNMAPPED_THRESHOLD` | ≥ 0 |
| `--fail-on-conflicts <bool>` | `TLS_CI_FAIL_ON_CONFLICTS` | |
| `--fail-on-drift <bool>` | `TLS_CI_FAIL_ON_DRIFT` | |
| `--drift-threshold <int>` | `TLS_CI_DRIFT_THRESHOLD` | ≥ 0 |
| `--protected-branches <csv>` | `TLS_CI_PROTECTED_BRANCHES` | then `GITHUB_BASE_REF` |
| `--branch <name>` | `TLS_CI_BRANCH` | then `GITHUB_BASE_REF` → `GITHUB_REF_NAME` |
| — | `GITHUB_OUTPUT` | output file (env-gated write) |

(The `TLS_CI_*` env names exist so non-Actions CIs can drive `node dist/ci/main.js`
without flag support; `action.yml` uses flags.)

## 2. `EnforcementSettings` (`settings.ts`) — validated inputs

| Field | Type | Default | Validation |
|---|---|---|---|
| `workspace` | absolute path string | cwd | must exist |
| `configFile` | string \| null | null | non-empty when set |
| `command` | `"check" \| "plan"` | `"check"` | closed enum |
| `reportPath` | string \| null | null | when set: artifact-direct mode, CLI skipped |
| `cliEntry` | string \| null | null | path when set (else R3 resolution at spawn) |
| `failOnUnmapped` | boolean | `true` | closed bool set `{true,false,1,0}` |
| `unmappedThreshold` | integer | `0` | `Number.isInteger && ≥ 0` |
| `failOnConflicts` | boolean | `true` | closed bool set |
| `failOnDrift` | boolean | `true` | closed bool set |
| `driftThreshold` | integer | `0` | `Number.isInteger && ≥ 0` |
| `protectedBranches` | `string[]` | env-resolved (R6) | trimmed, non-empty items, no commas |
| `targetBranch` | string \| null | env-resolved (R6) | non-empty string or null |

Invalid inputs ⇒ `CiConfigError` with EVERY problem listed in one line (never fail-fast).
Zero org identifiers appear in any default (defaults-scan).

## 3. `ConditionCounts` + `TriggeredCondition` (`evaluate.ts`) — pure evaluation

```ts
type ConditionId = "unmapped-high-confidence" | "unresolved-conflict-block" | "spec-drift";
interface ConditionCounts { readonly unmappedHighConfidence: number;
  readonly unresolvedConflictBlocks: number; readonly specDrift: number; }
interface TriggeredCondition { readonly condition: ConditionId; readonly count: number; }
interface EvaluationResult { readonly counts: ConditionCounts;        // ALWAYS all three
  readonly triggered: readonly TriggeredCondition[];                   // enabled-only, stable order
  readonly protectionSkipped: boolean; }                               // R6 warning signal
```

Predicates over the parsed report (entry view §5), stable iteration order
(`groups[]` in artifact order, entries in array order):

| Condition | Counted entry predicate | Triggers when |
|---|---|---|
| (a) `unmapped-high-confidence` | `confidence === "high" && issueId === null` | enabled ∧ `count > unmappedThreshold` |
| (b) `unresolved-conflict-block` | `unresolvedConflict === true` | enabled ∧ targeted (R6: `targetBranch ∈ protectedBranches`) ∧ `count ≥ 1` |
| (c) `spec-drift` | `issueId !== null && (reasons.includes("conflict:spec-changed") ∥ reasons.includes("conflict:both-changed") ∥ changedFields.length > 0 ∥ expectedMarkdownChanges.length > 0)` | enabled ∧ `count > driftThreshold` |

Disabled conditions count but never enter `triggered` (FR-002: "Disabled conditions NEVER
fail the build"). Pure: no I/O, no clock, no env — deterministic per report bytes.

## 4. `EnforcementOutcome` + `EnforcementStatus` (`enforcement.ts` / `summary.ts`)

```ts
type EnforcementStatus = "pass" | "fail";
interface EnforcementOutcome { readonly status: EnforcementStatus;
  readonly evaluation: EvaluationResult; readonly reportJsonPath: string;
  readonly planId: string;                       // 64-hex, from the artifact
  readonly summaryLine: string;                  // screened, R8 format
  readonly outputs: Readonly<Record<string, string>>; } // R9 output map (status + counts + summary + report-json)
```

`runEnforcement(settings, deps) → Promise<EnforcementOutcome>` throws
`CiArtifactError` / `CiCliFailureError` / `CiConfigError` instead of returning a status for
error cases (R9 exit map: 1 ⇒ fail outcome; 2/3 ⇒ thrown taxonomy; 0 ⇒ pass outcome).
`deps: { cliInvoker?: CliInvoker; screener: SecurityScreener; env: EnvView; log(...) }` —
all seams injectable (tests feed fixture reports with `reportPath` + no invoker).

## 5. Consumed report view (`report-input.ts`) — frozen artifact, read subset

Shape owned by 002 (`plan-report.schema.json`); 013 READS and structurally validates:

- top level: `schemaVersion === 1` · `planId` (64-hex) · `groups[]` each with `entries[]`
  · `unmapped` array present (never read for evaluation — R5 note).
- per entry (the condition read set): `issueId: string | null` · `confidence: string` ·
  `reasons: string[]` · `changedFields: string[]` · `expectedMarkdownChanges: string[]` ·
  `unresolvedConflict?: boolean` (absent ⇒ false).
- never read: bodies/descriptions do not exist in the artifact (frozen structural
  exclusion); `alternatives`, `routing`, `guards`, `securityAssertions` are not revalidated
  and not used for conditions.

## 6. `CheckSummary` locator view (CLI mode, `report-input.ts`)

- `command: "check"`: stdout trimmed = exactly ONE JSON object; `schemaVersion === 1`;
  `planId` 64-hex; `reportJson` non-empty string → artifact path.
- `command: "plan"`: lines `plan <64hex>` + `report <path>` — the first `report` line whose
  path ends in `.json` is the artifact; its 64-hex planId cross-checks the artifact.
- Anything else (empty stdout, no JSON, extra stdout noise, missing path) ⇒
  `CiArtifactError` naming the command and the stdout head (screened). Locator `planId`
  must equal the loaded artifact `planId` — mismatch names both.

## 7. Error taxonomy (`errors.ts`) → exit map (R9)

| Class | `name` | Exit | Message posture (screened) |
|---|---|---|---|
| settings/parse problems | `CiConfigError` | 2 | complete listing, one line |
| artifact missing/malformed/structural/provenance | `CiArtifactError` | 2 | names the artifact path (edge case 1) |
| spawn failure / CLI exit ∉ {0, 8} | `CiCliFailureError` | 3 | names command + exit code + screened stderr tail; never echoes env/credentials |

No other error escapes `main.ts`: anything unmapped exits `2` with a one-line sanitized
message (never a stack, never code 0).

## 8. Relationships

`action.yml` → (flags + `GITHUB_*` env) → `main.ts` → `settings.ts` (§2) →
`enforcement.ts` (§4) → { `cli-invoker.ts` (R3, CLI mode only) → `report-input.ts`
(§6 locator → §5 artifact) | `report-input.ts` (artifact-direct) } → `evaluate.ts` (§3) →
`summary.ts` (§4 lines, screened) → stdout/stderr + optional `$GITHUB_OUTPUT` →
`process.exitCode` (§7). Only solid arrows into the CLI are the spawn and the artifact
read — nothing else in `src/ci/` reaches engine, tracker, or repo files.
