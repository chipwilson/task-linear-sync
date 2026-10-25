/**
 * T031 — parsing public-surface snapshot contract test (quickstart boundary validation 3;
 * mirrors the 002 frozen-surface pattern at feature scale). Parses the generated
 * declaration files (.d.ts) for every module under src/parsing and compares the exported
 * name set against the checked-in snapshot at tests/contract/snapshots/parsing-surface.json.
 * "005/008/009 consumers get drift alarms; changes land deliberately" — regenerate with
 * UPDATE_PARSING_SNAPSHOT=1 npm run test:contract and call the amendment out in the PR.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
// The snapshot is a CHECKED-IN source artifact — read/write the source tree, never build/.
const snapshotPath = new URL("file://" + pkgRoot + "tests/contract/snapshots/parsing-surface.json");

/** Every module of src/parsing (src/parsing/index.ts is the consumer-facing barrel). */
const PARSING_MODULES = ["adapter", "conflict", "content", "extract", "extent", "identity", "index", "render", "taskfile", "title", "warnings"] as const;

const EXPORT_RE =
  /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:interface|type|function|const|let|class|enum)\s+([A-Za-z0-9_$]+)/g;
const EXPORT_LIST_RE = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

function exportedNames(dts: string): string[] {
  const names = new Set<string>();
  for (const m of dts.matchAll(EXPORT_RE)) if (m[1]) names.add(m[1]);
  for (const m of dts.matchAll(EXPORT_LIST_RE)) {
    for (const clause of (m[1] ?? "").split(",")) {
      const name = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

function currentSurface(): Record<string, string[]> {
  const surface: Record<string, string[]> = {};
  for (const mod of PARSING_MODULES) {
    const dtsPath = new URL(`file://${pkgRoot}dist/parsing/${mod}.d.ts`);
    assert.ok(existsSync(dtsPath), `missing declaration for parsing module '${mod}' (run npm run build)`);
    surface[`parsing/${mod}`] = exportedNames(readFileSync(dtsPath, "utf8"));
  }
  return surface;
}

test("parsing public surface matches the checked-in snapshot", () => {
  const current = currentSurface();

  if (process.env.UPDATE_PARSING_SNAPSHOT === "1") {
    mkdirSync(fileURLToPath(new URL(".", snapshotPath)), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + "\n");
    return;
  }

  assert.ok(
    existsSync(snapshotPath),
    "snapshot missing: generate deliberately with UPDATE_PARSING_SNAPSHOT=1 (an amendment act)",
  );
  const checkedIn = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, string[]>;

  const drift: string[] = [];
  const keys = new Set([...Object.keys(checkedIn), ...Object.keys(current)]);
  for (const key of keys) {
    const before = checkedIn[key];
    const after = current[key];
    if (!before) drift.push(`${key}: module ADDED to parsing surface`);
    else if (!after) drift.push(`${key}: module REMOVED from parsing surface`);
    else {
      const removed = before.filter((n) => !after.includes(n));
      const added = after.filter((n) => !before.includes(n));
      if (removed.length > 0 || added.length > 0) {
        drift.push(`${key}: ${added.length > 0 ? `+${added.join(",")}` : ""} ${removed.length > 0 ? `-${removed.join(",")}` : ""}`.trim());
      }
    }
  }
  assert.deepEqual(drift, [], `parsing surface drift — update the snapshot deliberately:\n${drift.join("\n")}`);
});

test("parsing barrel exports exactly the documented consumer surface", () => {
  const current = currentSurface();
  const barrel = current["parsing/index"] as string[];
  assert.deepEqual(
    [...barrel].sort(),
    [
      "CleanTitleOptions",
      "ConflictBlock",
      "ContentLine",
      "ExclusionRecord",
      "LineAssignment",
      "LineRenderError",
      "LineRenderFailureReason",
      "ParseResult",
      "ParseWarning",
      "RenderOptions",
      "RenderResult",
      "RenderedLineChange",
      "TaskFileAdapter",
      "blocksIntersecting",
      "cleanTitle",
      "deriveStableUuid",
      "frozenLineSet",
      "lineIsFenced",
      "parseTaskFile",
      "renderTaskLines",
      "scanConflictBlocks",
      "splitLines",
    ],
    "consumer-facing exports of task-linear-sync/parsing",
  );
});
