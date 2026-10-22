# Quickstart: Validating Task-to-Issue Matching and Confidence

Validation guide for `specs/006-task-issue-matching` — proves the feature works end-to-end
without implementing anything ahead of `tasks.md`. Entity details: [data-model.md](./data-model.md);
rules: [contracts/](./contracts/README.md); frozen shapes:
[`specs/002-core-domain-contracts/`](../002-core-domain-contracts/).

## Prerequisites

- Node.js ≥ 20.0.0; npm with a lockfile (`npm ci`).
- **No Linear credentials, no network, no real organization identifiers anywhere** — the
  whole feature is pure; integration tests drive an injected in-memory fake implementing the
  frozen `LinearPort` (constitution VI: "zero real Linear API requests").
- Fixtures under `tests/fixtures/matching/` use placeholder identities only (`acme-team`,
  `proj-alpha`, `ENG`-shaped issue keys, fixed test UUIDv4s) — release-gate scan posture.
- Built output: `npm run build && npm run compile:tests` (tests import
  `task-linear-sync/matching` through the real `exports` map, 002 R2 convention).

## Test tiers

```bash
npm run test:unit -- --test-name-pattern "matching"
npm run test:contract
npm run test:integration -- --test-name-pattern "matching"
npm test   # all tiers + coverage threshold gate
```

## Validation scenarios

### US1 — Optimal, explainable one-to-one matching (Priority: P1) 🎯 MVP

Run: `npm run test:unit -- --test-name-pattern "matching"` + contract tier. Pure function,
no I/O — the spec's Independent Test: "Property-based suite over generated task/issue
corpora: assert one-to-one validity, global optimality against brute force on small cases,
deterministic tie-break stability across permutations, gate correctness, band thresholds,
and alternative ordering".

| # | Scenario (spec AC / FR) | Test | Expected |
|---|---|---|---|
| 1 | Weighted integer sum over the eight configurable signals, unbounded (AC1, FR-001) | `matching scoring` (`tests/unit/matching-scoring.test.ts`) + golden fixtures `tests/fixtures/matching/scoring-goldens.json` | Each pair's `score` = exact integer sum over the signal table (confidence-scoring.md §1), incl. fuzzy `round(titleTokenOverlap × overlapRatio)`; overriding weights via `MatchingWeightOverrides` changes totals; frozen `scoringWeights` honored |
| 2 | Exactly one band from floors; selectable ≥ plausible floor (AC2, FR-002) | `matching bands` (`tests/unit/matching-bands.test.ts`) | score ≥ 50 → high-or-medium; 18 ≤ score < 50 → low; < 18 → unmatched; sub-plausible candidates never selected; exactly one band per emitted match |
| 3 | Container gating of non-durable candidates (AC3, FR-003) | `matching gating` (`tests/unit/matching-gating.test.ts`) | differing team, project, or (both-known) framework ⇒ candidate "excluded entirely" from selection; unknown task side ⇒ skip; unknown candidate framework ⇒ no framework gate |
| 4 | Maximum-weight one-to-one, deterministic (AC4, FR-004, SC-003) | `matching assignment` (`tests/unit/matching-assignment.test.ts`) | one-to-one validity on every corpus; total weight = brute-force optimum in 100% of ≤ 8×8 exhaustive corpora (SC-003) |
| 5 | Byte-for-byte determinism incl. permutations (AC4, SC-002) | `matching determinism` (`tests/contract/matching-api.test.ts`, `tests/unit/matching-serialize.test.ts`) | two consecutive runs + 100 randomized seeded fixtures (`tests/helpers/matching-corpus.ts`): `serializeMatchingResult` byte-identical across runs and input permutations (SC-002) |
| 6 | Sub-margin high match downgrades (AC5, FR-005) | `matching margin downgrade` (`tests/unit/matching-bands.test.ts`) | high non-durable match with `margin < minimumMatchMargin` (default 10) ⇒ `medium` + recorded `ambiguous-margin` reason; margin ≥ minimum stays `high` |
| 7 | ≤3 ranked alternatives, mapped/unmapped (AC6, FR-006) | `matching alternatives` (`tests/unit/matching-alternatives.test.ts`) | ≤ 3 alternatives per match, descending score, tie-break by `issueId`, each annotated `mapped`/`unmapped` per the final assignment; ordering stable across permutations |
| 8 | Empty candidate pool | `matching empty pool` (in `tests/unit/matching-orchestrator.test.ts`) | every task in `unresolved` with `band: "unmatched"`; output still deterministic |

### US2 — Durable identity wins (Priority: P2)

Run: `npm run test:unit -- --test-name-pattern "matching-durable|matching-integrity"` +
`npm run test:integration -- --test-name-pattern "matching"`. Independent Test: "Fixture set
of issues relocated across teams/projects/frameworks and renamed, carrying canonical
attachment identity; assert 100% pairing survival and zero gating exclusions for durable
candidates."

| # | Scenario (spec AC / FR) | Test | Expected |
|---|---|---|---|
| 1 | Durable pairs bypass gating and downgrade (AC1) | `matching-durable bypass` (`tests/unit/matching-durable.test.ts`) + fixtures `tests/fixtures/matching/moved/*.json` | candidates with the task's UUID in the page-0 attachment payload match across differing team/project/framework and with renamed titles; zero gating exclusions for durable candidates; no `ambiguous-margin` downgrade applies |
| 2 | Duplicate task UUID across issues aborts (AC2) | `matching-integrity` (`tests/unit/matching-integrity.test.ts`) + `tests/fixtures/matching/dup-uuid/*.json` | `DurableIdentityCollisionError` names the `taskUuid` and ALL conflicting issue ids sorted; no `MatchingResult` produced ("abort, no changes" — structural, constitution II) |
| 3 | Projection reads identity strictly from page-0 attachment metadata | `matching projection` (`tests/unit/matching-projection.test.ts`) | canonical-URL attachment + namespace-key payload ⇒ `durableTaskUuid`; continuation pages, description-embedded UUIDs, and other metadata keys set nothing; malformed payload ⇒ non-durable |
| 4 | Integration over the tracker fake | `matching fake pipeline` (`tests/integration/matching-fake.test.ts`) | `projectCandidates` over `listIssues`/`listAttachments` from `tests/helpers/matching-linear-fake.ts` equals fixture projections; zero mutating port calls recorded (fake-vs-frozen-port shape conformance) |

### Cross-cutting outcomes (SCs)

| # | Outcome | Test | Expected |
|---|---|---|---|
| SC-001 | 100-task fixture with renames, moves, checkbox flips: ≥95% pairing survival across re-runs; 100% durable pairs survive title/container changes without orphaning | `matching pairing survival` (`tests/integration/matching-pairing-survival.test.ts`, corpus seeded) | thresholds met on seeded corpora (`tests/helpers/matching-corpus.ts`) |
| SC-002 | Byte-for-byte identical assignment across 100 randomized fixtures | `matching determinism` (US1 #5) | 100/100 byte-identical |
| SC-003 | Weight = brute-force optimum on ≤8×8 exhaustive corpora | `matching assignment` (US1 #4) | 100% equality |

## Guard checks (parallel-safety)

- **Frozen contracts untouched**: `npm run test:contract` keeps 002's
  `frozen-surface.test.ts` green with **zero** edits to `src/domain|config|state|urls|gates|ports`
  or `specs/002-core-domain-contracts/`; `git diff --name-only main..HEAD` contains only
  `specs/006-task-issue-matching/**`, `src/matching/**`,
  `tests/{unit,contract,integration,helpers,fixtures}/**matching**`-owned files, and the
  single additive `"./matching"` line block in `package.json`.
- **No sibling imports**: `src/matching/**` imports only
  `task-linear-sync/{domain,config,urls,ports}` (types) and Node built-ins — no
  `src/discovery|parsing|routing|tracker` (enforced by grep-based contract check).

## Exit criteria for this feature

All US1 + US2 scenarios green; SC-001–003 green; guard checks green; `npm test` passes with
coverage at/above the configured threshold; quickstart traceability table above maps every
FR-001…FR-006 and SC-001…SC-003 to ≥1 automated test (constitution VI).
