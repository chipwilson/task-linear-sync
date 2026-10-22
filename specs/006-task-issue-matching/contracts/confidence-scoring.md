# Contract: Confidence Scoring — Signals, Bands, Margin, Assignment, Alternatives

Modules: `src/matching/{normalize,scoring,gating,assignment,bands}.ts`. This document is the
normative detail of FR-001…FR-006 (001 FR-027–032). Constraint text quoted verbatim from
`specs/006-task-issue-matching/spec.md`, `specs/requirements.md` Requirement 5 (R5), and the
constitution appears in blockquotes — implementers honor it exactly.

## 1. Signal registry (FR-001)

> "System MUST score each task against each candidate issue as an unbounded weighted integer
> sum over configurable signals: durable identity match, existing issue reference, local
> task ID match, exact normalized title, contained normalized title, fuzzy title similarity
> (scaled token overlap), same-project alignment, and same-framework alignment." (spec FR-001)

Weight resolution per research R1 (frozen keys read from
`ResolvedConfig.scoringWeights`; derived values from the 001 R5 default ratios; override
parameter = `MatchingWeightOverrides`, data-model §5):

| Signal | Award condition | Weight | Built-in | Reason label |
|---|---|---|---|---|
| durable identity | `task.stableUuid === candidate.durableTaskUuid` | `scoringWeights.durableUuid` | 1000 | `durable-uuid` |
| existing issue reference | `task.issueRef.number ===` numeric suffix of `candidate.issueKey` | `scoringWeights.issueRefExact` | 500 | `issue-ref-exact` |
| local task ID | both carry `localTaskId` and they are byte-equal | `max(1, round(0.5 × issueRefExact))` or override | 250 | `local-task-id` |
| exact normalized title | normalized titles equal | `scoringWeights.titleExact` | 60 | `title-exact` |
| contained normalized title | one normalized token list is a contiguous subsequence of the other (not equal) | `round(titleContainedRatio × titleExact)`, `titleContainedRatio` default 0.65 | 39 | `title-contained` |
| fuzzy title similarity | always evaluated | `round(titleTokenOverlap × overlapRatio)`, Dice coefficient over normalized token multisets | ≤ 30 | `title-fuzzy` |
| same-project | task routed project known ∧ equals `candidate.projectRef` | 10 or override | 10 | `same-project` |
| same-framework | both sides carry a known `Framework_Id` and they are equal | 10 or override | 10 | `same-framework` |

Title credit: exact, else contained, else fuzzy — the strictest satisfied form only (R1);
all other signals sum independently. Integer weights, integer points (`round` half-up on the
scaled/derived values), total unbounded and ≥ 0. Normalization + tokenization exactly per
research R2 (visible-prefix strip → conditional `<featureName>: ` strip → NFKC → casefold →
whitespace collapse; Dice = `2·|common multiset| / (|A|+|B|)`, 0.0 when either side empty).

## 2. Gating and selectability (FR-002, FR-003)

> "System MUST exclude non-durable candidates whose team, project, or (when both known)
> framework differ from the task's." (spec FR-003)

- Team gate: candidate excluded when the task's routing resolves a `teamKey` ≠
  `candidate.teamKey`. Project gate: excluded when the routed project ≠
  `candidate.projectRef`. Framework gate: evaluated **only** when both `task.frameworkId`
  and `candidate.frameworkId` are known, and excludes on inequality (R5 c5: "both the task
  and issue carry a known `Framework_Id` and those framework identifiers differ").
- Task routing absent or `unassigned: true` ⇒ team/project gates skipped for that task
  (research R6 — no known difference can exist).
- **Durable bypass** (constitution II): "a durable-identity match bypasses team/project/
  framework gating and margin downgrade so an issue moved or renamed across containers is
  never orphaned." Durable pairs are never gated out.
- Selectability (FR-002): "selectable candidates are restricted to at least the
  plausible-match floor" — `PairScore.usable ⇔ total ≥ confidenceFloors.plausible ∧ not
  gated`. Below-plausible and gated-out pairs may still surface as alternatives (§5), never
  as selections.

## 3. Assignment (FR-004)

> "System MUST solve a maximum-weight one-to-one assignment (each task at most one issue,
> each issue at most one task), selecting deterministically among equally optimal solutions
> so unchanged inputs reproduce matches byte-for-byte." (spec FR-004)

Solver and tie-break rules exactly per research R4: JV/Hungarian over the integer
usable-pair matrix with forbidden sentinels for excluded cells and 0-weight dummy rows/columns
(meaning "unmatched"); pre-sort tasks by `stableUuid`, candidates by `issueId`; augmentation
prefers lowest canonical row then column; post-solve pass selects the lexicographically-smallest
optimal matching. Consequences proved by property tests: global optimality (SC-003, brute-force
≤ 8×8), permutation-invariant byte-identical output (SC-002), one-to-one validity.

## 4. Banding and ambiguity downgrade (FR-002, FR-005)

> "System MUST assign exactly one confidence band per match from {high, medium, low,
> unmatched} from the configured floor thresholds" (spec FR-002), floors frozen as
> `confidenceFloors { medium: 50, plausible: 18 }`; R5 c2: "a score at or above the medium
> floor SHALL be high or medium, a score at or above the plausible-match floor but below the
> medium floor SHALL be low, and a score below the plausible-match floor SHALL be unmatched".

> "System MUST downgrade a high-confidence non-durable match to medium, with a recorded
> ambiguity reason, when its margin to the next usable candidate is below the configured
> minimum." (spec FR-005; `minimumMatchMargin` default 10, "minimum allowed value 1")

Algorithm (data-model §7 diagram):

1. Raw band of a selected pair: `total ≥ confidenceFloors.medium` ⇒ `high`; else ⇒ `low`
   (selected pairs are already ≥ plausible).
2. Margin: `margin = total − max(next-best usable competitor of the task, best usable rival
   of the issue)` (glossary: "from both task and issue sides"); no competitor ⇒ `margin =
   total`. Integer ≥ 0.
3. Downgrade: `confidence = high ∧ !durableIdentity ∧ margin < minimumMatchMargin` ⇒
   `medium` + reason `ambiguous-margin` recorded. Durable matches never downgrade (R5 c9).
4. Unselected/unusable tasks: no `Match`; `UnresolvedTask.band = "unmatched"` (spec edge
   case: empty candidate pool ⇒ all `unmatched`, deterministic).

## 5. Alternatives (FR-006)

> "System MUST retain up to three alternative candidates per match, ordered by descending
> score with deterministic tie-breaks, each annotated mapped or unmapped." (spec FR-006;
> R5 c10)

Per emitted `Match`: alternatives = the task's highest-scoring **other** candidates (i.e.
excluding the selected issue; gated-out and below-plausible candidates included, ranked by
score), sorted by `(score descending, issueId ascending)` — the deterministic tie-break —
truncated to 3. `mapped: true` when that alternative is itself selected for some task in the
same assignment; `false` otherwise ("annotated mapped or unmapped", frozen `MatchAlternative.mapped`).

## 6. Determinism and purity clauses (constitution IV/VI)

- All orderings derive from canonical keys (`stableUuid`, `issueId`) — never input array
  order; no clock/env/random in the module.
- `serializeMatchingResult` byte-identity across runs and permutations is the enforced
  determinism artifact (SC-002, 100 randomized fixtures).
- Config validated at entry per research R9 (`MatchingConfigError`); duplicate durable UUIDs
  abort per [candidate-projection.md](./candidate-projection.md) §Integrity.
