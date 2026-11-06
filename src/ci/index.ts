/**
 * 013-ci-enforcement-layer public barrel (T002; contracts/wrapper-api.md).
 * Bound name-for-name by `tests/contract/ci-packaging.test.ts`.
 */

export {
  CiConfigError,
  CiArtifactError,
  CiCliFailureError,
  EnforcementExitCode,
} from "./errors.js";
export { resolveSettings } from "./settings.js";
export type { EnforcementSettings, RawSettingsInput } from "./settings.js";
export { evaluateConditions, CONDITION_IDS } from "./evaluate.js";
export type {
  ConditionId,
  ConditionCounts,
  TriggeredCondition,
  EvaluationResult,
} from "./evaluate.js";
export { loadReportArtifact, parseLocator } from "./report-input.js";
export type { ParsedReport, ReportEntryView, LocatorResult } from "./report-input.js";
export { renderSummary } from "./summary.js";
export type { RenderedSummary } from "./summary.js";
export { createSpawnCliInvoker } from "./cli-invoker.js";
export type { CliInvoker, CliRequest, CliResult } from "./cli-invoker.js";
export { runEnforcement } from "./enforcement.js";
export type {
  EnforcementOutcome,
  EnforcementStatus,
  EnforcementDeps,
  EnvView,
} from "./enforcement.js";
