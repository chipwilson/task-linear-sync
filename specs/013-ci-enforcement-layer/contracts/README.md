# Contracts: CI Enforcement Layer (feature 013)

Two normative contracts, both bound by `tests/contract/ci-*.test.ts`:

| File | Surface | Bound by |
|---|---|---|
| [action.md](./action.md) | `action.yml` — the distributable `CI_Enforcement_Action` public surface (inputs, outputs, env, runtime posture) | `ci-action-shape.test.ts`, `ci-defaults-scan.test.ts` |
| [wrapper-api.md](./wrapper-api.md) | `task-linear-sync/ci` — programmatic seam (`runEnforcement`, `CliInvoker`), exit map, output formats | `ci-packaging.test.ts`, `ci-hygiene.test.ts`, unit/e2e suites |

Frozen upstream contracts consumed (never amended):
`specs/002-core-domain-contracts/contracts/plan-report.schema.json` +
`plan-artifact.md` (report JSON = sole machine input), and
`specs/009-operator-cli-plan-report/contracts/command-surface.md` §3–§4 (CLI exit map,
`check` machine contract, "013's own conditions are evaluated by 013 from the report
JSON; the CLI computes none of them").
