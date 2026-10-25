/**
 * T011 — defensive validation of the frozen matching config slice (research R9).
 * Constraints honored verbatim: weights "configurable weights each greater than or
 * equal to 0" and a "weighted INTEGER sum"; floors "where the medium floor is greater
 * than or equal to the plausible-match floor"; margin "default 10, minimum allowed
 * value 1". Nothing is silently clamped, rounded, or ignored — every violation throws
 * a typed `MatchingConfigError` naming key + rule.
 */
import type { ResolvedConfig } from "task-linear-sync/config";
import { MatchingConfigError } from "./errors.js";

/** FR-001-consumed frozen weight keys (unconsumed keys are not 006's constraints). */
const CONSUMED_WEIGHT_KEYS = [
  "durableUuid",
  "issueRefExact",
  "titleExact",
  "titleTokenOverlap",
] as const;

const WEIGHT_RULE =
  "scoring weights must be integers greater than or equal to 0 (weighted INTEGER sum)";

function assertNonNegativeInteger(value: unknown, key: string, rule: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MatchingConfigError(key, value, rule);
  }
}

/**
 * Validate the frozen matching slice before any scoring ("no silent bad config",
 * contracts/matching-api.md invariant 8). Runs at the entry of every public 006
 * function; reads `task-linear-sync/config` types only — never mutates the config.
 */
export function checkMatchingConfig(config: ResolvedConfig): void {
  for (const key of CONSUMED_WEIGHT_KEYS) {
    assertNonNegativeInteger(config.scoringWeights[key], `scoringWeights.${key}`, WEIGHT_RULE);
  }

  assertNonNegativeInteger(
    config.confidenceFloors.medium,
    "confidenceFloors.medium",
    "confidence floors must be integers greater than or equal to 0",
  );
  assertNonNegativeInteger(
    config.confidenceFloors.plausible,
    "confidenceFloors.plausible",
    "confidence floors must be integers greater than or equal to 0",
  );
  if (config.confidenceFloors.medium < config.confidenceFloors.plausible) {
    throw new MatchingConfigError(
      "confidenceFloors.medium",
      config.confidenceFloors.medium,
      "confidenceFloors.medium must be greater than or equal to confidenceFloors.plausible",
    );
  }

  assertNonNegativeInteger(
    config.minimumMatchMargin,
    "minimumMatchMargin",
    "minimumMatchMargin must be an integer greater than or equal to 1 (default 10, minimum allowed value 1)",
  );
  if (config.minimumMatchMargin < 1) {
    throw new MatchingConfigError(
      "minimumMatchMargin",
      config.minimumMatchMargin,
      "minimumMatchMargin must be an integer greater than or equal to 1 (default 10, minimum allowed value 1)",
    );
  }
}
