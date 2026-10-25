/**
 * T027 [US1] — canonical serialization of `MatchingResult` (research R7: "the SC-002
 * byte-identity artifact"). Stable key-sorted JSON in 002 `canonicalizePlanJson`
 * discipline — reused from the frozen domain module so the discipline is literally the
 * same code path; arrays keep their canonical order, never re-sorted at serialize time.
 */
import { canonicalJson } from "task-linear-sync/domain";
import type { MatchingResult } from "./types.js";

export function serializeMatchingResult(result: MatchingResult): string {
  return canonicalJson(result);
}
