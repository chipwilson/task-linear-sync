/**
 * T032 [P] — history-server hygiene release scan (research R9;
 * contracts/component-api.md §3, mirroring the cli-hygiene/engine-hygiene
 * posture). Source scan over `src/history-server/**`:
 *  1. ZERO `node:fs` imports (no manifest/state/checkpoint read or write);
 *  2. zero `../state/` imports and zero banned identifier occurrences;
 *  3. inbound-only transport (`node:http` allowed; outbound clients banned);
 *  4. no tracker internals / no `task-linear-sync/*` package specifiers;
 *  5. `process.env` in exactly one file; `node:crypto` confined to auth.ts;
 *  6. placeholder-only sources, fixtures, and docs (Principle III).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const srcRoot = join(pkgRoot, "src", "history-server");

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function srcFiles(): string[] {
  return [...walk(srcRoot)].filter((f) => f.endsWith(".ts"));
}

/** Import specifiers, with the type-only flag inferred from the statement. */
function importsOf(text: string): Array<{ spec: string; typeOnly: boolean }> {
  const out: Array<{ spec: string; typeOnly: boolean }> = [];
  for (const m of text.matchAll(/\bimport\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)"/g)) {
    const clause = m[2] as string;
    out.push({
      spec: m[3] as string,
      // `import type { X }` or a lone `type X` clause — erased at runtime.
      typeOnly: m[1] !== undefined || /^type\s/.test(clause),
    });
  }
  return out;
}

/* ── 1 + 2: no filesystem, no state module, no state identifiers ─────────────── */

test("history-hygiene — zero node:fs imports (no manifest/state/checkpoint I/O possible)", () => {
  const files = srcFiles();
  assert.ok(files.length >= 10, "sanity: the history-server sources are really scanned");
  const violations: string[] = [];
  for (const file of files) {
    for (const { spec } of importsOf(readFileSync(file, "utf8"))) {
      if (spec === "node:fs" || spec === "node:fs/promises" || spec.startsWith("node:fs/")) {
        violations.push(`${file.slice(pkgRoot.length + 1)}: '${spec}'`);
      }
    }
  }
  assert.deepEqual(violations, [], "src/history-server must never touch the filesystem");
});

test("history-hygiene — zero ../state/ imports and zero state-identifier occurrences", () => {
  const bannedText = [
    "StateStore",
    "sync-state.json",
    "manifest",
    "last-run",
    "checkpoint",
    "keyProvider",
    "manifestKey",
  ];
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(pkgRoot.length + 1);
    const text = readFileSync(file, "utf8");
    for (const { spec } of importsOf(text)) {
      if (/(^|\/)\.\.\/state\/|(^|\/)state\//.test(spec) && !spec.includes("state-payload")) {
        violations.push(`${rel}: state-module import '${spec}'`);
      }
    }
    for (const needle of bannedText) {
      if (text.includes(needle)) violations.push(`${rel}: identifier '${needle}'`);
    }
  }
  assert.deepEqual(violations, [], "the history surface must never read or write sync state");
});

/* ── 3: inbound-only transport ────────────────────────────────────────────────── */

test("history-hygiene — inbound-only transport: node:http allowed, client stacks banned", () => {
  const bannedSpecs = ["node:https", "node:http2", "node:net", "node:tls", "node:dns", "node:dgram"];
  const bannedText = ["fetch(", "undici", "WebSocket", "XMLHttpRequest"];
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(pkgRoot.length + 1);
    const text = readFileSync(file, "utf8");
    for (const { spec } of importsOf(text)) {
      if (bannedSpecs.includes(spec)) violations.push(`${rel}: outbound transport '${spec}'`);
    }
    for (const needle of bannedText) {
      if (text.includes(needle)) violations.push(`${rel}: outbound client '${needle}'`);
    }
  }
  assert.deepEqual(violations, [], "the component must never become an HTTP/WS client");
});

/* ── 4 + 5: import discipline and single env/crypto sites ────────────────────── */

test("history-hygiene — no tracker reach-ins and no task-linear-sync package specifiers", () => {
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(pkgRoot.length + 1);
    for (const { spec } of importsOf(readFileSync(file, "utf8"))) {
      if (/tracker\/(internal|http|testing)/.test(spec)) {
        violations.push(`${rel}: tracker internals import '${spec}'`);
      }
      if (spec.startsWith("task-linear-sync/")) {
        violations.push(`${rel}: package specifier '${spec}'`);
      }
    }
  }
  assert.deepEqual(violations, [], "relative-import convention, public modules only");
});

test("history-hygiene — process.env in exactly one file; node:crypto confined to auth.ts", () => {
  const envFiles: string[] = [];
  const cryptoFiles: string[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(srcRoot.length + 1);
    const text = readFileSync(file, "utf8");
    if (text.includes("process.env")) envFiles.push(rel);
    if (importsOf(text).some((i) => i.spec === "node:crypto")) cryptoFiles.push(rel);
  }
  assert.deepEqual(envFiles, ["create.ts"], "the deps default is the single sanctioned env read");
  assert.deepEqual(cryptoFiles, ["auth.ts"], "crypto (HMAC/HKDF/timingSafe) lives only in auth.ts");
});

/* ── 6: placeholder-only sources, fixtures, docs (Principle III) ─────────────── */

const SYNTHETIC_UUID = /^ac000000-0000-4000-8000-\d{12}$/;
const DETERMINISTIC_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const REAL_ORG =
  /\b(github|gitlab|atlassian|jira|trello|asana|monday\.com|notion\.so|height\.app|clickup|contoso|globex|initech)\b/i;

// Credential SHAPES (values). Header NAMEs (Set-Cookie / WWW-Authenticate) are
// the inbound server's job and are deliberately NOT banned here (§3.7 bans
// credential-shaped literals, which names are not).
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{12,}/, "lin_api_-shaped token VALUE"],
  [/-----BEGIN/, "PEM material"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "email-shaped value"],
];

function scanText(label: string, text: string, violations: string[]): void {
  for (const [pattern, name] of BANNED) {
    const hit = text.match(pattern);
    if (hit && name.startsWith("email") && hit[0].endsWith(".invalid")) continue;
    if (hit) violations.push(`${label}: ${name} → '${hit[0].slice(0, 48)}'`);
  }
  // Quoted token-like literals (≥24 chars, digit-bearing) — placeholder UUIDs excluded.
  for (const m of text.matchAll(/["']([A-Za-z0-9_-]*\d[A-Za-z0-9_-]{22,})["']/g)) {
    const value = m[1] as string;
    if (SYNTHETIC_UUID.test(value) || DETERMINISTIC_V5.test(value)) continue;
    violations.push(`${label}: high-entropy token-like literal → '${value.slice(0, 40)}'`);
  }
  const org = text.match(REAL_ORG);
  if (org !== null) violations.push(`${label}: real-org identifier '${org[0]}'`);
  const uuids = [...text.matchAll(new RegExp(UUID_SHAPE, "gi"))]
    .map((m) => m[0] as string)
    .filter((u) => !SYNTHETIC_UUID.test(u) && !DETERMINISTIC_V5.test(u));
  if (uuids.length > 0) violations.push(`${label}: non-placeholder UUID(s): ${uuids.slice(0, 3).join(", ")}`);
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)\]…]+/g)) {
    const url = m[0] as string;
    if (!/\.example\.invalid(\/|$|:)/.test(url) && !url.includes("localhost") && !url.includes("127.0.0.1")) {
      violations.push(`${label}: non-benign host '${url.slice(0, 60)}'`);
    }
  }
}

test("history-hygiene — src/history-server sources ship zero org literals, tokens, or real hosts", () => {
  const violations: string[] = [];
  for (const file of srcFiles()) {
    scanText(`src/history-server/${file.slice(srcRoot.length + 1)}`, readFileSync(file, "utf8"), violations);
  }
  assert.deepEqual(violations, [], "Principle III violation in history-server sources");
});

test("history-hygiene — tests/fixtures/history/** uses placeholders only", () => {
  const fixtureRoot = join(pkgRoot, "tests", "fixtures", "history");
  const files = [...walk(fixtureRoot)];
  assert.ok(files.length >= 1, "sanity: the fixture tree is really scanned");
  const violations: string[] = [];
  for (const file of files) {
    scanText(file.slice(pkgRoot.length + 1).replaceAll("\\", "/"), readFileSync(file, "utf8"), violations);
  }
  assert.deepEqual(violations, [], "Principle III violation in history fixtures");
});

test("history-hygiene — docs/history-server.md keeps placeholder identifiers only", () => {
  const docPath = join(pkgRoot, "docs", "history-server.md");
  assert.ok(existsSync(docPath), "documentation duty: docs/history-server.md must exist");
  const violations: string[] = [];
  scanText("docs/history-server.md", readFileSync(docPath, "utf8"), violations);
  assert.deepEqual(violations, [], "Principle III violation in operator docs");
});
