/**
 * History continuation-page record + deterministic addressing (research R8; data-model §7;
 * contracts/history-log.md §3; task T042 implements; unit tests T029).
 * Continuation pages `n ≥ 1` carry `{ taskUuid, page, history }` under the same
 * `metadataNamespaceKey`, serialized with the frozen canonical serializer, addressed by
 * `continuationAttachmentUrl(cfg, taskUuid, n)` (page 0 is always the canonical URL). No
 * page index is ever stored locally — the chain is re-derived from URLs (007 precedent).
 * Entries on a page, once written, are never edited, reordered, or removed (Principle IV).
 */
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
 */
export function historyPageAddress(
  cfg: AttachmentUrlConfig,
  taskUuid: string,
  page: number,
): string {
  void [cfg, taskUuid, page]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: history-page");
}

/**
 * Serialize a continuation page into `Attachment_Metadata`: the canonical-serialized
 * record string under `metadataNamespaceKey` (data-model §7 — same namespace key as page
 * 0; metadata values are strings only). T042 implements (T029/T035).
 */
export function serializeHistoryPageRecord(
  record: HistoryPageRecord,
  metadataNamespaceKey: string,
): AttachmentMetadata {
  void [record, metadataNamespaceKey]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: history-page");
}

/**
 * Parse an `AttachmentView` fetched at a continuation URL back into the page record;
 * null when the attachment carries no (or an unparseable) namespaced record — treated as
 * an absent chain link by the page walk. T042 implements (T029/T035).
 */
export function parseHistoryPageRecord(
  view: AttachmentView,
  metadataNamespaceKey: string,
): HistoryPageRecord | null {
  void [view, metadataNamespaceKey]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: history-page");
}
