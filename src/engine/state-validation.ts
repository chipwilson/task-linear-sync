/**
 * 024 T013 [US2] — bootstrap existence validation for task state mapping (feature 024;
 * contract C4; data-model §4/§5; research R4/R5/R6; amendment A-024-2).
 *
 * Default-on mapping (024) is only safe when a bootstrap run REFUSES a team whose live
 * workflow lacks a mapped state: a pure, deterministic validator over the RESOLVED
 * config + the `discoverMetadata` snapshot already fetched by the enclosing pipeline
 * (zero additional `Linear_Port` calls — C4.3), invoked by the plan build (build.ts,
 * bootstrap mode only) and re-checked by apply before the first mutation (apply.ts).
 * Sync-mode runs never execute it (FR-011 — today's plan-time conflict posture).
 *
 * Scope per team (data-model §4): the four workflow-state identities + every lane
 * target reachable through a NON-NULL lanes map (`blocked` has no default entry ⇒
 * checked only when configured; a `null` map skips lane entries — C3.3). Exact
 * case-sensitive matching (today's resolution rule); case-insensitive near matches are
 * surfaced as typo HINTS and never clear a miss (R5 — never a silent guess). Type
 * category assertions: the snapshot must expose ≥1 `completed`-type and ≥1
 * `canceled`-type state (FR-008 second clause). A team the snapshot omits (or carries
 * zero states for) yields a DISTINCT `workflowEmpty` outcome instead of N missing-name
 * noise (spec edge case). Mapping-disabled teams validate vacuously — their names are
 * not mapped (C3/US4-AC2).
 *
 * Sanitization (Principle I, T027): reports and the error message carry team keys,
 * config entry paths, state NAMES + TYPES and nothing else — never state ids, never
 * credentials, never snapshot internals.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { TeamMetadataCollections } from "../ports/linear-port.js";
import { EngineError } from "./errors.js";
import { stateMappingActive } from "./completion.js";

/** One config entry whose mapped name the team's workflow does not offer. */
export interface MappingMiss {
  /** Config entry path, e.g. `teams[<teamKey>].workflowStates.lanes.in_progress`. */
  readonly entryPath: string;
  readonly intendedName: string;
}

/** A case-insensitive near match for a miss — a likely typo hint, never a resolution. */
export interface MappingNearMatch extends MappingMiss {
  readonly availableName: string;
}

/** Per-team outcome of the single validation pass (data-model §4). */
export interface BootstrapMappingReport {
  readonly teamKey: string;
  readonly missing: readonly MappingMiss[];
  readonly nearMatches: readonly MappingNearMatch[];
  /** Names + types ONLY — never state ids (Principle I screening, R6). */
  readonly available: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  /** Absent type categories among the team's states ("completed" | "canceled"). */
  readonly missingTypes: readonly ("completed" | "canceled")[];
  /** Distinct diagnostic: the snapshot carries no states for this team (V9). */
  readonly workflowEmpty: boolean;
}

/** A team passes only when `missing = ∅ ∧ missingTypes = ∅ ∧ ¬workflowEmpty`. */
export function bootstrapMappingTeamPasses(report: BootstrapMappingReport): boolean {
  return report.missing.length === 0 && report.missingTypes.length === 0 && !report.workflowEmpty;
}

/**
 * Bootstrap mapping validation failure (engine family, stable name
 * `StateMappingBootstrapError`; exit `CONFIGURATION_ERROR` 3 — C4.6). ONE error carries
 * every configured team's report (pass AND fail) and renders it in ONE pass, grouped by
 * team, with correction steps (FR-009).
 */
export class StateMappingBootstrapError extends EngineError {
  override readonly name = "StateMappingBootstrapError";

  /** Every configured team's outcome — the structured twin of the message (payload). */
  readonly reports: readonly BootstrapMappingReport[];

  constructor(reports: readonly BootstrapMappingReport[]) {
    super(renderStateMappingReport(reports));
    this.reports = reports;
  }
}

/** The four workflow-state identities in table order (entry-path order is deterministic). */
const IDENTITY_KEYS = ["backlog", "todo", "inProgress", "done"] as const;

const isUsableName = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Pure one-pass report over EVERY configured team (deterministic: identical config +
 * snapshot ⇒ identical reports). Never touches the port — consumes the snapshot the
 * enclosing pipeline already fetched (C4.1/C4.3).
 */
export function computeBootstrapMappingReports(
  config: ResolvedConfig,
  snapshot: ReadonlyArray<TeamMetadataCollections>,
): readonly BootstrapMappingReport[] {
  const reports: BootstrapMappingReport[] = [];
  for (const teamKey of Object.keys(config.teams ?? {})) {
    // Mapping OFF for this team ⇒ its names are not mapped — vacuous pass (C3, US4-AC2).
    if (!stateMappingActive(config, teamKey)) {
      reports.push({ teamKey, missing: [], nearMatches: [], available: [], missingTypes: [], workflowEmpty: false });
      continue;
    }
    const states = snapshot.find((collections) => collections.teamKey === teamKey)?.workflowStates ?? [];
    if (states.length === 0) {
      // Team unreachable or workflow empty — the DISTINCT outcome, no name noise (V9).
      reports.push({ teamKey, missing: [], nearMatches: [], available: [], missingTypes: [], workflowEmpty: true });
      continue;
    }

    const missing: MappingMiss[] = [];
    const nearMatches: MappingNearMatch[] = [];
    const check = (entryPath: string, intended: unknown): void => {
      if (!isUsableName(intended)) return; // blank/absent/null entries are the resolvers' diagnostic, not noise here
      if (states.some((s) => s.name === intended)) return; // exact, case-sensitive — today's resolution rule
      missing.push({ entryPath, intendedName: intended });
      const near = states.find((s) => s.name.toLowerCase() === intended.toLowerCase());
      if (near !== undefined) nearMatches.push({ entryPath, intendedName: intended, availableName: near.name });
      // Hints never clear the miss (R5 — no guessing).
    };

    const workflowStates = config.teams[teamKey]?.workflowStates as
      | Readonly<Record<string, unknown>>
      | undefined;
    for (const identity of IDENTITY_KEYS) {
      check(`teams[${teamKey}].workflowStates.${identity}`, workflowStates?.[identity]);
    }
    const lanes = workflowStates?.lanes as Readonly<Record<string, unknown>> | null | undefined;
    if (lanes !== null && typeof lanes === "object") {
      // A `null` map is lane-mapping OFF — zero lane entries (C3.3); `blocked` only
      // appears when the operator configured it (the default table has no entry).
      for (const [lane, target] of Object.entries(lanes)) {
        check(`teams[${teamKey}].workflowStates.lanes.${lane}`, target);
      }
    }

    const missingTypes: ("completed" | "canceled")[] = [];
    if (!states.some((s) => s.type === "completed")) missingTypes.push("completed");
    if (!states.some((s) => s.type === "canceled")) missingTypes.push("canceled");

    reports.push({
      teamKey,
      missing,
      nearMatches,
      available: states.map((s) => ({ name: s.name, type: s.type })),
      missingTypes,
      workflowEmpty: false,
    });
  }
  return reports;
}

/**
 * Bootstrap gate: compute the reports and throw `StateMappingBootstrapError` when ANY
 * team fails (one error, all teams, all names — FR-009). Call sites: plan build in
 * bootstrap mode (build.ts stage 4) and apply before the first mutation (apply.ts) —
 * both over the snapshot their pipeline already holds.
 */
export function assertBootstrapStateMapping(
  config: ResolvedConfig,
  snapshot: ReadonlyArray<TeamMetadataCollections>,
): void {
  const reports = computeBootstrapMappingReports(config, snapshot);
  if (reports.some((report) => !bootstrapMappingTeamPasses(report))) {
    throw new StateMappingBootstrapError(reports);
  }
}

/** FR-009 rendering: one pass, grouped by team, pass AND fail lines, correction steps. */
function renderStateMappingReport(reports: readonly BootstrapMappingReport[]): string {
  const failing = reports.filter((report) => !bootstrapMappingTeamPasses(report)).length;
  const lines: string[] = [
    `task state mapping validation failed — ${failing} of ${reports.length} configured team(s) do not offer every mapped workflow state; bootstrap refuses before any mutation`,
  ];
  for (const report of reports) {
    if (bootstrapMappingTeamPasses(report)) {
      lines.push(`Team ${report.teamKey}: PASS`);
      continue;
    }
    lines.push(`Team ${report.teamKey}: FAIL`);
    if (report.workflowEmpty) {
      lines.push(
        `  Team unreachable or workflow empty — the metadata snapshot carries no workflow states for team '${report.teamKey}'; ` +
          `verify the team key and connectivity, then re-run`,
      );
      continue;
    }
    if (report.missing.length > 0) {
      lines.push("  Mapped workflow-state names the team does not offer:");
      for (const miss of report.missing) {
        lines.push(`  - ${miss.entryPath} = '${miss.intendedName}' — not found in the team's workflow`);
      }
    }
    for (const hint of report.nearMatches) {
      lines.push(
        `  Likely typo (exact, case-sensitive matching is required): ${hint.entryPath} names '${hint.intendedName}' ` +
          `but the team offers '${hint.availableName}' — case differs`,
      );
    }
    if (report.missingTypes.length > 0) {
      lines.push(`  Missing workflow state type categories: ${report.missingTypes.join(", ")}`);
    }
    lines.push(`  Team workflow states available: ${report.available.map((s) => `${s.name} (${s.type})`).join(", ")}`);
  }
  lines.push(
    "Corrections: (1) edit each named teams[<key>].workflowStates.* entry to one of the available state names listed for that team " +
      "(configuration file or programmatic overrides), or create/rename the missing state in the team's Linear workflow " +
      "(Linear → Team → Workflow); (2) remove an entry to adopt its built-in default name; (3) re-run the sync — " +
      "bootstrap re-validates before any mutation.",
  );
  return lines.join("\n");
}
