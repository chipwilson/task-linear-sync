# Quickstart & Validation Guide: Per-Task Splitting of Kiro Implementation-Plan Task Files

## Prerequisites

- Node.js ≥ 20 on Linux/macOS; repository dependencies installed from the locked manifest:
  `npm ci`
- Branch `021-fix-kiro-task-splitting` checked out. No credentials are needed anywhere: all
  validation runs against the fake `Linear_Port` (hermetic, per the constitution).

## Reproduce the reported defect (pre-fix baseline)

The reported file is reproduced at `tests/fixtures/parsing/kiro-plan/tasks.md` (shape: one
`# Implementation Plan` heading, thirteen `- [x] N. …` tasks with detail bullets and
`_Requirements:_` lines). Before the fix, parsing it at default settings yields ONE task
(`Implementation` id / `Plan` title, body = whole file) and thirteen `depth-folded` exclusions.

## Run the feature validation

```bash
npm run test:unit        # includes parsing-kiro-plan, parsing-title-heading, parsing-local-id-span
npm run test:integration # includes engine-kiro-plan-world (+ corpus & depth-folding pins)
npm run test:contract    # golden rendering + surfaces
npm run test:e2e         # CLI surfaces incl. depth-folding user journeys
npm run lint && npm run type-check && npm run build   # CI merge-blocking gates
```

## Expected outcomes (post-fix; contract C1–C9)

1. **Unit — reported shape at DEFAULT settings** (kiro path `.kiro/specs/auth/tasks.md` and generic
   `docs/auth/tasks.md` — identical results, C8): 14 tasks = 13 checklist tasks (depth 1, ids
   `1`–`4`, `4.1`–`4.3`, `5`–`10`, all checked) + the `Implementation Plan` title-heading task with an
   empty/preamble-only body; **0** `depth-folded` exclusions; each body covers only its own bullets and
   requirement line; the body-less `4.` task has an empty body.
2. **Engine world `kiro-plan-basic`** — plan/apply against the fake tracker: 14 issues created; each
   issue description equals its own task region; **no created description contains the full file or any
   other task's text** (the reported bug's regression assertion); re-plan = 0 actions; toggling one
   checkbox = exactly 1 issue update; rollback restores the file.
3. **Titles**: no issue titled `Plan`; the title-heading issue (if surfaced) is titled
   `<feature>: Implementation Plan`; task issues carry their own text (e.g. `auth: Create EC2 client
   wrapper with retry logic`).
4. **No regressions (SC-005)**: `parsing-corpus.test.ts`, parsing goldens, `depth-folding-*` worlds,
   spec-kitty/spec-superpower suites, and discovery suites pass with **unchanged** expectations — the
   intentional flat-board folding of orphans under real `## 9.0:`-style task headings is preserved.

## Fix-run identity note (users of the broken shape)

On the first sync after the fix, tasks previously hidden inside the giant issue get corrected seeds
(the title task loses its bogus `Implementation` id; `4.1`–`4.3` gain real local ids). They therefore
create fresh issues, and the old giant `Plan` issue is no longer matched by any task — delete it
manually in Linear or let the stale-issue report surface it. Subsequent re-runs are idempotent
(0 creates / 0 updates on unchanged input).

## Exit criteria

All four test tiers, lint, type-check, and build pass; the contract assertions above hold;
coverage stays at or above the configured threshold.
