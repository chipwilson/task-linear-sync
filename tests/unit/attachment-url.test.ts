/**
 * T010 — attachment URL scheme unit tests (contracts/attachment-url-scheme.md § Behavior rules).
 * Determinism, base-host normalization, UUID/page/template validation (typed UrlSchemeError),
 * builder→parser round-trip (canonical + pages 1..10), template-override safety,
 * and "page 0 never appears as a path segment".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UrlSchemeError,
  canonicalAttachmentUrl,
  continuationAttachmentUrl,
  parseAttachmentUrl,
  type AttachmentUrlConfig,
} from "task-linear-sync/urls";

const UUID = "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b";
const UUID2 = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

const cfg: AttachmentUrlConfig = {
  attachmentBaseHost: "https://sync.example.invalid",
  toolId: "task-linear-sync",
  attachmentUrlTemplate: "{baseHost}/{toolId}/{uuid}",
  continuationUrlTemplate: "{baseHost}/{toolId}/{uuid}/{page}",
};

test("canonical URL is <base-host>/<toolId>/<task-uuid> and deterministic", () => {
  const url = canonicalAttachmentUrl(cfg, UUID);
  assert.equal(url, `https://sync.example.invalid/task-linear-sync/${UUID}`);
  assert.equal(canonicalAttachmentUrl(cfg, UUID), url, "byte-identical across calls");
});

test("continuation URLs address pages n >= 1 by path segment", () => {
  assert.equal(
    continuationAttachmentUrl(cfg, UUID, 1),
    `https://sync.example.invalid/task-linear-sync/${UUID}/1`,
  );
  assert.equal(
    continuationAttachmentUrl(cfg, UUID2, 10),
    `https://sync.example.invalid/task-linear-sync/${UUID2}/10`,
  );
});

test("base host normalized: trailing '/' and surrounding whitespace removed", () => {
  const a = canonicalAttachmentUrl({ ...cfg, attachmentBaseHost: "https://sync.example.invalid///" }, UUID);
  const b = canonicalAttachmentUrl({ ...cfg, attachmentBaseHost: "  https://sync.example.invalid  " }, UUID);
  assert.equal(a, canonicalAttachmentUrl(cfg, UUID));
  assert.equal(b, canonicalAttachmentUrl(cfg, UUID));
});

test("base host rejects internal whitespace, query, and fragment", () => {
  for (const bad of ["https://bad host.invalid", "https://h.invalid?x=1", "https://h.invalid#frag"]) {
    assert.throws(
      () => canonicalAttachmentUrl({ ...cfg, attachmentBaseHost: bad }, UUID),
      UrlSchemeError,
      `expected UrlSchemeError for host: ${bad}`,
    );
  }
});

test("invalid UUID shape throws UrlSchemeError", () => {
  for (const bad of ["not-a-uuid", UUID.toUpperCase(), UUID.slice(0, 35), "", `${UUID}x`]) {
    assert.throws(() => canonicalAttachmentUrl(cfg, bad), UrlSchemeError, `expected throw for: ${bad}`);
    assert.throws(() => continuationAttachmentUrl(cfg, bad, 2), UrlSchemeError);
  }
});

test("continuation page must be an integer >= 1 (page 0 is the canonical form)", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => continuationAttachmentUrl(cfg, UUID, bad), UrlSchemeError, `expected throw for page ${bad}`);
  }
});

test("template missing a required placeholder throws UrlSchemeError", () => {
  assert.throws(
    () => canonicalAttachmentUrl({ ...cfg, attachmentUrlTemplate: "{baseHost}/{toolId}/state" }, UUID),
    UrlSchemeError,
  );
  assert.throws(
    () => continuationAttachmentUrl({ ...cfg, continuationUrlTemplate: "{baseHost}/{toolId}/{uuid}" }, UUID, 1),
    UrlSchemeError,
    "continuation template without {page} must throw",
  );
});

test("round-trip: parseAttachmentUrl inverts the builders for canonical + pages 1..10", () => {
  const canonical = canonicalAttachmentUrl(cfg, UUID);
  assert.deepEqual(parseAttachmentUrl(cfg, canonical), {
    kind: "canonical",
    baseHost: "https://sync.example.invalid",
    toolId: "task-linear-sync",
    taskUuid: UUID,
  });
  for (let page = 1; page <= 10; page++) {
    const url = continuationAttachmentUrl(cfg, UUID, page);
    assert.deepEqual(parseAttachmentUrl(cfg, url), {
      kind: "continuation",
      baseHost: "https://sync.example.invalid",
      toolId: "task-linear-sync",
      taskUuid: UUID,
      page,
    });
  }
});

test("page 0 never appears as a path segment", () => {
  // ".../uuid/0" is not a URL of this scheme.
  assert.equal(parseAttachmentUrl(cfg, `https://sync.example.invalid/task-linear-sync/${UUID}/0`), null);
  // The canonical form carries no page marker at all.
  assert.equal(canonicalAttachmentUrl(cfg, UUID).endsWith(`/0`), false);
});

test("foreign URLs parse as null", () => {
  for (const url of [
    "https://elsewhere.example.org/task-linear-sync/" + UUID,
    `https://sync.example.invalid/other-tool/${UUID}`,
    "https://sync.example.invalid",
    "",
  ]) {
    assert.equal(parseAttachmentUrl(cfg, url), null, `expected null for: ${url}`);
  }
});

test("template overrides round-trip consistently with the builders", () => {
  const overridden: AttachmentUrlConfig = {
    ...cfg,
    attachmentUrlTemplate: "{baseHost}/t/{toolId}/x/{uuid}",
    continuationUrlTemplate: "{baseHost}/t/{toolId}/x/{uuid}/pg/{page}",
  };
  const canonical = canonicalAttachmentUrl(overridden, UUID);
  assert.equal(canonical, `https://sync.example.invalid/t/task-linear-sync/x/${UUID}`);
  assert.deepEqual(parseAttachmentUrl(overridden, canonical), {
    kind: "canonical",
    baseHost: "https://sync.example.invalid",
    toolId: "task-linear-sync",
    taskUuid: UUID,
  });
  for (const page of [1, 5, 10]) {
    const url = continuationAttachmentUrl(overridden, UUID2, page);
    assert.deepEqual(parseAttachmentUrl(overridden, url), {
      kind: "continuation",
      baseHost: "https://sync.example.invalid",
      toolId: "task-linear-sync",
      taskUuid: UUID2,
      page,
    });
  }
});
