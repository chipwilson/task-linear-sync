/**
 * Settings resolution for the history surface (T008; data-model §4,
 * contracts/component-api.md §2).
 *
 * A PURE READ of the frozen 001 `web` surface group on the merged
 * `ResolvedConfig` — no new config keys, no mutation, no re-reading later.
 * 001 bounds no numeric ranges for `web`, so the range guards below run at
 * surface construction; out-of-range values fail with ALL problems listed,
 * one dotted-key line each (queue-group posture, `src/queue/config.ts`
 * precedent).
 */

import type { ResolvedConfig } from "../config/schema.js";
import { HistoryServerConfigError } from "./errors.js";

export interface ResolvedHistoryServerSettings {
  readonly accessMode: "private" | "public";
  readonly tokenEnvVarName: string;
  readonly sseEnabled: boolean;
  readonly refreshSeconds: number;
  readonly cacheTtlSeconds: number;
}

export function resolveHistoryServerConfig(
  config: ResolvedConfig,
): ResolvedHistoryServerSettings {
  const web = config.web;
  const problems: string[] = [];

  if (web.accessControlMode !== "private" && web.accessControlMode !== "public") {
    problems.push("web.accessControlMode: must be \"private\" or \"public\"");
  }
  if (typeof web.authEnvVarName !== "string" || web.authEnvVarName.trim() === "") {
    problems.push("web.authEnvVarName: must be a non-empty environment-variable name");
  }
  if (typeof web.realtimeSse !== "boolean") {
    problems.push("web.realtimeSse: must be a boolean");
  }
  if (!Number.isInteger(web.pollIntervalSeconds) || web.pollIntervalSeconds < 1 || web.pollIntervalSeconds > 3600) {
    problems.push("web.pollIntervalSeconds: must be an integer in 1..3600");
  }
  if (!Number.isInteger(web.cacheTtlSeconds) || web.cacheTtlSeconds < 0 || web.cacheTtlSeconds > 3600) {
    problems.push("web.cacheTtlSeconds: must be an integer in 0..3600 (0 disables)");
  }

  if (problems.length > 0) {
    throw new HistoryServerConfigError(
      `history: the web surface settings are invalid:\n${problems.join("\n")}`,
    );
  }

  return {
    accessMode: web.accessControlMode,
    tokenEnvVarName: web.authEnvVarName.trim(),
    sseEnabled: web.realtimeSse,
    refreshSeconds: web.pollIntervalSeconds,
    cacheTtlSeconds: web.cacheTtlSeconds,
  };
}
