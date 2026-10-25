/**
 * `decorateFeaturePrefix` — the built-in, NON-CONFIGURABLE `<Feature_Name>: ` decoration
 * applied after every derivation path (research R4; 001 R6.8–R6.11; FR-004/FR-005).
 * Detect-then-maybe-prepend on the EXACT prefix is what makes repeated derivations
 * byte-for-byte identical; a fuzzy match is forbidden (it could mangle a legitimately
 * different title — R4 alternatives).
 */

/**
 * When `featureName` is present: if `baseTitle` already begins with the exact
 * `"<featureName>: "` prefix it is returned unchanged, else the prefix is prepended ONCE.
 * An absent or empty `featureName` adds no prefix (FR-005 / 001 R6.11).
 */
export function decorateFeaturePrefix(baseTitle: string, featureName: string | undefined): string {
  if (featureName === undefined || featureName === "") {
    return baseTitle;
  }
  const prefix = `${featureName}: `;
  return baseTitle.startsWith(prefix) ? baseTitle : `${prefix}${baseTitle}`;
}
