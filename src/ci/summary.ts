/**
 * 013-ci-enforcement-layer screened summary rendering (T026; research R8,
 * wrapper-api.md §4). Exact line formats; EVERY emitted line passes the
 * injected screener before leaving this module (FR-003). Pure: no I/O, no
 * clock — the lines are a function of the evaluation alone.
 */

import type { SecurityScreener } from "../ports/engine.js";

import { CONDITION_IDS, type EvaluationResult } from "./evaluate.js";

export interface RenderedSummary {
  /** Pass line when nothing triggered; fail line otherwise (stdout/stderr split by main). */
  readonly summaryLine: string;
  /** Protection-skip warning (stderr), or null when branch classification worked. */
  readonly warningLine: string | null;
}

export interface SummaryOptions {
  readonly screener: SecurityScreener;
}

const COUNT_KEYS = [
  "unmappedHighConfidence",
  "unresolvedConflictBlocks",
  "specDrift",
] as const;

function screen(screener: SecurityScreener, line: string): string {
  return screener.screen(line).output;
}

/** Render the exact-format R8 lines; EVERY line passes the screener first. */
export function renderSummary(
  evaluation: EvaluationResult,
  options: SummaryOptions,
): RenderedSummary {
  const { screener } = options;
  const byId = new Map(evaluation.triggered.map((t) => [t.condition, t.count]));
  const summaryLine =
    evaluation.triggered.length === 0
      ? `task-linear-sync enforcement passed (${CONDITION_IDS.map(
          (id, i) => `${id}: ${evaluation.counts[COUNT_KEYS[i] ?? COUNT_KEYS[0]]}`,
        ).join(", ")})`
      : `task-linear-sync enforcement failed — ${CONDITION_IDS.filter((id) => byId.has(id))
          .map((id) => `${id}: ${byId.get(id)}`)
          .join("; ")}`;

  const warningLine = evaluation.protectionSkipped
    ? "task-linear-sync enforcement warning: unresolved-conflict-block protection skipped — branch context unresolved"
    : null;

  return {
    summaryLine: screen(screener, summaryLine),
    warningLine: warningLine === null ? null : screen(screener, warningLine),
  };
}
