/**
 * Required-workspace-identity validation (research R5, FR-007, SC-002): ONE pass over the
 * fully merged config collecting ALL missing/empty required values before failing, naming
 * each. Never fail-fast-on-first-error. Empty strings and empty arrays count as absent
 * (001 R17.5). Identity values intentionally have NO defaults (constitution III), so this
 * validation is the only enforcement point and must be complete.
 */
import { MissingIdentityError, LaneMapError } from "./schema.js";
import type { ResolvedConfig } from "./schema.js";
import type { LaneName, TeamIdentity, WorkflowStateIdentities } from "../domain/routing.js";
import { LANE_VOCABULARY } from "../domain/routing.js";

const isBlank = (v: unknown): boolean =>
  typeof v !== "string" || v.trim().length === 0;

const isNonEmptyStringList = (v: unknown): boolean =>
  Array.isArray(v) && v.some((x) => !isBlank(x));

const WORKFLOW_STATE_IDENTITIES = ["backlog", "todo", "inProgress", "done"] as const;

function hasAnyWorkflowStateIdentity(ws: WorkflowStateIdentities | undefined): boolean {
  if (!ws) return false;
  return WORKFLOW_STATE_IDENTITIES.some((name) => !isBlank(ws[name]));
}

/**
 * 023 A-023-0: the optional per-team `lanes` map is validated whenever PRESENT.
 * Keys must sit inside the nine-lane vocabulary; values must be non-empty strings.
 * Every offender across every team is collected before the single fail (no partial
 * application, MissingIdentityError precedent); the diagnostic names only the
 * offending team keys — never lane values or mapping content.
 */
function collectLaneMapOffenders(c: ResolvedConfig): string[] {
  const offenders: string[] = [];
  for (const teamKey of Object.keys(c.teams ?? {})) {
    const lanes = c.teams[teamKey]?.workflowStates?.lanes as Record<string, unknown> | undefined;
    if (lanes === undefined || lanes === null) continue;
    for (const [lane, stateName] of Object.entries(lanes)) {
      if (!(LANE_VOCABULARY as readonly string[]).includes(lane)) {
        offenders.push(`teams[${teamKey}].workflowStates.lanes.${lane} (unknown lane key)`);
      }
      if (isBlank(stateName)) {
        offenders.push(`teams[${teamKey}].workflowStates.lanes.${lane} (blank state name)`);
      }
    }
  }
  return offenders;
}

/**
 * Initialization gate over the fully merged config (FR-007). Required (no defaults exist):
 * >=1 team; per team >=1 project identity and >=1 workflow-state identity; every
 * ProjectByPath entry carries teamKey AND project; default team and default project
 * non-empty. Throws MissingIdentityError naming EVERY missing value.
 */
export function validateWorkspaceIdentity(c: ResolvedConfig): void {
  const missing: string[] = [];

  const teamKeys = Object.keys(c.teams ?? {});
  if (teamKeys.length === 0) {
    missing.push("teams");
  } else {
    for (const teamKey of teamKeys) {
      const team: TeamIdentity | undefined = c.teams[teamKey];
      if (!isNonEmptyStringList(team?.projects)) {
        missing.push(`teams[${teamKey}].projects`);
      }
      if (!hasAnyWorkflowStateIdentity(team?.workflowStates)) {
        missing.push(`teams[${teamKey}].workflowStates`);
      }
    }
  }

  (c.projectByPath ?? []).forEach((entry, i) => {
    if (isBlank(entry.teamKey)) missing.push(`projectByPath[${i}].teamKey`);
    if (isBlank(entry.project)) missing.push(`projectByPath[${i}].project`);
  });

  if (isBlank(c.defaultTeamKey)) missing.push("defaultTeamKey");
  if (isBlank(c.defaultProject)) missing.push("defaultProject");

  if (missing.length > 0) {
    throw new MissingIdentityError(missing);
  }

  // A-023-0: the optional `lanes` map is checked only once every REQUIRED identity is
  // present — required-identity failures keep priority; a malformed map never lands
  // partially applied (the config is rejected whole).
  const laneOffenders = collectLaneMapOffenders(c);
  if (laneOffenders.length > 0) {
    throw new LaneMapError(laneOffenders);
  }
}
