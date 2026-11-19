# Quickstart: Validating Task-Depth Folding

A runnable validation guide for feature 020. Behavior details live in
[contracts/depth-folding.md](./contracts/depth-folding.md) (rules C1–C10) and
[data-model.md](./data-model.md) (invariants I1–I6) — this file only runs
things and states expected outcomes. All identifiers are placeholders
(constitution III).

## Prerequisites

```bash
npm ci
npm run pretest          # build (dist/) + compile tests (build/tests/)
```

Node ≥ 20. No Linear credentials are needed for any scenario below (the
tracker port is constructed lazily and never touched here).

## Scenario 1 — Parse-level fold matrix (SC-002, rules C2–C5)

Save as `/tmp/depth-demo.mjs` and run `node /tmp/depth-demo.mjs` from the
repository root:

```js
import { parseTaskFile } from "./dist/parsing/index.js";
import { builtInAdapters } from "./dist/discovery/index.js";
import { loadConfig } from "./dist/config/index.js";

const content = [
  "- [ ] T001 Top task",
  "",
  "  - [ ] T001a nested detail",
  "    - [ ] T001a-i deeper detail",
  "",
  "## T100 Epic heading",
  "",
  "- [ ] T100a checklist orphaned under the heading",
  "",
].join("\n");

for (const cap of [undefined, 1, 2, 3, 64]) {
  const config = loadConfig(cap === undefined ? {} : { overrides: { maxTaskIssueDepth: cap } });
  const r = parseTaskFile("specs/demo/tasks.md", content, builtInAdapters["generic"], config);
  console.log(`cap=${String(cap)} tasks=${r.file.tasks.length} ` +
    `parented=${r.file.tasks.filter((t) => t.parentUuid !== undefined).length} ` +
    `folded=${r.exclusions.filter((e) => e.reason === "depth-folded").length}`);
}
```

Expected (after implementation; `cap=undefined` resolves to the built-in
default `1`; all rows MEASURED — see `quickstart-verification.md`):

```text
cap=undefined tasks=2 parented=0 folded=3
cap=1 tasks=2 parented=0 folded=3
cap=2 tasks=4 parented=2 folded=1
cap=3 tasks=5 parented=3 folded=0
cap=64 tasks=5 parented=3 folded=0
```

- `cap=undefined`: the key is absent, so the built-in default `1` applies —
  the flat board: only `T001` and `T100` survive, zero parented tasks, three
  lines folded (same row as `cap=1`).
- `cap=1`: identical to `cap=undefined`; zero parented tasks (rule C3 flat-
  board corollary); three lines folded (rule C5).
- `cap=2` (measured): surviving parented tasks are `T001a`
  and `T100a` (2), only `T001a-i` folds — the previously listed
  `parented=3` was an off-by-one.
- `cap=3` (measured): nothing folds beyond cap 2 — `T001a-i`
  is depth 3 and survives at cap 3 (rule C3 folds iff `depth > cap`) — so
  this row equals `cap=64` on this three-level fixture.
- `cap=64` reproduces today exactly (the practically-unlimited escape
  hatch): all five lines are tasks; the two-deep checklists and the
  heading-orphan carry `parentUuid`; zero folded.
- At every cap, `T001`'s `Task_Body` span is identical and its body text
  contains the folded lines verbatim (rule C4 / invariant I3) — verify by
  printing the `taskBody` span for `T001` across the five runs
  (caps `undefined`/`1`/`2`/`3`/`64`).

## Scenario 2 — Legacy fidelity at `64` (SC-001, rule C1)

The pre-feature suites must pass with `maxTaskIssueDepth: 64` pinned. The
pinning lives in the fixtures themselves (parsing goldens, config fixtures,
engine worlds, CLI worlds) — that triage is part of this feature's test
work, not a prerequisite state:

```bash
npm run test:unit
npm run test:contract
```

Expected: all green with the existing parsing goldens byte-unchanged — at
explicit cap `64` the effective cap exceeds every fixture's depth, so
output equals the pre-feature build exactly. The shipped default is `1`,
so tests that assert `defaults.ts` content or the default posture are
amended deliberately (`maxTaskIssueDepth === 1`), and nested-behavior
expectations stay green only via the `64` pin.

## Scenario 3 — Feature tests (rules C1–C10)

```bash
node --test build/tests/unit/parsing-depth-fold.test.js      # C2–C5, C6 (unit matrix)
npm run test:integration                                     # C3/C4/C7/C8 over the fake port
npm run test:e2e                                             # C6 exit-3 + C9 double-run scenarios
```

Expected: green; the integration harness additionally proves zero
`issueArchive`/delete calls when the cap tightens over a world with an
existing child issue (SC-003), and the CI-action lane stays green on the
folded fixture (C8).

## Scenario 4 — Invalid cap refuses everywhere, exit 3 (SC-004, rule C6)

In a scratch repository:

```bash
mkdir -p /tmp/tls-depth && cd /tmp/tls-depth && git init -q .
mkdir specs/demo
printf -- '- [ ] T001 Something\n\n  - [ ] T001a Detail\n' > specs/demo/tasks.md
printf '{ "maxTaskIssueDepth": 0,\n  "teams": { "acme": { "projects": ["p"], "workflowStates": { "backlog": "B", "done": "D" } } },\n  "defaultTeamKey": "acme", "defaultProject": "p" }\n' > task-linear-sync.json
node <repo>/dist/cli/main.js inventory; echo "exit=$?"
```

Expected: one diagnostic naming `maxTaskIssueDepth` and the value `0`
(reason `below-minimum`), `exit=3` (configuration), zero state written into
the repo. Repeat with `65`, `1.5`, and `"1"` — same refusal family; with `1`,
`2`, `3`, or `64`, `inventory` succeeds and reports the folded task counts.

## Scenario 5 — Determinism (C9 / I6)

Measured correction (T046): the frozen command surface has no
`inventory --json` (`--json` is a usage error there; `check` is the JSON plan
lane), so determinism runs on the plain `inventory` output:

```bash
node <repo>/dist/cli/main.js inventory > run1.out
node <repo>/dist/cli/main.js inventory > run2.out
cmp run1.out run2.out && echo byte-identical
```

Expected: `byte-identical`, exclusions (including `depth-folded` records)
included in the stable ordering.

## Toggling guidance (documented risk, not a test)

Set `maxTaskIssueDepth` **before** the first sync of a repository. Tightening
it later reports previously created child issues as unmapped — never archives
them — and can shift identities of tasks that have no local id; tasks carrying
local ids or visible reference tokens re-match unchanged.
