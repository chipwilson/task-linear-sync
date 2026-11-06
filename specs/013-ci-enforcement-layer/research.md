# Phase 0 Research: CI/CD Enforcement Layer

**Feature**: `013-ci-enforcement-layer` | **Date**: 2026-11-06

Resolves every Technical Context unknown and every design question (action packaging,
CLI-invocation seam, condition predicates, protected-branch default resolution, output and
exit posture). No NEEDS CLARIFICATION remains in plan.md; the spec-advisory points are each
resolved below. Each entry: **Decision / Rationale / Alternatives considered**.

## R1. `action.yml` runtime: composite action (chosen) vs `node20` JS action vs Docker

- **Decision**: `action.yml` ships at the repository root as a **composite action**
  (`runs.using: composite`, `runs.steps` with `shell: bash`). Step 1 (guarded by a plain
  `test -f` check in bash) builds the package inside the action directory
  (`npm ci && npm run build`) when `dist/ci/main.js` is absent — this covers first use from
  a published ref and dogfooding via `uses: ./`. Step 2 invokes
  `node "$ACTION_ROOT/dist/ci/main.js"` with every mapped input as a `--flag` argument and
  `ACTION_ROOT`/`GITHUB_*` provided as environment. The Node 20 runtime is the runner's
  pre-installed `node` (GitHub-hosted runner images ship Node ≥ 20; the documented usage
  example pins `actions/setup-node@v4` with `node-version: 20` explicitly).
- **Rationale**: the constitution fixes the shape ("`action.yml` plus a wrapper that
  invokes the published CLI"), and the wrapper is TypeScript compiled by the existing tsc
  build into `dist/ci/` — a `node20`-runtime JS action would instead require committing a
  bundled JS artifact to git (dist/ is gitignored; bundlers are new toolchain; hygiene
  tests scan `src/`, not a committed bundle). Composite steps run on standard
  GitHub-hosted runners with zero container infrastructure, keep the wrapper as ONE source
  of truth (`dist/ci/main.js`, also runnable in any non-Actions CI), and let the action
  dir double as the package dir (action.yml at repo root ⇒ the action checkout IS the
  package checkout).
- **Alternatives considered**: (a) `runs.using: node20` + committed `main: dist/...` —
  rejected: ships stale build output or forces a bundler into a zero-dependency repo;
  (b) Docker container action — rejected: heavy, Linux-only, contradicts the
  "standard GitHub-hosted runners checking out this repo" brief, adds an image artifact to
  maintain; (c) composite action that only shells to `npx task-linear-sync` and inline
  bash for evaluation — rejected: moves behavior into untestable YAML, violating the
  testability requirement (spec-independent-test + design constraint).

## R2. Wrapper packaging: `src/ci/` module group + one additive `./ci` export, no new bin

- **Decision**: new disjoint module group `src/ci/` (8 modules, plan.md structure),
  published as the additive `task-linear-sync/ci` subpath (`package.json` `exports` gains
  exactly one entry: `types ./dist/ci/index.d.ts`, `default ./dist/ci/index.js`). **No new
  `bin` entry**: the action (and e2e tests) invoke the compiled process entry
  `node dist/ci/main.js` directly, the same way 012 ships without a bin.
  `tests/contract/cli-dependency-budget.test.ts` posture is re-asserted by a NEW
  `tests/contract/ci-packaging.test.ts` (runtime deps stay exactly `{}`; bin map unchanged)
  rather than editing frozen budget tests.
- **Rationale**: matches every shipped sibling (010 `./queue`, 011 `./history-server`,
  012 `./mcp`); keeps `package.json` edits purely additive (briefing hard rule 3); the
  process entry stays importable (`runEnforcement`) so unit/integration tests never spawn
  when they don't need to, while e2e covers the real process.
- **Alternatives considered**: (a) second `bin` (`task-linear-sync-ci`) — rejected: nothing
  on the consumer command line needs it; the action knows the dist path; fewer manifest
  moving parts. (b) placing the wrapper inside `src/cli/commands/` as a new CLI command —
  rejected: the CLI is a frozen 009 surface (disjoint-group rule), and the enforcement step
  is a distinct surface with its own exit vocabulary; conflating them would fork the CLI's
  frozen exit-code map.

## R3. CLI invocation seam: injectable `CliInvoker` child process over the published CLI

- **Decision**: `src/ci/cli-invoker.ts` defines
  `CliInvoker = (req: { command: "check" | "plan"; workspace: string; configFile?: string })
  => Promise<{ exitCode: number; stdout: string; stderr: string }>`. The default
  implementation `createSpawnCliInvoker()` uses `node:child_process.spawn` **without
  `shell: true`**, argv `[entry, command, workspace, ...(configFile ? ["--config",
  configFile] : [])]`, inheriting `process.env` so the CLI's credential env vars flow
  through without the wrapper ever touching or logging values. Entry resolution order
  (first existing wins, error names every candidate): explicit `--cli-entry` input →
  `<action-root>/dist/cli/main.js` → `<workspace>/dist/cli/main.js` →
  `<workspace>/node_modules/task-linear-sync/dist/cli/main.js`. CLI exit codes **0 and 8**
  (`CHECK_FINDINGS`) both mean "run completed, report artifacts produced" and proceed to
  evaluation (009 contract §4: 013 computes its own conditions); 2/3/4/5/6/1 map to
  `CiCliFailureError` (exit map R9). When the `report` input is set (artifact-direct mode,
  R4), no CLI process is spawned at all.
- **Rationale**: constitution V demands wrapping the PUBLISHED CLI, not engine logic — a
  child process is the only boundary that proves it (importing `runCli` in-process would
  let the wrapper drift into engine reach-through). The injectable seam gives unit tests
  fixture report JSONs with zero spawning and lets e2e point `--cli-entry` at a
  `writeCliEntry`-generated driver mjs (009 `writeDriver` pattern) that wires the 007 fake
  port + fixed clock in an otherwise REAL spawned CLI — zero network, real process, real
  argv/exit-code contract.
- **Alternatives considered**: (a) in-process `import { runCli } from "task-linear-sync/cli"`
  — rejected: bypasses the process boundary the spec requires ("wraps the published
  commands"), couples module graphs, and makes the "consumes only the report JSON" hygiene
  proof weaker; (b) `shell: true` with a command string — rejected: quoting hazards, and
  the hygiene scan bans shell-interpreted execution; (c) `npx task-linear-sync` as default
  entry — rejected as DEFAULT (network install is nondeterministic in CI); kept as the
  documented consumer-side `--cli-entry` value when the package comes from npm.

## R4. Sole machine input: report JSON is the evaluation input; CheckSummary is the locator

- **Decision**: the enforcement evaluation reads **only** the plan-report
  `report.json` artifact (frozen 002 `plan-report.schema.json` shape). In CLI mode the
  artifact path comes from the `check` command's stdout — exactly one `CheckSummary` JSON
  object (`schemaVersion: 1`, `planId`, `reportJson`, `reportMarkdown`, `counts`), which
  the wrapper parses as a **locator only** (its `counts` are never used for evaluation —
  different semantics: `counts.unmapped` counts unmapped *issues*, not condition (a)); for
  `command: plan` the locator is derived from the human line shape `report <path>.json`.
  Cross-check: locator `planId` must equal the loaded artifact's `planId` (when the locator
  carries one) — mismatch is an input error naming both artifacts. `report-input.ts` then
  loads and structurally validates the artifact (top-level: `schemaVersion === 1`,
  64-hex `planId`, array `groups` (each `entries` array), array `unmapped`; per-entry: the
  fields the three conditions read — `issueId`, `decision`, `confidence`, `reasons`,
  `changedFields`, `expectedMarkdownChanges`, `unresolvedConflict` present with the
  schema's types; the per-entry `alternatives`/`routing` sub-shapes are NOT revalidated —
  the CLI already aborts (exit 5) on a malformed artifact, and 013 re-checks its own read
  set). Any failure — file missing, unparseable JSON, structural violation, provenance
  mismatch — is a `CiArtifactError` naming the artifact path: **never a silent pass**
  (spec edge case 1). Contract tests bind the acceptance semantics with
  `tests/helpers/json-schema-mini.ts` against the frozen schema.
- **Rationale**: spec Assumptions: "All decision inputs are pre-computed in the plan
  report; the layer performs no matching or classification of its own." Structural
  validation of exactly the read set keeps the runtime dependency-free (no schema validator
  in `src/`) while a malformed artifact can never degrade into "count 0 → pass".
- **Alternatives considered**: (a) evaluate from `CheckSummary.counts` alone — rejected:
  counts are the wrong vocabulary for (a)/(c) (R5/R7) and the spec names the plan report
  JSON as the sole machine input; (b) full draft-2020-12 validation at runtime — rejected:
  needs a validator (new dep or duplicated test-helper code in `src/`); the read-set check
  plus the CLI's own abort posture is sufficient and keeps `src/ci/` small.

## R5. Condition (a) predicate: `confidence === "high" && issueId === null` (literal rule)

- **Decision**: count report entries (flattened across `groups[].entries[]`) with
  `confidence === "high"` AND `issueId === null`; trigger when `count >
  unmappedThreshold` (default 0 ⇒ any single occurrence triggers).
- **Rationale**: verbatim 001 Requirement 26 criterion 7 — "tasks in the `high` confidence
  band … that have no issue mapping" — read off the frozen report fields (`confidence`,
  nullable `issueId`; the schema admits the combination, `additionalProperties` aside).
  Occurrence note, documented here honestly: the shipped engine assigns band
  `"unmatched"` to unmapped tasks (`src/engine/build.ts` — `confidence: match?.confidence
  ?? "unmatched"`), so against today's real engine output this count is structurally 0 —
  the condition never false-positives clean-sync builds (SC-001's 0-false-positive
  criterion). The condition is a pure evaluator over the report: it fires exactly when the
  report ITSELF reports the signal (crafted enforcement fixtures per the spec's Independent
  Test, and any future report producer that carries the combination). Exercising the
  trigger end-to-end goes through the `report` input (artifact-direct mode, R4) — a real
  engine world physically cannot produce the combination, and forcing it would mean
  touching frozen engine code (forbidden).
- **Alternatives considered**: (a) count the report's `unmapped[]` section — rejected:
  those are ISSUES with no task mapping (009 FR-007), carry no `confidence`, and the
  requirement says "tasks"; (b) read (a) as `confidence === "unmatched"` — rejected: the
  requirement's "in the `high` confidence band" is explicit, and counting every unmatched
  task would fail every first-run bootstrap PR (massive false positives); (c) skip the
  condition as "structurally dead" — rejected: FR-002 mandates it; the literal rule is
  fixture-testable and future-proof.

## R6. Condition (b) predicate + protected-branch default resolution

- **Decision**: trigger when (b) enabled AND the run **targets** a protected branch AND at
  least one report entry carries `unresolvedConflict === true`; offending count = number of
  such entries. The predicate is EXACTLY the `Unresolved_Conflict_Block` signal (001 Req 2
  criterion 16 surfaces it into the report per Req 16 criterion 8) — NOT the broader
  `decision === "conflict"` finding vocabulary (that is 009 `check`'s exit-8 signal;
  description-conflict entries with pending changed fields/expected Markdown changes are
  condition (c)'s domain). Branch classification (injectable pure function over an env
  view + settings):
  - `targetBranch` := explicit `branch` input → else `GITHUB_BASE_REF` (non-empty; set by
    the runner on `pull_request` events) → else `GITHUB_REF_NAME` (with a `refs/heads/`
    prefix stripped) → else `null`.
  - `protectedSet` := explicit `protected-branches` input (comma-separated list, trimmed,
    empties dropped) → else `{ GITHUB_BASE_REF }` when non-empty → else `{}`.
  - The run targets a protected branch iff `targetBranch ∈ protectedSet`. Defaults give
    the spec's rule exactly: a `pull_request` run is protected (target = base ∈ default
    set = {base}); a `push` run is protected only when the consumer configures
    `protected-branches` (spec: the default IS the PR base branch).
  - (b) enabled but classification impossible (`protectedSet` empty or `targetBranch`
    `null`) ⇒ (b) cannot trigger by branch classification (spec edge case 3 shape) — and
    the wrapper emits one SCREENED warning line naming that protection was skipped
    (misconfiguration must be visible, never silently inert); the exact text is pinned
    in contracts/wrapper-api.md §4 ("unresolved-conflict-block protection skipped —
    branch context unresolved").
- **Rationale**: Req 26 criterion 8's "tasks carry an Unresolved_Conflict_Block" is the
  parser-flagged marker-block state; mapping it to `unresolvedConflict === true` keeps one
  vocabulary across parser → report → action and avoids double-gating conflict findings
  through both (b) and (c). All branch inputs are env/settings, so the matrix is fully
  unit-testable without GitHub.
- **Alternatives considered**: (a) include `decision === "conflict"` entries in (b) —
  rejected: the requirement sentence is block-specific, and it would make every description
  conflict on every PR base branch a double-counted failure; (b) default `protectedSet` =
  `{"main"}` for push runs — rejected: "main" is invented by neither the spec nor 002
  defaults; the spec pins the default to the PR base branch, and push gating is an
  explicit-configuration scenario (documented example uses placeholder `main`).

## R7. Condition (c) predicate + threshold semantics; (b) is binary

- **Decision**: count matched entries (`issueId !== null`) where ANY of: `reasons`
  includes `"conflict:spec-changed"` or `"conflict:both-changed"`; `changedFields.length >
  0`; `expectedMarkdownChanges.length > 0`. Trigger when `count > driftThreshold` (default
  0). Thresholds are **strictly "exceeding"** for (a)/(c) (Req 26 criteria 7/9: "exceeding"
  with default 0 ⇒ trigger at count ≥ 1); (b) has NO threshold input — Req 26 criterion 8
  is "one or more" (binary), and Req 26 criterion 13's defaults list exposes thresholds for
  (a)/(c) only. FR-002's "three independently configurable … conditions" is satisfied for
  (b) by its toggle + protected-branch configuration.
- **Rationale**: the engine surfaces `Description_Conflict_Type` into the report ONLY via
  the FR-005 reason labels `conflict:<type>` (`src/engine/build.ts` T02x comment: "the
  frozen report schema admits no dedicated `conflictType` field") — reading those labels is
  consuming a pre-computed input, not re-deriving. "Matched" = durable issue mapping
  exists (`issueId !== null`), matching Req 26.9's "matched tasks" qualifier on ALL three
  sub-terms, which also keeps create-path entries (`decision: "create"`, band
  `"unmatched"`) out of the drift count. A `skip`-resolved conflict (`decision:
  "no-change"`, labels only) with `conflict:spec-changed` still counts — literal per 26.9
  ("classified … of spec-changed"); a `linear-changed` conflict with pending
  fields/md-changes counts via sub-terms 2/3.
- **Alternatives considered**: (a) count `decision === "update" ∪ "conflict"` — rejected:
  misses `skip`-recorded spec-changed drift and over-counts non-drift conflicts; (b)
  threshold as `>=` — rejected: contradicts "exceeding … threshold (default 0)" (with
  `>=` a threshold of 0 would always fire); (c) adding a threshold for (b) — rejected:
  FR-002 enumerates only two thresholds; inventing a third action input exceeds the spec.

## R8. Output posture: screened summaries; credential-free; counts always visible

- **Decision**: every line the wrapper prints (pass line, failure summary, warnings,
  errors) passes the injected `SecurityScreener` before emission (same default factory as
  every surface: `createDefaultSecurityScreener(config)` from `task-linear-sync/engine` —
  screening module only, research R12). Default config bag: `loadConfig({ repositoryRoot:
  workspace })` with fallback to `loadConfig({})` (built-in defaults) if the workspace
  config itself is unloadable (the CLI will then fail loudly in CLI mode). Failure summary
  (one line, `; `-joined): `task-linear-sync enforcement failed — <condition-id>:
  <count>; …` over the stable condition ids `unmapped-high-confidence`,
  `unresolved-conflict-block`, `spec-drift`; pass line names all three counts too
  (`… passed (unmapped-high-confidence: 0, unresolved-conflict-block: 0, spec-drift: 0)`).
  All three counts are ALWAYS computed and reported regardless of toggles (transparency —
  disabled conditions report but never fail). Bodies/descriptions never appear: the summary
  composes condition ids, integer counts, the `planId` hash, artifact paths, and
  SCREENED branch names (env input) only. Failures go to stderr, the pass line to stdout;
  the same summary text is exposed as the `summary` action output for annotations.
- **Rationale**: FR-003/Req 26.12 — screened, human-readable, count-carrying, "hashes and
  human-readable names" (planId IS a hash; branch names are the only human text and are
  screened). Leak tests reuse the 009 fixture sentinel bodies/descriptions and assert
  absence in every wrapper output line plus a screener spy.
- **Alternatives considered**: (a) GitHub `::error::` annotation commands emitted from the
  wrapper — rejected: workflow-expression territory inside library code; the `summary`
  output + non-zero exit is the annotation-friendly primitive; (b) machine JSON on stdout —
  rejected: outputs already carry the machine values via `$GITHUB_OUTPUT`; stdout stays the
  human channel like the CLI's.

## R9. Exit map + action outputs + the single `$GITHUB_OUTPUT` write

- **Decision**: wrapper exit codes (documented, distinct from the frozen CLI map — the
  wrapper NEVER leaks a CLI code): `0` SUCCESS (pass), `1` VIOLATION (≥ 1 enabled condition
  triggered), `2` CONFIGURATION (`CiConfigError` settings/parse problems — complete
  listing; `CiArtifactError` missing/malformed/mismatched report — names the artifact), `3`
  CLI_FAILURE (spawn failure or CLI exit outside {0, 8} — names command + code + screened
  stderr tail). Any non-zero fails the composite step (bash propagates it) ⇒ fails the
  build. Action outputs (written to `$GITHUB_OUTPUT` only when that env var is defined —
  absent outside Actions ⇒ zero writes): `status` = `"pass" | "fail"`,
  `unmapped-count`, `conflict-count`, `drift-count` (always all three counts), `summary`,
  `report-json` (consumed artifact path). Configuration/CLI-failure runs write NO outputs
  (no fabricated status) and fail with the error line. The `$GITHUB_OUTPUT` append (the ONE
  `appendFileSync` in `src/ci/main.ts`, process adapter only) targets a runner-created file
  OUTSIDE the workspace — e2e proves workspace-tree hash invariance.
- **Rationale**: "pass = success status; fail = non-zero" is the only CI-meaningful split;
  1/2/3 split the non-zero space into diagnostic classes so operators distinguish
  violations from misconfiguration (spec edge case 1 wants an input ERROR, not a
  violation). Env-gating outputs keeps the standalone (`node dist/ci/main.js`) posture
  write-free.
- **Alternatives considered**: (a) mirror the CLI's 0–8 map — rejected: 013 has no
  gates/locks/queue; partial reuse invites "is 8 my code or theirs?" (b) `continue-on-error`
  style always-zero — rejected: FR-003 explicitly requires non-zero failure status.

## R10. `action.yml` surface: exact input/output names and defaults (zero org identifiers)

- **Decision**: inputs (kebab-case per GitHub convention; full table normative in
  `contracts/action.md`): `workspace` (default `${{ github.workspace }}`), `config` (CLI
  config file path, default `""`), `command` (`"check" | "plan"`, default `"check"`),
  `report` (artifact-direct path, default `""`), `cli-entry` (default `""` → R3
  resolution), `fail-on-unmapped` (bool, default `"true"`), `unmapped-threshold`
  (int ≥ 0, default `"0"`), `fail-on-conflicts` (bool, default `"true"`),
  `fail-on-drift` (bool, default `"true"`), `drift-threshold` (int ≥ 0, default `"0"`),
  `protected-branches` (CSV, default `""` → env fallback R6), `branch` (default `""` → env
  fallback R6), `auto-build` (bool, default `"true"` — R1 build step gate). Outputs:
  `status`, `unmapped-count`, `conflict-count`, `drift-count`, `summary`, `report-json`.
  Boolean parsing accepts the closed set `{true,false,1,0}` (case-insensitive); anything
  else is a configuration error (complete listing). No credential input exists (R8);
  consumers pass `env:` with their configured credential env-var names at the `uses:` step.
- **Rationale**: one canonical name per FR-002 knob + the locator/mode inputs; defaults
  are R6/R9's exactly — every default generic, satisfying Req 26.13/26.14 and Principle
  III. `command` defaults to `check` because its single-JSON-object stdout is the robust
  locator (009 designed `check` for 013).
- **Alternatives considered**: (a) `fail-on-unmapped-high-confidence` (long-form) —
  rejected: verbose; the condition-id in the summary carries the full name; (b) separate
  `protected-branch` string + `protected-branches` list — rejected: one CSV input covers
  both; (c) a `token` input — rejected: credentials stay in consumer `env:` (constitution
  credential rule + Req 26.4), never an action input where they land in step-context JSON.

## R11. Node 20 API constraints

- **Decision**: APIs used: `node:child_process.spawn` (sync-free, `stdio: ["ignore",
  "pipe", "pipe"]`), `node:fs` (`readFileSync`, `existsSync`, `appendFileSync`),
  `node:path` (`join`, `resolve`, `isAbsolute`), `node:process`. No `fs.globSync`, no
  `crypto.hash`, no `--experimental` flags, no timers, no `structuredClone` reliance, no
  `AbortSignal.timeout` (spawn has no timeout requirement; the CLI owns its own posture).
  Same ceiling as 012 R11.
- **Rationale/Alternatives**: everything else used is ES2022 language-level. A spawn
  timeout was considered and rejected — CI runners impose job timeouts; adding a wrapper
  timer creates nondeterminism (and the constitution's determinism principle) for no
  specified requirement.

## R12. Zero-dependency + hygiene proof plan, and the test-tier/harness plan

- **Decision**: zero new runtime deps (R2). Hygiene/contract scans in
  `tests/contract/ci-hygiene.test.ts` over `src/ci/**` (source scan, precedent
  `engine-no-direct-tracker.test.ts` + 012's hygiene posture): (1) FORBID imports of
  `src/engine` anything except `createDefaultSecurityScreener`/screening types (screening
  module ONLY — no `createSyncEngine`/`buildSyncPlan`/`applySyncPlan`/`rollbackRun`), any
  `src/gates`/`src/tracker`/`src/queue`/`src/history-server`/`src/mcp`/`src/cli` import,
  any `task-linear-sync/*` package specifier inside `src/` (008 convention), transport
  built-ins (`node:http|https|http2|net|tls|dns|dgram`), `fetch(`, `WebSocket`, GraphQL
  naming, `lin_api_` token shapes; (2) `node:child_process` importable ONLY from
  `cli-invoker.ts`; `node:fs` functions limited to `readFileSync`/`existsSync` (any module)
  + `appendFileSync` (ONLY `main.ts`); (3) zero-apply proof: no `apply`/`--apply`/
  `confirm` tokens in `src/ci/**` outside deny-list comments, and the spawned argv is built
  solely from the closed command set `check|plan` + `--config` (grep the argv builder).
  `ci-action-shape.test.ts` parses `action.yml` (purpose-built minimal YAML reader in the
  test — flat `inputs:`/`outputs:` maps + `runs:` block, no YAML dep) and asserts the full
  table of contracts/action.md (names, defaults, `using: composite`, node entry, no
  `docker`, no credential input). `ci-defaults-scan.test.ts` runs the defaults-scan token
  set (UUID/token/hex/base64/PEM/email/real-org patterns) over action.yml, `src/ci/**`
  literals, and `docs/ci-enforcement.md`. Test tiers/harness: unit = pure evaluate/settings/
  report-input/summary with fixture report JSONs under `tests/fixtures/ci/reports/`
  (placeholder identifiers); integration = in-process `runEnforcement` with a stub
  `CliInvoker` returning fixture stdout + real fixture artifacts in hermetic temp dirs;
  e2e = `tests/helpers/ci-harness.ts` `writeCliEntry` (fake-port + fixedClock driver mjs
  acting as the published bin) + spawn `node dist/ci/main.js` with a constructed env view
  (`GITHUB_BASE_REF`/`GITHUB_REF_NAME`/`GITHUB_OUTPUT` in a temp dir), reusing 009/008
  fixture worlds for clean / conflict-marker / drift scenarios; `hashTree` before/after the
  workspace; full-suite coverage gate 80/70/80 held by 013's own tests.
- **Rationale**: mirrors the established scan set (engine/queue/history/mcp precedents) so
  "no engine/tracker/fs-write" is CI-proven, not asserted; the harness keeps 013 e2e
  inside the zero-real-network wall.
- **Alternatives considered**: (a) YAML parse via a dev-dependency — rejected: a committed
  YAML subset is small and a purpose-built reader keeps the contract test honest about the
  EXACT committed shape; (b) reuse `writeDriver` unchanged — rejected: it mirrors output
  with `OUT|`/`ERR|` prefixes and calls `runCli` directly, while 013 needs raw-stdout
  single-object parsing and argv-shaped entry — hence the small `writeCliEntry` sibling.
