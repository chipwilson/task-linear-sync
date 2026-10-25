/**
 * T005 — frozen-contract import guard (ROADMAP rule 2 / 002 FR-008).
 * The 005 modules under `src/routing/` and `src/titles/` MUST import the frozen 002 shapes
 * (`RoutingResolution`, `ProjectByPathEntry` from `src/domain/routing.js`; `Task` from
 * `src/domain/task.js`) and MUST NEVER declare their own. This is a source-scan assertion:
 * `import type { RoutingResolution }` is allowed; `interface RoutingResolution` is not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

const MODULE_DIRS = ["src/routing", "src/titles"] as const;

/** Frozen 002 names 005 may import but never re-declare. */
const FROZEN_NAMES = ["RoutingResolution", "ProjectByPathEntry", "Task"] as const;

/**
 * A declaration of a frozen name (`interface`/`type` alias/`class`/`enum`). An import such as
 * `import type { RoutingResolution }` is NOT a declaration: the name follows `{`, not the
 * keyword directly.
 */
const DECLARATION_RE = (name: string): RegExp =>
  new RegExp(`\\b(?:interface|type|class|enum)\\s+${name}\\b`);

/** Any file mentioning a frozen name must import it from the frozen 002 module. */
const FROZEN_IMPORT: Record<(typeof FROZEN_NAMES)[number], string> = {
  RoutingResolution: 'from "../domain/routing.js"',
  ProjectByPathEntry: 'from "../domain/routing.js"',
  Task: 'from "../domain/task.js"',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(new URL(`file://${pkgRoot}${dir}`))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${dir}/${f}`);
}

test("frozen imports 005 — 005 source directories exist", () => {
  for (const dir of MODULE_DIRS) {
    assert.ok(existsSync(new URL(`file://${pkgRoot}${dir}`)), `missing 005 module directory '${dir}'`);
  }
});

test("frozen imports 005 — no file under src/routing or src/titles re-declares a frozen 002 type", () => {
  const offenders: string[] = [];
  for (const dir of MODULE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(new URL(`file://${pkgRoot}${file}`), "utf8");
      for (const name of FROZEN_NAMES) {
        if (DECLARATION_RE(name).test(text)) offenders.push(`${file}: declares '${name}'`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `frozen 002 contracts must be imported, never re-declared (ROADMAP rule 2 / 002 FR-008):\n${offenders.join("\n")}`,
  );
});

test("frozen imports 005 — every mention of a frozen name imports it from the frozen 002 module", () => {
  const unimported: string[] = [];
  for (const dir of MODULE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(new URL(`file://${pkgRoot}${file}`), "utf8");
      for (const name of FROZEN_NAMES) {
        if (new RegExp(`\\b${name}\\b`).test(text) && !text.includes(FROZEN_IMPORT[name])) {
          unimported.push(`${file}: mentions '${name}' without importing ${FROZEN_IMPORT[name]}`);
        }
      }
    }
  }
  assert.deepEqual(unimported, [], `frozen types must arrive from src/domain via type imports:\n${unimported.join("\n")}`);
});
