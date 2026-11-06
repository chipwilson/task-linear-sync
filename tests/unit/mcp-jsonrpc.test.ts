/**
 * T010 [P] — unit tests for the JSON-RPC 2.0 layer (T017) (contracts/jsonrpc-stdio.md
 * §2–§4; data-model §1). Dispatcher is exercised through stubbed tool deps — no streams,
 * no world: the dispatcher is transport-agnostic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDispatcher,
  parseMessage,
  RPC_ERROR_CODES,
  serializeMessage,
  type ToolCallResult,
} from "../../src/mcp/jsonrpc.js";

const CLOSED_CODES = new Set<number>([-32700, -32600, -32601, -32602, -32603, -32002]);

interface Stub {
  calls: Array<{ name: string; args: unknown }>;
  impl: (name: string, args: unknown) => Promise<ToolCallResult>;
}

function makeDispatcher(overrides: Partial<Parameters<typeof createDispatcher>[0]> = {}) {
  const stub: Stub = {
    calls: [],
    impl: async (name, args) => {
      stub.calls.push({ name, args });
      return { content: [{ type: "text", text: JSON.stringify({ echoed: name }) }] };
    },
  };
  const dispatcher = createDispatcher({
    serverName: "tool-mcp",
    serverVersion: "9.9.9",
    listTools: () => [
      { name: "task_sync_plan", description: "d1", inputSchema: { type: "object", additionalProperties: false } },
      { name: "task_sync_status", description: "d2", inputSchema: { type: "object", additionalProperties: false } },
    ],
    callTool: (name, args) => stub.impl(name, args),
    ...overrides,
  });
  return { dispatcher, stub };
}

async function handshake(dispatcher: ReturnType<typeof makeDispatcher>["dispatcher"]): Promise<void> {
  await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  await dispatcher.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
}

// ─────────────────────────────── parseMessage

test("parseMessage: request with string or number id, method, optional object/array params", () => {
  const req = parseMessage({ jsonrpc: "2.0", id: "abc", method: "ping" });
  assert.equal(req.kind, "request");
  const req2 = parseMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { a: 1 } });
  assert.equal(req2.kind, "request");
  const arrParams = parseMessage({ jsonrpc: "2.0", id: 7, method: "x", params: [1, 2] });
  assert.equal(arrParams.kind, "request"); // params object OR array per data-model §1
});

test("parseMessage: notification has method and NO id", () => {
  const note = parseMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.kind, "notification");
});

test("parseMessage: id present but invalid (null/bool/object) ⇒ -32600 with null id", () => {
  for (const bad of [null, true, {}]) {
    const res = parseMessage({ jsonrpc: "2.0", id: bad, method: "notifications/initialized" });
    assert.equal(res.kind, "invalid");
    if (res.kind === "invalid") {
      assert.equal(res.code, RPC_ERROR_CODES.INVALID_REQUEST);
      assert.equal(res.id, null);
    }
  }
});

test("parseMessage: non-object, wrong jsonrpc, missing/non-string method ⇒ -32600", () => {
  const cases: unknown[] = [
    "text",
    42,
    null,
    [1],
    { jsonrpc: "1.0", id: 1, method: "ping" },
    { id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, method: "" },
    { jsonrpc: "2.0", id: 1, method: 5 },
  ];
  for (const raw of cases) {
    const res = parseMessage(raw);
    assert.equal(res.kind, "invalid", `expected invalid for ${JSON.stringify(raw)}`);
    if (res.kind === "invalid") assert.equal(res.code, RPC_ERROR_CODES.INVALID_REQUEST);
  }
});

test("parseMessage: non-object/array params ⇒ -32600", () => {
  const res = parseMessage({ jsonrpc: "2.0", id: 1, method: "x", params: "str" });
  assert.equal(res.kind, "invalid");
});

// ─────────────────────────────── handshake state machine

test("pre-initialize requests ⇒ -32002; pre-initialize notifications dropped without response", async () => {
  const { dispatcher } = makeDispatcher();
  const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
  assert.ok(reply && "error" in reply);
  assert.equal((reply as { error: { code: number } }).error.code, RPC_ERROR_CODES.NOT_INITIALIZED);
  assert.equal((reply as { error: { message: string } }).error.message, "server not initialized");

  assert.equal(await dispatcher.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await dispatcher.handleMessage({ jsonrpc: "2.0", method: "notifications/cancelled" }), null);
});

test("initialize echoes a supported version; unknown version answers 2025-06-18; result shape frozen", async () => {
  for (const [sent, echo] of [
    ["2024-11-05", "2024-11-05"],
    ["2025-03-26", "2025-03-26"],
    ["2025-06-18", "2025-06-18"],
    ["2099-01-01", "2025-06-18"],
    ["not-a-date", "2025-06-18"],
  ] as const) {
    const { dispatcher } = makeDispatcher();
    const reply = await dispatcher.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: sent, clientInfo: { name: "host" }, capabilities: {} },
    });
    assert.ok(reply && "result" in reply, `expected result for ${sent}`);
    const result = (reply as { result: Record<string, unknown> }).result;
    assert.equal(result.protocolVersion, echo);
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.deepEqual(result.serverInfo, { name: "tool-mcp", version: "9.9.9" });
  }
});

test("initialize with missing/garbage protocolVersion still answers the latest supported version", async () => {
  const { dispatcher } = makeDispatcher();
  const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(reply && "result" in reply);
  assert.equal((reply as { result: { protocolVersion: string } }).result.protocolVersion, "2025-06-18");
});

test("second initialize on the same connection ⇒ -32602 (before AND after notifications/initialized)", async () => {
  const { dispatcher } = makeDispatcher();
  await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  const second = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  assert.ok(second && "error" in second);
  assert.equal((second as { error: { code: number } }).error.code, RPC_ERROR_CODES.INVALID_PARAMS);

  await handshake(dispatcher);
  const third = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
  assert.ok(third && "error" in third);
  assert.equal((third as { error: { code: number } }).error.code, RPC_ERROR_CODES.INVALID_PARAMS);
});

test("requests between initialize and ready ⇒ -32002; ping answers {} once ready", async () => {
  const { dispatcher } = makeDispatcher();
  await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  const mid = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(mid && "error" in mid);
  assert.equal((mid as { error: { code: number } }).error.code, RPC_ERROR_CODES.NOT_INITIALIZED);

  await dispatcher.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  const ping = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 3, method: "ping" });
  assert.deepEqual(ping, { jsonrpc: "2.0", id: 3, result: {} });
});

// ─────────────────────────────── methods

test("tools/list returns the registry listing (name/description/inputSchema only)", async () => {
  const { dispatcher } = makeDispatcher();
  await handshake(dispatcher);
  const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/list" });
  assert.ok(reply && "result" in reply);
  const tools = (reply as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    ["task_sync_plan", "task_sync_status"],
  );
  assert.equal(tools[0]?.description, "d1");
  assert.deepEqual(tools[0]?.inputSchema, { type: "object", additionalProperties: false });
  assert.equal(Object.keys(tools[0] ?? {}).length, 3, "no extra members (no mutating flag on the wire)");
});

test("tools/list with cursor (or any) params ⇒ -32602", async () => {
  const { dispatcher } = makeDispatcher();
  await handshake(dispatcher);
  const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/list", params: { cursor: "x" } });
  assert.ok(reply && "error" in reply);
  assert.equal((reply as { error: { code: number } }).error.code, RPC_ERROR_CODES.INVALID_PARAMS);
});

test("unknown method ⇒ -32601 naming the method token only", async () => {
  const { dispatcher } = makeDispatcher();
  await handshake(dispatcher);
  const reply = await dispatcher.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "bogus/method",
    params: { canaryValue: "SUPER-SECRET-PARAM" },
  });
  assert.ok(reply && "error" in reply);
  const err = (reply as { error: { code: number; message: string } }).error;
  assert.equal(err.code, RPC_ERROR_CODES.METHOD_NOT_FOUND);
  assert.ok(err.message.includes("bogus/method"), `message should name the token: ${err.message}`);
  assert.ok(!err.message.includes("SUPER-SECRET-PARAM"), "message never carries presented params");
});

test("tools/call dispatches name/arguments; result passes through with isError semantics", async () => {
  const { dispatcher, stub } = makeDispatcher();
  await handshake(dispatcher);
  const reply = await dispatcher.handleMessage({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "task_sync_status", arguments: { any: 1 } },
  });
  assert.ok(reply && "result" in reply);
  assert.deepEqual(stub.calls, [{ name: "task_sync_status", args: { any: 1 } }]);
  assert.deepEqual((reply as { result: ToolCallResult }).result, {
    content: [{ type: "text", text: '{"echoed":"task_sync_status"}' }],
  });

  // isError:true tool results are still plain RESULTS, never JSON-RPC errors.
  const failing = createDispatcher({
    serverName: "t",
    serverVersion: "1",
    listTools: () => [],
    callTool: async () => ({ content: [{ type: "text", text: "no" }], isError: true }),
  });
  await handshake(failing);
  const errReply = await failing.handleMessage({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "task_sync_apply", arguments: {} },
  });
  assert.ok(errReply && "result" in errReply, "refusal stays a result");
  assert.equal((errReply as { result: ToolCallResult }).result.isError, true);
});

test("tools/call structural faults (params not object, name not string, arguments not object) ⇒ -32602", async () => {
  const { dispatcher } = makeDispatcher();
  await handshake(dispatcher);
  for (const params of [{}, "str", [1], { name: 5 }, { name: "x", arguments: "s" }, { name: "" }]) {
    const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params });
    assert.ok(reply && "error" in reply, `expected -32602 for ${JSON.stringify(params)}`);
    assert.equal((reply as { error: { code: number } }).error.code, RPC_ERROR_CODES.INVALID_PARAMS);
  }
});

test("missing arguments on tools/call behaves as {}", async () => {
  const { dispatcher, stub } = makeDispatcher();
  await handshake(dispatcher);
  await dispatcher.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "task_sync_plan" } });
  assert.deepEqual(stub.calls, [{ name: "task_sync_plan", args: {} }]);
});

// ─────────────────────────────── failure posture

test("handler rejection ⇒ -32603 with the FIXED text 'internal error' (never the exception message)", async () => {
  const { dispatcher } = makeDispatcher({
    callTool: async () => {
      throw new Error("secret internals /home/whoever/token=XYZ");
    },
  });
  await handshake(dispatcher);
  const reply = await dispatcher.handleMessage({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: { name: "task_sync_plan", arguments: {} },
  });
  assert.ok(reply && "error" in reply);
  const err = (reply as { error: { code: number; message: string } }).error;
  assert.equal(err.code, RPC_ERROR_CODES.INTERNAL_ERROR);
  assert.equal(err.message, "internal error");
});

test("notifications never get a response, including unknown notifications/*", async () => {
  const { dispatcher } = makeDispatcher();
  await handshake(dispatcher);
  for (const method of ["notifications/initialized", "notifications/cancelled", "notifications/weird"]) {
    assert.equal(await dispatcher.handleMessage({ jsonrpc: "2.0", method }), null);
  }
});

test("closed code set: nothing outside -32700/-32600/-32601/-32602/-32603/-32002 is ever emitted", async () => {
  const { dispatcher } = makeDispatcher({
    callTool: async () => {
      throw new Error("boom");
    },
  });
  const inputs: unknown[] = [
    { jsonrpc: "2.0", id: 1, method: "ping" }, // pre-init
    { jsonrpc: "2.0", id: 2, method: "initialize", params: "bad" },
    { jsonrpc: "1.0", id: 3, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 4, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 5, method: "no_such_method", params: { p: 1 } },
    { jsonrpc: "2.0", id: 6, method: "tools/list", params: { cursor: 1 } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: 5 } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 8, method: "no_such_method_2" },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "task_sync_plan", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "initialize", params: {} }, // second
  ];
  for (const raw of inputs) {
    const reply = await dispatcher.handleMessage(raw);
    if (reply !== null && "error" in reply) {
      assert.ok(CLOSED_CODES.has(reply.error.code), `emitted non-closed code ${reply.error.code}`);
      assert.equal(typeof reply.error.message, "string");
    }
  }
});

test("responses always echo the request id; invalid requests with no usable id answer id:null", async () => {
  const { dispatcher } = makeDispatcher();
  const reply = await dispatcher.handleMessage({ jsonrpc: "2.0", id: 77, method: "ping" });
  assert.ok(reply && "id" in reply);
  assert.equal((reply as { id: unknown }).id, 77);
  const broken = await dispatcher.handleMessage({ jsonrpc: "2.0", id: {}, method: "ping" });
  assert.ok(broken && "id" in broken);
  assert.equal((broken as { id: unknown }).id, null);
});

// ─────────────────────────────── serialization

test("serializeMessage emits one compact line with no raw newline", () => {
  const line = serializeMessage({ jsonrpc: "2.0", id: 1, result: { note: "line1\nline2" } });
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line).result.note, "line1\nline2");
});
