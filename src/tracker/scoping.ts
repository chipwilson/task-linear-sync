/**
 * Per-team scoping (research R6; T028): the two-layer enforcement of "inclusion = configured
 * team AND one of that team's configured projects AND not in an ignored state type" (FR-001),
 * "belt-and-braces for a rule the port contract calls never-leak". The pure guard predicate
 * is the SINGLE shared implementation — the real pagination loop re-checks every row and the
 * fake filters with the SAME exported function (reused, not re-implemented). Also hosts the
 * `pageSize` validate/clamp helper (platform connection max 250, `page-size-clamped`
 * diagnostic naming the config KEY only).
 */
import type { IssueView } from "../ports/linear-port.js";
import type { TrackerDiagnostic } from "./credentials.js";

/** Platform connection page-size ceiling (R6; validated + clamped). */
export const PLATFORM_CONNECTION_MAX = 250;

/** Variables consumed by the `issues` document's per-team filter (T017). */
export interface IssueFilterVariables {
  readonly teamKey: string;
  readonly projectIds: readonly string[];
  readonly ignoredStateTypes: readonly string[];
}

/** Server-side per-team filter construction — per team ONLY, never a global union (R6). */
export function buildIssuesFilterVariables(
  teamKey: string,
  projectIds: readonly string[],
  ignoredStateTypes: readonly string[],
): IssueFilterVariables {
  return {
    teamKey,
    projectIds: [...projectIds],
    ignoredStateTypes: [...ignoredStateTypes],
  };
}

/**
 * Pure client-side guard re-checking every returned row against ITS team's scope:
 * row.teamKey === the queried team, row.projectId ∈ that team's configured project ids,
 * row.stateType ∉ that team's ignored types. A false verdict aborts the listing (the caller
 * decides) — a violating row is never leaked downstream.
 */
export function issueInScope(
  row: IssueView,
  teamKey: string,
  projectIds: ReadonlySet<string>,
  ignoredStateTypes: ReadonlySet<string>,
): boolean {
  return (
    row.teamKey === teamKey && projectIds.has(row.projectId) && !ignoredStateTypes.has(row.stateType)
  );
}

/**
 * `IssueScope.pageSize` → connection `first`: validated 1..250, clamped with a
 * `page-size-clamped` diagnostic naming the `pageSize` config key (never a value).
 */
export function clampPageSize(raw: number, report: (d: TrackerDiagnostic) => void): number {
  if (!Number.isFinite(raw) || raw < 1) {
    report({
      code: "page-size-clamped",
      message: "pageSize requested below the minimum of 1 — clamped to 1",
    });
    return 1;
  }
  const whole = Math.floor(raw);
  if (whole > PLATFORM_CONNECTION_MAX) {
    report({
      code: "page-size-clamped",
      message: `pageSize exceeds the platform connection maximum — clamped to ${PLATFORM_CONNECTION_MAX}`,
    });
    return PLATFORM_CONNECTION_MAX;
  }
  return whole;
}
