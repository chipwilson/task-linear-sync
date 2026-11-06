/**
 * T009 (feature 014) — unit checks for the surface-freeze machinery
 * (tests/helpers/surface-freeze.ts): exact drift lines, deterministic ordering,
 * and the amendment-entry integrity relation the contract suites rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  amendmentEntryIds,
  canonicalJson,
  diffInventories,
  driftElementIds,
  historyInventory,
  mcpInventory,
  serializeSnapshot,
  shorten,
} from "../helpers/surface-freeze.js";

test("diffInventories emits one exact, sorted drift line per element", () => {
  const checkedIn = {
    "config.web.a": 1,
    "route.x": { methods: ["GET"] },
    "status.404": { code: "NOT_FOUND" },
    "tool.gone": { visibleByDefault: true },
  };
  const current = {
    "config.web.a": 2,
    "route.x": { methods: ["GET"] },
    "status.404": { code: "NOT_FOUND" },
    "tool.new": { visibleByDefault: false },
  };
  assert.deepEqual(diffInventories(checkedIn, current), [
    "ADDED tool.new",
    "CHANGED config.web.a: 1 -> 2",
    "REMOVED tool.gone",
  ]);
});

test("canonicalJson is key-order-insensitive and serializeSnapshot is stable", () => {
  const a = { b: { z: 1, a: [ { y: 2, x: 3 } ] }, a: "k" };
  const b = { a: "k", b: { a: [ { x: 3, y: 2 } ], z: 1 } };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(serializeSnapshot(a), serializeSnapshot(b));
});

test("shorten bounds CHANGED payloads at 120 characters", () => {
  const long = "x".repeat(200);
  const out = shorten(long);
  assert.equal(out.length, 120);
  assert.ok(out.endsWith("..."));
  assert.equal(shorten("short"), "short");
});

test("every amendment-entry id cited for a surface exists in its live inventory", () => {
  // Entry-integrity core rule (contracts/surface-freeze.md §3): an entry can
  // never cite an element that is not part of the frozen inventory.
  for (const [surface, live] of [["history", historyInventory()], ["mcp", mcpInventory()]] as const) {
    const ids = amendmentEntryIds(surface);
    assert.ok(ids.length >= 3, `${surface}: expected pre-seeded amendment entries in docs/contract-amendments.md`);
    for (const id of ids) {
      assert.ok(Object.hasOwn(live, id), `${surface}: amendment entry cites unknown element '${id}'`);
    }
  }
});

test("drift-set math: unamended drift fails, amended drift passes", () => {
  // The freeze tests' pass rule: driftIds ⊆ amendmentEntryIds.
  const entries = new Set(amendmentEntryIds("mcp"));
  const live = mcpInventory();
  const drifted = { ...live, "protocol.default": "1999-01-01" }; // cited? no → must fail
  const driftIds = driftElementIds(diffInventories(live, drifted));
  assert.deepEqual(driftIds, ["protocol.default"]);
  assert.ok(driftIds.some((id) => !entries.has(id)), "uncited drift must leave CI red");

  const cited = { ...live };
  delete cited["tool.task_sync_apply"]; // cited by the apply-gating entry
  const citedIds = driftElementIds(diffInventories(live, cited));
  assert.ok(citedIds.every((id) => entries.has(id)), "cited elements alone must not keep CI red");
});
