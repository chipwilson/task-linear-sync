/**
 * Description-normalization profile registry (research R5; data-model §3 hash baseline;
 * SC-002; task T009 implements; unit tests T005).
 * Built-in profile `"default"`: CRLF/CR→LF, tabs-in-blank-lines stripped, trailing
 * whitespace per line removed, blank-line runs collapsed to one, single trailing newline
 * enforced, Unicode NFC. It never alters content-bearing Markdown (emphasis, list
 * markers, heading `#` counts, code fences). Consumers extend the registry
 * programmatically via `EngineOptions.normalizationProfiles` (constitution III).
 */
import { createHash } from "node:crypto";
import { EngineError } from "./errors.js";
import type { DescriptionNormalizer } from "./options.js";

/** DescriptionNormalizer — canonical home is `options.ts` (frozen contract block); re-exported here. */
export type { DescriptionNormalizer };

/** Name of the built-in profile resolved for `config.descriptionNormalizationProfile` = "default". */
export const DEFAULT_NORMALIZATION_PROFILE_NAME = "default";

/**
 * The built-in `"default"` profile function (idempotent, round-trip-equating —
 * `normalize(mirror(render(x))) === normalize(x)`, research R3/R5). T009 implements (T005).
 *
 * Rule order (each line rule is content-blind — it strips only formatting-only drift):
 * 1. Unicode NFC (canonical composition — never NFKC, so compatibility forms survive).
 * 2. CRLF/CR → LF (every terminator, including a lone trailing CR).
 * 3. Trailing whitespace (spaces/tabs) removed per line; leading indentation survives.
 * 4. Runs of blank lines (incl. whitespace-only lines after step 3) collapse to one.
 * 5. Exactly one trailing newline enforced; a blank-only document normalizes to `""`.
 */
export const defaultDescriptionNormalizer: DescriptionNormalizer = (text: string): string => {
  let out = text.normalize("NFC").replace(/\r\n?/gu, "\n");
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");
  out = out.replace(/\n{3,}/gu, "\n\n"); // blank-line runs → a single blank line
  out = out.replace(/\n+$/u, ""); // trailing-newline drift; the single final "\n" is re-added below
  return out === "" ? "" : `${out}\n`;
};

/**
 * Built-in profile registry (only `"default"` ships built-in; research R5).
 * A frozen snapshot — extension happens per resolution through
 * {@link resolveNormalizationProfile}, never by mutating this record (T009).
 */
const BUILT_IN_PROFILES: Readonly<Record<string, DescriptionNormalizer>> = Object.freeze({
  [DEFAULT_NORMALIZATION_PROFILE_NAME]: defaultDescriptionNormalizer,
});

/**
 * Built-in profile registry (only `"default"` ships built-in; research R5).
 * T009 implements (T005).
 */
export function builtInNormalizationProfiles(): Readonly<
  Record<string /* profile name */, DescriptionNormalizer>
> {
  return BUILT_IN_PROFILES;
}

/**
 * Resolve a configured profile name against built-ins plus programmatic extensions
 * (`EngineOptions.normalizationProfiles`; deep-merge precedence per constitution III:
 * built-in ⇒ config-file ⇒ programmatic). Unknown names fail loudly — never silently
 * fall back. T009 implements (T005).
 *
 * The built-in `"default"` is *always present* (it can never be removed), yet an
 * extension entry named `"default"` overrides the built-in behavior (III: every default
 * is overridable). Lookups are own-property only — inherited `Object` members
 * (`toString`, `constructor`, …) never resolve as profiles.
 */
export function resolveNormalizationProfile(
  name: string,
  extensions?: Readonly<Record<string, DescriptionNormalizer>>,
): DescriptionNormalizer {
  if (extensions !== undefined && Object.hasOwn(extensions, name)) {
    return extensions[name];
  }
  if (Object.hasOwn(BUILT_IN_PROFILES, name)) {
    return BUILT_IN_PROFILES[name];
  }
  throw new EngineError(
    `unknown description-normalization profile "${name}" — resolved names must be built-in or registered via EngineOptions.normalizationProfiles`,
  );
}

/**
 * `sha256(normalize(text))` hex — the single hash baseline per task (research R3):
 * checkpoint storage, `specHash`, and `linearHash` all use this exact construction so
 * formatting-only drift is permanently invisible (SC-002). Consumed by `classify.ts`
 * (T020) and `payload.ts` (T042). T009 implements (T005).
 */
export function normalizedContentHash(
  normalizer: DescriptionNormalizer,
  text: string,
): string {
  return createHash("sha256").update(normalizer(text), "utf8").digest("hex");
}
