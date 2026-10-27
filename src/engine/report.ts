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
 * (applies and rollbacks ONLY — plan builds never touch the marker, R13).
 *
 * T025 implementation notes (US1):
 * - {@link buildPlanReportJson} assembles the `PlanReportJson` from a frozen `Plan`
 *   field-for-field to the schema. The schema is `additionalProperties:false` at every
 *   level, so entry/unmapped/routing/alternative objects are rebuilt property-by-property
 *   — no runtime extras can leak, and `RoutingResolution` fields outside the schema
 *   (`tieBreak`, `unassigned`) plus `PlanTaskEntry.match` are dropped by construction.
 * - Milestone grouping: the frozen plan shape carries no phase/milestone field, so the
 *   per-entry grouping key is the entry's `featureName` (the adapter-derived
 *   story/feature grouping — the 001 phase grammar matches `phase|story|milestone N`
 *   headings whose tasks share a feature), falling back to a deterministic
 *   "(no milestone)" bucket. Groups sort project asc → milestone asc; entries keep the
 *   plan's deterministic order.
 * - Conflicts (FR-005): the schema admits no `conflictType` field, so `decision:"conflict"`
 *   entries carry `conflictType` + mapped action + reason as machine-readable `reasons`
 *   labels (data-model §3: "reasons … incl. conflict type + resolved action"); the
 *   markdown renders a dedicated conflicts section from those entries.
 * - `runId`: plan/run ids derive via `deriveRunId` (ops.ts, research R14 convention
 *   `sha256(planId ‖ clock.now().iso ‖ seq)`); {@link derivePlanReportRunId} pins the
 *   plan-report seq discriminator to 0 (one report per plan instant).
 */
import { join } from "node:path";

import {
  canonicalJson,
  type Plan,
  type PlanDecision,
  type PlanTaskEntry,
  type StoredPlan,
  type UnmappedIssue,
} from "../domain/plan.js";
import type { Confidence, MatchAlternative } from "../domain/match.js";
import type { FrameworkId } from "../domain/task.js";
import type { LastRunMarker } from "../domain/run-records.js";
import type { SecurityScreener } from "../ports/engine.js";
import { ReportScreeningError, writeRunReports } from "../state/marker.js";
import type { StateStore } from "../state/paths.js";
import type { Clock } from "../state/clock.js";
import { EngineError } from "./errors.js";
import { deriveRunId } from "./ops.js";

export type { LastRunMarker };

/** sha256-hex shape (planId, content hashes) per the frozen schema patterns. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

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

/** Deterministic bucket labels for entries lacking a routing/feature identity. */
const UNASSIGNED_PROJECT = "(unassigned)";
const NO_MILESTONE = "(no milestone)";

/** Grouping-key separator (NUL never occurs in project/feature names). */
const GROUP_SEP = "\u0000";

/** Guard: values shaped like configured personal API keys (secret material) are refused
 *  (same posture as the frozen `writeRunReports`, which plan writes cannot route through
 *  because they must NOT update `last-run.json`). */
function containsSecretShapedMaterial(text: string, personalKeyPrefix: string): boolean {
  if (personalKeyPrefix.length === 0) return false;
  const escaped = personalKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}[A-Za-z0-9_\\-]{12,}`).test(text);
}

/** Reject ids that could escape `reports/<runId>/` or `plans/<planId>.json` (path safety). */
function assertArtifactId(kind: "runId" | "planId", id: string): void {
  if (!SHA256_HEX.test(id)) {
    throw new EngineError(
      `${kind} must be a 64-char lowercase sha256 hex digest for artifact path safety — got a malformed value`,
    );
  }
}

/** Property names that could carry raw task-body / issue-description free text.
 *  Mirrors the frozen schema-scan rule (T012 / plan-artifact.md § Test obligations):
 *  names containing body|description|content unless hash- or expected-summary-bearing. */
function rawTextBearingProperties(value: unknown, offenders: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) rawTextBearingProperties(item, offenders);
    return offenders;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      const namesRawText =
        /(body|description|content)/.test(lower) && !lower.endsWith("hash") && !lower.startsWith("expected");
      if (namesRawText) offenders.push(key);
      rawTextBearingProperties(child, offenders);
    }
  }
  return offenders;
}

/** Map one frozen plan entry to the schema-shaped report entry FIELD BY FIELD — runtime
 *  extras (e.g. `match`, `RoutingResolution.tieBreak`/`unassigned`) are dropped by
 *  construction (structural exclusion; schema `additionalProperties:false`). */
function toReportEntry(entry: PlanTaskEntry): ReportTaskEntry {
  const reportEntry: ReportTaskEntry = {
    taskUuid: entry.taskUuid,
    issueId: entry.match?.issueId ?? null,
    decision: entry.decision,
    framework: entry.frameworkId,
    featureName: entry.featureName ?? null,
    filePath: entry.filePath,
    confidence: entry.confidence,
    score: entry.score,
    margin: entry.margin,
    reasons: [...entry.reasons],
    alternatives: entry.alternatives.map(
      (alt): MatchAlternative => ({ issueId: alt.issueId, score: alt.score, mapped: alt.mapped }),
    ),
    changedFields: [...entry.changedFields],
    descriptionContentHash: entry.descriptionContentHash,
    expectedMarkdownChanges: [...entry.expectedMarkdownChanges],
    lowConfidenceGateStatus: entry.lowConfidenceGateStatus,
    unresolvedConflict: entry.unresolvedConflict ?? false,
    routing:
      entry.routing === undefined
        ? null
        : {
            teamKey: entry.routing.teamKey,
            project: entry.routing.project,
            matchedPrefix: entry.routing.matchedPrefix ?? null,
            defaulted: entry.routing.defaulted,
          },
  };
  return reportEntry;
}

/** Cloned 5-field unmapped shape (exact schema `additionalProperties:false` surface). */
function toReportUnmapped(issue: UnmappedIssue): UnmappedIssue {
  return {
    issueId: issue.issueId,
    teamKey: issue.teamKey,
    project: issue.project,
    title: issue.title,
    parentMapped: issue.parentMapped,
  };
}

/** Options for {@link buildPlanReportJson}. */
export interface PlanReportBuildOptions {
  /** Pipeline-level pass/fail guarantees (e.g. zero-mutation evidence from the build
   *  lane) merged BEFORE the structural assertions the assembler computes itself. */
  readonly assertions?: readonly PlanReportAssertion[];
}

/**
 * Assemble the schema-shaped `PlanReportJson` from a frozen `Plan` (009 FR-006/007):
 * project→milestone grouping (milestone = entry `featureName` grouping — the frozen plan
 * shape carries no phase field; "(no milestone)" bucket otherwise), separate `unmapped`
 * section, and the security-assertions block (caller-supplied guarantees plus two
 * COMPUTED structural-exclusion assertions: no raw-text-bearing property name, and every
 * description represented only by a sha256-shaped content hash). Deterministic: groups
 * sort project→milestone ascending, entries keep the plan's deterministic order.
 */
export function buildPlanReportJson(plan: Plan, options?: PlanReportBuildOptions): PlanReportJson {
  const grouped = new Map<string, { project: string; milestone: string; entries: ReportTaskEntry[] }>();
  for (const entry of plan.entries) {
    const project = entry.routing?.project ?? UNASSIGNED_PROJECT;
    const milestone = entry.featureName ?? NO_MILESTONE;
    const key = `${project}${GROUP_SEP}${milestone}`;
    let group = grouped.get(key);
    if (group === undefined) {
      group = { project, milestone, entries: [] };
      grouped.set(key, group);
    }
    group.entries.push(toReportEntry(entry));
  }
  const groups = [...grouped.values()].sort(
    (a, b) => a.project.localeCompare(b.project, "en") || a.milestone.localeCompare(b.milestone, "en"),
  );

  return {
    schemaVersion: 1,
    planId: plan.planId,
    generatedAt: plan.generatedAt,
    repositoryRoot: plan.repositoryRoot,
    guards: {
      fileHashes: Object.fromEntries(
        Object.keys(plan.guards.fileHashes)
          .sort((a, b) => a.localeCompare(b, "en"))
          .map((path) => [path, plan.guards.fileHashes[path] ?? ""]),
      ),
      headCommit: plan.guards.headCommit,
    },
    lowConfidencePresent: plan.lowConfidencePresent,
    // Caller-declared pipeline guarantees first, then the assertions computed here.
    securityAssertions: [...(options?.assertions ?? []), ...structuralAssertions(groups)],
    groups,
    unmapped: plan.unmappedIssues.map(toReportUnmapped),
  };
}

/** Structural-exclusion assertions computed over the assembled group entries. */
function structuralAssertions(
  groups: readonly { readonly entries: readonly ReportTaskEntry[] }[],
): PlanReportAssertion[] {
  const entries = groups.flatMap((group) => [...group.entries]);
  const offenders = rawTextBearingProperties(entries);
  const hashShaped = entries.every((entry) => SHA256_HEX.test(entry.descriptionContentHash));
  return [
    {
      guarantee: "no-raw-body-or-description-fields",
      status: offenders.length === 0 ? "pass" : "fail",
      detail:
        offenders.length === 0
          ? "no report property admits raw task-body or issue-description text; content appears only as hashes and screened summaries"
          : `raw-text-bearing properties detected: ${offenders.join(", ")}`,
    },
    {
      guarantee: "description-material-hashed-only",
      status: hashShaped ? "pass" : "fail",
      detail: hashShaped
        ? "every entry's descriptionContentHash is a sha256 hex digest (structural content exclusion)"
        : "one or more entries carry a descriptionContentHash outside the sha256 hex shape",
    },
  ];
}

/**
 * Persist the `StoredPlan` to `plans/<planId>.json` (required for Plan_Reference
 * validation at apply; `storedAt` from the injected clock). T025 implements.
 */
export async function persistPlan(store: StateStore, plan: Plan): Promise<void> {
  assertArtifactId("planId", plan.planId);
  const stored: StoredPlan = { plan, storedAt: store.clock.now().toISOString() };
  await store.writeJson(`plans/${plan.planId}.json`, stored);
}

/**
 * Render the sanitized markdown report from the JSON artifact (project→milestone groups,
 * separate unmapped section, unresolved-conflict surfacing, security-assertions block;
 * no raw bodies/descriptions by construction — structural exclusion: the renderer only
 * ever sees the schema-shaped document, which admits no raw-text field). Contract test
 * T047 asserts both artifacts.
 */
export function renderPlanReportMarkdown(report: PlanReportJson): string {
  const lines: string[] = [];
  lines.push("# Sync Plan Report", "");
  lines.push(`- Plan: \`${report.planId}\``);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Repository: ${report.repositoryRoot ?? "(unknown)"}`);
  lines.push("");

  lines.push("## Security Assertions", "");
  for (const assertion of report.securityAssertions) {
    const detail = assertion.detail === undefined ? "" : ` — ${assertion.detail}`;
    lines.push(`- ${assertion.status.toUpperCase()} — ${assertion.guarantee}${detail}`);
  }
  lines.push("");

  lines.push("## Task Entries", "");
  lines.push("_Grouped by project, then milestone. Raw task bodies and issue descriptions are");
  lines.push("excluded from this report by design — description material appears only as");
  lines.push("content hashes and screened summaries._", "");
  if (report.groups.length === 0) {
    lines.push("_(no task entries — zero-task plan)_", "");
  }
  for (const group of report.groups) {
    lines.push(`### Project: ${group.project}`, "");
    lines.push(`#### Milestone: ${group.milestone}`, "");
    if (group.entries.length === 0) {
      lines.push("_(no entries)_", "");
    }
    for (const entry of group.entries) {
      lines.push(...renderEntryLines(entry));
    }
    lines.push("");
  }

  lines.push("## Unresolved Conflicts", "");
  const conflictEntries = report.groups
    .flatMap((group) => [...group.entries])
    .filter((entry) => entry.decision === "conflict" || entry.unresolvedConflict === true);
  if (conflictEntries.length === 0) {
    lines.push("_(none)_", "");
  } else {
    lines.push("Entries awaiting human resolution or resolution-mapped this run (009 FR-007;");
    lines.push("FR-005: each entry names conflict type + action + reason via its reasons):", "");
    for (const entry of conflictEntries) {
      const issue = entry.issueId === null || entry.issueId === undefined ? "" : ` (issue \`${entry.issueId}\`)`;
      const awaiting = entry.unresolvedConflict === true ? " · **AWAITING HUMAN MARKER RESOLUTION**" : "";
      lines.push(`- \`${entry.filePath}\` · task \`${entry.taskUuid}\`${issue} — decision \`${entry.decision}\`${awaiting}`);
      lines.push(
        `  - Reasons: ${entry.reasons.length > 0 ? entry.reasons.map((r) => `\`${r}\``).join("; ") : "(none recorded)"}`,
      );
    }
    lines.push("");
  }

  lines.push("## Unmapped Issues", "");
  lines.push("_Issues with no task mapping (009 FR-007)._", "");
  if (report.unmapped.length === 0) {
    lines.push("_(none)_", "");
  }
  for (const issue of report.unmapped) {
    const parent = issue.parentMapped ? " · descendant mapped" : "";
    lines.push(`- \`${issue.issueId}\` — ${issue.title} (team \`${issue.teamKey}\` · project \`${issue.project}\`${parent})`);
  }
  lines.push("");
  return lines.join("\n");
}

/** One task entry as markdown bullet lines — durable ids + machine labels only. */
function renderEntryLines(entry: ReportTaskEntry): string[] {
  const lines: string[] = [];
  const issue = entry.issueId === null || entry.issueId === undefined ? "" : ` (issue \`${entry.issueId}\`)`;
  lines.push(`- \`${entry.filePath}\` · task \`${entry.taskUuid}\`${issue}`);
  const feature =
    entry.featureName === null || entry.featureName === undefined ? "" : ` · feature \`${entry.featureName}\``;
  const awaiting = entry.unresolvedConflict === true ? " · **AWAITING HUMAN MARKER RESOLUTION**" : "";
  lines.push(`  - Decision: \`${entry.decision}\` · framework \`${entry.framework}\`${feature}${awaiting}`);
  lines.push(
    `  - Confidence: ${entry.confidence} (score ${entry.score}, margin ${entry.margin})` +
      ` · low-confidence gate: ${entry.lowConfidenceGateStatus}`,
  );
  lines.push(`  - Reasons: ${entry.reasons.length > 0 ? entry.reasons.map((r) => `\`${r}\``).join("; ") : "(none)"}`);
  lines.push(`  - Changed fields: ${entry.changedFields.length > 0 ? entry.changedFields.join(", ") : "(none)"}`);
  lines.push(`  - Description content hash: \`${entry.descriptionContentHash}\``);
  if (entry.expectedMarkdownChanges.length > 0) {
    lines.push("  - Expected markdown changes:");
    for (const change of entry.expectedMarkdownChanges) {
      lines.push(`    - ${change}`);
    }
  }
  if (entry.alternatives.length > 0) {
    const alts = entry.alternatives
      .map((alt) => `\`${alt.issueId}\` (score ${alt.score}, ${alt.mapped ? "mapped" : "unmapped"})`)
      .join("; ");
    lines.push(`  - Match alternatives: ${alts}`);
  }
  if (entry.routing !== null && entry.routing !== undefined) {
    const prefix = entry.routing.matchedPrefix === null ? "" : ` · prefix \`${entry.routing.matchedPrefix}\``;
    lines.push(
      `  - Routing: team \`${entry.routing.teamKey}\` · project \`${entry.routing.project}\`${prefix}` +
        ` · defaulted: ${entry.routing.defaulted ? "yes" : "no"}`,
    );
  }
  if (entry.attachmentUrls !== undefined && entry.attachmentUrls.length > 0) {
    lines.push(`  - Attachment URLs: ${entry.attachmentUrls.join(", ")}`);
  }
  return lines;
}

/**
 * Write the paired PLAN report artifacts to `reports/<runId>/` (screened; frozen
 * `writeRunReports` posture — blocking findings refuse the write entirely, and
 * secret-keyed material is refused via the same built-in guard). Plan builds do NOT
 * touch `last-run.json` (only applies/rollbacks produce run markers — R13), which is
 * why this path cannot route through `writeRunReports` itself. T025 implements.
 */
export async function writePlanReportArtifacts(
  store: StateStore,
  runId: string,
  report: PlanReportJson,
  markdown: string,
  screener: SecurityScreener,
): Promise<ReportPaths> {
  assertArtifactId("runId", runId);
  const jsonScreened = screener.screen(canonicalJson(report));
  const markdownScreened = screener.screen(markdown);

  const blocked = [...jsonScreened.blocked, ...markdownScreened.blocked];
  if (blocked.length > 0) {
    throw new ReportScreeningError(
      `plan report propagation blocked by security screening: ${blocked.join(", ")}`,
    );
  }
  const prefix = store.config.personalKeyPrefix;
  if (
    containsSecretShapedMaterial(jsonScreened.output, prefix) ||
    containsSecretShapedMaterial(markdownScreened.output, prefix)
  ) {
    throw new ReportScreeningError("plan report contains secret-keyed material — refusing to write reports");
  }

  const jsonRel = `reports/${runId}/report.json`;
  const markdownRel = `reports/${runId}/report.md`;
  await store.writeText(jsonRel, jsonScreened.output);
  await store.writeText(markdownRel, markdownScreened.output + (markdownScreened.output.endsWith("\n") ? "" : "\n"));
  return { json: join(store.root, jsonRel), markdown: join(store.root, markdownRel) };
}

/**
 * Deterministic plan-report runId under the injected clock (research R13/R14): delegates
 * to `deriveRunId` (ops.ts, `sha256(planId ‖ clock.now().iso ‖ seq)`) with the plan-report
 * discriminator `seq = 0`, so the pipeline and this helper never fork the convention.
 * Throws until T040 implements `deriveRunId` (stub discipline).
 */
export function derivePlanReportRunId(planId: string, clock: Clock): string {
  return deriveRunId(planId, clock, 0);
}

/**
 * Write the paired RUN report (apply/rollback) at `reports/<runId>/` and atomically
 * update `last-run.json` via the frozen `writeRunReports` (frozen `LastRunMarker`,
 * data-model §13; T045; integration T037 asserts the abort marker). Screening and the
 * secret-material guard run inside the frozen writer; US1 plan reports must NOT use this
 * path (no marker for read-only plan runs — R13). Implemented; exercised by T045/US2.
 */
export async function writeRunReportWithMarker(
  store: StateStore,
  runId: string,
  report: PlanReportJson,
  markdown: string,
  screener: SecurityScreener,
  marker: Omit<LastRunMarker, "reportPaths" | "completedAt">,
): Promise<LastRunMarker> {
  assertArtifactId("runId", runId);
  return writeRunReports(store, runId, { json: report, markdown }, screener, marker);
}
