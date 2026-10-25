/**
 * T028 [US1] — `matchAllTasks`: the full pure pipeline (contracts/matching-api.md).
 * Config guard (R9) → canonical ordering (constitution IV: "All orderings derive from
 * canonical keys — never input array order") → per-pair `scorePair` + `applyGate` →
 * maximum-weight one-to-one `assignUsable` (FR-004) → `bandAndMargin` (FR-002/FR-005)
 * → FR-006 alternatives attached once the final assignment exists. Zero I/O, zero
 * tracker calls, zero writes, no clock, no env reads.
 */
import type { Match, MatchAlternative } from "task-linear-sync/domain";
import { applyGate } from "./gating.js";
import { bandAndMargin } from "./bands.js";
import { assignUsable } from "./assignment.js";
import { checkMatchingConfig } from "./config-check.js";
import { resolveWeights, scorePair } from "./scoring.js";
import type {
  MatchingResult,
  MatchingWeightOverrides,
  MatchCandidate,
  PairScore,
  TaskMatchInput,
  UnresolvedTask,
} from "./types.js";
import type { ResolvedConfig } from "task-linear-sync/config";

/** FR-006: "retain up to three alternative candidates per match". */
const MAX_ALTERNATIVES = 3;

/** (score desc, issueId asc) — the deterministic alternatives order (§5 contract). */
function compareAlternatives(a: PairScore, b: PairScore): number {
  if (b.total !== a.total) return b.total - a.total;
  return a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0;
}

/**
 * The full matching pipeline. `tasks`/`candidates` arrive in arbitrary order; results
 * derive exclusively from canonical keys (`stableUuid`, `issueId`). Throws
 * `MatchingConfigError` on invalid matching config (invariant 8).
 */
export function matchAllTasks(
  tasks: readonly TaskMatchInput[],
  candidates: readonly MatchCandidate[],
  config: ResolvedConfig,
  weightOverrides?: MatchingWeightOverrides,
): MatchingResult {
  checkMatchingConfig(config);
  const weights = resolveWeights(config, weightOverrides ?? {});
  const plausibleFloor = config.confidenceFloors.plausible;

  // Canonical ordering before anything else (permutation invariance, SC-002).
  const orderedTasks = [...tasks].sort((a, b) =>
    a.task.stableUuid < b.task.stableUuid
      ? -1
      : a.task.stableUuid > b.task.stableUuid
        ? 1
        : 0,
  );
  const orderedCandidates = [...candidates].sort((a, b) =>
    a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0,
  );

  // Score + gate every task↔candidate pair (n×m; the pure core of the pipeline).
  const pairs: PairScore[] = [];
  for (const input of orderedTasks) {
    for (const candidate of orderedCandidates) {
      pairs.push(applyGate(scorePair(input, candidate, weights), input, candidate, plausibleFloor));
    }
  }
  const usable = pairs.filter((p) => p.usable);

  // FR-004 global one-to-one optimum, then FR-002/FR-005 banding.
  const selected = assignUsable(usable);
  const banded = bandAndMargin(selected, usable, config);

  // FR-006 alternatives need the FINAL assignment: `mapped` ⇔ selected for some task.
  const selectedIssueIds = new Set(banded.map((m) => m.issueId));
  const pairsByTask = new Map<string, PairScore[]>();
  for (const p of pairs) {
    const list = pairsByTask.get(p.taskUuid);
    if (list === undefined) pairsByTask.set(p.taskUuid, [p]);
    else list.push(p);
  }
  const matches: Match[] = banded.map((match) => {
    const rivals = (pairsByTask.get(match.taskUuid) ?? [])
      .filter((p) => p.issueId !== match.issueId) // "the task's highest-scoring OTHER candidates"
      .sort(compareAlternatives)
      .slice(0, MAX_ALTERNATIVES)
      .map(
        (p): MatchAlternative => ({
          issueId: p.issueId,
          score: p.total,
          mapped: selectedIssueIds.has(p.issueId),
        }),
      );
    return { ...match, alternatives: rivals };
  });

  // Unresolved tasks: canonical order; bestScore = best USABLE total (diagnostic only).
  const matchedTaskUuids = new Set(banded.map((m) => m.taskUuid));
  const unresolved: UnresolvedTask[] = [];
  for (const input of orderedTasks) {
    const taskUuid = input.task.stableUuid;
    if (matchedTaskUuids.has(taskUuid)) continue;
    let bestScore: number | undefined;
    for (const p of pairsByTask.get(taskUuid) ?? []) {
      if (!p.usable) continue;
      if (bestScore === undefined || p.total > bestScore) bestScore = p.total;
    }
    unresolved.push({
      taskUuid,
      band: "unmatched",
      ...(bestScore !== undefined ? { bestScore } : {}),
    });
  }

  // Candidates not selected for any task — the 013 drift/unmapped input, sorted.
  const unmappedIssues = orderedCandidates
    .map((c) => c.issueId)
    .filter((id) => !selectedIssueIds.has(id))
    .sort();

  return { matches, unresolved, unmappedIssues };
}
