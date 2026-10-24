/**
 * `task-linear-sync/matching` — 006 public barrel (subpath export per research R10).
 * The only 006 surface besides the additive `package.json` exports key; imports stay
 * within `task-linear-sync/{domain,config,urls,ports}` + Node built-ins — never the
 * sibling Wave-2 feature modules, never 005/007 internals.
 *
 * T014: foundational vocabulary; T028 adds the US1 pipeline
 * (scoring → gating → assignment → banding → alternatives → serialization).
 */
export { checkMatchingConfig } from "./config-check.js";
export { DurableIdentityCollisionError, MatchingConfigError } from "./errors.js";
export { normalizeTitle, overlapRatio, tokenize } from "./normalize.js";
export { projectCandidates } from "./projection.js";
export { resolveWeights, scorePair } from "./scoring.js";
export type { ResolvedWeights } from "./scoring.js";
export { applyGate } from "./gating.js";
export { assignUsable } from "./assignment.js";
export { bandAndMargin, AMBIGUOUS_MARGIN_REASON } from "./bands.js";
export { matchAllTasks } from "./matching.js";
export { serializeMatchingResult } from "./serialize.js";
export type {
  Confidence,
  Match,
  MatchAlternative,
  MatchCandidate,
  MatchingResult,
  MatchingWeightOverrides,
  PairExclusion,
  PairScore,
  ProjectCandidatesInput,
  SignalContribution,
  TaskMatchInput,
  UnresolvedTask,
} from "./types.js";
