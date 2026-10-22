/**
 * T040 [US2] — manifest-envelope unit tests (research R9, FR-002): AES-256-GCM seal/open,
 * tamper rejection with NO plaintext return, key-unavailable abort, expiry computed from
 * the unencrypted header at any encryption state, expiry boundary strictness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  sealManifest,
  openManifest,
  isManifestExpired,
  ManifestTamperError,
  ManifestKeyUnavailableError,
  type KeyProvider,
  type ManifestEnvelope,
} from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";
import { FakeClock } from "../helpers/test-utils.js";

const cfg = loadConfig({});
const CANARY = "unique-plaintext-marker-8f3a2b";

function mapProvider(keys: Record<string, Uint8Array>): KeyProvider {
  return {
    async getKey(keyId: string): Promise<Uint8Array | null> {
      return keys[keyId] ?? null;
    },
  };
}

const key32 = randomBytes(32);
const provider = mapProvider({ primary: key32 });
const emptyProvider = mapProvider({});

const manifest = {
  runId: "run-9",
  createdAt: "2026-10-22T09:00:00.000Z",
  repoRoot: "/fixture/repo-a",
  planId: "f".repeat(64),
  fileBackups: [],
  checkpointBefore: [],
  operations: [{ opId: "op-1", kind: "update-issue", targetIssueId: "i-1", stepState: "applied" }],
  secretPayload: CANARY,
} as const;

test("seal → open round-trips the manifest exactly", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const env = await sealManifest(manifest, cfg, provider, clock);
  assert.equal(env.schemaVersion, 1);
  assert.equal(env.keyId, cfg.manifestKeyId);
  assert.equal(env.createdAt, "2026-10-22T09:00:00.000Z", "unencrypted header from injected clock");
  // Ciphertext must not leak plaintext.
  assert.ok(!env.ciphertext.includes(CANARY), "ciphertext leaks plaintext!");
  assert.ok(!Buffer.from(env.ciphertext, "base64").toString("utf8").includes(CANARY));

  const opened = (await openManifest(env, cfg, provider)) as { createdAt: string; manifest: unknown };
  assert.equal(opened.createdAt, env.createdAt);
  assert.deepEqual(opened.manifest, JSON.parse(JSON.stringify(manifest)));
});

test("tampered ciphertext rejects with ManifestTamperError and returns NO plaintext", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const env = await sealManifest(manifest, cfg, provider, clock);
  const tampered: ManifestEnvelope = { ...env, ciphertext: flipFirstChar(env.ciphertext) };
  await assert.rejects(() => openManifest(tampered, cfg, provider), ManifestTamperError);

  // The error message carries no plaintext and no key material.
  try {
    await openManifest(tampered, cfg, provider);
    assert.fail("must reject");
  } catch (e) {
    assert.ok(e instanceof ManifestTamperError);
    assert.ok(!e.message.includes(CANARY), "error leaks plaintext!");
    assert.ok(!e.message.includes(key32.toString("base64")));
  }

  // Tampering the tag or IV also rejects.
  await assert.rejects(() => openManifest({ ...env, tag: flipFirstChar(env.tag) }, cfg, provider), ManifestTamperError);
  await assert.rejects(() => openManifest({ ...env, iv: flipFirstChar(env.iv) }, cfg, provider), ManifestTamperError);

  // Wrong key rejects too (tag check fails ⇒ tamper).
  const otherProvider = mapProvider({ primary: randomBytes(32) });
  await assert.rejects(() => openManifest(env, cfg, otherProvider), ManifestTamperError);
});

function flipFirstChar(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[0] = buf[0] ^ 0xff;
  return buf.toString("base64");
}

test("key unavailable ⇒ abort with ManifestKeyUnavailableError (seal AND open)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  await assert.rejects(() => sealManifest(manifest, cfg, emptyProvider, clock), ManifestKeyUnavailableError);
  const env = await sealManifest(manifest, cfg, provider, clock);
  await assert.rejects(() => openManifest(env, cfg, emptyProvider), ManifestKeyUnavailableError);

  // Non-32-byte keys are refused (AES-256 only).
  const shortProvider = mapProvider({ primary: randomBytes(16) });
  await assert.rejects(() => sealManifest(manifest, cfg, shortProvider, clock), ManifestKeyUnavailableError);
});

test("manifest expiry (FR-002) — evaluates the header field at ANY encryption state — injected clock", () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const dayMs = 24 * 60 * 60 * 1000;
  const header = { createdAt: "2026-10-22T09:00:00.000Z" }; // encryption-OFF stand-in

  clock.advanceMs(29 * dayMs);
  assert.equal(isManifestExpired(header, cfg, clock), false, "29 days: fresh");
  clock.advanceMs(1 * dayMs); // exactly 30 days
  assert.equal(isManifestExpired(header, cfg, clock), false, "exactly 30 days is NOT > 30");
  clock.advanceMs(1);
  assert.equal(isManifestExpired(header, cfg, clock), true, "30 days + 1 ms: expired");

  // Same computation for the sealed envelope header (encryption-ON path is header-only too).
  clock.advanceMs(-1); // back to exactly 30d
  assert.equal(isManifestExpired(header, cfg, clock), false);
  clock.advanceMs(2 * dayMs);
  assert.equal(isManifestExpired({ createdAt: "2026-10-22T09:00:00.000Z" }, cfg, clock), true, "expired envelope header");

  // manifestExpiryDays override.
  const shortCfg = loadConfig({ overrides: { manifestExpiryDays: 3 } });
  assert.equal(isManifestExpired(header, shortCfg, new FakeClock("2026-10-26T09:00:01.000Z")), true);
  assert.equal(isManifestExpired(header, shortCfg, new FakeClock("2026-10-25T09:00:00.000Z")), false);
});
