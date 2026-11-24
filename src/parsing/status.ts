/**
 * Status-event log loader (feature 023 amendment A-023-1/A-023-3; contract C6.1;
 * data-model §1 "Status event"; feature tasks T022).
 *
 * PURE and dependency-free: lines in, lane map + malformed count out — zero I/O, zero
 * clock, zero randomness (parsing purity, constitution IV). The mission's append-only
 * `status.events.jsonl` is the SOLE status authority; this module is its only reader-side
 * grammar. Content discipline (FR-007): non-qualifying and malformed lines are skipped —
 * malformed lines leave behind NOTHING but their count, so log junk can never propagate
 * into plans, reports, or mirrored text.
 */

/** One mission's parsed lane-event log. */
export interface StatusEventScan {
  /**
   * `wp_id → to_lane` of the LAST qualifying line per id in FILE ORDER (append-only is
   * canonical order). Values ride verbatim — lane-vocabulary recognition (the nine-lane
   * `LANE_VOCABULARY`) is the CONSUMER's check: anything else (bootstrap `genesis`) is
   * known-unmapped downstream. Unknown `wp_id`s stay: the engine reports-and-ignores.
   */
  readonly lanes: ReadonlyMap<string, string>;
  /** Lines that failed JSON parsing — counted ONLY; their content never propagates. */
  readonly malformedCount: number;
}

/**
 * Parse one status-event log (C6.1). A line QUALIFIES when it is a valid JSON OBJECT
 * with a string `wp_id` AND a string `to_lane` at the TOP level — envelope events
 * (wp_id only inside `payload`), annotations, non-object JSON, blank lines, and
 * type-mismatched fields are all skipped WITHOUT poisoning file order (they never touch
 * the map). A line that fails JSON parsing is malformed: counted, never read.
 */
export function parseStatusEventLog(lines: readonly string[]): StatusEventScan {
  const lanes = new Map<string, string>();
  let malformedCount = 0;
  for (const raw of lines) {
    if (raw.trim() === "") continue; // blank lines are nothing at all
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      malformedCount += 1; // count only — the bytes are never retained or surfaced
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue; // non-object JSON: a skip, not a malformation
    const record = value as Record<string, unknown>;
    const wpId = record["wp_id"];
    const toLane = record["to_lane"];
    if (typeof wpId !== "string" || wpId === "" || typeof toLane !== "string" || toLane === "") continue; // envelope/annotation/type-mismatch: skip, order intact
    lanes.set(wpId, toLane); // LAST qualifying line per id wins (file order = authority)
  }
  return { lanes, malformedCount };
}
