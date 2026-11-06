/**
 * T033 [US1] — the three read tool cores (research R4/R7; tool-definitions.md §3).
 *
 * The cores REUSE the 009 `runCli` read-only lanes (only `check`/`inventory` argv —
 * `runCli`'s `READ_ONLY_LANES` guard is inherited whole, so no mutation path exists
 * here by construction) and the frozen queue/state reads. Every free-form string that
 * enters a payload passes the injected `SecurityScreener` at composition (research R10);
 * the plan `report` is the frozen `PlanReportJson` VERBATIM through the injected
 * `StateStore` (never re-rendered, Markdown sibling never returned). Cores return a
 * payload or a `ToolRefusal` — they NEVER throw.
 */

import type { CliContext } from "../cli/index.js";
import { ExitCode, runCli } from "../cli/index.js";
import { derivePlanReportRunId } from "../engine/index.js";
import type { PlanReportJson } from "../engine/index.js";
import { readPendingJob, readQueueLockRecord } from "../queue/index.js";
import type { SecurityScreener } from "../ports/index.js";
import { readLastRunMarker } from "../state/index.js";
import type { Clock, StateStore } from "../state/index.js";
import type { ToolRefusal } from "./errors.js";
import type { PlanReferenceStore } from "./plan-store.js";

/** A core answered: a stable-key payload, or a refusal with taxonomy code + detail. */
export type ToolCoreOutcome =
  | { readonly ok: true; readonly payload: Record<string, unknown> }
  | { readonly ok: false; readonly refusal: ToolRefusal };

export interface ReadHandlerDeps {
  /** Base CLI context (cwd = repositoryRoot, frozen bag members). */
  readonly cliContext: CliContext;
  readonly state: StateStore;
  readonly clock: Clock;
  readonly screener: SecurityScreener;
  readonly repositoryRoot: string;
  readonly store: PlanReferenceStore;
}

export interface McpReadHandlers {
  task_sync_plan(): Promise<ToolCoreOutcome>;
  task_sync_inventory(): Promise<ToolCoreOutcome>;
  task_sync_status(): Promise<ToolCoreOutcome>;
}

interface LaneCapture {
  readonly exitCode: number;
  readonly out: string[];
  readonly err: string[];
}

export function createReadHandlers(deps: ReadHandlerDeps): McpReadHandlers {
  const screen = (value: string): string => {
    const outcome = deps.screener.screen(value);
    return outcome.blocked.length > 0 ? "[redacted]" : outcome.output;
  };

  async function runLane(argv: readonly string[]): Promise<LaneCapture> {
    const out: string[] = [];
    const err: string[] = [];
    const context: CliContext = {
      ...deps.cliContext,
      stdout: (line) => {
        out.push(line);
      },
      stderr: (line) => {
        err.push(line);
      },
    };
    const outcome = await runCli(argv, context);
    return { exitCode: outcome.exitCode, out, err };
  }

  /** The captured (already-screened) stderr tail — never a stack, never silent. */
  function laneFailure(capture: LaneCapture): ToolCoreOutcome {
    const last = [...capture.err].reverse().find((l) => l.trim() !== "");
    const detail = screen(last ?? `lane exited ${capture.exitCode}`);
    return { ok: false, refusal: { code: "LANE_FAILURE", detail } };
  }

  async function taskSyncPlan(): Promise<ToolCoreOutcome> {
    const capture = await runLane(["check"]);
    // Exit 0 AND exit 8 (CHECK_FINDINGS) are both SUCCESS — findings are content (R4).
    if (capture.exitCode !== ExitCode.SUCCESS && capture.exitCode !== ExitCode.CHECK_FINDINGS) {
      return laneFailure(capture);
    }
    const last = capture.out[capture.out.length - 1];
    let summary: Record<string, unknown> | undefined;
    try {
      summary = last === undefined ? undefined : (JSON.parse(last) as Record<string, unknown>);
    } catch {
      summary = undefined;
    }
    const planId = summary?.["planId"];
    const counts = summary?.["counts"];
    if (typeof planId !== "string" || typeof counts !== "object" || counts === null) {
      return { ok: false, refusal: { code: "LANE_FAILURE", detail: "check lane produced no parseable summary line" } };
    }
    const report = await deps.state.readJson<PlanReportJson>(
      `reports/${derivePlanReportRunId(planId, deps.clock)}/report.json`,
    );
    if (report === null) {
      return { ok: false, refusal: { code: "LANE_FAILURE", detail: "plan report artifact missing from the state store" } };
    }
    deps.store.record(planId); // apply-gating.md §2.1 — EVERY success records, exit 8 included.
    return {
      ok: true,
      payload: {
        schemaVersion: 1,
        planReference: planId,
        generatedAt: report.generatedAt,
        lowConfidencePresent: report.lowConfidencePresent ?? ((counts as Record<string, unknown>)["lowConfidence"] as number) > 0,
        counts,
        securityAssertions: report.securityAssertions,
        report,
      },
    };
  }

  async function taskSyncInventory(): Promise<ToolCoreOutcome> {
    const capture = await runLane(["inventory"]);
    if (capture.exitCode !== ExitCode.SUCCESS) {
      return laneFailure(capture);
    }
    const files: Array<Record<string, unknown>> = [];
    for (const line of capture.out) {
      const match = /^(.+?) {2}framework=(\S+) {2}tasks=(\d+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
        files.push({ filePath: screen(match[1]), framework: screen(match[2]), taskCount: Number(match[3]) });
      }
    }
    const refusals: Array<Record<string, string>> = [];
    const warnings: Array<Record<string, string>> = [];
    for (const line of capture.err) {
      const refused = /^refused (.+?): (.+)$/.exec(line);
      if (refused?.[1] !== undefined && refused[2] !== undefined) {
        refusals.push({ path: screen(refused[1]), reason: screen(refused[2]) });
        continue;
      }
      const warned = /^(?:warning|skipped) (.+?): (.+)$/.exec(line);
      if (warned?.[1] !== undefined && warned[2] !== undefined) {
        warnings.push({ path: screen(warned[1]), condition: screen(warned[2]) });
      }
    }
    return { ok: true, payload: { schemaVersion: 1, files, refusals, warnings } };
  }

  async function taskSyncStatus(): Promise<ToolCoreOutcome> {
    // Frozen read-only composition (research R7): marker + queue reads + session count.
    const [marker, pending, lockRecord] = await Promise.all([
      readLastRunMarker(deps.state),
      readPendingJob(deps.state),
      readQueueLockRecord(deps.state),
    ]);
    const job = pending.job;
    const pendingJob =
      job === null
        ? null
        : {
            ...(typeof (job as unknown as Record<string, unknown>)["frameworkId"] === "string"
              ? { frameworkId: screen(String((job as unknown as Record<string, unknown>)["frameworkId"])) }
              : {}),
            mode: job.mode,
            trigger: job.trigger,
            queuedAt: job.enqueuedAt,
          };
    return {
      ok: true,
      payload: {
        schemaVersion: 1,
        lastRun:
          marker === null
            ? null
            : {
                runId: marker.runId,
                outcome: marker.outcome,
                completedAt: marker.completedAt,
                reportPaths:
                  marker.reportPaths === null
                    ? null
                    : { json: screen(marker.reportPaths.json), markdown: screen(marker.reportPaths.markdown) },
                notificationSuppressed: marker.notificationSuppressed,
              },
        queue: {
          pendingJob,
          workerRunning: (job?.claim ?? null) !== null || lockRecord !== null,
        },
        session: { planReferencesAvailable: deps.store.size },
      },
    };
  }

  return {
    task_sync_plan: taskSyncPlan,
    task_sync_inventory: taskSyncInventory,
    task_sync_status: taskSyncStatus,
  };
}
