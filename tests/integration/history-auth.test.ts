/**
 * T025 — integration tests for the US2 access gate (SC-003,
 * contracts/access-control.md §3): private by default — 401 before any
 * tracker probe, 403 on invalid credentials, POST token-form bootstrap ⇒
 * 303 + stateless cookie, bearer GET, public opt-in, and the 405 posture.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import type { ChainWorldSpec, HistoryServerHandle } from "../helpers/history-harness.js";
import {
  TOKEN_SENTINEL,
  historyCookieName,
  setCookieValue,
  withHistoryServer,
} from "../helpers/history-harness.js";

const WORLD: ChainWorldSpec = { pages: 2, eventsPerPage: 4 };

function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

function parseError(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return (parsed["error"] ?? {}) as Record<string, unknown>;
}

test("history-auth: US2: unauthenticated GET answers 401 without probing the tracker", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
    assert.equal(res.status, 401);
    assert.equal(String(res.headers["www-authenticate"] ?? ""), "Bearer");
    assert.equal(parseError(res.body)["code"], "UNAUTHORIZED");

    for (const probe of h.world.historyProbes) {
      assert.equal(res.body.includes(probe), false, `401 leaks history: ${probe}`);
    }
    assert.equal(h.getAttachmentCalls(), 0, "auth runs strictly before reconstruction");

    const html = await h.get(pathOf(h), { headers: { accept: "text/html" } });
    assert.equal(html.status, 401);
    assert.match(html.body, /<form/i, "401 shell offers the token-entry form");
    assert.match(html.body, /name="token"/);

    const sse = await h.getSse(pathOf(h), { until: "event: error", timeoutMs: 2500 });
    assert.equal(sse.status, 401);
    assert.match(sse.body, /event: error/);
    assert.equal(sse.body.includes(TOKEN_SENTINEL), false);
  });
});

test("history-auth: US2: a wrong bearer token answers 403 — zero history, zero probes", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    const res = await h.get(pathOf(h), {
      headers: { accept: "application/json", authorization: "Bearer definitely-not-the-token" },
    });
    assert.equal(res.status, 403);
    assert.equal(parseError(res.body)["code"], "FORBIDDEN");
    for (const probe of h.world.historyProbes) {
      assert.equal(res.body.includes(probe), false);
    }
    assert.equal(h.getAttachmentCalls(), 0);

    const cookieJunk = await h.get(pathOf(h), {
      headers: { accept: "application/json", cookie: `${historyCookieName()}=not-a-session` },
    });
    assert.equal(cookieJunk.status, 403, "invalid cookie ⇒ deny, never a 401 downgrade");
  });
});

test("history-auth: US2: POST token form bootstraps a session cookie that then serves the view", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    const name = historyCookieName();
    const post = await h.post(pathOf(h), {
      body: "token=ltnx-unknown-123",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(post.status, 403, "wrong form token ⇒ 403");
    assert.equal(setCookieValue(post, name), undefined, "no cookie on failure");

    const good = await h.post(pathOf(h), {
      body: `token=${TOKEN_SENTINEL}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(good.status, 303);
    const cookie = setCookieValue(good, name);
    assert.ok(cookie !== undefined, "Set-Cookie with the session name");
    assert.equal(cookie.includes(TOKEN_SENTINEL), false, "cookie carries no token");
    assert.match(String(good.headers["set-cookie"] ?? ""), /HttpOnly/);
    assert.match(String(good.headers["set-cookie"] ?? ""), /SameSite=Strict/);
    assert.match(String(good.headers["set-cookie"] ?? ""), /Path=\//);

    const view = await h.get(pathOf(h), {
      headers: { accept: "application/json", cookie: `${name}=${cookie}` },
    });
    assert.equal(view.status, 200);
    assert.ok(h.getAttachmentCalls() > 0, "the served view read the chain");
    const viewBody = JSON.parse(view.body) as Record<string, unknown>;
    assert.equal(viewBody["taskUuid"], h.world.taskUuid);
    assert.equal((viewBody["events"] as unknown[]).length, 8);
  });
});

test("history-auth: US2: an oversized POST body (above the 8 KB cap) is refused with 403", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    const res = await h.post(pathOf(h), {
      body: `token=${"x".repeat(9_000)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(res.status, 403);
    assert.equal(setCookieValue(res, historyCookieName()), undefined);
  });
});

test("history-auth: US2: a valid bearer GET serves the full view", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    const res = await h.get(pathOf(h), {
      headers: {
        accept: "application/json",
        authorization: "Bearer sentinel-HistDoNotLeak-7c4f9a2e18",
      },
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal((body["events"] as unknown[]).length, 8);
    assert.equal((body["pages"] as unknown[]).length, 2);
  });
});

test("history-auth: US2: public opt-in serves without credentials and refuses bootstrap POSTs", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 200);

      const surplus = await h.get(pathOf(h), {
        headers: { accept: "application/json", authorization: "Bearer whatever" },
      });
      assert.equal(surplus.status, 200, "public mode ignores credentials entirely");
      assert.equal(surplus.body, res.body);

      const post = await h.post(pathOf(h), {
        body: "token=anything",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(post.status, 405, "session bootstrap exists only in private mode");
    },
  );
});

test("history-auth: US2: methods other than GET/POST always answer 405", async () => {
  await withHistoryServer(createSyncHistoryServer, { world: WORLD }, async (h) => {
    for (const method of ["PUT", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await fetch(h.baseUrl + pathOf(h), {
        method,
        headers: { accept: "application/json" },
        redirect: "manual",
      });
      assert.equal(res.status, 405, `${method} ⇒ 405`);
      const text = method === "HEAD" ? "" : await res.text();
      if (method !== "HEAD") {
        assert.match(text, /METHOD_NOT_ALLOWED/);
        for (const probe of h.world.historyProbes) {
          assert.equal(text.includes(probe), false);
        }
      }
    }
    assert.equal(h.getAttachmentCalls(), 0);
  });
});
