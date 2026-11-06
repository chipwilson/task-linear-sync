/**
 * 012 shared error types (T014, research R12).
 *
 * Surfacing rules are strict about where each code may appear:
 *
 *  - SurfaceError carries the three tool-surface codes (INVALID_ARGUMENTS,
 *    MUTATING_TOOLS_DISABLED, LANE_FAILURE). These NEVER cross the wire as
 *    JSON-RPC error objects: tool-level problems come back as tool-call
 *    results with isError:true (contracts/apply-gating.md §1,
 *    contracts/tool-definitions.md §1). The dispatcher converts.
 *  - McpConfigError is construction-time only: the surface refuses to come
 *    up with an ambiguous configuration and the message names the offending
 *    keys — or, for the token binding, only the env-var NAME, never a value
 *    (contracts/transport-auth.md §4).
 *  - Protocol-level failures use the closed JSON-RPC code set carried by
 *    JsonRpcFailure in jsonrpc.ts; nothing outside that set is ever emitted.
 */

export const SURFACE_ERROR_CODES = ["INVALID_ARGUMENTS", "MUTATING_TOOLS_DISABLED", "LANE_FAILURE"] as const;

export type SurfaceErrorCode = (typeof SURFACE_ERROR_CODES)[number];

export interface SurfaceIssue {
  readonly path: string;
  readonly message: string;
}

export class SurfaceError extends Error {
  readonly code: SurfaceErrorCode;

  /** Screening is applied by the producer before throwing (lane stderr). */
  readonly issues: readonly SurfaceIssue[];

  constructor(code: SurfaceErrorCode, message: string, issues: readonly SurfaceIssue[] = []) {
    super(message);
    this.name = "SurfaceError";
    this.code = code;
    this.issues = issues;
  }
}

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}
