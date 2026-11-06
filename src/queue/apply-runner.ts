/**
 * T013 — The engine pass over the FROZEN composition (spec 010 FR-010; research R1/R5;
 * one-engine rule, constitution V). The queue never re-implements planning/gating: it
 * composes the same frozen factories as `src/cli/context.ts` (createLinearPort +
 * createDefaultSecurityScreener + createSyncEngine) and drives `buildSyncPlan` →
 * `applySyncPlan` — the single mutating entry. `acceptLowConfidence` comes ONLY from
 * `queue.autoAcceptLowConfidence` (default false — SC-005: background runs are never
 * broader than the interactive lane). A build-time throw becomes a `failed` pass with
 * a generated 64-hex correlation id so the drain can retry with full attribution.
 */
import { createLinearPort } from "../tracker/index.js";
import { createDefaultSecurityScreener, createSyncEngine, envVarKeyProvider } from "../engine/index.js";
import type { ApplyResult, EngineDependencies } from "../ports/engine.js";
import type { KeyProvider } from "../state/manifest.js";
import type { StateStore } from "../state/paths.js";
import { newCorrelationRunId } from "./reports.js";
import type { EnginePassResult, QueueSettings, SyncMode } from "./types.js";

export interface EnginePassInput {
  readonly repositoryRoot: string;
  readonly mode: SyncMode;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Test-lane overrides: a precomposed deps bag (the 007 fake-port world) and its key
 * provider. Production lanes pass nothing and get the real composition above.
 */
export interface EnginePassOverrides {
  readonly deps?: EngineDependencies;
  readonly keyProvider?: KeyProvider;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Map the frozen ApplyResult onto the queue's classification vocabulary (protocol §4). */
function classifyApplyResult(result: ApplyResult): EnginePassResult {
  if (result.status === "applied") {
    const applied = result.operations.filter((o) => o.status === "applied").length;
    const skipped = result.operations.filter((o) => o.status === "skipped").length;
    const failed = result.operations.filter((o) => o.status === "failed").length;
    return {
      status: "applied",
      runId: result.runId,
      detail: `applied ${applied} operations (${skipped} skipped, ${failed} failed)`,
      ...(result.reportPaths !== undefined ? { reportPaths: result.reportPaths } : {}),
    };
  }
  if (result.status === "refused") {
    const codes = result.gateFailures.map((failure) => failure.code);
    return {
      status: "refused",
      runId: result.runId,
      failureCode: codes[0] ?? "REFUSED",
      detail: `gate refusal: ${codes.length > 0 ? codes.join(", ") : "refused"}`,
      ...(result.reportPaths !== undefined ? { reportPaths: result.reportPaths } : {}),
    };
  }
  // "aborted": mutations happened and were reversed where possible — retryable next cycle.
  return {
    status: "failed",
    runId: result.runId,
    error: "apply aborted — plan changed mid-flight or an operation failed",
    ...(result.reportPaths !== undefined ? { reportPaths: result.reportPaths } : {}),
  };
}

/**
 * Run one full engine pass for a claimed job. Never throws: the queue classifies every
 * outcome, including engine-internal throws, per protocol §4.
 */
export async function runEnginePass(
  store: StateStore,
  settings: QueueSettings,
  input: EnginePassInput,
  overrides: EnginePassOverrides = {},
): Promise<EnginePassResult> {
  const config = store.config;
  try {
    const deps: EngineDependencies =
      overrides.deps ??
      (() => {
        const port = createLinearPort({ config, options: { env: { ...input.env } } });
        const screener = createDefaultSecurityScreener(config);
        return { port, config, state: store, clock: store.clock, screener };
      })();
    const engine = createSyncEngine(deps, {
      keyProvider: overrides.keyProvider ?? envVarKeyProvider(config, input.env),
    });

    const plan = await engine.buildSyncPlan({ repositoryRoot: input.repositoryRoot, mode: input.mode });
    const result = await engine.applySyncPlan(plan, {
      applyFlag: true,
      confirmationKey: config.confirmationKey,
      acceptLowConfidence: settings.autoAcceptLowConfidence, // default false — never widened implicitly
      planReference: plan.planId,
    });
    return classifyApplyResult(result);
  } catch (error) {
    return {
      status: "failed",
      runId: newCorrelationRunId(),
      error: describeFailure(error),
    };
  }
}
