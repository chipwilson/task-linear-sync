/**
 * Shared local types for the history surface (feature 011).
 *
 * The clock seam is structural and local: this module group imports nothing
 * from `../state/` (hygiene scan, contracts/component-api.md §3), while
 * remaining shape-compatible with the injected clocks tests already use.
 */

import type { SyncHistoryEvent } from "../domain/state-payload.js";

/** Time source for TTL / cadence / expiry decisions (research R1). */
export interface HistoryClock {
  /** Current wall-clock time as a Date. */
  now(): Date;
  /** Milliseconds elapsed since the given ISO-8601 instant per this clock. */
  elapsed(sinceIso: string): number;
}

/** Default clock used when `deps.clock` is absent (system time). */
export const defaultHistoryClock: HistoryClock = {
  now: () => new Date(),
  elapsed: (sinceIso) => Date.now() - Date.parse(sinceIso),
};

export type NegotiatedFormat = "html" | "sse" | "json";

/** One page of the reconstructed chain (data-model §3). */
export interface ChainPage {
  readonly index: number;
  readonly events: readonly SyncHistoryEvent[];
}

/** Browser-facing event view (data-model §2). */
export interface HistoryEventView {
  readonly at: string;
  readonly atHuman: string;
  readonly kind: SyncHistoryEvent["kind"];
  readonly description: string;
  readonly references: readonly string[] | null;
}

/** The per-task reconstructed view — sole authoritative browser shape. */
export interface HistoryPageView {
  readonly taskUuid: string;
  readonly events: readonly HistoryEventView[];
  readonly pages: ReadonlyArray<{ readonly index: number; readonly eventCount: number }>;
  readonly lastSyncAt: string;
  readonly generatedAt: string;
}
