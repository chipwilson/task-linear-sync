/**
 * T026 [US1] — deep-merge semantics unit tests (research R3) and canonical
 * serialization determinism (SC-001).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deepMerge, canonicalizeConfig } from "task-linear-sync/config";
import { builtInDefaults } from "task-linear-sync/config";

test("objects merge recursively; higher-precedence same-key values replace", () => {
  const lower = { tracker: { pageSize: 100, maxRetries: 5 }, tabWidth: 2 };
  const higher = { tracker: { pageSize: 250 } };
  assert.deepEqual(deepMerge(lower, higher), {
    tracker: { pageSize: 250, maxRetries: 5 },
    tabWidth: 2,
  });
});

test("keys absent from higher sources retained (001 R17.3)", () => {
  const lower = { a: { b: 1, c: 2 } };
  const higher = { d: 3 };
  assert.deepEqual(deepMerge(lower, higher), { a: { b: 1, c: 2 }, d: 3 });
});

test("arrays and scalars replace wholesale — never concatenated or element-merged", () => {
  const lower = { skipDirectories: [".git", "node_modules", "dist"], n: 1, s: "a" };
  const higher = { skipDirectories: [".git", "vendor"], n: 2, s: "b" };
  const merged = deepMerge(lower, higher) as typeof lower;
  assert.deepEqual(merged.skipDirectories, [".git", "vendor"]);
  assert.equal(merged.n, 2);
  assert.equal(merged.s, "b");
});

test("null is a value (replaces); undefined means absent (ignored)", () => {
  const nulled = deepMerge({ x: 1 }, { x: null }) as { x: unknown };
  assert.equal(nulled.x, null, "null is a value that replaces");
  const ignored = deepMerge({ x: 1 }, { x: undefined }) as { x: unknown };
  assert.equal(ignored.x, 1, "undefined means absent and is ignored");
});

test("canonicalizeConfig is byte-identical for identical inputs across repeated runs (SC-001)", () => {
  const a = canonicalizeConfig(builtInDefaults);
  const b = canonicalizeConfig(structuredClone(builtInDefaults));
  assert.equal(a, b);
  assert.equal(a.length > 0, true);
});

test("canonicalizeConfig sorts object keys — insertion order does not matter", () => {
  const one = structuredClone(builtInDefaults);
  const other = structuredClone(builtInDefaults);
  // Rebuild tracker group in reverse insertion order.
  const t1 = { ...(one as unknown as { tracker: Record<string, unknown> }).tracker };
  const t2: Record<string, unknown> = {};
  for (const k of Object.keys(t1).reverse()) t2[k] = t1[k];
  (one as unknown as { tracker: unknown }).tracker = t2;
  (other as unknown as { tracker: unknown }).tracker = t2;
  assert.equal(canonicalizeConfig(one), canonicalizeConfig(other));
  // Sorted-key guarantee visible in raw output.
  const raw = canonicalizeConfig(builtInDefaults);
  const idx = (quotedName: string): number => raw.indexOf(quotedName);
  assert.ok(idx('"concurrency"') >= 0, "concurrency present");
  assert.ok(idx('"concurrency"') < idx('"credentialEnvVarNames"'), "keys sorted lexicographically");
});

test("credential *values* never enter the config model — only env-var NAMES are config", () => {
  const raw = canonicalizeConfig(builtInDefaults);
  // Default credential *name* present…
  assert.ok(raw.includes("LINEAR_ACCESS_TOKEN"));
  // …and nothing token-shaped anywhere.
  assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(raw), "no token-shaped values in canonicalized config");
});
