#!/usr/bin/env node
/**
 * T037 — `task-linear-sync/queue` packaging contract (spec 010; quickstart §8 preamble).
 * Run: `node specs/010-background-queue-sync-hooks/contracts/queue-packaging.mjs` — exit 0
 * means every check passed. Zero runtime dependencies: only node: builtins + git.
 *
 * Checks (tasks T037):
 *  1. `node --eval "import('task-linear-sync/queue')"` resolves to a real createQueueSurface
 *     function through the self-referencing package name (the 009 seam's documented lookup).
 *  2. Every package.json `exports` target (incl. `./queue`) exists on disk under dist/.
 *  3. Every import in dist/queue/** stays inside the queue-allowed subtrees — the frozen half
 *     + engine, plus the two contract-mandated additions: `discovery` (hook-installation.md §2
 *     requires the 003 agentHookScaffold) and `tracker` (the queue's apply lane composes the
 *     production tracker factories; research R6). NEVER `dist/cli` (constitution IV one-way).
 *  4. package.json `dependencies` byte-unchanged vs the feature start (937624a): the package
 *     ships zero runtime dependencies — the key is absent in BOTH snapshots.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const FEATURE_START = "937624a";
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

const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));

check("import('task-linear-sync/queue') yields a real createQueueSurface function", () => {
  const evalCode =
    "import('task-linear-sync/queue').then((m) => console.log(typeof m.createQueueSurface), (e) => { console.error(String(e)); process.exit(1); })";
  const r = spawnSync(process.execPath, ["--eval", evalCode], { cwd: pkgRoot, encoding: "utf8", timeout: 60_000 });
  assert(r.status === 0, `sub-import failed (exit ${r.status}): ${r.stderr}`);
  assert(r.stdout.trim() === "function", `expected 'function', printed '${r.stdout.trim()}'`);
});

check("every package.json exports target exists under dist/", () => {
  const targets = [];
  for (const entry of Object.values(pkg.exports)) {
    for (const value of Object.values(entry)) targets.push(value);
  }
  assert(targets.length >= 2 * Object.keys(pkg.exports).length, "unexpected exports shape");
  for (const target of targets) {
    assert(target.startsWith("./dist/"), `exports target escapes dist/: ${target}`);
    assert(existsSync(resolve(pkgRoot, target)), `missing exports target: ${target}`);
  }
});

const ALLOWED_SUBTREES = new Set([
  "queue",
  "domain",
  "state",
  "urls",
  "engine",
  "config",
  "discovery", // hook-installation.md §2 — the 003 agentHookScaffold lives in discovery
  "tracker", // research R6 — the queue apply lane composes the production port factories
]);

check("dist/queue/** imports stay inside the allowed subtrees (never dist/cli)", () => {
  const specRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  const queueDir = resolve(pkgRoot, "dist/queue");
  const offenders = [];
  for (const file of readdirJs(queueDir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(specRe)) {
      const spec = match[1];
      if (spec.startsWith("node:")) continue;
      let subpath;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        subpath = relative(resolve(pkgRoot, "dist"), resolve(dirname(file), spec));
      } else if (spec === "task-linear-sync") {
        subpath = "index.js";
      } else if (spec.startsWith("task-linear-sync/")) {
        subpath = `${spec.slice("task-linear-sync/".length)}/index.js`;
      } else {
        offenders.push(`${relative(pkgRoot, file)} -> ${spec} (bare specifier)`);
        continue;
      }
      const subtree = subpath.split("/")[0];
      if (!ALLOWED_SUBTREES.has(subtree)) offenders.push(`${relative(pkgRoot, file)} -> ${spec}`);
    }
  }
  assert(offenders.length === 0, `imports left the allowed closure: ${offenders.join("; ")}`);
});

check("package.json dependencies byte-unchanged vs feature start (zero runtime deps)", () => {
  const before = JSON.parse(execFileSync("git", ["show", `${FEATURE_START}:package.json`], { cwd: pkgRoot, encoding: "utf8" }));
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert(!(key in before), `feature start already had ${key}`);
    assert(!(key in pkg), `${key} appeared during 010`);
  }
});

function readdirJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...readdirJs(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

if (failures.length > 0) {
  console.log(`queue-packaging: ${failures.length} failing check(s)`);
  process.exit(1);
}
console.log("queue-packaging: all checks passed");
