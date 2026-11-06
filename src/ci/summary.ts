/**
 * 013-ci-enforcement-layer screened summary rendering (T026; research R8,
 * wrapper-api.md §4). Stub surface — rendering lands with T026.
 */

import type { SecurityScreener } from "../ports/engine.js";

import type { EvaluationResult } from "./evaluate.js";

export interface RenderedSummary {
  /** Pass line when nothing triggered; fail line otherwise (stdout/stderr split by main). */
  readonly summaryLine: string;
  /** Protection-skip warning (stderr), or null when branch classification worked. */
  readonly warningLine: string | null;
}

export interface SummaryOptions {
  readonly screener: SecurityScreener;
}

/** Render the exact-format R8 lines; EVERY line passes the screener first. */
export function renderSummary(
  _evaluation: EvaluationResult,
  _options: SummaryOptions,
): RenderedSummary {
  throw new Error("T026: not implemented");
}
