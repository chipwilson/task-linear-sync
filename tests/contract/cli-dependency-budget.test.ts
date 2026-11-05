/**
 * T034 [P] — NEW zero-dependency re-assertion for 009 (research R1 "deps unchanged at
 * zero; budget tests re-asserted, not edited"). The frozen budgets
 * (`tracker-dependency-budget.test.ts` and friends) stay untouched; this file proves
 * the CLI feature ships NO runtime, peer, or optional dependencies. Adding any is a
 * deliberate, visible amendment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

test("009 re-assertion: runtime dependencies stay exactly {} (zero-spend posture)", () => {
  assert.deepEqual(pkg.dependencies ?? {}, {}, "CLI ships zero runtime dependencies");
});

test("009 re-assertion: no peer or optional dependencies hide beside the CLI surface", () => {
  assert.equal(pkg.peerDependencies, undefined, "no peer dependencies");
  assert.equal(pkg.optionalDependencies, undefined, "no optional dependencies");
});
