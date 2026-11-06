/**
 * T019 — the additive `mcp` settings group (data-model §3). `resolveMcpConfig` is a
 * PURE read of the frozen `ResolvedConfig` on the `src/queue/config.ts` precedent:
 * built-ins → config-file `mcp` group → programmatic `settings` overrides; unknown keys
 * and out-of-range values collect ALL problems into exactly ONE dotted-key line and
 * the result carries the pure defaults with `ok: false` (complete listing, never
 * fail-fast). The frozen 001 schema is NOT edited: its derived trio
 * (`mutatingToolsEnabled`, `transport`, `authEnvVarName`) reads as the aliases of
 * `enabled`, `transport`, `tokenEnvVarName` — never as unknown keys.
 */

import { envVarPrefixFor } from "../config/index.js";
import type { ResolvedConfig } from "../config/index.js";

export interface McpSettings {
  /** Mutating-tool enablement ONLY; engine gates stay mandatory (research R8). */
  readonly enabled: boolean;
  readonly transport: "stdio" | "http";
  /** Bind host (http transport only). */
  readonly host: string;
  /** 0 = ephemeral; the bound port is announced once to stderr at listen. */
  readonly port: number;
  /** Env-var NAME holding the bearer token — NAMES only, values live in env. */
  readonly tokenEnvVarName: string;
}

export type McpConfigResult =
  | { readonly ok: true; readonly settings: McpSettings }
  | { readonly ok: false; readonly errors: readonly string[]; readonly settings: McpSettings };

/** Built-in defaults — inert by inspection (defaults-scan, T053). */
export function mcpBuiltins(config: ResolvedConfig): McpSettings {
  return {
    enabled: false,
    transport: "stdio",
    host: "127.0.0.1",
    port: 0,
    tokenEnvVarName: `${envVarPrefixFor(config.toolId)}_MCP_TOKEN`,
  };
}

const FILE_KEYS = ["enabled", "transport", "host", "port", "tokenEnvVarName", "mutatingToolsEnabled", "authEnvVarName"] as const;
const OVERRIDE_KEYS = ["enabled", "transport", "host", "port", "tokenEnvVarName"] as const;

const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

type Layer = Record<string, unknown>;

function rawMcpGroup(config: ResolvedConfig): Layer {
  const group = (config as unknown as Record<string, unknown>)["mcp"];
  if (typeof group !== "object" || group === null || Array.isArray(group)) return {};
  return group as Layer;
}

/** Per-key validation; returns an error line or undefined when the value is legal. */
function validateValue(key: string, value: unknown): string | undefined {
  switch (key) {
    case "enabled":
      return typeof value === "boolean" ? undefined : `${key}: must be a boolean`;
    case "transport":
      return value === "stdio" || value === "http" ? undefined : `${key}: must be "stdio" or "http"`;
    case "host":
      return typeof value === "string" && value.trim().length > 0 ? undefined : `${key}: must be a non-empty string`;
    case "port":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535
        ? undefined
        : `${key}: must be an integer in 0..65535`;
    case "tokenEnvVarName":
      return typeof value === "string" && ENV_VAR_NAME_PATTERN.test(value)
        ? undefined
        : `${key}: must be an env-var NAME (upper snake-case)`;
    default:
      return `${key}: unknown key`;
  }
}

/**
 * Resolve the `mcp` group. `overrides` is the TOP layer (programmatic,
 * component-api §1). On any problem the FULL listing lands in ONE line and `settings`
 * carries the pure built-ins — callers MUST check `ok`.
 */
export function resolveMcpConfig(config: ResolvedConfig, overrides?: Partial<McpSettings> | undefined): McpConfigResult {
  const builtins = mcpBuiltins(config);
  const group = rawMcpGroup(config);
  const problems: string[] = [];

  const file: Layer = {};
  for (const key of Object.keys(group)) {
    if (!(FILE_KEYS as readonly string[]).includes(key)) {
      problems.push(`mcp.${key}: unknown key`);
      continue;
    }
    file[key] = group[key];
  }
  const overrideLayer: Layer = isRecord(overrides) ? { ...(overrides as Layer) } : {};
  for (const key of Object.keys(overrideLayer)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) {
      problems.push(`settings.${key}: unknown key`);
    }
  }

  // Validate every present value in both layers (complete listing before any merge).
  for (const key of Object.keys(file)) {
    if ((FILE_KEYS as readonly string[]).includes(key) && key !== "mutatingToolsEnabled" && key !== "authEnvVarName") {
      const problem = validateValue(key, file[key]);
      if (problem !== undefined) problems.push(`mcp.${problem}`);
    }
  }
  const fileAliasEnabled = Object.hasOwn(file, "mutatingToolsEnabled");
  if (fileAliasEnabled && typeof file["mutatingToolsEnabled"] !== "boolean") {
    problems.push("mcp.mutatingToolsEnabled: must be a boolean");
  }
  const fileAliasToken = Object.hasOwn(file, "authEnvVarName");
  if (fileAliasToken && typeof file["authEnvVarName"] !== "string") {
    problems.push("mcp.authEnvVarName: must be a string");
  }
  for (const key of Object.keys(overrideLayer)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) continue;
    const problem = validateValue(key, overrideLayer[key]);
    if (problem !== undefined) problems.push(`settings.${problem}`);
  }

  if (problems.length > 0) {
    return { ok: false, errors: [problems.join("; ")], settings: builtins };
  }

  const pick = <K extends keyof McpSettings>(key: K, alias?: unknown): McpSettings[K] => {
    if (Object.hasOwn(overrideLayer, key)) return overrideLayer[key as string] as McpSettings[K];
    if (Object.hasOwn(file, key)) return file[key as string] as McpSettings[K];
    if (alias !== undefined) return alias as McpSettings[K];
    return builtins[key];
  };

  const settings: McpSettings = {
    enabled: pick("enabled", fileAliasEnabled ? file["mutatingToolsEnabled"] : undefined),
    transport: pick("transport"),
    host: pick("host"),
    port: pick("port"),
    tokenEnvVarName: pick("tokenEnvVarName", fileAliasToken ? file["authEnvVarName"] : undefined),
  };
  return { ok: true, settings };
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
