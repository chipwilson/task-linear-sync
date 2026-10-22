#!/usr/bin/env node
/**
 * Version-robust test runner for `npm test` and the per-tier commands.
 * Node's coverage threshold/exclude options are NOT uniformly available across the
 * supported range (empirically: the v20 runner knows no --test-coverage-* threshold or
 * ignore/exclude options at all; modern runners know all of them). Passing an unknown
 * option kills Node fatally ("bad option", exit 9), so every optional flag is probed
 * against the actual runtime binary before use.
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

/**
 * Probe whether this exact Node runtime accepts an option: `node <flag> --version`
 * exits 9 with "bad option" when unsupported, 0 when supported. Version tables lie
 * across patch releases — probe the real binary instead.
 */
function supportsFlag(flag) {
  const r = spawnSync(process.execPath, [flag, "--version"], { encoding: "utf8" });
  return r.status === 0 && !/bad option/.test(r.stderr ?? "");
}

const [major] = process.versions.node.split(".").map(Number);

const flags = ["--test", ...passthrough];
if (all) {
  // Coverage gate (constitution: test-first with a threshold). Flags are added only
  // when this runtime actually parses them; Node 20's runner knows none of the
  // threshold/exclude options, so on that floor the coverage report is informational
  // and the enforced threshold gate runs on the CI leg with a modern runner.
  if (supportsFlag("--experimental-test-coverage")) {
    flags.push("--experimental-test-coverage");
    for (const flag of [
      "--test-coverage-lines=80",
      "--test-coverage-branches=70",
      "--test-coverage-functions=80",
    ]) {
      if (supportsFlag(flag)) flags.push(flag);
    }
    const exclude = supportsFlag("--test-coverage-exclude=build/tests/**")
      ? "--test-coverage-exclude"
      : supportsFlag("--test-coverage-ignore=build/tests/**")
        ? "--test-coverage-ignore"
        : null;
    if (exclude) {
      flags.push(`${exclude}=build/tests/**`, `${exclude}=**/index.js`);
    }
  }
  if (major < 22) {
    console.log("run-tests: coverage thresholds unsupported on this runtime (informational report only; enforced on the modern-runner CI leg).");
  }
}

const result = spawnSync(process.execPath, [...flags, ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
