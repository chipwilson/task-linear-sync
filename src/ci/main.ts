/**
 * 013-ci-enforcement-layer wrapper entry point (T034; action.md §4–§5,
 * wrapper-api.md §3–§4). The ONLY `node:process` consumer in `src/ci/` and
 * the only module that maps enforcement outcomes onto the wrapper exit
 * vocabulary (0 pass / 1 enforcement failure / 2 configuration or artifact
 * problem / 3 wrapped-CLI failure) — distinct from the CLI's own 0–8 map.
 *
 * Outputs: the six action.md §3 keys are appended to `$GITHUB_OUTPUT` ONLY
 * when the variable is set AND the run produced a pass/fail decision; error
 * exits (2/3) emit no outputs, never partial ones.
 */

import { appendFileSync } from "node:fs";
import process from "node:process";

import { loadConfig } from "../config/index.js";
import { createDefaultSecurityScreener } from "../engine/index.js";
import type { SecurityScreener } from "../ports/engine.js";

import { createSpawnCliInvoker } from "./cli-invoker.js";
import { CiArtifactError, CiCliFailureError, CiConfigError } from "./errors.js";
import { runEnforcement } from "./enforcement.js";
import { resolveSettings } from "./settings.js";

/** Flags accepted by the composite action (data-model §1) — closed set. */
const FLAG_NAMES: readonly string[] = [
  "workspace",
  "config",
  "command",
  "report",
  "cli-entry",
  "fail-on-unmapped",
  "unmapped-threshold",
  "fail-on-conflicts",
  "fail-on-drift",
  "drift-threshold",
  "protected-branches",
  "branch",
];

/** Parse `--name value` / `--name=value` pairs; unknown or dangling ⇒ error. */
export function parseArgs(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new CiConfigError(
        `task-linear-sync enforcement configuration error — arguments: unexpected argument \`${token}\` (expected --name value)`,
        [`arguments: unexpected argument \`${token}\``],
      );
    }
    const eq = token.indexOf("=");
    const name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (!FLAG_NAMES.includes(name)) {
      throw new CiConfigError(
        `task-linear-sync enforcement configuration error — arguments: unknown flag \`--${name}\``,
        [`arguments: unknown flag \`--${name}\``],
      );
    }
    const value = eq >= 0 ? token.slice(eq + 1) : argv[i + 1];
    if (eq < 0) {
      if (value === undefined || value.startsWith("--")) {
        throw new CiConfigError(
          `task-linear-sync enforcement configuration error — arguments: \`--${name}\` requires a value`,
          [`arguments: \`--${name}\` requires a value`],
        );
      }
      i += 1;
    }
    flags[name] = value ?? "";
  }
  return flags;
}

/** Screening for all wrapper-visible surfaces (R8): workspace config first. */
function buildScreener(configFile: string | null): SecurityScreener {
  try {
    return createDefaultSecurityScreener(loadConfig(configFile === null ? {} : { configFile }));
  } catch {
    return createDefaultSecurityScreener(loadConfig({}));
  }
}

/** Collapse to a single sanitized line for any unexpected throw. */
function sanitizeLine(value: unknown): string {
  return String(value instanceof Error ? `${value.name}: ${value.message}` : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

async function main(): Promise<number> {
  const env = process.env;
  let flags: Record<string, string>;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CiConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(`task-linear-sync enforcement failed — ${sanitizeLine(error)}\n`);
    return 2;
  }

  const screener = buildScreener(flags["config"] ?? null);

  const outcome = await runEnforcement(
    resolveSettings({ flags, env, cwd: process.cwd() }),
    {
      cliInvoker: createSpawnCliInvoker({ screener }),
      screener,
      env,
      log: (line, stream) => {
        (stream === "stdout" ? process.stdout : process.stderr).write(`${line}\n`);
      },
    },
  );

  const outputFile = env["GITHUB_OUTPUT"];
  if (outputFile !== undefined && outputFile.trim() !== "") {
    for (const [name, value] of Object.entries(outcome.outputs)) {
      appendFileSync(outputFile, `${name}=${value.replace(/\s+/g, " ")}\n`, "utf8");
    }
  }
  return outcome.status === "pass" ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof CiCliFailureError) {
      process.stderr.write(`task-linear-sync enforcement failed — ${error.message}\n`);
      process.exitCode = 3;
      return;
    }
    if (error instanceof CiArtifactError) {
      process.stderr.write(`task-linear-sync enforcement failed — ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof CiConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`task-linear-sync enforcement failed — ${sanitizeLine(error)}\n`);
    process.exitCode = 2;
  },
);
