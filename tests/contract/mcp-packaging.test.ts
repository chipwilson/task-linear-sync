/**
 * T016 [P] — packaging contract test (contracts/component-api.md §4): the additive
 * `./mcp` export resolves to built dist files with generated .d.ts, the public surface
 * exports the §2 names, the manifest bin map and dependency budget are untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { join, dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  exports: Record<string, Record<string, string>>;
  dependencies?: Record<string, string>;
};

test("package exports contain the additive ./mcp entry (types + default, dist paths)", () => {
  assert.deepEqual(manifest.exports["./mcp"], {
    types: "./dist/mcp/index.d.ts",
    default: "./dist/mcp/index.js",
  });
});

test("the ./mcp entry resolves to BUILT files with generated .d.ts", async () => {
  const entry = require.resolve("task-linear-sync/mcp");
  assert.ok(entry.endsWith(join("dist", "mcp", "index.js")), `resolved to ${entry}`);
  assert.ok(existsSync(entry), "built index.js exists");
  const types = entry.replace(/index\.js$/, "index.d.ts");
  assert.ok(existsSync(types), "generated index.d.ts exists");
  const dts = readFileSync(types, "utf8");
  for (const name of ["createAgentToolServer", "resolveMcpConfig", "McpConfigError", "TOOL_NAMES", "ToolDefinition"]) {
    assert.ok(dts.includes(name), `public type surface must carry ${name}`);
  }
});

test("runtime exports match component-api.md §2", async () => {
  const mcp = (await import("task-linear-sync/mcp")) as Record<string, unknown>;
  assert.equal(typeof mcp.createAgentToolServer, "function");
  assert.equal(typeof mcp.resolveMcpConfig, "function");
  assert.equal(typeof mcp.McpConfigError, "function");
  assert.equal(typeof mcp.createPlanReferenceStore, "function");
  assert.ok(Array.isArray(mcp.TOOL_NAMES));
  assert.equal(mcp.TOOL_NAMES.length, 4);
  for (const constant of [
    "TOOL_DEFINITIONS",
    "TASK_SYNC_PLAN_TOOL",
    "TASK_SYNC_STATUS_TOOL",
    "TASK_SYNC_INVENTORY_TOOL",
    "TASK_SYNC_APPLY_TOOL",
  ]) {
    assert.ok(mcp[constant] !== undefined, `missing exported constant ${constant}`);
  }
});

test("manifest bin map is unchanged (no new bin)", () => {
  assert.deepEqual(manifest.bin, { "task-linear-sync": "./dist/cli/main.js" });
});

test("zero runtime dependencies — the transport allowance stays unspent (SPENT 0 posture)", () => {
  assert.ok(
    manifest.dependencies === undefined || Object.keys(manifest.dependencies).length === 0,
    `dependencies must stay empty, found ${JSON.stringify(manifest.dependencies)}`,
  );
});
