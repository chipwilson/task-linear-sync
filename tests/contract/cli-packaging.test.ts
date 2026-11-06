/**
 * T034 [P] — packaging contract for `task-linear-sync/cli` (mirrors the 008 posture of
 * `engine-packaging.test.ts`; tests run POST-BUILD like every packaging test).
 * Asserts: `bin["task-linear-sync"]` points at `dist/cli/main.js` (present, shebanged,
 * executable); the `./cli` export entry is types-FIRST and both files emit; every
 * `src/cli` module emits `.js` + `.d.ts` + `.d.ts.map`; the compiled bin path runs a
 * smoke invocation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  bin: Record<string, string>;
  exports: Record<string, Record<string, string>>;
};

test("cli-packaging — bin points at dist/cli/main.js: present and shebanged", () => {
  const binPath = pkg.bin["task-linear-sync"];
  assert.equal(binPath, "./dist/cli/main.js");
  const abs = join(pkgRoot, binPath);
  assert.ok(existsSync(abs), `${binPath} missing (run npm run build)`);
  // npm links the bin with the executable bit at install time; the shebang is what
  // makes that linked shim resolve to node.
  assert.ok(readFileSync(abs, "utf8").startsWith("#!/usr/bin/env node"), "bin shim carries the node shebang");
});

test("cli-packaging — the ./cli export entry is types-first and both files emit", () => {
  const entry = pkg.exports["./cli"];
  assert.ok(entry, "exports missing the './cli' subpath");
  assert.deepEqual(Object.keys(entry), ["types", "default"], "'./cli' lists types FIRST");
  assert.ok(entry.types.endsWith(".d.ts") && entry.types.startsWith("./dist/"));
  assert.ok(entry.default.endsWith(".js") && entry.default.startsWith("./dist/"));
  assert.ok(existsSync(join(pkgRoot, entry.types)), `missing ${entry.types}`);
  assert.ok(existsSync(join(pkgRoot, entry.default)), `missing ${entry.default}`);
});

function* walkTs(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkTs(p);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) yield p;
  }
}

test("cli-packaging — every src/cli module emits .js + .d.ts + .d.ts.map in dist/cli/", () => {
  const modules = [...walkTs(join(pkgRoot, "src", "cli"))];
  assert.ok(modules.length >= 10, "sanity: the cli subtree really compiled");
  const missing: string[] = [];
  for (const file of modules) {
    const rel = file.slice(join(pkgRoot, "src").length + 1); // cli/<module>.ts
    for (const ext of [".js", ".d.ts", ".d.ts.map"]) {
      const out = join(pkgRoot, "dist", `${rel.slice(0, -3)}${ext}`);
      if (!existsSync(out)) missing.push(out.slice(pkgRoot.length + 1));
    }
  }
  assert.deepEqual(missing, [], "per-module declarations are complete for the CLI surface");
});

test("cli-packaging — the compiled bin runs: --help exits 0 printing the synopsis", () => {
  const stdout = execFileSync(process.execPath, [join(pkgRoot, "dist", "cli", "main.js"), "--help"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.match(stdout, /usage:/i);
  assert.match(stdout, /check/);
  assert.match(stdout, /rollback/);
});
