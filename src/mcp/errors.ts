/**
 * T021 — the refusal taxonomy (data-model §7) + the construction-time config error.
 *
 * Two channels, never mixed (tasks Notes): protocol faults are JSON-RPC error objects
 * (closed code set, `jsonrpc.ts`); EVERY tool-level refusal is an `isError: true`
 * tool RESULT carrying one of these data shapes. No gate codes are re-implemented here —
 * `GateFailureCode` is reused verbatim from the frozen `src/gates` vocabulary; the
 * `SurfaceCode` trio covers only policy this module owns (enablement, argument shape,
 * lane failure).
 */

import type { GateFailureCode } from "../gates/index.js";

export const SURFACE_CODES = ["MUTATING_TOOLS_DISABLED", "INVALID_ARGUMENTS", "LANE_FAILURE"] as const;

export type SurfaceCode = (typeof SURFACE_CODES)[number];

/** Refusal codes: the module's own surface codes plus the FROZEN engine gate vocabulary. */
export type RefusalCode = SurfaceCode | GateFailureCode;

/** One refusal line — stable-key, machine-readable, screened by the producer. */
export interface ToolRefusal {
  readonly code: RefusalCode;
  readonly detail: string;
}

/**
 * Render one refusal payload as the single JSON text block of an `isError` tool result:
 * `schemaVersion` first (stable-key posture, tool-definitions.md §3); EVERY failure is
 * listed (complete-listing posture — the engine's multi-failure contract, apply-gating §1.6).
 */
export function renderRefusal(topCode: RefusalCode, failures: readonly ToolRefusal[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    status: "refused",
    error: topCode,
    failures: failures.map((f) => ({ code: f.code, detail: f.detail })),
  });
}

/** Single-refusal shorthand (surface codes never multi-list). */
export function renderSingleRefusal(code: SurfaceCode, detail: string): string {
  return renderRefusal(code, [{ code, detail }]);
}

/**
 * Construction-time only: the surface refuses to come up with an ambiguous configuration.
 * Messages name config KEYS or env-var NAMES — never values (transport-auth.md §2.3).
 */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}
