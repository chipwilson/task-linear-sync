/**
 * Sanitized run reports + last-run marker (FR-005; contracts/run-state.md). The paired
 * reports pass the injected SecurityScreener — blocking findings REFUSE the write entirely —
 * and the writer itself refuses values containing configured token-shaped (secret-keyed)
 * material. last-run.json is updated atomically to reference the completed run. Reports
 * land ONLY under the state directory, never the repository tree (SC-003).
 */
import { join } from "node:path";

import { canonicalJson } from "../domain/plan.js";
import type { LastRunMarker } from "../domain/run-records.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { StateStore } from "./paths.js";

export type { LastRunMarker } from "../domain/run-records.js";

/** Raised when screening (or the built-in guard) refuses report content — nothing is written. */
export class ReportScreeningError extends Error {
  override readonly name = "ReportScreeningError";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Guard: values shaped like configured personal API keys (secret material) are refused. */
function containsSecretShapedMaterial(text: string, personalKeyPrefix: string): boolean {
  if (personalKeyPrefix.length === 0) return false;
  return new RegExp(`${escapeRe(personalKeyPrefix)}[A-Za-z0-9_\\-]{12,}`).test(text);
}

/**
 * Write the paired sanitized reports under reports/<runId>/ and atomically update
 * last-run.json referencing the completed run. Returns the updated marker.
 * Refuses (throws ReportScreeningError, writes NOTHING) when the screener returns blocking
 * findings or either artifact contains secret-keyed material.
 */
export async function writeRunReports(
  store: StateStore,
  runId: string,
  reports: { json: unknown; markdown: string },
  screener: SecurityScreener,
  marker: Omit<LastRunMarker, "reportPaths" | "completedAt">,
): Promise<LastRunMarker> {
  const jsonScreened = screener.screen(canonicalJson(reports.json));
  const markdownScreened = screener.screen(reports.markdown);

  const blocked = [...jsonScreened.blocked, ...markdownScreened.blocked];
  if (blocked.length > 0) {
    throw new ReportScreeningError(
      `run report propagation blocked by security screening: ${blocked.join(", ")}`,
    );
  }
  const prefix = store.config.personalKeyPrefix;
  if (containsSecretShapedMaterial(jsonScreened.output, prefix) || containsSecretShapedMaterial(markdownScreened.output, prefix)) {
    throw new ReportScreeningError("run report contains secret-keyed material — refusing to write reports");
  }

  const jsonRel = `reports/${runId}/report.json`;
  const markdownRel = `reports/${runId}/report.md`;
  await store.writeText(jsonRel, jsonScreened.output);
  await store.writeText(markdownRel, markdownScreened.output + (markdownScreened.output.endsWith("\n") ? "" : "\n"));

  const full: LastRunMarker = {
    runId: marker.runId,
    outcome: marker.outcome,
    notificationSuppressed: marker.notificationSuppressed,
    completedAt: store.clock.now().toISOString(),
    reportPaths: { json: join(store.root, jsonRel), markdown: join(store.root, markdownRel) },
  };
  await store.writeJson("last-run.json", full);
  return full;
}

/** Read last-run.json; null when no run has produced a report yet. */
export async function readLastRunMarker(store: StateStore): Promise<LastRunMarker | null> {
  return store.readJson<LastRunMarker>("last-run.json");
}
