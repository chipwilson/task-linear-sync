/**
 * T027 [US1] — config-file failure-category unit tests (research R4, FR-006, SC-002).
 * Exactly three categories — missing, unreadable, invalid-json — reported together with
 * the configured config-file path; loading aborts and applies NO partial config.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, ConfigFileError } from "task-linear-sync/config";
import type { ConfigFailureCategory } from "task-linear-sync/config";

const dir = mkdtempSync(join(tmpdir(), "tls-config-load-"));
after(() => {
  try {
    chmodSync(dir, 0o755);
  } catch {
    /* best effort */
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function categoryOf(fn: () => unknown): ConfigFailureCategory | "no-throw" {
  try {
    fn();
    return "no-throw";
  } catch (e) {
    assert.ok(e instanceof ConfigFileError, `expected ConfigFileError, got ${String(e)}`);
    assert.ok(e.category, "error must name a failure category");
    assert.ok(e.configFilePath.length > 0, "error must name the file path");
    return e.category;
  }
}

test("config file failures — category 'missing': path set but stat-misses", () => {
  const missing = join(dir, "does-not-exist.json");
  assert.equal(categoryOf(() => loadConfig({ configFile: missing })), "missing");
});

test("config file failures — category 'invalid-json': read succeeds but JSON.parse fails", () => {
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ this is not json", "utf8");
  assert.equal(categoryOf(() => loadConfig({ configFile: bad })), "invalid-json");
});

test("config file failures — category 'invalid-json': JSON root that is not an object", () => {
  const arr = join(dir, "array-root.json");
  writeFileSync(arr, "[1,2,3]", "utf8");
  const str = join(dir, "string-root.json");
  writeFileSync(str, '"just a string"', "utf8");
  const nul = join(dir, "null-root.json");
  writeFileSync(nul, "null", "utf8");
  assert.equal(categoryOf(() => loadConfig({ configFile: arr })), "invalid-json");
  assert.equal(categoryOf(() => loadConfig({ configFile: str })), "invalid-json");
  assert.equal(categoryOf(() => loadConfig({ configFile: nul })), "invalid-json");
});

test("config file failures — category 'unreadable': stat succeeds but read throws (EACCES)", (t) => {
  if (process.getuid?.() === 0) {
    t.skip("running as root — chmod cannot block reads");
    return;
  }
  const blocked = join(dir, "blocked.json");
  writeFileSync(blocked, '{"toolId":"whatever"}', "utf8");
  chmodSync(blocked, 0o000);
  try {
    assert.equal(categoryOf(() => loadConfig({ configFile: blocked })), "unreadable");
  } finally {
    chmodSync(blocked, 0o644);
  }
});

test("config file failures — abort names file path AND category together on every category", () => {
  const missing = join(dir, "absent.json");
  try {
    loadConfig({ configFile: missing });
    assert.fail("should have aborted");
  } catch (e) {
    assert.ok(e instanceof ConfigFileError);
    assert.equal(e.category, "missing");
    assert.equal(e.configFilePath, missing);
    assert.ok(String(e.message).includes(missing), "message names the file path");
    assert.ok(String(e.message).toLowerCase().includes("missing"), "message names the category");
  }
});

test("config file failures — no file path configured -> defaults + overrides only (no throw)", () => {
  const cfg = loadConfig({ overrides: { pageSize: 42 } });
  assert.equal(cfg.pageSize, 42);
  assert.equal(cfg.toolId, "task-linear-sync");
});

test("config file failures — no partial configuration from an invalid file is ever applied (SC-002)", () => {
  // A file containing some valid keys and invalid syntax later still applies NOTHING from
  // the file — result must equal pure defaults+overrides.
  const halfBad = join(dir, "half-bad.json");
  writeFileSync(halfBad, '{"pageSize": 999, broken', "utf8");
  let threw = false;
  try {
    loadConfig({ configFile: halfBad, overrides: { toolId: "override-tool" } });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof ConfigFileError);
    assert.equal(e.category, "invalid-json");
  }
  assert.ok(threw, "must abort");
  const fallback = loadConfig({ overrides: { toolId: "override-tool" } });
  assert.equal(fallback.pageSize, 100, "file value 999 must not leak through any retry path");
});
