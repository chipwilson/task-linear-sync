/**
 * T042 — `task-linear-sync/ci` packaging contract (wrapper-api.md header;
 * precedent `mcp-packaging.test.ts`): the additive `./ci` export resolves to
 * built dist files with generated .d.ts, the runtime surface matches the
 * contract name list EXACTLY (nothing more, nothing less), and the dependency
 * budget + bin map stay untouched (re-assert, do not edit).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as Record<string, unknown>;

test("package exports contain the additive ./ci entry (types + default, dist paths)", () => {
  const exports = manifest["exports"] as Record<string, Record<string, string>>;
  assert.deepEqual(exports["./ci"], {
    types: "./dist/ci/index.d.ts",
    default: "./dist/ci/index.js",
  });
});

test("the ./ci entry resolves to BUILT files with generated .d.ts", () => {
  const entry = require.resolve("task-linear-sync/ci");
  assert.ok(entry.endsWith(join("dist", "ci", "index.js")), `resolved to ${entry}`);
  assert.ok(existsSync(entry), "built index.js exists");
  const types = entry.replace(/index\.js$/, "index.d.ts");
  assert.ok(existsSync(types), "generated index.d.ts exists");
  const dts = readFileSync(types, "utf8");
  for (const name of [
    // the ten type names from the contract header
    "EnforcementSettings",
    "EnforcementOutcome",
    "EvaluationResult",
    "ConditionCounts",
    "TriggeredCondition",
    "ConditionId",
    "CliInvoker",
    "CliRequest",
    "CliResult",
    "EnforcementDeps",
  ]) {
    assert.ok(dts.includes(name), `public type surface must carry ${name}`);
  }
});

test("runtime exports match the contract list EXACTLY (12 value names)", async () => {
  const ci = (await import("task-linear-sync/ci")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(ci).sort(), [
    "CONDITION_IDS",
    "CiArtifactError",
    "CiCliFailureError",
    "CiConfigError",
    "EnforcementExitCode",
    "createSpawnCliInvoker",
    "evaluateConditions",
    "loadReportArtifact",
    "parseLocator",
    "renderSummary",
    "resolveSettings",
    "runEnforcement",
  ]);
  assert.equal(typeof ci.runEnforcement, "function");
  assert.equal(typeof ci.evaluateConditions, "function");
  assert.equal(typeof ci.resolveSettings, "function");
  assert.equal(typeof ci.loadReportArtifact, "function");
  assert.equal(typeof ci.parseLocator, "function");
  assert.equal(typeof ci.createSpawnCliInvoker, "function");
  assert.equal(typeof ci.renderSummary, "function");
  assert.ok(Array.isArray(ci.CONDITION_IDS));
  assert.deepEqual(ci.CONDITION_IDS, [
    "unmapped-high-confidence",
    "unresolved-conflict-block",
    "spec-drift",
  ]);
  for (const errorName of ["CiConfigError", "CiArtifactError", "CiCliFailureError"]) {
    assert.equal(typeof ci[errorName], "function", `${errorName} is a class`);
  }
  assert.deepEqual(ci.EnforcementExitCode, { SUCCESS: 0, VIOLATION: 1, CONFIGURATION: 2, CLI_FAILURE: 3 });
});

test("manifest bin map is unchanged (no new bin)", () => {
  assert.deepEqual(manifest["bin"], { "task-linear-sync": "./dist/cli/main.js" });
});

test("dependency budget: zero runtime deps, no peer/optional sections (cli-dependency-budget posture)", () => {
  const deps = manifest["dependencies"] as Record<string, string> | undefined;
  assert.ok(deps === undefined || Object.keys(deps).length === 0, "dependencies must stay {}");
  assert.equal(manifest["peerDependencies"], undefined, "no peerDependencies may appear");
  assert.equal(manifest["optionalDependencies"], undefined, "no optionalDependencies may appear");
});

test("the built wrapper entry exists in dist (composite action target)", () => {
  assert.ok(existsSync(join(pkgRoot, "dist", "ci", "main.js")), "dist/ci/main.js must be emitted");
});
