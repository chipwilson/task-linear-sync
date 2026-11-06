/**
 * Feature 011 (Sync-History Web Component) — T016: SSE + polling-fallback
 * integration (spec user-story-1 "stays current"; contracts/http-surface.md §3).
 *
 * `pollIntervalSeconds: 1` keeps the real refresh timer aligned with the
 * fixed test clock; frames flow immediately, on change, and as `: ping`
 * comments when nothing changed. Socket-close cleanup is asserted at module
 * level with stub req/res pairs (no listener involved — SC-004 posture).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSyncHistoryServer } from "../../src/history-server/create.js";
import { reconstructHistory } from "../../src/history-server/reconstruct.js";
import { startSseStream } from "../../src/history-server/sse.js";
import { loadConfig } from "../../src/config/load.js";
import { createDefaultSecurityScreener } from "../../src/engine/screening.js";
import {
  HISTORY_TASK_UUID,
  buildChainWorld,
  makeFixedClock,
  makeStubPair,
  withHistoryServer,
  type ChainWorldSpec,
  type HistoryServerHandle,
} from "../helpers/history-harness.js";

const LIVE_WORLD: ChainWorldSpec = { pages: 1, eventsPerPage: 3 };
const WEB = { accessControlMode: "public", realtimeSse: true, pollIntervalSeconds: 1, cacheTtlSeconds: 0 } as const;

function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

interface LiveStream {
  status: number;
  headers: Record<string, string>;
  nextFrame(timeoutMs?: number): Promise<string>;
  close(): void;
}

async function openStream(h: HistoryServerHandle, path: string): Promise<LiveStream> {
  const controller = new AbortController();
  const res = await fetch(h.baseUrl + path, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const reader = res.body?.getReader();
  assert.ok(reader !== undefined, "SSE response must have a body");
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    status: res.status,
    headers,
    async nextFrame(timeoutMs = 10000): Promise<string> {
      const deadline = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error("SSE frame timed out")), timeoutMs);
        t.unref?.();
      });
      for (;;) {
        const sep = buffer.indexOf("\n\n");
        if (sep >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          return frame;
        }
        const { done, value } = await Promise.race([reader!.read(), deadline]);
        assert.ok(!done, "SSE stream closed before a frame arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close(): void {
      controller.abort();
    },
  };
}

test("history-sse: SSE: headers flush immediately and the first frame carries the full view", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: LIVE_WORLD, web: WEB }, async (h) => {
    const stream = await openStream(h, pathOf(h));
    try {
      assert.equal(stream.status, 200);
      assert.match(stream.headers["content-type"] ?? "", /text\/event-stream/);
      assert.equal(stream.headers["cache-control"], "no-store");
      const frame = await stream.nextFrame();
      assert.ok(frame.startsWith("event: history\n"), `got: ${frame.slice(0, 60)}`);
      const view = JSON.parse(frame.slice("event: history\ndata: ".length)) as {
        taskUuid: string;
        events: unknown[];
      };
      assert.equal(view.taskUuid, HISTORY_TASK_UUID);
      assert.equal(view.events.length, 3);
    } finally {
      stream.close();
    }
  });
});

test("history-sse: SSE: a newly landed event arrives on a later frame without reloading", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: LIVE_WORLD, web: WEB }, async (h) => {
    const stream = await openStream(h, pathOf(h));
    try {
      await stream.nextFrame();
      h.world.landEvent("live arrival event");
      h.clock.advance(1_100); // past the 1s refresh gate → next tick re-reads
      const frame = await stream.nextFrame();
      assert.ok(frame.startsWith("event: history\n"));
      const view = JSON.parse(frame.slice("event: history\ndata: ".length)) as {
        events: Array<{ description: string }>;
      };
      assert.equal(view.events.length, 4);
      assert.ok(view.events.some((event) => event.description === "live arrival event"));
    } finally {
      stream.close();
    }
  });
});

test("history-sse: SSE: unchanged refresh ticks emit ping comments, not duplicate frames", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: LIVE_WORLD, web: WEB }, async (h) => {
    const stream = await openStream(h, pathOf(h));
    try {
      await stream.nextFrame();
      h.clock.advance(1_100);
      const frame = await stream.nextFrame();
      assert.ok(frame.startsWith(": ping"), `expected a ping comment, got: ${frame}`);
      // and the stream is still healthy: another landing produces a real frame
      h.world.landEvent("after ping");
      h.clock.advance(1_100);
      const next = await stream.nextFrame();
      assert.ok(next.startsWith("event: history\n"));
      assert.ok(next.includes("after ping"));
    } finally {
      stream.close();
    }
  });
});

test("history-sse: SSE: an immediate upstream failure answers the negotiated error shape", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: {
        ...LIVE_WORLD,
        failures: { getAttachmentByUrl: { atCall: 1, kind: "http-429-retryAfter" } },
        maxRetries: 0,
      },
      web: WEB,
    },
    async (h) => {
      const res = await fetch(h.baseUrl + pathOf(h), {
        headers: { accept: "text/event-stream" },
      });
      assert.equal(res.status, 429);
      const body = await res.text();
      assert.ok(body.includes("event: error"), "SSE-negotiated errors render as error frames");
      assert.ok(!body.includes("sync event"), "zero history bytes on error");
    },
  );
});

test("history-sse: SSE: when realtimeSse is disabled the Accept degrades to the HTML posture", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: LIVE_WORLD,
      web: { ...WEB, realtimeSse: false },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "text/event-stream" } });
      assert.equal(res.status, 200);
      assert.match(String(res.headers["content-type"] ?? ""), /text\/html/);
    },
  );
});

test("history-sse: polling fallback: JSON re-reads pick up newly landed events", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: LIVE_WORLD, web: WEB }, async (h) => {
    const first = await h.get(pathOf(h), { headers: { accept: "application/json" } });
    assert.equal(first.status, 200);
    assert.equal((JSON.parse(first.body).events as unknown[]).length, 3);

    h.world.landEvent("polled arrival");
    const second = await h.get(pathOf(h), { headers: { accept: "application/json" } });
    const view = JSON.parse(second.body) as { events: Array<{ description: string }> };
    assert.equal(view.events.length, 4);
    assert.ok(view.events.some((event) => event.description === "polled arrival"));
  });
});

test("history-sse: SSE: refreshSeconds is honored at the 1 and 3600 bounds", async () => {
  for (const seconds of [1, 3600]) {
    await withHistoryServer(
      createSyncHistoryServer,
      { world: LIVE_WORLD, web: { ...WEB, pollIntervalSeconds: seconds } },
      async (h) => {
        assert.equal(h.app.settings.refreshSeconds, seconds);
      },
    );
  }
});

test("history-sse: SSE module: closing the socket stops the refresh timer and ends the response", async () => {
  const world = buildChainWorld(LIVE_WORLD);
  const config = loadConfig({});
  const clock = makeFixedClock();
  const stub = makeStubPair({
    method: "GET",
    url: new URL(world.canonicalUrl).pathname,
    headers: { accept: "text/event-stream" },
  });
  let loads = 0;
  const stream = startSseStream({
    res: stub.res,
    taskUuid: HISTORY_TASK_UUID,
    refreshSeconds: 1,
    clock,
    initialView: await reconstructHistory(
      { port: world.fake, config, clock, screener: createDefaultSecurityScreener(config) },
      HISTORY_TASK_UUID,
    ),
    loadView: async () => {
      loads += 1;
      return reconstructHistory(
        { port: world.fake, config, clock, screener: createDefaultSecurityScreener(config) },
        HISTORY_TASK_UUID,
      );
    },
  });
  const first = await stream.firstFrame;
  assert.ok(first.startsWith("event: history\n"));

  // a tick past the refresh gate re-reads at most once per gate
  clock.advance(1_100);
  await new Promise((resolve) => setTimeout(resolve, 1_300));
  assert.ok(loads <= 2, `refresh re-reads gated by the clock (loads=${String(loads)})`);

  // client disconnect → server stops writing and closes the stream
  stub.res.emit("close");
  await stream.done;
  const loadsAtClose = loads;
  clock.advance(60_000);
  await new Promise((resolve) => setTimeout(resolve, 1_300));
  assert.equal(loads, loadsAtClose, "no reads after the socket closed");
  const written = await stub.finished;
  assert.ok(written.body.includes("event: history"));
});
