/**
 * T010 — typed abort surface (data-model.md §6). Payload text carries only ids/keys —
 * "no secret-shaped content". Both errors extend Error with fixed `name` fields.
 */

/**
 * Raised by `checkMatchingConfig` (entry of every public 006 call, research R9):
 * weights integer ≥ 0; floors integer ≥ 0 with `medium ≥ plausible`;
 * `minimumMatchMargin` integer ≥ 1. No clamping, rounding, or ignoring (R9).
 */
export class MatchingConfigError extends Error {
  override readonly name = "MatchingConfigError";
  /** Offending configuration key (dot path, e.g. `scoringWeights.durableUuid`). */
  readonly key: string;
  /** The offending value as given (never coerced). */
  readonly value: unknown;
  /** The violated rule, quoted in human-readable form. */
  readonly rule: string;

  constructor(key: string, value: unknown, rule: string) {
    super(`invalid matching config '${key}': ${String(value)} — ${rule}`);
    this.key = key;
    this.value = value;
    this.rule = rule;
  }
}

/**
 * Raised by the `projectCandidates` integrity scan: ">1 issue carrying the same task
 * UUID is a hard integrity failure: the run MUST abort with no changes applied"
 * (constitution II; 001 R5 c3). Purity ⇒ "no changes" structurally holds: the throw
 * emits no `MatchingResult`.
 */
export class DurableIdentityCollisionError extends Error {
  override readonly name = "DurableIdentityCollisionError";
  /** The conflicting durable task UUID. */
  readonly taskUuid: string;
  /** ALL conflicting issue identifiers, sorted ascending. */
  readonly issueIds: readonly string[];

  constructor(taskUuid: string, issueIds: readonly string[]) {
    super(
      `durable identity collision: task uuid ${taskUuid} is carried by ${issueIds.length} issues (${issueIds.join(", ")}) — run aborted, no changes applied`,
    );
    this.taskUuid = taskUuid;
    this.issueIds = issueIds;
  }
}
