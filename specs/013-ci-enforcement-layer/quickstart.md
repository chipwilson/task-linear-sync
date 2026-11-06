# Quickstart: CI Enforcement Layer (feature 013)

Validation guide for the `CI_Enforcement_Action` + `src/ci/` wrapper. All identifiers are
placeholders; every scenario is hermetic (temp dirs OUTSIDE the repo working tree, fake
tracker behind the spawned CLI, zero real network/credentials).

## Prerequisites

```bash
npm ci
npm run pretest        # build dist/ + compile build/tests/ (required before manual runs)
```

Fast automated proof of everything below:

```bash
node scripts/run-tests.mjs --tier unit        # ci-settings/evaluate/report-input/summary
node scripts/run-tests.mjs --tier contract    # ci-action-shape / ci-hygiene / ci-packaging / ci-defaults-scan
node scripts/run-tests.mjs --tier integration # ci-enforcement-conditions (in-process seams)
node scripts/run-tests.mjs --tier e2e         # ci-enforcement-action (spawned wrapper + spawned real CLI)
```

## Scenario 1 — defaults fail exactly the violating report, pass the clean one (SC-001, FR-003)

```bash
# violating artifact (crafted fixture report: 1 high-confidence entry, issueId null)
node dist/ci/main.js --workspace /tmp/tls-ci-demo --report tests/fixtures/ci/reports/violates-all-three.json
# → exit 1, stderr: task-linear-sync enforcement failed — unmapped-high-confidence: 1;
#     unresolved-conflict-block: 2; spec-drift: 3        (counts from that artifact)

node dist/ci/main.js --workspace /tmp/tls-ci-demo --report tests/fixtures/ci/reports/clean.json
# → exit 0, stdout: task-linear-sync enforcement passed (unmapped-high-confidence: 0,
#     unresolved-conflict-block: 0, spec-drift: 0)
```

Expected: the summary names EACH triggered condition id with its offending count; the
clean sync passes with zero false alarms. (E2e equivalent spawns the real built CLI over
fixture worlds — Scenario 4.)

## Scenario 2 — toggles and thresholds (FR-002; acceptance scenarios 2–4)

```bash
W=tests/fixtures/ci/reports/violates-all-three.json
node dist/ci/main.js --workspace /tmp/tls-ci-demo --report $W --fail-on-unmapped false \
  --fail-on-conflicts false --fail-on-drift false --protected-branches main
# → exit 0 (DISABLED conditions NEVER fail, regardless of signal) — counts still printed

node dist/ci/main.js --workspace /tmp/tls-ci-demo --report $W --unmapped-threshold 1 \
  --drift-threshold 3 --fail-on-conflicts false --protected-branches main
# → exit 0 (counts do not EXCEED thresholds — 1 > 1 and 3 > 3 are both false)

node dist/ci/main.js --workspace /tmp/tls-ci-demo --report $W --unmapped-threshold 0 \
  --fail-on-conflicts false --fail-on-drift false --protected-branches main
# → exit 1, names only unmapped-high-confidence: 1
```

## Scenario 3 — branch classification + malformed artifact (edge cases; FR-002(b)/FR-003)

```bash
# push run, no protected set configured → condition (b) cannot trigger by branch
GITHUB_REF_NAME=feature/x node dist/ci/main.js --workspace /tmp/tls-ci-demo \
  --report tests/fixtures/ci/reports/conflict-blocks.json --fail-on-unmapped false --fail-on-drift false
# → exit 0 + warning line "…unresolved-conflict-block protection skipped — branch context unresolved"

GITHUB_BASE_REF=main node dist/ci/main.js --workspace /tmp/tls-ci-demo \
  --report tests/fixtures/ci/reports/conflict-blocks.json --fail-on-unmapped false --fail-on-drift false
# → exit 1 "— unresolved-conflict-block: 2"  (PR run; default protected set = PR base)

node dist/ci/main.js --workspace /tmp/tls-ci-demo --report /tmp/nope/report.json
# → exit 2, error NAMES the artifact path — never a silent pass
```

## Scenario 4 — end-to-end through the REAL built CLI (FR-001; SC-002/SC-003)

Driven by `tests/e2e/ci-enforcement-action.test.ts` (spawned `node dist/ci/main.js` +
spawned real CLI core wired to the 007 fake via `writeCliEntry` over `tests/fixtures/`
worlds copied to temp workspaces):

1. **clean world** → wrapper exit 0, outputs `status=pass`; workspace `hashTree` byte-identical
   before/after (zero repository writes); fake port call log shows zero mutations.
2. **conflict-marker world** with `GITHUB_BASE_REF=main` → exit 1, summary names
   `unresolved-conflict-block` + count; `$GITHUB_OUTPUT` carries all six outputs.
3. **drift world** (spec-changed entry) → exit 1 naming `spec-drift`.
4. **toggle-off world run** (same world, all toggles false) → exit 0.
5. **leak check**: every wrapper output line asserted free of the world's sentinel task
   bodies/issue descriptions (screened summaries only — hashes + names).
6. **apply-path absence**: hygiene scan (Scenario 5) + spawned argv logged by the entry
   driver shows only `check`/`plan` — never `bootstrap`/`sync`/`--apply`.

## Scenario 5 — contract scans (SC-002, Principle III/V)

```bash
node --test build/tests/contract/ci-action-shape.test.ts    # action.yml == contracts/action.md (composite, 13 inputs, 6 outputs, node entry, no docker/credential input)
node --test build/tests/contract/ci-hygiene.test.ts         # no engine-exec/gates/tracker/cli imports; child_process only in cli-invoker.ts; fs reads only (+ main.ts's $GITHUB_OUTPUT append); zero apply vocabulary
node --test build/tests/contract/ci-packaging.test.ts       # ./ci export built + typed; deps still exactly {}; bin map unchanged
node --test build/tests/contract/ci-defaults-scan.test.ts   # action.yml + src/ci + docs: zero org ids/tokens/UUIDs
```

## FR / SC → test traceability

| Item | Automated by |
|---|---|
| FR-001 (wraps published CLI; sole input report JSON; zero mutations/writes; no apply mode) | `e2e/ci-enforcement-action` (spawned CLI, hashTree, port census) + `contract/ci-hygiene` + `contract/ci-action-shape` |
| FR-002 (three conditions, toggles, thresholds, protected default = PR base; disabled never fails) | `unit/ci-evaluate` (matrix incl. all-three-at-once) + `unit/ci-settings` + `e2e` toggle-off + branch matrix |
| FR-003 (pass 0 / fail non-zero + screened summary naming condition + count) | `unit/ci-summary` (screening spy + sentinel absence) + `e2e` exit-code + leak checks |
| Edge: missing/malformed report → input error naming artifact | `unit/ci-report-input` + `e2e` malformed-artifact scenario |
| Edge: all three at once → one non-zero, three names | `unit/ci-evaluate` + Scenario 1 fixture |
| Edge: non-protected branch → (b) cannot trigger | `unit/ci-evaluate` (pure) + `e2e` env matrix |
| SC-001 (0 FN / 0 FP on the fixture set) | `integration/ci-enforcement-conditions` over the full fixture corpus at defaults |
| SC-002 (0 mutations/writes; no apply reachable) | `e2e` hashTree + port census; `contract/ci-hygiene` |
| SC-003 (summary names all; every line screened; 0 raw bodies) | `unit/ci-summary` + `e2e` sentinel-leak assertions |

## Cleanup

E2e/integration worlds live in OS temp dirs created per test and removed on dispose
(same convention as the 008/009 harnesses); nothing is written inside the repository
working tree by any 013 test or by the enforcement run itself (the `$GITHUB_OUTPUT` file
is runner-owned, outside the workspace).
