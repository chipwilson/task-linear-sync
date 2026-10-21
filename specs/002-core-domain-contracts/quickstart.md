# Quickstart: Validating Core Domain Contracts, Configuration, and Run State

Validation guide for `specs/002-core-domain-contracts` — proves the feature works end-to-end
without implementing anything ahead of `tasks.md`. Field details:
[data-model.md](./data-model.md); contract details: [contracts/](./contracts/README.md).

## Prerequisites

- Node.js ≥ 20.0.0 (constitution engine floor; the package errors below 20 with the minimum
  version named).
- npm with a lockfile (`package-lock.json` committed; pipeline installs with `npm ci`).
- No Linear credentials, no network access, no real organization identifiers anywhere in
  fixtures (Constitution VI / hermetic pipelines). All fixtures live under
  `tests/fixtures/` and use placeholder identities (`acme-team`, `proj-alpha`, …).

## Setup

```bash
npm ci
npm run build          # tsc: ESM + .d.ts per exported module
npm run typecheck      # tsc --noEmit over tests too
```

## Test tiers

```bash
npm run test:unit        # node:test tests/unit
npm run test:contract    # frozen-surface snapshots + defaults scan + schema checks
npm run test:integration # tests/integration (config + state fixtures)
npm run test:e2e         # tests/e2e (user-story walkthroughs, still zero network)
npm test                 # all tiers + coverage threshold gate
```

## Validation scenarios

### US1 — Zero-surprise configuration (P1)

Run: `npm run test:integration -- --test-name-pattern "config"`

Fixtures under `tests/fixtures/config/`: layered defaults+JSON-file+overrides sets
(overlapping and disjoint keys), invalid-file set, missing-identity set.

| # | Scenario (spec AC) | Command / test | Expected |
|---|---|---|---|
| 1 | Deep-merge precedence, deterministic result | `config precedence` unit + repeat-run byte compare | Higher layer wins per key; absent keys retained; `canonicalizeConfig` byte-identical across runs (SC-001) |
| 2 | Missing / unreadable / invalid JSON file aborts | `config file failures` | Abort names file path + category (`missing`/`unreadable`/`invalid-json`); zero partial config from that file applied (SC-002) |
| 3 | Missing required identity aborts completely | `required identities` | Error lists **every** missing value (teams, per-team projects, per-team workflow states, routing entries with missing `teamKey`/`project`, default team/project) simultaneously (FR-007) |
| 4 | Defaults scan | `npm run test:contract` → `defaults scan` | No UUID-shaped/`lin_api_`/secret/email-shaped values in built-in defaults; benign placeholder base host only |

### US2 — Isolated, safe run state (P2)

Run: `npm run test:integration -- --test-name-pattern "state"`

Fixtures: two fake repository roots (`repo-a`, `repo-b`, one nested), injected clock,
spawned child processes for the lock race.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Default placement | `state placement` | `<platform-base>/task-linear-sync/<sha16>`; `<sha16>` = first 16 hex of sha256(canonical root); distinct per repo fixture; configured `stateDirectory` used verbatim (FR-001) |
| 1b | In-tree refusal | `state placement` | Configured path inside/equal repo root aborts `StatePlacementError`; post-run walk of both fixture repos finds **0** created files/dirs (SC-003, edge case) |
| 2 | Manifest expiry | `manifest expiry` | Aged manifest (clock +31d) expired with encryption **on and off**; ≤30d valid (FR-002) |
| 3 | Stale lock takeover | `lock matrix` | Live pid → refuse; dead pid < 60 s → refuse; dead pid > 60 s → takeover; two-process simultaneous race → exactly one winner (FR-003, SC-004) |
| 4 | Create-intent before attempt | `create intent` | After `writeCreateIntentBeforeAttempt` resolves, `intents/<id>.json` exists on disk with `status: "pending"` (FR-004) |
| 5 | Reports + last-run marker | `run reports` | Sanitized JSON+Markdown pair under `reports/<runId>/`, `last-run.json` references the completed run, no secret-shaped strings in either artifact (FR-005) |
| 6 | Permissions & atomicity | `state fs` | Dirs `0o700`, files `0o600` (POSIX runners); concurrent reader observes old-or-new content only |

### Contract-freeze validation (FR-008)

Run: `npm run test:contract`

1. **Exported-surface snapshots**: each frozen module's export set is compared to the
   checked-in snapshot; any drift (rename, removal, signature-relevant addition) fails —
   amendments must update the snapshot deliberately with a note against 001.
2. **Report schema conformance**: report fixtures validate against
   [contracts/plan-report.schema.json](./contracts/plan-report.schema.json)
   (`additionalProperties: false`; no raw-body/description fields — SC-005 posture).
3. **URL scheme round-trip**: builder→parser identity for canonical and pages 1..10 under
   default and overridden templates
   ([contracts/attachment-url-scheme.md](./contracts/attachment-url-scheme.md)).
4. **Plan-reference predicate**: matching guards → `valid`; single-byte file drift or HEAD
   drift → `PLAN_REFERENCE_STALE`; unknown id → `PLAN_REFERENCE_UNKNOWN`
   ([contracts/engine-gates.md](./contracts/engine-gates.md)).

### Gate sanity (types as tests)

`npm run typecheck` includes `tests/types/` negative-type assertions: read-only command
result types expose no mutation surface; `applySyncPlan` requires a full `GateRequest`;
`LinearPort` is the only tracker-typed dependency injectable into engine options
(Constitution V is compile-checked where the type system can express it).

## Success-criteria traceability

| Spec SC | Proven by |
|---|---|
| SC-001 config byte-determinism | US1.1 repeat-run byte compare |
| SC-002 misconfiguration aborts, complete naming | US1.2 + US1.3 |
| SC-003 zero in-tree state files | US2.1b repo walk |
| SC-004 lock correctness (0 false takeover / 0 stuck) | US2.3 matrix + race |
| FR-001…FR-007 | US1/US2 rows above (1:1 mapped) |
| FR-008 contract freeze | contract-freeze scenarios 1–4 |

## Exit criteria for this feature

`npm test` green including coverage threshold and contract snapshots; `npm run build` emits
ESM + per-module declarations with valid `exports`/`types`; quickstart scenarios above all
observed. Wave 2 (003–007) may then start in parallel against these frozen modules.
