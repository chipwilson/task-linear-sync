/**
 * Deep-merge semantics (research R3) + deterministic canonical serialization (SC-001).
 * Precedence order is fixed by constitution III: defaults -> file -> programmatic.
 */
import { canonicalJson } from "../domain/plan.js";

/** Plain-object test: excludes arrays, null, and class instances? — structural check only. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Recursive merge of plain objects (higher-precedence keys replace same-keyed lower values;
 * keys absent from higher sources are retained — 001 R17.3). Arrays and scalars replace
 * wholesale (never concatenated or element-merged). `null` is a value (replaces);
 * `undefined` means "absent" (ignored).
 */
export function deepMerge(lower: unknown, higher: unknown): unknown {
  if (!isPlainObject(lower) || !isPlainObject(higher)) {
    // Whole-value replacement at every non-object level (arrays + scalars + null).
    return higher === undefined ? lower : higher;
  }
  const out: Record<string, unknown> = { ...lower };
  for (const [key, value] of Object.entries(higher)) {
    if (value === undefined) continue; // "absent"
    out[key] = deepMerge(lower[key], value);
  }
  return out;
}

/**
 * Deterministic canonical serialization: sorted keys, stable scalar formatting.
 * `canonicalizeConfig(loadConfig(inputs))` is byte-identical across runs for identical
 * inputs (SC-001; proven by repeat-run property tests).
 */
export function canonicalizeConfig(c: unknown): string {
  return canonicalJson(c);
}
