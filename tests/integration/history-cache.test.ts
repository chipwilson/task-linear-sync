/**
 * T026 — integration proof of the non-authoritative cache (US2 AC2, FR-006):
 * a second read inside the TTL window is served from cache (fake-port call
 * count frozen, `X-History-Cache: hit`), expiry re-reads, `cacheTtlSeconds: 0`
 * re-reads every time, and concurrent misses coalesce to a single walk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import type { ChainWorldSpec, HistoryServerHandle } from "../helpers/history-harness.js";
import { withHistoryServer } from "../helpers/history-harness.js";

const WORLD: ChainWorldSpec = { pages: 2, eventsPerPage: 4 };

function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

const JSON_HEADERS = { accept: "application/json" };

test("history-cache: US2: a second read inside the TTL window is served from cache", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: WORLD, web: { accessControlMode: "public", cacheTtlSeconds: 10 } },
    async (h) => {
      const first = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(first.status, 200);
      assert.equal(first.headers["x-history-cache"], "miss");
      const probesAfterFirst = h.getAttachmentCalls();
      assert.equal(probesAfterFirst, 3, "walk: page 0, page 1, absence probe");

      const second = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(second.status, 200);
      assert.equal(second.headers["x-history-cache"], "hit");
      assert.equal(second.body, first.body, "a cache hit ships the identical view");
      assert.equal(h.getAttachmentCalls(), probesAfterFirst, "a hit touches the port zero times");
      assert.notEqual(second.headers["x-history-age-ms"], undefined, "hits carry their age");

      // Advance past the TTL on the injected clock ⇒ the chain is re-read.
      h.clock.advance(11_000);
      const third = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(third.headers["x-history-cache"], "miss");
      assert.equal(h.getAttachmentCalls(), probesAfterFirst + 3);
    },
  );
});

test("history-cache: US2: cacheTtlSeconds 0 re-reads the chain on every request", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: WORLD, web: { accessControlMode: "public", cacheTtlSeconds: 0 } },
    async (h) => {
      const before = h.getAttachmentCalls();
      const first = await h.get(pathOf(h), { headers: JSON_HEADERS });
      const second = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(first.headers["x-history-cache"], "miss");
      assert.equal(second.headers["x-history-cache"], "miss");
      assert.equal(h.getAttachmentCalls() - before, 6, "two full walks");
    },
  );
});

test("history-cache: US2: five concurrent misses coalesce into exactly one walk", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: WORLD, web: { accessControlMode: "public", cacheTtlSeconds: 10 } },
    async (h) => {
      const before = h.getAttachmentCalls();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => h.get(pathOf(h), { headers: JSON_HEADERS })),
      );
      const bodies = new Set(results.map((r) => r.body));
      assert.equal(bodies.size, 1, "all five see the same view");
      for (const res of results) {
        assert.equal(res.status, 200);
      }
      assert.equal(
        h.getAttachmentCalls() - before,
        3,
        "single-flight: five concurrent readers, one chain walk",
      );
    },
  );
});

test("history-cache: US2: an upstream failure is never cached — the next read re-walks", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: {
        pages: 1,
        eventsPerPage: 2,
        failures: { getAttachmentByUrl: { atCall: 1, kind: "network" } },
        maxRetries: 0,
      },
      web: { accessControlMode: "public", cacheTtlSeconds: 10 },
    },
    async (h) => {
      const failing = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(failing.status, 502);
      assert.equal(failing.headers["x-history-cache"], undefined, "errors carry no cache header");

      const after = h.getAttachmentCalls();
      const again = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(again.status, 200, "the scripted failure fired once; the walk now succeeds");
      assert.equal(again.headers["x-history-cache"], "miss");
      assert.ok(h.getAttachmentCalls() > after);
    },
  );
});
