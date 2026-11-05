/**
 * T023 — the shared `plan`/`check` lane (research R9/R10): guarded deps (allowed write
 * prefixes `["reports/","plans/"]` — enforced centrally by `runCli`) → the ONE engine's
 * `buildSyncPlan` (which persists the plan and writes the report pair) → artifact paths
 * resolved via `derivePlanReportRunId(planId, clock)` under `state.paths` → both artifacts
 * verified to exist (missing ⇒ abort naming them, never a silent success). `plan` prints
 * the human artifact lines; `check` prints exactly one `CheckSummary` JSON object with
 * counts read OFF the generated report artifact (never re-derived) and exits 0 / 8 per
 * contracts/command-surface.md §4.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { derivePlanReportRunId } from "../../engine/index.js";
import type { PlanReportJson } from "../../engine/index.js";
import { RunAbortedError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandHandler } from "../index.js";

/** Every task entry across the report's project→milestone groups. */
function reportEntries(report: PlanReportJson) {
  return report.groups.flatMap((group) => group.entries);
}

/** Findings: conflict-shaped entries or a failed security assertion (§4). */
function findingsPresent(report: PlanReportJson): boolean {
  return (
    reportEntries(report).some((entry) => entry.decision === "conflict" || entry.unresolvedConflict === true) ||
    report.securityAssertions.some((assertion) => assertion.status === "fail")
  );
}

export const planHandler: CommandHandler = async (run) => {
  const isCheck = run.invocation.command === "check";

  // The engine owns plan construction, persistence, and report writing (one-engine rule).
  const plan = await run.engine.buildSyncPlan({ repositoryRoot: run.repositoryRoot });
  const derivedRunId = derivePlanReportRunId(plan.planId, run.state.clock);
  const jsonAbs = join(run.state.root, "reports", derivedRunId, "report.json");
  const markdownAbs = join(run.state.root, "reports", derivedRunId, "report.md");

  const missing = [jsonAbs, markdownAbs].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new RunAbortedError(
      `plan report artifact missing after plan construction: reports/${derivedRunId}/report.{json,md} (expected at ${missing.join(", ")})`,
    );
  }

  if (!isCheck) {
    run.out.write(`plan ${plan.planId}`);
    run.out.write(`report ${jsonAbs}`);
    run.out.write(`report ${markdownAbs}`);
    return ExitCode.SUCCESS;
  }

  // check: counts come OFF the artifact (013's input — R10), provenance cross-checked.
  const report = JSON.parse(readFileSync(jsonAbs, "utf8")) as PlanReportJson;
  if (report.planId !== plan.planId) {
    throw new RunAbortedError(
      `plan report provenance mismatch: report at reports/${derivedRunId}/report.json describes a different plan`,
    );
  }
  const entries = reportEntries(report);
  const lowConfidence = entries.filter((entry) => entry.confidence === "low").length;
  const unresolvedConflicts = entries.filter(
    (entry) => entry.decision === "conflict" || entry.unresolvedConflict === true,
  ).length;
  const summary = {
    schemaVersion: 1 as const,
    planId: plan.planId,
    reportJson: jsonAbs,
    reportMarkdown: markdownAbs,
    counts: {
      entries: entries.length,
      unmapped: report.unmapped.length,
      unresolvedConflicts,
      lowConfidence,
    },
  };
  run.out.write(JSON.stringify(summary));
  return findingsPresent(report) ? ExitCode.CHECK_FINDINGS : ExitCode.SUCCESS;
};
