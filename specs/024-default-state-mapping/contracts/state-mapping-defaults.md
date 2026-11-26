# Contract: Task State Mapping Defaults and Bootstrap Validation (024)

**Scope**: config resolution surface (`loadConfig`), engine mapping gates
(`completion`/`build`/`apply`), bootstrap validation (`state-validation`), CLI exit
taxonomy. Consumes the frozen `Linear_Port.discoverMetadata` snapshot; no port changes.
Amendments: A-024-0/1/2 (`docs/contract-amendments.md`); supersedes the "NO built-in
default ships" clause of A-023-0(b) only.

## C1. Default tables (A-024-0)

- **C1.1** `DEFAULT_WORKFLOW_STATE_NAMES` MUST be exactly
  `{ backlog: "Backlog", todo: "Todo", inProgress: "In Progress", done: "Done" }` and
  `DEFAULT_LANE_STATE_MAP` MUST be exactly
  `{ planned: "Backlog", claimed: "Todo", in_progress: "In Progress",
     for_review: "In Progress", in_review: "In Progress", approved: "In Progress",
     done: "Done", canceled: "Canceled" }` (no `blocked` entry).
- **C1.2** Both tables MUST be released-scan clean: platform-generic Linear default state
  names only; zero team keys, project names, tokens, or UUID values
  (`tests/contract/defaults-scan.test.ts`).
- **C1.3** The tables are framework-independent: every adapter derives state moves from
  these values exclusively — no adapter may carry its own state-name default (FR-005).

## C2. Resolution pass (`loadConfig`, after merge and toolId re-derivation)

- **C2.1** For every team key in the merged `teams` map, each identity entry of
  `backlog/todo/inProgress/done` whose merged value is `undefined` MUST be filled from
  C1.1; a configured non-empty string MUST be kept; a configured blank string MUST be kept
  (validation behavior unchanged); no entry may be filled for a team that does not exist
  in the config.
- **C2.2** `lanes`: an absent map MUST be replaced by a fresh `DEFAULT_LANE_STATE_MAP`
  copy; a present map MUST have every absent lane key filled from the table while
  configured lane keys are kept; a configured `null` map MUST survive as `null`
  (lane-mapping off); filled maps are per-team copies (no shared mutation).
- **C2.3** The pass MUST be pure and deterministic: identical inputs ⇒ byte-identical
  `canonicalizeConfig` output (property test; Principle IV).
- **C2.4** Post-pass, `validateWorkspaceIdentity` and `collectLaneMapOffenders` MUST run
  over the resolved config; `LaneMapError` semantics for operator-authored blank lane
  values are preserved verbatim (A-023-0(b) retained for authored content).

## C3. Enablement switches (A-024-1)

- **C3.1** `stateMappingEnabled` (root, built-in default `true`) and per-team
  `workflowStates.mappingEnabled` (optional) govern `stateMappingActive(config, teamKey)`
  exactly as data-model §3.
- **C3.2** When inactive for a task's routed team, the engine MUST NOT produce a state
  change from a checkbox change or a lane event (including create-carrier labels), MUST add
  reason `state-mapping-disabled` to affected units, and MUST otherwise behave byte-
  identically to the pre-024 default-off posture (US4-AC2).
- **C3.3** `lanes: null` MUST resolve every lane to the untouched + `lane-state-unmapped`
  posture, and the validator (C4) MUST skip lane entries for that team.

## C4. Bootstrap existence validation (A-024-2)

- **C4.1** The validator MUST run only when the selected run mode is `bootstrap`: at plan
  build against the stage-3 snapshot, and in apply after the pre-mutation snapshot
  re-fetch and before the first mutation. Sync-mode runs MUST NOT execute it (FR-011).
- **C4.2** One pass over all configured teams; per team it MUST check (a) every mapped
  name (four identities + lane targets of a non-null map) for exact case-sensitive
  presence in the snapshot, (b) presence of ≥1 state of type `completed` and ≥1 of type
  `canceled`, (c) a distinct `workflowEmpty` outcome when the snapshot carries no states
  for the team (including teams the snapshot omits).
- **C4.3** No additional `Linear_Port` calls beyond the snapshot already fetched by the
  enclosing pipeline.
- **C4.4** Any failing team MUST raise `StateMappingBootstrapError` naming every team's
  outcome (pass and fail), with per-team: missing entry paths + intended names, the
  team's available states as `name (type)` (never ids), case-insensitive near-match hints
  (hints never clear a miss), missing type categories, and correction steps (edit the named
  config key to an available name, or create/rename the state in the team's Linear
  workflow, then re-run). Single pass: one error carries all teams and all names (FR-009).
- **C4.5** Failure MUST occur before any tracker mutation or repository write and MUST
  leave no partial state; re-running after correction over otherwise-identical inputs MUST
  succeed (FR-010, SC-004).
- **C4.6** `exitCodeForError("StateMappingBootstrapError") = CONFIGURATION_ERROR (3)`;
  `LaneMapError` gains the same registration (taxonomy fix, R6).

## C5. Resolver posture

- **C5.1** `desiredCompletionStateName` and `resolveLaneState` MUST treat `null`,
  absent, and blank identity/lane values through their existing "missing" branches —
  never a crash, never a guessed name.
- **C5.2** Their diagnostics MUST reference the default table and the disable levers
  (truthful after default-on; docs-duty 019 precedent); they MUST NOT name snapshot
  contents, credentials, or ids.
- **C5.3** State propagation remains spec→tracker only; mirrored content, titles, identity,
  and attachment machinery are untouched by this contract.

## C6. Compatibility matrix

| consumer posture | behavior |
|---|---|
| zero-config team row (only `projects`) | full default mapping active (SC-001) |
| full explicit configuration (pre-024) | byte-identical outcomes (SC-005) |
| partial lane map | configured lanes win, rest default (US4-AC3) |
| `lanes: null` | all lanes untouched + reported (C3.3) |
| `mappingEnabled: false` / `stateMappingEnabled: false` | no state moves + reported (C3.2) |
| sync mode, drifted/renamed state | today's plan-time conflict posture (FR-011) |

## C7. Governance artifacts (implementation-time)

- Constitution amendment v1.1.0 (Principle III platform-default exception) with Sync
  Impact Report; `docs/contract-amendments.md` entries A-024-0/1/2; regenerated
  `tests/contract/snapshots/frozen-surface.json`; documentation updates per FR-012
  (`README.md`, `docs/configuration.md`, `docs/configuration-reference.md`
  routing table + lanes paragraph + "keys that default to absent", `docs/cli.md` exit
  narrative, `CHANGELOG.md`).
