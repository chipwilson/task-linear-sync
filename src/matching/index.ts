/**
 * `task-linear-sync/matching` — 006 public barrel (subpath export per research R10).
 * The only 006 surface besides the additive `package.json` exports key; imports stay
 * within `task-linear-sync/{domain,config,urls,ports}` + Node built-ins (never
 * `src/discovery|parsing|routing|tracker`, never 005/007 internals).
 *
 * T014: foundational vocabulary. US1 tasks (T023–T028) extend this barrel with the
 * scoring/gating/assignment/banding pipeline and `matchAllTasks`/`serializeMatchingResult`.
 */
export { checkMatchingConfig } from "./config-check.js";
export { DurableIdentityCollisionError, MatchingConfigError } from "./errors.js";
export { normalizeTitle, overlapRatio, tokenize } from "./normalize.js";
export { projectCandidates } from "./projection.js";
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
