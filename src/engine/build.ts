/**
 * `buildSyncPlan` — the READ-ONLY plan pipeline (contracts/engine-pipeline.md stages 1–7;
 * research R13; task T024 implements, wired into `createSyncEngine` by T026;
 * integration T018/T019/T027).
 * Pipeline: discover (003) → `parseTaskFile` (004, conflict blocks ⇒ `unresolvedConflict`)
 * → `resolveRouting`/`deriveTitle` (005) → `matchAllTasks` (006, durable-identity
 * collisions ⇒ `IntegrityError` abort) → mode + classify (T011/T020) → action resolution
 * (T021) → assemble `Plan` (frozen shapes, `derivePlanId`, guards captured: input hashes +
 * HEAD; structural exclusion of raw bodies/descriptions) → persist plan + reports (T025).
 * ZERO tracker mutations and ZERO repository writes end-to-end (constitution I; frozen
 * `SyncEngine` contract).
 */
import type { Plan } from "../domain/plan.js";
import type { BuildPlanOptions, EngineDependencies } from "../ports/engine.js";
import type { ResolvedEngineOptions } from "./options.js";

/**
 * Build the plan over `o.repositoryRoot` with the advisory `o.mode` hint (reality wins —
 * research R2). Persists `StoredPlan` to `plans/<planId>.json` and the paired
 * `reports/<runId>/report.json` + `report.md` (state directory only; frozen
 * `plan-report.schema.json` conformance; screener-passed — research R13).
 * T024 implements (T018/T019/T027); T026 wires it through `createSyncEngine`.
 */
export async function buildSyncPlan(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  o: BuildPlanOptions,
): Promise<Plan> {
  void [deps, options, o]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: build");
}
