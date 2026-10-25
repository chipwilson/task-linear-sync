/**
 * T045 [P] — packaging contract (mirrors 002's package-surface test style): `./tracker` and
 * `./tracker/testing` resolve via self-referencing imports; EVERY module under `src/tracker`
 * emits per-module `.js` + `.d.ts` + `.d.ts.map` in `dist`; the `types` condition is listed
 * FIRST; and the two new entries are the ONLY diff to 002's frozen exports map — the frozen
 * subpaths and their condition objects remain byte-shape identical.
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
const NEW_SUBPATHS = ["./tracker", "./tracker/testing"];

test("002's frozen exports map stays byte-shape-identical; the two tracker entries are additive", () => {
  const keys = Object.keys(pkg.exports);
  assert.deepEqual(keys.slice(0, FROZEN_SUBPATHS.length), FROZEN_SUBPATHS, "the frozen subpaths keep their exact leading order");
  assert.ok(
    NEW_SUBPATHS.every((sub) => keys.includes(sub)),
    "the two new tracker subpaths are present — sibling features (003/004/006) may add their own AFTER them",
  );
  for (const sub of FROZEN_SUBPATHS) {
    const entry = pkg.exports[sub];
    assert.deepEqual(Object.keys(entry), ["types", "default"], `'${sub}' condition object untouched`);
    assert.ok(entry.types.startsWith("./dist/") && entry.default.startsWith("./dist/"), `'${sub}' still points into the frozen dist layout`);
  }
});

test("new subpath entries are types-first ESM entries pointing at real files", () => {
  for (const sub of NEW_SUBPATHS) {
    const entry = pkg.exports[sub];
    assert.equal(Object.keys(entry)[0], "types", `'${sub}' types condition must be listed first`);
    assert.ok(existsSync(join(pkgRoot, entry.types)), `missing ${entry.types} (run npm run build)`);
    assert.ok(existsSync(join(pkgRoot, entry.default)), `missing ${entry.default}`);
  }
});

function* walkTs(dir: string, base: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) yield* walkTs(join(dir, e.name), rel);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) yield rel;
  }
}

test("every src/tracker module emits per-module .js + .d.ts + .d.ts.map in dist/", () => {
  const modules = [...walkTs(join(pkgRoot, "src", "tracker"), "tracker")];
  assert.ok(modules.length >= 20, "sanity: the tracker subtree really compiled");
  for (const rel of modules) {
    for (const ext of [".js", ".d.ts", ".d.ts.map"]) {
      assert.ok(existsSync(join(pkgRoot, "dist", `${rel.slice(0, -3)}${ext}`)), `dist/${rel.slice(0, -3)}${ext} missing (run npm run build)`);
    }
  }
});

test("both new subpaths resolve at runtime via self-referencing imports (and expose their surface)", async () => {
  const tracker = (await import("task-linear-sync/tracker")) as Record<string, unknown>;
  const testing = (await import("task-linear-sync/tracker/testing")) as Record<string, unknown>;
  for (const name of ["createLinearPort", "TrackerError", "TrackerConfigError", "IndeterminateCreateError", "enumerateAttachmentChain", "resolveIssueByTaskIdentity", "issueCarriesTaskIdentity"]) {
    assert.equal(typeof tracker[name], "function", `task-linear-sync/tracker must export ${name}`);
  }
  for (const name of ["createFakeLinearPort", "createRecordedTransport", "syntheticUuid"]) {
    assert.equal(typeof testing[name], "function", `task-linear-sync/tracker/testing must export ${name}`);
  }
});

