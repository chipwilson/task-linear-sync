/**
 * T022 — the tool registry (data-model §4; contracts/tool-definitions.md §1–§2).
 * Static definition data with the §2 schema literals VERBATIM, the pure visibility
 * predicate (`visible = !def.mutating || settings.enabled`) that drives BOTH tools/list
 * rendering AND tools/call dispatch, and the complete-listing argument validator.
 * Descriptions carry placeholder identifiers only.
 */

import type { McpSettings } from "./config.js";

export const TOOL_NAMES = ["task_sync_plan", "task_sync_status", "task_sync_inventory", "task_sync_apply"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly mutating: boolean;
}

/** One argument-shape problem (complete listing — every problem in ONE pass). */
export interface ToolArgumentIssue {
  readonly path: string;
  readonly message: string;
}

const READ_ONLY_SCHEMA = Object.freeze({ type: "object", additionalProperties: false });

const EMPTY_PROPS = Object.freeze({});

function readOnlyDefinition(name: ToolName, description: string): ToolDefinition {
  return Object.freeze({ name, description, inputSchema: READ_ONLY_SCHEMA, mutating: false });
}

export const TASK_SYNC_PLAN_TOOL: ToolDefinition = readOnlyDefinition(
  "task_sync_plan",
  "Run the read-only plan/check lane over the configured repository and return the sanitized, hash-based plan report as stable-key JSON. Records a plan reference usable by task_sync_apply for the rest of this session. Accepts no arguments.",
);

export const TASK_SYNC_STATUS_TOOL: ToolDefinition = readOnlyDefinition(
  "task_sync_status",
  "Read-only run-state snapshot: the last-run marker, the pending queue job, the worker/queue lock, and how many plan references this session may still apply. Performs zero tracker calls and zero writes. Accepts no arguments.",
);

export const TASK_SYNC_INVENTORY_TOOL: ToolDefinition = readOnlyDefinition(
  "task_sync_inventory",
  "List discoverable task files with the matched framework adapter id and task counts, plus parse refusals and warnings. Paths and counts only - never file contents. Accepts no arguments.",
);

export const TASK_SYNC_APPLY_TOOL: ToolDefinition = Object.freeze({
  name: "task_sync_apply" as ToolName,
  description:
    "Apply a plan reference produced by task_sync_plan IN THIS SESSION through the same gated engine entry the CLI and queue use. Requires the mcp.enabled setting, the exact confirmation key, and the explicit plan reference; low-confidence plans additionally require acceptLowConfidence.",
  inputSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["planReference", "confirmationKey"],
    properties: Object.freeze({
      planReference: Object.freeze({ type: "string", pattern: "^[0-9a-f]{64}$" }),
      confirmationKey: Object.freeze({ type: "string", minLength: 1 }),
      acceptLowConfidence: Object.freeze({ type: "boolean", default: false }),
    }),
  }),
  mutating: true,
});

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.freeze([
  TASK_SYNC_PLAN_TOOL,
  TASK_SYNC_STATUS_TOOL,
  TASK_SYNC_INVENTORY_TOOL,
  TASK_SYNC_APPLY_TOOL,
]);

const BY_NAME = new Map<string, ToolDefinition>(TOOL_DEFINITIONS.map((def) => [def.name, def]));

/** THE visibility predicate — the same call feeds list AND dispatch (SC-003). */
export function isVisible(def: ToolDefinition, settings: Pick<McpSettings, "enabled">): boolean {
  return !def.mutating || settings.enabled;
}

/** tools/list rendering: a pure function of the resolved settings. */
export function visibleTools(settings: Pick<McpSettings, "enabled">): readonly ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((def) => isVisible(def, settings));
}

export type ToolCallResolution = { readonly kind: "unknown" } | { readonly kind: "invisible" } | { readonly kind: "ok"; readonly def: ToolDefinition };

/** tools/call gate: unknown names and settings-invisible tools never reach a core. */
export function resolveToolCall(name: string, settings: Pick<McpSettings, "enabled">): ToolCallResolution {
  const def = BY_NAME.get(name);
  if (def === undefined) return { kind: "unknown" };
  if (!isVisible(def, settings)) return { kind: "invisible" };
  return { kind: "ok", def };
}

function rootIssue(): ToolArgumentIssue[] {
  return [{ path: "(root)", message: "arguments must be a JSON object" }];
}

/**
 * Complete-listing validator for the §2 shapes (structural argument faults, NOT
 * envelope faults — these surface as isError tool results). Returns [] for unknown
 * names (the unknown-tool posture owns that case) and for conforming arguments.
 */
export function validateToolArguments(name: string, args: unknown): ToolArgumentIssue[] {
  const def = BY_NAME.get(name);
  if (def === undefined) return [];
  if (typeof args !== "object" || args === null || Array.isArray(args)) return rootIssue();
  const given = args as Record<string, unknown>;
  const issues: ToolArgumentIssue[] = [];

  const known = Object.keys(def.inputSchema.properties ?? EMPTY_PROPS);
  for (const key of Object.keys(given)) {
    if (!known.includes(key)) issues.push({ path: key, message: "unknown property (additionalProperties: false)" });
  }

  if (def.name === "task_sync_apply") {
    const reference = given["planReference"];
    if (reference === undefined) issues.push({ path: "planReference", message: "required" });
    else if (typeof reference !== "string" || !/^[0-9a-f]{64}$/.test(reference)) {
      issues.push({ path: "planReference", message: "must be a 64-character lowercase hex plan id" });
    }
    const confirmation = given["confirmationKey"];
    if (confirmation === undefined) issues.push({ path: "confirmationKey", message: "required" });
    else if (typeof confirmation !== "string" || confirmation.length < 1) {
      issues.push({ path: "confirmationKey", message: "must be a non-empty string" });
    }
    if (given["acceptLowConfidence"] !== undefined && typeof given["acceptLowConfidence"] !== "boolean") {
      issues.push({ path: "acceptLowConfidence", message: "must be a boolean" });
    }
  }
  return issues;
}
