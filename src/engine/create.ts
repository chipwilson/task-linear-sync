/**
 * `createSyncEngine` — the composition root (contracts/engine-pipeline.md; task T012;
 * plan.md module map "create.ts — composition root"; research R1).
 * T012 (Phase 2) delivered the SKELETON: options resolution + an object implementing the
 * frozen 3-method `SyncEngine` (`src/ports/engine.ts`) whose methods threw `EngineError`
 * until the wiring tasks replaced the bodies — `buildSyncPlan` at T026 (Phase 3) and
 * `applySyncPlan`/`rollbackRun` at T045 (Phase 4), delegating to `build.ts`/`apply.ts`/
 * `rollback.ts` with the `ResolvedEngineOptions` computed here. All three methods are
 * now wired; no skeleton throws remain.
 *
 * There is no other mutating entry point in the package (constitution V — one engine,
 * implemented exactly once behind the additive `./engine` subpath). Imports stay inside
 * Node built-ins + `../{domain,config,state,urls,gates,ports,...}/*` relative paths
 * (research R1; contract test T048 scans for violations).
 */
import type { BuildPlanOptions, EngineDependencies, SyncEngine } from "../ports/engine.js";
import type { Plan } from "../domain/plan.js";
import { applySyncPlan as runApplyPipeline } from "./apply.js";
import { buildSyncPlan } from "./build.js";
import type { EngineOptions } from "./options.js";
import { resolveEngineOptions } from "./options.js";
import { rollbackRun as runRollbackPipeline } from "./rollback.js";

/**
 * Compose the sync engine over the frozen injectable dependencies (port, config, state,
 * clock, screener) and the 008-local {@link EngineOptions} bag. The returned object
 * implements `SyncEngine` and nothing else.
 *
 * `buildSyncPlan` is wired to the read-only pipeline (T026 → `build.ts` with the
 * `ResolvedEngineOptions` resolved once here). `applySyncPlan`/`rollbackRun` are wired
 * by T045 to the mutating pipelines (`apply.ts`/`rollback.ts`) with the SAME resolved
 * options bag — the gate-trio → lock → stability → journal order inside `apply.ts` is
 * the frozen enforcement order (contracts/engine-pipeline.md), and `rollback.ts` decides
 * every §2 refusal before it ever acquires the lock (contracts/journal-rollback.md).
 *
 * @throws never at composition.
 */
export function createSyncEngine(deps: EngineDependencies, options?: EngineOptions): SyncEngine {
  // Composition seam: effective options resolve once here (keyProvider default, journaling
  // flag, profile extensions, screener override) and flow into T026/T045 pipeline wiring.
  const resolved = resolveEngineOptions(options, deps.config);

  const engine: SyncEngine = {
    async buildSyncPlan(o: BuildPlanOptions): Promise<Plan> {
      // T026 wiring: delegate to the read-only plan pipeline (contracts/engine-pipeline.md
      // stages 1–7) — zero tracker mutations, zero repository writes.
      return buildSyncPlan(deps, resolved, o);
    },
    async applySyncPlan(plan, gates) {
      // T045 wiring: the single mutating entry (apply.ts) — gates → lock → stability →
      // journal-before-first-mutation → journaled mutations → checkpoint advance → run
      // report + `last-run.json` marker (frozen `ApplyResult`; refusals never lock/mutate).
      return runApplyPipeline(deps, resolved, plan, gates);
    },
    async rollbackRun(runId) {
      // T045 wiring: resumable guarded rollback (rollback.ts) — §2 refusals pre-lock,
      // reverse-order guarded walk, checkpoint-store restore, history preservation, and
      // its own run report + marker (frozen `RollbackResult` shape).
      return runRollbackPipeline(deps, resolved, runId);
    },
  };
  return engine;
}
