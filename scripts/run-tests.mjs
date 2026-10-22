#!/usr/bin/env node
/**
 * Version-robust test runner for `npm test` and the per-tier commands.
 * Node's coverage threshold/exclude flags differ across supported versions
 * (engines >= 20): --test-coverage-branches/--test-coverage-functions exist only on
 * v22.3+, and the exclude flag is --test-coverage-exclude on v22+ vs
 * --test-coverage-ignore on v20. Passing an unknown option kills Node with
 * "bad option" (exit 9), so flags are composed from process.versions.node here.
 *
 * Usage: node scripts/run-tests.mjs [--tier <unit|contract|integration|e2e>] [--all] [extra node --test args…]
 * Extra args (e.g. --test-name-pattern "config") are forwarded to node --test.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const tierIdx = argv.indexOf("--tier");
const all = argv.includes("--all");
const tier = tierIdx >= 0 ? argv[tierIdx + 1] : null;
const drop = new Set();
if (tierIdx >= 0) {
  drop.add(tierIdx);
  drop.add(tierIdx + 1);
}
if (all) drop.add(argv.indexOf("--all"));
const passthrough = argv.filter((_, i) => !drop.has(i));

const roots = tier ? [`build/tests/${tier}`] : ["build/tests"];
for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`run-tests: '${root}' not found — build first (npm run pretest).`);
    process.exit(1);
  }
}

/** Recursive scan for compiled test files (*.test.js). */
function findFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(p));
    else if (entry.name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

const files = roots.flatMap(findFiles).sort();
if (files.length === 0) {
  console.error(`run-tests: no *.test.js under ${roots.join(", ")} — build first (npm run pretest).`);
  process.exit(1);
}

const [major] = process.versions.node.split(".").map(Number);
const v22plus = major >= 22;

const flags = ["--test", ...passthrough];
if (all) {
  // Coverage gate (constitution: test-first with a threshold): line threshold exists on
  // v20 too; branch/function thresholds only on v22.3+; exclude flag renamed in v22.
  flags.push("--experimental-test-coverage", "--test-coverage-lines=80");
  if (v22plus) {
    flags.push(
      "--test-coverage-branches=70",
      "--test-coverage-functions=80",
      "--test-coverage-exclude=build/tests/**",
      "--test-coverage-exclude=**/index.js",
    );
  } else {
    flags.push("--test-coverage-ignore=build/tests/**", "--test-coverage-ignore=**/index.js");
  }
}

const result = spawnSync(process.execPath, [...flags, ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
