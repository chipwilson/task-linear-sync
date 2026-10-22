# Phase 0 Research: Task-to-Issue Matching and Confidence

**Feature**: `006-task-issue-matching` | **Date**: 2026-10-22

Resolves every open question from plan.md Technical Context and the spec's Assumptions.
Normative sources, in precedence order: `.specify/memory/constitution.md` v1.0.0 (supreme),
`specs/006-task-issue-matching/spec.md` (this feature's FRs), the frozen 002 contracts
(shape authority), and `specs/requirements.md` Requirement 5 (source text for 001 FR-027–032
signal semantics). No NEEDS CLARIFICATION remains after this document.

## R1 — FR-001 signal set vs the frozen `ScoringWeights` surface

**Decision**: 006 scores exactly the eight normative signals of FR-001. Weight resolution:

| # | FR-001 signal | Awarded when | Weight source | Built-in value | Reason label |
|---|---|---|---|---|---|
| 1 | durable identity match | candidate's page-0 attachment payload `taskUuid` = task's `stableUuid` | frozen `scoringWeights.durableUuid` | 1000 | `durable-uuid` |
| 2 | existing issue reference | `task.issueRef.number` equals the numeric suffix of the candidate issue key | frozen `scoringWeights.issueRefExact` | 500 | `issue-ref-exact` |
| 3 | local task ID match | both carry a `localTaskId` and they are byte-equal | derived `round(0.5 × issueRefExact)` (001 R5 ratio 110:220) | 250 | `local-task-id` |
| 4 | exact normalized title | `normalize(candidate.title) === normalize(taskTitle)` | frozen `scoringWeights.titleExact` | 60 | `title-exact` |
| 5 | contained normalized title | normalized task title is a contiguous normalized-token subsequence of the normalized candidate title (or vice versa), without equality | derived `round(0.65 × titleExact)` (001 R5 ratio 65:100) | 39 | `title-contained` |
| 6 | fuzzy title similarity | always scaled | `round(titleTokenOverlap × overlapRatio)` with `overlapRatio ∈ [0.0, 1.0]` (R5: "fuzzy title similarity contributing up to 60 points scaled by a 0.0–1.0 token-overlap ratio") | ≤ 30 | `title-fuzzy` |
| 7 | same-project alignment | task's routed project equals candidate `projectId` (known task side only) | 006-local constant 10 (001 R5 same-project default 10), overridable | 10 | `same-project` |
| 8 | same-framework alignment | both sides carry a known `Framework_Id` and they are equal (R5 c5 "when both known") | 006-local constant 10 (001 R5 same-framework default 10), overridable | 10 | `same-framework` |

Signals 5 and 6 are mutually exclusive with 4 in the same pair (a score may take title credit
as exact, else contained, else fuzzy — the strictest satisfied form only), preventing the
same evidence from counting three times; all other signals sum independently and the total is
**unbounded** ("unbounded weighted integer sum", FR-001). All weights are validated integers
≥ 0; every derived/constant weight is overridable via the `MatchingWeightOverrides`
programmatic parameter (`{ localTaskId?, titleContainedRatio?, sameProject?, sameFramework? }`),
so no weight is hard-fixed at a call site (Principle III). The relative ordering matches the
normative 001 R5 ordering (durable > issue-ref > local-ID > exact > contained > fuzzy-max ≥
project = framework) under the frozen defaults.

**Rationale**: FR-001's signal list is normative for scoring behavior; 002's `ScoringWeights`
is normative for the config shape and cannot be extended inside 006 (002 FR-008 amendment
rule; ROADMAP rule 2). Deriving the orphan signals' weights from the 001 R5 default ratios
keeps the frozen source semantics; the override parameter preserves overridability; the
Complexity Tracking entry records the partial deviation honestly with a forward amendment path.

**Alternatives considered**:
- *Add four keys to `ScoringWeights`/`builtInDefaults`* — rejected: unilateral frozen-contract
  change; breaks 002's frozen-surface snapshot; amendments are out of scope here.
- *Consume the unconsumed frozen keys (`featureNameMatch`, `filePathProximity`, `samePhase`,
  `kindMatch`) as substitutes for the orphan signals* — rejected: their names denote different
  similarity concepts (feature-name / path proximity / phase / task kind); mapping them onto
  project/framework/ID equality would invent semantics no spec owns ("one FR, one owner").
  They remain available for a future amendment or another owner's FR; 006 does not silently
  repurpose or silently drop FR-001 signals.
- *Score only the four mappable signals* — rejected: violates FR-001's enumerated list.

## R2 — Title normalization and tokenization (signals 4–6)

**Decision**: one deterministic pipeline, used by all title signals:

1. Strip a leading visible issue-prefix token matching `^\[[A-Za-z0-9_-]+-\d+\]\s*` (the
   `[<KEY>-<N>]` reference written back into the line; data-model §1).
2. Strip a leading `<featureName>: ` decoration **only if** the task carries a `featureName`
   and the candidate title begins with that exact prefix — the counterpart to 005's
   `<Feature_Name>: ` prepend (005 spec FR-034), applied identically to both sides so
   renames/moves don't break title credit. 006 never imports 005; it only undoes the prefix
   shape described in the specs.
3. Unicode NFKC, casefold, collapse runs of whitespace to single spaces, trim.
4. Tokenize on the collapsed-whitespace split for containment (signal 5) and for the
   token-overlap ratio (signal 6): `overlapRatio = 2·|common multiset| / (|A| + |B|)`
   (Dice coefficient over token multisets; deterministic, order-insensitive, 0.0–1.0; empty
   vs empty = 0.0, either-empty = 0.0).

**Rationale**: determinism (Principle IV) requires a total, locale-independent spec; the
prefix-undo step keeps title signals meaningful for decorated titles without pulling 005's
derivation engine in.

**Alternatives considered**: edit-distance similarity (rejected: O(n·m) per pair, weaker
signal on reordered tokens, harder determinism story than multiset math); regex-heavy slug
normalization (rejected: locale pitfalls, not needed for the enumerated signals).

## R3 — Confidence banding, selectability, margin, and the high→medium split

**Decision**:

- **Raw band from the two frozen floors** (`confidenceFloors.medium` = 50,
  `confidenceFloors.plausible` = 18; validated `medium ≥ plausible`, "a score at or above the
  medium floor SHALL be high or medium", 001 R5 c2): `score ≥ medium` → starts `high`;
  `score ≥ plausible` → `low`; below plausible → `unmatched`.
- **Selectability**: candidates enter selection only when `score ≥ plausible` (FR-002:
  "restricting selectable candidates to at least the plausible-match floor"; R5 c4).
  `unmatched` pairs still appear as alternatives (annotated `mapped: false` per R5 c10) but
  never win selection.
- **Margin** (glossary: "distance in score between a chosen match and its nearest competitor
  (from both task and issue sides)"): `margin = score − max(next-best usable candidate of the
  same task, best usable rival task for the same issue)`; with no competitor, margin = score
  (≥ 0 by construction; integer).
- **Downgrade** (FR-005 / R5 c8): a final-`high` non-durable match with
  `margin < minimumMatchMargin` (default 10, validated ≥ 1) becomes `medium` and appends the
  reason label `ambiguous-margin`. Durable matches never downgrade (R5 c9; constitution II:
  "a durable-identity match bypasses team/project/framework gating and margin downgrade").
  `medium` therefore arises exclusively via this downgrade — exactly the reading under which
  R5 c2's "high or medium" is fully determined.
- Tasks whose assigned row is a solver dummy, or with no usable candidate, get no `Match`;
  they land in `MatchingResult.unresolved` with `band: "unmatched"` (empty-pool edge case:
  "every task bands `unmatched`; output remains deterministic").

**Rationale**: the frozen config exposes exactly two floors, so the high/medium split must be
margin-driven (FR-005); the both-sides margin is the stricter glossary definition and is what
makes "alternatives that could steal this issue" visible to review (009).

**Alternatives considered**: a third hard-coded "high floor" (rejected: invents config the
frozen surface forbids); task-side-only margin (rejected: drops the glossary's issue-side
competitor, weakening FR-005's protection against contested pairings).

## R4 — Maximum-weight one-to-one assignment with deterministic tie-breaks

**Decision**: solve FR-004 as a maximum-weight bipartite matching on a square matrix
(`n = max(|tasks|, |issues|)`) using the Jonker–Volgenant shortest-augmenting-path variant
of the Hungarian algorithm (O(n³)) over **integer** weights:

- Cells are `usable pair score` only; gated-out or below-plausible cells are forbidden
  (sentinel below any legal weight), so only FR-002/FR-003-legal pairs can be selected.
- Dummy rows/columns carry weight 0, which is exactly "leave this task unmatched / this
  issue unmapped" — a match is emitted only for real-pair cells with `score ≥ plausible`.
- **Determinism**: inputs are pre-sorted canonically (tasks by `stableUuid`, issues by
  `issueId`) before the solver sees them; augmentation tie-breaks prefer the lowest canonical
  row index then column index; after solving, a canonical pass replaces the found optimum
  with the lexicographically-smallest optimal matching (descending task order, comparing
  assigned issue ids) via reassignment search restricted to zero-reduced-cost equal-optimum
  moves. The result is provably the same optimum under any input permutation.
- Optimality and tie-break stability are enforced by property tests (spec SC-003:
  "On exhaustive small-case fixtures (≤8 tasks × ≤8 issues), the assignment weight equals
  brute-force optimum in 100% of cases" — brute force enumerates all partial injective
  assignments) and permutation-invariance byte comparisons (SC-002).

**Rationale**: JV/Hungarian is the textbook exact algorithm for this shape; n = 0 violation
for correctness; O(n³) at 100–500 is sub-millisecond-to-milliseconds. Integer weights keep
the "weighted integer sum" contract exact (no float drift).

**Alternatives considered**: greedy best-first (rejected: not globally optimal — violates
FR-004); min-cost max-flow with external lib (rejected: dependency + overkill);
OR-tools/network-simplex (rejected: runtime dependency, constitution bans); recursive
branch-and-bound (rejected: worst-case nondeterministic exploration order; kept only as the
small-case brute-force oracle in tests).

## R5 — Candidate projection, durable-identity detection, duplicate-UUID integrity

**Decision**: 006 never fetches (spec Assumption: "Candidate issues arrive already scoped by
the tracker port (007); matching never fetches"). The 006-local `projectCandidates` entry
consumes already-fetched frozen shapes: for each `IssueView`, its `AttachmentView[]` list, and
the frozen URL/payload helpers, it builds a `MatchCandidate`:

- **Durable identity (page 0 only)**: an attachment whose `url` parses via frozen
  `parseAttachmentUrl` as `kind: "canonical"` **and** whose `metadata[metadataNamespaceKey]`
  parses via frozen `parseSyncStatePayload` yields `taskUuid` → that candidate carries
  `durableTaskUuid`. Continuation pages are history-only and never identity (glossary
  `Continuation_Attachment`). Identity is never read from descriptions (tracker-port contract:
  "implementations MUST NOT search descriptions for identity"; R5 c11).
- **Candidate framework / feature / file path**: from the page-0 payload's
  `frameworkMetadata` (`frameworkId`, `featureName?`, `filePath`) — "known framework" for the
  R5 c5 gate. Absent payload ⇒ framework unknown ⇒ framework gate not evaluated (both-known
  rule).
- **Issue number** for signal 2: trailing `-(\d+)` of `IssueView.key`; non-matching keys score 0.
- **Project**: `IssueView.projectId` compared as-is to the task's routed `RoutingResolution.project`
  (the configured project identity; `IssueScope.perTeam.projects` is documented as configured
  identities, so identity-space alignment is the provider's contract, not 006's invention).
- **Integrity scan** (constitution II; R5 c3): after projection, if >1 candidate carries the
  same `durableTaskUuid`, throw `DurableIdentityCollisionError { taskUuid, issueIds }` —
  "abort the run, apply no changes, and report the task UUID and the identifiers of all
  conflicting issues". 006 is pure, so "no changes" is structural: the throw emits no result
  at all.

**Rationale**: the page-0 canonical attachment under `metadataNamespaceKey` is the sole
identity anchor (constitution II, data-model §8); building on frozen URL/payload functions
keeps 006 free of tracker semantics and 007 dependencies.

**Alternatives considered**: calling `LinearPort.findIssuesByAttachmentUrl` from inside 006
(rejected: makes matching non-pure, violates "matching never fetches", and duplicates 007's
identity-lookup ownership); trusting `IssueView.title`-embedded UUIDs (rejected: identity in
descriptions/titles is banned).

## R6 — 005 gating inputs as data, never imports

**Decision**: the FR-003 gate consumes per-task routing as an optional
`RoutingResolution` value (frozen 002 shape) supplied on `TaskMatchInput`. Rules: team gate —
task's resolved `teamKey ≠ candidate.teamKey` ⇒ exclude; project gate —
task's routed project `≠` candidate `projectId` ⇒ exclude; framework gate — only "when both
known" (R5 c5). When a task's routing is absent or `unassigned`, the team/project gates are
**skipped for that task** (the gate discriminates only between two known sides; a task with
no resolved container must still be matchable — durable, durable-identity-anchored, or
container-agnostic). Durable candidates skip all three gates unconditionally (R5 c9). Tests
fabricate `RoutingResolution` fixtures; nothing imports `src/routing` (005).

**Rationale**: Wave-2 parallel safety (this feature is planned while 005 is planned); the
002 shape is the freeze boundary both features code against; the skip-when-unknown rule is
the only deterministic reading of "whose team, project, or (when both known) framework
**differs from the task's**" — no difference can exist against an unknown task side.

**Alternatives considered**: importing 005's resolver (rejected: Wave-2 collision + coupling);
treating unassigned as match-anything-excluded (rejected: would orphan tasks on routing gaps,
contradicting 005's own "without terminating processing of remaining tasks" posture).

## R7 — Determinism mechanics and property-test strategy

**Decision**: the pure core reads no clock, no env, no `Math.random`; all orderings derive
from canonical keys (`Task.stableUuid`, `IssueView.id`) — never array order.
`serializeMatchingResult` (stable key-sorted JSON, same discipline as 002's
`canonicalizePlanJson`) is the SC-002 byte-identity artifact. Property suites use
`tests/helpers/matching-corpus.ts`: a seeded xorshift PRNG (constant seeds in tests) generating
task/issue corpora (random shared/renamed titles, moved containers, durable attachments
injected at configured rates, checkbox flips — the SC-001 fixture shape) with invariant
checks: one-to-one validity, `band ∈ {high, medium, low, unmatched}` with exactly one band per
match, `alternatives.length ≤ 3`, score/margin integers ≥ 0, permutation invariance
(byte-compare after shuffling inputs with independent seeds), brute-force optimality ≤ 8×8,
and ≥95% pairing survival + 100% durable survival across the 100-task fixture re-runs.

**Rationale**: constitution VI requires property tests as a cross-cutting mandatory type; a
seeded in-repo generator avoids new dev-dependencies (002 precedent: hand-rolled property
loops) and keeps failures reproducible byte-for-byte.

**Alternatives considered**: fast-check/random-string libraries (rejected: new dependency for
zero benefit over a 60-line seeded generator); fuzzing without fixed seeds (rejected:
violates hermetic determinism, Principle IV/VI).

## R8 — Tracker-fake testability without the real transport or 007

**Decision**: integration-tier tests run against `tests/helpers/matching-linear-fake.ts`, an
in-memory fake implementing the **frozen** `LinearPort` interface: read-side
(`listIssues`, `discoverMetadata`, `getIssue`, `listAttachments`, `getAttachmentByUrl`,
`findIssuesByAttachmentUrl`) backed by fixture data; write-side members present for interface
conformance and **call-recording**, so tests assert zero mutating calls on any 006-reachable
path (Principle I posture). The fake yields deterministic page ordering. 007 will ship the
real port and the production fake (002 tracker-port.md: "007 implements the real port and a
behaviorally identical contract-tested fake"); 006's test fake is a hermetic stand-in with a
disjoint path and name, later cross-checked by 007's fake-versus-real contract test. The
matching module itself never imports `LinearPort` as a runtime dependency — the fake feeds
`projectCandidates` the same frozen `IssueView`/`AttachmentView` values the real port yields.

**Rationale**: constitution VI ("a middle layer … driving an injected fake `Linear_Port` with
zero real Linear API requests") and 002's consumption invariant #1 ("006/008/… receive a
`LinearPort` by injection; hermetic tests inject the fake") without pulling a Wave-2 sibling
dependency into 006's graph.

**Alternatives considered**: importing 007's fake once it lands (rejected: parallel-branch
coupling; Wave-2 rule — code only against 002 shapes); skipping integration tier for a pure
module (rejected: the projection boundary consumes port-shaped data and must be proven
contract-shaped).

## R9 — Defensive validation of the frozen matching config slice

**Decision**: `checkMatchingConfig(config)` validates, before any scoring, the constraints
FR-001/002/005 and 001 R5 make of the frozen keys: every consumed weight an integer ≥ 0
("configurable weights each greater than or equal to 0"); `confidenceFloors` integers ≥ 0
with `medium ≥ plausible` ("where the medium floor is greater than or equal to the
plausible-match floor"); `minimumMatchMargin` an integer ≥ 1 ("default 10, minimum allowed
value 1"). Any violation throws typed `MatchingConfigError` naming the key and offending
value. 006 does **not** silently clamp, round, or ignore bad values.

**Rationale**: 002's config validation gate covers workspace identities only, not matching
semantics; a pure function handed nonsense must fail loudly, never produce silent nonsense
(no-silent posture, constitution III's "MUST NOT" pattern). Typed errors keep 008's abort
reporting structured.

**Alternatives considered**: trusting upstream validation (rejected: nothing in 002 or 008
validates these numeric relations today); clamping (rejected: silent behavior change).

## R10 — Export surface and parallel-safety of shared files

**Decision**: 006's public surface is the subpath `task-linear-sync/matching`
(`src/matching/index.ts`). The implementation adds exactly one `"./matching"` entry to
`package.json` `exports` — an additive, single-key edit distinct from sibling features' keys
(`./discovery`, `./parsing`, `./routing`, `./tracker`), appended at the end of the `exports`
map so parallel Wave-2 PRs merge as non-overlapping line additions. 006 does NOT edit
`src/index.ts` (root barrel), any `src/domain|config|state|urls|gates|ports` file, or any 002
contract document; the 002 `tests/contract/frozen-surface.test.ts` snapshot therefore stays
green with zero edits, and a Polish task asserts exactly that. 006's own contract test
(`tests/contract/matching-api.test.ts`) snapshots 006's exported name set the same way.

**Rationale**: ROADMAP Wave 2 = "disjoint modules, no shared files"; the exports map is the
single unavoidable shared touchpoint, so it is kept additive, minimal, and merge-disjoint,
with 002's freeze tests left untouched as the enforcement tripwire.

**Alternatives considered**: re-exporting matching from `src/index.ts` (rejected: shared-file
edit that every Wave-2 feature would race on); relative-path test imports into `build/`
(rejected: bypasses the real `exports` map, weakening R2's compiled-package test precedent
from 002).
