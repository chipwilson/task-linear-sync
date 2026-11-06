/**
 * T008 — CLI error taxonomy (data-model §2; contracts/command-surface.md §3).
 * Refusals reuse the frozen `GateFailure` values VERBATIM — no new gate vocabulary
 * (research R14 posture carried over from the engine). Messages are constructed to be
 * screening-safe: names only, never credential values or raw task content.
 */
import type { GateFailure } from "../gates/gates.js";

/** Parse/usage failure (exit 2); carries every offending flag (FR-002 complete listing). */
export class UsageError extends Error {
  override readonly name = "UsageError";
  /** Every offending flag token, in argv order (empty for non-flag usage errors). */
  readonly flags: readonly string[];

  constructor(message: string, flags: readonly string[] = []) {
    super(message);
    this.flags = flags;
  }
}

/**
 * Gate refusal (exit 4) — the frozen `GateFailure[]` listing, complete, never filtered.
 * `LOCK_HELD`-containing listings are re-mapped to 6 by the exit-code table.
 */
export class GateRefusalError extends Error {
  override readonly name = "GateRefusalError";
  readonly failures: readonly GateFailure[];

  constructor(failures: readonly GateFailure[]) {
    super(
      `operation refused: ${failures.map((f) => `${f.code} — ${f.detail}`).join(" · ")}`,
    );
    this.failures = failures;
  }
}

/** Run abort (exit 5): aborted apply, missing report artifact, integrity/aborted drift. */
export class RunAbortedError extends Error {
  override readonly name = "RunAbortedError";
}

/** The `ReadOnlyGuard` (data-model §5) refused a mutating attempt (exit 5, SC-003). */
export class ReadOnlyViolationError extends Error {
  override readonly name = "ReadOnlyViolationError";
}

/**
 * A `QueueSurface` member was invoked while `task-linear-sync/queue` is absent
 * (exit 7; contracts/queue-surface.md §2). Names the command and the missing module.
 */
export class QueueSurfaceUnavailableError extends Error {
  override readonly name = "QueueSurfaceUnavailableError";
  readonly command: string;
  readonly module: string;

  constructor(command: string, moduleName: string) {
    super(
      `${command} is provided by the background-queue feature (${moduleName}), which is not installed in this build`,
    );
    this.command = command;
    this.module = moduleName;
  }
}
