/**
 * Sync-state payload rewrite + history append with rollover on the attachment chain
 * (research R8; data-model §7; contracts/history-log.md §1–§3; tasks T042 implements;
 * unit tests T029; integration T035).
 * Page 0 (canonical URL): frozen `SyncStatePayload` — non-history members (`taskUuid`,
 * `frameworkMetadata`, `descriptionContentHash`, `cursors.lastSyncAt`) rewritten
 * AUTHORITATIVELY (full replace, stable keys via `serializeSyncStatePayload`) every
 * applied run after screening; `history` carries the page-0 slice (FR-008).
 * Append (FR-009): exactly one screened event per landed sync-affecting action; rollover
 * (FR-010) moves ONLY the new tail to page `n+1`. Chain state is re-derived from URLs on
 * each run via `getAttachmentByUrl` — never cached locally; all writes are URL-idempotent
 * `upsertAttachmentByUrl` (FR-015); attachment ids are never stored.
 *
 * T042 implementation notes:
 * - Screening (R12 posture, mirrors `report.ts`): every free-text string NEWLY propagated
 *   by these writes passes `screener.screen()` — frameworkMetadata feature/file/task strings
 *   on the page-0 rewrite, and the event description on append (blocked findings throw
 *   `PayloadScreeningError` naming categories only, never content). Stored history entries
 *   are deliberately NOT re-screened on re-writes: they were screened at append time, and
 *   re-annotation would edit them, breaking the §3 append-only byte-stability invariants
 *   (entries never edited; SC-001 byte-identical resumed pages). Derived identifiers stay
 *   verbatim: `taskUuid` (identity anchor must equal the URL byte-exactly),
 *   `descriptionContentHash` (sha256 hex), `frameworkId` (closed enum), `lastSyncAt`
 *   (injected-clock ISO stamp).
 * - Rollover writes land head page `n` BEFORE tail page `n+1`: a crash between the two
 *   leaves the URL walk seeing `n+1` as the first absent page, so a resumed apply
 *   re-derives the identical split and lands byte-identical pages (no duplication).
 * - Upserts replace the FULL attachment metadata with the single namespaced record
 *   (tool-owned attachment, FR-008 full replace); journal callers capture `priorMetadata`
 *   from the pre-write `getAttachmentByUrl` view (FR-015, history-log §4).
 */
import {
  parseSyncStatePayload,
  serializeSyncStatePayload,
} from "../domain/state-payload.js";
import { canonicalJson } from "../domain/plan.js";
import type { FrameworkMetadata } from "../domain/task.js";
import type { SyncHistoryEvent, SyncStatePayload } from "../domain/state-payload.js";
import type { ResolvedConfig } from "../config/schema.js";
import { EngineError } from "./errors.js";
import type { Clock } from "../state/clock.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { AttachmentMetadata, AttachmentView, LinearPort } from "../ports/linear-port.js";
import { canonicalAttachmentUrl } from "../urls/attachment-url.js";
import {
  historyPageAddress,
  parseHistoryPageRecord,
  serializeHistoryPageRecord,
} from "./history-page.js";

/** Per-run attachment-chain context: the only route to the tracker plus config/clock/screening. */
export interface AttachmentRunContext {
  readonly port: LinearPort;
  readonly config: ResolvedConfig;
  readonly clock: Clock;
  readonly screener: SecurityScreener;
}

/** Authoritative page-0 rewrite input (contracts/history-log.md §1). */
export interface PageZeroRewriteInput {
  /** Issue carrying the canonical attachment. */
  readonly issueId: string;
  /** Durable identity anchor (page 0 only). */
  readonly taskUuid: string;
  /** Rewritten verbatim into the payload. */
  readonly frameworkMetadata: FrameworkMetadata;
  /** sha256 hex of the NORMALIZED MIRRORED content (research R3/R8; history-log §1). */
  readonly descriptionContentHash: string;
}

/** Result of one history append: where the event landed and which pages were written. */
export interface HistoryAppendResult {
  /** Page that received the new event (n under rollover, n+1 when the tail rolled). */
  readonly page: number;
  /** Pages written this append (URL-idempotent upsert results; empty ⇒ nothing landed). */
  readonly pagesWritten: readonly AttachmentView[];
  /** True when the overflow tail rolled to page n+1 (FR-010). */
  readonly rolledOver: boolean;
}

/** Pure rollover split of a candidate page (history-log.md §3 step 2; unit-testable, T029). */
export interface RolloverSplit {
  /** Entries staying on the current page (within thresholds; may be the whole candidate). */
  readonly head: readonly SyncHistoryEvent[];
  /** Overflowing tail rolled forward to the next page (never rewrites existing entries). */
  readonly tail: readonly SyncHistoryEvent[];
}

/**
 * Propagation of attachment-chain content aborted by a blocking screener finding
 * (R12 posture; message names finding CATEGORIES only, never content — mirrors the
 * report-screening error in `report.ts`).
 */
export class PayloadScreeningError extends EngineError {
  override readonly name = "PayloadScreeningError";
}

/** Chain-walk hard bound (mirrors 007 `MAX_CHAIN_PAGES`): a pathological chain fails loudly. */
const MAX_CHAIN_PAGES = 1000;

/** Screen one newly-propagated string; blocking findings throw, non-blocking output wins. */
function screened(screener: SecurityScreener, text: string, label: string): string {
  const result = screener.screen(text);
  if (result.blocked.length > 0) {
    throw new PayloadScreeningError(
      `attachment payload propagation blocked by security screening (${label}): ${result.blocked.join(", ")}`,
    );
  }
  return result.output;
}

/** Config-driven attachment presentation (title/subtitle/icon), included only when set. */
function presentation(config: ResolvedConfig): {
  readonly title: string;
  readonly subtitle?: string;
  readonly iconUrl?: string;
} {
  return {
    title: config.syncAttachmentTitle,
    ...(config.syncAttachmentSubtitle !== undefined ? { subtitle: config.syncAttachmentSubtitle } : {}),
    ...(config.syncAttachmentIconUrl !== undefined ? { iconUrl: config.syncAttachmentIconUrl } : {}),
  };
}

/**
 * Read the current page-0 payload via `getAttachmentByUrl(canonical…)`; null when the
 * canonical attachment does not exist yet (first create lands on apply) or carries no
 * namespaced record. Chain state is NEVER cached (research R8). T042 implements (T035).
 *
 * A PRESENT-but-malformed namespaced record throws instead of returning null: silently
 * treating a damaged canonical anchor as "absent" would let the next rewrite reset the
 * history slice to empty — fail loudly rather than edit the log (Principle IV).
 */
export async function readPageZeroPayload(
  ctx: AttachmentRunContext,
  taskUuid: string,
): Promise<SyncStatePayload | null> {
  const view = await ctx.port.getAttachmentByUrl(canonicalAttachmentUrl(ctx.config, taskUuid));
  if (view === null) return null;
  const raw = view.metadata[ctx.config.metadataNamespaceKey];
  if (raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new EngineError(
      `page-0 sync-state record for '${taskUuid}' is malformed (metadata value must be a string) — refusing to treat a damaged canonical attachment as absent`,
    );
  }
  try {
    return parseSyncStatePayload(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new EngineError(
      `page-0 sync-state record for '${taskUuid}' is malformed (${detail}) — refusing to treat a damaged canonical attachment as absent`,
    );
  }
}

/**
 * Rewrite page 0 authoritatively (FR-008): full replacement of the non-history members,
 * `history` = current page-0 slice (append-only), serialized with the frozen canonical
 * serializer under `metadataNamespaceKey`, screened before transmission, landed via
 * `upsertAttachmentByUrl` (create-or-update — never duplicates). T042 implements (T035).
 *
 * `cursors.lastSyncAt` comes from the injected clock (determinism, Principle IV/VI); the
 * history slice is re-read from the tracker per call and passed through verbatim — this
 * rewrite never edits, reorders, or re-screens stored entries (§3 append-only; a fixed
 * clock + stable serialization make repeated rewrites byte-identical, SC-001/FR-015).
 */
export async function rewritePageZeroPayload(
  ctx: AttachmentRunContext,
  input: PageZeroRewriteInput,
): Promise<AttachmentView> {
  const existing = await readPageZeroPayload(ctx, input.taskUuid);
  const md = input.frameworkMetadata;
  const frameworkMetadata: FrameworkMetadata = {
    // Closed vocabulary (not free text from the spec boundary) — verbatim.
    frameworkId: md.frameworkId,
    ...(md.featureName !== undefined
      ? { featureName: screened(ctx.screener, md.featureName, "frameworkMetadata.featureName") }
      : {}),
    filePath: screened(ctx.screener, md.filePath, "frameworkMetadata.filePath"),
    ...(md.localTaskId !== undefined
      ? { localTaskId: screened(ctx.screener, md.localTaskId, "frameworkMetadata.localTaskId") }
      : {}),
  };
  const payload: SyncStatePayload = {
    taskUuid: input.taskUuid,
    frameworkMetadata,
    descriptionContentHash: input.descriptionContentHash,
    cursors: { lastSyncAt: ctx.clock.now().toISOString() },
    history: existing?.history ?? [],
  };
  return ctx.port.upsertAttachmentByUrl({
    issueId: input.issueId,
    url: canonicalAttachmentUrl(ctx.config, input.taskUuid),
    ...presentation(ctx.config),
    metadata: { [ctx.config.metadataNamespaceKey]: serializeSyncStatePayload(payload) },
  });
}

/**
 * Pure rollover computation (history-log.md §3 step 2): given the candidate page content
 * `history(n) + [event]`, split at the threshold — `len > historyLogMaxEntries` (default
 * 50) or `bytes(canonicalSerialize(candidate)) > historyLogMaxBytes` (when configured).
 * Existing entries never move backwards or get rewritten; `head ++ tail === candidate`.
 * T042 implements (T029).
 *
 * T029 pinning honored verbatim: the byte measure is
 * `Buffer.byteLength(canonicalJson(candidateEventArray), "utf8")` over the candidate EVENT
 * ARRAY itself with STRICT `>`; the split is the LONGEST prefix satisfying BOTH thresholds
 * (canonical-array size is strictly monotone in prefix length, so this never evicts entries
 * an earlier page already holds) and head/tail are `Array#slice` views — the IDENTICAL
 * candidate objects, never re-serialized or edited (FR-009). Empty candidate ⇒ `{[],[]}`;
 * one over-threshold event on an empty page ⇒ `head: []`, `tail: [event]`.
 */
export function computeRolloverSplit(
  candidate: readonly SyncHistoryEvent[],
  config: ResolvedConfig,
): RolloverSplit {
  const maxBytes = config.historyLogMaxBytes;
  let keep = Math.min(candidate.length, config.historyLogMaxEntries);
  if (maxBytes !== undefined) {
    while (keep > 0 && Buffer.byteLength(canonicalJson(candidate.slice(0, keep)), "utf8") > maxBytes) {
      keep -= 1;
    }
  }
  return { head: candidate.slice(0, keep), tail: candidate.slice(keep) };
}

/**
 * Append exactly one screened event to the task's history chain (FR-009; history-log §2–§3):
 * walk pages 0..n via `getAttachmentByUrl` until the first absent page; append to page n;
 * roll the overflow tail to page n+1 (create-or-update by URL). All writes URL-idempotent
 * so resumed applies land byte-identical pages (SC-001/FR-015). T042 implements (T029/T035).
 *
 * Behavior details pinned here (per contract §3):
 * - the event description passes the screener at append time (blocked ⇒ throw, zero writes);
 *   stored entries are re-landed byte-identical, never edited/reordered (§3 invariants);
 * - an unparseable continuation record is treated as an absent chain link (page walk stops);
 * - page 0 must already exist (apply lands the canonical anchor first — rewrite/create);
 *   appending onto a missing anchor throws rather than fabricating an incomplete payload;
 * - head page `n` is written before tail page `n+1` (crash-safe, duplication-free resume);
 * - journal callers wanting `priorMetadata` (FR-015) capture the pre-write
 *   `getAttachmentByUrl` view at the addressed URL BEFORE calling this function.
 */
export async function appendHistoryEvent(
  ctx: AttachmentRunContext,
  input: { readonly issueId: string; readonly taskUuid: string; readonly event: SyncHistoryEvent },
): Promise<HistoryAppendResult> {
  const { issueId, taskUuid } = input;
  const description = screened(ctx.screener, input.event.description, "history event description");
  const entry: SyncHistoryEvent =
    description === input.event.description ? input.event : { ...input.event, description };

  // §3 step 1 — walk pages 0..n from the URLs; the chain is never cached locally.
  const pageZero = await readPageZeroPayload(ctx, taskUuid);
  if (pageZero === null) {
    throw new EngineError(
      `cannot append a history event for '${taskUuid}': the canonical page-0 attachment is absent — the create/rewrite flow must land page 0 first`,
    );
  }
  let n = 0;
  let history = pageZero.history;
  for (let page = 1; page <= MAX_CHAIN_PAGES; page += 1) {
    const view = await ctx.port.getAttachmentByUrl(historyPageAddress(ctx.config, taskUuid, page));
    if (view === null) break;
    const parsed = parseHistoryPageRecord(view, ctx.config.metadataNamespaceKey);
    if (parsed === null) break; // no (or unparseable) namespaced record ⇒ absent chain link
    n = page;
    history = parsed.history;
  }
  if (n >= MAX_CHAIN_PAGES) {
    throw new EngineError(
      `history chain for '${taskUuid}' exceeded ${MAX_CHAIN_PAGES} contiguous pages — inconsistent tracker state`,
    );
  }

  // §3 step 2 — candidate + longest-in-threshold-prefix split; existing entries stay put.
  const split = computeRolloverSplit([...history, entry], ctx.config);
  const namespaceKey = ctx.config.metadataNamespaceKey;

  // §3 step 3 — URL-idempotent create-or-update; head page first so a crash between the
  // two writes leaves the walk re-deriving the identical split on resume (no duplicates).
  const pagesWritten: AttachmentView[] = [];
  const upsertPage = async (page: number, entries: readonly SyncHistoryEvent[]): Promise<AttachmentView> => {
    const metadata: AttachmentMetadata =
      page === 0
        ? { [namespaceKey]: serializeSyncStatePayload({ ...pageZero, history: entries }) }
        : serializeHistoryPageRecord({ taskUuid, page, history: entries }, namespaceKey);
    return ctx.port.upsertAttachmentByUrl({
      issueId,
      url: historyPageAddress(ctx.config, taskUuid, page),
      ...presentation(ctx.config),
      metadata,
    });
  };
  pagesWritten.push(await upsertPage(n, split.head));

  let page = n;
  if (split.tail.length > 0) {
    page = n + 1;
    pagesWritten.push(await upsertPage(page, split.tail));
  }
  return { page, pagesWritten, rolledOver: split.tail.length > 0 };
}
