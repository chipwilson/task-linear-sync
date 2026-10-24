/**
 * T024 [US1] — FR-003 container gating + FR-002 plausible-floor selectability.
 * Verbatim: "exclude non-durable candidates whose team, project, or (when both known)
 * framework differ from the task's" (spec AC3: "excluded entirely"); research R6 —
 * routing absent or `unassigned: true` ⇒ "team/project gates skipped for that task";
 * constitution II — "a durable-identity match bypasses team/project/framework gating
 * and margin downgrade so an issue moved or renamed across containers is never
 * orphaned." Selectability: "selectable candidates are restricted to at least the
 * plausible-match floor" (FR-002 / 001 R5 c4).
 */
import type { PairExclusion, PairScore, TaskMatchInput } from "./types.js";
import type { MatchCandidate } from "./types.js";

/**
 * Finalize `usable`/`exclusion` for a scored pair (pure — returns a new pair, the
 * input is never mutated). Exclusion precedence: container gates in FR-003 order
 * (team, project, framework — "excluded entirely" outranks a mere score shortfall),
 * then the plausible floor. Durable pairs are never gated.
 */
export function applyGate(
  pair: PairScore,
  input: TaskMatchInput,
  candidate: MatchCandidate,
  plausibleFloor: number,
): PairScore {
  let exclusion: PairExclusion | undefined;

  if (!pair.durableIdentity) {
    const routing = input.routing;
    if (routing !== undefined && routing.unassigned !== true) {
      if (routing.teamKey !== candidate.teamKey) {
        exclusion = "gated-team";
      } else if (routing.project !== candidate.projectRef) {
        exclusion = "gated-project";
      }
    }
    if (exclusion === undefined) {
      // Framework gate — only "when both known" (001 R5 c5); the task side always
      // carries a FrameworkId, so "both known" reduces to the candidate side.
      const candidateFramework = candidate.frameworkId;
      if (candidateFramework !== undefined && candidateFramework !== input.task.frameworkId) {
        exclusion = "gated-framework";
      }
    }
  }

  if (exclusion === undefined && pair.total < plausibleFloor) {
    exclusion = "below-plausible";
  }

  const gated: PairScore = { ...pair, usable: exclusion === undefined };
  if (exclusion !== undefined) {
    return { ...gated, exclusion };
  }
  return gated;
}
