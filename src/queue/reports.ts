/**
 * T019 — Queue-side run reports over the frozen `writeRunReports` pipeline (spec 010
 * FR-015/FR-021; data-model.md run-report records; queue-protocol.md §4/§6). The frozen
 * marker schema is NOT widened: `mode` / `jobId` / `error.code` for queue passes live in
 * the queue's own `report.json` document, which the marker references. A screening
 * refusal (secret-shaped content) degrades to a minimal secret-free failed report with
 * the notification suppressed (FR-021) — reports are best-effort and never abort the
 * drain's job mutation.
 */
import { randomBytes } from "node:crypto";

import { createDefaultSecurityScreener } from "../engine/index.js";
import { ReportScreeningError, writeRunReports } from "../state/marker.js";
import type { StateStore } from "../state/paths.js";
import type { PendingJob } from "./types.js";

/** 64-hex correlation id for passes the engine never reached (frozen assertArtifactId shape). */
export function newCorrelationRunId(): string {
  return randomBytes(32).toString("hex");
}

type QueueMarkerInput = { readonly runId: string; readonly outcome: "completed" | "failed" | "aborted" };

async function emit(
  store: StateStore,
  runId: string,
  doc: Record<string, unknown>,
  markdown: string,
  marker: QueueMarkerInput,
): Promise<void> {
  const screener = createDefaultSecurityScreener(store.config);
  try {
    await writeRunReports(store, runId, { json: doc, markdown }, screener, {
      runId: marker.runId,
      outcome: marker.outcome,
      notificationSuppressed: false,
    });
  } catch (error) {
    if (!(error instanceof ReportScreeningError)) throw error;
    // FR-021: redaction refusal ⇒ minimal secret-free failed report, notification off.
    const withheldCode = typeof doc["error"] === "object" && doc["error"] !== null
      ? String((doc["error"] as Record<string, unknown>)["code"] ?? "REPORT_WITHHELD")
      : "REPORT_WITHHELD";
    try {
      await writeRunReports(
        store,
        runId,
        {
          json: {
            schemaVersion: 1,
            kind: "queue-report",
            outcome: "failed",
            runId,
            error: { code: withheldCode, message: "report content was withheld by secret screening" },
          },
          markdown:
            `# ${store.config.toolId} queue report\n\n` +
            `Run ${runId} ended failed, but the report content was withheld by secret screening.\n`,
        },
        screener,
        { runId, outcome: "failed", notificationSuppressed: true },
      );
    } catch {
      /* reports are best-effort — a withheld report never aborts the drain */
    }
  }
}

export interface TerminalReportInput {
  readonly runId: string;
  readonly job: PendingJob;
  readonly errorCode: string;
  readonly message: string;
}

/** Terminal consumption (non-lock refusal / retry limit): failed marker + report pair. */
export async function writeTerminalRunReport(store: StateStore, input: TerminalReportInput): Promise<void> {
  const doc: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "queue-terminal",
    outcome: "failed",
    runId: input.runId,
    mode: input.job.mode,
    jobId: input.job.jobId,
    trigger: input.job.trigger,
    retryCount: input.job.retryCount,
    error: { code: input.errorCode, message: input.message },
    completedAt: store.clock.now().toISOString(),
  };
  const markdown =
    `# ${store.config.toolId} queue report — ${input.job.mode} (failed)\n\n` +
    `- run: ${input.runId}\n` +
    `- job: ${input.job.jobId} (trigger ${input.job.trigger}, retryCount ${input.job.retryCount})\n` +
    `- error: ${input.errorCode}\n` +
    `- detail: ${input.message}\n`;
  await emit(store, input.runId, doc, markdown, { runId: input.runId, outcome: "failed" });
}

export interface DeferredReportInput {
  readonly runId: string;
  readonly job: PendingJob;
  readonly reason: string;
  readonly message: string;
}

/** Report-only deferral (LOCK_HELD): aborted marker; the job itself is re-queued. */
export async function writeDeferredRunReport(store: StateStore, input: DeferredReportInput): Promise<void> {
  const doc: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "queue-deferred",
    outcome: "aborted",
    runId: input.runId,
    mode: input.job.mode,
    jobId: input.job.jobId,
    trigger: input.job.trigger,
    reason: input.reason,
    retryCount: input.job.retryCount,
    message: input.message,
    completedAt: store.clock.now().toISOString(),
  };
  const markdown =
    `# ${store.config.toolId} queue report — ${input.job.mode} (aborted)\n\n` +
    `- run: ${input.runId}\n` +
    `- job: ${input.job.jobId} stays queued (retryCount ${input.job.retryCount})\n` +
    `- reason: ${input.reason}\n` +
    `- detail: ${input.message}\n`;
  await emit(store, input.runId, doc, markdown, { runId: input.runId, outcome: "aborted" });
}

export interface LockFailureReportInput {
  readonly reason: string;
  readonly message?: string;
  readonly jobId?: string;
}

/**
 * The giving-up drain cycle (queue-lock timeout, protocol §3): its own aborted run with
 * a generated correlation id — the engine never ran, so no engine runId exists.
 */
export async function writeLockFailureRunReport(store: StateStore, input: LockFailureReportInput): Promise<void> {
  const runId = newCorrelationRunId();
  const message = input.message ?? "another worker holds the queue lock past the timeout";
  const doc: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "queue-lock-failure",
    outcome: "aborted",
    runId,
    reason: input.reason,
    jobId: input.jobId ?? null,
    message,
    completedAt: store.clock.now().toISOString(),
  };
  const markdown =
    `# ${store.config.toolId} queue report (aborted)\n\n` +
    `- run: ${runId}\n` +
    `- reason: ${input.reason}\n` +
    `- detail: ${message}\n`;
  await emit(store, runId, doc, markdown, { runId, outcome: "aborted" });
}
