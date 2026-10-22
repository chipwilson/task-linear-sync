/**
 * T053 (codified) — packaging verification: the ESM package `exports` map resolves for
 * the root and every frozen subpath, every frozen module emits a sibling .js + .d.ts in
 * dist/, and `types` entries point at real declaration files (constitution packaging
 * rule; quickstart "Exit criteria for this feature").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  name: string;
  type: string;
  exports: Record<string, { types: string; default: string }>;
};

const SUBPATHS = [".", "./domain", "./config", "./state", "./urls", "./gates", "./ports"];

test("package is pure ESM with exports map covering root and all frozen subpaths", () => {
  assert.equal(pkg.type, "module");
  for (const sub of SUBPATHS) {
    const entry = pkg.exports[sub];
    assert.ok(entry, `exports missing subpath '${sub}'`);
    assert.ok(entry.types.endsWith(".d.ts"), `'${sub}' needs a types condition`);
    assert.ok(entry.default.endsWith(".js"), `'${sub}' needs a default (ESM) condition`);
    assert.ok(existsSync(new URL(`file://${pkgRoot}${entry.types}`)), `missing ${entry.types} (run npm run build)`);
    assert.ok(existsSync(new URL(`file://${pkgRoot}${entry.default}`)), `missing ${entry.default}`);
    // "types" must come FIRST in the condition object (Node + TS resolution order).
    assert.equal(Object.keys(entry)[0], "types", `'${sub}' types condition must be listed first`);
  }
});

test("every frozen module emits .js + .d.ts + .d.ts.map (per-module declarations)", () => {
  const modules: Array<[string, string[]]> = [
    ["domain", ["task", "match", "routing", "state-payload", "checkpoint", "plan", "run-records"]],
    ["config", ["schema", "defaults", "merge", "load", "validate"]],
    ["state", ["clock", "fs", "paths", "lock", "manifest", "intent", "marker"]],
    ["urls", ["attachment-url"]],
    ["gates", ["gates"]],
    ["ports", ["linear-port", "engine"]],
  ];
  for (const [group, mods] of modules) {
    for (const mod of mods) {
      for (const ext of [".js", ".d.ts", ".d.ts.map"]) {
        assert.ok(
          existsSync(new URL(`file://${pkgRoot}dist/${group}/${mod}${ext}`)),
          `dist/${group}/${mod}${ext} missing`,
        );
      }
    }
  }
});

test("all seven export subpaths actually resolve at runtime (self-referencing import)", async () => {
  for (const sub of SUBPATHS) {
    const spec = sub === "." ? "task-linear-sync" : `task-linear-sync/${sub.slice(2)}`;
    const mod = (await import(spec)) as Record<string, unknown>;
    assert.ok(Object.keys(mod).length >= 0, `${spec} resolved`);
  }
});
