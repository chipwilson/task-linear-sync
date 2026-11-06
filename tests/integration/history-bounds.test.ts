/**
 * T018 (feature 014) — history-server resource bounds over the REAL transport
 * (quickstart Scenario 2; contracts/resource-bounds.md §2–§4, SC-002/SC-003):
 *
 *  - LRU fan-out: `maxCacheEntries: 4` evicts (loader-call evidence) while every
 *    response stays byte-identical to the unbounded control run;
 *  - walk admission: the (maxConcurrentWalks+1)-th concurrent cache-miss leader
 *    gets the existing 429 RATE_LIMITED envelope + `Retry-After: 1` and ZERO
 *    history bytes; cache hits and single-flight followers are never refused;
 *  - SSE join admission: over-limit joins are refused before the stream opens
 *    and never counted (a closed stream frees its slot);
 *  - `Last-Event-ID` is IGNORED: the stream carries the full current chain;
 *  - `secureCookies: true` appends `; Secure`; the default cookie string is the
 *    exact 011-merged value byte-for-byte.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { LinearPort } from "../../src/ports/linear-port.js";
import type { SyncStatePayload } from "../../src/domain/state-payload.js";
import { serializeSyncStatePayload } from "../../src/domain/state-payload.js";
import { builtInDefaults } from "../../src/config/defaults.js";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import { canonicalAttachmentUrl } from "../../src/urls/attachment-url.js";
import type { FakeLinearPort } from "../../src/tracker/testing/fake-port.js";
import { syntheticUuid } from "../../src/tracker/testing/fake-port.js";
import type { HistoryServerHandle } from "../helpers/history-harness.js";
import { historyCookieName, TOKEN_SENTINEL, withHistoryServer } from "../helpers/history-harness.js";

const JSON_HEADERS = { accept: "application/json" };
const BEARER = { authorization: `Bearer ${TOKEN_SENTINEL}` };
const NS_KEY = builtInDefaults.metadataNamespaceKey as string;

const RATE_LIMITED_BODY = JSON.stringify({
  error: { code: "RATE_LIMITED", message: "history: the tracker is rate limiting reads; try again later" },
});

/** Seed a canonical (page-0-only) attachment for an extra task; returns its URL. */
function seedTask(h: HistoryServerHandle, taskUuid: string): string {
  const url = canonicalAttachmentUrl(h.world.urlConfig, taskUuid);
  const payload: SyncStatePayload = {
    taskUuid,
    frameworkMetadata: {
      frameworkId: "spec-kit",
      featureName: "placeholder-bounds",
      filePath: "specs/placeholder/story-bound.md",
      localTaskId: "PHB-1",
    },
    descriptionContentHash: "0".repeat(64),
    cursors: { lastSyncAt: new Date(Date.UTC(2026, 1, 1, 10, 0, 0)).toISOString() },
    history: [
      { kind: "matched", at: new Date(Date.UTC(2026, 1, 1, 10, 0, 0)).toISOString(), description: `bounds event ${taskUuid}` },
    ],
  };
  h.world.fake.world.attachments.set(`att-bounds-${taskUuid}`, {
    id: `att-bounds-${taskUuid}`,
    issueId: "I-hist",
    url,
    title: "task-linear-sync state",
    metadata: { [NS_KEY]: serializeSyncStatePayload(payload) },
  });
  return url;
}

const pathOf = (url: string): string => new URL(url).pathname;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── SC-002 — bounded fan-out vs unbounded control, byte-identical responses ──

test("bounds: fan-out at maxCacheEntries 4 evicts yet stays byte-identical to the control run", async () => {
  const uuids = Array.from({ length: 50 }, (_, i) => syntheticUuid(600 + i));

  async function fanOut(maxCacheEntries: number): Promise<{
    bodies: string[];
    revisitBodies: string[];
    callsAfterFirstPass: number;
    callsAfterRevisit: number;
  }> {
    let out: { bodies: string[]; revisitBodies: string[]; callsAfterFirstPass: number; callsAfterRevisit: number } | undefined;
    await withHistoryServer(
      createSyncHistoryServer,
      { web: { accessControlMode: "public", maxCacheEntries } },
      async (h) => {
        const urls = uuids.map((u) => seedTask(h, u));
        const bodies: string[] = [];
        for (const url of urls) {
          const res = await h.get(pathOf(url), { headers: JSON_HEADERS });
          assert.equal(res.status, 200, `public GET ${url} ⇒ 200`);
          bodies.push(res.body);
        }
        const callsAfterFirstPass = h.getAttachmentCalls();
        const revisitBodies: string[] = [];
        for (const url of urls.slice(0, 3)) {
          const res = await h.get(pathOf(url), { headers: JSON_HEADERS });
          assert.equal(res.status, 200);
          revisitBodies.push(res.body);
        }
        out = { bodies, revisitBodies, callsAfterFirstPass, callsAfterRevisit: h.getAttachmentCalls() };
      },
    );
    assert.ok(out !== undefined);
    return out;
  }

  const bounded = await fanOut(4);
  const control = await fanOut(100_000);

  for (let i = 0; i < uuids.length; i += 1) {
    assert.equal(bounded.bodies[i], control.bodies[i], `response bytes drift for ${uuids[i]} (SC-002)`);
  }
  for (let i = 0; i < 3; i += 1) {
    assert.equal(bounded.revisitBodies[i], bounded.bodies[i], "evicted revisit still byte-identical");
    assert.equal(control.revisitBodies[i], control.bodies[i], "control revisit byte-identical");
  }
  // Eviction evidence (size ≤ 4 is never observable directly — the loader is):
  // bounded revisits re-walk; the control's first three are still cached hits.
  assert.ok(
    bounded.callsAfterRevisit > bounded.callsAfterFirstPass,
    "bounded run must re-walk evicted tasks (retention really bounded)",
  );
  assert.equal(control.callsAfterRevisit, control.callsAfterFirstPass, "control run revisits from cache");
});

// ── walk admission (resource-bounds.md §3) ───────────────────────────────────

interface GateState {
  urls: Set<string>;
  promise: Promise<void>;
  resolve: () => void;
}

test("bounds: walk admission refuses the over-limit leader with 429 + Retry-After, never hits/followers", async () => {
  const uuids = Array.from({ length: 6 }, (_, i) => syntheticUuid(700 + i));
  let gate: GateState | undefined;
  let gatedHits = 0;
  const urlsSeen: string[] = [];

  const wrapPort = (fake: FakeLinearPort): LinearPort => ({
    ...fake,
    async getAttachmentByUrl(url: string) {
      urlsSeen.push(url);
      if (gate !== undefined && gate.urls.has(url)) {
        gatedHits += 1;
        await gate.promise;
      }
      return fake.getAttachmentByUrl(url);
    },
  });

  const hold = (urls: string[]): void => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    gate = { urls: new Set(urls), promise, resolve };
  };
  const release = async (): Promise<void> => {
    gate?.resolve();
    gate = undefined;
    await sleep(10);
  };
  const waitForGatedWalks = async (count: number): Promise<void> => {
    for (let i = 0; i < 200; i += 1) {
      if (gatedHits >= count) return;
      await sleep(5);
    }
    throw new Error(`only ${gatedHits}/${count} walks reached the gate`);
  };

  await withHistoryServer(
    createSyncHistoryServer,
    { web: { accessControlMode: "public", maxConcurrentWalks: 2 }, wrapPort },
    async (h) => {
      const urls = uuids.map((u) => seedTask(h, u));

      // Two stalled leaders saturate the bound (walkUrls: uuid[0], uuid[1]).
      hold([urls[0]!, urls[1]!]);
      const first = h.get(pathOf(urls[0]!), { headers: JSON_HEADERS });
      const second = h.get(pathOf(urls[1]!), { headers: JSON_HEADERS });
      await waitForGatedWalks(2);

      // Third cache-miss leader: refused at admission — never reaches the port.
      const seenBefore = urlsSeen.length;
      const refused = await h.get(pathOf(urls[2]!), { headers: JSON_HEADERS });
      assert.equal(refused.status, 429);
      assert.equal(refused.headers["retry-after"], "1");
      assert.equal(refused.body, RATE_LIMITED_BODY, "existing envelope, body unchanged");
      assert.equal(urlsSeen.length, seenBefore, "refused request probed the tracker ZERO times");
      for (const probe of [`bounds event ${uuids[2]}`]) {
        assert.equal(refused.body.includes(probe), false, "zero history bytes on the 429");
      }

      // A single-flight FOLLOWER for an in-flight key is never refused.
      const follower = h.get(pathOf(urls[0]!), { headers: JSON_HEADERS });
      await release();
      const [r1, r2, r4] = await Promise.all([first, second, follower]);
      for (const r of [r1, r2, r4]) {
        assert.equal(r.status, 200, "leaders and the follower all complete after release");
      }

      // Saturate again with two NEW leaders; a fresh CACHE HIT and a follower
      // still pass while the bound is full.
      hold([urls[3]!, urls[4]!]);
      const third = h.get(pathOf(urls[3]!), { headers: JSON_HEADERS });
      const fourth = h.get(pathOf(urls[4]!), { headers: JSON_HEADERS });
      await waitForGatedWalks(4);

      const hit = await h.get(pathOf(urls[0]!), { headers: JSON_HEADERS });
      assert.equal(hit.status, 200, "cache hits are never refused at admission");
      assert.equal(hit.headers["x-history-cache"], "hit");

      const refused2 = await h.get(pathOf(urls[5]!), { headers: JSON_HEADERS });
      assert.equal(refused2.status, 429);
      assert.equal(refused2.headers["retry-after"], "1");

      await release();
      await Promise.all([third, fourth]);
    },
  );
});

// ── SSE join admission ───────────────────────────────────────────────────────

test("bounds: the over-limit SSE join gets 429 + Retry-After before opening, and closed streams free slots", async () => {
  const openStreams: AbortController[] = [];
  try {
    await withHistoryServer(
      createSyncHistoryServer,
      { web: { accessControlMode: "public", maxConcurrentSseStreams: 2 } },
      async (h) => {
        const urls = [seedTask(h, syntheticUuid(800)), seedTask(h, syntheticUuid(801)), seedTask(h, syntheticUuid(802))];

        /** Join as SSE; 200 ⇒ reads the first frame and KEEPS the stream open. */
        const join = async (
          url: string,
        ): Promise<{ status: number; body: string; headers: Headers; keep?: AbortController }> => {
          const controller = new AbortController();
          const res = await fetch(h.baseUrl + pathOf(url), {
            headers: { accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (res.status === 200) {
            const reader = res.body?.getReader();
            assert.ok(reader !== undefined);
            const { value } = await reader.read();
            const head = new TextDecoder().decode(value);
            assert.ok(head.includes("event: history"), "first frame arrived — stream open");
            return { status: 200, body: head, headers: res.headers, keep: controller };
          }
          const body = await res.text();
          controller.abort(); // error responses are complete; release the socket
          return { status: res.status, body, headers: res.headers };
        };

        const first = await join(urls[0]!);
        const second = await join(urls[1]!);
        openStreams.push(first.keep!, second.keep!);

        const refused = await join(urls[2]!);
        assert.equal(refused.status, 429, "third join over the bound is refused");
        assert.equal(refused.headers.get("retry-after"), "1");
        assert.equal(refused.body, `event: error\ndata: ${RATE_LIMITED_BODY}\n\n`);
        assert.equal(refused.body.includes("bounds event"), false, "zero history bytes on the refused join");

        // Closing the two streams frees both slots — the refused task then joins.
        for (const controller of openStreams.splice(0)) controller.abort();
        let joined = false;
        for (let i = 0; i < 100 && !joined; i += 1) {
          const attempt = await join(urls[2]!);
          assert.ok(attempt.status === 200 || attempt.status === 429, `unexpected ${attempt.status}`);
          if (attempt.status === 200) {
            if (attempt.keep !== undefined) openStreams.push(attempt.keep);
            joined = true;
          } else {
            await sleep(10);
          }
        }
        assert.ok(joined, "closed streams were never counted — the slot came free");
      },
    );
  } finally {
    for (const controller of openStreams) controller.abort();
  }
});

// ── Last-Event-ID is ignored (resource-bounds.md §6) ─────────────────────────

test("bounds: a reconnect naming Last-Event-ID still receives the full current stream", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { web: { accessControlMode: "public" } },
    async (h) => {
      const path = new URL(h.world.addressOf(0)).pathname;
      const plain = await h.getSse(path, { until: "event: history" });
      const resumed = await h.getSse(path, { until: "event: history", headers: { "last-event-id": "99" } });
      assert.equal(resumed.status, 200, "Last-Event-ID never errors — the header is ignored");
      assert.equal(resumed.head, plain.head, "every stream starts with the full current chain");
      assert.equal(resumed.head.includes("event: error"), false);
    },
  );
});

// ── Secure cookie (resource-bounds.md §4) ────────────────────────────────────

const COOKIE_NAME = historyCookieName();

async function bootstrapCookie(secureCookies?: boolean): Promise<string> {
  let cookie = "";
  await withHistoryServer(
    createSyncHistoryServer,
    { web: secureCookies === undefined ? {} : { secureCookies } },
    async (h) => {
      const path = new URL(h.world.addressOf(0)).pathname;
      const res = await h.post(path, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${TOKEN_SENTINEL}`,
      });
      assert.equal(res.status, 303);
      const raw = res.headers["set-cookie"];
      cookie = Array.isArray(raw) ? raw[0]! : String(raw);
      assert.ok(cookie.startsWith(`${COOKIE_NAME}=`), "bootstrap issued the session cookie");
    },
  );
  return cookie;
}

test("bounds: the default Set-Cookie is the exact 011-merged string byte-for-byte", async () => {
  const cookie = await bootstrapCookie();
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=[^;]+; Path=/; HttpOnly; SameSite=Strict$`));
  assert.equal(cookie.includes("Secure"), false);
});

test("bounds: secureCookies true appends `; Secure` after the unchanged base", async () => {
  const cookie = await bootstrapCookie(true);
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=[^;]+; Path=/; HttpOnly; SameSite=Strict; Secure$`));
});

test("bounds: private mode is unaffected otherwise — bearer still required", async () => {
  await withHistoryServer(createSyncHistoryServer, {}, async (h) => {
    const path = new URL(h.world.addressOf(0)).pathname;
    const anonymous = await h.get(path, { headers: JSON_HEADERS });
    assert.equal(anonymous.status, 401);
    const authed = await h.get(path, { headers: { ...JSON_HEADERS, ...BEARER } });
    assert.equal(authed.status, 200);
  });
});
