/**
 * T043 [P] — dependency-budget contract (research R1; constitution "runtime dependencies
 * limited to Node built-ins plus exactly one platform transport dependency"). The budget
 * ceiling is ≤ 1; this feature deliberately SPENDS NOTHING (built-in fetch + one injected
 * transport seam), so the assertion is currently `0`. Any new runtime dependency must amend
 * this file on purpose — a visible, reviewable act, never an accident.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const CEILING = 1; // constitution: at most ONE platform-transport dependency (R1).
const SPENT = 0; // this feature's deliberate spend: zero.

test("runtime dependency budget: count ≤ ceiling and currently zero (R1 unspent)", () => {
  const deps = pkg.dependencies ?? {};
  const count = Object.keys(deps).length;
  assert.ok(count <= CEILING, `runtime dependencies ${String(count)} exceed the constitutional ceiling of ${String(CEILING)}`);
  assert.equal(count, SPENT, "this feature ships ZERO runtime dependencies — adding one is a deliberate amendment");
});

test("no undeclared implicit peer requirements either", () => {
  assert.equal(pkg.peerDependencies, undefined, "007 adds no peer dependencies");
});
