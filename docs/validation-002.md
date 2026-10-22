# Validation record — feature 002-core-domain-contracts

Executed 2026-10-22 against commit range implementing `specs/002-core-domain-contracts/tasks.md`
(Node v22.14.0, Linux x64, non-root; CI matrix additionally validates the engines floor on
Node 20 — its runner supports no `--test-coverage-*` threshold options and its experimental
coverage reporter crashes on child-process coverage, so `scripts/run-tests.mjs` probes flag
support at runtime and runs that leg WITHOUT coverage instrumentation; the threshold gate is
enforced on the modern-runner leg). Full suite: **111 tests,
0 failures**; coverage
lines 94.21% / branches 89.13% / functions 98.89% (gate: 80/70/80). Lint and typecheck
clean.

## Quickstart validation checklist

### US1 — Zero-surprise configuration

| # | Scenario | Test(s) | Result |
| --- | --- | --- | --- |
| 1 | Deep-merge precedence, deterministic result | `config precedence` (integration) + `canonicalizeConfig` repeat-run byte compare (unit) | PASS — higher layer wins per key, absent keys retained, byte-identical canonical output ×5 |
| 2 | Missing / unreadable / invalid JSON aborts | `config file failures — …` (7 unit tests) | PASS — each category names file path + category; no partial config applied |
| 3 | Missing required identity aborts completely | `required identities — …` (6 unit) + fixture aborts (integration) | PASS — every missing value named simultaneously (teams, per-team projects/workflowStates, per-entry teamKey/project, defaults) |
| 4 | Defaults scan | `defaults scan — …` (7 contract tests) | PASS — no UUID/token/secret/email shapes; hosts only `*.example.invalid`; routing empty |

Run commands: `npm run test:integration -- --test-name-pattern "config"` → 19/19 pass;
`npm run test:contract` → 17/17 pass.

### US2 — Isolated, safe run state

| # | Scenario | Test(s) | Result |
| --- | --- | --- | --- |
| 1 | Default placement | `state placement — hash16 naming…` | PASS — `<platform-base>/task-linear-sync/<sha16>`, distinct per repo fixture, configured dir verbatim |
| 1b | In-tree refusal | `state placement — … inside/equal repo aborts`, `… ZERO files … walk` | PASS — `StatePlacementError`; post-lifecycle walk of both repos finds 0 created entries |
| 2 | Manifest expiry | `manifest expiry (FR-002)` — encryption on AND off | PASS — +31d expired, exactly-30d valid (strict `>`), +30d+1ms expired |
| 3 | Stale lock takeover | `lock matrix — …` (7 unit) + `state lock matrix race` (3 integration, spawned children) | PASS — live pid refuse; dead <60s refuse; dead >60s takeover; exactly one winner in two-process race (24/24 stress runs) |
| 4 | Create-intent before attempt | `create intent before attempt: …` | PASS — `intents/<id>.json` on disk (mode 0600) when the promise resolves, `status: "pending"` |
| 5 | Reports + last-run marker | `run reports + last-run marker`, `run reports are sanitized`, `run reports refusal` | PASS — paired artifacts under `reports/<runId>/`, marker references them; SECRET material redacted; blocking/secret-keyed content refuses with zero writes |
| 6 | Permissions & atomicity | `state fs — …` (6 unit) + placement modes test | PASS — dirs 0700, files 0600; concurrent reader observed old-or-new only (0 torn reads) |

Run commands: `npm run test:integration -- --test-name-pattern "state"` → 19/19 pass.

### Contract-freeze validation (FR-008)

| # | Check | Result |
| --- | --- | --- |
| 1 | Exported-surface snapshots (`frozen-surface.test.ts` vs `tests/contract/snapshots/frozen-surface.json`) | PASS — all 22 frozen modules; drift fails with per-module ADDED/REMOVED lists |
| 2 | Report schema conformance (`report-schema.test.ts`, `additionalProperties: false` + raw-text property scan) | PASS — valid fixture conforms; `description` property and missing fields rejected |
| 3 | URL scheme round-trip (canonical + pages 1..10, default + overridden templates, page-0 never appears) | PASS |
| 4 | Plan-reference predicate (valid / `PLAN_REFERENCE_STALE` on single-byte or HEAD drift / `PLAN_REFERENCE_UNKNOWN`) | PASS |

### Gate sanity (types as tests)

`npm run typecheck` compiles `tests/types/negative.test-d.ts`: `applySyncPlan` requires a
full `GateRequest` (missing/partial/wrong-typed arguments are compile errors);
`EngineDependencies` accepts only a `LinearPort` tracker dependency (object literal and
omission both rejected); `Plan`/`ApplyResult`/`BuildPlanOptions` expose no mutation
surface; `PlanTaskEntry`/`SyncStatePayload`/`Match` carry no raw
description/body/content keys. PASS — every `@ts-expect-error` consumed.

## Success-criteria traceability

| SC | Evidence | Result |
| --- | --- | --- |
| SC-001 | `config SC-001` repeat-run byte-compare; `canonicalizeConfig` sorted-key determinism; canonical URL + planId determinism in e2e | ✅ 0 diffs across repeats |
| SC-002 | All 3 file categories + identity fixtures abort naming path/category or every missing value; `no partial configuration` test proves file value 999 never leaks | ✅ 100% of misconfiguration fixtures abort |
| SC-003 | Full-lifecycle walk of both fixture repos = 0 created entries (placement test + e2e repo listing) | ✅ 0 in-tree writes |
| SC-004 | Lock matrix: live process (own pid AND EPERM probe pid 1) never loses the lock; aged dead-pid lock always recoverable; race: exactly one winner | ✅ 0 false takeovers, 0 stuck runs |

## Exit criteria (quickstart)

- `npm run build` → dist ESM + per-module `.d.ts` (+ declaration maps) ✅
- `exports`/`types` resolve for root + all six subpaths (`package-surface.test.ts`) ✅
- `npm test` all tiers green with coverage threshold gate ✅
- `npm run typecheck` / `npm run lint` green ✅

## Amendment note

One implementation deviation from tasks.md wording: the two-process race test asserts
exactly-one-winner + loser refusal; the `tookOverStale` flag is asserted in the
deterministic unit lock matrix because either contender may legitimately perform the
stale-record unlink first (the winner then acquires cleanly). No contract surface
touched; snapshot unchanged.
