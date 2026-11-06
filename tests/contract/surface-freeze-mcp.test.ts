/**
 * T010 (feature 014) — MCP surface freeze (contracts/surface-freeze.md, SC-001).
 *
 * Compares the live MCP inventory (runtime registries) against the checked-in
 * snapshot, and proves each frozen element category is INDIVIDUALLY guarded by
 * injecting synthetic drift into the comparator input (never into src/) and
 * asserting the EXACT drift line. Amendment-entry integrity closes the loop:
 * every id cited in the MCP log of docs/contract-amendments.md must exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  amendmentEntryIds,
  canonicalJson,
  diffInventories,
  driftElementIds,
  loadSnapshot,
  mcpInventory,
  shorten,
  UPDATE_SURFACE_SNAPSHOTS,
  writeSnapshot,
} from "../helpers/surface-freeze.js";
import type { Inventory } from "../helpers/surface-freeze.js";

const live = mcpInventory();

test("mcp snapshot matches the live surface inventory (or regenerates deliberately)", () => {
  const checkedIn = loadSnapshot("mcp");
  if (UPDATE_SURFACE_SNAPSHOTS) {
    // Deliberate refresh (mirrors UPDATE_FROZEN_SNAPSHOT): print the drift ids so
    // the human can cite each one in docs/contract-amendments.md before committing.
    const drift = checkedIn ? diffInventories(checkedIn, live) : ["FRESH SNAPSHOT"];
    console.log(`UPDATE_SURFACE_SNAPSHOTS=1 → mcp drift (${drift.length}):\n${drift.join("\n")}`);
    writeSnapshot("mcp", live);
    return;
  }
  assert.ok(checkedIn, "tests/contract/snapshots/mcp-surface.json missing — generate via UPDATE_SURFACE_SNAPSHOTS=1");
  assert.deepEqual(diffInventories(checkedIn!, live), [], "surface drift without a regenerated snapshot");
});

test("mutation row 1: dropping a tool drifts exactly `REMOVED tool.task_sync_status`", () => {
  const mutated: Inventory = { ...live };
  delete mutated["tool.task_sync_status"];
  assert.deepEqual(diffInventories(live, mutated), ["REMOVED tool.task_sync_status"]);
});

test("mutation row 3: flipping an HTTP refusal body drifts exactly `CHANGED httpstatus.401 …`", () => {
  const before = live["httpstatus.401"];
  const after = { ...(before as object), body: '{"error":"NOPE"}' };
  const expected = `CHANGED httpstatus.401: ${shorten(canonicalJson(before))} -> ${shorten(canonicalJson(after))}`;
  assert.deepEqual(diffInventories(live, { ...live, "httpstatus.401": after }), [expected]);
});

test("mutation row 4: adding a JSON-RPC error code drifts exactly `ADDED error.-32099`", () => {
  assert.deepEqual(diffInventories(live, { ...live, "error.-32099": "MSG_SYNTHETIC" }), ["ADDED error.-32099"]);
});

test("mutation row 6: changing a tool inputSchema drifts exactly `CHANGED tool.task_sync_plan.inputSchema …`", () => {
  const before = live["tool.task_sync_plan.inputSchema"];
  const after = { ...(before as object), "x-t010-drift": true };
  const expected = `CHANGED tool.task_sync_plan.inputSchema: ${shorten(canonicalJson(before))} -> ${shorten(canonicalJson(after))}`;
  assert.deepEqual(diffInventories(live, { ...live, "tool.task_sync_plan.inputSchema": after }), [expected]);
});

test("amendment-entry integrity: every MCP-log entry id exists in the snapshot or live surface", () => {
  const entries = amendmentEntryIds("mcp");
  assert.ok(entries.length >= 3, "the 014 log section must be pre-seeded (T007)");
  const snapshot = loadSnapshot("mcp") ?? {};
  for (const id of entries) {
    assert.ok(id in live || id in snapshot, `entry id ${id} names no frozen element`);
  }
});

test("pass rule sanity: cited drift ids alone would keep CI green", () => {
  // Mirror the freeze rule driftIds ⊆ entryIds with one drifted element that IS cited.
  const entries = new Set(amendmentEntryIds("mcp"));
  const drifted = { ...live, "tool.task_sync_apply": { ...(live["tool.task_sync_apply"] as object), description: "gated" } };
  const driftIds = driftElementIds(diffInventories(live, drifted));
  assert.ok(driftIds.length > 0 && driftIds.every((id) => entries.has(id)), `uncited drift stays red: ${driftIds.join(", ")}`);
});
