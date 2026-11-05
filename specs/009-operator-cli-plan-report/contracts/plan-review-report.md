# Contract: Plan Review-Report Lane (consumption + enforcement)

Modules: `src/cli/commands/plan.ts` (lane) + `src/cli/readonly-guard.ts` (enforcement).
The report **document** contract is frozen in 002
(`specs/002-core-domain-contracts/contracts/plan-artifact.md` +
`plan-report.schema.json`) and the **single renderer** is 008's `src/engine/report.ts`
exported from `task-linear-sync/engine`: `buildPlanReportJson`,
`renderPlanReportMarkdown`, `writePlanReportArtifacts`, `derivePlanReportRunId`.
`engine.buildSyncPlan` stage 7 already persists `StoredPlan` (`plans/<planId>.json`) and
writes the pair (`reports/<runId>/report.json` + `report.md`, screener-passed) through
that module. 009 does **not** fork a renderer (research R4); this contract pins how the
CLI consumes and enforces the lane.

## 1. Lane flow (normative)

1. Read-only command builds `EngineDependencies` over the **guarded** port/store
   (§3), resolves config through the frozen loader, constructs the engine via
   `createSyncEngine`.
2. `engine.buildSyncPlan({ repositoryRoot })` — the engine persists the plan and writes
   the report pair (zero tracker mutations, zero repository writes — constitution I).
3. The CLI resolves the artifact paths — `runId = derivePlanReportRunId(planId, clock)`,
   joined onto `state.paths.reports` — verifies both artifacts exist, and presents them
   (`plan`: human lines; `check`: the `CheckSummary` JSON object only).
4. A missing artifact after a successful build is an internal inconsistency: abort
   exit 5 naming the artifact (never a silent success — 013 relies on this).

## 2. 009's enforcement checklist (tests bind these; FR-005/006/007/008, SC-001/003)

The generated pair must satisfy (validated by `cli-report-schema` contract tests with
the shared minimal JSON-Schema validator + integration tests over fixture worlds):

- **Schema**: `report.json` validates against the frozen
  `plan-report.schema.json` (draft 2020-12, `additionalProperties: false` throughout).
- **FR-006 field set**: every entry carries `decision`, `framework`, `featureName`,
  `filePath`, `confidence`, `score`, `margin`, `reasons`, `alternatives` (≤ 3, each
  `{issueId, score, mapped}`), `changedFields`, `descriptionContentHash`
  (`^[0-9a-f]{64}$`), `expectedMarkdownChanges` (each ≤ 512 chars),
  `lowConfidenceGateStatus` (`passed`/`failed`).
- **FR-007 grouping**: `groups[]` sorted project → milestone (deterministic);
  `unmapped[]` is a separate section; `parentMapped: true` iff **any descendant** issue
  is mapped (a parent with only a mapped *sibling* stays `false` — spec edge case);
  every unresolved-conflict task (`decision === "conflict"` or `unresolvedConflict:
  true`) is surfaced in BOTH artifacts (JSON entry flags + Markdown
  "awaiting human marker resolution" section).
- **FR-008 security-assertions block**: ≥ 1 discrete `pass`/`fail` assertion, including
  the two computed structural assertions the engine emits
  (`no-raw-body-or-description-fields`, `description-material-hashed-only`) plus the
  pipeline read-only guarantees; every `detail` screened.
- **Content exclusion (SC-001)**: across the whole generated corpus (both artifacts,
  all fixture worlds including zero-task), raw task bodies and raw issue descriptions
  never appear — fixture sentinel body/description strings are asserted absent, and
  description material is represented only by content hashes / screened summaries.
- **Identity style**: Markdown names entities human-readably (project/milestone/file
  paths, titles); JSON carries durable identifiers (`planId`, `taskUuid`, `issueId`).
- **Placement**: artifacts exist only under the state directory `reports/<runId>/`;
  walking the fixture repo after any command finds zero new/modified files (spec edge
  case "report name collision"; SC-003).
- **Zero-task plan** (edge case): both artifacts render with empty `groups`/`unmapped`
  and a passing security-assertions block; `plan`/`check` still exit 0.

## 3. `ReadOnlyGuard` (FR-005 / AC2 scenario 4 / SC-003 — data-model §5)

All four read-only command lanes wrap their deps. Normative rules:

1. Any mutating `LinearPort` member attempted during a read-only run throws
   `ReadOnlyViolationError` naming the member; the run aborts with exit 5 and the error
   is presented (screened). No mutation occurs — asserted against the fake port call
   log (`mutations: 0`) and the pre/post repo-tree hash comparison.
2. `StateStore` writes are refused unless the relative path starts with an allowed
   prefix: `reports/` or `plans/` for `plan`/`check` (engine stage-7 products only);
   nothing at all for `inventory`/`discover-metadata`. An attempted write to
   `sync-state.json`, `manifests/…`, `intents/…`, `last-run.json`, or `queue/…` during
   report generation aborts with the same error — this is the injected-write-attempt
   hook SC-003 tests (a fixture port/store decorator attempts a rogue write mid-build).
3. The guard is the composition boundary between `CliContext` and the engine — it does
   not modify frozen behavior when not violated (read members, `readJson`, `ensure`
   delegate unchanged), and it never downgrades a refusal to a warning.

## 4. Report pair per artifact

| | `report.json` | `report.md` |
|---|---|---|
| Identifiers | durable (`planId`, `taskUuid`, `issueId`) | human-readable names (project, milestone, file path, tracker titles) |
| Consumer | 013 (sole machine input), 012 references | human reviewer |
| Exclusion | no property admits raw body/description text (schema structural exclusion + computed assertions) | same content, named presentation; bodies never rendered |
| Written by | engine `writePlanReportArtifacts` (screener-passed, atomic, owner-only, state dir only) | same call |
