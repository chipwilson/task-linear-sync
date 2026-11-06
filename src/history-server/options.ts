/**
 * Settings resolution for the history surface (T008; data-model §4,
 * contracts/component-api.md §2).
 *
 * A PURE READ of the frozen 001 `web` surface group on the merged
 * `ResolvedConfig` — no new config sources, no mutation, no re-reading later.
 * The 014 amendment added the four resource-bound keys to that group
 * (configuration.md amendment 2026-11-06); the range guards below run at
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
  readonly maxCacheEntries: number;
  readonly maxConcurrentWalks: number;
  readonly maxConcurrentSseStreams: number;
  readonly secureCookies: boolean;
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
  // 014 amendment bounds (contracts/resource-bounds.md §1) — same complete-listing posture.
  if (!Number.isInteger(web.maxCacheEntries) || web.maxCacheEntries < 1 || web.maxCacheEntries > 100000) {
    problems.push("web.maxCacheEntries: must be an integer in 1..100000");
  }
  if (!Number.isInteger(web.maxConcurrentWalks) || web.maxConcurrentWalks < 1 || web.maxConcurrentWalks > 64) {
    problems.push("web.maxConcurrentWalks: must be an integer in 1..64");
  }
  if (!Number.isInteger(web.maxConcurrentSseStreams) || web.maxConcurrentSseStreams < 1 || web.maxConcurrentSseStreams > 1000) {
    problems.push("web.maxConcurrentSseStreams: must be an integer in 1..1000");
  }
  if (typeof web.secureCookies !== "boolean") {
    problems.push("web.secureCookies: must be a boolean");
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
    maxCacheEntries: web.maxCacheEntries,
    maxConcurrentWalks: web.maxConcurrentWalks,
    maxConcurrentSseStreams: web.maxConcurrentSseStreams,
    secureCookies: web.secureCookies,
  };
}
