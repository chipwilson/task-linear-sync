/**
 * T022 — `discover-metadata` (research R7): guarded `port.discoverMetadata(configured
 * team keys)` → screened per-team projects + workflow-states listing (the frozen
 * `TeamMetadataCollections` carries exactly these two collections), deterministic order,
 * zero writes (allowed write prefixes `[]`, enforced by the lane guard in `runCli`).
 */
import type { CommandHandler } from "../index.js";

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : byId(a as unknown as { id: string }, b as unknown as { id: string });
}

export const discoverMetadataHandler: CommandHandler = async (run) => {
  const teamKeys = Object.keys(run.config.teams).sort();
  const collections = await run.port.discoverMetadata(teamKeys);
  const ordered = [...collections].sort((a, b) => (a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
  for (const collection of ordered) {
    run.out.write(`team ${collection.teamKey}`);
    for (const project of [...collection.projects].sort(byId)) {
      run.out.write(`  project ${project.id}  ${project.name}`);
    }
    for (const state of [...collection.workflowStates].sort(byName)) {
      run.out.write(`  state ${state.name}  type=${state.type}`);
    }
  }
  run.out.write(`discover-metadata: ${ordered.length} teams`);
  return 0;
};
