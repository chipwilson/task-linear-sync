/**
 * T008 [015 US3] — version-drift contract (FR-002, research R4,
 * contracts/versioning-policy.md §1): `package.json.version` is the ONLY version
 * source. Enforced three ways:
 *   1. the generated module byte-matches what the derivation renders;
 *   2. NO hand-authored version literal exists in `src/`, `docs/`, or `README.md`
 *      outside the generated module (quoted/backticked semver shapes);
 *   3. the BUILT package embeds exactly the manifest version.
 * A stale duplicate fails every PR (spec US3 scenario 1).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

interface VersionModule {
  renderVersionModule(version: string): string;
}
const renderer = (await import(new URL("../../../scripts/lib/version-module.mjs", import.meta.url).href)) as unknown as VersionModule;

const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string };
const VERSION = manifest.version;

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(p);
    else if (entry.name.endsWith(".ts")) yield p;
  }
}

/** Quoted/backticked semver shapes — version LITERALS, not IPs or dates. */
const SEMVER_LITERAL = /["'`]\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?["'`]/;

test("FR-002: src/version.generated.ts byte-matches the derivation (prebuild is current)", () => {
  const generated = join(pkgRoot, "src", "version.generated.ts");
  assert.ok(existsSync(generated), "src/version.generated.ts must be committed (R4: not gitignored)");
  assert.equal(
    readFileSync(generated, "utf8"),
    renderer.renderVersionModule(VERSION),
    "version module is STALE — run: npm run prebuild",
  );
});

test("FR-002: gen-version --check is green", () => {
  const r = spawnSync(process.execPath, [join(pkgRoot, "scripts", "gen-version.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, `gen-version --check failed: ${r.stderr}`);
});

test("FR-002: no hand-authored version literal in src/ outside the generated module", () => {
  const offenders: string[] = [];
  for (const file of tsFiles(join(pkgRoot, "src"))) {
    if (file.endsWith("version.generated.ts")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = SEMVER_LITERAL.exec(line);
      if (m !== null) offenders.push(`${file.slice(pkgRoot.length)}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("FR-002: docs and README carry no pinned version literals", () => {
  const offenders: string[] = [];
  const docsDir = join(pkgRoot, "docs");
  const targets = [
    ...readdirSync(docsDir).filter((f) => f.endsWith(".md")).map((f) => join(docsDir, f)),
    join(pkgRoot, "README.md"),
  ];
  for (const file of targets) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = SEMVER_LITERAL.exec(line);
      if (m !== null) offenders.push(`${file.slice(pkgRoot.length)}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("FR-002: the built package embeds exactly the manifest version (derivation reaches dist)", () => {
  const distGen = join(pkgRoot, "dist", "version.generated.js");
  const distCreate = join(pkgRoot, "dist", "mcp", "create.js");
  assert.ok(existsSync(distGen), "dist/version.generated.js missing — run: npm run build");
  assert.ok(existsSync(distCreate), "dist/mcp/create.js missing — run: npm run build");
  const genSrc = readFileSync(distCreate, "utf8");
  assert.ok(
    genSrc.includes("version.generated.js"),
    "dist/mcp/create.js must import the generated version module (not inline a literal)",
  );
  assert.ok(readFileSync(distGen, "utf8").includes(VERSION), "generated module must embed the manifest version");
  assert.ok(!SEMVER_LITERAL.test(genSrc.replace(/version\.generated\.js/g, "")), "no inline version literal in built create.js");
});
