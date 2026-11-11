/**
 * Feature 012 integration: the http transport over a real loopback listener (T050).
 *
 * Pinned here (transport-auth.md §2, FR-004), over real sockets against the
 * in-process server built on `node:http`:
 *  - `listenHttp()` on 127.0.0.1:0 resolves `{ port }` and announces the bound
 *    port to STDERR exactly ONCE — never inside a protocol message;
 *  - a valid `Authorization: Bearer <token>` POST runs a full session
 *    (initialize → tools/list → tools/call task_sync_status) with payloads
 *    identical to the stdio transport (transport choice never weakens gating);
 *  - auth matrix: missing header ⇒ 401 + `WWW-Authenticate: Bearer`; wrong
 *    token ⇒ 403; BOTH with constant bodies `{"error":"UNAUTHORIZED"|"FORBIDDEN"}`
 *    and ZERO fake-port activity (auth strictly before dispatch, SC-002);
 *  - non-POST /mcp ⇒ 405; any other path ⇒ 404; body > 1 MiB ⇒ 413
 *    `PAYLOAD_TOO_LARGE`; exactly one JSON-RPC message per request;
 *  - `transport: "stdio"` ⇒ `listenHttp()` throws `McpConfigError`;
 *    `transport: "http"` with the token env var unset/empty ⇒ CONSTRUCTION
 *    throws, naming the env-var NAME only;
 *  - `close()` stops the listener; the `host` setting is honored.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildCliWorld, hashTree } from "../helpers/cli-harness.js";
import { createAgentToolServer } from "../../src/mcp/create.js";
import { PACKAGE_VERSION } from "../../src/version.generated.js";
import { McpConfigError } from "../../src/mcp/errors.js";
import type { Clock, StateStore } from "../../src/state/index.js";
import { MCP_TEST_TOKEN, withHttpServer, withMcpServer } from "../helpers/mcp-harness.js";
import type { JsonRpcMessage } from "../helpers/mcp-harness.js";

async function post(
  url: string,
  body: unknown,
  options: { bearer?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; raw: string; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (options.bearer !== null) headers.authorization = `Bearer ${options.bearer ?? MCP_TEST_TOKEN}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    /* non-JSON refusal bodies are asserted raw below */
  }
  return { status: response.status, raw, body: parsed, headers: response.headers };
}

function asRecord(value: unknown): JsonRpcMessage {
  assert.equal(typeof value, "object", `expected an object, got ${String(value)}`);
  assert.ok(value !== null, "expected non-null");
  return value as JsonRpcMessage;
}

function toolText(response: unknown): string {
  const result = asRecord(asRecord(response).result) as unknown as { content: Array<{ text: string }> };
  assert.ok(result?.content?.[0], `no content block in ${JSON.stringify(response)}`);
  return result.content[0]!.text;
}

/** Silence + capture process.stderr writes for the duration of fn (announcement scan). */
async function withCapturedStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string[] }> {
  const original = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), stderr: chunks };
  } finally {
    process.stderr.write = original;
  }
}

test("http: announces the bound port on stderr exactly once and serves a full session", async () => {
  let httpStatusText = "";
  let boundPort = "";
  const { stderr } = await withCapturedStderr(async () => {
    await withHttpServer(
      async (fx) => {
        boundPort = new URL(fx.url).port;

        // One JSON-RPC message per request, in session order.
        const init = await post(fx.url, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        assert.equal(init.status, 200);
        assert.deepEqual(asRecord(init.body).result, {
          protocolVersion: "2025-06-18", // version-less initialize ⇒ server default (014)
          capabilities: { tools: {} },
          // DERIVED, never hardcoded: serverInfo.version tracks package.json (015 R4).
          serverInfo: { name: "task-linear-sync-mcp", version: PACKAGE_VERSION },
        });
        assert.ok(!init.raw.includes(boundPort), "the bound port never rides a protocol message");

        const notified = await post(fx.url, { jsonrpc: "2.0", method: "notifications/initialized" });
        assert.equal(notified.status, 202); // notification: accepted, no reply body
        assert.equal(notified.raw, "");

        const listed = await post(fx.url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        assert.deepEqual(
          (asRecord(asRecord(listed.body).result) as unknown as { tools: Array<{ name: string }> }).tools.map(
            (t) => t.name,
          ),
          // The frozen tool-definitions.md §1 order — identical to the stdio transport.
          ["task_sync_plan", "task_sync_status", "task_sync_inventory"],
        );

        const status = await post(fx.url, {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "task_sync_status", arguments: {} },
        });
        assert.equal(status.status, 200);
        httpStatusText = toolText(status.body);
      },
      { profile: "zero-task" },
    );
  });

  // STDERR announcement: exactly once, carrying the bound port.
  const announce = stderr.filter((line) => /listening/i.test(line));
  assert.equal(announce.length, 1, `expected ONE announcement, saw: ${JSON.stringify(announce)}`);
  assert.ok(announce[0]!.includes(boundPort), `announcement must name the port: ${announce[0]}`);

  // Transport choice never weakens gating: the SAME call on the stdio transport
  // answers a byte-identical payload.
  await withMcpServer(
    async (stdio) => {
      await stdio.initialize();
      const viaStdio = await stdio.request("tools/call", { name: "task_sync_status", arguments: {} });
      assert.equal(toolText(viaStdio), httpStatusText);
    },
    { profile: "zero-task" },
  );
});

test("http: refuses missing and wrong bearer tokens strictly before dispatch (SC-002)", async () => {
  await withHttpServer(
    async (fx) => {
      const callsBefore = fx.world.fake.callLog.length;
      const probe = { jsonrpc: "2.0", id: 77, method: "tools/call", params: { name: "task_sync_plan", arguments: {} } };

      const missing = await post(fx.url, probe, { bearer: null });
      assert.equal(missing.status, 401);
      assert.equal(missing.raw, '{"error":"UNAUTHORIZED"}'); // constant body
      assert.equal(missing.headers.get("www-authenticate"), "Bearer");
      assert.deepEqual(asRecord(missing.body), { error: "UNAUTHORIZED" });

      const wrong = await post(fx.url, probe, { bearer: "definitely-not-the-token" });
      assert.equal(wrong.status, 403);
      assert.equal(wrong.raw, '{"error":"FORBIDDEN"}');

      const scheme = await fetch(fx.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `token ${MCP_TEST_TOKEN}` },
        body: JSON.stringify(probe),
      });
      assert.equal(scheme.status, 401); // not a Bearer credential ⇒ missing
      assert.equal(scheme.headers.get("www-authenticate"), "Bearer");

      const lower = await fetch(fx.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `bearer ${MCP_TEST_TOKEN}` },
        body: JSON.stringify(probe),
      });
      assert.equal(lower.status, 200); // the scheme NAME is case-insensitive

      const prefix = await post(fx.url, probe, { bearer: `${MCP_TEST_TOKEN}extra` });
      assert.equal(prefix.status, 403); // length-guarded compare: an extended echo fails

      assert.equal(fx.world.fake.callLog.length, callsBefore); // zero dispatch happened
      assert.equal(fx.world.requests().length, 0);
    },
    { profile: "zero-task" },
  );
});

test("http: routes only POST /mcp, caps bodies at 1 MiB, and takes ONE message per request", async () => {
  await withHttpServer(
    async (fx) => {
      const before = fx.world.fake.callLog.length;

      const get = await fetch(fx.url, { headers: { authorization: `Bearer ${MCP_TEST_TOKEN}` } });
      assert.equal(get.status, 405);
      assert.equal(await get.text(), '{"error":"METHOD_NOT_ALLOWED"}');

      const other = await post(new URL("/other", fx.url).href, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      assert.equal(other.status, 404);
      assert.equal(other.raw, '{"error":"NOT_FOUND"}');

      const otherMethod = await fetch(new URL("/other", fx.url).href, { method: "PUT" });
      assert.equal(otherMethod.status, 404); // unknown path answers 404 whatever the method

      const huge = await post(fx.url, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping", pad: "x".repeat(1_100_000) }));
      assert.equal(huge.status, 413);
      assert.equal(huge.raw, '{"error":"PAYLOAD_TOO_LARGE"}');

      // Exactly one message per request: an array is an invalid request, not a batch.
      const batch = await post(fx.url, [
        { jsonrpc: "2.0", id: 3, method: "ping" },
        { jsonrpc: "2.0", id: 4, method: "ping" },
      ]);
      assert.equal(batch.status, 200);
      assert.deepEqual(asRecord(batch.body), { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });

      const garbage = await post(fx.url, "{not json");
      assert.equal(garbage.status, 200);
      assert.deepEqual(asRecord(asRecord(garbage.body).error), { code: -32600, message: "invalid request" });

      assert.equal(fx.world.fake.callLog.length, before); // none of it reached the tracker
    },
    { profile: "zero-task" },
  );
});

test("http: stdio transports refuse to listen; http construction fails closed without a token", async () => {
  await withMcpServer(
    async (fx) => {
      await assert.rejects(() => fx.app.listenHttp(), (error: unknown) => error instanceof McpConfigError);
      await assert.rejects(() => fx.app.listenHttp(), /transport === 'http'/);
    },
    { settings: { transport: "stdio" } },
  );

  const world = await buildCliWorld("zero-task");
  try {
    const attempt = (env: Record<string, string>, name: string): string => {
      try {
        createAgentToolServer({
          config: world.config,
          env,
          state: world.state,
          port: world.port,
          repositoryRoot: world.repositoryRoot,
          settings: { transport: "http", tokenEnvVarName: name },
        });
        return "";
      } catch (error) {
        assert.ok(error instanceof McpConfigError, `expected McpConfigError, got ${String(error)}`);
        return error.message;
      }
    };
    const absent = attempt({}, "TASK_SYNC_MCP_TOKEN_ABSENT");
    assert.ok(absent.includes("TASK_SYNC_MCP_TOKEN_ABSENT"), `names the env-var NAME: ${absent}`);
    assert.ok(!/[Bb]earer/.test(absent), `never speaks of values: ${absent}`);

    const blank = attempt({ TASK_SYNC_MCP_TOKEN_BLANK: "   " }, "TASK_SYNC_MCP_TOKEN_BLANK");
    assert.ok(blank.includes("TASK_SYNC_MCP_TOKEN_BLANK"), `a blank value fails closed too: ${blank}`);
  } finally {
    await world.dispose();
  }
});

test("http: close() stops the listener and the host setting is honored", async () => {
  const world = await buildCliWorld("zero-task");
  const token = "close-probe-token-012";
  try {
    const app = createAgentToolServer({
      config: world.config,
      env: { TASK_SYNC_MCP_TEST_TOKEN: token },
      state: world.state,
      port: world.port,
      repositoryRoot: world.repositoryRoot,
      settings: { transport: "http", host: "127.0.0.1", port: 0, tokenEnvVarName: "TASK_SYNC_MCP_TEST_TOKEN" },
    });
    const listener = await app.listenHttp();
    assert.ok(listener.port > 0, "port 0 resolved to a real bound port");
    const ok = await post(`http://127.0.0.1:${listener.port}/mcp`, { jsonrpc: "2.0", id: 1, method: "ping" }, { bearer: token });
    assert.equal(ok.status, 200);

    await listener.close();
    await assert.rejects(() => fetch(`http://127.0.0.1:${listener.port}/mcp`)); // refused after close
    await listener.close(); // idempotent

    const live = await app.listenHttp();
    await app.close(); // app.close() covers the live listener too
    await assert.rejects(() => fetch(`http://127.0.0.1:${live.port}/mcp`));

    // host is honored: an unroutable bind target fails the LISTEN, not the construction.
    const badHost = createAgentToolServer({
      config: world.config,
      env: { TASK_SYNC_MCP_TEST_TOKEN: token },
      state: world.state,
      port: world.port,
      repositoryRoot: world.repositoryRoot,
      settings: { transport: "http", host: "203.0.113.77", port: 0, tokenEnvVarName: "TASK_SYNC_MCP_TEST_TOKEN" },
    });
    await assert.rejects(() => badHost.listenHttp());
    await badHost.close();
  } finally {
    await world.dispose();
  }
});

// ── T028 (feature 014) — bounded plan-reference store over a long-lived http
// server (resource-bounds.md §5; expired ≡ evicted ≡ unknown with zero
// engine/port/state touch, apply-gating.md step 3) ─────────────────────────────

function mutableClock(startIso: string): Clock & { advanceMs(ms: number): void } {
  let ms = Date.parse(startIso);
  return {
    now: () => new Date(ms),
    elapsed: (sinceIso: string) => ms - Date.parse(sinceIso),
    advanceMs: (delta: number) => {
      ms += delta;
    },
  };
}

/**
 * Method-counting proxy that also SWAPS `state.clock` to the app clock — the
 * engine derives plan-report run ids from `state.clock` while writing them with
 * its injected clock, so both must be the same advancing instance.
 */
function spyingState(state: StateStore, clockOverride: Clock): { store: StateStore; calls: () => number } {
  let count = 0;
  const store = new Proxy(state, {
    get(target, prop) {
      if (prop === "clock") return clockOverride;
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          count += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  return { store, calls: () => count };
}

let t028Id = 10;

async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await post(url, {
    jsonrpc: "2.0",
    id: t028Id++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return { status: res.status, body: res.body, text: toolText(res.body) };
}

async function openHttpSession(url: string): Promise<void> {
  const init = await post(url, {
    jsonrpc: "2.0",
    id: t028Id++,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  });
  assert.equal(init.status, 200);
  await post(url, { jsonrpc: "2.0", method: "notifications/initialized" });
}

test("http T028: an EXPIRED plan reference answers PLAN_REFERENCE_UNKNOWN with zero engine/port/state touch", async () => {
  const clock = mutableClock("2026-02-01T00:00:00.000Z");
  let spy: { store: StateStore; calls: () => number } | undefined;
  await withHttpServer(
    async (fx) => {
      await openHttpSession(fx.url);
      const planned = await callTool(fx.url, "task_sync_plan", {});
      assert.notEqual(asRecord(planned.body).result && (asRecord(asRecord(planned.body).result) as { isError?: boolean }).isError, true, planned.text);
      const { planReference } = JSON.parse(planned.text) as { planReference: string };
      assert.ok(planReference.length === 64, "sanity: a 64-hex reference was handed out");

      const callsBefore = fx.world.fake.callLog.length;
      const stateBefore = spy?.calls() ?? -1;
      const dirHash = hashTree(fx.world.stateDir);

      clock.advanceMs(61_000); // past the 60 s ttl

      const applied = await callTool(fx.url, "task_sync_apply", {
        planReference,
        confirmationKey: fx.world.config.confirmationKey,
      });
      assert.equal(applied.status, 200);
      const result = asRecord(asRecord(applied.body).result) as { isError?: boolean };
      assert.equal(result.isError, true, "expired reference fails closed");
      assert.ok(applied.text.includes("PLAN_REFERENCE_UNKNOWN"), applied.text);
      assert.ok(applied.text.includes("run task_sync_plan"), "message unchanged");

      assert.equal(fx.world.fake.callLog.length, callsBefore, "zero port calls");
      assert.equal(spy?.calls(), stateBefore, "zero state-store method calls");
      assert.equal(hashTree(fx.world.stateDir), dirHash, "state-dir tree byte-unchanged");
    },
    {
      settings: { enabled: true, planReferenceTtlSeconds: 60, planReferenceMaxEntries: 3 },
      clock,
      wrapState: (state) => {
        spy = spyingState(state, clock);
        return spy.store;
      },
    },
  );
});

test("http T028: a CAPACITY-EVICTED reference is byte-identical to a never-known one; survivors still pass step 3", async () => {
  const clock = mutableClock("2026-02-01T00:00:00.000Z");
  await withHttpServer(
    async (fx) => {
      await openHttpSession(fx.url);
      const refs: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const planned = await callTool(fx.url, "task_sync_plan", {});
        refs.push((JSON.parse(planned.text) as { planReference: string }).planReference);
        clock.advanceMs(10_000); // distinct recordedAt values
      }
      assert.ok(new Set(refs).size === 4, `four DISTINCT references expected, got ${JSON.stringify(refs)}`);

      const callsBefore = fx.world.fake.callLog.length;
      const evicted = await callTool(fx.url, "task_sync_apply", {
        planReference: refs[0]!,
        confirmationKey: fx.world.config.confirmationKey,
      });
      const unknown = await callTool(fx.url, "task_sync_apply", {
        planReference: "e".repeat(64),
        confirmationKey: fx.world.config.confirmationKey,
      });
      assert.ok(evicted.text.includes("PLAN_REFERENCE_UNKNOWN"), evicted.text);
      assert.equal(
        JSON.stringify(asRecord(evicted.body).result),
        JSON.stringify(asRecord(unknown.body).result),
        "evicted ≡ unknown — the refusal renders byte-identically",
      );
      assert.equal(fx.world.fake.callLog.length, callsBefore, "both refusals touch zero port calls");

      // The three survivors (refs 1..3) clear the step-3 gate — they can only be
      // refused further down the ladder, never as PLAN_REFERENCE_UNKNOWN.
      const survivor = await callTool(fx.url, "task_sync_apply", {
        planReference: refs[3]!,
        confirmationKey: fx.world.config.confirmationKey,
      });
      assert.equal(survivor.text.includes("PLAN_REFERENCE_UNKNOWN"), false, survivor.text);
    },
    {
      settings: { enabled: true, planReferenceTtlSeconds: 3_600, planReferenceMaxEntries: 3 },
      clock,
      wrapState: (state) => spyingState(state, clock).store,
    },
  );
});
