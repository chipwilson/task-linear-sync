# Phase 0 Research: Default-On Task State Mapping (feature 024)

**Input**: `specs/024-default-state-mapping/spec.md` · **Constitution**: v1.0.0 (amendment required — see R8)
**Date**: 2026-11-25

All NEEDS CLARIFICATION items resolved below; none carried into Phase 1.

## R1. Where do per-team defaults get applied?

- **Decision**: A post-merge **resolution pass** in `loadConfig` (`src/config/load.ts`),
  alongside `applyToolIdDerivations`: after the defaults→file→overrides merge, iterate every
  team key present in `merged.teams` and fill each absent workflow-state entry
  (`backlog`, `todo`, `inProgress`, `done`, and each lane key of `lanes`) from the built-in
  default tables.
- **Rationale**: team keys are dynamic — `builtInDefaults.teams` is `{}` and cannot carry
  per-team rows; the engine reads only `ResolvedConfig`, so a load-time pass makes the
  resolved config the single source of truth. Consequences: `resolveLaneState` and
  `desiredCompletionStateName` need **no mapping-logic change** (defaults arrive as ordinary
  configured values); validation, reporting, `canonicalizeConfig`, and plan stability guards
  all see the same materialized config; deep-merge precedence (constitution III) is honored
  with no new precedence rules.
- **Alternatives considered**:
  - *Fallback at read time inside `completion.ts`* — rejected: two resolution paths
    (config-present vs default) make validation, reports, and canonical config diverge from
    engine behavior; violates determinism (Principle IV) for `canonicalizeConfig`.
  - *Ship real per-team rows in `builtInDefaults.teams`* — impossible: keys are unknown.

## R2. What is the default mapping table?

- **Decision**: Linear's default team workflow — **Backlog, Todo, In Progress, Done,
  Canceled** (confirmed from Linear's own workflow docs: "workflows … come preconfigured
  with the following issue statuses: Backlog > Todo > In Progress > Done > Canceled").
  Tables (values are state **names**, resolved to ids through the existing
  `discoverMetadata` snapshot path):
  - `DEFAULT_WORKFLOW_STATE_NAMES`: `backlog→"Backlog"`, `todo→"Todo"`,
    `inProgress→"In Progress"`, `done→"Done"` (canceled is handled by
    `ignoredStateTypes: ["canceled","duplicate"]` **type** defaults, already shipped — no
    name identity exists for it).
  - `DEFAULT_LANE_STATE_MAP` (spec-kitty lanes): `planned→"Backlog"`, `claimed→"Todo"`,
    `in_progress→"In Progress"`, `for_review→"In Progress"`, `in_review→"In Progress"`,
    `approved→"In Progress"`, `done→"Done"`, `canceled→"Canceled"`; **no entry for
    `blocked`** (no sensible default-workflow counterpart — stays on the
    `lane-state-unmapped` posture, FR-003).
- **Rationale**: review-adjacent lanes collapse onto "In Progress" because the default
  workflow has no review state (spec Assumptions); "Canceled" keeps Linear's single-L
  spelling (the repo's established spelling); the table is pure platform-generic strings —
  the release scan (`tests/contract/defaults-scan.test.ts` targets org identifiers/tokens/
  UUIDs) stays green.
- **Alternatives considered**:
  - *Resolve by state **type** ("completed", "backlog") instead of names* — rejected: the
    engine's frozen name→id path (`resolveWorkflowStateId`) and the entire
    `workflowStates` identity model are name-based; a type-based default would fork the
    resolution machinery (Principle V risk).
  - *Include a "Duplicate"/"Triage" mapping* — rejected: not part of Linear's default
    status set per its docs; duplicate handling already keys on state **type** via
    `ignoredStateTypes`.
  - *Map `blocked` → "Todo"/"In Progress"* — rejected: semantically wrong; unmapped +
    reported is today's honest posture.

## R3. Opt-out granularity (FR-007)

- **Decision**: three levers, all overridable-by-configuration per Principle III:
  1. Global boolean `stateMappingEnabled` (built-in default `true`).
  2. Per-team `teams[K].workflowStates.mappingEnabled?: boolean` — when `false`, wins over
     the global; when absent, inherits it.
  3. Per-team `"lanes": null` — deepMerge doctrine already makes `null` a replacing value,
     and `resolveLaneState`/`collectLaneMapOffenders` already tolerate a null map; the
     resolution pass must NOT re-fill a `null` lanes map (null = explicit lane-mapping-off,
     every lane ⇒ `lane-state-unmapped`).
- **Rationale**: mapping logic is framework-agnostic (lanes = spec-kitty only; checkbox =
  every other framework), so global + per-team is the honest expression of the spec's
  "globally or per framework": a lane-only disable is exactly `lanes: null`, and a
  team-wide disable is `mappingEnabled: false`. When inactive the engine emits **no state
  change**, reports reason `state-mapping-disabled`, and behaves exactly like today's
  default-off posture (US4-AC2).
- **Alternatives considered**:
  - *Per-lane `null` as a disable* — rejected for v1 of the feature: out of spec scope
    (FR/US require global/per-framework only); `deepMerge` treats null as a value but
    blank/null lane entries are currently `LaneMapError` territory — keeping one clear
    disable story beats three half-supported ones. Resolution pass fills only keys whose
    merged value is `undefined`; operator-authored blanks still fail `LaneMapError`
    (A-023-0 semantics preserved).
  - *`"lanes": {}` as disable* — rejected: an explicit empty object would deep-merge into
    a refilled map under R1's fill rule (every lane key "absent"), i.e. it would silently
    mean "all defaults" — the exact opposite of intent. Documented explicitly.

## R4. Where does the bootstrap existence check run?

- **Decision**: a new engine validator (`src/engine/state-validation.ts`) invoked in
  **bootstrap mode only**:
  1. At plan build, after mode selection (`src/engine/build.ts` stage 4), against the
     snapshot already fetched by `discoverMetadata(Object.keys(config.teams))` (build.ts
     stage 3) — **zero additional Linear requests**;
  2. In apply, after the pre-mutation snapshot re-fetch and before any mutation, when the
     run is still bootstrap mode (checkpoint absent) — covers plan→apply drift and the
     interrupted-rerun path.
  Sync-mode runs keep today's plan-time conflict posture untouched (FR-011). All surfaces
  (CLI plan/apply, programmatic API, worker, MCP, hooks, CI action wrapping the CLI)
  inherit automatically through the one engine (Principle V).
- **Rationale**: "bootstrap" in this codebase is the checkpoint-selected first-run mode
  (`selectMode`, `src/engine/mode.ts`); it is exactly the adoption flow the spec names.
  Plan is read-only (Principle I), so a bootstrap-plan hard failure mutates nothing; apply
  re-checking guarantees "stops before any tracker or file mutation" (US2 MUST).
- **Alternatives considered**:
  - *A new `validate-mapping` CLI command* — rejected: adds a surface operators can skip;
    the outline mandates no new commands and spec FR-008 says "during bootstrap".
  - *Validate at config init (`createConfig`)* — rejected: config loading is offline
    (no Linear access by design); injecting the port into config init would violate the
    layering (config never touches the tracker).
  - *Validate every run, all modes* — rejected: FR-011 pins later runs to existing
    conflict reporting; re-validation cost and behavior churn without spec support.

## R5. Which names does the existence check validate?

- **Decision**: every mapped name on the resolved team identity — the four
  workflow-state identities **plus** every lane target the team can actually reach
  (default or configured) — via exact, case-sensitive match against the team's snapshot
  (today's resolution rule, unchanged). Additionally, per FR-008's second clause, assert
  the team's snapshot exposes a **`completed` type** state and a **`canceled` type**
  state (the categories `completedStateTypes`/`ignoredStateTypes` and completion posture
  depend on); a team whose snapshot carries **no states at all** produces a distinct
  "team unreachable or workflow empty" diagnostic instead of N missing-name noise.
- **Rationale**: FR-008 says "every mapped state name — default or configured". Validating
  the currently-unconsumed `todo`/`inProgress` identities looks strict, but they are
  declared routing identities whose whole purpose is to name real workflow states; a
  dangling one is exactly the misconfiguration bootstrap exists to catch. Exact-match-only
  keeps resolution semantics frozen; near-matches are surfaced as hints (R6), never guessed
  (Principle III "never a silent guess").
- **Alternatives considered**: *validate only engine-consumed names (backlog/done/lane
  targets)* — rejected: narrows FR-008's explicit language and would let a bogus `todo`
  identity persist until some future consumer trips on it.

## R6. Failure representation

- **Decision**: new named error `StateMappingBootstrapError` (engine family, stable
  `name`) carrying a structured per-team payload: `{ teamKey, missing: [{entryPath,
  intendedName}], nearMatches: [{entryPath, intendedName, availableName}], available:
  [{name, type}], missingTypeCategories: [...] }`. Its message renders, in **one pass,
  grouped by team**: (a) each missing name with its config entry path
  (`teams[K].workflowStates.done`, `teams[K].workflowStates.lanes.in_progress`), (b) the
  team's available states as `name (type)` — **names and types only, no state ids**,
  (c) case-insensitive near-match hints ("'todo' vs available 'Todo' — case differs"),
  (d) missing completed/canceled type categories, and (e) step-by-step correction: edit
  the named key to one of the listed names (config file / programmatic overrides), **or**
  create/rename the state in Linear → Team → Workflow, then re-run. Registration:
  `exitCodeForError` maps it to `ExitCode.CONFIGURATION_ERROR` (3) — and the same change
  registers the existing **`LaneMapError`** name there (today it falls through to exit 1,
  an adjacent taxonomy gap this feature's exit-code work closes).
- **Rationale**: exit 3 matches the config-failure family (`MissingIdentityError`
  precedent); names+types are already operator-visible via `discover-metadata`, so the
  sanitization posture (Principle I screening, no credentials, no snapshot ids) holds while
  satisfying FR-009's listing requirement.
- **Alternatives considered**: *exit 5 RUN_ABORTED* — rejected: the run aborts because the
  configuration is wrong, and operators (and the CI action) key off 3 for config work.
  *Per-team errors thrown one at a time* — rejected: violates FR-009 "one pass, grouped
  by team" and the `MissingIdentityError` collect-all precedent.

## R7. Resolver hardening and stale diagnostics

- **Decision**: (a) `desiredCompletionStateName` and `resolveLaneState` gain
  **null-tolerant** identity reads (a `null`/absent/blank value takes the existing
  "missing" branch — today `null` would crash at `.trim()`); (b) with defaults shipping,
  their "no built-in default exists" message wording is corrected to point at the disable
  lever and the default table (docs truthfulness, precedent feature 019).
- **Rationale**: explicit `null` is now a meaningful layer value (R3), and the old message
  would be false after this release.
- **Alternatives considered**: leave the latent null crash — rejected, it contradicts
  FR-010 "fails loudly, re-runs safely".

## R8. Governance: constitution and amendment records

- **Decision**: this feature **amends constitution Principle III** — a MINOR amendment
  (v1.0.0 → 1.1.0) adding a *platform-default exception*: built-in defaults MAY ship for
  per-team workflow-state identities when the values are the issue-tracker platform's own
  generic default names and remain overridable per the existing precedence; no
  organization-specific literals remain forbidden exactly as before. Recorded as
  `docs/contract-amendments.md` entries **A-024-0** (default name + lane tables supersede
  the "NO built-in default ships" clause of A-023-0(b)), **A-024-1**
  (`stateMappingEnabled` + per-team `mappingEnabled`), **A-024-2** (bootstrap existence
  check + `StateMappingBootstrapError` + exit-code registration + resolver null guards).
  Frozen-surface contract snapshot (`tests/contract/snapshots/frozen-surface.json`) is
  regenerated for the additive exports.
- **Rationale**: Governance forbids silent deviation; the amendment is additive guidance
  (new exception), not a redefinition — MINOR by the versioning policy. The spec's
  Assumptions already flag this.
- **Alternatives considered**: *MAJOR amendment* — rejected: no principle removed or
  narrowed; III's anti-literal and override requirements stay verbatim. *Skip the
  amendment* — forbidden by Governance.

## R9. Verification posture (Principle VI)

- **Decision**: acceptance-criterion coverage —
  - unit: default tables; resolution-pass precedence (fill/override/`lanes:null`/blank→
    `LaneMapError` preserved); `stateMappingActive`; validator grouping/near-match/
    type-category/empty-team paths; exit-code registration.
  - integration (fake `Linear_Port`, hermetic): zero-config bootstrap per framework matrix
    (checkbox → Done/Backlog; spec-kitty lanes → table); bootstrap failure zero-mutation +
    full listing; corrected re-run converges (SC-004); `mappingEnabled:false` and
    `lanes:null` untouched-posture; sync mode skips the validator (FR-011).
  - property: `canonicalizeConfig` determinism across the resolution pass; repeated
    bootstrap re-runs over unchanged inputs byte-identical.
  - contract: frozen-surface name set; defaults-scan (org-literal scan) with the new
    strings.
  - e2e: CLI `plan` against a fake-port world missing a default state → exit 3 + message
    content; happy zero-config bootstrap → states moved.
  - security: validator diagnostics carry no state ids/credentials and pass screening.
- **Rationale**: every SC/FR maps to at least one automated tier, per Principle VI.
- **Alternatives considered**: none material.

## Technology Context notes

- Node ≥ 20, ESM + generated `.d.ts`, runtime deps unchanged (zero new dependencies).
- Test runner: built-in `node:test` behind `scripts/run-tests.mjs` (tiers
  unit/contract/integration/e2e + property/security cross-cutters).
- Linear default workflow verified against Linear's published workflow docs (2026); repo
  fixtures already mirror it (`tests/fixtures/tracker/scenarios/*/world.json`).
