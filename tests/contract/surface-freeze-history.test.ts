/**
 * T011 (feature 014) — history server surface freeze (contracts/surface-freeze.md, SC-001).
 * Same machinery as the MCP freeze suite, history-applicable mutation rows
 * (route rename, envelope flip, config-key removal) plus entry integrity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  amendmentEntryIds,
  canonicalJson,
  diffInventories,
  driftElementIds,
  historyInventory,
  loadSnapshot,
  shorten,
  UPDATE_SURFACE_SNAPSHOTS,
  writeSnapshot,
} from "../helpers/surface-freeze.js";
import type { Inventory } from "../helpers/surface-freeze.js";

const live = historyInventory();

test("history snapshot matches the live surface inventory (or regenerates deliberately)", () => {
  const checkedIn = loadSnapshot("history");
  if (UPDATE_SURFACE_SNAPSHOTS) {
    const drift = checkedIn ? diffInventories(checkedIn, live) : ["FRESH SNAPSHOT"];
    console.log(`UPDATE_SURFACE_SNAPSHOTS=1 → history drift (${drift.length}):\n${drift.join("\n")}`);
    writeSnapshot("history", live);
    return;
  }
  assert.ok(checkedIn, "tests/contract/snapshots/history-surface.json missing — generate via UPDATE_SURFACE_SNAPSHOTS=1");
  assert.deepEqual(diffInventories(checkedIn!, live), [], "surface drift without a regenerated snapshot");
});

test("mutation row 2: renaming a route drifts exactly REMOVED + ADDED route lines", () => {
  const mutated: Inventory = { ...live };
  delete mutated["route.attachment.canonical"];
  mutated["route.attachment.renamed"] = live["route.attachment.canonical"];
  assert.deepEqual(diffInventories(live, mutated), [
    "ADDED route.attachment.renamed",
    "REMOVED route.attachment.canonical",
  ]);
});

test("mutation row 3: flipping the 429 envelope drifts exactly `CHANGED status.429 …`", () => {
  const before = live["status.429"];
  const after = { ...(before as object), message: "synthetic flip" };
  const expected = `CHANGED status.429: ${shorten(canonicalJson(before))} -> ${shorten(canonicalJson(after))}`;
  assert.deepEqual(diffInventories(live, { ...live, "status.429": after }), [expected]);
});

test("mutation row 5: removing web.maxCacheEntries drifts exactly `REMOVED config.web.maxCacheEntries`", () => {
  const mutated: Inventory = { ...live };
  delete mutated["config.web.maxCacheEntries"];
  assert.deepEqual(diffInventories(live, mutated), ["REMOVED config.web.maxCacheEntries"]);
});

test("amendment-entry integrity: every history-log entry id exists in the snapshot or live surface", () => {
  const entries = amendmentEntryIds("history");
  assert.ok(entries.length >= 2, "the 014 log section must be pre-seeded (T007)");
  const snapshot = loadSnapshot("history") ?? {};
  for (const id of entries) {
    assert.ok(id in live || id in snapshot, `entry id ${id} names no frozen element`);
  }
});

test("pass rule sanity: cited drift ids alone would keep CI green", () => {
  const entries = new Set(amendmentEntryIds("history"));
  const drifted = { ...live, "status.429": { ...(live["status.429"] as object), message: "cited flip" } };
  const driftIds = driftElementIds(diffInventories(live, drifted));
  assert.ok(driftIds.length > 0 && driftIds.every((id) => entries.has(id)), `uncited drift stays red: ${driftIds.join(", ")}`);
});
