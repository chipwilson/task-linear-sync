/**
 * T010 [US1] — frozen-shape contract (contracts/routing-resolution.md § Frozen-shape
 * guarantee): `resolveRouting` returns a value whose key set is EXACTLY the frozen
 * `RoutingResolution` keys — no added field, no widened optionality — so 006 consumes the
 * frozen 002 type without importing 005 internals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { RoutingResolution } from "../../src/domain/routing.js"; // FROZEN 002
import { resolveRouting } from "../../src/routing/resolve.js";
import { pathCorpus } from "../fixtures/routing-titles/factories.js";

/** Key set frozen in 002 `src/domain/routing.ts` (optionals marked). */
const FROZEN_KEYS = new Set(["teamKey", "project", "matchedPrefix", "defaulted", "tieBreak", "unassigned"]);

test("routing-resolution-shape — every outcome assigns to the frozen RoutingResolution type", () => {
  // Compile-time proof: values flow into the frozen type with no widening.
  const outcomes: readonly RoutingResolution[] = pathCorpus.map((row) =>
    resolveRouting(row.filePath, row.slice),
  );
  assert.ok(outcomes.length > 0);
});

test("routing-resolution-shape — key set is exactly the frozen keys; no extras, no drift", () => {
  for (const row of pathCorpus) {
    const res = resolveRouting(row.filePath, row.slice) as unknown as Record<string, unknown>;
    for (const key of Object.keys(res)) {
      assert.ok(FROZEN_KEYS.has(key), `unexpected key '${key}' on result for ${row.filePath}`);
    }
    for (const required of ["teamKey", "project", "defaulted"]) {
      assert.ok(required in res, `required frozen key '${required}' missing for ${row.filePath}`);
    }
    assert.equal(typeof res.teamKey, "string");
    assert.equal(typeof res.project, "string");
    assert.equal(typeof res.defaulted, "boolean");
    if ("matchedPrefix" in res) assert.equal(typeof res.matchedPrefix, "string");
    if ("tieBreak" in res) assert.equal(res.tieBreak, "first-by-map-order");
    if ("unassigned" in res) assert.equal(res.unassigned, true, "unassigned is the literal `true` discriminant");
    // Optionals are ABSENT, not undefined-valued (frozen shape discipline).
    for (const optional of ["matchedPrefix", "tieBreak", "unassigned"]) {
      if (optional in res) assert.notEqual(res[optional], undefined, `'${optional}' must be absent or set`);
    }
  }
});

test("routing-resolution-shape — outcome kind invariants (matched / defaulted / unassigned are exclusive)", () => {
  for (const row of pathCorpus) {
    const res = resolveRouting(row.filePath, row.slice);
    if (res.unassigned === true) {
      assert.equal(res.defaulted, false);
      assert.equal(res.teamKey, "");
      assert.equal(res.project, "");
      assert.equal("matchedPrefix" in res, false);
    }
    if (res.defaulted) {
      assert.equal("matchedPrefix" in res, false);
      assert.equal("tieBreak" in res, false);
      assert.equal("unassigned" in res, false);
    }
    if ("tieBreak" in res) {
      assert.equal("matchedPrefix" in res, true);
      assert.equal(res.defaulted, false);
    }
  }
});
