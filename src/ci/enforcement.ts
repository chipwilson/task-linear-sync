/**
 * 013-ci-enforcement-layer orchestration (T027; data-model §4,
 * wrapper-api.md §1). The only module that joins artifact acquisition,
 * evaluation, and screened output — via injectable seams only
 * (`cliInvoker`, `screener`, `env`, `log`). Error cases THROW the §7
 * taxonomy; a pass is NEVER returned on bad input (edge case 1).
 */

import { resolve } from "node:path";

import type { SecurityScreener } from "../ports/engine.js";

import type { CliInvoker } from "./cli-invoker.js";
import { CiArtifactError, CiCliFailureError } from "./errors.js";
import { evaluateConditions, type EvaluationResult } from "./evaluate.js";
import { loadReportArtifact, parseLocator } from "./report-input.js";
import type { EnforcementSettings } from "./settings.js";
import { renderSummary } from "./summary.js";

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

/** The single orchestration entry (wrapper-api.md §1). */
export async function runEnforcement(
  settings: EnforcementSettings,
  deps: EnforcementDeps,
): Promise<EnforcementOutcome> {
  let reportJsonPath: string;
  let claimedPlanId: string | null = null;

  if (settings.reportPath !== null) {
    // Artifact-direct mode: read, evaluate — NO spawn (spawns nothing).
    reportJsonPath = settings.reportPath;
  } else {
    // CLI-mode acquisition (T033): invoker → locator → provenance.
    const invoker = deps.cliInvoker;
    if (invoker === undefined) {
      throw new CiCliFailureError(
        "task-linear-sync CLI-mode enforcement requires a cliInvoker seam",
        settings.command,
        null,
      );
    }
    const result = await invoker({
      command: settings.command,
      workspace: settings.workspace,
      ...(settings.configFile === null ? {} : { configFile: settings.configFile }),
      cliEntry: settings.cliEntry,
      env: deps.env,
    });
    const located = parseLocator({
      command: settings.command,
      stdout: result.stdout,
      screener: deps.screener,
    });
    claimedPlanId = located.planId;
    reportJsonPath = located.reportJsonPath;
  }

  const report = loadReportArtifact(reportJsonPath);
  if (claimedPlanId !== null && claimedPlanId !== report.planId) {
    throw new CiArtifactError(
      `task-linear-sync report provenance mismatch: the \`${settings.command}\` output claims plan ${claimedPlanId} but the artifact '${report.path}' carries plan ${report.planId}`,
      report.path,
    );
  }

  const evaluation = evaluateConditions(report, settings);
  const rendered = renderSummary(evaluation, { screener: deps.screener });
  const status: EnforcementStatus = evaluation.triggered.length === 0 ? "pass" : "fail";

  deps.log(rendered.summaryLine, status === "pass" ? "stdout" : "stderr");
  if (rendered.warningLine !== null) {
    deps.log(rendered.warningLine, "stderr");
  }

  const reportAbsolutePath = resolve(report.path);
  return {
    status,
    evaluation,
    reportJsonPath: reportAbsolutePath,
    planId: report.planId,
    summaryLine: rendered.summaryLine,
    outputs: {
      status,
      "unmapped-count": String(evaluation.counts.unmappedHighConfidence),
      "conflict-count": String(evaluation.counts.unresolvedConflictBlocks),
      "drift-count": String(evaluation.counts.specDrift),
      summary: rendered.summaryLine,
      "report-json": reportAbsolutePath,
    },
  };
}
