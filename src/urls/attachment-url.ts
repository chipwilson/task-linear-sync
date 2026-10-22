/**
 * Canonical attachment URL scheme — pure builders + parser, fully implemented here.
 * This scheme is the sole identity anchor (constitution Principle II); consumers:
 * 007 (upsert/chain), 008 (journaling/state), 011 (page routing), 006 (identity lookup).
 * Mirror: contracts/attachment-url-scheme.md.
 */

/** Typed misconfiguration/rejection surface: never silent (behavior rule 2). */
export class UrlSchemeError extends Error {
  override readonly name = "UrlSchemeError";
  constructor(message: string) {
    super(message);
  }
}

export interface AttachmentUrlConfig {
  readonly attachmentBaseHost: string;
  readonly toolId: string;
  readonly attachmentUrlTemplate: string;
  readonly continuationUrlTemplate: string;
}

export type ParsedAttachmentUrl =
  | { readonly kind: "canonical"; readonly baseHost: string; readonly toolId: string; readonly taskUuid: string }
  | {
      readonly kind: "continuation";
      readonly baseHost: string;
      readonly toolId: string;
      readonly taskUuid: string;
      readonly page: number;
    }
  | null; // null => not a URL of this scheme

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Behavior rule 1: trailing '/' and extra whitespace removed; no query/fragment accepted. */
function normalizeBaseHost(host: string): string {
  const trimmed = String(host).trim();
  if (trimmed.length === 0) throw new UrlSchemeError("attachmentBaseHost must not be empty");
  if (/\s/.test(trimmed)) throw new UrlSchemeError(`attachmentBaseHost must not contain whitespace: ${trimmed}`);
  if (/[?#]/.test(trimmed)) throw new UrlSchemeError(`attachmentBaseHost must not contain query/fragment: ${trimmed}`);
  return trimmed.replace(/\/+$/, "");
}

function assertUuid(taskUuid: string): void {
  if (!UUID_RE.test(taskUuid)) {
    throw new UrlSchemeError(`task uuid must match ${UUID_SOURCE}: ${taskUuid}`);
  }
}

function assertPlaceholders(template: string, required: readonly string[], templateName: string): void {
  for (const p of required) {
    if (!template.includes(`{${p}}`)) {
      throw new UrlSchemeError(`template '${templateName}' must contain placeholder {${p}}`);
    }
  }
}

function fill(template: string, baseHost: string, toolId: string, uuid: string, page?: number): string {
  let out = template.replaceAll("{baseHost}", baseHost).replaceAll("{toolId}", toolId).replaceAll("{uuid}", uuid);
  if (page !== undefined) out = out.replaceAll("{page}", String(page));
  return out;
}

/** Canonical page-0 URL: <base-host>/<toolId>/<task-uuid>. Throws on invalid uuid shape or unsafe host/template. */
export function canonicalAttachmentUrl(cfg: AttachmentUrlConfig, taskUuid: string): string {
  const baseHost = normalizeBaseHost(cfg.attachmentBaseHost);
  assertUuid(taskUuid);
  assertPlaceholders(cfg.attachmentUrlTemplate, ["baseHost", "toolId", "uuid"], "attachmentUrlTemplate");
  return fill(cfg.attachmentUrlTemplate, baseHost, cfg.toolId, taskUuid);
}

/** Continuation page URL (page must be an integer >= 1): .../<pageN>. Page 0 never appears as a path segment. */
export function continuationAttachmentUrl(
  cfg: AttachmentUrlConfig,
  taskUuid: string,
  page: number,
): string {
  const baseHost = normalizeBaseHost(cfg.attachmentBaseHost);
  assertUuid(taskUuid);
  if (!Number.isInteger(page) || page < 1) {
    throw new UrlSchemeError(`continuation page must be an integer >= 1 (page 0 is the canonical URL): ${page}`);
  }
  assertPlaceholders(
    cfg.continuationUrlTemplate,
    ["baseHost", "toolId", "uuid", "page"],
    "continuationUrlTemplate",
  );
  return fill(cfg.continuationUrlTemplate, baseHost, cfg.toolId, taskUuid, page);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inverse of the builders for a fixed config; used by 007 chain walk and 011 routing.
 * Template literals are anchored and placeholders become capture groups; overridden
 * templates are accepted consistently with the builders (behavior rule 4).
 */
export function parseAttachmentUrl(cfg: AttachmentUrlConfig, url: string): ParsedAttachmentUrl {
  const baseHost = normalizeBaseHost(cfg.attachmentBaseHost);

  const toPattern = (template: string, withPage: boolean): RegExp => {
    let source = escapeRe(template)
      .split(escapeRe("{baseHost}")).join(escapeRe(baseHost))
      .split(escapeRe("{toolId}")).join(escapeRe(cfg.toolId))
      .split(escapeRe("{uuid}")).join(`(${UUID_SOURCE})`);
    source = withPage
      ? source.split(escapeRe("{page}")).join("(\\d+)")
      : source.split(escapeRe("{page}")).join("\\d+");
    return new RegExp(`^${source}$`);
  };

  const canCanonical =
    cfg.attachmentUrlTemplate.includes("{baseHost}") &&
    cfg.attachmentUrlTemplate.includes("{toolId}") &&
    cfg.attachmentUrlTemplate.includes("{uuid}");
  const canContinuation =
    canCanonical &&
    cfg.continuationUrlTemplate.includes("{baseHost}") &&
    cfg.continuationUrlTemplate.includes("{toolId}") &&
    cfg.continuationUrlTemplate.includes("{uuid}") &&
    cfg.continuationUrlTemplate.includes("{page}");

  if (canCanonical) {
    const m = toPattern(cfg.attachmentUrlTemplate, false).exec(url);
    if (m) {
      return { kind: "canonical", baseHost, toolId: cfg.toolId, taskUuid: m[1] };
    }
  }
  if (canContinuation) {
    const m = toPattern(cfg.continuationUrlTemplate, true).exec(url);
    if (m) {
      const page = Number(m[2]);
      // Page 0 never appears as a path segment: ".../<uuid>/0" is not a URL of this scheme.
      if (!Number.isInteger(page) || page < 1) return null;
      return { kind: "continuation", baseHost, toolId: cfg.toolId, taskUuid: m[1], page };
    }
  }
  return null;
}
