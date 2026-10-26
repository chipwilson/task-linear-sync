/**
 * Plan/run report artifacts + last-run marker (research R13; plan persistence per
 * contracts/engine-pipeline.md stage 7; frozen `LastRunMarker` — data-model §13 /
 * `src/state/marker.ts`; frozen report schema
 * `specs/002-core-domain-contracts/contracts/plan-report.schema.json`;
 * task T025 implements plan reports (T018/T019/T047), T045 extends with run reports
 * for apply/rollback (T032–T037) and wires both into `createSyncEngine` via T045.
 *
 * Artifacts land at `plans/<planId>.json` (StoredPlan) and `reports/<runId>/report.json`
 * + `report.md` — state directory ONLY, never the repo tree (constitution I). The JSON
 * conforms to the frozen schema (structural content exclusion — content appears only as
 * hashes/summaries); the markdown is sanitized by construction plus a screener pass
 * (project→milestone grouping, separate unmapped section, unresolved-conflict surfacing,
 * security-assertions block). `last-run.json` rides the frozen `writeRunReports`
 * (applies and rollbacks).
 */
import type { Confidence, MatchAlternative } from "../domain/match.js";
import type { FrameworkId } from "../domain/task.js";
import type { Plan, PlanDecision, UnmappedIssue } from "../domain/plan.js";
import type { LastRunMarker } from "../domain/run-records.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { StateStore } from "../state/paths.js";

export type { LastRunMarker };

/** One pass/fail guarantee line of the report's security-assertions block (009 FR-008). */
export interface PlanReportAssertion {
  /** Guarantee label (e.g. "zero-repo-writes", "no-raw-bodies"). */
  readonly guarantee: string;
  readonly status: "pass" | "fail";
  /** Sanitized detail, screened before propagation. */
  readonly detail?: string;
}

/** Routing indication exactly as the frozen report schema admits (no extra fields). */
export interface ReportRouting {
  readonly teamKey: string;
  readonly project: string;
  readonly matchedPrefix: string | null;
  readonly defaulted: boolean;
}

/** Per-task report entry — the complete 009 FR-006 field set; NO raw body/description. */
export interface ReportTaskEntry {
  readonly taskUuid: string;
  readonly issueId?: string | null;
  readonly decision: PlanDecision;
  readonly framework: FrameworkId;
  readonly featureName?: string | null;
  /** Repository-relative POSIX path. */
  readonly filePath: string;
  readonly confidence: Confidence;
  readonly score: number;
  readonly margin: number;
  /** Machine-readable labels; conflicts name type + action + reason (FR-005). */
  readonly reasons: readonly string[];
  /** ≤ 3, descending score, deterministic tie-break. */
  readonly alternatives: readonly MatchAlternative[];
  readonly changedFields: readonly string[];
  /** Content hash in lieu of raw task body or raw issue description. */
  readonly descriptionContentHash: string;
  /** Sanitized, screened line-level change summaries (≤ 512 chars each). */
  readonly expectedMarkdownChanges: readonly string[];
  readonly lowConfidenceGateStatus: "passed" | "failed";
  /** True ⇒ awaiting human resolution of conflict markers (009 FR-007). */
  readonly unresolvedConflict?: boolean;
  readonly routing?: ReportRouting | null;
  /** Planned canonical/continuation attachment URLs (scheme contract). */
  readonly attachmentUrls?: readonly string[];
}

/** `report.json` document — conforms field-for-field to the frozen plan-report schema. */
export interface PlanReportJson {
  readonly schemaVersion: 1;
  /** sha256 over canonicalized plan JSON; doubles as Plan_Reference. */
  readonly planId: string;
  /** ISO-8601. */
  readonly generatedAt: string;
  readonly repositoryRoot?: string;
  readonly guards: {
    readonly fileHashes: Readonly<Record<string, string>>;
    readonly headCommit: string | null;
  };
  readonly lowConfidencePresent?: boolean;
  /** ≥ 1 discrete pass/fail assertion. */
  readonly securityAssertions: readonly PlanReportAssertion[];
  /** Grouped project → milestone; empty for a zero-task plan. */
  readonly groups: ReadonlyArray<{
    readonly project: string;
    readonly milestone: string;
    readonly entries: readonly ReportTaskEntry[];
  }>;
  /** Issues with no task mapping, separate section (009 FR-007). */
  readonly unmapped: readonly UnmappedIssue[];
}

/** Written artifact pair (absolute state-directory paths; ApplyResult.reportPaths shape). */
export interface ReportPaths {
  readonly json: string;
  readonly markdown: string;
}

/**
 * Persist the `StoredPlan` to `plans/<planId>.json` (required for Plan_Reference
 * validation at apply; `storedAt` from the injected clock). T025 implements.
 */
export async function persistPlan(store: StateStore, plan: Plan): Promise<void> {
  void [store, plan]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: report");
}

/**
 * Render the sanitized markdown report from the JSON artifact (project→milestone groups,
 * separate unmapped section, unresolved-conflict surfacing, security-assertions block;
 * no raw bodies/descriptions by construction — structural exclusion). T025 implements
 * (contract test T047 asserts both artifacts).
 */
export function renderPlanReportMarkdown(report: PlanReportJson): string {
  void [report]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: report");
}

/**
 * Write the paired PLAN report artifacts to `reports/<runId>/` (screened; frozen
 * `writeRunReports` posture — blocking findings refuse the write entirely). Plan builds
 * do NOT touch `last-run.json` (only applies/rollbacks produce run markers).
 * T025 implements.
 */
export async function writePlanReportArtifacts(
  store: StateStore,
  runId: string,
  report: PlanReportJson,
  markdown: string,
  screener: SecurityScreener,
): Promise<ReportPaths> {
  void [store, runId, report, markdown, screener]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: report");
}

/**
 * Write the paired RUN report (apply/rollback) at `reports/<runId>/` and atomically
 * update `last-run.json` via the frozen `writeRunReports` (frozen `LastRunMarker`,
 * data-model §13; T045; integration T037 asserts the abort marker).
 * T045 implements.
 */
export async function writeRunReportWithMarker(
  store: StateStore,
  runId: string,
  report: PlanReportJson,
  markdown: string,
  screener: SecurityScreener,
  marker: Omit<LastRunMarker, "reportPaths" | "completedAt">,
): Promise<LastRunMarker> {
  void [store, runId, report, markdown, screener, marker]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: report");
}
