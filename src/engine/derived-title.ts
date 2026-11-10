/**
 * Engine-side derived-title helper (017 C3.5; contracts/spec-kitty-adapter.md).
 *
 * `deriveTitle(task, config).baseTitle` is the 005 comparison title; adapters that
 * carry `titleTagPattern` (spec-kitty today) additionally run it through 004
 * `cleanTitle` WITH the member, so capability tags vanish from every derived and
 * mirrored ISSUE title. Adapters without the member — all five pre-017 identities —
 * pass through byte-identically (SC-005 / C5.3): this function is the ONLY consumer,
 * and `cleanTitle` never receives the pattern anywhere else.
 *
 * Repository FILE lines are the mirror image: `apply.ts` rewrites them with the RAW
 * base title (`rawBaseTitle`), so tags stay file content (C3.5, C3.8).
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { FrameworkAdapter } from "../discovery/adapter.js";
import type { Task } from "../domain/task.js";
import { cleanTitle } from "../parsing/index.js";

/** `baseTitle` with capability tags stripped when — and only when — the adapter declares the grammar. */
export function adapterDerivedTitle(
  baseTitle: string,
  task: Task,
  adapter: FrameworkAdapter,
  config: ResolvedConfig,
): string {
  if (adapter.titleTagPattern === undefined) return baseTitle; // inert for the five pre-017 identities
  return cleanTitle(baseTitle, {
    confirmationKey: config.confirmationKey,
    ...(task.localTaskId !== undefined ? { localTaskId: task.localTaskId } : {}),
    titleStripPrefixes: adapter.titleBehavior?.stripPrefixes ?? [],
    titleTagPattern: adapter.titleTagPattern,
  });
}
