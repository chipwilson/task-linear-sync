/**
 * T041 — `src/ci/` hygiene contract (wrapper-api.md §5; SC-002 structural
 * proof; precedent `engine-no-direct-tracker.test.ts`).
 *
 * Source-text scan over the whole module group: zero frozen-module imports,
 * engine access limited to the screener factory, no network/transport or
 * mutate vocabulary, `node:child_process` confined to `cli-invoker.ts`,
 * `node:fs` confined to the read pair + `appendFileSync` in `main.ts` only,
 * and zero clock/randomness in the pure tier.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ciDir = join(pkgRoot, "src", "ci");

const files = readdirSync(ciDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();

const sources = files.map((name) => ({
  name,
  text: readFileSync(join(ciDir, name), "utf8"),
}));

test("hygiene: the module group is present and non-trivial", () => {
  assert.deepEqual(files, [
    "cli-invoker.ts",
    "enforcement.ts",
    "errors.ts",
    "evaluate.ts",
    "index.ts",
    "main.ts",
    "report-input.ts",
    "settings.ts",
    "summary.ts",
  ]);
});

test("hygiene: zero imports of frozen/neighbor modules or package specifiers", () => {
  for (const { name, text } of sources) {
    for (const banned of [
      "../gates",
      "../tracker",
      "../queue",
      "../history-server",
      "../mcp",
      "../cli",
    ]) {
      // Import SPECIFIERS only — path prose (node_modules resolution docs) is legal.
      assert.equal(
        text.includes(`from "${banned}`),
        false,
        `${name} must not import from ${banned}`,
      );
    }
    assert.equal(/from "task-linear-sync/.test(text), false, `${name} must not import package specifiers`);
    // Cross-module imports allowed ONLY: ../config (screener config),
    // ../engine (screener factory), ../ports (screener TYPE only).
    for (const match of text.matchAll(/from "(\.\.\/[^"]+)"/g)) {
      assert.ok(
        ["../config/index.js", "../engine/index.js", "../ports/engine.js"].includes(match[1]),
        `${name}: unexpected cross-module import ${match[1]}`,
      );
    }
  }
});

test("hygiene: from src/engine ONLY createDefaultSecurityScreener — never engine/apply surfaces", () => {
  const engineImporters = sources.filter(({ text }) => text.includes('"../engine/index.js"'));
  for (const { name, text } of engineImporters) {
    const importLine = text.match(/import \{([^}]*)\} from "\.\.\/engine\/index\.js"/);
    assert.ok(importLine, `${name}: engine import must be the named screener factory`);
    const names = importLine[1].split(",").map((part) => part.trim()).filter(Boolean);
    assert.deepEqual(names, ["createDefaultSecurityScreener"]);
  }
  for (const { name, text } of sources) {
    for (const banned of ["createSyncEngine", "buildSyncPlan", "applySyncPlan", "rollbackRun"]) {
      assert.equal(text.includes(banned), false, `${name} must never touch ${banned}`);
    }
  }
});

test("hygiene: no transport, credential, or GraphQL surface anywhere", () => {
  for (const { name, text } of sources) {
    for (const banned of ["fetch(", "WebSocket", "GraphQL", "graphql", "Authorization", "lin_api_"]) {
      assert.equal(text.includes(banned), false, `${name} must not contain ${banned}`);
    }
    assert.equal(/https?:\/\//.test(text), false, `${name}: no URL literals`);
  }
});

test("hygiene: node:child_process lives ONLY in cli-invoker.ts, spawned without a shell", () => {
  for (const { name, text } of sources) {
    const hasImport = text.includes('"node:child_process"');
    assert.equal(hasImport, name === "cli-invoker.ts", `${name}: child_process confinement`);
  }
  const invoker = sources.find(({ name }) => name === "cli-invoker.ts");
  assert.ok(invoker);
  assert.equal(/shell\s*:/.test(invoker.text), false, "no shell option may appear");
});

test("hygiene: node:fs is read-only + the single $GITHUB_OUTPUT append in main.ts", () => {
  for (const { name, text } of sources) {
    const importLine = text.match(/import \{([^}]*)\} from "node:fs";/);
    if (importLine === null) continue;
    const names = importLine[1].split(",").map((part) => part.trim()).filter(Boolean);
    for (const sym of names) {
      assert.ok(
        ["readFileSync", "existsSync", "appendFileSync"].includes(sym),
        `${name}: forbidden fs symbol ${sym}`,
      );
      if (sym === "appendFileSync") {
        assert.equal(name, "main.ts", "appendFileSync is main.ts-only ($GITHUB_OUTPUT)");
      }
    }
  }
  const main = sources.find(({ name }) => name === "main.ts");
  assert.ok(main);
  assert.equal(main.text.includes("GITHUB_OUTPUT"), true);
});

test("hygiene: no mutate/apply vocabulary outside the closed argv surface", () => {
  for (const { name, text } of sources) {
    for (const banned of ["--apply", "--confirm", "accept-low-confidence"]) {
      assert.equal(text.includes(banned), false, `${name} must not speak ${banned}`);
    }
  }
});

test("hygiene: the pure tier has zero clock and zero randomness imports/uses", () => {
  for (const name of ["evaluate.ts", "report-input.ts", "summary.ts"]) {
    const { text } = sources.find((source) => source.name === name) as { text: string };
    for (const banned of ["node:crypto", "node:os", "Math.random", "Date.now", "new Date", "performance."]) {
      assert.equal(text.includes(banned), false, `${name}: ${banned} breaks determinism`);
    }
  }
});

test("hygiene: the node:process MODULE is imported ONLY by main.ts", () => {
  // (cli-invoker uses the ambient `process.env`/`process.execPath` globals,
  // which import nothing; only main.ts may consume process state.)
  for (const { name, text } of sources) {
    const importsProcess = text.includes('from "node:process"');
    assert.equal(importsProcess, name === "main.ts", `${name}: process module confinement violated`);
  }
});
