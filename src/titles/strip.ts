/**
 * `stripTitleForRender` — the canonical render-back strip 004 honors for the title field
 * (research R6; 001 R6.6/R6.7/R6.12; FR-004). Removes from the FRONT, IN ORDER:
 *
 *  1. the leading `"<featureName>: "` prefix this same module decorates (R6.12);
 *  2. each configured `titleStripPrefixes` entry (leading the 003 adapter default strip
 *     prefixes, 001 R7.4/R7.5) — each entry removes at most one leading occurrence;
 *  3. a redundant leading `[<confirmationKey>-<N>]` issue prefix (recognized ONLY via the
 *     configured confirmationKey, never a constant — 001 R17.7);
 *  4. a duplicate leading `"<localTaskId>: "` prefix — "only when the preserved line already
 *     carries that identifier" (001 R5.2/R6.7): a task HAS a `localTaskId` only when the
 *     line grammar matched it, i.e. the rendered line carries it, so a title-level duplicate
 *     is exactly what would double-render.
 *
 * With an empty `titleStripPrefixes` the built-in default strip applies — local-ID prefix +
 * redundant issue prefix only, NO other prefix (001 R6.7: no org/product literals). All
 * other characters are preserved unchanged.
 */
import type { Task } from "../domain/task.js"; // FROZEN 002 — imported, not redefined
import type { TitleConfigSlice } from "./types.js";

/** Escape a consumer-supplied key for safe embedding in a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ordered, leading-only prefix removal shared by every strip step. */
function dropLeading(title: string, prefix: string): string {
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/**
 * Produce the title as 004 should write it back into Markdown. Applying this to
 * `deriveTitle` output and re-deriving reproduces the same final title byte-for-byte —
 * titles are never progressively prefixed across runs (SC-002).
 */
export function stripTitleForRender(finalTitle: string, task: Task, config: TitleConfigSlice): string {
  let title = finalTitle;

  // 1. The feature prefix this feature's own decoration adds (R6.12) — always removed first.
  if (task.featureName !== undefined && task.featureName !== "") {
    title = dropLeading(title, `${task.featureName}: `);
  }

  // 2. Every configured strip-prefix pattern, in config order, leading occurrence only.
  for (const stripPrefix of config.titleStripPrefixes) {
    if (stripPrefix === "") continue;
    title = dropLeading(title, stripPrefix);
  }

  // 3. Redundant leading [<confirmationKey>-<N>] issue prefix (bracket + separating spaces).
  if (config.confirmationKey !== "") {
    const issuePrefix = new RegExp(`^\\[${escapeRegExp(config.confirmationKey)}-\\d+\\]\\s*`);
    title = title.replace(issuePrefix, "");
  }

  // 4. Duplicate leading "<localTaskId>: " — only when the preserved line carries the id
  //    (a parsed localTaskId implies the line grammar matched it on the rendered line).
  if (task.localTaskId !== undefined && task.localTaskId !== "") {
    title = dropLeading(title, `${task.localTaskId}: `);
  }

  return title;
}
