/**
 * T026 [US1] — FR-002 banding + FR-005 margin downgrade (contracts/confidence-scoring.md
 * §4; research R3). Raw band: `total ≥ confidenceFloors.medium` ⇒ high, else low
 * (selected pairs are already ≥ plausible). Margin (glossary, both sides):
 * `margin = total − max(next-best usable competitor of the task, best usable rival of
 * the issue)`; no competitor ⇒ `margin = total`; frozen `Match.margin` is "≥ 0" — a
 * stronger usable rival clamps to 0 (maximally contested ⇒ still a downgrade trigger).
 * Downgrade: final-high ∧ ¬durable ∧ margin < minimumMatchMargin ⇒ medium + reason
 * `ambiguous-margin`; "durable matches never downgrade" (R5 c9, constitution II).
 * Emits the frozen `Match` shape with `alternatives: []` — the orchestrator attaches
 * FR-006 alternatives once the full assignment exists.
 */
import type { Match } from "task-linear-sync/domain";
import type { PairScore } from "./types.js";
import type { ResolvedConfig } from "task-linear-sync/config";

/** Reason label recorded once when FR-005 downgrades a high match. */
export const AMBIGUOUS_MARGIN_REASON = "ambiguous-margin";

function maxUsableTotal(
  pairs: readonly PairScore[],
  key: "taskUuid" | "issueId",
  keyOf: string,
  excludeOppositeKey: "issueId" | "taskUuid",
  excludeOppositeValue: string,
): number | undefined {
  let best: number | undefined;
  for (const p of pairs) {
    if (!p.usable) continue; // competitors are USABLE pairs only (FR-002 selectability)
    if (p[key] !== keyOf) continue;
    if (p[excludeOppositeKey] === excludeOppositeValue) continue;
    if (best === undefined || p.total > best) best = p.total;
  }
  return best;
}

/**
 * Band and margin the solver-selected pairs. `allUsable` must contain every usable
 * pair (selected or not) — competitors are drawn from it, never from gated or
 * below-plausible pairs.
 */
export function bandAndMargin(
  selected: readonly PairScore[],
  allUsable: readonly PairScore[],
  config: ResolvedConfig,
): Match[] {
  const { medium } = config.confidenceFloors;
  const minimumMargin = config.minimumMatchMargin;

  // Canonical order guard: matches are ordered by task stableUuid ascending.
  const ordered = [...selected].sort((a, b) =>
    a.taskUuid < b.taskUuid ? -1 : a.taskUuid > b.taskUuid ? 1 : 0,
  );

  return ordered.map((pair) => {
    const taskRival = maxUsableTotal(allUsable, "taskUuid", pair.taskUuid, "issueId", pair.issueId);
    const issueRival = maxUsableTotal(allUsable, "issueId", pair.issueId, "taskUuid", pair.taskUuid);
    const competitor =
      taskRival === undefined && issueRival === undefined
        ? undefined
        : Math.max(taskRival ?? Number.NEGATIVE_INFINITY, issueRival ?? Number.NEGATIVE_INFINITY);
    const margin = competitor === undefined ? pair.total : Math.max(0, pair.total - competitor);

    const reasons: string[] = pair.contributions.map((c) => c.signal);
    let confidence: Match["confidence"] = pair.total >= medium ? "high" : "low";
    if (confidence === "high" && !pair.durableIdentity && margin < minimumMargin) {
      confidence = "medium"; // FR-005
      reasons.push(AMBIGUOUS_MARGIN_REASON);
    }

    const match: Match = {
      taskUuid: pair.taskUuid,
      issueId: pair.issueId,
      score: pair.total,
      margin,
      confidence,
      durableIdentity: pair.durableIdentity,
      reasons,
      alternatives: [], // attached by matchAllTasks (FR-006 needs the final assignment)
    };
    return match;
  });
}
