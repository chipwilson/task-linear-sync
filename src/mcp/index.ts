/**
 * 012 AI-agent tool interface — public package entry (T002).
 *
 * Reaching this module pulls in zero transport implementations (research R2):
 * importing task-linear-sync/mcp never imports the history server, and the
 * queue is reached only through its public barrel, so the static dependency
 * closure stays within the zero-runtime-dependency set.
 *
 * The component API (createMcpServer) and the transport lifecycle functions
 * are added by the composition-root task; this entry currently exports the
 * shared error vocabulary so every consumer can classify failures without
 * importing internals.
 */

export {
  McpConfigError,
  SURFACE_ERROR_CODES,
  SurfaceError,
  type SurfaceErrorCode,
  type SurfaceIssue,
} from "./errors.js";
