# Quickstart: Operator CLI and Plan Review Report

**Feature**: `009-operator-cli-plan-report` — validation guide. Contracts live in
[contracts/](./contracts/README.md); entities in [data-model.md](./data-model.md);
decisions in [research.md](./research.md).

## Prerequisites

- Node.js ≥ 20 (CI matrix 20.x / 24.x). No network, no credentials: every scenario runs
  against the 007 fake `LinearPort` and fixture worlds with placeholder identifiers.
- `npm install` (dev deps only; runtime dependency count stays **0**).

## Build & test commands

```bash
npm run build && npm run compile:tests   # pretest (dist/ + build/tests/)
node scripts/run-tests.mjs --tier unit --test-name-pattern "cli-"
node scripts/run-tests.mjs --tier contract
node scripts/run-tests.mjs --tier integration --test-name-pattern "cli-"
node scripts/run-tests.mjs --tier e2e --test-name-pattern "cli-"
npm test                                  # full suite (coverage gate: 80/70/80)
```

## Harness

`tests/helpers/cli-harness.ts` builds a `CliContext` over an 008-style fixture world
(reuses `buildWorld` conventions from `tests/helpers/engine-harness.ts`; new fixture
worlds under `tests/fixtures/cli/worlds/`): seeded `createFakeLinearPort`, temp
`StateStore` **outside** the fixture repo, fixed injected `Clock`, recording fake
`QueueSurface`, captured `stdout`/`stderr` lines. Integration tests call
`runCli(argv, ctx)` directly; e2e tests run a generated `driver.mjs` child process that
imports `task-linear-sync/cli` with the same fake wiring, plus bin smoke tests spawning
`node dist/cli/main.js`.

## Validation scenarios

1. **Twelve-command exit matrix (US1, FR-001/002, SC-002)** —
   `tests/integration/cli-commands.test.ts` + `tests/e2e/cli-child-process.test.ts` +
   `tests/e2e/cli-bin-smoke.test.ts`:
   each command exits 0 on its success fixture and the mapped non-zero code on its
   refusal/abort fixture; `plan --apply --accept-low-confidence` exits **2** naming both
   flags with zero filesystem/network effect; `check` exits 0 clean / 8 with a conflict
   task in the world / never 0 when the report artifact is missing (tampered fixture).
2. **Zero-network agent hook (FR-003)** — `install-agent-hook` with the recording fake:
   fake port call log shows **0 requests**; only the local template file exists at the
   003 scaffold location; existing-file refusal surfaces `status: "refused"` → exit 4.
3. **Rollback refusal (FR-004)** — `tests/integration/cli-rollback-refusal.test.ts`:
   journaling disabled, and journaling on but no journal for the run id ⇒ exit 4 naming
   `MANIFEST_UNJOURNALED`, repo hash unchanged, zero state writes after the refusal
   point; journaled run ⇒ exit 0 through the engine's reversal.
4. **Review-report pair (US2, FR-006/007/008, SC-001)** —
   `tests/integration/cli-plan-report.test.ts` + `tests/contract/cli-report-schema.test.ts`:
   over the `review-report` world the pair validates against the frozen schema; per-entry
   field set complete; groups sorted project→milestone; unmapped section with the
   descendant-only `parentMapped` rule; conflict task surfaced in both artifacts;
   security-assertions block passes; sentinel raw bodies/descriptions absent from both
   artifacts; JSON carries durable ids, Markdown human names.
5. **Zero-task plan (edge case)** — `tests/integration/cli-report-zero-task.test.ts`:
   empty specs repo ⇒ both artifacts render with empty sections and passing assertions;
   `plan` and `check` still exit 0 (`check` findings: none).
6. **Read-only violation abort (FR-005, SC-003)** —
   `tests/integration/cli-readonly-violation.test.ts`: a fixture port decorator attempts
   (a) `updateIssue` during `plan`, (b) `writeJson("sync-state.json")` during report
   generation ⇒ `ReadOnlyViolationError` names the attempt, exit 5, mutation count 0,
   repo tree byte-identical (pre/post hashes).
7. **Queue seam default refusal (research R5)** —
   `tests/unit/cli-queue-surface.test.ts` + `cli-commands.test.ts` default-wiring cases:
   `enqueue`/`worker`/`install-hooks`/`install-agent-hook` exit 7 naming the missing
   module with zero side effects while `src/queue/` is absent; `last-run` reads the
   engine-written `last-run.json` and exits 0 (marker `--json` after an apply fixture).
8. **Packaging & budgets** — `tests/contract/cli-packaging.test.ts`:
   `package.json` `bin.task-linear-sync` → `dist/cli/main.js` exists after build; the
   `./cli` export resolves with `types` first; dependency count still 0
   (`tracker-dependency-budget` re-assertion, unedited); read-only lane import scan
   (`cli-readonly-lane`) and hygiene scans green.
9. **Docs** — `README.md` + `docs/cli.md` show one scenario per command (placeholder
   identifiers only), the exit-code table, the `check` machine contract, and the
   `QueueSurface` placeholder behavior; the distributed-defaults scan stays green.

## Traceability

| Requirement | Enforced by |
|---|---|
| FR-001 twelve commands, exit contract | scenario 1 (`cli-commands`, `cli-argv`, `cli-exit-codes`, e2e pair) — SC-002 is the 100% fixture-coverage quantifier |
| FR-002 plan+apply-flag rejection naming the flag | scenario 1 (unit parser test + integration + bin smoke) |
| FR-003 zero-network agent-hook install | scenario 2 (fake port call log, unit `QueueSurface` input test) |
| FR-004 rollback refusal on unjournaled runs, no mutation | scenario 3 (+ `cli-exit-codes` mapping `MANIFEST_UNJOURNALED`→4) |
| FR-005 report pair with zero writes; read-only violation abort | scenarios 6 + 4 (+ `cli-readonly-guard` unit, `cli-readonly-lane` contract) |
| FR-006 complete per-task field set | scenario 4 (`cli-report-schema`, `cli-plan-report`) |
| FR-007 grouping / unmapped / parent-mapped / conflict surfacing | scenario 4 (fixture asserts each rule incl. mapped-sibling edge case) |
| FR-008 security-assertions block; hashes not bodies; ids vs names | scenarios 4 + 5 (computed assertions; sentinel absence; zero-task passing block) |
| SC-001 approvable from report alone | scenario 4 corpus scan (0 raw bodies/descriptions, full field set) |
| SC-002 100% exit-status fixtures | scenario 1 matrix (unit mapping is a total function over the vocabulary) |
| SC-003 0 mutations / abort on injected write | scenario 6 (+ repo-tree hash assertions in scenarios 1/4) |
| Edge: zero-task plan | scenario 5 |
| Edge: parent mapped only via descendants | scenario 4 fixture `review-report` (mapped sibling, unmapped parent) |
| Edge: reports never in the working tree | scenarios 4 + 6 repo-walk assertions |

## Exit criteria for this feature

All tiers green under `npm test` (coverage gate 80/70/80), the two additive
`package.json` entries in place, `docs/cli.md` + README updated, and no diff outside
`src/cli/**`, `tests/**/cli-*`, `tests/fixtures/cli/**`,
`tests/helpers/cli-harness.ts`, the packaging entries, docs, and this specs folder.
