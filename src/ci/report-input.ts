/**
 * 013-ci-enforcement-layer report artifact loading + CLI output locators
 * (T025; data-model §5–§6). The frozen 002 artifact is READ and structurally
 * validated for the condition read set — never re-derived, never mutated.
 * Pure read path: no clock, no randomness, `node:fs` read-only imports.
 */

import { existsSync, readFileSync } from "node:fs";

import type { SecurityScreener } from "../ports/engine.js";

import { CiArtifactError } from "./errors.js";

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

const PLAN_ID_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateEntry(raw: unknown, where: string, problems: string[]): void {
  if (!isPlainObject(raw)) {
    problems.push(`${where}: not an object`);
    return;
  }
  const issueId = raw["issueId"];
  if (!(issueId === null || typeof issueId === "string")) {
    problems.push(`${where}.issueId: expected string|null`);
  }
  if (typeof raw["confidence"] !== "string") {
    problems.push(`${where}.confidence: expected string`);
  }
  for (const key of ["reasons", "changedFields", "expectedMarkdownChanges"] as const) {
    if (!isStringArray(raw[key])) {
      problems.push(`${where}.${key}: expected string array`);
    }
  }
  const flag = raw["unresolvedConflict"];
  if (!(flag === undefined || typeof flag === "boolean")) {
    problems.push(`${where}.unresolvedConflict: expected boolean when present`);
  }
}

function toEntryView(raw: Record<string, unknown>): ReportEntryView {
  return {
    issueId: (raw["issueId"] as string | null) ?? null,
    confidence: raw["confidence"] as string,
    reasons: [...(raw["reasons"] as string[])],
    changedFields: [...(raw["changedFields"] as string[])],
    expectedMarkdownChanges: [...(raw["expectedMarkdownChanges"] as string[])],
    unresolvedConflict: raw["unresolvedConflict"] === true,
  };
}

/**
 * Read + structurally validate a plan-report JSON artifact (data-model §5).
 * Any failure (missing, unparseable, structural) ⇒ `CiArtifactError` naming
 * the artifact path (edge case 1 — never silent).
 */
export function loadReportArtifact(path: string): ParsedReport {
  if (!existsSync(path)) {
    throw new CiArtifactError(
      `task-linear-sync report artifact missing: '${path}' — run the CLI \`check\`/\`plan\` first or pass a valid --report path`,
      path,
    );
  }
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CiArtifactError(`task-linear-sync report artifact is not parseable JSON: '${path}'`, path);
  }
  const problems: string[] = [];
  const entries: ReportEntryView[] = [];
  let planId = "";
  if (!isPlainObject(doc)) {
    problems.push("root: not a JSON object");
  } else {
    if (doc["schemaVersion"] !== 1) {
      problems.push(`schemaVersion: expected 1, got '${JSON.stringify(doc["schemaVersion"]) ?? "undefined"}'`);
    }
    const rawPlanId = doc["planId"];
    if (typeof rawPlanId === "string" && PLAN_ID_RE.test(rawPlanId)) {
      planId = rawPlanId;
    } else {
      problems.push("planId: expected 64-hex string");
    }
    if (!Array.isArray(doc["unmapped"])) {
      problems.push("unmapped: expected array (frozen report shape)");
    }
    const groups = doc["groups"];
    if (!Array.isArray(groups)) {
      problems.push("groups: expected array");
    } else {
      groups.forEach((group, gi) => {
        if (!isPlainObject(group) || !Array.isArray(group["entries"])) {
          problems.push(`groups[${gi}]: expected object with entries array`);
          return;
        }
        (group["entries"] as unknown[]).forEach((entry, ei) => {
          const where = `groups[${gi}].entries[${ei}]`;
          validateEntry(entry, where, problems);
          if (isPlainObject(entry) && problems.length === 0) {
            entries.push(toEntryView(entry));
          }
        });
      });
    }
  }
  if (problems.length > 0) {
    throw new CiArtifactError(
      `task-linear-sync report artifact malformed: '${path}' — ${problems.join("; ")}`,
      path,
    );
  }
  return { planId, path, entries };
}

function locatorFailure(command: "check" | "plan", stdout: string, screener: SecurityScreener): CiArtifactError {
  const head = screener.screen(stdout.trim().slice(0, 200)).output.replace(/\s+/g, " ");
  return new CiArtifactError(
    `task-linear-sync could not locate the report artifact in the \`${command}\` command output — stdout head: '${head}'`,
    `<cli ${command} stdout>`,
  );
}

/**
 * Extract the artifact locator from CLI stdout (data-model §6): `check` =
 * exactly one JSON object with `reportJson`; `plan` = first
 * `report <path>.json` line. Malformed stdout ⇒ `CiArtifactError` naming the
 * command + screened stdout head.
 */
export function parseLocator(request: LocatorRequest): LocatorResult {
  const { command, stdout, screener } = request;
  const trimmed = stdout.trim();

  if (command === "check") {
    if (trimmed === "") {
      throw locatorFailure(command, stdout, screener);
    }
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      throw locatorFailure(command, stdout, screener);
    }
    if (
      !isPlainObject(doc) ||
      doc["schemaVersion"] !== 1 ||
      typeof doc["planId"] !== "string" ||
      !PLAN_ID_RE.test(doc["planId"]) ||
      typeof doc["reportJson"] !== "string" ||
      doc["reportJson"] === ""
    ) {
      throw locatorFailure(command, stdout, screener);
    }
    return { reportJsonPath: doc["reportJson"], planId: doc["planId"] };
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const planLine = lines.find((line) => /^plan [0-9a-f]{64}$/.test(line));
  const reportLine = lines.find((line) => /^report \S.*\.json$/.test(line));
  if (planLine === undefined || reportLine === undefined) {
    throw locatorFailure(command, stdout, screener);
  }
  return {
    planId: planLine.slice("plan ".length),
    reportJsonPath: reportLine.slice("report ".length),
  };
}
