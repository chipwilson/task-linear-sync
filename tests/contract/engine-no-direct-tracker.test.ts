/**
 * T048 [P] — no-direct-tracker contract scan over `src/engine/**` (constitution V: "All
 * Linear access MUST flow through the injectable Linear_Port… no component bypasses the
 * port's retry, rate-limit, and diagnostic posture"; plan.md "Testing security tier";
 * mirrors the 007 posture of `tests/contract/tracker-no-direct-access.test.ts`, whose
 * forbidden-token list this scan reuses and extends for the engine).
 *
 * Asserts (source scan — `.ts` files under `src/engine/`, comments included: a transport
 * import hidden in shape is still an import, and the tokens here are scan-cheap):
 *  1. ZERO transport/HTTP/GraphQL/credential material: no `fetch(` call, no Linear host
 *     literal, no `Authorization` header name, no Node transport built-ins
 *     (`node:http|https|http2|net|tls|dns|dgram`), no `undici`/`WebSocket`/
 *     `XMLHttpRequest`/GraphQL client naming, no `lin_api_` token shape, no import of the
 *     tracker adapter internals (`tracker/internal|http`) or of the fake/testing surface;
 *  2. ZERO tracker-adapter reach-around: no relative `…/tracker` import from the engine,
 *     and — per the 008 import convention (plan.md; research R1) — no
 *     `task-linear-sync/*` PACKAGE-SPECIFIER import inside `src/engine/` (frozen/wave-2
 *     modules are imported relatively; the engine ships inside the package);
 *  3. all tracker access flows through the injected `Linear_Port`: the port type enters
 *     ONLY from `../ports/…` (import scan), and the adapter/fake constructors
 *     (`createLinearPort`, `createFakeLinearPort`) are never referenced in the engine —
 *     the engine composes over `EngineDependencies.port` and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const engineRoot = join(pkgRoot, "src", "engine");
const srcRoot = join(pkgRoot, "src");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) yield p;
  }
}

/** 007's forbidden list (tracker-no-direct-access.test.ts) verbatim — then engine adds. */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  // — the 007 posture (mirrored token list) —
  [/\bfetch\s*\(/, "fetch( call"],
  [/linear\.app/i, "Linear host literal"],
  [/\bAuthorization\b/, "Authorization header name"],
  [/from\s+["'][^"']*tracker\/(internal|http)\b/, "import of tracker internals (src/tracker/internal|http)"],
  [/from\s+["']task-linear-sync\/tracker\/testing\b/, "production import of the fake/testing surface"],
  // — engine-specific security tier extensions —
  [/from\s+["'](?:\.\.\/)+tracker\/|from\s+["']\.\/tracker\//, "relative import of the tracker adapter (bypasses the injected port)"],
  [/from\s+["']task-linear-sync\//, "package-specifier import inside src/ (008 import convention: relative only)"],
  [/from\s+["']node:(?:https?|http2|net|tls|dns|dgram)\b/, "Node transport built-in import"],
  [/from\s+["']undici["']|\bWebSocket\b|XMLHttpRequest/, "alternative HTTP client"],
  [/\bgraphql\b/i, "GraphQL client naming (the port is the only transport posture)"],
  [/lin_api_[A-Za-z0-9]+/, "token-shaped credential literal"],
];

test("engine-no-direct-tracker — src/engine carries zero transport/HTTP/GraphQL/credential material", () => {
  const files = [...walk(engineRoot)];
  assert.ok(files.length >= 15, "sanity: the engine subtree is really scanned");
  const violations: string[] = [];
  for (const file of files) {
    const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of FORBIDDEN) {
      const hit = text.match(pattern);
      if (hit) violations.push(`${rel}: ${label} → '${hit[0].slice(0, 60)}'`);
    }
  }
  assert.deepEqual(violations, [], "constitution V violation — engine code must never touch transport directly");
});

test("engine-no-direct-tracker — the port type enters only from ../ports, and no adapter/fake constructor is referenced", () => {
  const offenders: string[] = [];
  const constructorHits: string[] = [];
  let portImporters = 0;
  for (const file of walk(engineRoot)) {
    const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    if (/\bcreateLinearPort\b|\bcreateFakeLinearPort\b|\bcreateRecordedTransport\b/.test(text)) {
      constructorHits.push(rel);
    }
    if (/\bLinear_Port\b|\bLinearPort\b/.test(text)) {
      // A file may NAME the port type only if it imports it from the frozen ports layer
      // (`../ports/linear-port.js` / `../ports/engine.js`).
      const importsPorts = /from\s+["']\.\.\/ports\/[a-z-]+\.js["']/.test(text);
      if (!importsPorts) offenders.push(`${rel}: mentions the port type without a ../ports import`);
      else portImporters++;
    }
  }
  assert.deepEqual(constructorHits, [], "the engine never constructs the adapter or the fake — `EngineDependencies.port` is injected (frozen ports contract)");
  assert.deepEqual(offenders, [], "every LinearPort mention is type-imported from ../ports (the injection point)");
  assert.ok(portImporters >= 2, "positive control: the injection point is real — apply/payload reference the injected port type");
});

test("engine-no-direct-tracker — src/engine carries zero task-linear-sync/* package-specifier imports", () => {
  // The 008 import convention (plan.md; research R1): engine code imports frozen/wave-2
  // modules RELATIVELY; package specifiers only ever appear consumer-side (tests, other
  // packages). The engine ships inside the package, so a self-specifier here would be a
  // resolution hazard AND a smuggled bypass of the relative-only posture.
  const violations: string[] = [];
  for (const file of walk(engineRoot)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+["']task-linear-sync\/[^"']*["']/g)) {
      violations.push(`${file.slice(srcRoot.length + 1).replaceAll("\\", "/")}: ${m[0]}`);
    }
  }
  assert.deepEqual(violations, [], "inside src/engine everything is imported relatively (008 import convention; constitution V)");
});
