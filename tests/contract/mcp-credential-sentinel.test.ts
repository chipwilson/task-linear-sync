/**
 * T051 [US3] — credential-sentinel security sweep for 012 (FR-005, SC-002/SC-005;
 * transport-auth.md §3; precedent `tracker-credential-sentinel.test.ts`).
 *
 * The sentinel is planted as the MCP token env value AND as hostile fixture text
 * (a poisoned issue title carrying sentinel + `lin_api_` credential bait). The
 * FULL matrix is driven — stdio + http × enabled/disabled × pre/post-init ×
 * 401/403/404/405/413/(-32700 stdio oversize)/× success/refusal — and EVERY
 * emitted byte (protocol frames, HTTP bodies, stderr lines) must be sentinel-free.
 * The presented `confirmationKey` is never echoed; blocked material ships only the
 * `[blocked:<category>]` sentinel, never source text.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startMcpFixture, withHttpServer } from "../helpers/mcp-harness.js";
import type { McpFixture } from "../helpers/mcp-harness.js";

const SENTINEL = "MCP-SENTINEL-4f9e2c8a1b7d";
const CREDENTIAL_BAIT = "lin_api_PlantedFakeSecret0123456789abc";

const seen: Array<{ label: string; bytes: string }> = [];
function record(label: string, bytes: string): void {
  seen.push({ label, bytes });
}

function assertClean(): void {
  for (const entry of seen) {
    assert.ok(!entry.bytes.includes(SENTINEL), `${entry.label}: sentinel leaked: ${entry.bytes.slice(0, 300)}`);
    assert.ok(!entry.bytes.includes(CREDENTIAL_BAIT), `${entry.label}: credential bait leaked: ${entry.bytes.slice(0, 300)}`);
  }
}

function probeFixture(label: string, fx: McpFixture): void {
  for (const [index, line] of fx.lines.entries()) record(`${label} frame#${index}`, line);
  for (const [index, line] of fx.stderrLines.entries()) record(`${label} stderr#${index}`, line);
}

/** Poisoned cli world: sentinel + credential bait planted in a tracker title. */
function poisonWorld(): string {
  const root = mkdtempSync(join(tmpdir(), "tls-012-sentinel-"));
  const dir = join(root, "poison-world");
  cpSync(join(process.cwd(), "tests/fixtures/cli/worlds/review-report"), dir, { recursive: true });
  const doc = JSON.parse(readFileSync(join(dir, "world.json"), "utf8")) as {
    name: string;
    issues: Array<{ key: string; title: string }>;
  };
  doc.name = "poison-world";
  const issue = doc.issues.find((entry) => entry.key === "ACME-1");
  assert.ok(issue, "poison target ACME-1 exists");
  issue!.title = `Align ledger ${CREDENTIAL_BAIT} ${SENTINEL}`;
  writeFileSync(join(dir, "world.json"), JSON.stringify(doc, null, 2));
  return dir;
}

async function callTool(fx: McpFixture, name: string, args: Record<string, unknown>): Promise<void> {
  const response = await fx.request("tools/call", { name, arguments: args });
  record(`tools/call ${name}`, JSON.stringify(response));
  const first = (response as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text;
  if (first !== undefined) {
    assert.ok(!first.includes(SENTINEL), `confirmationKey/sentinel echoed in a tool payload: ${first.slice(0, 300)}`);
  }
}

test("sentinel sweep — stdio, disabled (default), pre/post-init probes", async () => {
  const fx = await startMcpFixture({ profile: "zero-task", token: SENTINEL });
  try {
    // Pre-init hostile probes: the replies must never echo what they rejected.
    fx.send(`{broken json ${SENTINEL}`);
    fx.send(`{"jsonrpc":"2.0","id":"p1","method":"probe/${SENTINEL}","params":{}}`);
    await fx.waitFor((m) => m.id === null || m.id === "p1", 5_000);
    await callTool(fx, `task_sync_${SENTINEL}`, {}); // unknown tool, sentinel-shaped name
    await callTool(fx, "task_sync_apply", { planReference: "a".repeat(64), confirmationKey: SENTINEL }); // disabled ⇒ refused
    await fx.initialize();
    record("tools/list", JSON.stringify(await fx.request("tools/list", {})));
    await callTool(fx, "task_sync_status", {});
    // Oversized line (> 1 MiB) ⇒ -32700, connection continues.
    fx.send(`{"jsonrpc":"2.0","id":"big","method":"ping","pad":"${SENTINEL}${"q".repeat(1_048_576)}"}`);
    await fx.waitFor((m) => m.id === "big", 5_000).catch(() => undefined);
    probeFixture("stdio-disabled", fx);
  } finally {
    await fx.close();
  }
  assertClean();
});

test("sentinel sweep — stdio, enabled, poisoned world, wrong confirmationKey", async () => {
  const dir = poisonWorld();
  const fx = await startMcpFixture({ profile: dir, token: SENTINEL, settings: { enabled: true } });
  try {
    await fx.initialize();
    record("tools/list", JSON.stringify(await fx.request("tools/list", {})));
    const plan = await fx.request("tools/call", { name: "task_sync_plan", arguments: {} });
    record("plan(poisoned)", JSON.stringify(plan));
    const planText = (plan as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? "";
    const planReference = (JSON.parse(planText) as { planReference: string }).planReference;
    // The presented confirmationKey carries the sentinel: mismatch refuses, never echoes.
    await callTool(fx, "task_sync_apply", { planReference, confirmationKey: SENTINEL, acceptLowConfidence: true });
    await callTool(fx, "task_sync_apply", { planReference, confirmationKey: CREDENTIAL_BAIT, acceptLowConfidence: true });
    await callTool(fx, "task_sync_inventory", {});
    await callTool(fx, "task_sync_status", {});
    probeFixture("stdio-enabled", fx);
  } finally {
    await fx.close();
  }
  assertClean();
});

test("sentinel sweep — http, poisoned world, full refusal matrix", async () => {
  const dir = poisonWorld();
  await withHttpServer(
    async (fx) => {
      const bodies: Array<{ label: string; body: string; headers: [string, string][] }> = [];
      const grab = async (label: string, init: RequestInit, url = fx.url): Promise<void> => {
        const response = await fetch(url, init);
        bodies.push({
          label,
          body: await response.text(),
          headers: [...response.headers.entries()],
        });
      };
      const hostileBody = (id: unknown): string =>
        JSON.stringify({ jsonrpc: "2.0", id, method: `probe/${SENTINEL}`, params: { echo: SENTINEL } });

      // Pre-auth matrix (401/403) — bodies constant, headers never carry the token.
      await grab("401", { method: "POST", headers: { "content-type": "application/json" }, body: hostileBody(1) });
      await grab("403", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL}-extended` },
        body: hostileBody(2),
      });
      await grab("405", { method: "GET", headers: { authorization: `Bearer ${SENTINEL}x` } });
      await grab("404", { method: "POST", headers: { authorization: `Bearer ${SENTINEL}x` }, body: "{}" }, new URL("/nope", fx.url).href);
      await grab("413", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL}-x` },
        body: `${SENTINEL}${"z".repeat(1_048_577)}`,
      });

      // Authenticated round (the fixture token IS the sentinel).
      await grab("init", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }) });
      await grab("tools/list", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }) });
      await grab("parse-fail", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL}` }, body: `{oops ${SENTINEL}` });
      await grab("post-401", { method: "POST", headers: { "content-type": "application/json" }, body: hostileBody(5) });

      for (const entry of bodies) {
        record(`http-${entry.label}`, entry.body);
        for (const [name, value] of entry.headers) record(`http-${entry.label} header:${name}`, value);
      }
      const fourOhOne = bodies.find((b) => b.label === "401");
      const fourOhThree = bodies.find((b) => b.label === "403");
      assert.equal(fourOhOne?.body, '{"error":"UNAUTHORIZED"}');
      assert.equal(fourOhThree?.body, '{"error":"FORBIDDEN"}');
    },
    { profile: dir, token: SENTINEL },
  );
  assertClean();
});

test("sentinel sweep — blocked material never ships source text", async () => {
  // The poisoned title (credential bait + sentinel) must never reach ANY payload;
  // wherever screening substitutes it, only the [blocked:<category>] sentinel form ships.
  const dir = poisonWorld();
  const fx = await startMcpFixture({ profile: dir, token: SENTINEL, settings: { enabled: true } });
  try {
    await fx.initialize();
    for (const name of ["task_sync_plan", "task_sync_inventory", "task_sync_status"]) {
      const response = await fx.request("tools/call", { name, arguments: {} });
      record(`blocked-scan ${name}`, JSON.stringify(response));
    }
    probeFixture("blocked-scan", fx);
  } finally {
    await fx.close();
  }
  assertClean();
});
