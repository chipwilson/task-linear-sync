/**
 * T013 + T033 [015 US1/US4] — archive-verification contract
 * (contracts/artifact-verification.md §1–2; FR-001/FR-004/FR-008/FR-011).
 *
 * Two layers:
 *   1. THE REAL ARTIFACT — `npm pack --json` on the repo: file lists from BOTH
 *      readers (pack JSON entries AND `tar -tzf`) agree and equal the set
 *      DERIVED from `package.json.files` + npm-forced `package.json`; required
 *      members present; published-manifest posture per FR-011; LICENSE
 *      byte-equals the canonical MIT template with the single copyright-line
 *      substitution (T033/US4 scenario 1); NO `.npmignore` anywhere (FR-001's
 *      "exactly one exclusion config").
 *   2. SYNTHETIC FAULT WORLDS — minimal fake tarballs run through
 *      scripts/verify-package.mjs directly: each injected fault produces its
 *      named refusal code (the codes the orchestrator's stage 7 surfaces).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  version: string;
  files: string[];
};

const scratch = mkdtempSync(join(tmpdir(), "u13-archive-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function sh(cmd: string, args: string[], cwd = pkgRoot) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 600_000 });
}

/** Canonical MIT template (T033): the shipped LICENSE must byte-equal this. */
const MIT_TEMPLATE = `MIT License

Copyright (c) task-linear-sync contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function walkFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSorted(dir)) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (spawnSync("test", ["-d", join(dir, entry)]).status === 0) out.push(...walkFiles(join(dir, entry), rel));
    else out.push(rel);
  }
  return out;
}
function readdirSorted(dir: string): string[] {
  return readdirSync(dir).sort();
}

// ---------------------------------------------------------------------------
// Layer 1 — the real artifact (packed once, asserted many ways).
// ---------------------------------------------------------------------------

interface PackEntry {
  filename: string;
  files: Array<{ path: string }>;
  shasum: string;
}
const packDir = join(scratch, "pack");
mkdirSync(packDir);
const packRun = sh("npm", ["pack", "--json", "--pack-destination", packDir]);
assert.equal(packRun.status, 0, `npm pack failed: ${packRun.stderr}`);
const packEntries = JSON.parse(packRun.stdout) as PackEntry[];
assert.equal(packEntries.length, 1, "exactly one tarball");
const tarball = resolve(packDir, packEntries[0]!.filename);
const packReaderSet = new Set(packEntries[0]!.files.map((f) => f.path));
const tarReaderSet = new Set(
  String(sh("tar", ["-tzf", tarball]).stdout)
    .split("\n")
    .filter((l) => l.length > 0 && !l.endsWith("/"))
    .map((l) => l.replace(/^package\//, "")),
);

test("T013: BOTH archive readers agree (npm pack --json vs tar -tzf)", () => {
  assert.deepEqual(
    [...packReaderSet].sort(),
    [...tarReaderSet].sort(),
    "the two readers must see the same members",
  );
});

test("T013: member set equals the set DERIVED from package.json.files (+ npm-forced package.json)", () => {
  const derived = new Set<string>(["package.json"]);
  for (const entry of manifest.files) {
    if (entry.endsWith(".md") || entry === "LICENSE") derived.add(entry);
    else for (const f of walkFiles(join(pkgRoot, entry))) derived.add(`${entry}/${f}`);
  }
  assert.deepEqual(
    [...tarReaderSet].sort(),
    [...derived].sort(),
    "packed members must equal the allow-list derivation — no extras (leaks), no omissions",
  );
});

test("T013: required members LICENSE + CHANGELOG.md are in the archive", () => {
  assert.ok(tarReaderSet.has("LICENSE"), "FR-001: license ships with the package");
  assert.ok(tarReaderSet.has("CHANGELOG.md"), "FR-008: changelog ships with the package");
});

test("T033: archived LICENSE byte-equals the canonical MIT template (single copyright line)", () => {
  const archived = String(sh("tar", ["-xzOf", tarball, "package/LICENSE"]).stdout);
  assert.equal(archived, MIT_TEMPLATE);
  assert.equal(readFileSync(join(pkgRoot, "LICENSE"), "utf8"), MIT_TEMPLATE);
  assert.match(archived, /^Copyright \(c\) task-linear-sync contributors$/m);
});

test("T033: NO .npmignore exists anywhere in the repository (FR-001)", () => {
  const tracked = String(sh("git", ["ls-files", "--", "*.npmignore", ".npmignore"]).stdout).trim();
  assert.equal(tracked, "", ".npmignore must not be tracked");
  const found: string[] = [];
  const skip = new Set(["node_modules", ".git", "build", "coverage", ".opencode", ".specify"]);
  (function walk(dir: string, depth: number) {
    if (depth > 4) return;
    for (const entry of readdirSorted(dir)) {
      if (skip.has(entry)) continue;
      const abs = join(dir, entry);
      if (entry === ".npmignore") found.push(abs.slice(pkgRoot.length));
      else if (spawnSync("test", ["-d", abs]).status === 0) walk(abs, depth + 1);
    }
  })(pkgRoot, 0);
  assert.deepEqual(found, [], "a second exclusion config anywhere contradicts FR-001");
});

test("T013: published-manifest posture (FR-011) on the REAL packed manifest", () => {
  const packed = JSON.parse(String(sh("tar", ["-xzOf", tarball, "package/package.json"]).stdout)) as {
    type: string;
    engines: { node: string };
    license: string;
    bin: Record<string, string>;
    dependencies?: Record<string, string>;
    exports: Record<string, Record<string, string>>;
  };
  assert.equal(packed.type, "module");
  assert.equal(packed.engines.node, ">=20.0.0");
  assert.equal(packed.license, "MIT");
  assert.ok(Object.values(packed.bin).every((p) => p.startsWith("./dist/")), "bin points into dist");
  const deps = Object.keys(packed.dependencies ?? {});
  assert.ok(
    deps.length === 0 || (deps.length === 1 && deps[0] === "@modelcontextprotocol/sdk"),
    `runtime deps must be zero or exactly the MCP-SDK transport allowance, got: ${deps.join(",")}`,
  );
  if (deps.length === 1) {
    // allowance scope: only ./mcp may import it — assert the mcp composition
    // root is the sole importer of the SDK.
    const importers: string[] = [];
    for (const f of walkFiles(join(pkgRoot, "src"))) {
      if (readFileSync(join(pkgRoot, "src", f), "utf8").includes("@modelcontextprotocol/sdk")) importers.push(f);
    }
    assert.ok(importers.every((f) => f.startsWith("mcp/")), `SDK importer must stay inside src/mcp: ${importers.join(",")}`);
  }
  for (const [sub, entry] of Object.entries(packed.exports)) {
    assert.equal(Object.keys(entry)[0], "types", `exports['${sub}'] must list types FIRST`);
    for (const target of Object.values(entry)) assert.ok(target.startsWith("./dist/"), `${sub} → ${target} escapes dist`);
  }
});

test("the real artifact passes scripts/verify-package.mjs end to end (ARCHIVE-OK)", () => {
  const r = sh(process.execPath, [join(pkgRoot, "scripts", "verify-package.mjs"), tarball, "--expect-changelog", manifest.version]);
  assert.equal(r.status, 0, `verifier said: ${r.stdout} ${r.stderr}`);
  assert.equal(r.stdout.trim(), "ARCHIVE-OK");
});

test("stage-8 scan over the REAL artifact reports zero findings (dry-run stays green)", async () => {
  // The whole point of the placeholder allowances: our own shipped docs/dist are
  // clean under the hardened scan, while the fault worlds prove it still catches.
  const scan = (await import(new URL("../../../scripts/lib/secret-scan.mjs", import.meta.url).href)) as unknown as {
    scanFileTree(dir: string): Array<{ file: string; why: string; hit: string }>;
  };
  const extract = join(scratch, "stage8-extract");
  mkdirSync(extract, { recursive: true });
  assert.equal(sh("tar", ["-xzf", tarball, "-C", extract]).status, 0);
  assert.deepEqual(scan.scanFileTree(extract), [], "real archive must be scan-clean");
});

// ---------------------------------------------------------------------------
// Layer 2 — synthetic fault worlds through the verifier (stage-7 codes).
// ---------------------------------------------------------------------------

interface FakeWorld {
  /** mutate the staged tree before tarring */
  mutate?: (root: string) => void;
  version?: string;
  expectChangelog?: string;
}

function buildFakeTarball(label: string, world: FakeWorld = {}): string {
  const version = world.version ?? "1.2.3";
  const root = join(scratch, `world-${label}`);
  const pkg = join(root, "package");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  const manifestObj = {
    name: "fake-pkg",
    version,
    type: "module",
    engines: { node: ">=20.0.0" },
    license: "MIT",
    bin: { "fake-pkg": "./dist/cli.js" },
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  };
  writeFileSync(join(pkg, "package.json"), JSON.stringify(manifestObj, null, 2));
  writeFileSync(join(pkg, "README.md"), "# fake-pkg\n\nfixture world for archive verification.\n");
  writeFileSync(join(pkg, "LICENSE"), MIT_TEMPLATE);
  writeFileSync(join(pkg, "CHANGELOG.md"), `# Changelog\n\n## [${version}] - 2026-01-01\n\n- fixture entry\n`);
  writeFileSync(join(pkg, "dist", "index.js"), "export const X = 1;\n");
  writeFileSync(join(pkg, "dist", "index.d.ts"), "export declare const X: number;\n");
  writeFileSync(join(pkg, "dist", "cli.js"), `#!/usr/bin/env node\nif (process.argv[2] === "--version") { process.stdout.write("fake-pkg ${version}\\n"); process.exit(0); }\nprocess.exit(9);\n`);
  world.mutate?.(pkg);
  const tgz = join(scratch, `${label}.tgz`);
  const r = sh("tar", ["-czf", tgz, "-C", root, "package"]);
  assert.equal(r.status, 0, "fixture tar must build");
  return tgz;
}

function runVerifier(tgz: string, expectChangelog?: string): { status: number | null; out: string } {
  const r = sh(process.execPath, [
    join(pkgRoot, "scripts", "verify-package.mjs"),
    tgz,
    ...(expectChangelog !== undefined ? ["--expect-changelog", expectChangelog] : []),
  ]);
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("fault world baseline: a valid minimal package passes the verifier (world is honest)", () => {
  const r = runVerifier(buildFakeTarball("baseline"), "1.2.3");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ARCHIVE-OK/);
});

test("fault: off-allow-list member → REFUSED:ARCHIVE_ALLOWLIST (diff shown)", () => {
  const r = runVerifier(buildFakeTarball("off-list", { mutate: (p) => writeFileSync(join(p, "internal-notes.txt"), "x") }), "1.2.3");
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:ARCHIVE_ALLOWLIST/);
  assert.match(r.out, /internal-notes\.txt/, "the refusal names the offending member");
});

test("fault: LICENSE removed → REFUSED:LICENSE_MISSING", () => {
  const r = runVerifier(buildFakeTarball("no-license", { mutate: (p) => rmSync(join(p, "LICENSE")) }), "1.2.3");
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:LICENSE_MISSING/);
});

test("fault: changelog entry for the released version removed → REFUSED:CHANGELOG_MISSING", () => {
  const r = runVerifier(buildFakeTarball("no-changelog-entry", { mutate: (p) => writeFileSync(join(p, "CHANGELOG.md"), "# Changelog\n\n_No entries._\n") }), "1.2.3");
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:CHANGELOG_MISSING/);
  assert.match(r.out, /1\.2\.3/, "the refusal names the missing version");
});

test("fault: broken export target → REFUSED:EXPORT_UNRESOLVED (consumer world)", () => {
  const r = runVerifier(
    buildFakeTarball("broken-export", {
      mutate: (p) => {
        const m = JSON.parse(readFileSync(join(p, "package.json"), "utf8"));
        m.exports["."] = { types: "./dist/index.d.ts", default: "./dist/missing.js" };
        writeFileSync(join(p, "package.json"), JSON.stringify(m, null, 2));
      },
    }),
    "1.2.3",
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:EXPORT_UNRESOLVED/);
});

test("fault: non-running CLI binary → REFUSED:CLI_VERSION_MISMATCH", () => {
  const r = runVerifier(
    buildFakeTarball("dead-cli", {
      mutate: (p) => writeFileSync(join(p, "dist", "cli.js"), "#!/usr/bin/env node\nprocess.exit(7);\n"),
    }),
    "1.2.3",
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:CLI_VERSION_MISMATCH/);
});

test("fault: drifted publish posture → REFUSED:POSTURE_DRIFT", () => {
  const r = runVerifier(
    buildFakeTarball("drift", {
      mutate: (p) => {
        const m = JSON.parse(readFileSync(join(p, "package.json"), "utf8"));
        m.type = "commonjs";
        m.engines.node = ">=14";
        writeFileSync(join(p, "package.json"), JSON.stringify(m, null, 2));
      },
    }),
    "1.2.3",
  );
  assert.equal(r.status, 1);
  assert.match(r.out, /REFUSED:POSTURE_DRIFT/);
});
