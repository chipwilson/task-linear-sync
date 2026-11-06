/**
 * T031 [US1] — integration: quickstart Scenarios 1 + 4 over the T024 in-process
 * line pipe (`serveStdio` on harness streams) + FakeTracker. Tests written FIRST.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { hashTree } from "../helpers/cli-harness.js";
import { withMcpServer } from "../helpers/mcp-harness.js";
import type { JsonRpcMessage, McpFixture } from "../helpers/mcp-harness.js";

const BIG = " ".repeat(1024 * 1024 + 1);

async function toolsList(fx: McpFixture): Promise<string[]> {
  const response = await fx.request("tools/list");
  const result = response.result as { tools: Array<{ name: string }> };
  return result.tools.map((t) => t.name);
}

function toolPayload(response: JsonRpcMessage): Record<string, unknown> {
  const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  assert.notEqual(result.isError, true, `tool call refused: ${JSON.stringify(result)}`);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

test("mcp-stdio: full handshake — pre-init ping refused, version echo, initialized silent", async () => {
  await withMcpServer(async (fx) => {
    const prePing = await fx.request("ping");
    assert.equal((prePing.error as { code: number }).code, -32002);

    const init = await fx.request("initialize", { protocolVersion: "2024-11-05" });
    const initResult = init.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    assert.equal(initResult.protocolVersion, "2024-11-05", "echoes a supported version");
    assert.deepEqual(initResult.capabilities, { tools: {} });
    assert.equal(initResult.serverInfo.name, `${fx.world.config.toolId}-mcp`);

    const before = fx.lines.length;
    fx.notify("notifications/initialized");
    const afterInit = await fx.request("ping");
    assert.deepEqual(afterInit.result, {});
    assert.equal(fx.lines.length, before + 1, "the notification produced NO line of its own");
  });
});

test("mcp-stdio: tools/list is exactly the three read-only tools at defaults", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    assert.deepEqual((await toolsList(fx)).sort(), ["task_sync_inventory", "task_sync_plan", "task_sync_status"]);
  });
});

test("mcp-stdio: real read tools answer end-to-end — plan embeds the report, status reflects seeded fixtures", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();

    const plan = toolPayload(await fx.request("tools/call", { name: "task_sync_plan", arguments: {} }));
    assert.match(String(plan.planReference), /^[0-9a-f]{64}$/);
    assert.ok(plan.report, "embedded report present");
    assert.equal((plan.report as Record<string, unknown>).planId, plan.planReference);

    const inventory = toolPayload(await fx.request("tools/call", { name: "task_sync_inventory", arguments: {} }));
    assert.ok(Array.isArray(inventory.files));

    await fx.world.state.writeJson("last-run.json", {
      runId: "c".repeat(64),
      outcome: "completed",
      completedAt: "2026-01-04T05:06:07.000Z",
      reportPaths: null,
      notificationSuppressed: false,
    });
    const status = toolPayload(await fx.request("tools/call", { name: "task_sync_status", arguments: {} }));
    assert.equal((status.lastRun as Record<string, unknown>).runId, "c".repeat(64));
    assert.deepEqual(status.session, { planReferencesAvailable: 1 }, "the plan call above recorded its reference");
  });
});

test("mcp-stdio: malformed line ⇒ -32700 with null id and the session KEEPS serving", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    fx.send("{oops this is not json");
    const broken = await fx.waitFor((m) => "error" in m);
    assert.equal((broken.error as { code: number }).code, -32700);
    assert.equal(broken.id, null);
    const ping = await fx.request("ping");
    assert.deepEqual(ping.result, {});
  });
});

test("mcp-stdio: a 1 MiB + 1 line is refused and dropped — the connection continues", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    fx.send(`${BIG}"oversize tail`);
    const oversize = await fx.waitFor((m) => "error" in m && (m.error as { code: number }).code === -32700);
    assert.equal(oversize.id, null);
    const ping = await fx.request("ping");
    assert.deepEqual(ping.result, {});
  });
});

test("mcp-stdio: tools/list with params (cursor) ⇒ -32602; unknown tool ⇒ isError result, never -32601", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    const bad = await fx.request("tools/list", { cursor: "anything" });
    assert.equal((bad.error as { code: number }).code, -32602);

    const unknown = await fx.request("tools/call", { name: "task_sync_nope", arguments: {} });
    assert.equal(unknown.error, undefined, "unknown tool is a RESULT, not a protocol error");
    const result = unknown.result as { isError: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /unknown tool/);
  });
});

test("mcp-stdio: SC-002 — read tools make zero port mutations and leave the repo tree byte-equal", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    const repoHash = hashTree(fx.world.repositoryRoot);

    for (const name of ["task_sync_plan", "task_sync_inventory", "task_sync_status"]) {
      const response = await fx.request("tools/call", { name, arguments: {} });
      assert.notEqual((response.result as { isError?: boolean }).isError, true, `${name} failed`);
    }

    for (const call of fx.world.fake.callLog) {
      assert.equal(
        ["createIssue", "updateIssue", "archiveIssue", "upsertAttachmentByUrl", "updateAttachment"].includes(call.method),
        false,
        `SC-002 violation — mutation call ${call.method}`,
      );
    }
    assert.equal(hashTree(fx.world.repositoryRoot), repoHash, "repo tree byte-equal");
  }, { profile: "zero-task" });
});

test("mcp-stdio: stdout carries protocol frames ONLY (stderr captured separately)", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    await fx.request("tools/call", { name: "task_sync_plan", arguments: {} });
    await fx.request("tools/call", { name: "task_sync_inventory", arguments: {} });
    fx.send("### raw junk ###");
    await fx.waitFor((m) => "error" in m);
    for (const line of fx.lines) {
      assert.doesNotThrow(() => JSON.parse(line), `non-protocol line on stdout: ${line.slice(0, 80)}`);
    }
    assert.ok(Array.isArray(fx.stderrLines), "stderr captured apart from the protocol stream");
  });
});

// ── T036 (feature 014) — quickstart Scenario 5 negotiation rows over the real
// stdio line transport (one fresh connection per row; FR-010) ────────────────

test("mcp-stdio: Scenario 5 — every negotiation row over the real line pipe", async () => {
  for (const [sent, echo] of [
    ["2025-06-18", "2025-06-18"],
    ["2025-03-26", "2025-03-26"],
    ["2024-11-05", "2024-11-05"],
    ["2099-01-01", "2025-06-18"], // unsupported ⇒ newest supported
    ["not-a-date", "2025-06-18"],
  ] as const) {
    await withMcpServer(async (fx) => {
      const init = await fx.request("initialize", { protocolVersion: sent });
      const result = init.result as { protocolVersion: string };
      assert.equal(result.protocolVersion, echo, `wire echo for ${sent}`);
    });
  }

  // Non-string protocolVersion ⇒ -32602 on the wire; the handshake stays
  // retryable, and the completed session still lists exactly the three tools.
  await withMcpServer(async (fx) => {
    const bad = await fx.request("initialize", { protocolVersion: 42 });
    assert.equal((bad.error as { code: number }).code, -32602);
    assert.equal((bad.error as { message: string }).message, "invalid params");

    const retry = await fx.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal((retry.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
    fx.notify("notifications/initialized");
    assert.deepEqual((await toolsList(fx)).sort(), ["task_sync_inventory", "task_sync_plan", "task_sync_status"]);
  });
});
