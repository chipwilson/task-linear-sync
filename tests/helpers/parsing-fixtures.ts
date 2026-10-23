/**
 * T005 — fixture adapters, test-config factory, and corpus loaders for feature 004.
 *
 * These are the sanctioned development oracles per contracts/adapter-consumption.md
 * rule 4: they implement the built-in `generic` adapter conventions observable through
 * the consumer-owned `TaskFileAdapter` interface ONLY (research R1/R10). They carry
 * ZERO framework knowledge beyond what the interface exposes, and NOTHING here imports
 * 003 code (003 does not exist on this branch; the Wave-3 seam test swaps in the real
 * `generic` adapter with zero changes inside src/parsing/).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { builtInDefaults, type ResolvedConfig } from "task-linear-sync/config";

/** Repository root as seen from the compiled helper (build/tests/helpers/ → repo root). */
const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Read a parsing fixture by path relative to `tests/fixtures/` (test-side I/O only). */
export function readFixture(relPath: string): string {
  return readFileSync(`${pkgRoot}tests/fixtures/${relPath}`, "utf8");
}

/** Read a golden-corpus file (`tests/fixtures/parsing/golden/<name>`). */
export function readGolden(name: string): string {
  return readFixture(`parsing/golden/${name}`);
}

/** Read a framework-corpus file (`tests/fixtures/parsing/frameworks/<id>/tasks.md`). */
export function readFrameworkFixture(id: string): string {
  return readFixture(`parsing/frameworks/${id}/tasks.md`);
}

/** Read and JSON-parse a golden-corpus sidecar file (assignments / expect-error). */
export function readGoldenJson<T>(name: string): T {
  return JSON.parse(readGolden(name)) as T;
}

/**
 * Hand-clone the frozen built-in defaults with placeholder overrides (002 precedent:
 * construct directly, never `loadConfig`). Only the keys parsing consumes are ever
 * overridden in tests; arrays/objects replace wholesale at the given top-level key.
 */
export function makeTestConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...structuredClone(builtInDefaults), ...overrides };
}

// ── Fixture adapters (the 003-interface stand-in; research R1/R10) ──────────────

/** `generic` convention: `<base>/<feature>/tasks.md` → `<feature>`; bare `tasks.md` → undefined. */
function genericFeatureName(taskFilePath: string): string | undefined {
  const m = /(?:^|\/)([^/]+)\/tasks\.md$/.exec(taskFilePath);
  return m?.[1];
}

/** kiro convention: strictly `.kiro/specs/<feature>/tasks.md` → `<feature>`. */
function kiroFeatureName(taskFilePath: string): string | undefined {
  const m = /^\.kiro\/specs\/([^/]+)\/tasks\.md$/.exec(taskFilePath);
  return m?.[1];
}

function prefixedFeatureName(prefix: string) {
  return (taskFilePath: string): string | undefined => {
    const m = new RegExp(`^${prefix}([^/]+)/tasks\\.md$`).exec(taskFilePath);
    return m?.[1];
  };
}

/**
 * The built-in-`generic`-style development fixture (adapter-consumption rule 4):
 * NO grammar overrides — inherits merged `ResolvedConfig` defaults; no framework-
 * specific exclusions; `featureName` from the `<base>/<feature>/tasks.md` shape.
 */
export const genericFixtureAdapter = {
  id: "generic" as const,
  featureName: genericFeatureName,
};

// The four framework fixtures vary ONLY in interface-visible conventions (research R10).

/** bmad: `bmad/<feature>/tasks.md` → `<feature>`; no grammar overrides. */
export const bmadFixtureAdapter = {
  id: "bmad" as const,
  featureName: prefixedFeatureName("bmad/"),
};

/** spec-kit: `specs/<feature>/tasks.md` → `<feature>`; no grammar overrides. */
export const specKitFixtureAdapter = {
  id: "spec-kit" as const,
  featureName: prefixedFeatureName("specs/"),
};

/** open-spec: `openspec/<feature>/tasks.md` → `<feature>`; no grammar overrides. */
export const openSpecFixtureAdapter = {
  id: "open-spec" as const,
  featureName: prefixedFeatureName("openspec/"),
};

/**
 * kiro: `.kiro/specs/<feature>/tasks.md` → `<feature>`, plus a superset heading
 * grammar override that additionally captures full `Task 1.2`-style ids. The
 * override parses numeric-id fixtures identically to the frozen default (proves
 * override precedence without behavior drift for the corpus, research R2).
 */
export const kiroFixtureAdapter = {
  id: "kiro" as const,
  featureName: kiroFeatureName,
  headingGrammar:
    "^\\s{0,3}#{1,6}\\s+(?:(?<id>Task\\s+[0-9]+(?:\\.[0-9]+)*|[0-9]+(?:\\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\\d*)[.:]?\\s+)?(?<title>.+)$",
};

/**
 * Strict custom grammar: ONLY `## Task <N.M>:` headings are task headings —
 * used by the override-precedence table (adapter-supplied grammar beats the
 * merged config default; other headings become non-tasks).
 */
export const taskGrammarFixtureAdapter = {
  id: "generic" as const,
  featureName: () => undefined,
  headingGrammar: "^\\s{0,3}#{1,6}\\s+Task\\s+(?<id>[0-9]+(?:\\.[0-9]+)*):?\\s+(?<title>.+)$",
};

/**
 * Minimal custom adapter (001 FR-026 shape): id + `headingGrammar` ONLY —
 * no featureName member beyond a trivially-derivable one is required beyond
 * `featureName`, so it supplies the contract-required member with a minimal body.
 */
export const minimalCustomAdapter = {
  id: "generic" as const,
  featureName: () => undefined,
  headingGrammar: "^\\s{0,3}#{1,6}\\s+(?:(?<id>[0-9]+(?:\\.[0-9]+)*)[.:]?\\s+)?(?<title>.+)$",
};
