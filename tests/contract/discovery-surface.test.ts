/**
 * T007 [Foundational] — export-surface snapshot for the `./discovery` subpath (002 R15 /
 * frozen-surface precedent; contracts/README.md amendment rule).
 *
 * The expected name set is SEEDED from the code blocks in
 * `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` and
 * `contracts/discovery-api.md` (plus the research R1 barrel list). Because 004 compiles
 * against `task-linear-sync/discovery`, any addition/removal/drift fails this suite —
 * a Wave-2 build break by design. Amendments update the EXPECTED tiers deliberately,
 * with a note against 001: foundational names land at T012; US1 names are added at
 * T021; US2 names at T034.
 *
 * Tier note: `DiscoveryRootError` is promoted into the foundational tier — it is the
 * thrown error type of the foundational `canonicalizeRepositoryRoot` (data-model §2) and
 * T006 asserts against its shape; `CustomAdapterError` lands with US2 as listed in T034.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const barrelDts = new URL("file://" + pkgRoot + "dist/discovery/index.d.ts");

/** Tier 1 — foundational (T012). */
const EXPECTED_FOUNDATIONAL: readonly string[] = [
  "AdapterConventions",
  "AdapterRegistry",
  "CustomAdapterDescriptor",
  "DetectionContext",
  "DetectionMatch",
  "DetectionRecord",
  "DiscoverOptions",
  "DiscoveredFile",
  "DiscoveryDiagnostic",
  "DiscoveryOptions",
  "DiscoveryOverrides",
  "DiscoveryResult",
  "DiscoveryRootError",
  "FeatureNameRule",
  "FrameworkAdapter",
  "FrameworkIdentity",
  "GitContext",
  "Refusal",
  "canonicalizeRepositoryRoot",
  "compileNamePattern",
  "isBuiltInFrameworkId",
  "verifyInsideRoot",
];

/** Tier 2 — US1 discovery additions (T021). */
const EXPECTED_US1: readonly string[] = [
  "SelectionOverrideError",
  "createAdapterRegistry",
  "discoverGitContext",
  "discoverTaskFiles",
  "selectAdapter",
];

/** Tier 3 — US2 adapter-convention additions (T034). */
const EXPECTED_US2: readonly string[] = [
  "CustomAdapterError",
  "agentHookScaffold",
  "builtInAdapters",
  "frameworkMetadataFragment",
];

/**
 * THE SNAPSHOT — extended deliberately at each phase checkpoint (T012 foundational,
 * T021 adds EXPECTED_US1, T034 adds EXPECTED_US2), never silently.
 */
const EXPECTED: readonly string[] = [...EXPECTED_FOUNDATIONAL];

/** Parse every name re-exported from the compiled barrel declaration. */
function exportedNames(dts: string): string[] {
  const names = new Set<string>();
  for (const m of dts.matchAll(/\bexport\s+(?:declare\s+)?(?:type\s+)?\{([^}]*)\}\s*(?:from|;)/g)) {
    for (const clause of m[1].split(",")) {
      let name = clause.trim();
      if (!name || name === "type") continue;
      name = name.replace(/^type\s+/, "");
      name = name.split(/\s+as\s+/).pop()?.trim() ?? "";
      if (name) names.add(name);
    }
  }
  // `export * from "./x.js"` would hide names from the snapshot — forbidden in this barrel.
  assert.ok(!/\bexport\s+\*\s+from/.test(dts), "src/discovery/index.ts must use named re-exports only (explicit public surface)");
  return [...names].sort();
}

test("discovery surface: ./discovery barrel exports exactly the snapshotted name set", () => {
  assert.ok(existsSync(barrelDts), "dist/discovery/index.d.ts missing (run npm run build)");
  const current = exportedNames(readFileSync(barrelDts, "utf8"));
  assert.deepEqual(
    current,
    [...EXPECTED].sort(),
    "contract-surface drift — amendments update this snapshot deliberately with a note against 001 (contracts/README.md)",
  );
});

test("discovery surface: foundational tier names are all present (004's compile seam exists)", () => {
  const current = exportedNames(readFileSync(barrelDts, "utf8"));
  for (const name of EXPECTED_FOUNDATIONAL) {
    assert.ok(current.includes(name), `foundational export '${name}' missing`);
  }
  assert.ok(current.includes("FrameworkAdapter"), "FrameworkAdapter is 004's frozen interface");
});

test("discovery surface: runtime exports match the value subset of the snapshot (no accidental values)", async () => {
  const mod = (await import("task-linear-sync/discovery")) as Record<string, unknown>;
  const runtime = Object.keys(mod).sort();
  for (const name of runtime) {
    assert.ok(EXPECTED.includes(name), `unexpected runtime export '${name}' (not in the contract snapshot)`);
  }
  assert.equal(typeof mod.canonicalizeRepositoryRoot, "function");
  assert.equal(typeof mod.verifyInsideRoot, "function");
  assert.equal(typeof mod.compileNamePattern, "function");
  assert.equal(typeof mod.isBuiltInFrameworkId, "function");
});

test("discovery surface: snapshot tier lists are well-formed (sorted, disjoint) — amendments guard", () => {
  const tiers = [EXPECTED_FOUNDATIONAL, EXPECTED_US1, EXPECTED_US2];
  for (const tier of tiers) {
    assert.ok(tier.length > 0, "tier must not be empty");
    assert.deepEqual([...tier].sort(), [...tier], "tier entries must be kept sorted");
  }
  const seen = new Set<string>();
  for (const tier of tiers) {
    for (const name of tier) {
      assert.ok(!seen.has(name), `duplicate snapshot entry '${name}' across tiers`);
      seen.add(name);
    }
  }
});

test("discovery surface: builtInAdapters keys === the five frozen FrameworkIds (active from US2)", async (t) => {
  const mod = (await import("task-linear-sync/discovery")) as Record<string, unknown>;
  if (!("builtInAdapters" in mod)) {
    t.skip("builtInAdapters lands with the US2 tier (T034) — skip is deliberate, not silent");
    return;
  }
  const builtIn = mod.builtInAdapters as Record<string, unknown>;
  assert.deepEqual(Object.keys(builtIn).sort(), ["bmad", "generic", "kiro", "open-spec", "spec-kit"]);
});
