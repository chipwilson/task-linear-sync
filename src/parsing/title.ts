/**
 * Title cleaning (research R9; FR-011 cleaning scope verbatim: "titles are cleaned of
 * configured strip prefixes, redundant issue prefixes, and duplicate leading local-ID
 * prefixes").
 *
 * Strips, ITERATING TO A FIXPOINT (compound stale prefixes like
 * `[A-1] [A-2] Task 1: …` from past drift need more than one pass):
 *  - each configured `titleStripPrefixes` value (leading);
 *  - visible issue references `[<KEY>-<N>]` for the configured key (anywhere — matching
 *    parse-side stripping) and the bare `<KEY>-<N>` form (leading only);
 *  - a leading local-ID prefix duplicate (`Task 1.2:`, `T001 —`) when the task already
 *    carries that ID;
 *  - capability-tag tokens matching `titleTagPattern` (017 amendment 2; anywhere) when the
 *    caller supplies one — DERIVED titles only: extraction, storage, and the renderer's
 *    file rewrite never pass the member, so repository files keep tags verbatim;
 * then collapses resulting duplicate whitespace.
 *
 * Idempotency (Principle IV): cleaning is fixpoint-stable, so render→parse→render emits
 * identical titles with NO progressive prefixing. Exported for 005's derivation reuse
 * and for the renderer's self-use. Parse stores the RAW title (frozen field semantics) —
 * cleaning happens only here and inside the renderer.
 */
import { escapeRegExp } from "./content.js";

export interface CleanTitleOptions {
  readonly confirmationKey: string;
  readonly localTaskId?: string;
  readonly titleStripPrefixes: readonly string[];
  /** Regex source of capability tags to strip (017 amendment 2); absent ⇒ no tag stripping (SC-005). */
  readonly titleTagPattern?: string;
}

export function cleanTitle(text: string, opts: CleanTitleOptions): string {
  const bracketedRef = new RegExp(`\\[${escapeRegExp(opts.confirmationKey)}-\\d+\\]`, "gu");
  const bareLeadingRef = new RegExp(`^${escapeRegExp(opts.confirmationKey)}-\\d+\\b[ \\t]*`, "u");
  const titleTags = opts.titleTagPattern !== undefined ? new RegExp(opts.titleTagPattern, "gu") : undefined;
  const localIdPrefix =
    opts.localTaskId !== undefined
      ? new RegExp(`^${escapeRegExp(opts.localTaskId)}[ \\t]*[.:—–-]?[ \\t]+`, "u")
      : undefined;

  let current = text;
  let changed = true;
  while (changed) {
    changed = false;
    const before = current;

    current = current.replace(/^[ \t]+/u, "");
    if (opts.titleStripPrefixes.length > 0) {
      for (const prefix of opts.titleStripPrefixes) {
        if (prefix.length > 0 && current.startsWith(prefix)) {
          current = current.slice(prefix.length);
          changed = true;
          break; // re-enter the loop: prefixes may nest/recur (fixpoint iteration)
        }
      }
    }
    if (bracketedRef.test(current)) {
      current = current.replace(bracketedRef, " ").replace(/^[ \t]+/u, "");
      changed = true;
    }
    if (bareLeadingRef.test(current)) {
      current = current.replace(bareLeadingRef, "");
      changed = true;
    }
    if (localIdPrefix && localIdPrefix.test(current)) {
      current = current.replace(localIdPrefix, "");
      changed = true;
    }
    if (titleTags && titleTags.test(current)) {
      current = current.replace(titleTags, " ").replace(/^[ \t]+/u, "");
      changed = true;
    }
    if (before === current) changed = false;
  }

  return current.replace(/[ \t]{2,}/gu, " ").replace(/[ \t]+$/u, "").trim();
}
