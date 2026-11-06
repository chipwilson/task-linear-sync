/**
 * T028 — serverless-shape run (US2 AC3, FR-004/FR-006, SC-004): with
 * `cacheTtlSeconds: 0` the app is exercised as a plain function — `app.handle`
 * is invoked directly with stub req/res (never `listen()`), twice against the
 * 10-page chain, and serves the full history both times with nothing
 * persisting between invocations.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigOverrides } from "../../src/config/schema.js";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import { buildChainWorld, makeFixedClock, makeStubPair } from "../helpers/history-harness.js";

const WORLD_SPEC = { pages: 10, eventsPerPage: 10, interleave: true } as const;

function pathOfUrl(url: string): string {
  return new URL(url).pathname;
}

test("history-serverless-shape: US2: handle-as-a-function serves the full chain twice with no listen()", async () => {
  const world = buildChainWorld(WORLD_SPEC);
  const config = loadConfig({
    overrides: {
      web: { accessControlMode: "public", cacheTtlSeconds: 0 },
    } as ConfigOverrides,
  });
  const app = createSyncHistoryServer({ port: world.fake, config, clock: makeFixedClock() });

  const invoke = async (): Promise<{
    statusCode: number;
    headers: Record<string, string | string[]>;
    body: string;
  }> => {
    const pair = makeStubPair({
      method: "GET",
      url: pathOfUrl(world.canonicalUrl),
      headers: { accept: "application/json" },
    });
    app.handle(pair.req, pair.res);
    return pair.finished;
  };

  const first = await invoke();
  assert.equal(first.statusCode, 200);
  const viewOne = JSON.parse(first.body) as Record<string, unknown>;
  assert.equal((viewOne["events"] as unknown[]).length, 100);
  assert.equal((viewOne["pages"] as unknown[]).length, 10);
  assert.equal(first.headers["x-history-cache"], "miss");
  const probesAfterFirst = world.fake.callLog.filter((c) => c.method === "getAttachmentByUrl").length;
  assert.equal(probesAfterFirst, 11, "10 pages + one absence probe");

  const second = await invoke();
  assert.equal(second.statusCode, 200);
  assert.equal(second.body, first.body, "fixed clock ⇒ byte-identical full view again");
  assert.equal(second.headers["x-history-cache"], "miss", "nothing persists between invocations");
  const probesAfterSecond = world.fake.callLog.filter((c) => c.method === "getAttachmentByUrl").length;
  assert.equal(probesAfterSecond, 22, "the second invocation re-walks the whole chain");
});

test("history-serverless-shape: US2: private mode answers 401 through the stub path too", async () => {
  const world = buildChainWorld({ pages: 1, eventsPerPage: 2 });
  const config = loadConfig({
    overrides: { web: { cacheTtlSeconds: 0 } } as ConfigOverrides,
  });
  const app = createSyncHistoryServer({
    port: world.fake,
    config,
    clock: makeFixedClock(),
    env: { [config.web.authEnvVarName]: "serverless-token-1" },
  });

  const pair = makeStubPair({
    method: "GET",
    url: pathOfUrl(world.canonicalUrl),
    headers: { accept: "application/json" },
  });
  app.handle(pair.req, pair.res);
  const res = await pair.finished;
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["www-authenticate"] ?? res.headers["WWW-Authenticate"], "Bearer");
  assert.equal(
    world.fake.callLog.filter((c) => c.method === "getAttachmentByUrl").length,
    0,
    "auth precedes reconstruction in the function shape as well",
  );

  const authed = makeStubPair({
    method: "GET",
    url: pathOfUrl(world.canonicalUrl),
    headers: { accept: "application/json", authorization: "Bearer serverless-token-1" },
  });
  app.handle(authed.req, authed.res);
  const ok = await authed.finished;
  assert.equal(ok.statusCode, 200);
});
