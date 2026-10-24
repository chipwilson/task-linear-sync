/**
 * `resolveRouting` — the 005-owned longest-prefix routing algorithm producing the FROZEN 002
 * `RoutingResolution` (imported, never widened/redefined; ROADMAP rule 2 / 002 FR-008).
 * Normative contract: specs/005-routing-title-derivation/contracts/routing-resolution.md;
 * decisions: research R1 (algorithm) / R7 (unassigned encoding).
 *
 * Pure: reads only `filePath` + the configured map; never consults the tracker, filesystem,
 * or network. Contains no hardcoded team key, project name, or path prefix (001 R4.6) —
 * every destination arrives from the supplied config slice.
 */
import type { RoutingResolution } from "../domain/routing.js"; // FROZEN 002 — imported, not redefined
import type { RoutingConfigSlice } from "./types.js";

/**
 * Resolve a task's file path to a {team, project} destination (005 FR-001/FR-002).
 *
 * - Longest matching prefix wins (001 R4.1): literal `filePath.startsWith(prefix)` over
 *   non-empty prefixes — no path-segment normalization.
 * - Equal maximum length ⇒ earliest entry by `projectByPath` array index + the deterministic
 *   tie-break indication `"first-by-map-order"` (001 R4.2).
 * - No match + complete defaults ⇒ `defaulted: true` (001 R4.3); an absent/empty map takes
 *   this path for every task (001 R4.5).
 * - No match + no complete defaults ⇒ unassigned encoding (research R7): empty `teamKey`/
 *   `project`, `defaulted: false`, `unassigned: true`. Callers keep processing — throwing
 *   here would violate 001 R4.4 "without terminating processing of remaining tasks".
 */
export function resolveRouting(filePath: string, config: RoutingConfigSlice): RoutingResolution {
  let bestIndex = -1;
  let bestLength = 0;
  let tied = false;

  const entries = config.projectByPath;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prefix === "") continue; // only non-empty prefixes match (research R1)
    if (!filePath.startsWith(entry.prefix)) continue;
    const length = entry.prefix.length;
    if (length > bestLength) {
      bestLength = length;
      bestIndex = i;
      tied = false;
    } else if (length === bestLength) {
      tied = true; // ≥2 matching prefixes share the maximum length (001 R4.2)
    }
  }

  if (bestIndex >= 0) {
    const winner = entries[bestIndex]!;
    const matched: RoutingResolution = {
      teamKey: winner.teamKey,
      project: winner.project,
      matchedPrefix: winner.prefix,
      defaulted: false,
    };
    return tied ? { ...matched, tieBreak: "first-by-map-order" } : matched;
  }

  if (config.defaultTeamKey !== "" && config.defaultProject !== "") {
    return { teamKey: config.defaultTeamKey, project: config.defaultProject, defaulted: true };
  }

  // Unassigned-with-indication (research R7): `unassigned: true` is the canonical signal;
  // the empty strings are inert byproducts of the frozen required-string fields.
  return { teamKey: "", project: "", defaulted: false, unassigned: true };
}
