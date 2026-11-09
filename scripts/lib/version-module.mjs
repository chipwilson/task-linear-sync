/**
 * Feature 015 (T007/R4) — the shared renderer for the generated version module.
 * Kept separate from scripts/gen-version.mjs so tests can re-render and
 * byte-diff WITHOUT executing the CLI script. Zero dependencies.
 */

/** @param {string} version @returns {string} exact content of src/version.generated.ts */
export function renderVersionModule(version) {
  return `/**
 * GENERATED — DO NOT EDIT (scripts/gen-version.mjs via prebuild; feature 015 R4).
 *
 * The single embedded source of the package version: \`package.json.version\` is
 * the ONLY version source (FR-002); \`SERVER_VERSION\` (MCP) and the CLI
 * \`--version\` output derive from here. \`npm run prebuild\` rewrites this file;
 * tests/contract/version-drift.test.ts refuses drift.
 */
export const PACKAGE_VERSION = "${version}";
`;
}
