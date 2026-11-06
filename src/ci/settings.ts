/**
 * 013-ci-enforcement-layer settings (T013-adjacent; data-model §1–§2).
 *
 * `resolveSettings` merges { flags, env } into validated `EnforcementSettings`
 * (flags > `TLS_CI_*` env > defaults) with complete-listing validation: ALL
 * problems are collected and rendered as ONE dotted-key line (010/012 posture).
 * Self-contained: imports only `node:fs` (existsSync) + local errors — never
 * `src/cli` config code (hygiene invariant 1). No `process` access: the caller
 * (main.ts, the only process consumer) supplies `cwd` and the env view.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import { CiConfigError } from "./errors.js";

export interface EnforcementSettings {
  readonly workspace: string;
  readonly configFile: string | null;
  readonly command: "check" | "plan";
  readonly reportPath: string | null;
  readonly cliEntry: string | null;
  readonly failOnUnmapped: boolean;
  readonly unmappedThreshold: number;
  readonly failOnConflicts: boolean;
  readonly failOnDrift: boolean;
  readonly driftThreshold: number;
  readonly protectedBranches: readonly string[];
  readonly targetBranch: string | null;
}

export interface RawSettingsInput {
  readonly flags?: Readonly<Record<string, string | undefined>>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

/** Flag name -> `TLS_CI_*` env fallback (data-model §1). */
const ENV_BY_FLAG: Readonly<Record<string, string>> = {
  workspace: "TLS_CI_WORKSPACE",
  config: "TLS_CI_CONFIG",
  command: "TLS_CI_COMMAND",
  report: "TLS_CI_REPORT",
  "cli-entry": "TLS_CI_CLI_ENTRY",
  "fail-on-unmapped": "TLS_CI_FAIL_ON_UNMAPPED",
  "unmapped-threshold": "TLS_CI_UNMAPPED_THRESHOLD",
  "fail-on-conflicts": "TLS_CI_FAIL_ON_CONFLICTS",
  "fail-on-drift": "TLS_CI_FAIL_ON_DRIFT",
  "drift-threshold": "TLS_CI_DRIFT_THRESHOLD",
  "protected-branches": "TLS_CI_PROTECTED_BRANCHES",
  branch: "TLS_CI_BRANCH",
};

const BOOLEAN_SET: ReadonlySet<string> = new Set(["true", "false", "1", "0"]);
const COMMAND_SET: ReadonlySet<string> = new Set(["check", "plan"]);

function rawValue(
  flags: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string | undefined>>,
  flag: string,
): string | undefined {
  const direct = flags[flag];
  if (direct !== undefined && direct.trim() !== "") {
    return direct.trim();
  }
  const viaEnv = env[ENV_BY_FLAG[flag] ?? ""];
  if (viaEnv !== undefined && viaEnv.trim() !== "") {
    return viaEnv.trim();
  }
  return undefined;
}

function parseBool(
  problems: string[],
  rawFlags: Readonly<Record<string, string | undefined>>,
  rawEnv: Readonly<Record<string, string | undefined>>,
  flag: string,
  fallback: boolean,
): boolean {
  const raw = rawValue(rawFlags, rawEnv, flag);
  if (raw === undefined) {
    return fallback;
  }
  const key = raw.toLowerCase();
  if (!BOOLEAN_SET.has(key)) {
    problems.push(`settings.${flag}: not a boolean (expected one of true,false,1,0): '${raw}'`);
    return fallback;
  }
  return key === "true" || key === "1";
}

function parseIntGE0(
  problems: string[],
  rawFlags: Readonly<Record<string, string | undefined>>,
  rawEnv: Readonly<Record<string, string | undefined>>,
  flag: string,
  fallback: number,
): number {
  const raw = rawValue(rawFlags, rawEnv, flag);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    problems.push(`settings.${flag}: not a non-negative integer: '${raw}'`);
    return fallback;
  }
  return value;
}

function parseStringOrNull(
  rawFlags: Readonly<Record<string, string | undefined>>,
  rawEnv: Readonly<Record<string, string | undefined>>,
  flag: string,
): string | null {
  return rawValue(rawFlags, rawEnv, flag) ?? null;
}

function stripRefPrefix(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** data-model §2 branch resolution: input -> GITHUB_BASE_REF -> GITHUB_REF_NAME -> null. */
function resolveTargetBranch(
  flags: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const direct = rawValue(flags, env, "branch");
  if (direct !== undefined) {
    return direct;
  }
  const base = env["GITHUB_BASE_REF"];
  if (base !== undefined && base.trim() !== "") {
    return base.trim();
  }
  const refName = env["GITHUB_REF_NAME"];
  if (refName !== undefined && refName.trim() !== "") {
    return stripRefPrefix(refName.trim());
  }
  return null;
}

/** data-model §2 protected set: input CSV -> {GITHUB_BASE_REF} when non-empty -> []. */
function resolveProtectedBranches(
  flags: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const raw = rawValue(flags, env, "protected-branches");
  if (raw !== undefined) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  const base = env["GITHUB_BASE_REF"];
  if (base !== undefined && base.trim() !== "") {
    return [base.trim()];
  }
  return [];
}

export function resolveSettings(input: RawSettingsInput = {}): EnforcementSettings {
  const flags = input.flags ?? {};
  const env = input.env ?? {};
  const cwd = input.cwd ?? "/";
  const problems: string[] = [];

  let workspace = rawValue(flags, env, "workspace") ?? cwd;
  if (!isAbsolute(workspace)) {
    workspace = resolvePath(cwd, workspace);
  }
  if (!existsSync(workspace)) {
    problems.push(`settings.workspace: path does not exist: '${workspace}'`);
  }

  const configFile = parseStringOrNull(flags, env, "config");
  if (configFile !== null && configFile.trim() === "") {
    problems.push("settings.config: must be non-empty when set");
  }

  const commandRaw = rawValue(flags, env, "command");
  let command: "check" | "plan" = "check";
  if (commandRaw !== undefined) {
    if (COMMAND_SET.has(commandRaw)) {
      command = commandRaw as "check" | "plan";
    } else {
      problems.push(`settings.command: not one of check,plan: '${commandRaw}'`);
    }
  }

  const reportPath = parseStringOrNull(flags, env, "report");
  const cliEntry = parseStringOrNull(flags, env, "cli-entry");
  const failOnUnmapped = parseBool(problems, flags, env, "fail-on-unmapped", true);
  const unmappedThreshold = parseIntGE0(problems, flags, env, "unmapped-threshold", 0);
  const failOnConflicts = parseBool(problems, flags, env, "fail-on-conflicts", true);
  const failOnDrift = parseBool(problems, flags, env, "fail-on-drift", true);
  const driftThreshold = parseIntGE0(problems, flags, env, "drift-threshold", 0);
  const protectedBranches = resolveProtectedBranches(flags, env);
  const targetBranch = resolveTargetBranch(flags, env);

  if (problems.length > 0) {
    throw new CiConfigError(
      `task-linear-sync enforcement configuration error — ${problems.join("; ")}`,
      problems,
    );
  }

  return {
    workspace,
    configFile,
    command,
    reportPath,
    cliEntry,
    failOnUnmapped,
    unmappedThreshold,
    failOnConflicts,
    failOnDrift,
    driftThreshold,
    protectedBranches,
    targetBranch,
  };
}
