/**
 * Description-normalization profile registry (research R5; data-model §3 hash baseline;
 * SC-002; task T009 implements; unit tests T005).
 * Built-in profile `"default"`: CRLF/CR→LF, tabs-in-blank-lines stripped, trailing
 * whitespace per line removed, blank-line runs collapsed to one, single trailing newline
 * enforced, Unicode NFC. It never alters content-bearing Markdown (emphasis, list
 * markers, heading `#` counts, code fences). Consumers extend the registry
 * programmatically via `EngineOptions.normalizationProfiles` (constitution III).
 */
import type { DescriptionNormalizer } from "./options.js";

/** DescriptionNormalizer — canonical home is `options.ts` (frozen contract block); re-exported here. */
export type { DescriptionNormalizer };

/** Name of the built-in profile resolved for `config.descriptionNormalizationProfile` = "default". */
export const DEFAULT_NORMALIZATION_PROFILE_NAME = "default";

/**
 * The built-in `"default"` profile function (idempotent, round-trip-equating —
 * `normalize(mirror(render(x))) === normalize(x)`, research R3/R5). T009 implements (T005).
 */
export const defaultDescriptionNormalizer: DescriptionNormalizer = (_text: string): string => {
  throw new Error("not implemented: normalize");
};

/**
 * Built-in profile registry (only `"default"` ships built-in; research R5).
 * T009 implements (T005).
 */
export function builtInNormalizationProfiles(): Readonly<
  Record<string /* profile name */, DescriptionNormalizer>
> {
  throw new Error("not implemented: normalize");
}

/**
 * Resolve a configured profile name against built-ins plus programmatic extensions
 * (`EngineOptions.normalizationProfiles`; deep-merge precedence per constitution III:
 * built-in ⇒ config-file ⇒ programmatic). Unknown names fail loudly — never silently
 * fall back. T009 implements (T005).
 */
export function resolveNormalizationProfile(
  name: string,
  extensions?: Readonly<Record<string, DescriptionNormalizer>>,
): DescriptionNormalizer {
  void [name, extensions]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: normalize");
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
  void [normalizer, text]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: normalize");
}
