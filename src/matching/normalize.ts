/**
 * T012 — deterministic title normalization + tokenization (research R2). One pipeline
 * used by all title signals; pure, locale-independent (casefold via `toLowerCase` —
 * never `toLocaleLowerCase`), platform-deterministic:
 *
 *  1. strip a leading visible issue-prefix token `^\[[A-Za-z0-9_-]+-\d+\]\s*`;
 *  2. strip a leading `<featureName>: ` decoration ONLY IF the task carries a
 *     `featureName` and the title begins with that exact prefix (counterpart to 005's
 *     `<Feature_Name>: ` prepend — applied identically to both sides; 006 never imports 005);
 *  3. Unicode NFKC → casefold → collapse whitespace runs to single spaces → trim;
 *  4. tokenize on the collapsed-whitespace split; fuzzy ratio is the Dice coefficient
 *     over token multisets: `2·|common multiset| / (|A| + |B|)`, 0.0 when either side empty.
 */

const VISIBLE_ISSUE_PREFIX_RE = /^\[[A-Za-z0-9_-]+-\d+\]\s*/;

/** Normalized comparison form of a title (steps 1–3 above). */
export function normalizeTitle(title: string, opts: { featureName?: string } = {}): string {
  let s = String(title);
  s = s.replace(VISIBLE_ISSUE_PREFIX_RE, "");
  if (opts.featureName !== undefined) {
    const decoration = `${opts.featureName}: `;
    if (s.startsWith(decoration)) s = s.slice(decoration.length);
  }
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Token list of a normalized title (tolerant of raw uncollapsed input). */
export function tokenize(normalized: string): string[] {
  const trimmed = String(normalized).trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

function tokenCounts(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * Dice coefficient over normalized-token MULTISETS (order-insensitive, 0.0–1.0):
 * `2·|common multiset| / (|A| + |B|)`; 0.0 when either side is empty (verbatim, R2).
 */
export function overlapRatio(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const countsA = tokenCounts(tokensA);
  const countsB = tokenCounts(tokensB);
  let common = 0;
  for (const [token, countA] of countsA) {
    const countB = countsB.get(token);
    if (countB !== undefined) common += Math.min(countA, countB);
  }
  return (2 * common) / (tokensA.length + tokensB.length);
}
