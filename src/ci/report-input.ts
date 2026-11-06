/**
 * 013-ci-enforcement-layer report artifact loading + CLI output locators
 * (T025; data-model §5–§6). Stub surface — bodies land with T025.
 */

import type { SecurityScreener } from "../ports/engine.js";

/** Read-only per-entry view of the frozen 002 plan-report (data-model §5). */
export interface ReportEntryView {
  readonly issueId: string | null;
  readonly confidence: string;
  readonly reasons: readonly string[];
  readonly changedFields: readonly string[];
  readonly expectedMarkdownChanges: readonly string[];
  readonly unresolvedConflict: boolean;
}

/** Validated artifact view: entry read set in artifact order. */
export interface ParsedReport {
  readonly planId: string;
  readonly path: string;
  readonly entries: readonly ReportEntryView[];
}

/** Locator result: artifact path + planId claimed by the CLI's stdout. */
export interface LocatorResult {
  readonly reportJsonPath: string;
  readonly planId: string;
}

export interface LocatorRequest {
  readonly command: "check" | "plan";
  readonly stdout: string;
  readonly screener: SecurityScreener;
}

/**
 * Read + structurally validate a plan-report JSON artifact (data-model §5).
 * Any failure (missing, unparseable, structural) ⇒ `CiArtifactError` naming
 * the artifact path (edge case 1 — never silent).
 */
export function loadReportArtifact(_path: string): ParsedReport {
  throw new Error("T025: not implemented");
}

/**
 * Extract the artifact locator from CLI stdout (data-model §6): `check` =
 * exactly one JSON object with `reportJson`; `plan` = first
 * `report <path>.json` line. Malformed stdout ⇒ `CiArtifactError` naming the
 * command + screened stdout head.
 */
export function parseLocator(_request: LocatorRequest): LocatorResult {
  throw new Error("T025: not implemented");
}
