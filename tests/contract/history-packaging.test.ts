/**
 * T033 [P] — packaging contract for `task-linear-sync/history-server`
 * (mirrors cli-packaging/engine-packaging; runs POST-BUILD like every
 * packaging test). Asserts: the `./history-server` export entry is
 * types-FIRST and both files emit; the compiled entry surfaces the factory,
 * the settings resolver, the error taxonomy and the view types; every
 * `src/history-server` module emits `.js` + `.d.ts` + `.d.ts.map`; and the
 * zero-runtime-dependency budget still holds (the dependency-budget
 * contract stays green unmodified).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL(`file://${pkgRoot}package.json`), "utf8")) as {
  dependencies?: Record<string, string>;
  exports: Record<string, Record<string, string>>;
};

test("history-packaging — the ./history-server export entry is types-first and both files emit", () => {
  const entry = pkg.exports["./history-server"];
  assert.ok(entry, "exports missing the './history-server' subpath");
  assert.deepEqual(Object.keys(entry), ["types", "default"], "'./history-server' lists types FIRST");
  assert.ok(entry.types.endsWith(".d.ts") && entry.types.startsWith("./dist/"));
  assert.ok(entry.default.endsWith(".js") && entry.default.startsWith("./dist/"));
  assert.ok(existsSync(join(pkgRoot, entry.types)), `missing ${entry.types} (run npm run build)`);
  assert.ok(existsSync(join(pkgRoot, entry.default)), `missing ${entry.default}`);
});

test("history-packaging — the compiled entry surfaces the factory, settings, and error taxonomy", async () => {
  const entry = pkg.exports["./history-server"];
  const mod = (await import(pathToFileURL(join(pkgRoot, entry.default)).href)) as Record<string, unknown>;
  for (const name of [
    "createSyncHistoryServer",
    "resolveHistoryServerConfig",
    "ERROR_ENVELOPES",
    "HistoryRequestError",
    "HistoryServerConfigError",
    "parseHistoryRoute",
  ]) {
    assert.ok(name in mod, `export '${name}' missing from the compiled entry`);
  }
  assert.equal(typeof mod.createSyncHistoryServer, "function");
  assert.equal(typeof mod.resolveHistoryServerConfig, "function");
  // Construction failure is a typed error with the frozen name:
  const Ctor = mod.HistoryServerConfigError as new (message?: string) => Error;
  assert.equal(new Ctor("probe").name, "HistoryServerConfigError");
});

test("history-packaging — the generated declarations name the public view types", () => {
  const types = readFileSync(join(pkgRoot, pkg.exports["./history-server"].types), "utf8");
  for (const name of [
    "SyncHistoryServerDeps",
    "SyncHistoryServerApp",
    "ResolvedHistoryServerSettings",
    "HistoryEventView",
    "HistoryPageView",
    "HistoryClock",
  ]) {
    assert.match(types, new RegExp(`\\b${name}\\b`), `index.d.ts does not surface ${name}`);
  }
});

function* walkTs(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkTs(p);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) yield p;
  }
}

test("history-packaging — every src/history-server module emits .js + .d.ts + .d.ts.map in dist", () => {
  const modules = [...walkTs(join(pkgRoot, "src", "history-server"))];
  assert.ok(modules.length >= 10, "sanity: the history-server subtree really compiled");
  const missing: string[] = [];
  for (const file of modules) {
    const rel = file.slice(join(pkgRoot, "src").length + 1); // history-server/<module>.ts
    for (const ext of [".js", ".d.ts", ".d.ts.map"]) {
      const out = join(pkgRoot, "dist", `${rel.slice(0, -3)}${ext}`);
      if (!existsSync(out)) missing.push(out.slice(pkgRoot.length + 1));
    }
  }
  assert.deepEqual(missing, [], "per-module declarations are complete for the history surface");
});

test("history-packaging — zero runtime dependencies added (dependency budget held)", () => {
  assert.deepEqual(pkg.dependencies ?? {}, {}, "the package must keep its zero-dependency budget");
});
