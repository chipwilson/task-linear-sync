/**
 * Audit-manifest envelope + expiry (research R9, FR-002). The manifest file is either a
 * versioned encryption envelope (AES-256-GCM, key NEVER stored with ciphertext; failed
 * tag check rejects with NO plaintext) or a plain JSON manifest when encryption is off.
 * Expiry is computed from the recorded creation timestamp duplicated in an UNENCRYPTED
 * header field so "expired" is decidable without key material — regardless of whether
 * encryption is enabled (FR-002). Journaling end-to-end behavior is exercised by 008.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { canonicalJson } from "../domain/plan.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Clock } from "./clock.js";

/** Versioned envelope; all binary members base64. `createdAt` is the unencrypted header (R9). */
export interface ManifestEnvelope {
  readonly schemaVersion: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
  /** ISO-8601; duplicated in the unencrypted header so expiry needs no keys. */
  readonly createdAt: string;
}

/**
 * Injectable key provider (env-var name or platform key-store; 008 wires providers).
 * Keys must be 32 bytes (AES-256). Returning null ⇒ abort, key unavailable — no manifest
 * I/O beyond the lookup itself.
 */
export interface KeyProvider {
  getKey(keyId: string): Promise<Uint8Array | null>;
}

/** Raised on failed AES-256-GCM tag check; the error carries NO plaintext (R9). */
export class ManifestTamperError extends Error {
  override readonly name = "ManifestTamperError";
}

/** Raised when the configured key is unavailable; aborts before any manifest content read. */
export class ManifestKeyUnavailableError extends Error {
  override readonly name = "ManifestKeyUnavailableError";
}

/**
 * Expiry (FR-002): elapsed(clock.now, createdAt) > manifestExpiryDays (default 30).
 * Evaluated regardless of encryption state — the input is the header field, so no key
 * material is involved. Expired ⇒ { valid: false } ⇒ rollback refuses.
 */
export function isManifestExpired(
  env: Pick<ManifestEnvelope, "createdAt">,
  cfg: ResolvedConfig,
  clock: Clock,
): boolean {
  const ageMs = clock.elapsed(env.createdAt);
  return ageMs > cfg.manifestExpiryDays * 24 * 60 * 60 * 1000;
}

/** Seal: AES-256-GCM over canonical JSON. Key never stored with the ciphertext. */
export async function sealManifest(
  m: unknown,
  cfg: ResolvedConfig,
  kp: KeyProvider,
  clock: Clock,
): Promise<ManifestEnvelope> {
  const keyId = cfg.manifestKeyId;
  const key = await kp.getKey(keyId);
  if (key === null) {
    throw new ManifestKeyUnavailableError(`manifest key '${keyId}' unavailable — refusing to seal`);
  }
  if (key.length !== 32) {
    throw new ManifestKeyUnavailableError(`manifest key '${keyId}' must be 32 bytes for AES-256-GCM, got ${key.length}`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const createdAt = clock.now().toISOString();
  const plaintext = canonicalJson({ createdAt, manifest: m });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    schemaVersion: 1,
    keyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    createdAt, // unencrypted header (R9)
  };
}

/** Open: tag failure rejects with ManifestTamperError and returns NO plaintext. */
export async function openManifest(
  env: ManifestEnvelope,
  cfg: ResolvedConfig,
  kp: KeyProvider,
): Promise<unknown> {
  void cfg; // envelope is self-describing (schemaVersion + keyId); cfg reserved per contract signature
  const key = await kp.getKey(env.keyId);
  if (key === null) {
    throw new ManifestKeyUnavailableError(`manifest key '${env.keyId}' unavailable — refusing to open`);
  }
  if (key.length !== 32) {
    throw new ManifestKeyUnavailableError(`manifest key '${env.keyId}' must be 32 bytes for AES-256-GCM, got ${key.length}`);
  }
  if (env.schemaVersion !== 1) {
    throw new ManifestTamperError(`unsupported envelope schemaVersion: ${String(env.schemaVersion)}`);
  }
  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, "base64")),
      decipher.final(), // throws on failed tag check
    ]).toString("utf8");
  } catch {
    // NO plaintext returned — sanitized diagnostic only (R9 / constitution locking constraint).
    throw new ManifestTamperError("manifest authentication tag check failed — manifest rejected");
  }
  return JSON.parse(plaintext) as unknown;
}
