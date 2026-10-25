/**
 * Zero-dependency basename/dir-name glob matcher (research R2; contracts/discovery-api.md
 * rule 2). Supports exact names plus `*` (any run of characters, never crossing `/`),
 * `?` (single character), and `[abc]`/`[a-z]`/`[!x]` classes; case-sensitive.
 * Task-file patterns match the file BASENAME; skip-directory patterns match the directory
 * NAME at any depth (001 R1.3). Compiled once per discovery run by callers.
 */

/** Translate a name glob into an anchored regex source. */
function globToRegExpSource(pattern: string): string {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      source += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else if (ch === "[") {
      // Class: scan for the terminating ']' (a ']' first in the body is a literal).
      let j = i + 1;
      let body = "";
      if (pattern[j] === "!" || pattern[j] === "^") {
        body += "^"; // glob negation '!' maps to regex negation '^'
        j += 1;
      }
      if (pattern[j] === "]") {
        body += "\\]";
        j += 1;
      }
      for (; j < pattern.length && pattern[j] !== "]"; j += 1) {
        const c = pattern[j] as string;
        // Inside a class only '\' and ']' need escaping; '-' stays a range operator.
        body += c === "\\" || c === "]" ? `\\${c}` : c;
      }
      if (j >= pattern.length) {
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
  return `^${source}$`;
}

/**
 * Compile one name pattern into a case-sensitive whole-name matcher.
 * Exported for config-validation reuse (research R2).
 */
export function compileNamePattern(pattern: string): (name: string) => boolean {
  const re = new RegExp(globToRegExpSource(pattern));
  return (name: string): boolean => re.test(name);
}
