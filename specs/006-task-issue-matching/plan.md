# Implementation Plan: Task-to-Issue Matching and Confidence

**Branch**: `006-task-issue-matching` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-task-issue-matching/spec.md`

**Frozen-contract baseline**: 002 (`specs/002-core-domain-contracts/`) — entities
`src/domain/task.ts` + `src/domain/match.ts` + `src/domain/routing.ts` +
`src/domain/state-payload.ts`, config model `src/config/*` (incl. frozen matching keys
`scoringWeights` / `confidenceFloors { medium: 50, plausible: 18 }` / `minimumMatchMargin: 10`),
tracker port `src/ports/linear-port.ts` (`IssueView`, `AttachmentView`, `LinearPort`), and
`src/urls/attachment-url.ts` (`canonicalAttachmentUrl`, `parseAttachmentUrl`). This feature
imports those subpath exports and NEVER redefines or edits them (002 FR-008: "any change to a
frozen contract MUST be treated as a constitution-governed cross-feature amendment, not a
private change"; ROADMAP rule 2).

## Summary

006 is the scoring brain: a **pure, deterministic, zero-I/O function** over the frozen 002
entity shapes that turns tasks (with routing inputs produced by 005, received as data) and
candidate issues (projected from the tracker-port view shapes 007 will populate) into a
globally optimal, one-to-one task↔issue assignment. Concretely: weighted integer signal
scoring (FR-001), confidence banding from the frozen floor thresholds with plausible-floor
selectability (FR-002), container gating of non-durable candidates (FR-003), a
maximum-weight bipartite assignment with deterministic tie-breaks (FR-004), margin-based
ambiguity downgrade (FR-005), and ≤3 ranked alternatives per match (FR-006) — with durable
identity outranking everything, bypassing gating and downgrade, and duplicate durable UUIDs
aborting the run (constitution Principle II). The module lands in `src/matching/`, disjoint
from 003/004/005/007, and is validated hermetically: unit + property tests for the pure core,
contract tests over the exported surface, and integration tests against an in-memory fake
implementing the frozen `LinearPort` (zero real requests).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`), ESM output with generated `.d.ts`;
Node.js ≥ 20.0.0 (constitution "Technology stack")

**Primary Dependencies**: None new. Node built-ins only (`node:assert`, `node:test` in tests).
No transport dependency belongs in 006 — spec: "A pure function over the 002 entity shapes —
no tracker calls, no file writes". The real tracker integration is 007's; 006 consumes only
frozen `src/ports` *types* and test-time fakes it owns.

**Storage**: N/A — pure in-memory computation; zero filesystem, zero network (the engine
layer that injects inputs is 008).

**Testing**: `node:test` + `node:assert/strict` against compiled output (002 research R2
convention); tiers `unit` / `contract` / `integration` (+ property-based suites with seeded
deterministic PRNGs — constitution VI: "Property-based, contract (fake-versus-real
`Linear_Port`), and security tests are required cross-cutting types"). Integration tier uses
an in-memory fake implementing the frozen `LinearPort` interface, owned by 006's test tree.

**Target Platform**: Node.js ≥ 20; consumed as subpath `task-linear-sync/matching` by 008
(assignment to apply), 009 (per-task decision fields), 013 (drift/unmapped classification
inputs) in Wave 3/4.

**Project Type**: Single npm package (shared repo); this feature owns `src/matching/` and its
test files. One additive shared-file edit: a `"./matching"` entry in `package.json` `exports`
(see research R10; disjoint-module safety rules noted there).

**Performance Goals**: 100 tasks × 100 candidates score + assign in < 100 ms (spec fixtures
are 100-task; O(n·m) scoring + O(n³) assignment where n = max(|tasks|, |issues|)). No
network paths exist.

**Constraints**: Determinism per constitution Principle IV ("one-to-one match assignment with
deterministic tie-breaks, confidence banding … MUST produce byte-for-byte identical results");
byte-for-byte re-run identity across input permutations (SC-002); weights/floors/margin come
from the frozen config (Principle III); zero real organization identifiers or UUIDs in shipped
fixtures; no imports from `src/discovery|parsing|routing|tracker` (003/004/005/007) — 005's
routing output enters as the frozen `RoutingResolution` **value**, never as an import.

**Scale/Scope**: 6 FRs (001 FR-027–032), 2 user stories, 3 SCs; ~11 new `src/matching/`
modules; ~20 test files under `tests/{unit,contract,integration,helpers,fixtures}/matching*`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for this feature | Status |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | Matching performs zero tracker mutations and zero file writes — it is pure over injected data; the accept-low-confidence gate consumes 006's `confidence` band downstream (008), 006 itself gates nothing mutating. Integration test asserts zero mutating port calls on any 006-reachable path. | PASS |
| II. Durable Identity | Durable-identity match from page-0 canonical attachment metadata is the top signal; durable candidates bypass team/project/framework gating and margin downgrade; >1 issue carrying the same task UUID aborts with a hard integrity failure (typed error listing the UUID and every conflicting issue id) and zero matches emitted. Identity is read via the frozen URL scheme + payload parser — never from issue descriptions or in-file markers. | PASS |
| III. Intelligent Defaults, Overridable Configuration | All matching config is read from the frozen `ResolvedConfig` (`scoringWeights`, `confidenceFloors { medium: 50, plausible: 18 }`, `minimumMatchMargin: 10`); no defaults are re-defined by 006. Four FR-001 signals have no dedicated frozen weight key; their weights resolve from documented 001-R5-derived ratios plus a programmatic override parameter until a cross-feature amendment adds keys — partial compliance, justified in Complexity Tracking. | PARTIAL — justified |
| IV. Determinism and Idempotency | Canonical input ordering (task `stableUuid`, issue `id`), deterministic tie-breaks in scoring accumulation, assignment selection, banding, and alternatives ordering; property test: shuffled input permutations produce byte-identical canonicalized results (SC-002). No wall-clock reads, no `Math.random` outside seeded test PRNGs. | PASS |
| V. One Engine, Additive Surfaces | 006 exports a pure capability the engine composes; it introduces no gate, no port, no surface of its own, and receives candidate data that flows through the injectable `LinearPort` upstream. No divergent path is added. | PASS |
| VI. Test-First and Quality Gates (NON-NEGOTIABLE) | Every FR and every acceptance scenario maps to ≥1 automated test (quickstart traceability table); test-first tasks in `tasks.md`; property-based optimality (brute-force ≤8×8, SC-003) and determinism (SC-002) suites; fake-`Linear_Port` integration tier with zero real requests. | PASS |
| Additional constraints | Node built-ins only; zero org literals in defaults/fixtures (fixture scan reuses the 002 defaults-scan posture); ESM + declarations via the shared build; matching fixtures use placeholder identities (`acme-team`, `proj-alpha`, UUIDv4-shaped test constants). | PASS |
| Development workflow / quality gates | `tsc` typecheck, lint, full `node:test` suite wired via existing scripts; no new pipeline needs (pure module). | PASS |

**Pre-research gate result: PASS with one justified PARTIAL (Principle III, Complexity
Tracking below).** No NEEDS CLARIFICATION items block research; open design questions are
resolved in [research.md](./research.md) (R1–R10).

## Project Structure

### Documentation (this feature)

```text
specs/006-task-issue-matching/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── README.md                # index + frozen-contract consumption table
│   ├── matching-api.md          # exported entry points + result invariants
│   ├── confidence-scoring.md    # signal registry, banding, margin, alternatives rules
│   └── candidate-projection.md  # durable detection, integrity scan, gating-input contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/matching/                    # 006-owned module (disjoint from 003/004/005/007)
├── index.ts                     # subpath barrel — task-linear-sync/matching
├── types.ts                     # 006-local entities composing frozen shapes (data-model.md)
├── errors.ts                    # MatchingConfigError, DurableIdentityCollisionError
├── config-check.ts              # defensive validation of the frozen matching config slice
├── normalize.ts                 # deterministic title normalization + tokenization
├── projection.ts                # IssueView/AttachmentView → MatchCandidate + integrity scan
├── scoring.ts                   # FR-001 weighted integer signal sums (signal registry)
├── gating.ts                    # FR-003 container gating + FR-002 plausible-floor usability
├── assignment.ts                # FR-004 maximum-weight one-to-one solver w/ deterministic
│                                #   tie-breaks (Jonker–Volgenant variant, forbidden cells)
├── bands.ts                     # FR-002 banding + FR-005 margin downgrade (durable bypass)
├── serialize.ts                 # canonical stable-key JSON of MatchingResult (SC-002)
└── matching.ts                  # matchAllTasks orchestrator (margins, alternatives, FR-006)

package.json                     # ONE additive exports entry "./matching" (research R10)

tests/
├── unit/                        # matching-config, -normalize, -projection, -scoring,
│                                #   -gating, -bands, -assignment, -durable, -integrity,
│                                #   -alternatives, -serialize (all 006-owned new files)
├── contract/
│   └── matching-api.test.ts     # exported-surface + result-invariant contract of 006 itself
├── integration/
│   └── matching-fake.test.ts    # projection + pipeline over the in-memory Linear_Port fake
├── helpers/
│   ├── matching-linear-fake.ts  # 006-owned fake implementing the FROZEN LinearPort
│   │                            #   (records calls; 007 owns the production fake — no import)
│   └── matching-corpus.ts       # seeded deterministic corpus generator (property tests)
└── fixtures/matching/           # JSON corpora: scoring goldens, moved/renamed durable set,
                                 #   duplicate-uuid set, 100-task survival fixture — placeholder
                                 #   identities only
```

**Structure Decision**: Single npm package; 006 adds exactly one sibling module,
`src/matching/`, per 002 plan.md ("Wave-2+ features add sibling modules (`src/discovery`,
`src/parsing`, `src/routing`, `src/matching`, …) against these modules and import them only
through this package's declared subpath exports"). 006 imports
`task-linear-sync/{domain,config,ports,urls}` only — never `src/discovery|parsing|routing|tracker`
and never 005 internals; 005's gating inputs enter the API as plain `RoutingResolution`
values (fixtures in tests). 006 does NOT edit `src/index.ts` or any frozen module; the only
shared-file edit is one additive `package.json` `exports` key (research R10). The 002
frozen-surface contract snapshot (`tests/contract/frozen-surface.test.ts`) stays untouched —
006 adds no exports to frozen modules.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle III partial: 4 of the 8 FR-001 signals (local-task-ID match, contained normalized title, same-project alignment, same-framework alignment) have no dedicated key in the frozen `ScoringWeights` (its keys are `durableUuid`, `issueRefExact`, `titleExact`, `titleTokenOverlap`, `featureNameMatch`, `filePathProximity`, `samePhase`, `kindMatch`) | FR-001 (001 FR-027) normatively lists those 8 signals; the 002 weight surface is frozen and may change only by cross-feature amendment (002 FR-008), which the ROADMAP declares out of scope for 006. 006 resolves the 4 orphan signals' weights from documented ratios of the normative 001 R5 defaults (research R1) and exposes a programmatic `MatchingWeightOverrides` parameter so every weight remains overridable at the call boundary. | Editing `src/config/schema.ts`/`defaults.ts` to add keys was rejected: it breaks the frozen contract and 002's frozen-surface snapshot without an amendment noted against 001. Silently dropping the 4 signals was rejected: it would violate FR-001's normative signal list. |

Recommended amendment (out of 006's scope, noted for maintainers): add `localTaskId`,
`titleContained`, `sameProject`, `sameFramework` keys to `ScoringWeights` via the FR-008
process; 006's derived-ratio defaults are designed to become the initial values, so the
amendment is behavior-preserving.

---

**Post-Phase-1 re-check (after research.md, data-model.md, contracts/, quickstart.md)**: all
gates above still PASS/PARTIAL-as-justified. The design adds no dependencies, no I/O, no
mutations, no frozen-contract edits, no new gates or surfaces; the Principle III partial is
unchanged and fully justified in Complexity Tracking; every spec SC (determinism, optimality,
pairing survival) has a named validation scenario in quickstart.md. Re-check result: **PASS**.
