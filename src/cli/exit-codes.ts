/**
 * T009 — `ExitCode` + pure `exitCodeForError` (contracts/command-surface.md §3;
 * data-model §3; research R3). PLACEHOLDER until T009 lands: mapping not yet implemented.
 */
import type { GateFailureCode } from "../gates/gates.js";

/** Frozen 009 exit vocabulary (docs/cli.md reproduces this table verbatim). */
export enum ExitCode {
  SUCCESS = 0,
  UNEXPECTED_ERROR = 1,
  USAGE_ERROR = 2,
  CONFIGURATION_ERROR = 3,
  GATE_REFUSED = 4,
  RUN_ABORTED = 5,
  LOCK_HELD = 6,
  SURFACE_UNAVAILABLE = 7,
  CHECK_FINDINGS = 8,
}

/** Total pure map over the CLI taxonomy + frozen gate vocabulary — placeholder stub. */
export function exitCodeForError(_error: unknown): ExitCode {
  return ExitCode.SUCCESS;
}

/** Frozen `GateFailureCode` → exit code — placeholder stub. */
export function exitCodeForGateFailureCode(_code: GateFailureCode): ExitCode {
  return ExitCode.SUCCESS;
}
