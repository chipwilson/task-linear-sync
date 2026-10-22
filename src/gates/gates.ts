/**
 * Gate vocabulary (frozen — constitution Principle I). The gate evaluator runs inside
 * 008's engine; 002 freezes the vocabulary, request, and result shape so 009/010/012
 * render identical refusals and 013 can match on codes.
 * Mirror: contracts/engine-gates.md.
 */
import type { StoredPlan } from "../domain/plan.js";

/** Caller-supplied gate state for the single gated apply operation. */
export interface GateRequest {
  /** Surface-level explicit apply flag. */
  readonly applyFlag: boolean;
  /** Must match config confirmationKey EXACTLY (never a built-in constant; 001 R17.7). */
  readonly confirmationKey: string;
  /** Required when any match is below "high". */
  readonly acceptLowConfidence: boolean;
  /** planId of a stored plan (task_sync_apply path). */
  readonly planReference?: string;
}

/**
 * Discrete machine-readable refusal codes — identical across every surface (009 exit
 * rendering, 012 tool errors, 013 matching). Additions are amendments (FR-008).
 */
export type GateFailureCode =
  | "APPLY_FLAG_MISSING"
  | "CONFIRMATION_KEY_MISMATCH"
  | "LOW_CONFIDENCE_NOT_ACCEPTED"
  | /** no stored plan for this id */
  "PLAN_REFERENCE_UNKNOWN"
  | /** stored plan exists; guards broken (hash/HEAD drift) */
  "PLAN_REFERENCE_STALE"
  | /** live-process lock; loser reports and exits */
  "LOCK_HELD"
  /** rollback/apply dependency past expiry */
  | "MANIFEST_EXPIRED"
  /** rollback with journaling off or no journal */
  | "MANIFEST_UNJOURNALED";

export interface GateFailure {
  readonly code: GateFailureCode;
  /** Sanitized, human-readable, names the offending value. */
  readonly detail: string;
}

export type GateValidation = { readonly valid: true } | { readonly valid: false; readonly failure: GateFailure };

/**
 * Validation of a stored plan's freshness (data-model § 9). Pure predicate; 008 re-runs it
 * at apply start; 012 uses it for Plan_Reference acceptance. A plan whose guards broke is
 * NEVER valid again — a drifted plan requires a plan rebuild (data-model §9 transition).
 * `plan === null` models the unknown-id case (no stored plan resolves for the reference).
 * All broken guards are listed together in `failure.detail` — no fail-fast-on-first,
 * mirroring config validation's complete-listing posture.
 */
export function validatePlanReference(
  plan: StoredPlan | null,
  current: { fileHashes: Record<string, string>; headCommit: string | null },
): GateValidation {
  if (plan === null) {
    return {
      valid: false,
      failure: {
        code: "PLAN_REFERENCE_UNKNOWN",
        detail: "no stored plan resolves for this plan reference; re-plan",
      },
    };
  }
  const problems: string[] = [];
  for (const [file, expected] of Object.entries(plan.plan.guards.fileHashes)) {
    const actual = current.fileHashes[file];
    if (actual === undefined) problems.push(`guard file missing: ${file}`);
    else if (actual !== expected) problems.push(`guard file hash drift: ${file}`);
  }
  if (plan.plan.guards.headCommit !== current.headCommit) {
    problems.push(
      `VCS HEAD drift: plan recorded ${plan.plan.guards.headCommit ?? "(none)"}, now ${current.headCommit ?? "(none)"}`,
    );
  }
  if (problems.length > 0) {
    return {
      valid: false,
      failure: {
        code: "PLAN_REFERENCE_STALE",
        detail: `plan ${plan.plan.planId} is stale — ${problems.join("; ")}; rebuild the plan`,
      },
    };
  }
  return { valid: true };
}
