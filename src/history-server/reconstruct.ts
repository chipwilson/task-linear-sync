/**
 * Chain walk + reconstruction (T017; FR-003, contracts/history-reconstruction.md).
 *
 * The serving walk follows deterministic page addresses (`historyPageAddress`
 * over the injected port — the ONLY route to the tracker), stops at the first
 * absent page, and treats a chain that reaches page index `MAX_CHAIN_PAGES`
 * as a refusal, never a truncation. Page 0 is the frozen sync-state payload;
 * continuation pages are 008 page records under the namespace key. Merging is
 * an ascending concat + stable chronological sort, and every browser-facing
 * string is screened here, at view-construction time (FR-008).
 */

import type { ResolvedConfig } from "../config/schema.js";
import type { SyncHistoryEvent } from "../domain/state-payload.js";
import { parseSyncStatePayload } from "../domain/state-payload.js";
import { historyPageAddress, parseHistoryPageRecord } from "../engine/history-page.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { AttachmentView, LinearPort } from "../ports/linear-port.js";
import { TrackerError } from "../tracker/errors.js";
import { HistoryRequestError } from "./errors.js";
import { formatAtHuman, screenBrowserText } from "./screen.js";
import type { HistoryClock, HistoryEventView, HistoryPageView } from "./types.js";

/** Hard display bound (mirrors 007's internal chain cap); exceeding it refuses. */
export const MAX_CHAIN_PAGES = 1000;

export interface ReconstructDeps {
  readonly port: LinearPort;
  readonly config: ResolvedConfig;
  readonly clock: HistoryClock;
  readonly screener: SecurityScreener;
}

export interface ChainWalkResult {
  readonly canonical: AttachmentView;
  /** Present continuation pages, ascending, contiguous from index 1. */
  readonly pages: readonly AttachmentView[];
}

/** Port ultimate failures map onto fixed envelopes; `detail` never travels (R7). */
function mapPortError(error: unknown): HistoryRequestError {
  if (error instanceof TrackerError) {
    return new HistoryRequestError(error.category === "rate-limit" ? "RATE_LIMITED" : "TRACKER_UNAVAILABLE");
  }
  return new HistoryRequestError("INTERNAL");
}

/** Address-based chain walk: stop at first absence, bound as refusal, no orphan probes. */
export async function walkHistoryChain(
  deps: ReconstructDeps,
  taskUuid: string,
): Promise<ChainWalkResult> {
  const read = async (page: number): Promise<AttachmentView | null> => {
    try {
      return await deps.port.getAttachmentByUrl(historyPageAddress(deps.config, taskUuid, page));
    } catch (error) {
      throw mapPortError(error);
    }
  };

  const canonical = await read(0);
  if (canonical === null) {
    throw new HistoryRequestError("NOT_FOUND");
  }

  const pages: AttachmentView[] = [];
  for (let index = 1; ; index += 1) {
    if (index > MAX_CHAIN_PAGES) {
      // The page AT the bound exists: the chain outgrew the display posture.
      throw new HistoryRequestError("TRACKER_UNAVAILABLE");
    }
    const page = await read(index);
    if (page === null) {
      return { canonical, pages };
    }
    pages.push(page);
  }
}

/** Reconstruct the whole-chain browser view for one task (never partial). */
export async function reconstructHistory(
  deps: ReconstructDeps,
  taskUuid: string,
): Promise<HistoryPageView> {
  const nsKey = deps.config.metadataNamespaceKey;
  const { canonical, pages } = await walkHistoryChain(deps, taskUuid);

  const rawPage0 = canonical.metadata[nsKey];
  let payload;
  try {
    payload = parseSyncStatePayload(typeof rawPage0 === "string" ? rawPage0 : "");
  } catch {
    throw new HistoryRequestError("TRACKER_UNAVAILABLE");
  }
  if (payload.taskUuid !== taskUuid) {
    throw new HistoryRequestError("TRACKER_UNAVAILABLE");
  }

  const chain: Array<{ readonly index: number; readonly events: readonly SyncHistoryEvent[] }> = [
    { index: 0, events: payload.history },
  ];
  for (const [offset, view] of pages.entries()) {
    const index = offset + 1;
    let record;
    try {
      record = parseHistoryPageRecord(view, nsKey);
    } catch {
      throw new HistoryRequestError("TRACKER_UNAVAILABLE");
    }
    if (record === null || record.taskUuid !== taskUuid || record.page !== index) {
      // A record contradicting its own address is corruption, never partial service.
      throw new HistoryRequestError("TRACKER_UNAVAILABLE");
    }
    chain.push({ index, events: record.history });
  }

  // Ascending concat, then a stable chronological sort (ties keep chain order;
  // Array.prototype.sort is spec-stable).
  const merged = chain.flatMap((page) => [...page.events]);
  const atMs = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  merged.sort((a, b) => atMs(a.at) - atMs(b.at));

  const events: HistoryEventView[] = merged.map((event) => ({
    at: event.at,
    atHuman: screenBrowserText(deps.screener, formatAtHuman(event.at)),
    kind: event.kind,
    description: screenBrowserText(deps.screener, event.description),
    references:
      event.references === undefined
        ? null
        : event.references.map((reference) => screenBrowserText(deps.screener, reference)),
  }));

  return {
    taskUuid,
    events,
    pages: chain.map((page) => ({ index: page.index, eventCount: page.events.length })),
    lastSyncAt: payload.cursors.lastSyncAt,
    generatedAt: deps.clock.now().toISOString(),
  };
}
