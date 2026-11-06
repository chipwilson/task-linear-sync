/**
 * T027 — integration proof of the rate-limit posture (FR-007, US2 AC4):
 * the fake port's ultimate failures answer 429/502 from the fixed envelopes,
 * the component issues no retries of its own, `detail` never travels, and the
 * error bodies name no credential and ship zero history bytes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import type { ChainWorldSpec, HistoryServerHandle } from "../helpers/history-harness.js";
import { TOKEN_SENTINEL, withHistoryServer } from "../helpers/history-harness.js";

function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

const JSON_HEADERS = { accept: "application/json" };

/** A world whose very first page read hits an ultimate scripted failure. */
const FAILING_WORLD = (kind: "http-429-retryAfter" | "network" | "http-5xx"): ChainWorldSpec => ({
  pages: 1,
  eventsPerPage: 3,
  failures: { getAttachmentByUrl: { atCall: 1, kind } },
  maxRetries: 0,
});

function assertSanitizedError(body: string, code: string, message: string): void {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  assert.deepEqual(parsed, { error: { code, message } }, "fixed envelope, nothing else");
  for (const banned of [
    TOKEN_SENTINEL,
    "Bearer",
    "token",
    "TASK_LINEAR_SYNC",
    "retryAfter",
    "detail",
    "I-hist",
    "PHA-1",
    "sync event",
  ]) {
    assert.equal(body.includes(banned), false, `error body leaks ${JSON.stringify(banned)}`);
  }
}

test("history-rate-limit: US2: an ultimate rate-limit failure answers 429 with zero history", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: FAILING_WORLD("http-429-retryAfter"), web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(res.status, 429);
      assertSanitizedError(
        res.body,
        "RATE_LIMITED",
        "history: the tracker is rate limiting reads; try again later",
      );
      for (const probe of h.world.historyProbes) {
        assert.equal(res.body.includes(probe), false);
      }
      assert.equal(h.getAttachmentCalls(), 1, "the component retries nothing of its own");
      assert.equal(res.headers["x-history-cache"], undefined);
    },
  );
});

test("history-rate-limit: US2: an ultimate network failure answers 502 TRACKER_UNAVAILABLE", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: FAILING_WORLD("network"), web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(res.status, 502);
      assertSanitizedError(
        res.body,
        "TRACKER_UNAVAILABLE",
        "history: the tracker could not be reached to read the history chain",
      );
      assert.equal(h.getAttachmentCalls(), 1);
    },
  );
});

test("history-rate-limit: US2: a scripted 5xx failure also lands on TRACKER_UNAVAILABLE", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: FAILING_WORLD("http-5xx"), web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: JSON_HEADERS });
      assert.equal(res.status, 502);
      const parsed = JSON.parse(res.body) as { error: { code: string } };
      assert.equal(parsed.error.code, "TRACKER_UNAVAILABLE");
    },
  );
});

test("history-rate-limit: US2: HTML negotiation of an ultimate failure stays sanitized", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: FAILING_WORLD("http-429-retryAfter"), web: { accessControlMode: "public" } },
    async (h) => {
      const html = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.equal(html.status, 429);
      assert.match(html.body, /rate limiting/i);
      for (const probe of h.world.historyProbes) {
        assert.equal(html.body.includes(probe), false);
      }
    },
  );
});

test("history-rate-limit: US2: SSE negotiation of an ultimate failure answers an error frame", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: FAILING_WORLD("http-429-retryAfter"), web: { accessControlMode: "public" } },
    async (h) => {
      const sse = await h.get(pathOf(h), { headers: { accept: "text/event-stream" } });
      assert.equal(sse.status, 429);
      assert.match(sse.body, /^event: error$/m);
      assert.match(sse.body, /RATE_LIMITED/);
      for (const probe of h.world.historyProbes) {
        assert.equal(sse.body.includes(probe), false);
      }
    },
  );
});
