/**
 * Sync State Payload & Attachment-Chain payload shapes (frozen). Serialized into the single
 * string value under metadataNamespaceKey in the page-0 attachment's Attachment_Metadata.
 * Mirror: data-model.md §8, contracts/task-model.md.
 */
import type { FrameworkMetadata } from "./task.js";

/** Immutable once appended; rollback appends rather than rewinds (Principle IV). */
export type SyncHistoryEventKind =
  | "discovered"
  | "issue-created"
  | "matched"
  | "title-updated"
  | "description-updated"
  | "checkbox-changed"
  | "conflict-detected"
  | "rollback";

export interface SyncHistoryEvent {
  readonly kind: SyncHistoryEventKind;
  /** ISO-8601. */
  readonly at: string;
  /** Human-readable, screened by the Security_Screener before storage. */
  readonly description: string;
  /** e.g. reversed action ids for "rollback". */
  readonly references?: readonly string[];
}

/**
 * Serialized (compact, stable key order) into one Attachment_Metadata string value.
 * Metadata values are strings/numbers only (Attachment_Metadata rule).
 */
export interface SyncStatePayload {
  /** Durable identity anchor (sole matching anchor, page 0 only). */
  readonly taskUuid: string;
  readonly frameworkMetadata: FrameworkMetadata;
  /** sha256 hex of mirrored content. */
  readonly descriptionContentHash: string;
  readonly cursors: { readonly lastSyncAt: string };
  /** Append-only page of the Sync_History_Log. */
  readonly history: readonly SyncHistoryEvent[];
}

function canonicalSorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSorted);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalSorted(v);
    }
    return out;
  }
  return value;
}

/** Compact, stable-key-order serialization into one Attachment_Metadata string value. */
export function serializeSyncStatePayload(p: SyncStatePayload): string {
  return JSON.stringify(canonicalSorted(p));
}

/** Inverse of serializeSyncStatePayload; throws on malformed input or non-object root. */
export function parseSyncStatePayload(s: string): SyncStatePayload {
  const parsed: unknown = JSON.parse(s);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("SyncStatePayload root must be a JSON object");
  }
  return parsed as SyncStatePayload;
}
