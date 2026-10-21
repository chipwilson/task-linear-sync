# Contract: Canonical Attachment URL Scheme

Module: `src/urls/attachment-url.ts`. **Fully implemented by this feature** (pure builders +
parser). This scheme is the sole identity anchor (constitution Principle II); consumers:
007 (upsert/chain), 008 (journaling/state), 011 (page routing), 006 (identity lookup via
`findIssuesByAttachmentUrl`).

## Scheme (frozen)

| Page | URL | Role |
|---|---|---|
| 0 (canonical) | `<base-host>/<toolId>/<task-uuid>` | Identity anchor + non-history managed state; sole matching anchor; per-issue idempotency key for create-or-update |
| n ≥ 1 | `<base-host>/<toolId>/<task-uuid>/<n>` | Continuation page, history-only; indices increment from 1; walk stops at first absent index |

Templates are config values (`attachmentUrlTemplate`, `continuationUrlTemplate`) with
placeholders `{baseHost}`, `{toolId}`, `{uuid}`, `{page}`; the defaults above are the
canonical templates. `baseHost` default is a benign placeholder host with no real
organization identifier (release-scan guarantee); both templates share the same base host
and `toolId`.

```ts
/** Canonical page-0 URL. Throws on invalid uuid shape or unsafe host/template. */
export function canonicalAttachmentUrl(cfg: AttachmentUrlConfig, taskUuid: string): string;

/** Continuation page URL; page must be an integer >= 1. */
export function continuationAttachmentUrl(cfg: AttachmentUrlConfig,
                                          taskUuid: string, page: number): string;

export type ParsedAttachmentUrl =
  | { readonly kind: "canonical"; readonly baseHost: string; readonly toolId: string;
      readonly taskUuid: string }
  | { readonly kind: "continuation"; readonly baseHost: string; readonly toolId: string;
      readonly taskUuid: string; readonly page: number }
  | null; // null => not a URL of this scheme

/** Inverse of the builders for a fixed config; used by 007 chain walk and 011 routing. */
export function parseAttachmentUrl(cfg: AttachmentUrlConfig, url: string): ParsedAttachmentUrl;

export interface AttachmentUrlConfig {
  readonly attachmentBaseHost: string;
  readonly toolId: string;
  readonly attachmentUrlTemplate: string;
  readonly continuationUrlTemplate: string;
}
```

## Behavior rules (normative, tested in `tests/unit/attachment-url.test.ts`)

1. **Determinism**: same `(cfg, taskUuid[, page])` ⇒ byte-identical URL on every call
   (Principle IV). Base host is normalized: trailing `/` and extra whitespace removed; no
   query/fragment accepted.
2. **Validation**: `taskUuid` must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
   `page` integer ≥ 1 for continuation; template must contain its required placeholders —
   builder throws a typed `UrlSchemeError` otherwise (misconfiguration surfaces at load or
   first use, never silently).
3. **Round-trip**: for every URL produced by a builder under config `cfg`,
   `parseAttachmentUrl(cfg, url)` returns the matching parsed record; `page 0` never appears
   as a path segment (the canonical form carries no page marker).
4. **Template override safety**: overridden templates MUST preserve the `{uuid}` segment
   uniqueness (007's URL-idempotency depends on it); parse accepts overridden templates
   consistently with the builders.
