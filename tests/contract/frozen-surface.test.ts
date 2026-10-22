/**
 * T008 — frozen contract-surface snapshot test (research R15, FR-008).
 * Parses the generated declaration files (.d.ts) for every frozen module under
 * src/{domain,config,state,urls,gates,ports} and compares the exported-name set against
 * the checked-in snapshot at tests/contract/snapshots/frozen-surface.json.
 * Any addition/removal/shape-drift fails the suite; amendments must update the snapshot
 * deliberately (UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract) with a note against 001.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
// The snapshot is a CHECKED-IN source artifact — read/write the source tree, never build/.
const snapshotPath = new URL("file://" + pkgRoot + "tests/contract/snapshots/frozen-surface.json");

/** Frozen modules per plan.md § Source Code — the spec-facing mirror is specs/002-core-domain-contracts/contracts/. */
const FROZEN_MODULES: Record<string, string[]> = {
  domain: ["task", "match", "routing", "state-payload", "checkpoint", "plan", "run-records"],
  config: ["schema", "defaults", "merge", "load", "validate"],
  state: ["clock", "fs", "paths", "lock", "manifest", "intent", "marker"],
  urls: ["attachment-url"],
  gates: ["gates"],
  ports: ["linear-port", "engine"],
};

const EXPORT_RE =
  /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:interface|type|function|const|let|class|enum)\s+([A-Za-z0-9_$]+)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;

function exportedNames(dts: string): string[] {
  const names = new Set<string>();
  for (const m of dts.matchAll(EXPORT_RE)) names.add(m[1]);
  for (const m of dts.matchAll(EXPORT_LIST_RE)) {
    for (const clause of m[1].split(",")) {
      const name = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "type") names.add(name.replace(/^type\s+/, ""));
    }
  }
  return [...names].sort();
}

function currentSurface(): Record<string, string[]> {
  const surface: Record<string, string[]> = {};
  for (const [group, modules] of Object.entries(FROZEN_MODULES)) {
    for (const mod of modules) {
      const key = `${group}/${mod}`;
      const dtsPath = new URL(`file://${pkgRoot}dist/${group}/${mod}.d.ts`);
      assert.ok(existsSync(dtsPath), `missing declaration for frozen module '${key}' (run npm run build)`);
      surface[key] = exportedNames(readFileSync(dtsPath, "utf8"));
    }
  }
  return surface;
}

test("frozen contract surface matches the checked-in snapshot", () => {
  const current = currentSurface();

  if (process.env.UPDATE_FROZEN_SNAPSHOT === "1") {
    mkdirSync(fileURLToPath(new URL(".", snapshotPath)), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + "\n");
    return;
  }

  assert.ok(
    existsSync(snapshotPath),
    "snapshot missing: generate deliberately with UPDATE_FROZEN_SNAPSHOT=1 (an amendment act per FR-008)",
  );
  const checkedIn = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, string[]>;

  const drift: string[] = [];
  const keys = new Set([...Object.keys(checkedIn), ...Object.keys(current)]);
  for (const key of keys) {
    const before = checkedIn[key];
    const after = current[key];
    if (!before) drift.push(`${key}: module ADDED to frozen surface`);
    else if (!after) drift.push(`${key}: module REMOVED from frozen surface`);
    else {
      const removed = before.filter((n) => !after.includes(n));
      const added = after.filter((n) => !before.includes(n));
      if (removed.length) drift.push(`${key}: REMOVED ${removed.join(", ")}`);
      if (added.length) drift.push(`${key}: ADDED ${added.join(", ")}`);
    }
  }
  assert.deepEqual(drift, [], `contract-surface drift (amendments are constitution-governed, FR-008):\n${drift.join("\n")}`);
});

test("each frozen module exports at least one name (snapshot is non-degenerate)", () => {
  const current = currentSurface();
  for (const [key, names] of Object.entries(current)) {
    assert.ok(names.length > 0, `frozen module '${key}' exports nothing — impossible by design`);
  }
});
