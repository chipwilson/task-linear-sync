/**
 * Shared R10 discovery plumbing (used by inventory, mutations, and anything else resolving
 * configured identities through the per-instance cache): ONE batched `teamMetadata` query warms
 * `DiscoveryCache`; `ensureTeam` lazily resolves a single team key. Discovery is `non-create`
 * retried like any other read; identity resolution itself stays pre-dispatch on the caller's
 * side (unknown identity ⇒ `TrackerConfigError` naming team + identity — "so it is not
 * indeterminate").
 */
import { asRecord, mapTeamNodeFull, nodesOf, type TeamDiscoveryRecord } from "../graphql/mapping.js";
import type { TrackerContext } from "./request.js";

export async function fetchTeamRecords(ctx: TrackerContext, teamKeys: readonly string[]): Promise<TeamDiscoveryRecord[]> {
  return ctx.exec.exec(
    "teamMetadata",
    { teamKeys: [...teamKeys] },
    (d) => nodesOf(asRecord(d["teams"])).map(mapTeamNodeFull),
    { retryClass: "non-create" },
  );
}

/** R10 "empty → warm(per-team)": one batched discovery for every not-yet-resolved team. */
export async function warmDiscovery(ctx: TrackerContext, teamKeys: readonly string[]): Promise<void> {
  const missing = teamKeys.filter((key) => !ctx.discovery.has(key));
  if (missing.length === 0) return;
  ctx.discovery.warm(await fetchTeamRecords(ctx, missing));
}

/** Resolve ONE team key (lazily warming a cold cache with its single-key query). */
export async function ensureTeam(ctx: TrackerContext, teamKey: string): Promise<TeamDiscoveryRecord> {
  if (!ctx.discovery.has(teamKey)) {
    ctx.discovery.warm(await fetchTeamRecords(ctx, [teamKey]));
  }
  return ctx.discovery.requireTeam(teamKey);
}
