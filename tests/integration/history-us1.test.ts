/**
 * Feature 011 (Sync-History Web Component) — T015: US1 integration (spec
 * user-story-1: the full read-only journey through a running server).
 *
 * Public mode over `node:http` against the 007 fake port: the 10 000-event
 * SC-001 world renders as JSON and as HTML through the same code path,
 * continuation-page addresses serve the same whole-chain view, and missing
 * history answers 404 with zero history bytes in the body.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSyncHistoryServer } from "../../src/history-server/create.js";
import {
  HISTORY_OTHER_TASK_UUID,
  HISTORY_TASK_UUID,
  SECRET_SHAPE_VALUES,
  withHistoryServer,
  type ChainWorldSpec,
  type HistoryServerHandle,
  type HttpResult,
} from "../helpers/history-harness.js";

const SC001_WORLD: ChainWorldSpec = {
  pages: 10,
  eventsPerPage: 1000,
  interleave: true,
};

/** The routed request path for a world page (routing ignores Host, uses baseHost+path). */
function pathOf(h: HistoryServerHandle, page = 0): string {
  return new URL(h.world.addressOf(page)).pathname;
}

async function jsonOf(res: HttpResult): Promise<Record<string, unknown>> {
  assert.match(String(res.headers["content-type"] ?? ""), /application\/json/);
  return JSON.parse(res.body) as Record<string, unknown>;
}

test("history-us1: US1: the full SC-001 history arrives as JSON through the running server", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 200);
      assert.equal(res.headers["cache-control"], "no-store");
      const view = await jsonOf(res);

      assert.equal(view.taskUuid, HISTORY_TASK_UUID);
      assert.equal((view.pages as unknown[]).length, 10);
      const events = view.events as Array<Record<string, unknown>>;
      assert.equal(events.length, 10000, "SC-001: every event present");
      assert.equal(view.lastSyncAt, "2026-01-15T08:00:00.000Z");

      let prev = 0;
      let markers = 0;
      for (const event of events) {
        const at = Date.parse(String(event["at"]));
        assert.ok(at >= prev, "exact chronological order");
        prev = at;
        if (String(event["description"]).startsWith("SC001-MARKER-")) {
          markers += 1;
          assert.equal(event["kind"], "rollback");
        }
      }
      assert.equal(markers, 10, "every 1000th event is a marker, none lost");
      const marker2 = events.find((event) => event["description"] === "SC001-MARKER-2");
      assert.ok(marker2 !== undefined);
      assert.deepEqual(marker2["references"], ["op-1999"], "references pass through");
    },
  );
});

test("history-us1: secret-shaped event content ships screened over the wire", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: { pages: 1, eventsPerPage: 2, secretShape: true }, web: { accessControlMode: "public" } },
    async (h) => {
      for (const accept of ["application/json", "text/html"]) {
        const res = await h.get(pathOf(h), { headers: { accept } });
        assert.equal(res.status, 200);
        for (const secret of Object.values(SECRET_SHAPE_VALUES)) {
          assert.ok(!res.body.includes(secret), `${accept} leaked a secret-shaped value`);
        }
        assert.ok(res.body.includes("[blocked:"), "blocked content replaced by sentinel");
        assert.ok(res.body.includes("sync event 1 page 0"), "benign events render normally");
      }
    },
  );
});

test("history-us1: US1: the same address renders the complete story as HTML", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), {
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      assert.equal(res.status, 200);
      assert.match(String(res.headers["content-type"] ?? ""), /text\/html/);

      assert.ok(res.body.includes("<!doctype html>"));
      assert.ok(res.body.includes("10000"), "the event count is shown");
      assert.ok(res.body.includes('data-kind="rollback"'), "rollback rows styled like others");
      assert.ok(res.body.includes("2026-01-15 08:00:00 UTC"), "human-readable timestamps");
      assert.ok(res.body.includes("SC001-MARKER-1"), "story content present without JS");
      assert.ok(res.body.includes('"refreshSeconds":15'), "refresh bootstrap embedded");
      for (const secret of Object.values(SECRET_SHAPE_VALUES)) {
        assert.ok(!res.body.includes(secret));
      }
    },
  );
});

test("history-us1: US1: a continuation page address serves the same view, byte-identical", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const head = await h.get(pathOf(h, 0), { headers: { accept: "application/json" } });
      const continuation = await h.get(pathOf(h, 7), { headers: { accept: "application/json" } });
      assert.equal(continuation.status, 200);
      assert.equal(continuation.body, head.body, "identical view from either address");

      const again = await h.get(pathOf(h, 0), { headers: { accept: "application/json" } });
      assert.equal(again.body, head.body, "same chain state ⇒ byte-identical JSON");
    },
  );
});

test("history-us1: US1: the fake port is touched only through address-based reads", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: SC001_WORLD, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 200);
      const methods = [...new Set(h.world.fake.callLog.map((entry) => entry.method))];
      assert.deepEqual(methods, ["getAttachmentByUrl"]);
    },
  );
});

test("history-us1: US1: no history at all is a complete story, not an error", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: { pages: 1, eventsPerPage: 0 },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "application/json" } });
      assert.equal(res.status, 200);
      const view = await jsonOf(res);
      assert.deepEqual(view.events, []);
      assert.equal(view.lastSyncAt, "2026-01-15T08:00:00.000Z");

      const html = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.match(html.body, /no sync history recorded yet/i);
    },
  );
});

test("history-us1: US1: missing or non-history addresses answer 404 with zero history bytes", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    {
      world: {
        taskUuid: HISTORY_OTHER_TASK_UUID,
        pages: 2,
        eventsPerPage: 3,
        secretShape: true,
      },
      web: { accessControlMode: "public" },
    },
    async (h) => {
      const cases: Array<{ label: string; path: string }> = [
        { label: "task with no canonical page", path: `/task-linear-sync/${HISTORY_TASK_UUID}` },
        {
          label: "foreign tool segment",
          path: `/elsewhere-tool/${HISTORY_TASK_UUID}`,
        },
        { label: "server root", path: "/" },
        { label: "favicon", path: "/favicon.ico" },
      ];
      for (const testCase of cases) {
        for (const accept of ["application/json", "text/html"]) {
          const res = await h.get(testCase.path, { headers: { accept } });
          assert.equal(res.status, 404, `${testCase.label} (${accept})`);
          for (const probe of h.world.historyProbes) {
            assert.ok(!res.body.includes(probe), `${testCase.label} leaks history content`);
          }
          for (const secret of Object.values(SECRET_SHAPE_VALUES)) {
            assert.ok(!res.body.includes(secret));
          }
          if (accept === "application/json") {
            assert.deepEqual(JSON.parse(res.body), {
              error: {
                code: "NOT_FOUND",
                message: "history: no synced history is available for this task",
              },
            });
          }
        }
      }
    },
  );
});

test("history-us1: US1: routed paths outside the URL scheme and other methods never serve history", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: { pages: 1, eventsPerPage: 2 }, web: { accessControlMode: "public" } },
    async (h) => {
      // page-0 continuation segment is NOT_FOUND per the frozen parser
      const pageZeroContinuation = await h.get(`/task-linear-sync/${HISTORY_TASK_UUID}/0`, {
        headers: { accept: "application/json" },
      });
      assert.equal(pageZeroContinuation.status, 404);

      // non-UUID identity
      const nonUuid = await h.get("/task-linear-sync/not-a-uuid", {
        headers: { accept: "application/json" },
      });
      assert.equal(nonUuid.status, 404);

      const post = await h.post(pathOf(h), { body: "token=irrelevant" });
      assert.equal(post.status, 405);
    },
  );
});

test("history-us1: US1: responses carry the baseline security headers", async () => {
  await withHistoryServer(
    createSyncHistoryServer,
    { world: { pages: 1, eventsPerPage: 1 }, web: { accessControlMode: "public" } },
    async (h) => {
      const res = await h.get(pathOf(h), { headers: { accept: "text/html" } });
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(
        res.headers["content-security-policy"],
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      );
    },
  );
});
