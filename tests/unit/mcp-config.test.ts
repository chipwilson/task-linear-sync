/**
 * T012 [P] — unit tests for the additive `mcp` settings group (T019) (data-model §3;
 * src/queue/config.ts precedent). resolveMcpConfig is a PURE read over the frozen
 * ResolvedConfig — the 001 schema is never edited and gains no new keys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, envVarPrefixFor } from "../../src/config/index.js";
import type { ResolvedConfig } from "../../src/config/index.js";
import { resolveMcpConfig } from "../../src/mcp/config.js";

function configWith(mcpLayer: Record<string, unknown>): ResolvedConfig {
  return loadConfig({ overrides: { mcp: mcpLayer as never } });
}

test("built-in defaults: enabled false, stdio, loopback, ephemeral port, derived token env-var NAME", () => {
  const config = loadConfig({});
  const result = resolveMcpConfig(config);
  assert.ok(result.ok, `unexpected problems: ${"errors" in result ? result.errors.join("; ") : ""}`);
  assert.deepEqual(result.settings, {
    enabled: false,
    transport: "stdio",
    host: "127.0.0.1",
    port: 0,
    tokenEnvVarName: `${envVarPrefixFor(config.toolId)}_MCP_TOKEN`,
  });
});

test("token env-var name is toolId-DERIVED at runtime (no literal), tracking config.toolId", () => {
  const custom = loadConfig({ overrides: { toolId: "my-cool-tool" } });
  const result = resolveMcpConfig(custom);
  assert.ok(result.ok);
  assert.equal(result.settings.tokenEnvVarName, "MY_COOL_TOOL_MCP_TOKEN");
});

test("config-file mcp group wins over built-ins (all five keys via the 012 key names)", () => {
  const result = resolveMcpConfig(
    configWith({ enabled: true, transport: "http", host: "loopback.local", port: 8123, tokenEnvVarName: "ACME_MCP_TOKEN" }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.settings, {
    enabled: true,
    transport: "http",
    host: "loopback.local",
    port: 8123,
    tokenEnvVarName: "ACME_MCP_TOKEN",
  });
});

test("frozen 001 trio maps into the group: mutatingToolsEnabled ⇒ enabled, authEnvVarName ⇒ tokenEnvVarName", () => {
  const result = resolveMcpConfig(configWith({ mutatingToolsEnabled: true, authEnvVarName: "LEGACY_MCP_TOKEN" }));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.settings.enabled, true);
  assert.equal(result.settings.tokenEnvVarName, "LEGACY_MCP_TOKEN");
});

test("012 key names take precedence over the frozen aliases in the same group", () => {
  const result = resolveMcpConfig(
    configWith({ mutatingToolsEnabled: false, enabled: true, authEnvVarName: "A_TOKEN", tokenEnvVarName: "B_TOKEN" }),
  );
  assert.ok(result.ok);
  assert.equal(result.settings.enabled, true);
  assert.equal(result.settings.tokenEnvVarName, "B_TOKEN");
});

test("programmatic settings overrides are the TOP layer (beating the config file)", () => {
  const config = configWith({ enabled: true, port: 8123, transport: "http", tokenEnvVarName: "FILE_TOKEN" });
  const result = resolveMcpConfig(config, { port: 9000 });
  assert.ok(result.ok);
  assert.equal(result.settings.port, 9000);
  assert.equal(result.settings.enabled, true); // untouched keys keep the file value
  assert.equal(result.settings.tokenEnvVarName, "FILE_TOKEN");
});

test("unknown keys ⇒ ok:false, ONE dotted-key problem line, pure defaults", () => {
  const result = resolveMcpConfig(configWith({ bogus: 1, another: "x" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1, "complete listing lands in exactly ONE line");
  assert.ok(result.errors[0]?.includes("mcp.bogus"));
  assert.ok(result.errors[0]?.includes("mcp.another"));
  assert.deepEqual(result.settings, resolveMcpConfig(loadConfig({})).settings, "pure defaults on failure");
});

test("out-of-range values collect ALL problems into one line (never fail-fast)", () => {
  const result = resolveMcpConfig(
    configWith({ transport: "grpc", port: 70000, host: "", tokenEnvVarName: "not a name!", enabled: "yes" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  const line = result.errors[0] ?? "";
  for (const key of ["mcp.transport", "mcp.port", "mcp.host", "mcp.tokenEnvVarName", "mcp.enabled"]) {
    assert.ok(line.includes(key), `line must name ${key}: ${line}`);
  }
  assert.deepEqual(result.settings, resolveMcpConfig(loadConfig({})).settings);
});

test("port must be an integer 0..65535; transport a closed enum; host non-empty; token name an env-var shape", () => {
  for (const bad of [-1, 1.5, 65536, "80"] as const) {
    assert.equal(resolveMcpConfig(configWith({ port: bad as never })).ok, false, `port ${String(bad)}`);
  }
  for (const ok of [0, 1, 65535]) {
    assert.ok(resolveMcpConfig(configWith({ port: ok })).ok, `port ${ok}`);
  }
  assert.ok(resolveMcpConfig(configWith({ transport: "stdio" })).ok);
  assert.ok(resolveMcpConfig(configWith({ transport: "http" })).ok);
  assert.equal(resolveMcpConfig(configWith({ host: "   " })).ok, false);
  assert.equal(resolveMcpConfig(configWith({ tokenEnvVarName: "lower_case" })).ok, false, "env-var NAME pattern");
  assert.ok(resolveMcpConfig(configWith({ tokenEnvVarName: "X1_MCP_TOKEN" })).ok);
});

test("programmatic overrides validate with the same rules (unknown override key ⇒ one problem line)", () => {
  const result = resolveMcpConfig(loadConfig({}), { nonsense: 5 } as never);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0]?.includes("nonsense"));
});

test("the read is PURE over ResolvedConfig — the frozen config object is never mutated", () => {
  const config = configWith({ enabled: true, port: 1234 });
  const before = JSON.stringify(config);
  resolveMcpConfig(config);
  resolveMcpConfig(config, { port: 4321 });
  assert.equal(JSON.stringify(config), before);
});

test("frozen defaults alone (mutatingToolsEnabled:false + transport + authEnvVarName) are NOT flagged as unknown", () => {
  // The resolved config ALWAYS carries the frozen trio from 001 defaults; the group
  // must accept them — otherwise every resolution would fail out of the box.
  const config = loadConfig({});
  assert.ok(Object.hasOwn(config.mcp, "mutatingToolsEnabled"), "precondition: frozen trio present");
  assert.ok(resolveMcpConfig(config).ok);
});
