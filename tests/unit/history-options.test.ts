/**
 * T004 — settings resolution unit tests (contracts/component-api.md §2,
 * data-model §4). The resolver is a pure read of the frozen `web` group with
 * construction-time range guards; every problem is listed, one dotted-key
 * line each.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { builtInDefaults } from "../../src/config/defaults.js";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigOverrides } from "../../src/config/schema.js";
import { resolveHistoryServerConfig } from "../../src/history-server/options.js";

function configWith(web: Record<string, unknown>) {
  return loadConfig({ overrides: { web } as unknown as ConfigOverrides });
}

test("built-in defaults resolve to the documented surface settings, including the 014 bounds", () => {
  const settings = resolveHistoryServerConfig(loadConfig({}));
  assert.deepEqual(settings, {
    accessMode: "private",
    tokenEnvVarName: "TASK_LINEAR_SYNC_WEB_TOKEN",
    sseEnabled: true,
    refreshSeconds: 15,
    cacheTtlSeconds: 10,
    maxCacheEntries: 500, // amendment 2026-11-06
    maxConcurrentWalks: 8, // amendment 2026-11-06
    maxConcurrentSseStreams: 16, // amendment 2026-11-06
    secureCookies: false, // amendment 2026-11-06
  });
  assert.equal(builtInDefaults.web.cacheTtlSeconds, 10);
  assert.equal(builtInDefaults.web.pollIntervalSeconds, 15);
});

test("the 014 web defaults equal the documented bounds-table defaults (docs/configuration.md)", () => {
  // The table's Default column is the normative source; drift here would make the
  // shipped behavior disagree with the documented defaults (a changed DEFAULT value).
  const web = builtInDefaults.web;
  assert.equal(web.maxCacheEntries, 500);
  assert.equal(web.maxConcurrentWalks, 8);
  assert.equal(web.maxConcurrentSseStreams, 16);
  assert.equal(web.secureCookies, false);
});

test("tokenEnvVarName comes from web.authEnvVarName (toolId-derived)", () => {
  const config = loadConfig({ overrides: { toolId: "other-tool" } });
  const settings = resolveHistoryServerConfig(config);
  assert.equal(settings.tokenEnvVarName, config.web.authEnvVarName);
  assert.equal(settings.tokenEnvVarName, "OTHER_TOOL_WEB_TOKEN");
});

test("explicit web overrides resolve through unchanged", () => {
  const settings = resolveHistoryServerConfig(
    configWith({ accessControlMode: "public", pollIntervalSeconds: 2, cacheTtlSeconds: 0 }),
  );
  assert.equal(settings.accessMode, "public");
  assert.equal(settings.refreshSeconds, 2);
  assert.equal(settings.cacheTtlSeconds, 0);
});

test("range guards reject out-of-range numeric values", () => {
  assert.throws(
    () => resolveHistoryServerConfig(configWith({ pollIntervalSeconds: 0 })),
    /web\.pollIntervalSeconds.*1\.\.3600/s,
  );
  assert.throws(
    () => resolveHistoryServerConfig(configWith({ pollIntervalSeconds: 3601 })),
    /web\.pollIntervalSeconds/s,
  );
  assert.throws(
    () => resolveHistoryServerConfig(configWith({ pollIntervalSeconds: 1.5 })),
    /web\.pollIntervalSeconds/s,
  );
  assert.throws(
    () => resolveHistoryServerConfig(configWith({ cacheTtlSeconds: -1 })),
    /web\.cacheTtlSeconds.*0\.\.3600/s,
  );
  assert.throws(
    () => resolveHistoryServerConfig(configWith({ cacheTtlSeconds: 3601 })),
    /web\.cacheTtlSeconds/s,
  );
  // Bounds themselves are valid.
  assert.equal(resolveHistoryServerConfig(configWith({ pollIntervalSeconds: 3600 })).refreshSeconds, 3600);
  assert.equal(resolveHistoryServerConfig(configWith({ cacheTtlSeconds: 0 })).cacheTtlSeconds, 0);
});

test("all problems are listed together, one dotted-key line each", () => {
  const bad = configWith({ pollIntervalSeconds: 0, cacheTtlSeconds: 9999, authEnvVarName: " " });
  let message = "";
  assert.throws(() => resolveHistoryServerConfig(bad), (error: unknown) => {
    assert.ok(error instanceof Error);
    message = error.message;
    return true;
  });
  const lines = message.split("\n").filter((line) => /^\s*web\./.test(line));
  assert.ok(
    lines.some((line) => line.includes("web.pollIntervalSeconds")),
    "pollIntervalSeconds problem listed",
  );
  assert.ok(
    lines.some((line) => line.includes("web.cacheTtlSeconds")),
    "cacheTtlSeconds problem listed",
  );
  assert.ok(
    lines.some((line) => line.includes("web.authEnvVarName")),
    "authEnvVarName problem listed",
  );
});

test("resolver never mutates the config (pure read, no new keys)", () => {
  const config = loadConfig({});
  const before = structuredClone(config);
  resolveHistoryServerConfig(config);
  assert.deepEqual(config, before);
});

// ── T017 (feature 014) — guards for the four amended web.* keys
// (resource-bounds.md §1/§2–4; ranges quoted verbatim from configuration.md amendment)

test("the 014 bounds guards reject out-of-range values, quoting the range", () => {
  // web.maxCacheEntries — integer 1..100000
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxCacheEntries: 0 })), /web\.maxCacheEntries.*1\.\.100000/s);
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxCacheEntries: 100001 })), /web\.maxCacheEntries/s);
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxCacheEntries: 2.5 })), /web\.maxCacheEntries/s);
  // web.maxConcurrentWalks — integer 1..64
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxConcurrentWalks: 0 })), /web\.maxConcurrentWalks.*1\.\.64/s);
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxConcurrentWalks: 65 })), /web\.maxConcurrentWalks/s);
  // web.maxConcurrentSseStreams — integer 1..1000
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxConcurrentSseStreams: 0 })), /web\.maxConcurrentSseStreams.*1\.\.1000/s);
  assert.throws(() => resolveHistoryServerConfig(configWith({ maxConcurrentSseStreams: 1001 })), /web\.maxConcurrentSseStreams/s);
  // web.secureCookies — boolean
  assert.throws(() => resolveHistoryServerConfig(configWith({ secureCookies: "yes" })), /web\.secureCookies/s);
  // Bounds themselves resolve.
  const bounds = resolveHistoryServerConfig(
    configWith({ maxCacheEntries: 100000, maxConcurrentWalks: 64, maxConcurrentSseStreams: 1000, secureCookies: true }),
  );
  assert.equal(bounds.maxCacheEntries, 100000);
  assert.equal(bounds.maxConcurrentWalks, 64);
  assert.equal(bounds.maxConcurrentSseStreams, 1000);
  assert.equal(bounds.secureCookies, true);
  assert.equal(resolveHistoryServerConfig(configWith({ maxCacheEntries: 1 })).maxCacheEntries, 1);
});

test("all four 014 problems are listed at once, one dotted-key line each", () => {
  const bad = configWith({ maxCacheEntries: 0, maxConcurrentWalks: 99, maxConcurrentSseStreams: 0, secureCookies: 1 });
  let message = "";
  assert.throws(() => resolveHistoryServerConfig(bad), (error: unknown) => {
    assert.ok(error instanceof Error);
    message = error.message;
    return true;
  });
  const lines = message.split("\n").filter((line) => /^\s*web\./.test(line));
  for (const key of ["web.maxCacheEntries", "web.maxConcurrentWalks", "web.maxConcurrentSseStreams", "web.secureCookies"]) {
    assert.ok(lines.some((line) => line.includes(key)), `${key} problem listed`);
  }
  assert.equal(lines.length, 4, "exactly one line per offending key");
});
