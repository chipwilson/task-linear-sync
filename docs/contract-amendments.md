# Contract amendments (FR-008)

The modules under `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, and
`src/ports` are the **frozen contract surface** of feature 002: every shape and behavior
they define mirrors a normative document in
[`specs/002-core-domain-contracts/contracts/`](../specs/002-core-domain-contracts/contracts/).
Later features (003–013) consume these contracts and may **not** edit them.

## The amendment rule

A contract change is a **constitution-governed cross-feature amendment**. One amendment
updates all three artifacts **together, in one change**, noted against feature 001:

1. the contract document in `specs/002-core-domain-contracts/contracts/`,
2. the `src/` module that mirrors it,
3. the contract-test snapshot `tests/contract/snapshots/frozen-surface.json`.

Nothing else may ride along with the amendment; behavior changes additionally require
spec/plan updates for the affected consumer features.

## How drift is enforced

`tests/contract/frozen-surface.test.ts` parses the generated `.d.ts` of every frozen
module and diffs the exported-name sets against the checked-in snapshot. Any addition,
removal, or module rename fails the suite with a per-module drift list:

```
config/schema: ADDED NewThing
domain/task:   REMOVED IssueRef
```

Regenerating the snapshot is deliberate, never automatic:

```sh
UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract
```

Because `npm test` runs that suite on every CI run, an unnoticed edit to a frozen module
breaks the build — amendments are visible by construction (feature 002 SC-004
"contract-drift" scenario).

## Companion freeze tests

- `tests/contract/report-schema.test.ts` — the plan-report schema forbids raw
  task-body/issue-description fields structurally (`additionalProperties: false` +
  schema scan).
- `tests/contract/package-surface.test.ts` — the exports map must keep resolving for the
  root and all six subpaths.
- `tests/contract/defaults-scan.test.ts` — shipped defaults stay free of real
  organization identifiers.
