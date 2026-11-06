/**
 * T042 [P] — manual sandbox cleanup for the 010 integration/e2e harnesses
 * (`specs/010-background-queue-sync-hooks`, quickstart §9.1). Production harnesses keep
 * tmp roots until process exit; this module gives teardown code the two documented
 * removal lanes — git metadata in the sandbox repo and queue residue in the state dir —
 * so a long-lived harness can recycle a sandbox without deleting the whole tmp root.
 * `makeQueueHarness().dispose()` uses both before removing its root (belt and braces).
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Queue-owned records/directories inside a state dir (queue-protocol §2–§4 + run reports). */
const QUEUE_RESIDUE = ["pending-job.json", "queue-lock.json", "last-run.json", "reports"] as const;

/** Remove the sandbox repository's `.git` metadata tree (the harness fake or a real worktree copy). */
export function removeGitMetadata(repositoryRoot: string): void {
  rmSync(join(repositoryRoot, ".git"), { recursive: true, force: true, maxRetries: 3 });
}

/** Remove every queue artifact from a state dir; returns the names that existed. */
export function removeQueueArtifacts(stateDir: string): string[] {
  const removed: string[] = [];
  for (const name of QUEUE_RESIDUE) {
    const target = join(stateDir, name);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true, maxRetries: 3 });
      removed.push(name);
    }
  }
  return removed;
}
