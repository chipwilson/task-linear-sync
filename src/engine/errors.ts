/**
 * Engine error taxonomy (research R14; contracts/engine-pipeline.md "Non-goals").
 * T007 (Phase 2, foundational) — fully implemented here; no later task revises this file.
 *
 * These classes carry **internal** engine failures only. User-facing refusals NEVER use
 * them: refusals reuse the frozen `GateFailure` codes verbatim (`src/gates/gates.ts`), so
 * 009/012/013 match one vocabulary — inventing engine-local refusal codes is forbidden
 * (R14: "no new refusal vocabulary"; the frozen vocabulary only grows by amendment).
 * Internal errors never masquerade as gates (contracts/engine-pipeline.md).
 */

/**
 * Base class for internal sync-engine failures (research R14). Not a refusal surface:
 * a thrown `EngineError` means the engine itself could not proceed, not that a gate
 * refused the caller.
 */
export class EngineError extends Error {
  override readonly name: string = "EngineError";
}

/**
 * The `fail` conflict action resolved for a task (research R6; data-model §4;
 * contracts/conflict-resolution-matrix.md §2). Thrown **before the next mutation**;
 * the run reports `ApplyResult.status: "aborted"` and already-applied journal steps
 * remain rollback-able (no automatic rollback — the operator decides).
 */
export class EngineFailError extends EngineError {
  override readonly name = "EngineFailError";

  /** Task whose resolved conflict action is `fail`. */
  readonly taskUuid: string;

  /** Sanitized reason (conflict type + mapped action label); never raw content (R6). */
  readonly reason?: string;

  constructor(taskUuid: string, reason?: string) {
    // The task UUID stays on the structured field — never echoed into the message
    // beyond the generic label (Principle II posture on propagated text).
    super(`conflict resolution mapped to 'fail' — run aborted before the next mutation${reason ? ` (${reason})` : ""}`);
    this.taskUuid = taskUuid;
    this.reason = reason;
  }
}

/**
 * Durable-identity integrity failure (constitution Principle II; research R8/R10/R14;
 * data-model §8): more than one issue carries one task UUID, or the identity lookup
 * found an ambiguous multi-match. A hard failure — creation is aborted and surfaced,
 * never silently adopted.
 */
export class IntegrityError extends EngineError {
  override readonly name = "IntegrityError";

  /** The task identity that collided. */
  readonly taskUuid: string;

  /** The colliding issue ids (≥ 2 for a multi-match collision). */
  readonly issueIds: readonly string[];

  constructor(taskUuid: string, issueIds: readonly string[]) {
    super("durable-identity collision — multiple issues carry one task identity; operation aborted and surfaced (Principle II)");
    this.taskUuid = taskUuid;
    this.issueIds = issueIds;
  }
}

/**
 * Journal tamper or unreadability (research R9/R11/R14; contracts/journal-rollback.md §2):
 * envelope tag-check failure, unreadable manifest/step-journal, or malformed journal
 * material. Carries **no plaintext** — the message is a sanitized diagnostic only
 * (parallel posture to the frozen `ManifestTamperError`).
 */
export class JournalError extends EngineError {
  override readonly name = "JournalError";

  /** Run whose journal artifacts could not be trusted or read (when known). */
  readonly runId?: string;

  constructor(message: string, options?: { readonly runId?: string; readonly cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.runId = options?.runId;
  }
}
