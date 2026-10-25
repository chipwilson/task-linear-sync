/**
 * `Stable_UUID` computation (research R3; 002 research R11: "004 computes, 002 freezes" —
 * this module implements the frozen computation contract over the frozen seed).
 *
 * Decision (R3, verbatim): "digest = `sha256(namespacePrefix(toolId) + seed)` with
 * `namespacePrefix` a fixed `toolId`-derived constant; version nibble set to `5`, variant
 * bits per RFC 4122, lowercase 8-4-4-4-12 rendering". The seed string is ONLY ever
 * obtained by calling the frozen `taskStableSeed(t, { ordinal, filePath })` from
 * `task-linear-sync/domain` — it is never re-formatted here (re-implementing the seed
 * join would be the identity split-brain drift R3 rejects).
 *
 * The caller supplies `taskStableSeed(...)` output verbatim; the UUID never appears in
 * file content (constitution II). `node:crypto` is the only built-in this module uses.
 */
import { createHash } from "node:crypto";

/** Fixed toolId-derived namespace constant (R3): distinct toolIds never collide. */
function namespacePrefix(toolId: string): string {
  return `task-linear-sync:stable-uuid:v5|${toolId}|`;
}

/**
 * Derive the deterministic v5-shaped Stable_UUID for one task seed.
 * Deterministic and pure: same (seed, toolId) bytes ⇒ same UUID across calls (Principle IV).
 */
export function deriveStableUuid(seed: string, toolId: string): string {
  const digest = createHash("sha256").update(namespacePrefix(toolId) + seed, "utf8").digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version nibble = 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant bits
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
