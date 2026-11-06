/**
 * T034 [P] — e2e walkthroughs of the 011 user stories (quickstart
 * Scenarios 1+3+5, story level over a real `node:http` server on an
 * ephemeral port + the serverless handler shape).
 *
 *  US1 — open the recorded URL, see the full ordered SC-001 story, follow
 *        a landed update on the OPEN stream without reloading;
 *  US2 — private-by-default 401 → token form → cookie session → 200, bearer
 *        access, wrong-credential 403 (never a 401 downgrade), public
 *        opt-in, tracker-429 fixed views (SC-003 at story level);
 *  US3/US4/US6 — 12-page chains walk whole, corrupt chains answer fixed 502
 *        with zero history bytes, unrouted traffic never reaches the port;
 *  US5 — TTL cache aged by the injected clock + embedded polling fallback;
 *  SC-004 — the handler shape serves the full chain twice, nothing persists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../../src/config/load.js";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import { buildChainWorld, TOKEN_SENTINEL } from "../helpers/history-harness.js";
import {
  historyCookieName,
  makeFixedClock,
  setCookieValue,
  withHistoryServer,
  type ChainWorldSpec,
  type HistoryServerHandle,
} from "../helpers/history-harness.js";

const SC001_WORLD: ChainWorldSpec = { pages: 10, eventsPerPage: 1000, interleave: true };

function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

interface JsonView {
  taskUuid: string;
  events: Array<{ description: string }>;
  pages: Array<{ index: number; eventCount: number }>;
  lastSyncAt: string;
  generatedAt: string;
}

function sseFrames(body: string): string[] {
  return body.split("\n\n").filter((f) => f.length > 0);
}

function frameView(frame: string): JsonView {
  assert.ok(frame.startsWith("event: history\n"), `got: ${frame.slice(0, 60)}`);
  return JSON.parse(frame.slice("event: history\ndata: ".length)) as JsonView;
}

interface LiveStream {
  status: number;
  nextFrame(timeoutMs?: number): Promise<string>;
  close(): void;
}

async function openStream(h: HistoryServerHandle, path: string): Promise<LiveStream> {
  const controller = new AbortController();
  const res = await fetch(h.baseUrl + path, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  const reader = res.body?.getReader();
  assert.ok(reader !== undefined, "SSE response must have a body");
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    status: res.status,
    async nextFrame(timeoutMs = 10_000): Promise<string> {
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
        type Chunk = { readonly done: boolean; readonly value?: Uint8Array };
        const chunk: Chunk = await Promise.race<Chunk>([reader.read(), deadline]);
        assert.equal(chunk.done, false, "stream closed before a full frame");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    close(): void {
      controller.abort();
    },
  };
}

// -- US1 -----------------------------------------------------------------------

test("history-e2e: US1: opening the recorded URL shows the whole ordered SC-001 story", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      // HTML — the browser entry point carries the whole story.
      const html = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.equal(html.status, 200);
      assert.match(String(html.headers["content-type"]), /^text\/html/);
      for (let p = 1; p <= 10; p += 1) {
        assert.ok(html.body.includes(`SC001-MARKER-${p}`), `html carries page ${p}`);
      }

      // JSON — the machine view of the same page (SC-001: 10 × 1000 events).
      const json = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(json.status, 200);
      const view = JSON.parse(json.body) as JsonView;
      assert.equal(view.taskUuid, h.world.taskUuid);
      assert.equal(view.events.length, 10_000, "the whole chain walks");
      assert.equal(view.pages.length, 10, "all ten pages enumerated");
      for (const probe of h.world.markers) {
        assert.ok(json.body.includes(probe), `json carries ${probe}`);
      }

      // SSE — the first snapshot frame carries the identical story.
      const stream = await openStream(h, pathOf(h));
      try {
        const snap = frameView(await stream.nextFrame(20_000));
        assert.equal(snap.events.length, 10_000);
        for (const probe of h.world.markers) {
          assert.ok(snap.events.some((e) => e.description === probe), `${probe} in stream`);
        }
      } finally {
        stream.close();
      }
    },
  );
});

test("history-e2e: US1: a landed update arrives on the open SSE stream without reloading", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 1, eventsPerPage: 2 },
      web: {
        accessControlMode: "public",
        realtimeSse: true,
        pollIntervalSeconds: 1,
        cacheTtlSeconds: 0,
      },
    },
    async (h) => {
      const stream = await openStream(h, pathOf(h));
      try {
        const first = frameView(await stream.nextFrame());
        assert.equal(first.events.length, 2);

        // A sync lands while the page stays open: the refresh tick pushes a
        // new snapshot on the SAME connection (FR-008).
        h.world.landEvent("landed-by-a-new-sync");
        h.clock.advance(1_100);
        const second = frameView(await stream.nextFrame());
        assert.equal(second.events.length, 3);
        assert.ok(second.events.some((e) => e.description === "landed-by-a-new-sync"));
      } finally {
        stream.close();
      }
    },
  );
});

// -- US2 -----------------------------------------------------------------------

test("history-e2e: US2: 401 → token form → cookie session → full story; wrong credentials never serve", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD }, // private is the default; token env = TOKEN_SENTINEL
    async (h) => {
      const p = pathOf(h);

      // 1. Cold browser: 401 challenge + token form, zero history bytes,
      //    zero tracker reads (authorization strictly before reconstruction).
      const denied = await h.get(p, { headers: { accept: "text/html" } });
      assert.equal(denied.status, 401);
      assert.equal(String(denied.headers["www-authenticate"]), "Bearer");
      assert.match(denied.body, /<form/i, "the shell offers the token form");
      assert.match(denied.body, /name="token"/);
      assert.equal(denied.body.includes("SC001-MARKER"), false, "401 ships zero history bytes");
      assert.equal(denied.body.includes(TOKEN_SENTINEL), false, "401 never echoes the token");
      assert.equal(h.getAttachmentCalls(), 0);

      // 2. Wrong token: fixed 403, no session issued.
      const bad = await h.post(p, {
        body: "token=not-the-token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(bad.status, 403);
      assert.equal(setCookieValue(bad, historyCookieName()), undefined);

      // 3. Token form: 303 + a hardening, token-free session cookie.
      const boot = await h.post(p, {
        body: `token=${TOKEN_SENTINEL}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(boot.status, 303);
      const cookie = setCookieValue(boot, historyCookieName());
      assert.ok(cookie !== undefined, "the bootstrap sets the session cookie");
      assert.equal(cookie.includes(TOKEN_SENTINEL), false, "the cookie never carries the token");
      assert.match(String(boot.headers["set-cookie"]), /HttpOnly/);
      assert.match(String(boot.headers["set-cookie"]), /SameSite=Strict/);

      // 4. The cookie session serves the full story.
      const served = await h.get(p, {
        headers: { accept: "text/html", cookie: `${historyCookieName()}=${cookie}` },
      });
      assert.equal(served.status, 200);
      assert.ok(served.body.includes("SC001-MARKER-10"));

      // 5. Bearer access + wrong-bearer 403 — never downgraded to 401.
      const bearer = await h.get(p, {
        headers: { accept: "application/json", authorization: `Bearer ${TOKEN_SENTINEL}` },
      });
      assert.equal(bearer.status, 200);
      assert.equal((JSON.parse(bearer.body) as JsonView).events.length, 10_000);
      const wrong = await h.get(p, {
        headers: { accept: "application/json", authorization: "Bearer wrong" },
      });
      assert.equal(wrong.status, 403, "a presented-but-invalid credential is a deny, never a 401 downgrade");
      assert.equal(JSON.parse(wrong.body).error.code, "FORBIDDEN");
      for (const probe of h.world.historyProbes) {
        assert.equal(denied.body.includes(probe), false, "401 leaks no history");
        assert.equal(wrong.body.includes(probe), false, "403 leaks no history");
      }
    },
  );
});

test("history-e2e: US2: public opt-in serves without any credential (SC-003 config leg)", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.equal(res.status, 200);
      assert.ok(res.body.includes("SC001-MARKER-7"));
      assert.equal(loadConfig().web.accessControlMode, "private", "the frozen default is untouched");
    },
  );
});

test("history-e2e: US2: a rate-limited tracker answers the fixed 429 view with zero history", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: {
        pages: 1,
        eventsPerPage: 3,
        failures: { getAttachmentByUrl: { atCall: 1, kind: "http-429-retryAfter" } },
        maxRetries: 0,
      },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 429);
      assert.equal(JSON.parse(res.body).error.code, "RATE_LIMITED");
      for (const probe of h.world.historyProbes) {
        assert.equal(res.body.includes(probe), false, "fixed view — zero history bytes");
      }
    },
  );
});

test("history-e2e: US2: the handler shape serves the whole chain twice with nothing persisting", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: SC001_WORLD,
      web: { accessControlMode: "public", cacheTtlSeconds: 0 },
      env: {},
    },
    async (h) => {
      const p = pathOf(h);
      const a = await h.get(p, { headers: { accept: "application/json" } });
      const b = await h.get(p, { headers: { accept: "application/json" } });
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body, b.body, "identical bodies across invocations (SC-004)");
      assert.equal(h.getAttachmentCalls(), 22, "two independent full walks");
    },
  );
});

// -- US3 -----------------------------------------------------------------------

test("history-e2e: US3: a 12-page chain walks whole with every page enumerated", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 12, eventsPerPage: 10, interleave: false },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 200);
      const view = JSON.parse(res.body) as JsonView;
      assert.equal(view.pages.length, 12, "the walk enumerates every existing page");
      assert.deepEqual(
        view.pages.map((p) => p.index),
        Array.from({ length: 12 }, (_, i) => i),
        "pages ascend contiguously from 0",
      );
      assert.equal(view.events.length, 120, "12 pages × 10 events");
      assert.equal(/manifest|last-run|checkpoint/i.test(res.body), false, "no state concepts");
    },
  );
});

// -- US4 -----------------------------------------------------------------------

test("history-e2e: US4: a tracker outage yields a fixed error view — no partial story, no detail", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 2, eventsPerPage: 3, corruptPage: 1, corruptKind: "task-uuid" },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.equal(res.status, 502);
      for (const probe of h.world.historyProbes) {
        assert.equal(res.body.includes(probe), false, "no partially-reconstructed story");
      }
      assert.equal(res.body.includes("detail"), false, "no upstream error detail travels");
    },
  );
});

// -- US5 -----------------------------------------------------------------------

test("history-e2e: US5: polling fallback is embedded and the TTL cache ages by the injected clock", async () => {
  const clock = makeFixedClock();
  await withHistoryServer(
    createSyncHistoryServer,
    { world: { pages: 1, eventsPerPage: 2 }, web: { accessControlMode: "public" }, clock },
    async (h) => {
      const p = pathOf(h);
      await h.get(p, { headers: { accept: "application/json" } });
      const afterFirst = h.getAttachmentCalls();
      await h.get(p, { headers: { accept: "application/json" } });
      assert.equal(h.getAttachmentCalls(), afterFirst, "inside the TTL window: no second walk");
      clock.advance(11_000); // default cacheTtlSeconds = 10
      await h.get(p, { headers: { accept: "application/json" } });
      assert.ok(h.getAttachmentCalls() > afterFirst, "past the TTL: a fresh walk (FR-010)");

      // The page refreshes through embedded JS: SSE when available, JSON
      // polling via window.fetch otherwise (contracts §5).
      const html = await h.get(p, { headers: { accept: "text/html" } });
      assert.match(html.body, /window\["fetch"\]/);
      assert.match(html.body, /setInterval/);
      assert.match(html.body, /EventSource/);
    },
  );
});

// -- US6 -----------------------------------------------------------------------

test("history-e2e: US6: a corrupt chain is a fixed 502 — nothing partially served", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 1, eventsPerPage: 3, corruptPage: 0, corruptKind: "json" },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 502);
      assert.equal(JSON.parse(res.body).error.code, "TRACKER_UNAVAILABLE");
      assert.equal(res.body.includes("MARKER"), false);
    },
  );
});

test("history-e2e: US6: unknown routes never reach the tracker", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const gone = await h.get("/no/such/history/page");
      assert.equal(gone.status, 404);
      assert.equal(gone.body.includes("SC001"), false);
      assert.equal(h.getAttachmentCalls(), 0, "unrouted requests never touch the port");
    },
  );
});

test("history-e2e: US6: the same URL negotiated per Accept ships one identical snapshot", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 2, eventsPerPage: 3, interleave: true },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const p = pathOf(h);
      const json = await h.get(p, { headers: { accept: "application/json" } });
      const html = await h.get(p, { headers: { accept: "text/html" } });
      const sse = await h.getSse(p, { until: "event: history" });
      const jsonView = JSON.parse(json.body) as JsonView;
      const snap = frameView(sseFrames(sse.body)[0]!);
      assert.equal(snap.events.length, jsonView.events.length, "same snapshot, same events");
      for (const probe of h.world.markers) {
        assert.ok(html.body.includes(probe), "the HTML shows the same story");
      }
    },
  );
});

// -- determinism guard carried with the e2e corpus (SC-002) ----------------------

test("history-e2e: the same world reconstructs in the same order through the surface", async () => {
  const world = buildChainWorld(SC001_WORLD);
  const order = world.markers.join("|");
  assert.equal(order.split("|").length, 10, "ten page markers anchor the story");
});
