/**
 * T038 [US2] — real attachment operations replacing the T023 shell (contracts/
 * tracker-adapter.md rows 7–11). `upsertAttachmentByUrl` posts ONE `attachmentCreate` — the
 * platform's URL idempotency IS the frozen "updates in place, no duplicate, no attachment id
 * stored anywhere by callers" semantic (R7): no read-before-write, no check-then-create race,
 * and the adapter itself stays stateless. `findIssuesByAttachmentUrl`/`getAttachmentByUrl`
 * address the identity route purely by URL (`attachmentsForURL`) — description is never a
 * filter (FR-004) — mapping all carriers (0/1/>1; the >1 integrity abort is the caller's) or
 * first-or-null. `updateAttachment` is the flat metadata map passthrough; `listAttachments`
 * returns the frozen cursor `Page` (006/008's FR-004 scan route).
 */
import type { AttachmentMetadata, AttachmentView, IssueView, Page } from "../../ports/linear-port.js";
import { TrackerConfigError, TrackerError } from "../errors.js";
import { asList, asRecord, mapAttachmentNode, mapIssueNode, payloadUserError } from "../graphql/mapping.js";
import type { TrackerContext } from "../internal/request.js";

function attachmentFromPayload(data: Record<string, unknown>, key: string, ctx: TrackerContext): AttachmentView {
  const payload = asRecord(data[key]);
  const userError = payloadUserError(payload);
  if (userError !== "") {
    throw new TrackerError({ category: "graphql", retryable: false, attempts: 1, detail: ctx.sanitize(`${key}: ${userError}`) });
  }
  const attachment = payload?.["attachment"];
  if (attachment == null) {
    throw new TrackerError({ category: "graphql", retryable: false, attempts: 1, detail: ctx.sanitize(`${key}: success without an attachment node`) });
  }
  return mapAttachmentNode(attachment);
}

export async function upsertAttachmentByUrlImpl(
  ctx: TrackerContext,
  input: {
    readonly issueId: string;
    readonly url: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  },
): Promise<AttachmentView> {
  const variables: Record<string, unknown> = {
    issueId: input.issueId,
    url: input.url,
    title: input.title,
    metadata: { ...input.metadata },
  };
  if (input.subtitle !== undefined) variables["subtitle"] = input.subtitle;
  if (input.iconUrl !== undefined) variables["iconUrl"] = input.iconUrl;
  // Exactly one request — platform (issue, url) idempotency creates OR updates in place (R7).
  return ctx.exec.exec("attachmentCreate", variables, (d) => attachmentFromPayload(d, "attachmentCreate", ctx), {
    retryClass: "non-create",
  });
}

export async function findIssuesByAttachmentUrlImpl(ctx: TrackerContext, attachmentUrl: string): Promise<IssueView[]> {
  const carriers = await ctx.exec.exec(
    "attachmentsForURL",
    { url: attachmentUrl },
    (d) =>
      asList(d["attachmentsForURL"])
        .map((entry) => asRecord(entry)?.["issue"])
        .filter((issue) => issue != null),
    { retryClass: "non-create", notFoundMeansNull: true },
  );
  // DEDUPED by id, order-preserving; ALL carriers reported (constitution II: >1 is the
  // caller's integrity signal — the port reports, never hides).
  const seen = new Set<string>();
  const issues: IssueView[] = [];
  for (const node of carriers) {
    const view = mapIssueNode(node);
    if (!seen.has(view.id)) {
      seen.add(view.id);
      issues.push(view);
    }
  }
  return issues;
}

export async function getAttachmentByUrlImpl(ctx: TrackerContext, url: string): Promise<AttachmentView | null> {
  return ctx.exec.exec(
    "attachmentsForURL",
    { url },
    (d) => {
      const first = asList(d["attachmentsForURL"])[0];
      return first == null ? null : mapAttachmentNode(first);
    },
    { retryClass: "non-create", notFoundMeansNull: true },
  );
}

export async function updateAttachmentImpl(ctx: TrackerContext, id: string, metadata: AttachmentMetadata): Promise<AttachmentView> {
  return ctx.exec.exec(
    "attachmentUpdate",
    { id, metadata: { ...metadata } },
    (d) => attachmentFromPayload(d, "attachmentUpdate", ctx),
    { retryClass: "non-create" },
  );
}

export async function listAttachmentsImpl(ctx: TrackerContext, issueId: string, cursor?: string | null): Promise<Page<AttachmentView>> {
  const after = cursor ?? null;
  return ctx.exec.exec(
    "issueAttachments",
    { id: issueId, first: ctx.config.pageSize, after },
    (d) => {
      const issue = asRecord(d["issue"]);
      if (issue == null) {
        throw new TrackerError({ category: "not-found", retryable: false, attempts: 1, detail: ctx.sanitize(`issue '${issueId}' has no attachments connection`) });
      }
      const connection = asRecord(issue["attachments"]);
      const pageInfo = asRecord(connection?.["pageInfo"]);
      const hasNextPage = pageInfo?.["hasNextPage"] === true;
      const endCursor = typeof pageInfo?.["endCursor"] === "string" ? pageInfo["endCursor"] : null;
      if (hasNextPage && endCursor === null) {
        throw new TrackerConfigError("attachments page reported hasNextPage without endCursor — pagination cannot continue");
      }
      return {
        items: asList(connection?.["nodes"]).map(mapAttachmentNode),
        nextCursor: hasNextPage ? endCursor : null,
      };
    },
    { retryClass: "non-create" },
  );
}

export type { AttachmentMetadata };
