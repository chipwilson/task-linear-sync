/**
 * T023 placeholder shell — US2 replaces these internals (T038) with the real attachment
 * operations. Until then every member throws the T010/T011 skip signal (`notImplemented`).
 * Contract rows: tracker-adapter.md 7–11 (identity route is attachment-metadata ONLY —
 * description is data, never a filter).
 */
import type { AttachmentMetadata, AttachmentView, IssueView, Page } from "../../ports/linear-port.js";
import { notImplemented } from "../errors.js";
import type { TrackerContext } from "../internal/request.js";

/** Frozen `LinearPort.findIssuesByAttachmentUrl` (replaced by T038). */
export function findIssuesByAttachmentUrlImpl(_ctx: TrackerContext, _attachmentUrl: string): Promise<IssueView[]> {
  throw notImplemented("findIssuesByAttachmentUrl");
}

/** Frozen `LinearPort.upsertAttachmentByUrl` (replaced by T038). */
export function upsertAttachmentByUrlImpl(
  _ctx: TrackerContext,
  _input: {
    readonly issueId: string;
    readonly url: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  },
): Promise<AttachmentView> {
  throw notImplemented("upsertAttachmentByUrl");
}

/** Frozen `LinearPort.updateAttachment` (replaced by T038). */
export function updateAttachmentImpl(_ctx: TrackerContext, _id: string, _metadata: AttachmentMetadata): Promise<AttachmentView> {
  throw notImplemented("updateAttachment");
}

/** Frozen `LinearPort.getAttachmentByUrl` (replaced by T038). */
export function getAttachmentByUrlImpl(_ctx: TrackerContext, _url: string): Promise<AttachmentView | null> {
  throw notImplemented("getAttachmentByUrl");
}

/** Frozen `LinearPort.listAttachments` (replaced by T038). */
export function listAttachmentsImpl(_ctx: TrackerContext, _issueId: string, _cursor?: string | null): Promise<Page<AttachmentView>> {
  throw notImplemented("listAttachments");
}
