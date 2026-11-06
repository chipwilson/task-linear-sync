#!/usr/bin/env node
/**
 * T041 — Frozen-surface hygiene scan: the research R13 zero-delta list (spec 010).
 * Run: `node specs/010-background-queue-sync-hooks/contracts/queue-hygiene.mjs`
 * — exit 0 means every check passed. Zero runtime dependencies: node: builtins + git.
 *
 * Checks (tasks T041):
 *  1. The 010 delta (feature start 937624a vs the working tree) touches NOTHING under the
 *     frozen module list: src/domain, src/config, src/state, src/urls, src/gates, src/ports,
 *     src/engine/**, src/cli/**, src/discovery/**, src/reports/**.
 *  2. package.json dependencies/engines are untouched (deps absent in both snapshots; the
 *     engines block is byte-identical).
 *  3. No test file outside the two 009 files T026 names was MODIFIED (010's own new test
 *     files are additive and allowed; deleting or editing any other 009 test is a defect).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** name-status entries of `git diff <FEATURE_START>` (tracked changes vs the worktree). */
function delta() {
  const raw = execFileSync("git", ["diff", "--name-status", FEATURE_START], { cwd: pkgRoot, encoding: "utf8" });
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status[0], file: paths[paths.length - 1] };
    });
}

const FROZEN_PATHS = [
  "src/domain",
  "src/config",
  "src/state",
  "src/urls",
  "src/gates",
  "src/ports",
  "src/engine/",
  "src/cli/",
  "src/discovery/",
  "src/reports/",
];

check("the 010 delta touches no frozen module path (R13 zero-delta list)", () => {
  const hits = delta()
    .map((entry) => entry.file)
    .filter((file) => FROZEN_PATHS.some((prefix) => file.startsWith(prefix)));
  assert(hits.length === 0, `frozen paths touched by 010: ${hits.join(", ")}`);
});

check("package.json dependencies/engines are untouched vs the feature start", () => {
  const before = JSON.parse(execFileSync("git", ["show", `${FEATURE_START}:package.json`], { cwd: pkgRoot, encoding: "utf8" }));
  const now = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert(!(key in before) && !(key in now), `${key} changed shape`);
  }
  assert(JSON.stringify(now.engines) === JSON.stringify(before.engines), "engines block changed");
});

check("no 009 test was modified outside the two T026 names", () => {
  const allowed = new Set([
    "tests/unit/cli-queue-surface.test.ts",
    "tests/integration/cli-commands.test.ts",
  ]);
  const offenders = delta().filter(
    (entry) => entry.file.startsWith("tests/") && entry.status !== "A" && !allowed.has(entry.file),
  );
  assert(
    offenders.length === 0,
    `tests touched beyond the T026 allowance: ${offenders.map((e) => `${e.status} ${e.file}`).join(", ")}`,
  );
});

if (failures.length > 0) {
  console.log(`queue-hygiene: ${failures.length} failing check(s)`);
  process.exit(1);
}
console.log("queue-hygiene: all checks passed");
