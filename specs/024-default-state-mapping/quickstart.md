# Quickstart & Validation: Default-On Task State Mapping (feature 024)

Hermetic throughout — the fake `Linear_Port` stands in for Linear; zero real credentials
(Principle VI). Contract clauses referenced below live in
[`contracts/state-mapping-defaults.md`](./contracts/state-mapping-defaults.md).

## Prerequisites

- Node.js ≥ 20; `npm ci` from the repository root.
- All commands from the repo root; tests run from compiled output via the harness.

## Build, lint, full gate

```bash
npm run lint
npm run typecheck
npm test              # build + compile:tests + all tiers (unit/integration/e2e/contract + property/security)
```

Expected: green, with the new 024 tiers included in the run (coverage ≥ configured minimum).

## Focused validation scenarios

Run a tier or file, e.g.:

```bash
node scripts/run-tests.mjs --tier unit
node scripts/run-tests.mjs tests/unit/config-state-mapping-defaults.test.ts
```

| # | Scenario (maps to) | Command area | Expected outcome |
|---|---|---|---|
| V1 | Zero-config resolution (C1, C2, SC-001) | unit `config-state-mapping-defaults` | team row with only `projects` resolves `backlog="Backlog"`, `todo="Todo"`, `inProgress="In Progress"`, `done="Done"` + full default lane map (no `blocked`); `canonicalizeConfig` deterministic across runs |
| V2 | Override precedence (C2, US4-AC1/AC3, SC-005) | unit, same file | configured `done: "Completed"` wins; partial lane map merges per lane; blank lane value still `LaneMapError`; `lanes: null` survives the pass |
| V3 | Zero-config state propagation per framework (FR-004/005, US3) | integration `state-mapping-defaults` over the fake port, one world per framework row | checked task ⇒ issue → `Done`; unchecked ⇒ `Backlog`; identical targets across kiro/spec-kit/open-spec/bmad/spec-superpower/generic |
| V4 | spec-kitty lanes default-on (FR-001–003, US1) | integration `state-mapping-lanes-default` | event-log lane advances move issues per C1.1 table; `blocked` ⇒ untouched + `lane-state-unmapped`; mapped-and-live-matches ⇒ no-op |
| V5 | Disable levers (C3, US4-AC2) | integration | `stateMappingEnabled:false` and per-team `mappingEnabled:false` ⇒ zero state ops, reason `state-mapping-disabled`; `lanes:null` ⇒ lanes untouched |
| V6 | Bootstrap validation failure (C4, US2, SC-002/SC-003) | integration + e2e CLI | team world renamed `In Progress`→`WIP` and lacking `Canceled`: bootstrap `plan` throws `StateMappingBootstrapError`; message groups per team, lists `missing` names with entry paths, available `name (type)` states, `did you mean 'In Progress'/'WIP'`-style hints, correction steps; exit code 3; fake port shows zero mutation calls |
| V7 | Corrected re-run (C4.5, SC-004) | integration | after fixing the mapping (or adding the state in the fake world), re-run bootstrap plan+apply succeeds with no other change |
| V8 | Sync mode untouched (C4.1, FR-011) | integration | second run (checkpoint present) against the drifted world keeps today's plan-time conflict findings, no bootstrap error class |
| V9 | Empty/unreachable workflow (spec edge cases) | integration | team with no states ⇒ distinct `workflowEmpty` diagnostic, not N missing names |
| V10 | Contract + release scan (C1.2, C7) | `npm run test:contract` | frozen-surface snapshot regenerated (additive names: default tables, switches, error class); defaults-scan clean; exit-code table pin includes `StateMappingBootstrapError`/`LaneMapError` ⇒ 3 |

## Manual CLI smoke (optional, needs a real throwaway Linear team)

1. Configure only `teams.<KEY>.projects`, `defaultTeamKey`, `defaultProject` in
   `task-linear-sync.json`; no `workflowStates` keys.
2. `<bin> plan` against a default-workflow team — plan shows state actions toward
   `Done`/`Backlog` (and lane states for spec-kitty missions) with no mapping configured.
3. Point the config at a team whose workflow lacks `Todo` — `plan` refuses with exit 3 and
   the grouped correction report; fix a key and re-run to confirm convergence.

## Cross-checks

- Every table row traces to a contract clause; SC-006 requires each framework row (V3) and
  V6 present in the automated suite before merge (Principle VI merge-blocking pipeline).
- Governance: confirm A-024-0/1/2 records and the constitution v1.1.0 amendment exist in
  the same branch (C7).
