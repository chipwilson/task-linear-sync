/**
 * T044 [P] — no-direct-tracker-access contract scan (constitution V: "All Linear access MUST
 * flow through the injectable Linear_Port… no component bypasses the port's retry, rate-limit,
 * and diagnostic posture"). OUTSIDE `src/tracker/` nothing may: call `fetch(`, reference the
 * Linear host, name the `Authorization` header, or import the adapter's internals
 * (`src/tracker/internal`, `src/tracker/http`, `…/tracker/testing` is likewise off-limits to
 * production code). Zero hits required; the scan reads SOURCES (`.ts` under `src/`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const srcRoot = join(pkgRoot, "src");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) yield p;
  }
}

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch( call"],
  [/linear\.app/i, "Linear host literal"],
  [/\bAuthorization\b/, "Authorization header name"],
  [/from\s+["'][^"']*tracker\/(internal|http)\b/, "import of tracker internals (src/tracker/internal|http)"],
  [/from\s+["']task-linear-sync\/tracker\/testing\b/, "production import of the fake/testing surface"],
];

test("outside src/tracker: zero fetch / Linear host / Authorization / internals imports", () => {
  const violations: string[] = [];
  for (const file of walk(srcRoot)) {
    const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
    if (rel.startsWith("tracker/")) continue; // the adapter itself owns the single request site
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(text)) violations.push(`${rel}: ${label}`);
    }
  }
  assert.deepEqual(violations, [], "constitution V violation — all Linear access must flow through the port");
});

test("the single request site stays where it is (src/tracker/internal/request.ts is the only transport consumer)", () => {
  const offenders: string[] = [];
  for (const file of walk(join(srcRoot, "tracker"))) {
    const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    const importsTransport = /from\s+["']\.\.\/http\.js["']|from\s+["']\.\/http\.js["']/.test(text);
    if (importsTransport && rel !== "tracker/http.ts" && rel !== "tracker/internal/request.ts" && rel !== "tracker/options.ts" && rel !== "tracker/index.ts" && rel !== "tracker/testing/harness.ts") {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "only http.ts (definition), options.ts (default wiring), request.ts (the ONE request site), the recorded harness, and the barrel may reference the transport module");
});
