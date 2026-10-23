/**
 * T010 [Foundational] — import-purity contract test (contracts/adapter-consumption.md
 * rule 1, research R12; Principle I purity enforced at test level).
 *
 * Verbatim rule: "every import inside `src/parsing/**` resolves to `node:*`, a relative
 * path within the module, or the frozen `task-linear-sync/domain` / `task-linear-sync/config`
 * subpath exports. A contract test scans the module's import statements and fails on any
 * 003/005/006/007 module path or on `node:fs`/`node:path`/`node:child_process`/`node:net`
 * (research R12)".
 *
 * Implementation note: `src/` compiles before `dist/` exists, so frozen-002 consumption
 * inside `src/parsing/` uses the build-safe relative form of exactly the two allowed
 * subpath targets (`../domain/...` ≡ `task-linear-sync/domain`, `../config/...` ≡
 * `task-linear-sync/config`); every other escape or I/O built-in fails the scan. This
 * test-side use of `node:fs` is sanctioned — only `src/parsing/` is scanned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const moduleDir = `${pkgRoot}src/parsing/`;

/** Import/export specifiers: static imports, re-exports, and `export ... from`. */
const SPECIFIER_RE = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

/** Allowed specifier forms (rule 1, with the relative ≡ subpath equivalence documented above). */
const ALLOWED_RE: readonly RegExp[] = [
  /^node:crypto$/, // the only sanctioned built-in (R3 UUID digest)
  /^\.\/[A-Za-z0-9._-]+\.js$/, // relative path WITHIN the module
  /^\.\.\/(?:domain|config)\/[A-Za-z0-9._-]+\.js$/, // ≡ task-linear-sync/domain | /config
  /^task-linear-sync\/(?:domain|config)$/, // the frozen subpath exports themselves
];

/** Explicit deny set — belt-and-braces messages alongside the allowlist. */
function denyReason(spec: string): string | undefined {
  if (/^node:(?:fs|path|child_process|net|os|http|https|dns)$/u.test(spec)) return "I/O built-in forbidden (Principle I purity)";
  if (/^task-linear-sync\/(?:discovery|adapters|routing|matching|tracker|state|urls|gates|ports)$/u.test(spec))
    return "non-parsing sibling module forbidden (Wave-2 isolation)";
  if (/^\.\.\/(?:discovery|adapters|routing|matching|tracker|state|urls|gates|ports)(?:\/|$)/u.test(spec))
    return "relative escape into a foreign feature directory forbidden";
  if (/^\.\.\//u.test(spec)) return "relative escape outside src/parsing/ (except ../domain, ../config) forbidden";
  if (!spec.startsWith("node:") && !spec.startsWith(".")) return "bare package import forbidden (zero-dependency ceiling)";
  return undefined;
}

test("parsing purity — src/parsing/*.ts import only node:crypto, relative paths, and frozen 002 subpaths", () => {
  const files = readdirSync(moduleDir)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  assert.ok(files.length >= 1, `expected sources under ${moduleDir}`);
  for (const file of files) {
    const text = readFileSync(`${moduleDir}${file}`, "utf8");
    for (const match of text.matchAll(SPECIFIER_RE)) {
      const spec = match[1] ?? "";
      const allowed = ALLOWED_RE.some((re) => re.test(spec));
      assert.ok(
        allowed,
        `src/parsing/${file}: import '${spec}' violates the consumption boundary${denyReason(spec) ? ` — ${denyReason(spec)}` : " — not in the rule-1 allowlist"}`,
      );
    }
  }
});

test("parsing purity — raw text never references 003/005/006/007 internals or I/O built-ins", () => {
  const files = readdirSync(moduleDir).filter((f) => f.endsWith(".ts"));
  const forbiddenTokens = [
    "task-linear-sync/discovery",
    "task-linear-sync/state",
    "task-linear-sync/urls",
    "task-linear-sync/gates",
    "task-linear-sync/ports",
    "node:fs",
    "node:path",
    "node:child_process",
    "node:net",
    "writeFile",
    "createWriteStream",
  ];
  for (const file of files) {
    const text = readFileSync(`${moduleDir}${file}`, "utf8");
    for (const token of forbiddenTokens) {
      assert.ok(!text.includes(token), `src/parsing/${file} must never reference '${token}'`);
    }
  }
});

test("parsing purity — the foundational substrate exists and stays inside the boundary (T011–T014 gate)", () => {
  const files = new Set(readdirSync(moduleDir).filter((f) => f.endsWith(".ts")));
  for (const required of ["index.ts", "adapter.ts", "content.ts", "identity.ts", "conflict.ts"]) {
    assert.ok(files.has(required), `src/parsing/${required} missing — foundational phase incomplete`);
  }
});
