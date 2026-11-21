/**
 * Zero-dependency basename/dir-name glob matcher (research R2; contracts/discovery-api.md
 * rule 2). Supports exact names plus `*` (any run of characters, never crossing `/`),
 * `?` (single character), and `[abc]`/`[a-z]`/`[!x]` classes; case-sensitive.
 * Task-file patterns match the file BASENAME; skip-directory patterns match the directory
 * NAME at any depth (001 R1.3). Compiled once per discovery run by callers.
 *
 * A-022-1 (022) adds {@link compilePathPattern}: the same per-segment grammar lifted to
 * FULL root-relative POSIX paths — `*` occupies exactly one path segment, `**` zero or
 * more segments (segment semantics consistent with the 017 A-3 exclusion grammar),
 * anchored against the whole path.
 */

/** Translate one path segment's glob body into a regex source (no anchors). */
function segmentToRegExpSource(segment: string, wholeSegmentStar = false): string {
  let source = "";
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i] as string;
    if (ch === "*") {
      // Path grammar (A-022-1): a whole-`*` segment must EXIST (`[^/]+`). Name grammar
      // (frozen 003 rule 2): `*` is any run of characters within the name.
      source += wholeSegmentStar && segment === "*" ? "[^/]+" : "[^/]*";
      i += 1;
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else if (ch === "[") {
      // Class: scan for the terminating ']' (a ']' first in the body is a literal).
      let j = i + 1;
      let body = "";
      if (segment[j] === "!" || segment[j] === "^") {
        body += "^"; // glob negation '!' maps to regex negation '^'
        j += 1;
      }
      if (segment[j] === "]") {
        body += "\\]";
        j += 1;
      }
      for (; j < segment.length && segment[j] !== "]"; j += 1) {
        const c = segment[j] as string;
        // Inside a class only '\' and ']' need escaping; '-' stays a range operator.
        body += c === "\\" || c === "]" ? `\\${c}` : c;
      }
      if (j >= segment.length) {
        // Unterminated class — treat '[' as a literal.
        source += "\\[";
        i += 1;
      } else {
        source += `[${body}]`;
        i = j + 1;
      }
    } else {
      // Literal — escape regex metacharacters.
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return source;
}

/** Translate a name glob into an anchored regex source. */
function globToRegExpSource(pattern: string): string {
  return `^${segmentToRegExpSource(pattern)}$`;
}

/**
 * Compile one name pattern into a case-sensitive whole-name matcher.
 * Exported for config-validation reuse (research R2).
 */
export function compileNamePattern(pattern: string): (name: string) => boolean {
  const re = new RegExp(globToRegExpSource(pattern));
  return (name: string): boolean => re.test(name);
}

/**
 * A-022-1 (022; contracts/spec-kitty-work-packages.md C1.1) — compile a PATH-scoped
 * candidate pattern into a case-sensitive matcher over a FULL root-relative POSIX path.
 * Segment grammar identical to {@link compileNamePattern}; segment semantics identical
 * to the 017 A-3 exclusion grammar:
 * - `*` occupies exactly ONE path segment (never crosses `/`); a whole-`*` segment is
 *   non-empty;
 * - `**` occupies ZERO OR MORE whole segments and carries its own separators —
 *   between two segments it matches nothing, one whole segment, or several; a trailing
 *   `**` segment matches the parent itself and everything beneath it;
 * - matching is ANCHORED against the whole path — no prefix or suffix leak.
 */
export function compilePathPattern(pattern: string): (relPath: string) => boolean {
  const segments = pattern.split("/");
  let source = "";
  let needSeparator = false; // the previous emitted part does not itself carry the following '/'
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    const isLast = i === segments.length - 1;
    if (segment === "**") {
      if (isLast) {
        // trailing `**` — this segment plus zero or more deeper segments
        source += source === "" ? ".*" : "(?:/.*)?";
      } else if (source === "") {
        // leading `**/` — zero or more leading segments, each carrying its trailing '/'
        source += "(?:[^/]+/)*";
        needSeparator = false;
      } else {
        // middle — zero or more whole segments, each preceded by '/'
        source += "(?:/[^/]+)*";
        needSeparator = true; // the NEXT regular segment still needs its own separator ('**' = zero case)
      }
      continue;
    }
    if (source !== "" && needSeparator) source += "/";
    source += segmentToRegExpSource(segment, true);
    needSeparator = true;
  }
  const re = new RegExp(`^${source}$`);
  return (relPath: string): boolean => re.test(relPath);
}
