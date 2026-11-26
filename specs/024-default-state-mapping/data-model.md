# Phase 1 Data Model: Default-On Task State Mapping (feature 024)

**Input**: `spec.md` Key Entities · decisions `research.md` R1–R3, R5–R7
All shapes additive to the frozen `src/domain/routing.ts` / `src/config/schema.ts` surfaces
(amendments A-024-0/1; no frozen member changes).

## 1. Default mapping tables (new, config layer)

`src/config/defaults.ts` (release-scan target — platform-generic strings only):

```text
DEFAULT_WORKFLOW_STATE_NAMES : { backlog, todo, inProgress, done }   → identity → state NAME
  backlog → "Backlog"    todo → "Todo"
  inProgress → "In Progress"    done → "Done"

DEFAULT_LANE_STATE_MAP : Partial<Record<LaneName, string>>            → lane → state NAME
  planned → "Backlog"          claimed → "Todo"
  in_progress → "In Progress"  for_review → "In Progress"
  in_review → "In Progress"    approved → "In Progress"
  done → "Done"                canceled → "Canceled"
  (blocked: absent — no default counterpart; research R2)
```

Validation rules: values are non-empty strings; keys restricted to
`WORKFLOW_STATE_IDENTITIES ∪ LANE_VOCABULARY`; zero organization-specific literals
(enforced by the existing `defaults-scan` contract test).

## 2. Resolved per-team mapping state (resolution pass output)

For each `teamKey` present in the merged `teams` map, the load-time pass materializes:

```text
ResolvedTeamWorkflowStates {
  backlog / todo / inProgress / done : string      ← configured value ∪ DEFAULT_WORKFLOW_STATE_NAMES
  lanes : Record<LaneName, string> | null          ← per-lane merge of configured ∪
                                                      DEFAULT_LANE_STATE_MAP; explicit null map
                                                      survives (lane-mapping OFF)
  completedTypes? / ignoredTypes? : string[]       ← unchanged (existing type defaults)
  mappingEnabled? : boolean                        ← new optional per-team switch (absent ⇒
                                                      inherit global)
}
```

Fill rule (research R1/R3, deterministic and total):

| merged value at `teams[K].workflowStates.<entry>` | resolution |
|---|---|
| absent (`undefined`) | filled from the default table |
| non-empty string | kept — configured wins (FR-006) |
| blank string (`""`/whitespace) | kept — still fails validation exactly as today (`LaneMapError` for lane entries; identity validation unchanged) |
| `null` — `lanes` map | kept as `null` — explicit lane-mapping-off (R3) |
| `null` — a scalar identity | kept; resolver treats it as missing (R7), never crashes |

Precedence remains exactly constitution III: built-in defaults → config file →
programmatic overrides. `canonicalizeConfig` of a resolved config is deterministic
(property test, R9).

## 3. New configuration switches

```text
ResolvedConfig.stateMappingEnabled : boolean      built-in default: true
TeamIdentity.workflowStates.mappingEnabled? : boolean   absent ⇒ inherit global; false ⇒ off for that team
```

`stateMappingActive(config, teamKey) = config.stateMappingEnabled !== false
∧ config.teams[teamKey].workflowStates?.mappingEnabled !== false`

Inactive ⇒ engine derives **no** state change from checkboxes or lanes; affected plan units
carry reason label `state-mapping-disabled`; mirrored content and all other channels are
untouched (spec US4-AC2).

## 4. Bootstrap mapping validation report (new engine entity)

Input: resolved config + `TeamMetadataCollections[]` snapshot (plan-time snapshot in build;
re-fetched snapshot in apply; no extra port calls — R4). Scope: **bootstrap mode only**.

```text
BootstrapMappingReport (per team, computed for every configured team in one pass) {
  teamKey
  missing        : [{ entryPath, intendedName }]        // identity entries + lane targets
  nearMatches    : [{ entryPath, intendedName, availableName }]  // case-insensitive match only
  available      : [{ name, type }]                     // names + types, never ids (R6)
  missingTypes   : ["completed" | "canceled"]           // FR-008 category assertions
  workflowEmpty  : boolean                              // distinct diagnostic (spec edge case)
}
```

Rules:
- `missing` source names: all four identities + every lane target reachable through the
  team's resolved lanes map (null map ⇒ no lane entries to check; `blocked` has no default
  target ⇒ never checked unless configured).
- Exact case-sensitive existence test (today's resolution rule); a `nearMatches` hit does
  **not** clear `missing` (no guessing — R5).
- Team passes only when `missing = ∅ ∧ missingTypes = ∅ ∧ ¬workflowEmpty`.
- Any failing team ⇒ `StateMappingBootstrapError` listing every team's report, grouped,
  each with correction steps (edit named `entryPath` to a listed available name, or create/
  rename the state in the team's Linear workflow, then re-run). Run aborts with
  `ExitCode.CONFIGURATION_ERROR` (3); zero mutations, zero partial state (FR-009/FR-010).

## 5. Error taxonomy additions

```text
StateMappingBootstrapError (engine family, stable name "StateMappingBootstrapError")
  ├─ payload: BootstrapMappingReport[]  (every failing team; pass/fail summary for all)
  └─ exitCodeForError → CONFIGURATION_ERROR (3);   LaneMapError also registered → 3 (R6)
```

## 6. Reason/label vocabulary additions (plan report)

| label | meaning |
|---|---|
| `state-mapping-disabled` | mapping suppressed for the unit's team (global or per-team off) |
| `lane-state-unmapped` | unchanged (023) — now reachable mainly by `blocked` or lane-off |
| `completion:state-name:<name>` / `lane:<lane>` | unchanged; values may now come from defaults |

## 7. State transitions (mapping decision flow, per unit)

```text
lane event / checkbox change present
  └─ stateMappingActive?  ── no ─→ label state-mapping-disabled · state channel skipped
        │ yes
        ├─ checkbox:  desired = done|backlog identity (resolved) → id via snapshot → state change
        └─ lane:      resolved lane target null? → lane-state-unmapped (untouched)
                      mapped & live-matches → no-op (idempotent, unchanged)
                      mapped → state change / create-carrier (unchanged machinery)
```

No reverse mapping (spec FR-013): the flow reads task state → tracker state only;
`IssueView.stateType` remains read solely for the live no-op comparison.

## 8. Traceability (entity → FR)

| entity/section | FR |
|---|---|
| §1 tables | FR-002, FR-003, FR-004, FR-005, FR-012 |
| §2 resolution | FR-001, FR-006 |
| §3 switches | FR-007 |
| §4 report + §5 error | FR-008, FR-009, FR-010 |
| §6 labels | FR-007 (visible reporting) |
| §7 flow | FR-011, FR-013 |
