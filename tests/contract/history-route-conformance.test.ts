/**
 * T006 — router/builders conformance (contracts/attachment-url-scheme.md
 * behavior rule 4): every URL the frozen builders emit must route back to
 * its (kind, taskUuid[, page]) through `parseHistoryRoute`, under both the
 * DEFAULT templates and overridden templates; near-miss corpora never match.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigOverrides, ResolvedConfig } from "../../src/config/schema.js";
import { parseHistoryRoute } from "../../src/history-server/routes.js";
import { syntheticUuid } from "../../src/tracker/testing/fake-port.js";
import { canonicalAttachmentUrl, continuationAttachmentUrl } from "../../src/urls/attachment-url.js";

function pathOf(config: ResolvedConfig, url: string): string {
  const base = config.attachmentBaseHost.trim().replace(/\/+$/, "");
  assert.ok(url.startsWith(base), `fixture: ${url} starts with ${base}`);
  return url.slice(base.length);
}

const CONFIGS: ReadonlyArray<[string, ResolvedConfig]> = [
  ["default templates", loadConfig({})],
  [
    "overridden templates",
    loadConfig({
      overrides: {
        attachmentUrlTemplate: "{baseHost}/sync/{toolId}/task/{uuid}",
        continuationUrlTemplate: "{baseHost}/sync/{toolId}/task/{uuid}/p/{page}",
      } as ConfigOverrides,
    }),
  ],
];

for (const [label, config] of CONFIGS) {
  test(`${label}: builder output routes back identically (round-trip)`, () => {
    for (const uuid of [syntheticUuid(0), syntheticUuid(42)]) {
      const canonical = canonicalAttachmentUrl(config, uuid);
      assert.deepEqual(parseHistoryRoute(config, pathOf(config, canonical)), {
        kind: "match",
        taskUuid: uuid,
        page: 0,
      });
      for (const page of [1, 2, 9, 1000]) {
        const url = continuationAttachmentUrl(config, uuid, page);
        assert.deepEqual(parseHistoryRoute(config, pathOf(config, url)), {
          kind: "match",
          taskUuid: uuid,
          page,
        });
      }
    }
  });
}

const NEAR_MISSES: ReadonlyArray<(uuid: string, tool: string) => string> = [
  (uuid) => `/wrong-prefix/${uuid}`,
  (uuid, tool) => `/${tool}/${uuid.toUpperCase()}`,
  (uuid, tool) => `/${tool}/${uuid}/0`,
  (uuid, tool) => `/${tool}/${uuid}/-1`,
  (uuid, tool) => `/${tool}/${uuid}/1.5`,
  (uuid, tool) => `/${tool}/${uuid}/extra/segment`,
  () => `/${"x".repeat(8)}`,
  (uuid, tool) => `/${tool}/${uuid.slice(0, -1)}z`,
];

for (const [label, config] of CONFIGS) {
  test(`${label}: near-miss corpus never routes`, () => {
    const uuid = syntheticUuid(7);
    for (const build of NEAR_MISSES) {
      const path = build(uuid, config.toolId);
      assert.deepEqual(parseHistoryRoute(config, path), { kind: "notFound" }, `path: ${path}`);
    }
  });
}

test("page beyond 1000 still routes (the walk bounds reads, not routes)", () => {
  const config = loadConfig({});
  const uuid = syntheticUuid(3);
  const url = continuationAttachmentUrl(config, uuid, 4321);
  const base = config.attachmentBaseHost;
  assert.deepEqual(parseHistoryRoute(config, url.slice(base.length)), {
    kind: "match",
    taskUuid: uuid,
    page: 4321,
  });
});
