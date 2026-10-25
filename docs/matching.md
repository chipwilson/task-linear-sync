# Task ↔ Issue Matching (`task-linear-sync/matching`)

Feature 006 — deterministic, explainable, one-to-one matching between locally parsed
tasks and already-fetched tracker issues, plus the confidence bands the plan/report
surfaces consume. The module is **pure**: zero I/O, zero tracker calls, zero writes, no
clock, no environment reads. Candidate issues arrive pre-scoped from the tracker port
(feature 007); routing arrives as frozen `RoutingResolution` **values** (feature 005).
Matching never fetches and never mutates.

```ts
import {
  projectCandidates,
  matchAllTasks,
  serializeMatchingResult,
} from "task-linear-sync/matching";
```

## Usage

```ts
import { loadConfig } from "task-linear-sync/config";
import {
  matchAllTasks,
  projectCandidates,
  serializeMatchingResult,
} from "task-linear-sync/matching";
import type { IssueView, AttachmentView } from "task-linear-sync/ports";

const config = loadConfig({}); // or loadConfig({ overrides: { minimumMatchMargin: 20 } })

// 1. Project fetched tracker views into candidates. Identity comes ONLY from a
//    canonical page-0 attachment whose payload parses (see "Integrity abort" below).
const attachmentsByIssue: Record<string, readonly AttachmentView[]> = {
  /* issueId → attachments, e.g. collected via LinearPort.listAttachments */
};
const issues: readonly IssueView[] = [/* 007-scoped inventory */];
const candidates = projectCandidates({ issues, attachmentsByIssue, config });

// 2. Match. Routing enters as data; omit it (or mark `unassigned: true`) and the
//    team/project gates are skipped for that task.
const result = matchAllTasks(
  [{ task, routing: { teamKey: "ACME-TEAM", project: "ACME-PROJECT", defaulted: false } }],
  candidates,
  config,
);

// 3. Serialize the SC-002 byte-identity artifact (stable-key-sorted canonical JSON).
const bytes = serializeMatchingResult(result);
```

`matchAllTasks(tasks, candidates, config, weightOverrides?)` returns a `MatchingResult`:

- `matches` — frozen `Match` records (`taskUuid`, `issueId`, `score`, `margin`,
  `confidence`, `durableIdentity`, `reasons`, `alternatives`), ordered by `taskUuid`;
- `unresolved` — one `UnresolvedTask` per unmatched task, `band: "unmatched"`, plus the
  `bestScore` diagnostic (best usable total, absent when nothing was usable);
- `unmappedIssues` — every candidate `issueId` not selected, sorted (drift input for 013).

## Signals and weight resolution (FR-001)

Scores are unbounded weighted **integer** sums; title credit is awarded in the
**strictest satisfied form only** (exact, else contained, else fuzzy):

| Signal | Award condition | Weight | Reason label |
| --- | --- | --- | --- |
| durable identity | `task.stableUuid === candidate.durableTaskUuid` | `scoringWeights.durableUuid` (1000) | `durable-uuid` |
| existing issue reference | `task.issueRef.number` = numeric suffix of `issueKey` | `scoringWeights.issueRefExact` (500) | `issue-ref-exact` |
| local task ID | both sides carry `localTaskId`, byte-equal | `max(1, round(0.5 × issueRefExact))` → 250 | `local-task-id` |
| exact normalized title | normalized titles equal | `scoringWeights.titleExact` (60) | `title-exact` |
| contained normalized title | one token list is a contiguous subsequence of the other | `round(0.65 × titleExact)` → 39 | `title-contained` |
| fuzzy title similarity | always evaluated (Dice over normalized tokens) | `round(titleTokenOverlap × overlapRatio)` | `title-fuzzy` |
| same-project | task routed project known and equals `candidate.projectRef` | 10 | `same-project` |
| same-framework | both sides carry a known `Framework_Id` and they are equal | 10 | `same-framework` |

Normalization: visible-prefix strip → conditional `<featureName>: ` strip → NFKC →
casefold → whitespace collapse.

**Derived weights / overrides.** Four signals have no dedicated key in the frozen
`ScoringWeights` (002 FR-008 freeze). Their weights resolve from the documented
001-R5-derived ratios above, and every one of them is overridable at the call boundary:

```ts
matchAllTasks(tasks, candidates, config, {
  localTaskId: 120,
  titleContainedRatio: 0.5, // contained = round(ratio × titleExact)
  sameProject: 15,
  sameFramework: 5,
});
```

Maintainers: the recommended amendment (add `localTaskId`, `titleContained`,
`sameProject`, `sameFramework` keys to `ScoringWeights` via the FR-008 process in
`docs/contract-amendments.md`) is recorded in `specs/006-task-issue-matching/plan.md`
“Complexity Tracking”; the derived values above are designed to become the initial
values, so the amendment is behavior-preserving.

## Gating (FR-003) and selectability (FR-002)

Non-durable candidates are excluded **entirely** from selection when the task's routed
team ≠ `candidate.teamKey`, the routed project ≠ `candidate.projectRef`, or both sides
carry a known framework and they differ. Missing routing (or `unassigned: true`) skips
the team/project gates; an unknown candidate framework skips the framework gate.
Selectability additionally requires `total ≥ confidenceFloors.plausible` (18). Exclusions
are recorded machine-readably (`gated-team`, `gated-project`, `gated-framework`,
`below-plausible`) and gated/below-plausible candidates may still surface as
alternatives — never as selections.

**Durable bypass (constitution II).** A durable-identity match bypasses team/project/
framework gating **and** the margin downgrade, "so an issue moved or renamed across
containers is never orphaned" — durable pairs carry zero gating exclusions.

## Assignment (FR-004) and determinism

A Jonker–Volgenant Hungarian LAP over the integer usable-pair matrix solves the
maximum-weight one-to-one assignment (each task ≤ 1 issue, each issue ≤ 1 task);
weight-0 dummy cells mean "unmatched". Inputs are canonically pre-sorted (`stableUuid`,
`issueId`) and a post-solve pass selects the **lexicographically-smallest optimal**
matching, so equal optima resolve identically across input permutations. Property
suites prove: one-to-one validity, total = brute-force optimum on ≤8×8 corpora
(SC-003, 150/150), and byte-identical `serializeMatchingResult` output across 100
randomized fixtures and permutations (SC-002).

## Banding and the margin downgrade (FR-002, FR-005)

For a selected pair: `total ≥ confidenceFloors.medium` (50) ⇒ `high`, else `low`
(selected pairs are ≥ plausible by construction); unresolved tasks are `"unmatched"`.
`margin = total − max(best usable rival of the task, best usable rival of the issue)`
(0 when contested beyond the pair's own score). A `high` **non-durable** match with
`margin < minimumMatchMargin` (default 10) downgrades to `medium` and records the
`ambiguous-margin` reason; durable matches never downgrade.

## Integrity abort (constitution II)

`projectCandidates` runs a durable-identity scan before anything escapes to scoring:

- one task UUID carried by ≥ 2 issues, or
- one issue carrying contradictory anchors (≥ 2 qualifying task UUIDs),

aborts the projection with `DurableIdentityCollisionError { taskUuid, issueIds }` — the
lexicographically-smallest offending `taskUuid` named first with ALL its conflicting
issue ids sorted. Because the module is pure and the scan structural, "abort the run,
apply no changes" holds by construction and no configuration can sidestep the throw.
`MatchingConfigError` (invalid matching-slice config) is the module's only other abort.

## Validation & traceability (T039)

| Requirement | Scenario | Where verified | Result |
| --- | --- | --- | --- |
| FR-001 / SC table | US1 #1 eight-signal integer sum | `tests/unit/matching-scoring.test.ts` + `tests/fixtures/matching/scoring-goldens.json` | ✅ |
| FR-002 | US1 #2 bands + plausible floor | `tests/unit/matching-bands.test.ts` | ✅ |
| FR-003 | US1 #3 container gating | `tests/unit/matching-gating.test.ts` | ✅ |
| FR-004 | US1 #4 one-to-one optimum | `tests/unit/matching-assignment.test.ts` (SC-003: 150/150 ≤8×8 vs brute force) | ✅ |
| FR-004 | US1 #5 determinism | `tests/unit/matching-serialize.test.ts` + contract suite (SC-002: 100/100 fixtures, byte-identical incl. permutations) | ✅ |
| FR-005 | US1 #6 margin downgrade | `tests/unit/matching-bands.test.ts` | ✅ |
| FR-006 | US1 #7 alternatives ≤3, mapped flags | `tests/unit/matching-alternatives.test.ts` | ✅ |
| FR-002 edge | US1 #8 empty pool | `tests/unit/matching-orchestrator.test.ts` | ✅ |
| FR-007 (durable wins) | US2 #1 bypass + survival | `tests/unit/matching-durable.test.ts`, `tests/integration/matching-durable-fixtures.test.ts` (100% durable pairing survives moves+renames; zero exclusions) | ✅ |
| FR-008 (abort) | US2 #2 duplicate UUID abort | `tests/unit/matching-integrity.test.ts` + `tests/fixtures/matching/dup-uuid/*` (case a + case b) | ✅ |
| — | US2 #3 strict page-0 identity projection | `tests/unit/matching-projection.test.ts` | ✅ |
| — | US2 #4 fake pipeline | `tests/integration/matching-fake.test.ts` (projection parity, zero mutating port calls) | ✅ |
| SC-001 | survival thresholds | `tests/integration/matching-pairing-survival.test.ts` (≥95% overall; 100% durable) | ✅ |
| SC-002 | byte-identity | US1 #5 rows above | ✅ |
| SC-003 | brute-force equality | US1 #4 rows above | ✅ |
| Purity / parallel safety | guard checks | `tests/contract/matching-api.test.ts` (banned-token greps, import whitelist, surface snapshot) + `git diff --name-only main..HEAD` audit (T038) | ✅ |
