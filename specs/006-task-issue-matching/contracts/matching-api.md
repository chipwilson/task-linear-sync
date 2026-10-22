# Contract: Matching API (pure entry points)

Module: `src/matching/` — subpath export `task-linear-sync/matching`. **Pure** functions:
zero I/O, zero tracker calls, zero writes, no clock, no env reads ("A pure function over the
002 entity shapes — no tracker calls, no file writes"). Composition: `projectCandidates`
turns frozen tracker views into `MatchCandidate`s ([candidate-projection.md](./candidate-projection.md));
`matchAllTasks` turns inputs + candidates into the frozen `Match` shape
([confidence-scoring.md](./confidence-scoring.md) governs the scoring/banding rules).

```ts
import type { ResolvedConfig } from "task-linear-sync/config";
import type { Match } from "task-linear-sync/domain";
import type { IssueView, AttachmentView } from "task-linear-sync/ports";

/** 006-local records: exact fields in data-model.md §1–§6. */
export interface TaskMatchInput { readonly task: Task; readonly routing?: RoutingResolution }
export interface MatchCandidate { /* issueId, issueKey, teamKey, projectRef, title,
  durableTaskUuid?, frameworkId?, featureName?, filePath? — data-model §2 */ }
export interface MatchingResult { readonly matches: readonly Match[];
  readonly unresolved: readonly UnresolvedTask[]; readonly unmappedIssues: readonly string[] }
export interface MatchingWeightOverrides { readonly localTaskId?: number;
  readonly titleContainedRatio?: number; readonly sameProject?: number; readonly sameFramework?: number }

export class MatchingConfigError extends Error { /* key, value, rule — data-model §6 */ }
export class DurableIdentityCollisionError extends Error { /* taskUuid, issueIds (sorted) */ }

/** Project fetched tracker views into candidates; runs the duplicate-UUID integrity scan.
 *  Throws DurableIdentityCollisionError when >1 issue carries the same task UUID
 *  (constitution II) — no result is emitted ("abort … no changes": structural for a pure fn). */
export function projectCandidates(input: {
  readonly issues: readonly IssueView[];
  readonly attachmentsByIssue: Readonly<Record<string /* issueId */, readonly AttachmentView[]>>;
  readonly config: ResolvedConfig;            // uses attachmentUrlTemplate/continuation template, metadataNamespaceKey
}): MatchCandidate[];                          // sorted by issueId ascending — deterministic

/** The full matching pipeline. Throws MatchingConfigError on invalid matching config. */
export function matchAllTasks(
  tasks: readonly TaskMatchInput[],
  candidates: readonly MatchCandidate[],
  config: ResolvedConfig,
  weightOverrides?: MatchingWeightOverrides, // programmatic layer for weights §5 data-model
): MatchingResult;

/** Canonical stable-key JSON — the SC-002 byte-identity artifact. */
export function serializeMatchingResult(r: MatchingResult): string;
```

## Behavioral invariants (each maps to ≥1 automated test; see quickstart table)

1. **One-to-one globally** (FR-004): in `matches`, every `taskUuid` appears ≤ 1 time and
   every `issueId` appears ≤ 1 time.
2. **Determinism** (FR-004, SC-002): identical inputs ⇒ `serializeMatchingResult`
   byte-identical across runs **and across input permutations** (task and candidate order);
   proven across 100 randomized seeded fixtures.
3. **Global optimality** (FR-004, SC-003): for corpora ≤ 8×8, total assigned weight equals
   brute-force optimum over all injective partial assignments of usable pairs.
4. **Exactly one band per match** from `{high, medium, low, unmatched}` (FR-002); unresolved
   tasks carry `band: "unmatched"`; only usable candidates (score ≥ `confidenceFloors.plausible`,
   not gated-out) participate in selection.
5. **Score/margin integers ≥ 0**; `reasons` = machine-readable signal labels (+ exactly
   `ambiguous-margin` appended once when FR-005 downgraded); `alternatives.length ≤ 3`,
   descending score, deterministic tie-break, each `mapped: boolean` (FR-006).
6. **Durable identity wins** (constitution II): pair with
   `task.stableUuid === candidate.durableTaskUuid` ⇒ `durableIdentity: true`, gates and
   margin downgrade not applied; `DurableIdentityCollisionError` abort carries the UUID and
   every conflicting issue id, sorted.
7. **Zero side effects**: the module performs no fs/net calls; integration tests prove zero
   mutating `LinearPort` methods are invoked on any 006-reachable path (fake records calls).
8. **No silent bad config**: any matching-slice violation throws `MatchingConfigError`
   naming key + rule (research R9); no clamping or coercion.
9. **No new shared-file surface**: the only non-`src/matching` change ever made by 006's
   implementation is the additive `"./matching"` key in `package.json` `exports` (research
   R10); the 002 frozen-surface snapshot must remain untouched and green.
