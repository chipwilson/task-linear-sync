/**
 * 012 AI-agent tool interface — public package entry (T023 finalization;
 * contracts/component-api.md §2).
 *
 * Reaching this module pulls in zero transport implementations beyond the inbound
 * listener (research R2): importing task-linear-sync/mcp never imports the history
 * server, and the queue is reached only through its public barrel, so the static
 * dependency closure stays within the zero-runtime-dependency set.
 */

// Composition root (component-api §1–§2).
export { createAgentToolServer, SERVER_VERSION } from "./create.js";
export type { AgentToolServerApp, AgentToolServerDeps, ServerBag, ToolHandler } from "./create.js";

// Settings group (data-model §3).
export { resolveMcpConfig, mcpBuiltins } from "./config.js";
export type { McpSettings, McpConfigResult } from "./config.js";

// Error taxonomy (data-model §7).
export { McpConfigError, SURFACE_CODES, renderRefusal, renderSingleRefusal } from "./errors.js";
export type { RefusalCode, SurfaceCode, ToolRefusal } from "./errors.js";

// Session-scoped plan-reference store (data-model §5).
export { createPlanReferenceStore, isPlanIdShape, PLAN_ID_PATTERN } from "./plan-store.js";
export type { PlanReferenceRecord, PlanReferenceStore } from "./plan-store.js";

// Tool registry (data-model §4; tool-definitions.md).
export {
  isVisible,
  resolveToolCall,
  TASK_SYNC_APPLY_TOOL,
  TASK_SYNC_INVENTORY_TOOL,
  TASK_SYNC_PLAN_TOOL,
  TASK_SYNC_STATUS_TOOL,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  validateToolArguments,
  visibleTools,
} from "./tools.js";
export type { ToolArgumentIssue, ToolCallResolution, ToolDefinition, ToolName } from "./tools.js";

// Protocol types (data-model §1) — hosts implement the framing rules themselves.
export type { JsonRpcReply, PublishedTool, ToolCallResult } from "./jsonrpc.js";
