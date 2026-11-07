/**
 * T043 — 013 defaults-scan (Principle III; Req 26 criterion 14; precedent
 * `mcp-defaults-scan.test.ts`): the shipped action surface, wrapper sources,
 * docs page, and fixture corpus carry ZERO identity material — no org
 * literals, token values, PEM/base64 secrets, emails, or non-placeholder
 * UUIDs/hex digests. Placeholder shapes (single-repeat hex digests, the
 * documented `ac000000-…` UUID seed) are explicitly allowed and documented.
 *
 * 015 T006: the banned-shape inventory now lives in `scripts/lib/secret-scan.mjs`
 * (shared with the release pipeline's stage-8 scan) — a behavior-preserving
 * extraction; this suite consumes it via runtime dynamic import (repo-root-
 * relative, so the compiled `build/tests/contract` layout resolves it).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Structural type of scripts/lib/secret-scan.mjs (runtime-imported, not typechecked by tsc). */
interface SecretScanModule {
  readonly BANNED: ReadonlyArray<readonly [RegExp, string]>;
  isPlaceholder(why: string, hit: string): boolean;
  scanText(text: string): Array<{ why: string; hit: string }>;
}
const scanModule = (await import(new URL("../../../scripts/lib/secret-scan.mjs", import.meta.url).href)) as unknown as SecretScanModule;
const BANNED = scanModule.BANNED;
const isPlaceholder = scanModule.isPlaceholder;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function leaves(): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const targets: Array<[string, string]> = [
    ["action.yml", join(pkgRoot, "action.yml")],
    ["docs/ci-enforcement.md", join(pkgRoot, "docs", "ci-enforcement.md")],
  ];
  for (const [label, path] of targets) {
    assert.ok(existsSync(path), `${label} must exist for the scan`);
    out.push({ label, text: readFileSync(path, "utf8") });
  }
  for (const file of readdirSync(join(pkgRoot, "src", "ci"))) {
    if (file.endsWith(".ts")) {
      out.push({ label: `src/ci/${file}`, text: readFileSync(join(pkgRoot, "src", "ci", file), "utf8") });
    }
  }
  for (const file of walk(join(pkgRoot, "tests", "fixtures", "ci"))) {
    out.push({ label: file.slice(pkgRoot.length), text: readFileSync(file, "utf8") });
  }
  return out;
}

test("defaults-scan: action surface, wrapper sources, docs, and fixtures are identity-free", () => {
  for (const leaf of leaves()) {
    for (const finding of scanModule.scanText(leaf.text)) {
      assert.fail(`${leaf.label}: ${finding.why} found: ${finding.hit.slice(0, 24)}`);
    }
  }
});

test("defaults-scan: action.yml input defaults carry no identifiers beyond github context", () => {
  const text = readFileSync(join(pkgRoot, "action.yml"), "utf8");
  const defaults = [...text.matchAll(/^\s{4}default:\s*(.*)$/gm)].map((m) => m[1].trim());
  assert.ok(defaults.length >= 13, `expected at least 13 defaults, saw ${defaults.length}`);
  for (const raw of defaults) {
    const value = raw.replace(/^"|"$/g, "");
    const allowed =
      value === "" ||
      ["check", "true", "false", "0", "1"].includes(value) ||
      /^\$\{\{ github\.[a-z_]+ \}\}$/.test(value);
    assert.ok(allowed, `non-inert default: ${value}`);
  }
});
