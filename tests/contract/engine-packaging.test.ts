/**
 * T049 [P] — packaging contract for `task-linear-sync/engine` (quickstart "Security &
 * determinism checks — Hygiene/packaging"; plan.md R1 "one additive `./engine` subpath";
 * mirrors the 007 posture of `tracker-packaging.test.ts` and the frozen
 * `package-surface.test.ts`). Tests run POST-BUILD (dist/ is present like every other
 * packaging test in this tier).
 *
 * Asserts:
 *  1. the `package.json` exports map carries a types-first `./engine` entry pointing into
 *     the dist layout, and the frozen 002 subpaths keep their exact leading order —
 *     sibling features appended their entries additively;
 *  2. EVERY module under `src/engine/` emits a sibling `.js` + `.d.ts` + `.d.ts.map` in
 *     `dist/engine/` (per-module declarations — the `EngineOptions` TYPE surface exists
 *     for consumers only because the declaration is generated);
 *  3. `task-linear-sync/engine` resolves at runtime via the exports entry (self-reference)
 *     and surfaces the composition root `createSyncEngine`; the generated
 *     `dist/engine/index.d.ts` declares `createSyncEngine` AND exports the
 *     `EngineOptions` type (with its `ResolvedEngineOptions`/`DescriptionNormalizer`
 *     companions) — a type-level surface a scanner can check without a compiler.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  name: string;
  type: string;
  exports: Record<string, Record<string, string>>;
};

const FROZEN_SUBPATHS = [".", "./domain", "./config", "./state", "./urls", "./gates", "./ports"];

test("engine-packaging — the exports map adds ./engine types-first and the frozen 002 entries keep their exact leading order", () => {
  assert.equal(pkg.type, "module", "pure ESM package");
  const keys = Object.keys(pkg.exports);
  assert.deepEqual(keys.slice(0, FROZEN_SUBPATHS.length), FROZEN_SUBPATHS, "frozen subpaths keep their exact leading order");
  const entry = pkg.exports["./engine"];
  assert.ok(entry, "exports missing the './engine' subpath");
  assert.deepEqual(Object.keys(entry), ["types", "default"], "'./engine' is a types-first ESM entry");
  assert.ok(entry.types.endsWith(".d.ts") && entry.types.startsWith("./dist/"), "'./engine' types points into the dist layout");
  assert.ok(entry.default.endsWith(".js") && entry.default.startsWith("./dist/"), "'./engine' default points into the dist layout");
  assert.ok(existsSync(join(pkgRoot, entry.types)), `missing ${entry.types} (run npm run build)`);
  assert.ok(existsSync(join(pkgRoot, entry.default)), `missing ${entry.default}`);
});

function* walkTs(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkTs(p);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) yield p;
  }
}

test("engine-packaging — every src/engine module emits .js + .d.ts + .d.ts.map in dist/engine/", () => {
  const modules = [...walkTs(join(pkgRoot, "src", "engine"))];
  assert.ok(modules.length >= 15, "sanity: the engine subtree really compiled");
  const missing: string[] = [];
  for (const file of modules) {
    const rel = file.slice(join(pkgRoot, "src").length + 1); // engine/<module>.ts
    for (const ext of [".js", ".d.ts", ".d.ts.map"]) {
      const out = join(pkgRoot, "dist", `${rel.slice(0, -3)}${ext}`);
      if (!existsSync(out)) missing.push(join("dist", rel.slice(0, -3) + ext));
    }
  }
  assert.deepEqual(missing, [], "per-module declarations are complete (EngineOptions types are consumer-visible)");
});

test("engine-packaging — task-linear-sync/engine resolves via exports and surfaces createSyncEngine (+ EngineOptions typing)", async () => {
  const mod = (await import("task-linear-sync/engine")) as Record<string, unknown>;
  assert.equal(typeof mod["createSyncEngine"], "function", "createSyncEngine is the runtime composition root");
  // The single-engine posture (constitution V): the exported pipeline members are the
  // same pipelines createSyncEngine composes — the barrel ships no second mutating
  // engine factory beside the composition root.
  const factories = Object.keys(mod).filter((k) => /create.*Engine$/i.test(k));
  assert.deepEqual(factories, ["createSyncEngine"], "no parallel engine factory ships in the barrel");

  const decl = readFileSync(join(pkgRoot, "dist", "engine", "index.d.ts"), "utf8");
  assert.match(decl, /createSyncEngine/, "generated index.d.ts declares createSyncEngine");
  assert.match(decl, /EngineOptions/, "generated index.d.ts exports the EngineOptions type");
  assert.match(decl, /ResolvedEngineOptions|DescriptionNormalizer/, "the EngineOptions companion types ride along");
});
