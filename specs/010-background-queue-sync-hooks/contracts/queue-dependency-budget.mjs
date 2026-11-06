#!/usr/bin/env node
/**
 * T038 — Queue dependency-budget contract (spec 010; FR-002 of 009 inherited).
 * Run: `node specs/010-background-queue-sync-hooks/contracts/queue-dependency-budget.mjs`
 * — exit 0 means every check passed. Zero runtime dependencies: node: builtins + git.
 *
 * Checks (tasks T038):
 *  1. The transitive dist closure of `./queue` never references `@linear/sdk` — the queue
 *     subtree ships dependency-free even through engine/tracker (009's zero-deps posture).
 *  2. Zero `dist/cli` imports reachable from dist/queue/** (constitution IV one-way).
 *  3. The frozen 009 dependency-budget scan (tests/contract/cli-dependency-budget.test.ts)
 *     is byte-unchanged since the feature start AND still passes — run unchanged here.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const FEATURE_START = "937624a";
const specRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

/** Transitive closure of static/dynamic import specifiers starting at `entry`. */
function closure(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(specRe)) {
      const spec = match[1];
      if (spec.startsWith("node:")) continue;
      let target;
      if (spec.startsWith("./") || spec.startsWith("../")) target = resolve(dirname(file), spec);
      else if (spec === "task-linear-sync") target = resolve(pkgRoot, "dist/index.js");
      else if (spec.startsWith("task-linear-sync/")) target = resolve(pkgRoot, "dist", `${spec.slice("task-linear-sync/".length)}/index.js`);
      else continue;
      if (existsSync(target)) walk(target);
    }
  };
  walk(entry);
  return [...seen];
}

check("the ./queue dist closure never references @linear/sdk (009 FR-002 inherited)", () => {
  const visited = closure(resolve(pkgRoot, "dist/queue/index.js"));
  assert(visited.length > 10, `closure looks degenerate (${visited.length} files) — build missing?`);
  const offenders = visited.filter((file) => readFileSync(file, "utf8").includes("@linear/sdk"));
  assert(offenders.length === 0, `@linear/sdk referenced in ${offenders.map((f) => relative(pkgRoot, f)).join(", ")}`);
});

check("zero dist/cli imports are reachable from dist/queue/** (constitution IV)", () => {
  const offenders = [];
  for (const file of closure(resolve(pkgRoot, "dist/queue/index.js"))) {
    if (!file.includes("/dist/queue/")) continue; // queue's OWN import specifiers are the rule
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(specRe)) {
      const spec = match[1];
      if (spec.startsWith("node:")) continue;
      let target;
      if (spec.startsWith("./") || spec.startsWith("../")) target = relative(resolve(pkgRoot, "dist"), resolve(dirname(file), spec));
      else if (spec.startsWith("task-linear-sync/")) target = `${spec.slice("task-linear-sync/".length)}/index.js`;
      else if (spec === "task-linear-sync") target = "index.js";
      else continue;
      if (target.startsWith("cli/") || target === "cli") offenders.push(`${relative(pkgRoot, file)} -> ${spec}`);
    }
  }
  assert(offenders.length === 0, `dist/queue reaches dist/cli: ${offenders.join("; ")}`);
});

check("the frozen 009 dependency-budget scan is byte-unchanged since the feature start", () => {
  const target = "tests/contract/cli-dependency-budget.test.ts";
  const before = execFileSync("git", ["show", `${FEATURE_START}:${target}`], { cwd: pkgRoot, encoding: "utf8" });
  const now = readFileSync(resolve(pkgRoot, target), "utf8");
  assert(now === before, `${target} was edited during 010 — the frozen 009 scan must run UNCHANGED`);
});

check("the frozen 009 dependency-budget scan still passes (executed unchanged)", () => {
  const compiled = resolve(pkgRoot, "build/tests/contract/cli-dependency-budget.test.js");
  assert(existsSync(compiled), "run `npm run compile:tests` first — compiled contract scan missing");
  const r = spawnSync(process.execPath, ["--test", compiled], { cwd: pkgRoot, encoding: "utf8", timeout: 120_000 });
  assert(r.status === 0, `009 scan failed:\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-500)}`);
});

if (failures.length > 0) {
  console.log(`queue-dependency-budget: ${failures.length} failing check(s)`);
  process.exit(1);
}
console.log("queue-dependency-budget: all checks passed");
