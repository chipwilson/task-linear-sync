/**
 * Route parsing (T009; FR-001/FR-002, contracts/http-surface.md §1, R2).
 *
 * The served route set is EXACTLY the configured attachment URL scheme:
 * query/fragment are stripped, the path is re-anchored under
 * `attachmentBaseHost` (trimmed, trailing `/` dropped), and the frozen
 * `parseAttachmentUrl` classifies the result. The request `Host` header
 * never participates. Nothing here fetches or touches any transport.
 */

import type { ResolvedConfig } from "../config/schema.js";
import { UrlSchemeError, parseAttachmentUrl } from "../urls/attachment-url.js";

export type HistoryRouteOutcome =
  /** Routed history address; `page` 0 for canonical, n ≥ 1 for continuation. */
  | { readonly kind: "match"; readonly taskUuid: string; readonly page: number }
  /** Every non-scheme outcome — zero history bytes downstream (SC-002). */
  | { readonly kind: "notFound" }
  /** Parser throw: unusable host/template config (construction probes make this unreachable). */
  | { readonly kind: "internalError" };

export function parseHistoryRoute(config: ResolvedConfig, reqUrl: string): HistoryRouteOutcome {
  const rawPath = reqUrl.split("?")[0]?.split("#")[0] ?? "";
  if (!rawPath.startsWith("/")) {
    return { kind: "notFound" };
  }
  try {
    const baseHost = config.attachmentBaseHost.trim().replace(/\/+$/, "");
    const parsed = parseAttachmentUrl(config, baseHost + rawPath);
    if (parsed === null) {
      return { kind: "notFound" };
    }
    if (parsed.kind === "canonical") {
      return { kind: "match", taskUuid: parsed.taskUuid, page: 0 };
    }
    if (parsed.page < 1) {
      // Page 0 never appears as a continuation segment (frozen scheme rule).
      return { kind: "notFound" };
    }
    return { kind: "match", taskUuid: parsed.taskUuid, page: parsed.page };
  } catch (error) {
    if (error instanceof UrlSchemeError) {
      return { kind: "internalError" };
    }
    throw error;
  }
}
