/**
 * T032 [US1] — e2e US1 walkthrough on the 009 child-process pattern: a REAL spawned
 * stdio session at DEFAULT settings over the fake tracker. Tests written FIRST.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliWorldDir, hashTree } from "../helpers/cli-harness.js";
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

const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

function callLogMethods(stderr: string): string[] {
  const line = stderr.split("\n").find((l) => l.startsWith("MCP-CALL-LOG "));
  assert.ok(line, `driver stderr carries the MCP-CALL-LOG line; got: ${stderr.slice(-200)}`);
  return JSON.parse(line.slice("MCP-CALL-LOG ".length)) as string[];
}

test("mcp-user-stories: US2 walkthrough — enabled child plans then applies; a fresh child refuses the same reference (SC-001)", async () => {
  const worldDir = cliWorldDir("review-report");
  const confirmationKey = String(
    (JSON.parse(readFileSync(join(worldDir, "world.json"), "utf8")) as { config?: { confirmationKey?: string } }).config
      ?.confirmationKey,
  );
  assert.ok(confirmationKey, "the world fixture configures a confirmation key");
  const stateDir = join(scratch, "us2-state");

  // Child A: apply enabled — full plan → apply succeeds over the wire.
  const driverA = join(scratch, "driver-us2-apply.mjs");
  await emitMcpDriver({ driverPath: driverA, worldDir, stateDir, applyEnabled: true });
  const childA = spawnMcpDriver(driverA);
  let planReference = "";
  try {
    childA.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    await childA.waitFor((m) => m.id === 1);
    childA.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const list = await (async () => {
      childA.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      return childA.waitFor((m) => m.id === 2);
    })();
    const names = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    assert.equal(names.includes("task_sync_apply"), true, "apply is advertised when enabled");

    childA.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "task_sync_plan", arguments: {} } });
    const planPayload = JSON.parse(textOf(await childA.waitFor((m) => m.id === 3))) as { planReference: string };
    planReference = planPayload.planReference;

    childA.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "task_sync_apply",
        arguments: { planReference, confirmationKey, acceptLowConfidence: true },
      },
    });
    const applied = JSON.parse(textOf(await childA.waitFor((m) => m.id === 4))) as Record<string, unknown>;
    assert.equal(applied.status, "applied", JSON.stringify(applied));
    assert.ok((applied.counts as { applied: number }).applied > 0, `the run applied entries: ${JSON.stringify(applied)}`);
  } finally {
    const exitA = await childA.close();
    assert.equal(exitA.code, 0);
  }
  assert.ok(
    callLogMethods(childA.stderr).some((m) => MUTATING_METHODS.has(m)),
    "child A's fake port received the engine's mutations",
  );

  // Child B: fresh process, SAME state dir — the reference is another session's.
  const stateHash = hashTree(stateDir);
  const driverB = join(scratch, "driver-us2-fresh.mjs");
  await emitMcpDriver({ driverPath: driverB, worldDir, stateDir, applyEnabled: true });
  const childB = spawnMcpDriver(driverB);
  try {
    childB.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    await childB.waitFor((m) => m.id === 1);
    childB.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    childB.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "task_sync_apply", arguments: { planReference, confirmationKey, acceptLowConfidence: true } },
    });
    const refused = await childB.waitFor((m) => m.id === 2);
    const result = refused.result as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.ok(result.content[0]!.text.includes("PLAN_REFERENCE_UNKNOWN"), result.content[0]!.text);
    assert.ok(
      result.content[0]!.text.includes("task_sync_plan"),
      "the refusal points the agent at task_sync_plan",
    );
  } finally {
    const exitB = await childB.close();
    assert.equal(exitB.code, 0);
  }
  assert.deepEqual(
    callLogMethods(childB.stderr).filter((m) => MUTATING_METHODS.has(m)),
    [],
    "SC-001: the refusing child performed ZERO port mutations",
  );
  assert.equal(hashTree(stateDir), stateHash, "SC-001: the refusing child wrote NOTHING to the state dir");
});
