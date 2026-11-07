#!/usr/bin/env node
/**
 * Feature 015 (T007, research R4) — derive the embedded version module from the
 * ONE version source: `package.json.version` (FR-002). `prebuild` runs this
 * before every compile; the generated `src/version.generated.ts` is COMMITTED
 * (not gitignored) so `lint` — which runs before `build` in the pipeline —
 * typechecks against it. Rewrites ONLY when content actually changes, so a
 * version bump is the only commit the derivation ever produces.
 *
 * Usage: node scripts/gen-version.mjs [--check]
 *   --check: exit 1 if the checked-in file is stale instead of rewriting
 *            (used by tests/contract/version-drift.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderVersionModule } from "./lib/version-module.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

/** @returns {{ version: string, render: () => string }} */
export function loadDerivation() {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const version = String(manifest.version ?? "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`gen-version: package.json.version is not a clean semver: '${version}'`);
    process.exit(1);
  }
  return { version, render: () => renderVersionModule(version) };
}

const target = resolve(repoRoot, "src", "version.generated.ts");
const { version, render } = loadDerivation();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current !== render()) {
    console.error(`gen-version: src/version.generated.ts is STALE (package.json says ${version}) — run: npm run prebuild`);
    process.exit(1);
  }
  process.exit(0);
}

// Stable-content write: touch the file only when the derived content differs.
const rendered = render();
try {
  if (readFileSync(target, "utf8") === rendered) process.exit(0);
} catch {
  /* first generation */
}
const { writeFileSync } = await import("node:fs");
writeFileSync(target, rendered);
console.log(`gen-version: src/version.generated.ts derived from package.json (${version})`);
