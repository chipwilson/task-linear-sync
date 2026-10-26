/**
 * `applySyncPlan` — THE single mutating entry (contracts/engine-pipeline.md "applySyncPlan";
 * research R10; data-model §8–§9; task T043 implements, wired by T045; integration
 * T032–T038; contract T030; security T039).
 * Frozen enforcement order, verbatim:
 *   gates (ALL failures collected together ⇒ `status: "refused"`, no lock, no read-back)
 *   → advisory lock (`src/state/lock.ts`; `LOCK_HELD` refusal on live contention)
 *   → stability re-check (frozen `validatePlanReference` over live hashes + HEAD AND
 *     per-issue snapshot re-fetch via `getIssue`/`getAttachmentByUrl`; drift ⇒ abort,
 *     zero mutations)
 *   → journal complete-before-first-mutation (`journal.ts`)
 *   → mutations in FR-011 order — per op: screen → precondition re-check → mutate →
 *     journal step → history append → step `applied`
 *   → atomic checkpoint store write → run report + `last-run.json` marker → lock release.
 * Create ops follow data-model §8 (intent-before-attempt via `src/state/intent.ts`;
 * never auto-retried; identity reconciliation; `>1` ⇒ `IntegrityError` + task-create
 * abort, FR-012). `fail` action ⇒ `EngineFailError` before the next mutation, status
 * `"aborted"`, applied steps remain rollback-able.
 */
import type { Plan } from "../domain/plan.js";
import type { GateRequest } from "../gates/gates.js";
import type { ApplyResult, EngineDependencies } from "../ports/engine.js";
import type { ResolvedEngineOptions } from "./options.js";

/**
 * Apply the plan under the frozen gate contract. All gate refusals return
 * `ApplyResult{ status: "refused", gateFailures }` with the complete failure listing
 * (frozen vocabulary — no engine-local refusal codes; research R14). `runId` derives via
 * `deriveRunId` (research R14). Converged inputs ⇒ zero pending ops, zero tracker writes
 * (SC-001). T043 implements (T032–T039); T045 wires it through `createSyncEngine`.
 */
export async function applySyncPlan(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  plan: Plan,
  gates: GateRequest,
): Promise<ApplyResult> {
  void [deps, options, plan, gates]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: apply");
}
