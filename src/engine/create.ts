/**
 * `createSyncEngine` — the composition root (contracts/engine-pipeline.md; task T012;
 * plan.md module map "create.ts — composition root"; research R1).
 * T012 (Phase 2) delivers the SKELETON: options resolution + an object implementing the
 * frozen 3-method `SyncEngine` (`src/ports/engine.ts`) whose methods throw `EngineError`
 * until the wiring tasks replace the bodies — `buildSyncPlan` at T026 (Phase 3) and
 * `applySyncPlan`/`rollbackRun` at T045 (Phase 4), delegating to `build.ts`/`apply.ts`/
 * `rollback.ts` with the `ResolvedEngineOptions` computed here.
 *
 * There is no other mutating entry point in the package (constitution V — one engine,
 * implemented exactly once behind the additive `./engine` subpath). Imports stay inside
 * Node built-ins + `../{domain,config,state,urls,gates,ports,...}/*` relative paths
 * (research R1; contract test T048 scans for violations).
 */
import type { BuildPlanOptions, EngineDependencies, SyncEngine } from "../ports/engine.js";
import { EngineError } from "./errors.js";
import type { EngineOptions } from "./options.js";
import { resolveEngineOptions } from "./options.js";

/**
 * Compose the sync engine over the frozen injectable dependencies (port, config, state,
 * clock, screener) and the 008-local {@link EngineOptions} bag. The returned object
 * implements `SyncEngine` and nothing else.
 *
 * @throws never at composition; each frozen method throws `EngineError` until its
 * wiring task (T026/T045) replaces the skeleton body.
 */
export function createSyncEngine(deps: EngineDependencies, options?: EngineOptions): SyncEngine {
  // Composition seam: effective options resolve once here (keyProvider default, journaling
  // flag, profile extensions, screener override) and flow into T026/T045 pipeline wiring.
  const resolved = resolveEngineOptions(options, deps.config);
  void resolved; // consumed by the wiring tasks (T026/T045); untouched by the skeleton throws
  void deps; // port/state/clock/screener enter the pipelines at T026/T045 wiring

  const engine: SyncEngine = {
    async buildSyncPlan(_o: BuildPlanOptions) {
      throw new EngineError("SyncEngine.buildSyncPlan is not wired until phase 3 (T026 wires build.ts)");
    },
    async applySyncPlan(_plan, _gates) {
      throw new EngineError("SyncEngine.applySyncPlan is not wired until phase 4 (T045 wires apply.ts)");
    },
    async rollbackRun(_runId) {
      throw new EngineError("SyncEngine.rollbackRun is not wired until phase 4 (T045 wires rollback.ts)");
    },
  };
  return engine;
}
