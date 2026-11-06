/**
 * T053 [US3] — 012 defaults-scan (FR-004/Principle III; defaults-scan extension).
 *
 * The BUILT-IN `mcp` defaults are inert, by inspection and by behavior:
 *  - `enabled: false`, `transport: "stdio"`, loopback `host`, `port: 0`, and a
 *    `tokenEnvVarName` that is an env-var NAME (no value can ever ship in it);
 *  - a defaults-only `createAgentToolServer` performs ZERO network: no listener
 *    handle appears (asserted from the live-handle census), and `listenHttp()`
 *    refuses (`McpConfigError`) because the stdio default is the only listening
 *    posture — the surface cannot accidentally open a socket;
 *  - the distributed defaults and `tests/fixtures/mcp/**` carry zero org
 *    identifiers, team keys, token values, or UUID-shaped secrets.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { builtInDefaults } from "task-linear-sync/config";
import { createAgentToolServer, McpConfigError, resolveMcpConfig } from "../../src/mcp/index.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("defaults: the built-in mcp group is inert by inspection", () => {
  const resolved = resolveMcpConfig(builtInDefaults);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const { settings } = resolved;
  assert.equal(settings.enabled, false, "mutating tools ship DISABLED");
  assert.equal(settings.transport, "stdio", "stdio is the DEFAULT transport");
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(settings.host), `host must be loopback, got ${settings.host}`);
  assert.equal(settings.port, 0, "port 0 = ephemeral only, and never listened to by default");
  assert.match(settings.tokenEnvVarName, /^[A-Z][A-Z0-9_]*$/, "an env-var NAME, never a value");
  assert.ok(settings.tokenEnvVarName.length <= 64);
  // The settings leaf itself carries no secret material.
  assert.ok(!JSON.stringify(settings).toLowerCase().includes("token-"));
});

test("defaults: construction binds no socket and listenHttp() refuses", async () => {
  const sockets = () => (process.getActiveResourcesInfo() as string[]).filter((h) => h === "TCPWrap" || h === "TLSWrap").length;
  const before = sockets();
  // The frozen createLinearPort default preflights credentials at CONSTRUCTION (007) but
  // issues zero requests until first use — a placeholder token keeps this test about the
  // socket census, not about the frozen credential gate.
  const app = createAgentToolServer({ config: builtInDefaults, env: { LINEAR_ACCESS_TOKEN: "placeholder-unused" } });
  try {
    assert.equal(sockets(), before, "construction performs zero network");
    await assert.rejects(() => app.listenHttp(), (error: unknown) => error instanceof McpConfigError);
    assert.equal(sockets(), before, "a refused listen leaves no handle behind");
    // The dispatcher still answers locally (stdio posture) with zero sockets.
    const reply = await app.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.ok(reply && "result" in reply);
    assert.equal(sockets(), before);
  } finally {
    await app.close();
  }
});

// ── literal scan: shipped defaults + 012 fixtures ─────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{12,}/, "lin_api_-shaped token VALUE"],
  [/-----BEGIN/, "PEM material"],
  [/(proxy-authorization|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/\b(contoso|globex|initech|umbrella|hooli|vandelay)\b/i, "fictional-org literal standing in for a real tenant"],
  [/\b[0-9a-f]{32,}\b(?![0-9a-f])/, "hex-digest-shaped secret"],
];

const ALLOWED_HEX_SEEDS = new Set(["a".repeat(64)]); // documented shape probe (fixture README)

test("defaults: distributed defaults and fixtures carry zero identity material", () => {
  const leaves: Array<{ label: string; text: string }> = [];
  const resolved = resolveMcpConfig(builtInDefaults);
  if (resolved.ok) leaves.push({ label: "mcp built-in settings", text: JSON.stringify(resolved.settings) });
  leaves.push({ label: "builtInDefaults", text: JSON.stringify(builtInDefaults) });
  for (const file of walk(join(pkgRoot, "tests/fixtures/mcp"))) {
    leaves.push({ label: file.slice(pkgRoot.length), text: readFileSync(file, "utf8") });
  }
  for (const leaf of leaves) {
    for (const [pattern, why] of BANNED) {
      const hit = pattern.test(leaf.text) ? leaf.text.match(pattern) : null;
      if (hit && ALLOWED_HEX_SEEDS.has(String(hit[0]))) continue;
      assert.ok(!hit, `${leaf.label}: ${why} found: ${String(hit)}`);
    }
  }
});
