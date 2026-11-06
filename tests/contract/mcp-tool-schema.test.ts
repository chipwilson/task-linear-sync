/**
 * T015 [P] — contract test for the published tool schema (FR-002/FR-003/SC-003):
 * the four inputSchema literals are frozen against contracts/tool-definitions.md §2,
 * and visibility holds across repeated sessions. Consumes ONLY the public entry
 * `task-linear-sync/mcp` (plus test helpers).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAgentToolServer, TOOL_DEFINITIONS, TOOL_NAMES } from "task-linear-sync/mcp";
import { buildCliWorld, type CliWorld } from "../helpers/cli-harness.js";

const FROZEN_SCHEMAS: Readonly<Record<string, unknown>> = {
  task_sync_plan: { type: "object", additionalProperties: false },
  task_sync_status: { type: "object", additionalProperties: false },
  task_sync_inventory: { type: "object", additionalProperties: false },
  task_sync_apply: {
    type: "object",
    additionalProperties: false,
    required: ["planReference", "confirmationKey"],
    properties: {
      planReference: { type: "string", pattern: "^[0-9a-f]{64}$" },
      confirmationKey: { type: "string", minLength: 1 },
      acceptLowConfidence: { type: "boolean", default: false },
    },
  },
};

async function withServer(
  fn: (world: CliWorld, listTools: () => Promise<Array<{ name: string; description: string; inputSchema: unknown }>>) => Promise<void>,
  settings: Record<string, unknown> = {},
): Promise<void> {
  const world = await buildCliWorld("review-report");
  try {
    const app = createAgentToolServer({
      config: world.config,
      state: world.state,
      port: world.port,
      screener: world.world.screener,
      clock: world.clock,
      env: world.env,
      repositoryRoot: world.repositoryRoot,
      settings: settings as never,
    });
    async function listTools() {
      await app.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
      await app.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
      const reply = await app.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      assert.ok(reply !== null && "result" in reply, `tools/list failed: ${JSON.stringify(reply)}`);
      return (reply.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
    }
    await fn(world, listTools);
    await app.close();
  } finally {
    await world.dispose();
  }
}

test("the four published inputSchema literals equal the frozen contract tables verbatim", async () => {
  await withServer(async (_world, listTools) => {
    await listTools(); // warm the session (schemas are static data regardless)
    assert.deepEqual([...TOOL_NAMES].sort(), Object.keys(FROZEN_SCHEMAS).sort());
    for (const def of TOOL_DEFINITIONS) {
      assert.deepEqual(def.inputSchema, FROZEN_SCHEMAS[def.name], `${def.name} schema drifted from the contract`);
    }
    // The published listing carries the same literals.
    const published = await listTools();
    const apply = published.find((t) => t.name === "task_sync_apply");
    assert.equal(apply, undefined, "defaults never advertise apply");
  });
});

test("defaults list EXACTLY the three read-only tools with the frozen schemas on the wire", async () => {
  await withServer(async (_world, listTools) => {
    const published = await listTools();
    assert.deepEqual(
      published.map((t) => t.name).sort(),
      ["task_sync_inventory", "task_sync_plan", "task_sync_status"],
    );
    for (const tool of published) {
      assert.deepEqual(tool.inputSchema, FROZEN_SCHEMAS[tool.name]);
    }
  });
});

test("SC-003: across repeated sessions at defaults, 100% of listings omit task_sync_apply", async () => {
  await withServer(async (_world, listTools) => {
    for (let session = 0; session < 5; session += 1) {
      const published = await listTools();
      assert.ok(!published.some((t) => t.name === "task_sync_apply"), `session ${session} leaked apply`);
    }
  });
});

test("enabled:true adds EXACTLY apply to the listing — nothing else changes", async () => {
  await withServer(async (_world, listTools) => {
    const published = await listTools();
    assert.deepEqual(
      published.map((t) => t.name).sort(),
      ["task_sync_apply", "task_sync_inventory", "task_sync_plan", "task_sync_status"],
    );
    const apply = published.find((t) => t.name === "task_sync_apply");
    assert.deepEqual(apply?.inputSchema, FROZEN_SCHEMAS.task_sync_apply);
  }, { enabled: true });
});

test("descriptions carry placeholder identifiers only", async () => {
  const serialized = JSON.stringify(TOOL_DEFINITIONS.map((t) => t.description));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized));
  assert.ok(!serialized.includes("linear.app"));
});
