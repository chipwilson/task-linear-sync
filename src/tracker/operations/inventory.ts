/**
 * T030 [US1] — real inventory operations replacing the T023 shell (contracts/tracker-adapter.md
 * rows 1–2): `listIssues` = per-team `issues` page loops (sequential cursor, complete-page
 * yields via `pagination.ts`) with the R6 two-layer enforcement — the server-side filter is
 * built PER TEAM (never a global union) and the shared client-side guard re-checks every row,
 * ABORTING the listing on a team/project violation ("per-team scoping never leaks": a violating
 * row is never yielded, never silent) while an ignored-state row is excluded as data. Teams
 * proceed in configured `teamKeys` order; the first listIssues warms the R10 discovery cache
 * with ONE batched `teamMetadata` query. `discoverMetadata` = one query mapped to the three
 * collections per team, in requested order — an unresolvable scope identity is a
 * `TrackerConfigError` naming team + identity, pre-dispatch, never a silent empty page.
 */
import type { IssueScope, IssueView, TeamMetadataCollections } from "../../ports/linear-port.js";
import { TrackerConfigError, TrackerError } from "../errors.js";
import { buildIssuesFilterVariables, clampPageSize, issueInScope } from "../scoping.js";
import { paginate } from "../pagination.js";
import type { PageSlice } from "../pagination.js";
import { asList, asRecord, mapIssueNodes, mapTeamNodeFull, nodesOf, type TeamDiscoveryRecord } from "../graphql/mapping.js";
import type { TrackerContext } from "../internal/request.js";

/** ONE `teamMetadata` query for `teamKeys`; mapped, uncached team records. */
async function fetchTeamRecords(ctx: TrackerContext, teamKeys: readonly string[]): Promise<TeamDiscoveryRecord[]> {
  const data = await ctx.exec.exec(
    "teamMetadata",
    { teamKeys: [...teamKeys] },
    (d) => nodesOf(asRecord(d["teams"]) ?? null).map(mapTeamNodeFull),
    { retryClass: "non-create" },
  );
  return data;
}

/** R10: "empty → warm(per-team)" — one batched discovery for every not-yet-resolved team. */
async function warmDiscovery(ctx: TrackerContext, teamKeys: readonly string[]): Promise<void> {
  const missing = teamKeys.filter((key) => !ctx.discovery.has(key));
  if (missing.length === 0) return;
  ctx.discovery.warm(await fetchTeamRecords(ctx, missing));
}

function scopeViolation(ctx: TrackerContext, teamKey: string, row: IssueView): TrackerError {
  return new TrackerError({
    category: "client",
    retryable: false,
    attempts: 1,
    detail: ctx.sanitize(
      `issues payload for team '${teamKey}' carried out-of-scope row '${row.key}' (teamKey '${row.teamKey}', project '${row.projectId}') — per-team scoping never leaks; listing aborted`,
    ),
  });
}

async function fetchIssuePage(
  ctx: TrackerContext,
  variables: Record<string, unknown>,
): Promise<PageSlice<IssueView>> {
  return ctx.exec.exec(
    "issues",
    variables,
    (d) => {
      const connection = asRecord(d["issues"]);
      const pageInfo = asRecord(connection?.["pageInfo"]);
      return {
        rows: mapIssueNodes(asList(connection?.["nodes"])),
        endCursor: typeof pageInfo?.["endCursor"] === "string" ? pageInfo["endCursor"] : null,
        hasNextPage: pageInfo?.["hasNextPage"] === true,
      };
    },
    { retryClass: "non-create" },
  );
}

export async function* listIssuesImpl(ctx: TrackerContext, scope: IssueScope): AsyncIterableIterator<IssueView> {
  const first = clampPageSize(scope.pageSize, ctx.diagnostics);
  await warmDiscovery(ctx, scope.teamKeys);
  for (const teamKey of scope.teamKeys) {
    const entry = scope.perTeam[teamKey];
    if (!entry) {
      throw new TrackerConfigError(
        `IssueScope.perTeam has no entry for team '${teamKey}' — per-team filters never leak, so every team needs its own`,
      );
    }
    ctx.discovery.requireTeam(teamKey);
    const projectIds = ctx.discovery.resolveProjectIds(teamKey, entry.projects);
    const projectIdSet = new Set(projectIds);
    const ignoredSet = new Set(entry.ignoredStateTypes);
    const filter = buildIssuesFilterVariables(teamKey, projectIds, entry.ignoredStateTypes);
    const pages = paginate((after) => fetchIssuePage(ctx, { ...filter, first, after }));
    for await (const row of pages) {
      if (issueInScope(row, teamKey, projectIdSet, ignoredSet)) {
        yield row;
        continue;
      }
      // Violation split (R6 belt-and-braces): a TEAM or PROJECT mismatch is a payload leak —
      // abort, never yield. An ignored-STATE row is ordinary data filtered from the inventory.
      if (row.teamKey !== teamKey || !projectIdSet.has(row.projectId)) throw scopeViolation(ctx, teamKey, row);
    }
  }
}

export async function discoverMetadataImpl(
  ctx: TrackerContext,
  teamKeys: readonly string[],
): Promise<ReadonlyArray<TeamMetadataCollections>> {
  if (teamKeys.length === 0) return [];
  ctx.discovery.warm(await fetchTeamRecords(ctx, teamKeys));
  return teamKeys.map((key): TeamMetadataCollections => {
    const record = ctx.discovery.get(key);
    if (!record) {
      throw new TrackerConfigError(`team '${key}' was not resolved by discovery — unknown team identity`);
    }
    return {
      teamKey: record.teamKey,
      projects: record.projects.map((p) => ({ ...p })),
      workflowStates: record.workflowStates.map((s) => ({ ...s })),
    };
  });
}
