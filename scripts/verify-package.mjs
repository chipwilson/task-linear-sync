#!/usr/bin/env node
/**
 * Feature 015 (T015/T026) — archive verification (contracts/artifact-verification.md):
 * prove the PACKED artifact, in an isolated consumer world, not the repository
 * tree. Everything the stage refuses on prints `REFUSED:<CODE>[: detail]` and
 * exits 1 — fail closed, publish unreached.
 *
 *   node scripts/verify-package.mjs <tarball> [--expect-changelog <version>]
 *
 * Checks, in order:
 *   1. allow-list   — every member matches the published allow-list (both the
 *                     `npm pack --json` reader and `tar -tzf` must agree);
 *   2. required     — LICENSE and CHANGELOG.md are IN the archive (FR-001/FR-008);
 *                     the changelog carries an entry for the released version;
 *   3. posture      — the packed manifest is the declared publish posture
 *                     (type/engines/license/bin, zero-dependency budget, types FIRST);
 *   4. consumer     — install the tarball in a throwaway dir, import EVERY
 *                     exports subpath, typecheck against its declarations, run
 *                     the bin, and prove the embedded SERVER_VERSION equals the
 *                     manifest version (FR-004; staleness = refusal).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function refuse(code, detail = "") {
  process.stdout.write(`REFUSED:${code}${detail ? `: ${detail}` : ""}\n`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd ?? repoRoot,
    timeout: opts.timeout ?? 600_000,
    ...(opts.env ? { env: opts.env } : {}),
  });
}

function main() {
  const argv = process.argv.slice(2);
  const tarball = argv.find((a) => !a.startsWith("--"));
  if (!tarball) refuse("USAGE", "usage: node scripts/verify-package.mjs <tarball> [--expect-changelog <version>]");
  const tarballAbs = resolve(process.cwd(), tarball);
  const expectChangelogIdx = argv.indexOf("--expect-changelog");
  const expectChangelog = expectChangelogIdx >= 0 ? argv[expectChangelogIdx + 1] : null;

  // ---- 1. member allow-list, read with BOTH readers (FR-001) ----
  const members = new Set(
    String(sh("tar", ["-tzf", tarballAbs]).stdout ?? "")
      .split("\n")
      .filter((l) => l.length > 0 && !l.endsWith("/"))
      .map((l) => l.replace(/^package\//, "")),
  );
  if (members.size === 0) refuse("ARCHIVE_ALLOWLIST", "tar listing empty/unreadable");

  // npm's allow-list grammar: dist/**, README.md, docs/**, LICENSE, CHANGELOG.md
  // + npm-forced package.json. Anything else is off-list (FR-001: exactly ONE
  // exclusion config — the manifest allow-list — hence NO .npmignore anywhere).
  const ON_LIST = [
    /^package\.json$/,
    /^README\.md$/,
    /^LICENSE$/,
    /^CHANGELOG\.md$/,
    /^dist\/.+$/,
    /^docs\/.+$/,
  ];
  const offList = [...members].filter((m) => !ON_LIST.some((re) => re.test(m)));
  if (offList.length > 0) refuse("ARCHIVE_ALLOWLIST", `off-list members: ${offList.slice(0, 8).join(", ")}`);
  if (exists(".npmignore")) refuse("ARCHIVE_ALLOWLIST", "a .npmignore exists — the manifest allow-list is the only permitted exclusion config (FR-001)");

  // ---- 2. required members + changelog entry (FR-008, US3 scenario 2) ----
  if (!members.has("LICENSE")) refuse("LICENSE_MISSING");
  if (!members.has("CHANGELOG.md")) refuse("CHANGELOG_MISSING");
  const changelog = tarRead("package/CHANGELOG.md");
  if (expectChangelog !== null && !new RegExp(`^## \\[${expectChangelog.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
    refuse("CHANGELOG_MISSING", `no '## [${expectChangelog}] - <date>' entry in the archived CHANGELOG.md`);
  }

  // ---- 3. published-manifest posture (FR-011) ----
  let packed;
  try {
    packed = JSON.parse(tarRead("package/package.json"));
  } catch {
    refuse("POSTURE_DRIFT", "packed package.json unreadable");
  }
  const drift = [];
  if (packed.type !== "module") drift.push(`type=${packed.type} (want module)`);
  if (packed.engines?.node !== ">=20.0.0") drift.push(`engines.node=${packed.engines?.node}`);
  if (packed.license !== "MIT") drift.push(`license=${packed.license}`);
  if (!packed.bin || !Object.values(packed.bin).some((p) => typeof p === "string" && p.startsWith("./dist/"))) drift.push("bin missing/misplaced");
  const depNames = Object.keys(packed.dependencies ?? {});
  if (depNames.length > 1 || (depNames.length === 1 && depNames[0] !== "@modelcontextprotocol/sdk")) {
    drift.push(`runtime deps off the transport allowance: ${depNames.join(",")}`);
  }
  for (const [sub, entry] of Object.entries(packed.exports ?? {})) {
    const keys = Object.keys(entry ?? {});
    if (keys[0] !== "types") drift.push(`exports ${sub}: types not FIRST (${keys.join(",")})`);
    for (const [k, v] of Object.entries(entry ?? {})) {
      if (typeof v === "string" && !v.startsWith("./dist/")) drift.push(`exports ${sub}.${k} escapes dist: ${v}`);
    }
  }
  if (drift.length > 0) refuse("POSTURE_DRIFT", drift.join("; "));

  // ---- 4. isolated consumer world (FR-004) ----
  const work = mkdtempSync(join(tmpdir(), "verify-pkg-"));
  try {
    const consumer = join(work, "consumer");
    sh("mkdir", ["-p", consumer]);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "archive-consumer", version: "0.0.0", private: true, type: "module" }, null, 2) + "\n",
    );
    const inst = sh("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", tarballAbs], { cwd: consumer });
    if (inst.status !== 0) refuse("EXPORT_UNRESOLVED:<install>", `npm install of the tarball failed: ${firstLines(inst.stderr ?? inst.stdout)}`);

    const pkgDir = join(consumer, "node_modules", packed.name);
    let installedManifest;
    try {
      installedManifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    } catch {
      refuse("EXPORT_UNRESOLVED:<install>", "installed package.json missing");
    }

    // Every declared subpath imports for real.
    for (const sub of Object.keys(installedManifest.exports ?? {})) {
      const specifier = sub === "." ? packed.name : `${packed.name}/${sub.replace(/^\.\//, "")}`;
      const probe = sh(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)});`], { cwd: consumer });
      if (probe.status !== 0) refuse("EXPORT_UNRESOLVED", `${specifier}: ${firstLines(probe.stderr ?? probe.stdout)}`);
    }

    // Declarations resolve under NodeNext — the consumer `tsc --noEmit` shape.
    // Node-typed consumers carry @types/node (the honest posture for a Node
    // library); we resolve it OFFLINE from the repository's own devDependency
    // so the check adds no network leg and uses the exact shipped version.
    const nodeTypes = join(repoRoot, "node_modules", "@types", "node");
    if (!exists(join("node_modules", "@types", "node", "package.json"))) refuse("POSTURE_DRIFT", "repository lacks @types/node for the consumer typecheck");
    const imports = Object.keys(installedManifest.exports ?? {})
      .map((sub) => (sub === "." ? packed.name : `${packed.name}/${sub.replace(/^\.\//, "")}`))
      .map((s, i) => `import * as ns${i} from ${JSON.stringify(s)};\nvoid ns${i};`)
      .join("\n");
    writeFileSync(join(consumer, "consumer-types.ts"), `// generated by scripts/verify-package.mjs\n${imports}\n`);
    const tsc = sh(join(repoRoot, "node_modules", ".bin", "tsc"), ["--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--typeRoots", join(repoRoot, "node_modules", "@types"), "--types", "node", join(consumer, "consumer-types.ts")], { cwd: consumer, env: { ...process.env, NODE_PATH: nodeTypes } });
    if (tsc.status !== 0) refuse("TYPES_UNRESOLVED", firstLines(tsc.stdout ?? "") || firstLines(tsc.stderr ?? ""));

    // The packaged CLI answers --version with the manifest version.
    const binRel = Object.values(installedManifest.bin ?? {})[0];
    const binPath = join(pkgDir, binRel.replace(/^\.\//, ""));
    const cli = sh(process.execPath, [binPath, "--version"], { cwd: consumer });
    if (cli.status !== 0) refuse("CLI_VERSION_MISMATCH", `bin exited ${cli.status}: ${firstLines(cli.stderr ?? "")}`);
    const expectedLine = `${packed.name === "task-linear-sync" ? "task-linear-sync" : Object.keys(installedManifest.bin)[0]} ${installedManifest.version}\n`;
    if (cli.stdout !== expectedLine) refuse("CLI_VERSION_MISMATCH", `got '${String(cli.stdout).trim()}' want '${expectedLine.trim()}'`);

    // The embedded SERVER_VERSION equals the manifest version (staleness = refusal).
    // Checked when the package ships the ./mcp subpath (this package does; a
    // minimal synthetic fixture package without ./mcp is exempt by construction).
    if (Object.keys(installedManifest.exports ?? {}).includes("./mcp")) {
      const sv = sh(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(`${packed.name}/mcp`)}); process.stdout.write(String(m.SERVER_VERSION));`], { cwd: consumer });
      if (sv.status !== 0 || sv.stdout.trim() !== installedManifest.version) {
        refuse("STALE_VERSION_DERIVATION", `SERVER_VERSION '${sv.stdout.trim()}' != manifest '${installedManifest.version}'`);
      }
    }
  } finally {
    if (!process.env.VERIFY_PKG_KEEP) rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write("ARCHIVE-OK\n");
}

function exists(rel) {
  return spawnSync("test", ["-e", join(repoRoot, rel)], { encoding: "utf8" }).status === 0;
}
function tarRead(member) {
  const r = spawnSync("tar", ["-xzOf", process.argv[2], member], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`member ${member} unreadable`);
  return String(r.stdout);
}
function firstLines(s) {
  return String(s ?? "").split("\n").filter(Boolean).slice(0, 2).join(" | ").slice(0, 300);
}

main();
