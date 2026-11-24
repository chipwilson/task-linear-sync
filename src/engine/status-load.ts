/**
 * Plan-build status-event loader (feature 023 contract C6.1/C6.3; data-model §5; task
 * T023). READ-ONLY and plan-build-only (Principle I): invoked exclusively from
 * `buildSyncPlan` — the apply/rollback lanes never touch these files, and the mirrored
 * bytes are never rewritten (status is never written back, C5).
 *
 * Shape (data-model §1 "Status event"): the log sits DIRECTLY beneath the mission
 * directory — `<base>/<mission>/<statusEventFileName>` (built-in `spec-kitty` ships
 * `"status.events.jsonl"`, A-023-1). Missing file ⇒ empty map, NEVER an error; the parse
 * itself is the pure `parseStatusEventLog` grammar (T022). One read per mission per plan
 * build (cached in the assembled map).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseStatusEventLog } from "../parsing/status.js";

/** One mission's status posture (empty when no log exists). */
export interface MissionStatus {
  /** `wp_id → last to_lane` in file order (pure module's map). */
  readonly lanes: ReadonlyMap<string, string>;
  /** Malformed-line count for the whole log (one reported finding per mission). */
  readonly malformedCount: number;
}

const EMPTY: MissionStatus = { lanes: new Map<string, string>(), malformedCount: 0 };

/**
 * The mission directory for a task file path: the FIRST TWO path segments
 * (`kitty-specs/<mission>/...`) — the mission, never a lane or artifact sub-folder.
 * `undefined` for anything shallower (never a guess).
 */
export function missionDirectory(filePath: string): string | undefined {
  const segments = filePath.split("/");
  if (segments.length < 3 || segments[0] === "" || segments[1] === undefined || segments[1] === "") return undefined;
  return `${segments[0]}/${segments[1]}`;
}

/**
 * Load the status maps for every mission present in `taskPaths`, keyed by mission
 * directory. One filesystem read per mission (cache-backed); a missing log yields the
 * empty posture, never an error. `statusEventFileName` comes from the consumed adapter
 * row (built-in value per the 022 engine-registry precedent).
 */
export function loadMissionStatuses(
  repositoryRoot: string,
  taskPaths: Iterable<string>,
  statusEventFileName: string,
): ReadonlyMap<string, MissionStatus> {
  const missions = new Set<string>();
  for (const filePath of taskPaths) {
    const mission = missionDirectory(filePath);
    if (mission !== undefined) missions.add(mission);
  }
  const out = new Map<string, MissionStatus>();
  for (const mission of [...missions].sort()) {
    const logPath = join(repositoryRoot, mission, statusEventFileName);
    if (!existsSync(logPath)) {
      out.set(mission, EMPTY); // missing log — empty map, never an error (C6.1)
      continue;
    }
    const lines = readFileSync(logPath, "utf8").split(/\r\n|\r|\n/);
    const scan = parseStatusEventLog(lines);
    out.set(mission, { lanes: scan.lanes, malformedCount: scan.malformedCount });
  }
  return out;
}
