/**
 * T003 — title-rule + title fixtures. The rule presets follow the 001 Requirement 6
 * informative-note shape with `<areaPrefixA/B/C>` placeholder area prefixes (consumers supply
 * the real values; the tool ships none — 001 R6.7). Preset titles exercise the render-back
 * strip set. **All prefixes are placeholders; zero org/product literals.**
 */
import type { TitleConfigSlice } from "../../../src/titles/types.js";

/**
 * 001 R6 informative-note mapping onto the research-R2 grammar:
 *  0. infrastructure area + local ID → `<areaPrefixA> {localId}: {title}`
 *  1. delivery area + phase          → `<areaPrefixB> Phase {phase}: {title}`
 *  2. delivery area without phase    → `<areaPrefixB>: {title}`
 *  3. checklist child task           → raw `{title}`
 *  4. bare-template catch-all        → `<areaPrefixC>: {title}`
 */
export const areaRuleSet: readonly string[] = [
  "path~specs/infra/, localId => <areaPrefixA> {localId}: {title}",
  "path~specs/delivery/, phase => <areaPrefixB> Phase {phase}: {title}",
  "path~specs/delivery/, !phase => <areaPrefixB>: {title}",
  "child => {title}",
  "<areaPrefixC>: {title}",
];

/**
 * Consumer-supplied strip prefixes that invert `areaRuleSet` (001 R6 informative note:
 * "corresponding strip-prefixes for {areaPrefixA}, {areaPrefixB} (optionally followed by
 * `Phase <n>`), and {areaPrefixC}"). Phase-valued entries mirror `phasePool` below.
 */
export const areaStripPrefixes: readonly string[] = [
  "<areaPrefixA> ",
  "<areaPrefixB> Phase Setup: ",
  "<areaPrefixB> Phase Delivery: ",
  "<areaPrefixB>: ",
  "<areaPrefixC>: ",
];

/** Bare-template catch-all: a rule string with no ` => ` guard is a catch-all (research R2). */
export const bareCatchAllRules: readonly string[] = ["{title}"];

/** Rules whose guards never match any fixture path → pass-through behavior (001 R6.2). */
export const unmatchedRules: readonly string[] = [
  "path~docs/nowhere-ever/, localId => [{prefix}] {title}",
];

/** A matched rule referencing an attribute the task may not carry → unresolved indicator (001 R6.5). */
export const absentAttrRules: readonly string[] = ["featureName => [{phase}] {title}", "{title}"];

/** Built-in default posture: no strip prefixes configured (001 R6.7 default strip applies). */
export const emptyStripPrefixes: readonly string[] = [];

/** `TitleConfigSlice` builder — defaults mirror the built-in (empty rules, default strip). */
export function makeTitleSlice(overrides: Partial<TitleConfigSlice> = {}): TitleConfigSlice {
  return { titleRules: [], titleStripPrefixes: [], confirmationKey: "SYNC", ...overrides };
}

/** Preset titles already carrying prefixes (spec US2 Independent Test) — placeholders only. */
export const decoratedTitle = "user-authentication: Add login flow";
export const issuePrefixedTitle = "[SYNC-7] Fix token refresh";
export const localIdPrefixedTitle = "Task 1.2: Wire session store";
export const allPrefixedTitle = "user-authentication: [SYNC-7] Task 1.2: Rotate signing keys";

/** Clean raw-title pool for generated round-trip tasks (never already-prefixed). */
export const cleanTitlePool: readonly string[] = [
  "Add login flow",
  "Rotate signing keys",
  "Refund partial charges",
  "Emit delivery artifacts",
  "Instrument request tracing",
];

/** Feature-name pool (001 R6.8 example vocabulary — benign placeholders). */
export const featurePool: readonly (string | undefined)[] = [
  undefined,
  "user-authentication",
  "payments-refund",
];

/** Phase pool — every value has a matching concrete entry in `areaStripPrefixes`. */
export const phasePool: readonly (string | undefined)[] = [undefined, "Setup", "Delivery"];

/** Path pool spanning every `areaRuleSet` guard (infra, delivery, catch-all-only areas). */
export const pathPool: readonly string[] = [
  "specs/infra/auth/spec.md",
  "specs/infra/deploy.md",
  "specs/delivery/pipeline/spec.md",
  "specs/delivery/release.md",
  "specs/other/misc.md",
];
