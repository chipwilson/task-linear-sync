/**
 * T039 helper (NOT a test file — not matched by the test glob). Child contender in the
 * lock-race integration test: acquires the advisory run lock in the given state directory
 * and writes {"acquired":bool,...} as a single JSON line to the result path.
 * argv: <stateDir> <runId> <fakeRepoRoot> <resultPath>
 */
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

import { acquireRunLock, createStateStore, systemClock } from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";

const [stateDir, runId, repoRoot, resultPath] = process.argv.slice(2);
if (!stateDir || !runId || !repoRoot || !resultPath) {
  console.error("usage: lock-race-child <stateDir> <runId> <repoRoot> <resultPath>");
  process.exit(2);
}

mkdirSync(repoRoot, { recursive: true });
const store = createStateStore({
  repositoryRoot: repoRoot,
  config: loadConfig({ overrides: { stateDirectory: stateDir } }),
  clock: systemClock,
});
await store.ensure();
const result = await acquireRunLock(store, runId);
writeFileSync(resultPath, JSON.stringify({ runId, ...result }));
