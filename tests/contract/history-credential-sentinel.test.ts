/**
 * T024 — SC-003 credential-sentinel sweep (precedent:
 * tracker-credential-sentinel.test.ts). The sentinel is planted twice: as the
 * token env value AND echoed inside a hostile history description that the
 * screener blocks. Across the full error corpus (401/403/404/429/502/500 ×
 * HTML/JSON/SSE × private/public) ZERO response bytes may contain the
 * sentinel, and blocked-shipment descriptions appear only as
 * `[blocked:<category>]`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigOverrides } from "../../src/config/schema.js";
import { createSyncHistoryServer } from "../../src/history-server/create.js";
import type { LinearPort } from "../../src/ports/linear-port.js";
import type { ChainWorldSpec } from "../helpers/history-harness.js";
import {
  TOKEN_SENTINEL,
  buildChainWorld,
  makeFixedClock,
  makeStubPair,
} from "../helpers/history-harness.js";
import { makeScreener } from "../helpers/test-utils.js";

const FORMATS = [
  ["html", "text/html"],
  ["json", "application/json"],
  ["sse", "text/event-stream"],
] as const;

const BASIC_WORLD: ChainWorldSpec = { pages: 1, eventsPerPage: 3 };

interface Scenario {
  world: ChainWorldSpec;
  web?: Partial<{
    accessControlMode: "private" | "public";
    realtimeSse: boolean;
    pollIntervalSeconds: number;
    cacheTtlSeconds: number;
    authEnvVarName: string;
  }>;
  screener?: ReturnType<typeof makeScreener>;
  portWrapper?: (inner: LinearPort) => LinearPort;
  land?: string;
}

/** One app; `serve` invokes handle as a function through a stub req/res. */
function scenario(spec: Scenario): {
  serve: (
    path: string,
    opts: { accept: string; headers?: Record<string, string> },
  ) => Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }>;
  path: string;
} {
  const world = buildChainWorld(spec.world);
  const config = loadConfig({ overrides: { web: spec.web ?? {} } as ConfigOverrides });
  const app = createSyncHistoryServer({
    port: spec.portWrapper ? spec.portWrapper(world.fake) : world.fake,
    config,
    clock: makeFixedClock(),
    screener: spec.screener,
    env: { [config.web.authEnvVarName]: TOKEN_SENTINEL },
  });
  if (spec.land !== undefined) world.landEvent(spec.land);
  return {
    path: new URL(world.canonicalUrl).pathname,
    serve: async (path, opts) => {
      const pair = makeStubPair({
        method: "GET",
        url: path,
        headers: { accept: opts.accept, ...(opts.headers ?? {}) },
      });
      app.handle(pair.req, pair.res);
      // A served SSE stream stays open on purpose: capture its live bytes.
      const raced = await Promise.race([
        pair.finished.then((r) => ({ kind: "done" as const, r })),
        new Promise<{ kind: "open" }>((resolve) => {
          setTimeout(() => resolve({ kind: "open" }), 250).unref?.();
        }),
      ]);
      if (raced.kind === "done") return raced.r;
      const snap = pair.snapshot();
      pair.res.emit("close"); // stop any live stream so the run exits cleanly
      return snap;
    },
  };
}

function assertNoSentinelBytes(
  res: { body: string; headers: Record<string, string | string[]> },
  where: string,
): void {
  assert.equal(res.body.includes(TOKEN_SENTINEL), false, `${where}: body leaks the sentinel`);
  for (const [name, value] of Object.entries(res.headers)) {
    const flat = Array.isArray(value) ? value.join(",") : String(value);
    assert.equal(
      `${name}=${flat}`.includes(TOKEN_SENTINEL),
      false,
      `${where}: header ${name} leaks the sentinel`,
    );
  }
}

const PRIVATE_CREDS = { authorization: `Bearer ${TOKEN_SENTINEL}` };

function corpus(
  label: string,
  build: (mode: "private" | "public") => { spec: Scenario; headers?: Record<string, string> },
  expected: number,
): void {
  for (const mode of ["private", "public"] as const) {
    test(`history-sentinel: ${label} × ${mode} ships zero sentinel bytes in every format`, async () => {
      for (const [fmt, accept] of FORMATS) {
        // A fresh scenario per format: scripted failures fire once per world.
        const { spec, headers } = build(mode);
        const s = scenario(spec);
        const res = await s.serve(s.path, { accept, headers });
        const where = `${label} ${mode} × ${fmt}`;
        assert.equal(res.statusCode, expected, `${where}\nbody: ${res.body.slice(0, 200)}`);
        assertNoSentinelBytes(res, where);
      }
    });
  }
}

// 401/403 only exist in private mode; public mode cannot produce them.
for (const [label, headers] of [
  ["401", undefined],
  ["403", { authorization: "Bearer wrong-token-not-the-sentinel" }],
] as const) {
  test(`history-sentinel: ${label} private ships zero sentinel bytes in every format`, async () => {
    const s = scenario({ world: BASIC_WORLD });
    for (const [fmt, accept] of FORMATS) {
      const res = await s.serve(s.path, { accept, headers: headers ?? undefined });
      const where = `${label} private × ${fmt}`;
      assert.equal(res.statusCode, Number(label), `${where}\nbody: ${res.body.slice(0, 200)}`);
      assertNoSentinelBytes(res, where);
    }
  });
}

test("history-sentinel: 404 sweeps an unrouted path in both modes", async () => {
  for (const mode of ["private", "public"] as const) {
    const s = scenario({ world: BASIC_WORLD, web: { accessControlMode: mode } });
    for (const [fmt, accept] of FORMATS) {
      const res = await s.serve("/no/such/history/path", { accept });
      assert.equal(res.statusCode, 404, `404 ${mode} × ${fmt}`);
      assertNoSentinelBytes(res, `404 ${mode} × ${fmt}`);
    }
  }
});

corpus(
  "429",
  (mode) => ({
    spec: {
      world: {
        pages: 1,
        eventsPerPage: 3,
        failures: { getAttachmentByUrl: { atCall: 1, kind: "http-429-retryAfter" } },
        maxRetries: 0,
      },
      web: { accessControlMode: mode },
    },
    headers: mode === "private" ? PRIVATE_CREDS : undefined,
  }),
  429,
);

corpus(
  "502",
  (mode) => ({
    spec: {
      world: { pages: 1, eventsPerPage: 3, corruptPage: 0, corruptKind: "task-uuid" },
      web: { accessControlMode: mode },
    },
    headers: mode === "private" ? PRIVATE_CREDS : undefined,
  }),
  502,
);

corpus(
  "500",
  (mode) => ({
    spec: {
      world: BASIC_WORLD,
      web: { accessControlMode: mode },
      portWrapper: (inner) => {
        let blown = false;
        return {
          ...inner,
          async getAttachmentByUrl(url: string) {
            if (!blown) {
              blown = true;
              throw new Error(`boom: programmer error reading ${url}`);
            }
            return inner.getAttachmentByUrl(url);
          },
        };
      },
    },
    headers: mode === "private" ? PRIVATE_CREDS : undefined,
  }),
  500,
);

// -- hostile echo: sentinel inside blocked history text ------------------------------

const HOSTILE = `BLOCKED echo of ${TOKEN_SENTINEL} in a description`;

for (const mode of ["private", "public"] as const) {
  test(`history-sentinel: hostile description echo is blocked (${mode}) in every format`, async () => {
    const s = scenario({
      world: BASIC_WORLD,
      web: { accessControlMode: mode },
      screener: makeScreener(),
      land: HOSTILE,
    });
    for (const [fmt, accept] of FORMATS) {
      const res = await s.serve(s.path, {
        accept,
        headers: mode === "private" ? PRIVATE_CREDS : undefined,
      });
      const where = `hostile ${mode} × ${fmt}`;
      assert.equal(res.statusCode, 200, `${where}\nbody: ${res.body.slice(0, 200)}`);
      assertNoSentinelBytes(res, where);
      assert.equal(res.body.includes("BLOCKED"), false, `${where}: blocked text ships verbatim`);
      assert.match(res.body, /\[blocked:/, `${where}: blocked shipments show category markers`);
    }
  });
}

test("history-sentinel: the 403/401 bodies also name no credential or local path", async () => {
  const s = scenario({ world: BASIC_WORLD });
  for (const [path, accept] of [
    [s.path, "application/json"],
    [s.path, "text/html"],
  ] as const) {
    const un = await s.serve(path, { accept });
    const bad = await s.serve(path, { accept, headers: { authorization: "Bearer nope" } });
    for (const res of [un, bad]) {
      for (const banned of ["token", "TASK_LINEAR_SYNC", "Bearer", "/home/", "src/"]) {
        assert.equal(
          res.body.includes(banned),
          false,
          `auth error body names ${JSON.stringify(banned)}`,
        );
      }
    }
  }
});
