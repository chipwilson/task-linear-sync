# Quickstart Verification — feature 020 (T046)

Measured 2026-11-19 against the built `dist/` at branch `020-task-depth-folding`
(post-Phase-3 tree; full suite 1794 pass / 0 fail). Raw capture:
`/tmp/opencode/depth-baseline/quickstart-measured.txt`. Per the feature rule,
where measurement contradicts `quickstart.md` the artifact is corrected — the
two corrections are noted inline.

## Scenario 1 — parse-level fold matrix (measured)

```text
cap=undefined tasks=2 parented=0 folded=3 T001.span=1-4
cap=1         tasks=2 parented=0 folded=3 T001.span=1-4
cap=2         tasks=4 parented=2 folded=1 T001.span=1-4
cap=3         tasks=5 parented=3 folded=0 T001.span=1-4
cap=64        tasks=5 parented=3 folded=0 T001.span=1-4
```

- `cap=2 tasks=4 parented=2 folded=1` — measurement confirms the T009 correction
  (the pre-amendment `parented=3` was an off-by-one; surviving parented tasks at
  cap 2 are `T001a` and `T100a`).
- `cap=3 tasks=5 parented=3 folded=0` — measurement confirms the artifact sweep
  finding: this fixture is three levels deep, so at cap 3 nothing folds beyond
  cap 64 (cap 3 ≡ pre-feature posture here). Depth-3 folding IS exercised on
  deeper fixtures (`tests/unit/parsing-depth-fold.test.ts` five-level chain at
  cap 3, `tests/e2e/cli-depth-folding.test.ts` four-level fixture).
- `T001.span=1-4` at EVERY cap — span invariance (C4/I3) measured directly.

## Scenario 2 — legacy fidelity at 64

Full pre-feature suite pinned at explicit `64` (worlds/fixtures triage):
`npm run pretest && node scripts/run-tests.mjs --all` → **1794 pass / 0 fail**
(unit 1020 green; contract/integration/e2e green; coverage 81.98% ≥ threshold).

## Scenario 3 — feature tests

`node --test build/tests/unit/parsing-depth-fold.test.js` (C2–C6 matrices at
caps 1/2/3/64/absent), `build/tests/integration/depth-folding-{flat,two-level,
tightened}.test.js`, `build/tests/e2e/cli-depth-folding.test.js` and the
`ci-enforcement-action` folded-fixture scenario — all green in the full run.

## Scenario 4 — invalid cap refuses (measured, real CLI + scratch repo)

```text
cap=0    exit=3  below-minimum  "configuration key 'maxTaskIssueDepth' failed: below-minimum (value: 0)"
cap=65   exit=3  above-maximum  "... (value: 65)"
cap=1.5  exit=3  not-an-integer "... (value: 1.5)"
cap="1"  exit=3  not-an-integer "... (value: \"1\")"
cap=1/2/3/64     exit=0, inventory succeeds; zero state written into the repo in every case
```

One diagnostic line, key + offending value only; nothing else written.

## Scenario 5 — determinism (measured)

**Artifact correction (T046):** the frozen command surface has NO
`inventory --json` (measured: `error: unknown option for 'inventory': --json`,
exit 2); `check` is the JSON plan lane. The scenario was corrected in
`quickstart.md` to the runnable form below.

Two consecutive `inventory` runs over the same cap-1 scratch repo
(`- [ ] T001` with two nested levels): stdout and stderr **byte-identical**
(`stdout-identical=true stderr-identical=true`), e.g.
`specs/demo/tasks.md  framework=generic  tasks=1` — the folded subtree is
excluded from the count at both runs, stably.

## SC-001 fidelity at explicit 64 (T047 evidence)

`fidelity-diff-evidence.txt` (this directory) records the byte-identity of the
pre-change baseline capture (`/tmp/opencode/depth-baseline/reference/`, HEAD
`823d8fb`) against a re-parse of the same corpus at explicit
`maxTaskIssueDepth: 64` on the final tree (`final-cap64/`): **diff clean —
byte-for-byte identical, 6/6 files**.
