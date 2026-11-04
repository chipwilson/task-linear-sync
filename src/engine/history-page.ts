/**
 * History continuation-page record + deterministic addressing (research R8; data-model §7;
 * contracts/history-log.md §3; task T042 implements; unit tests T029).
 * Continuation pages `n ≥ 1` carry `{ taskUuid, page, history }` under the same
 * `metadataNamespaceKey`, serialized with the frozen canonical serializer, addressed by
 * `continuationAttachmentUrl(cfg, taskUuid, n)` (page 0 is always the canonical URL). No
 * page index is ever stored locally — the chain is re-derived from URLs (007 precedent).
 * Entries on a page, once written, are never edited, reordered, or removed (Principle IV).
 *
 * T042 implementation notes:
 * - Serialization is the frozen `canonicalJson` (domain/plan.ts): sorted keys, compact,
 *   undefined dropped — reproducing the exact `{"history":[…],"page":n,"taskUuid":"…"}`
 *   record shape seeded in the `history-rollover` fixture world.
 * - Addressing delegates to the frozen `src/urls` builders; their validation (uuid shape,
 *   template safety, page ≥ 1 for continuation URLs) applies unchanged.
 */
import { canonicalJson } from "../domain/plan.js";
import {
  UrlSchemeError,
  canonicalAttachmentUrl,
  continuationAttachmentUrl,
} from "../urls/attachment-url.js";
import type { SyncHistoryEvent } from "../domain/state-payload.js";
import type { AttachmentView, AttachmentMetadata } from "../ports/linear-port.js";
import type { AttachmentUrlConfig } from "../urls/attachment-url.js";

/** Continuation-page payload shape for pages `n ≥ 1` (data-model §7; 008-local). */
export interface HistoryPageRecord {
  /** Chain key (the task's durable UUID). */
  readonly taskUuid: string;
  /** Integer ≥ 1; matches the page segment of the addressing URL. */
  readonly page: number;
  /** Chronological slice; entries moved onto a page are never re-edited (FR-009/010). */
  readonly history: readonly SyncHistoryEvent[];
}

/**
 * Deterministic page addressing (history-log.md §3): page 0 ⇒ `canonicalAttachmentUrl`,
 * page `n ≥ 1` ⇒ `continuationAttachmentUrl`. `ResolvedConfig` structurally satisfies
 * the frozen `AttachmentUrlConfig` slice. Delegates to the frozen `src/urls` builders
 * (their validation applies). T042 implements (T029).
 *
 * Negative or non-integer pages throw `UrlSchemeError` (neither builder accepts them —
 * page 0 never appears as a continuation path segment).
 */
export function historyPageAddress(
  cfg: AttachmentUrlConfig,
  taskUuid: string,
  page: number,
): string {
  if (page === 0) return canonicalAttachmentUrl(cfg, taskUuid);
  if (Number.isInteger(page) && page >= 1) return continuationAttachmentUrl(cfg, taskUuid, page);
  throw new UrlSchemeError(`history page must be an integer >= 0 (page 0 is the canonical URL): ${page}`);
}

/**
 * Serialize a continuation page into `Attachment_Metadata`: the canonical-serialized
 * record string under `metadataNamespaceKey` (data-model §7 — same namespace key as page
 * 0; metadata values are strings only). T042 implements (T029/T035).
 *
 * Only pages `n ≥ 1` use this shape — page 0 is the frozen `SyncStatePayload` serialized
 * by `serializeSyncStatePayload` (`payload.ts`) — so a page index below 1 throws
 * (mirrors `continuationAttachmentUrl`'s page validation).
 */
export function serializeHistoryPageRecord(
  record: HistoryPageRecord,
  metadataNamespaceKey: string,
): AttachmentMetadata {
  if (!Number.isInteger(record.page) || record.page < 1) {
    throw new UrlSchemeError(
      `continuation page record requires an integer page >= 1 (page 0 carries the canonical sync-state payload): ${record.page}`,
    );
  }
  // canonicalJson sorts keys to { history, page, taskUuid } and drops undefined members —
  // byte-identical to the fixture-seeded continuation pages (data-model §7 exact shape).
  return { [metadataNamespaceKey]: canonicalJson(record) };
}

/**
 * Parse an `AttachmentView` fetched at a continuation URL back into the page record; null
 * when the attachment carries no (or an unparseable) namespaced record — treated as an
 * absent chain link by the page walk. T042 implements (T029/T035).
 *
 * Validation is structural at the record level only (`taskUuid`/`page`/`history`); event
 * entries pass through verbatim — a stored entry is never re-written on re-serialization
 * (Principle IV append-only), and screening happened when it was appended.
 */
export function parseHistoryPageRecord(
  view: AttachmentView,
  metadataNamespaceKey: string,
): HistoryPageRecord | null {
  const raw = view.metadata[metadataNamespaceKey];
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { readonly taskUuid?: unknown; readonly page?: unknown; readonly history?: unknown };
  if (typeof record.taskUuid !== "string") return null;
  if (typeof record.page !== "number" || !Number.isInteger(record.page) || record.page < 1) return null;
  if (!Array.isArray(record.history)) return null;
  return {
    taskUuid: record.taskUuid,
    page: record.page,
    history: record.history as readonly SyncHistoryEvent[],
  };
}
