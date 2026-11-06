/**
 * T043 — 013 defaults-scan (Principle III; Req 26 criterion 14; precedent
 * `mcp-defaults-scan.test.ts`): the shipped action surface, wrapper sources,
 * docs page, and fixture corpus carry ZERO identity material — no org
 * literals, token values, PEM/base64 secrets, emails, or non-placeholder
 * UUIDs/hex digests. Placeholder shapes (single-repeat hex digests, the
 * documented `ac000000-…` UUID seed) are explicitly allowed and documented.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{8,}/, "lin_api_-shaped token VALUE"],
  [/-----BEGIN/, "PEM material"],
  [/(proxy-authorization|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/\b(contoso|globex|initech|umbrella|hooli|vandelay|acme)\b/i, "fictional-org literal standing in for a real tenant"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, "email address"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])/, "UUID-shaped identifier"],
  [/\b[0-9a-f]{32,}\b(?![0-9a-f])/, "hex-digest-shaped secret"],
];

/** Documented placeholder shapes (fixture README / docs). */
function isPlaceholder(why: string, hit: string): boolean {
  if (why.includes("hex-digest")) {
    return /^([0-9a-f])\1{31,}$/.test(hit); // single-repeat hex = shape probe
  }
  if (why.includes("UUID")) {
    return /^ac000000-0000-4000-8000-\d{12}$/.test(hit); // fixture placeholder seed
  }
  return false;
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
    for (const [pattern, why] of BANNED) {
      for (const m of leaf.text.matchAll(new RegExp(pattern.source, "g"))) {
        if (isPlaceholder(why, m[0])) continue;
        assert.fail(`${leaf.label}: ${why} found: ${m[0].slice(0, 24)}`);
      }
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
