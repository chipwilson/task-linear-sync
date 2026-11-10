# Quickstart: Validating the `spec-superpower` Adapter

**Feature**: `018-spec-superpower-adapter`
Behavioral source of truth: [contracts/spec-superpower-adapter.md](./contracts/spec-superpower-adapter.md);
field values: [data-model.md](./data-model.md).

## Prerequisites

- Node.js ≥ 20.0.0, npm
- Repository root: `task-linear-sync` package source (this repo)
- **No Linear credentials are needed for anything below** — validation runs entirely on the
  fake `Linear_Port` and read-only fixtures (hermetic by constitution). Only the optional
  live-CLI smoke test (§6) needs a token.

## 1. Build and full suite (SC-005 gate)

```bash
npm ci
npm test                      # unit + contract + integration + e2e tiers, coverage gate
```

Expected: all tiers green with the six built-in ids present; every pre-existing
framework case untouched (SC-005 — "no behavior change for the other built-in identities").

## 2. Feature-scoped automated proof (each acceptance criterion maps here)

```bash
npm run compile:tests
node scripts/run-tests.mjs --tier unit        # discovery-adapters-spec-superpower, parsing-spec-superpower, discovery-selection
node scripts/run-tests.mjs --tier contract    # framework-support-consistency, discovery-surface, frozen-surface
node scripts/run-tests.mjs --tier integration # discovery-spec-superpower, sync-spec-superpower-drift
```

| Check | Criterion | What the suite asserts |
|---|---|---|
| Discovery claims only the fixture plans | SC-001, US1-AC1/AC4 | `spec-superpower` fixture repo: 3/3 plan files claimed; 0 unrelated Markdown files; date-named file outside `docs/superpowers/plans/` unclaimed |
| Task count/ids | SC-002, US1-AC1/AC2/AC3 | exactly 3 tasks per reference plan; ids `Task 1`–`Task 3`; titles exclude the id span; 0 tasks from 7 steps, preamble, or title |
| Feature names | SC-003, US3-AC1 | `auth` etc. — date and extension stripped |
| Step containment + round-trip | US2-AC1/AC3 | checkboxes in `exclusions`; body byte-equal to the plan span incl. code fences; parse→render→parse byte-for-byte (aside from reference prefix) |
| Drift, one write | SC-004, US2-AC2 | check one step in a synced plan, re-run: exactly 1 issue description write, 0 others |
| Distinct identities, same name | FR-010, US3-AC2/AC3 | two `…-sync.md` plans: pairwise-distinct stable uuids; in-place edit changes no identity |
| Consistency suite | FR-013 | registry ⇄ union ⇄ glossary ⇄ README enumerate `spec-superpower`; fabricated-name pin now `/spec-kitty/i`; scaffold table `["generic","kiro"]` |

## 3. Manual discovery walkthrough (no credentials)

```bash
npm run build
node dist/cli/main.js inventory --repo tests/fixtures/repos/discovery/spec-superpower
```

Expected: three files listed under `docs/superpowers/plans/…`, framework
`spec-superpower`, features `auth` and `sync` (×2, per file) — and no other Markdown.
Disable the identity to prove the exact opt-out (edge case):

```bash
# in a temp config or via programmatic frameworkAdapters without "spec-superpower"
node dist/cli/main.js inventory --repo tests/fixtures/repos/discovery/spec-superpower --config /tmp/no-superpower.json
```

Expected: zero plan files discovered (the date glob is absent from the traversal union).

## 4. Task-level inspection

Parse-only proof without Linear at all — mirror the reference plan through the programmatic
API (`parseTaskFile` with the built-in adapter, see `tests/unit/parsing-spec-superpower.test.ts`
for the exact call):

Expected: 3 tasks (ids `Task 1`–`Task 3`), 7 exclusion records for the steps, one
`duplicate-local-id` warning when a duplicate `Task N` is introduced in a scratch copy of
the fixture (FR-010 warning path).

## 5. End-to-end sync + progress mirroring (fake Linear_Port)

```bash
node scripts/run-tests.mjs --tier integration   # includes sync-spec-superpower-drift
```

The drift test drives the canonical US2 walkthrough: initial sync (3 issues, bodies
verbatim), agent checks `- [x] **Step 2: …**` in one plan file, re-run → exactly that
task's issue body refreshed, byte-for-byte apart from the visible reference prefix, 0
other writes. Rollback then restores per the standard journal path (unchanged engine).

## 6. Optional live smoke (requires a Linear token)

```bash
export LINEAR_ACCESS_TOKEN=lin_api_…            # placeholder — never committed
cd tests/fixtures/repos/discovery/spec-superpower
npx task-linear-sync inventory                   # read-only: 3 plan files, features per file
npx task-linear-sync plan                        # read-only: 3 task issues planned
# apply deliberately:
npx task-linear-sync sync --plan <planId> --apply --confirm SYNC
```

Expected: three issues titled by component names, bodies reproducing each task's steps and
code blocks; a second `plan` run reports zero changes (idempotence); the README subsection
statement holds — checking steps off in the plan re-mirrors text but never moves issue
state (tracker-side completion, FR-009).

## 7. Failure modes to look for

- A plan outside the configured root appearing in `inventory` ⇒ fallback-narrowing
  regression (contract Rule 2).
- More tasks than `Task N:` headings ⇒ step-capture or grammar regression (Rules 4–5).
- Identical uuids across the two same-name plans, or a `DurableIdentityCollisionError`
  during §5 ⇒ seed composition regression (Rule 6).
- Any write beyond one issue in the drift run ⇒ mirroring-scoping regression (SC-004).
- `framework-support-consistency` red after a doc edit ⇒ README/requirements/registry
  drifted apart (Rule 9); fix the docs, not the pin.
