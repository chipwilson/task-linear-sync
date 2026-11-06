/**
 * T032 [US1] — e2e US1 walkthrough on the 009 child-process pattern: a REAL spawned
 * stdio session at DEFAULT settings over the fake tracker. Tests written FIRST.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliWorldDir } from "../helpers/cli-harness.js";
import { emitMcpDriver, spawnMcpDriver } from "../helpers/mcp-harness.js";

const scratch = await mkdtemp(join(tmpdir(), "tls-012-e2e-us1-"));

test.after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test("mcp-user-stories: US1 walkthrough — initialize → list → plan/inventory/status over a spawned stdio child", async () => {
  const driverPath = join(scratch, "driver-stdio.mjs");
  await emitMcpDriver({ driverPath, worldDir: cliWorldDir("review-report") });
  const child = spawnMcpDriver(driverPath);
  try {
    child.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    const init = await child.waitFor((m) => m.id === 1);
    assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name.endsWith("-mcp"), true);
    child.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const list = await (async () => {
      child.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      return child.waitFor((m) => m.id === 2);
    })();
    const names = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    assert.deepEqual(names.sort(), ["task_sync_inventory", "task_sync_plan", "task_sync_status"]);

    child.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "task_sync_plan", arguments: {} } });
    const plan = await child.waitFor((m) => m.id === 3);
    const planResult = plan.result as { content: Array<{ text: string }> };
    const payload = JSON.parse(planResult.content[0]!.text) as Record<string, unknown>;
    assert.match(String(payload.planReference), /^[0-9a-f]{64}$/);
    assert.ok(payload.report, "the text block parses as stable-key JSON with the report present");

    child.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "task_sync_inventory", arguments: {} } });
    const inventory = JSON.parse(
      textOf(await child.waitFor((m) => m.id === 4)),
    ) as Record<string, unknown>;
    assert.ok(Array.isArray(inventory.files));

    child.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "task_sync_status", arguments: {} } });
    const status = JSON.parse(textOf(await child.waitFor((m) => m.id === 5))) as Record<string, unknown>;
    assert.deepEqual(status.session, { planReferencesAvailable: 1 });
  } finally {
    // "promptly": the node test timeout fails the test if the child hangs.
    const exit = await child.close();
    assert.equal(exit.code, 0);
  }
});

function textOf(message: Record<string, unknown>): string {
  return (message.result as { content: Array<{ text: string }> }).content[0].text;
}

test("mcp-user-stories: stdout is protocol-only and malformed traffic never kills the child", async () => {
  const driverPath = join(scratch, "driver-robust.mjs");
  await emitMcpDriver({ driverPath, worldDir: cliWorldDir("zero-task") });
  const child = spawnMcpDriver(driverPath);
  try {
    child.send("{not json at all");
    const parseError = await child.waitFor((m) => "error" in m && (m.error as { code: number }).code === -32700);
    assert.equal(parseError.id, null);

    child.send(`${"x".repeat(1024 * 1024 + 8)}`);
    child.send("### raw junk ###");

    child.send({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    const alive = await child.waitFor((m) => m.id === 7);
    assert.ok(alive.result, "the session still answers after garbage");

    for (const line of child.lines) {
      assert.doesNotThrow(() => JSON.parse(line), `non-protocol stdout line: ${line.slice(0, 80)}`);
    }
  } finally {
    await child.close();
  }
});
