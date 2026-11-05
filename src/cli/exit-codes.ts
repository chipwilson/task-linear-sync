/**
 * T009 — `ExitCode` + pure `exitCodeForError` (contracts/command-surface.md §3;
 * data-model §3; research R3). Total function over the CLI taxonomy (data-model §2)
 * plus the frozen `GateFailureCode` union; no code outside the documented 0–8 table
 * is producible.
 */
import type { GateFailureCode } from "../gates/gates.js";
import {
  GateRefusalError,
  QueueSurfaceUnavailableError,
  ReadOnlyViolationError,
  RunAbortedError,
  UsageError,
} from "./errors.js";

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

/**
 * Frozen `GateFailureCode` → exit code (contracts/command-surface.md §3): every frozen
 * code except `LOCK_HELD` is a gate refusal (4); `LOCK_HELD` is retry-later (6).
 * Exhaustive switch — a future frozen-code amendment surfaces as a compile error here.
 */
export function exitCodeForGateFailureCode(code: GateFailureCode): ExitCode {
  switch (code) {
    case "APPLY_FLAG_MISSING":
    case "CONFIRMATION_KEY_MISMATCH":
    case "LOW_CONFIDENCE_NOT_ACCEPTED":
    case "PLAN_REFERENCE_UNKNOWN":
    case "PLAN_REFERENCE_STALE":
    case "MANIFEST_EXPIRED":
    case "MANIFEST_UNJOURNALED":
      return ExitCode.GATE_REFUSED;
    case "LOCK_HELD":
      return ExitCode.LOCK_HELD;
  }
}

function nameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/** True when `error` is (or duck-matches) one of the named classes. */
function isErrorNamed(error: unknown, ...names: string[]): boolean {
  const name = nameOf(error);
  return name !== undefined && names.includes(name);
}

/**
 * Total pure map from any thrown value to its exit code.
 *
 * Recognition is by the stable error `name` every taxonomy member carries —
 * frozen classes override `name` at construction (EngineError subclasses
 * included), and CLI-owned classes set theirs. Name matching is deliberate:
 * instanceof splits whenever a test or consumer loads the published entry
 * points (`task-linear-sync/*`) while the CLI runs from compiled sources,
 * and the exit contract must hold across both module graphs. Credential
 * preflight failures surface as `TrackerConfigError` — recognized by name so
 * `src/cli` stays off the tracker's concrete classes (data-model §2).
 */
export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof UsageError || isErrorNamed(error, "UsageError")) return ExitCode.USAGE_ERROR;
  if (
    error instanceof QueueSurfaceUnavailableError ||
    isErrorNamed(error, "QueueSurfaceUnavailableError")
  ) {
    return ExitCode.SURFACE_UNAVAILABLE;
  }
  if (error instanceof GateRefusalError || isErrorNamed(error, "GateRefusalError")) {
    // Complete listing wins: a LOCK_HELD anywhere in the listing signals retry-later.
    const failures: readonly { code: string }[] =
      error instanceof GateRefusalError
        ? error.failures
        : Array.isArray((error as { failures?: unknown }).failures)
          ? (error as { failures: readonly { code: string }[] }).failures
          : [];
    return failures.some((f) => f.code === "LOCK_HELD")
      ? ExitCode.LOCK_HELD
      : ExitCode.GATE_REFUSED;
  }
  if (
    isErrorNamed(error, "ConfigFileError", "MissingIdentityError", "StatePlacementError") ||
    // Credential-preflight diagnostics surface as the tracker's named config error.
    isErrorNamed(error, "TrackerConfigError")
  ) {
    return ExitCode.CONFIGURATION_ERROR;
  }
  if (
    error instanceof RunAbortedError ||
    error instanceof ReadOnlyViolationError ||
    // The frozen engine family + report screening all carry stable names.
    isErrorNamed(error, "EngineError", "EngineFailError", "IntegrityError", "JournalError", "ReportScreeningError")
  ) {
    return ExitCode.RUN_ABORTED;
  }
  return ExitCode.UNEXPECTED_ERROR;
}
