/**
 * T052 [US3] — 012 hygiene release scan (contracts/component-api.md §3; constitution
 * Principle III; mirrors the `engine-hygiene`/`tracker-hygiene` posture for `src/mcp/**`).
 *
 * Asserts over SOURCE text:
 *  1. ZERO `node:fs` / `node:fs/promises` anywhere in `src/mcp/**` — the group touches
 *     NO filesystem at all (the plan-reference store is in-memory: FR-003's structural
 *     guarantee);
 *  2. the import allowlist: `{node:process, node:http, node:crypto}` + relative in-group
 *     `./` imports + frozen barrels `../{config,domain,gates,ports,state,engine,tracker,
 *     cli,queue}/index.js` — NO `task-linear-sync/*` specifiers, no `tracker/internal|
 *     http`/`tracker/testing` reach-ins, no `../history-server` or sibling surfaces;
 *  3. `process.env` appears in exactly ONE file (the composition-root env default);
 *  4. `node:crypto` only as `timingSafeEqual` (+ optional `createHash`); no outbound
 *     sockets (`node:https|http2|net|tls|dns|dgram`, `fetch(`, `WebSocket`,
 *     `XMLHttpRequest`) — the one `node:http` use is the inbound listener;
 *  5. no `validatePlanReference` import anywhere (apply-gating.md §3.2);
 *  6. zero credential-shaped literals and zero non-placeholder UUIDs across
 *     `src/mcp/**` and `tests/fixtures/mcp/**` (defaults-scan extension).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

const SOURCE_FILES = [...walk(join(pkgRoot, "src/mcp"))].filter((f) => f.endsWith(".ts")).sort();
const FIXTURE_FILES = [...walk(join(pkgRoot, "tests/fixtures/mcp"))].sort();

assert.ok(SOURCE_FILES.length >= 8, "the scan must actually see the 012 source group");

/** Code-only view: block and line comments stripped (detector vocabulary lives in prose). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ALLOWED_BUILTINS = new Set(["node:process", "node:http", "node:crypto"]);
const BARREL = /^\.\.\/(config|domain|gates|ports|state|engine|tracker|cli|queue)\/index\.js$/;
// Feature 015 R4 amendment (additive; documented in contracts/versioning-policy.md §1):
// the GENERATED version module is a compile-time constant with zero I/O — importing it
// upholds this rule's purpose ("src/mcp reads no files at runtime").
const GENERATED_VERSION = "../version.generated.js";
const IN_GROUP = /^\.\//;

test("hygiene: src/mcp imports stay inside the sanctioned set", () => {
  for (const file of SOURCE_FILES) {
    const code = stripComments(readFileSync(file, "utf8"));
    const specifiers = [...code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const specifier of specifiers) {
      const ok = ALLOWED_BUILTINS.has(specifier) || BARREL.test(specifier) || IN_GROUP.test(specifier) || specifier === GENERATED_VERSION;
      assert.ok(ok, `${file}: import '${specifier}' is outside the allowlist`);
      assert.ok(!specifier.startsWith("node:fs"), `${file}: node:fs is banned (FR-003: zero filesystem)`);
    }
  }
});

test("hygiene: process.env appears in exactly one file (the composition root)", () => {
  const hits = SOURCE_FILES.filter((file) => stripComments(readFileSync(file, "utf8")).includes("process.env"));
  assert.deepEqual(hits.map((f) => f.slice(pkgRoot.length)), ["src/mcp/create.ts"]);
});

test("hygiene: node:crypto is timing-safe compare only; no outbound sockets", () => {
  for (const file of SOURCE_FILES) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"node:crypto"/g)) {
      const names = match[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
      for (const name of names) {
        assert.ok(["timingSafeEqual", "createHash"].includes(name), `${file}: crypto import '${name}' is not sanctioned`);
      }
    }
    assert.ok(!code.includes("crypto.randomBytes"), `${file}: no randomness`);
    for (const banned of ["node:https", "node:http2", "node:net", "node:tls", "node:dns", "node:dgram", "fetch(", "WebSocket", "XMLHttpRequest"]) {
      assert.ok(!code.includes(banned), `${file}: outbound-socket surface '${banned}' is banned (inbound node:http only)`);
    }
    assert.ok(!code.includes("validatePlanReference"), `${file}: references must not be shape-validated (apply-gating §3.2)`);
  }
});

// ── credential-shape scan (source + fixtures, Principle III) ──────────────────────────

const SYNTHETIC_UUIDS = new Set(["00000000-0000-4000-8000-000000000000", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
const SYNTHETIC_SCHEMES = [/^ac000000-0000-4000-8000-\d{12}$/, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/];
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{12,}/, "lin_api_-shaped token VALUE"],
  [/-----BEGIN/, "PEM material"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "email-shaped value"],
  [/(proxy-authorization|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/\b(github|gitlab|atlassian|jira|trello|asana|monday\.com|notion\.so|clickup|contoso|globex|initech)\b/i, "real-org literal"],
];

function offending(text: string, label: string): void {
  for (const [pattern, why] of BANNED) {
    assert.ok(!pattern.test(text), `${label}: ${why} found (${String(pattern)})`);
  }
  for (const hit of text.matchAll(UUID_SHAPE)) {
    const value = hit[0].toLowerCase();
    const sanctioned = SYNTHETIC_UUIDS.has(value) || SYNTHETIC_SCHEMES.some((re) => re.test(value));
    assert.ok(sanctioned, `${label}: non-placeholder UUID '${value}'`);
  }
}

test("hygiene: src/mcp sources carry zero credential shapes", () => {
  for (const file of SOURCE_FILES) offending(stripComments(readFileSync(file, "utf8")), file.slice(pkgRoot.length));
});

test("hygiene: tests/fixtures/mcp/** uses placeholder identifiers only", () => {
  assert.ok(FIXTURE_FILES.length >= 2, "the fixture folder must exist with its seeds");
  for (const file of FIXTURE_FILES) offending(readFileSync(file, "utf8"), file.slice(pkgRoot.length));
});
