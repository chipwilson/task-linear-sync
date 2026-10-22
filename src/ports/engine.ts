/**
 * Engine entry-point signatures (frozen; 008 implements the engine behind these). CLI (009),
 * queue worker (010), and agent tool (012) are callers — the one-engine rule (constitution V)
 * is a contract property, not a suggestion.
 * Mirror: contracts/engine-gates.md.
 */
import type { Plan, PlanDecision } from "../domain/plan.js";
import type { GateFailure, GateRequest } from "../gates/gates.js";
import type { LinearPort } from "./linear-port.js";

/** Everything injectable — hermetic (Principle VI). */
export interface EngineDependencies {
  readonly port: LinearPort;
  readonly config: import("../config/schema.js").ResolvedConfig;
  readonly state: import("../state/paths.js").StateStore;
  readonly clock: import("../state/clock.js").Clock;
  readonly screener: SecurityScreener;
}

/** Repository root + mode hint; semantics owned by 008. */
export interface BuildPlanOptions {
  readonly repositoryRoot: string;
  readonly mode?: "bootstrap" | "sync";
}

export interface OperationOutcome {
  readonly taskUuid: string;
  readonly decision: PlanDecision;
  readonly status: "applied" | "skipped" | "failed";
  readonly issueId?: string;
  /** Sanitized, screened. */
  readonly detail?: string;
}

export interface ApplyResult {
  readonly runId: string;
  readonly status: "applied" | "aborted" | "refused";
  /** Populated when status === "refused"; all failures reported together (complete listing). */
  readonly gateFailures: readonly GateFailure[];
  readonly operations: readonly OperationOutcome[];
  readonly reportPaths?: { readonly json: string; readonly markdown: string };
}

export interface RollbackResult {
  readonly runId: string;
  readonly status: "rolled-back" | "partial" | "refused";
  /** MANIFEST_UNJOURNALED / MANIFEST_EXPIRED refusals. */
  readonly refusal?: GateFailure;
  readonly reversedOperations: number;
}

/** Security screener surface (behavior owned by the engine run; shape frozen here). */
export interface SecurityScreener {
  /**
   * Blocking findings (secrets/PII classes) ⇒ propagation of affected content is aborted;
   * non-blocking findings (emails, review terms) redact/annotate per constitution.
   */
  screen(text: string): {
    readonly output: string;
    /** Category labels of blocking findings. */
    readonly blocked: readonly string[];
    /** All finding labels (blocking and non-blocking). */
    readonly findings: readonly string[];
  };
}

/**
 * The Sync Engine contract. buildSyncPlan is READ-ONLY: zero tracker mutations, zero
 * repository writes (constitution I). applySyncPlan is THE single mutating entry;
 * enforcement order (normative, engine-gates.md):
 *   1. gates (GateRequest → GateFailure[]; all failures reported together);
 *   2. advisory lock acquisition (run-state.md; LOCK_HELD on loss);
 *   3. plan stability re-check (guards + per-issue snapshot re-fetch → abort, no mutation);
 *   4. manifest complete-before-first-mutation (or MANIFEST_UNJOURNALED refusal for
 *      rollback; manifest-disabled applies proceed unjournaled per spec);
 *   5. mutations (screened, journaled, create-intent-before-attempt, parent-before-child).
 */
export interface SyncEngine {
  buildSyncPlan(o: BuildPlanOptions): Promise<Plan>;
  applySyncPlan(plan: Plan, gates: GateRequest): Promise<ApplyResult>;
  /**
   * Rolls back a journaled run; refuses (MANIFEST_UNJOURNALED / MANIFEST_EXPIRED) rather
   * than proceeding unjournaled. Resumable; history never rewound (008 FR-013..016).
   */
  rollbackRun(runId: string): Promise<RollbackResult>;
}
