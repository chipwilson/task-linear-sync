/**
 * 013-ci-enforcement-layer orchestration (T027; data-model §4,
 * wrapper-api.md §1). Stub surface — orchestration lands with T027.
 */

import type { SecurityScreener } from "../ports/engine.js";

import type { CliInvoker } from "./cli-invoker.js";
import type { EvaluationResult } from "./evaluate.js";
import type { EnforcementSettings } from "./settings.js";

export type EnforcementStatus = "pass" | "fail";

export interface EnforcementOutcome {
  readonly status: EnforcementStatus;
  readonly evaluation: EvaluationResult;
  readonly reportJsonPath: string;
  /** 64-hex, from the artifact (provenance-checked). */
  readonly planId: string;
  /** Screened R8 line. */
  readonly summaryLine: string;
  /** The six action.md §3 outputs. */
  readonly outputs: Readonly<Record<string, string>>;
}

export type EnvView = Readonly<Record<string, string | undefined>>;

export interface EnforcementDeps {
  readonly cliInvoker?: CliInvoker;
  readonly screener: SecurityScreener;
  readonly env: EnvView;
  readonly log: (line: string, stream: "stdout" | "stderr") => void;
}

/**
 * The single orchestration entry: artifact acquisition (artifact-direct via
 * `settings.reportPath`, else CLI mode via `deps.cliInvoker` + locator),
 * pure evaluation, screened summary. Error cases THROW the §7 taxonomy —
 * never a returned pass on bad input.
 */
export async function runEnforcement(
  _settings: EnforcementSettings,
  _deps: EnforcementDeps,
): Promise<EnforcementOutcome> {
  throw new Error("T027: not implemented");
}
